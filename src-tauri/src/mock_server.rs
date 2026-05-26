//! Embedded mock HTTP server.
//!
//! Lets the user define `{ method, path, status, headers, body, delay_ms }`
//! routes (per workspace) and serve them on `localhost:<port>` while the app
//! is running. Routes are matched by exact method (or `*` wildcard) and a
//! path pattern that supports `:param` placeholders (e.g.
//! `/api/users/:id`). The first enabled, matching route wins.
//!
//! Storage is file-based: one JSON file per workspace under
//! `<app data>/mock-routes/{workspace_id}.json`. Routes outlive the running
//! server so they survive app restart; the server itself is started
//! on-demand from the UI.

use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode},
    response::Response,
    Router,
};
use serde::{Deserialize, Serialize};
use std::{fs, net::SocketAddr, path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    sync::{oneshot, Mutex as AsyncMutex, RwLock},
    task::JoinHandle,
};

use crate::storage::app_data_dir;
use crate::KeyValue;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct MockRoute {
    pub id: String,
    /// HTTP method to match. Either a concrete method ("GET", "POST", ...)
    /// or `*` to match any.
    pub method: String,
    /// Path pattern. Supports `:param` placeholders matched per-segment.
    /// Example: `/api/users/:id` matches `/api/users/42`.
    pub path: String,
    pub status: u16,
    pub headers: Vec<KeyValue>,
    pub body: String,
    /// Optional artificial delay in milliseconds before responding.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay_ms: Option<u64>,
    /// When false, the route is kept on disk but skipped during matching.
    pub enabled: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct MockServerStatus {
    pub running: bool,
    pub port: Option<u16>,
    pub workspace_id: Option<String>,
}

/// Shared runtime state owned by Tauri. The handle is only `Some` while the
/// server is running.
pub struct MockServerState {
    handle: AsyncMutex<Option<MockServerHandle>>,
}

struct MockServerHandle {
    port: u16,
    workspace_id: String,
    shutdown_tx: Option<oneshot::Sender<()>>,
    join: JoinHandle<()>,
    /// In-memory route store. Reloaded from disk on `apply_routes`.
    routes: Arc<RwLock<Vec<MockRoute>>>,
}

impl Default for MockServerState {
    fn default() -> Self {
        Self::new()
    }
}

impl MockServerState {
    pub fn new() -> Self {
        Self {
            handle: AsyncMutex::new(None),
        }
    }

    pub async fn status(&self) -> MockServerStatus {
        let guard = self.handle.lock().await;
        match guard.as_ref() {
            Some(h) => MockServerStatus {
                running: true,
                port: Some(h.port),
                workspace_id: Some(h.workspace_id.clone()),
            },
            None => MockServerStatus::default(),
        }
    }

    /// Start the server bound to `127.0.0.1:port`. Pass `port = 0` to let the
    /// OS pick a free port. Returns the actual bound port. If a server is
    /// already running, this returns an error — the caller should stop first.
    pub async fn start(&self, workspace_id: String, port: u16) -> Result<u16, String> {
        let mut guard = self.handle.lock().await;
        if guard.is_some() {
            return Err("Mock server is already running. Stop it first.".to_string());
        }

        let routes = load_routes(&workspace_id)?;
        let routes_arc = Arc::new(RwLock::new(routes));

        let listener = tokio::net::TcpListener::bind(SocketAddr::from(([127, 0, 0, 1], port)))
            .await
            .map_err(|e| format!("Failed to bind mock server: {}", e))?;
        let actual_port = listener
            .local_addr()
            .map_err(|e| format!("Failed to read bound port: {}", e))?
            .port();

        let app = Router::new()
            .fallback(handle_request)
            .with_state(routes_arc.clone());

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let join = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        *guard = Some(MockServerHandle {
            port: actual_port,
            workspace_id,
            shutdown_tx: Some(shutdown_tx),
            join,
            routes: routes_arc,
        });
        Ok(actual_port)
    }

    pub async fn stop(&self) -> Result<(), String> {
        let mut guard = self.handle.lock().await;
        if let Some(mut handle) = guard.take() {
            if let Some(tx) = handle.shutdown_tx.take() {
                let _ = tx.send(());
            }
            // Give the server a brief window to shut down gracefully; if it
            // doesn't, abort. Without a timeout, a stuck connection could
            // block the user from restarting.
            let abort_handle = handle.join.abort_handle();
            match tokio::time::timeout(Duration::from_secs(2), handle.join).await {
                Ok(_) => {}
                Err(_) => abort_handle.abort(),
            }
        }
        Ok(())
    }

    /// Reload the in-memory route table from disk for the currently running
    /// server. No-op if the server isn't running.
    pub async fn reload_routes(&self) -> Result<(), String> {
        let guard = self.handle.lock().await;
        if let Some(handle) = guard.as_ref() {
            let routes = load_routes(&handle.workspace_id)?;
            *handle.routes.write().await = routes;
        }
        Ok(())
    }
}

/// Axum request handler. Walks the in-memory route table for the first
/// enabled route that matches the request's method+path.
async fn handle_request(
    State(routes): State<Arc<RwLock<Vec<MockRoute>>>>,
    req: Request,
) -> Response {
    let method = req.method().clone();
    let path = req.uri().path().to_string();

    let snapshot = routes.read().await.clone();
    let matched = snapshot
        .iter()
        .find(|r| r.enabled && method_matches(&r.method, &method) && path_matches(&r.path, &path));

    let route = match matched {
        Some(r) => r.clone(),
        None => {
            return Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("content-type", "application/json")
                .body(Body::from(
                    r#"{"error":"no mock route matched"}"#.to_string(),
                ))
                .unwrap_or_else(|_| Response::new(Body::empty()));
        }
    };

    if let Some(ms) = route.delay_ms {
        tokio::time::sleep(Duration::from_millis(ms)).await;
    }

    let mut builder =
        Response::builder().status(StatusCode::from_u16(route.status).unwrap_or(StatusCode::OK));
    let mut headers = HeaderMap::new();
    for kv in &route.headers {
        if !kv.enabled {
            continue;
        }
        if let (Ok(name), Ok(value)) = (
            HeaderName::try_from(kv.key.as_bytes()),
            HeaderValue::try_from(kv.value.as_bytes()),
        ) {
            headers.append(name, value);
        }
    }
    if !headers.contains_key(http::header::CONTENT_TYPE) && !route.body.is_empty() {
        headers.insert(
            http::header::CONTENT_TYPE,
            HeaderValue::from_static("application/json"),
        );
    }
    if let Some(hs) = builder.headers_mut() {
        *hs = headers;
    }
    builder
        .body(Body::from(route.body))
        .unwrap_or_else(|_| Response::new(Body::empty()))
}

fn method_matches(pattern: &str, actual: &Method) -> bool {
    if pattern == "*" {
        return true;
    }
    pattern.eq_ignore_ascii_case(actual.as_str())
}

/// Match a path pattern like `/api/users/:id` against an actual path.
/// Segments starting with `:` accept any non-empty value.
fn path_matches(pattern: &str, actual: &str) -> bool {
    let p_segs: Vec<&str> = pattern.trim_start_matches('/').split('/').collect();
    let a_segs: Vec<&str> = actual.trim_start_matches('/').split('/').collect();
    if p_segs.len() != a_segs.len() {
        return false;
    }
    for (p, a) in p_segs.iter().zip(a_segs.iter()) {
        if p.starts_with(':') {
            if a.is_empty() {
                return false;
            }
            continue;
        }
        if p != a {
            return false;
        }
    }
    true
}

// === Storage ===

fn mock_routes_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("mock-routes");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create mock-routes dir: {}", e))?;
    Ok(dir)
}

fn workspace_file(workspace_id: &str) -> Result<PathBuf, String> {
    Ok(mock_routes_dir()?.join(format!("{}.json", workspace_id)))
}

pub fn load_routes(workspace_id: &str) -> Result<Vec<MockRoute>, String> {
    let path = workspace_file(workspace_id)?;
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read mock-routes file: {}", e))?;
    let routes: Vec<MockRoute> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse mock-routes file: {}", e))?;
    Ok(routes)
}

fn write_routes(workspace_id: &str, routes: &[MockRoute]) -> Result<(), String> {
    let path = workspace_file(workspace_id)?;
    let json = serde_json::to_string_pretty(routes)
        .map_err(|e| format!("Failed to serialize mock routes: {}", e))?;
    fs::write(&path, json).map_err(|e| format!("Failed to write mock-routes file: {}", e))?;
    Ok(())
}

/// Upsert a single route in the given workspace's route list. Returns the
/// route as stored (with updated_at refreshed).
pub fn save_route(workspace_id: &str, mut route: MockRoute) -> Result<MockRoute, String> {
    let mut routes = load_routes(workspace_id)?;
    let now = chrono::Utc::now().timestamp_millis();
    route.updated_at = now;
    match routes.iter().position(|r| r.id == route.id) {
        Some(idx) => routes[idx] = route.clone(),
        None => {
            if route.created_at == 0 {
                route.created_at = now;
            }
            routes.push(route.clone());
        }
    }
    write_routes(workspace_id, &routes)?;
    Ok(route)
}

pub fn delete_route(workspace_id: &str, id: &str) -> Result<(), String> {
    let mut routes = load_routes(workspace_id)?;
    routes.retain(|r| r.id != id);
    write_routes(workspace_id, &routes)?;
    Ok(())
}

/// Delete every mock route belonging to the workspace. Used when the
/// workspace itself is deleted (cascade from `delete_workspace`).
pub fn delete_workspace_routes(workspace_id: &str) -> Result<(), String> {
    let path = workspace_file(workspace_id)?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete mock-routes file: {}", e))?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn method_matches_exact() {
        assert!(method_matches("GET", &Method::GET));
        assert!(method_matches("get", &Method::GET));
        assert!(!method_matches("POST", &Method::GET));
    }

    #[test]
    fn method_matches_wildcard() {
        assert!(method_matches("*", &Method::GET));
        assert!(method_matches("*", &Method::POST));
        assert!(method_matches("*", &Method::DELETE));
    }

    #[test]
    fn path_matches_literal() {
        assert!(path_matches("/api/users", "/api/users"));
        assert!(!path_matches("/api/users", "/api/users/1"));
        assert!(!path_matches("/api/users", "/api/posts"));
    }

    #[test]
    fn path_matches_param() {
        assert!(path_matches("/api/users/:id", "/api/users/42"));
        assert!(path_matches("/api/users/:id", "/api/users/abc"));
        assert!(!path_matches("/api/users/:id", "/api/users"));
        assert!(!path_matches("/api/users/:id", "/api/users/42/posts"));
    }
}
