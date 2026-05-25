pub mod commands;
pub mod db;
pub mod secrets;
pub mod storage;

use futures_util::{SinkExt, StreamExt};
use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc;
use tokio::sync::Mutex;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    #[serde(default)]
    pub is_file: bool,
    #[serde(default)]
    pub file_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RequestPayload {
    pub method: String,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub body: Option<String>,
    pub body_type: Option<String>,
    pub form_data: Option<Vec<KeyValue>>,
    pub timeout_ms: Option<u64>,
    pub request_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ResponseData {
    pub status: u16,
    pub status_text: String,
    pub headers: HashMap<String, String>,
    pub body: String,
    pub time_ms: u64,
    pub size_bytes: usize,
}

pub struct ActiveRequests {
    map: Mutex<HashMap<String, CancellationToken>>,
}

impl ActiveRequests {
    pub fn new() -> Self {
        Self {
            map: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
async fn cancel_request(
    active_requests: State<'_, Arc<ActiveRequests>>,
    request_id: String,
) -> Result<(), String> {
    let map = active_requests.map.lock().await;
    if let Some(token) = map.get(&request_id) {
        token.cancel();
    }
    Ok(())
}

#[tauri::command]
async fn send_request(
    active_requests: State<'_, Arc<ActiveRequests>>,
    payload: RequestPayload,
) -> Result<ResponseData, String> {
    let timeout = Duration::from_millis(payload.timeout_ms.unwrap_or(30000));

    let client = reqwest::Client::builder()
        .danger_accept_invalid_certs(true)
        .timeout(timeout)
        .build()
        .map_err(|e| format!("Failed to create client: {}", e))?;

    // Register cancellation token
    let cancel_token = CancellationToken::new();
    let request_id = payload.request_id.clone().unwrap_or_default();
    if !request_id.is_empty() {
        let mut map = active_requests.map.lock().await;
        map.insert(request_id.clone(), cancel_token.clone());
    }

    let mut headers = HeaderMap::new();
    for h in &payload.headers {
        if !h.enabled || h.key.is_empty() {
            continue;
        }
        let name = HeaderName::from_bytes(h.key.as_bytes())
            .map_err(|e| format!("Invalid header name '{}': {}", h.key, e))?;
        let value = HeaderValue::from_str(&h.value)
            .map_err(|e| format!("Invalid header value '{}': {}", h.value, e))?;
        headers.insert(name, value);
    }

    let method = payload
        .method
        .to_uppercase()
        .parse::<reqwest::Method>()
        .map_err(|e| format!("Invalid method: {}", e))?;

    let mut request_builder = client.request(method, &payload.url).headers(headers);

    // Handle form-data (multipart) with optional file upload support
    if payload.body_type.as_deref() == Some("form-data") {
        if let Some(form_fields) = &payload.form_data {
            let mut form = multipart::Form::new();
            for field in form_fields {
                if !field.enabled || field.key.is_empty() {
                    continue;
                }
                if field.is_file {
                    if let Some(path) = &field.file_path {
                        let bytes = tokio::fs::read(path).await.map_err(|e| {
                            format!("Failed to read file '{}': {}", path, e)
                        })?;
                        let file_name = std::path::Path::new(path)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("file")
                            .to_string();
                        let part = multipart::Part::bytes(bytes).file_name(file_name);
                        form = form.part(field.key.clone(), part);
                    }
                } else {
                    form = form.text(field.key.clone(), field.value.clone());
                }
            }
            request_builder = request_builder.multipart(form);
        }
    } else if let Some(body) = &payload.body {
        if !body.is_empty() {
            request_builder = request_builder.body(body.clone());
        }
    }

    let start = Instant::now();

    // Race between request and cancellation
    let result = tokio::select! {
        res = request_builder.send() => res.map_err(|e| format!("Request failed: {}", e)),
        _ = cancel_token.cancelled() => Err("Request cancelled".to_string()),
    };

    // Cleanup
    if !request_id.is_empty() {
        let mut map = active_requests.map.lock().await;
        map.remove(&request_id);
    }

    let response = result?;
    let elapsed = start.elapsed().as_millis() as u64;

    let status = response.status().as_u16();
    let status_text = response
        .status()
        .canonical_reason()
        .unwrap_or("Unknown")
        .to_string();

    let mut resp_headers = HashMap::new();
    for (key, value) in response.headers().iter() {
        if let Ok(v) = value.to_str() {
            resp_headers.insert(key.to_string(), v.to_string());
        }
    }

    let body_bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read body: {}", e))?;
    let size_bytes = body_bytes.len();
    let body = String::from_utf8_lossy(&body_bytes).to_string();

    Ok(ResponseData {
        status,
        status_text,
        headers: resp_headers,
        body,
        time_ms: elapsed,
        size_bytes,
    })
}

// ============================================================================
// WebSocket support
// ============================================================================

#[derive(Default)]
pub struct WsConnections {
    map: Mutex<HashMap<String, mpsc::UnboundedSender<WsCommand>>>,
}

enum WsCommand {
    Send(String),
    Close,
}

#[derive(Debug, Serialize, Clone)]
pub struct WsEvent {
    pub request_id: String,
    pub kind: String, // "open" | "message" | "error" | "close"
    pub text: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WsConnectPayload {
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub request_id: String,
}

#[tauri::command]
async fn ws_connect(
    app: AppHandle,
    connections: State<'_, Arc<WsConnections>>,
    payload: WsConnectPayload,
) -> Result<(), String> {
    let WsConnectPayload {
        url,
        headers: _headers,
        request_id,
    } = payload;

    // If already connected, close first.
    {
        let mut map = connections.map.lock().await;
        if let Some(tx) = map.remove(&request_id) {
            let _ = tx.send(WsCommand::Close);
        }
    }

    // Validate the URL early for a friendlier error message; tokio-tungstenite
    // accepts a &str directly via IntoClientRequest.
    url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;

    let (ws_stream, _resp) = tokio_tungstenite::connect_async(url.as_str())
        .await
        .map_err(|e| format!("WebSocket connection failed: {}", e))?;

    let (mut sink, mut stream) = ws_stream.split();

    let (tx, mut rx) = mpsc::unbounded_channel::<WsCommand>();
    {
        let mut map = connections.map.lock().await;
        map.insert(request_id.clone(), tx);
    }

    let _ = app.emit(
        "ws-event",
        WsEvent {
            request_id: request_id.clone(),
            kind: "open".to_string(),
            text: None,
        },
    );

    // Task: forward outgoing commands to sink
    let app_clone = app.clone();
    let connections_arc = connections.inner().clone();
    let request_id_clone = request_id.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                cmd = rx.recv() => {
                    match cmd {
                        Some(WsCommand::Send(text)) => {
                            if sink.send(Message::Text(text)).await.is_err() {
                                break;
                            }
                        }
                        Some(WsCommand::Close) | None => {
                            let _ = sink.send(Message::Close(None)).await;
                            break;
                        }
                    }
                }
                msg = stream.next() => {
                    match msg {
                        Some(Ok(Message::Text(t))) => {
                            let _ = app_clone.emit(
                                "ws-event",
                                WsEvent {
                                    request_id: request_id_clone.clone(),
                                    kind: "message".to_string(),
                                    text: Some(t),
                                },
                            );
                        }
                        Some(Ok(Message::Binary(b))) => {
                            let _ = app_clone.emit(
                                "ws-event",
                                WsEvent {
                                    request_id: request_id_clone.clone(),
                                    kind: "message".to_string(),
                                    text: Some(format!("[binary {} bytes]", b.len())),
                                },
                            );
                        }
                        Some(Ok(Message::Close(_))) | None => {
                            break;
                        }
                        Some(Ok(_)) => {
                            // ping/pong/frame – ignore
                        }
                        Some(Err(e)) => {
                            let _ = app_clone.emit(
                                "ws-event",
                                WsEvent {
                                    request_id: request_id_clone.clone(),
                                    kind: "error".to_string(),
                                    text: Some(e.to_string()),
                                },
                            );
                            break;
                        }
                    }
                }
            }
        }

        let _ = app_clone.emit(
            "ws-event",
            WsEvent {
                request_id: request_id_clone.clone(),
                kind: "close".to_string(),
                text: None,
            },
        );
        let mut map = connections_arc.map.lock().await;
        map.remove(&request_id_clone);
    });

    Ok(())
}

#[tauri::command]
async fn ws_send(
    connections: State<'_, Arc<WsConnections>>,
    request_id: String,
    text: String,
) -> Result<(), String> {
    let map = connections.map.lock().await;
    if let Some(tx) = map.get(&request_id) {
        tx.send(WsCommand::Send(text))
            .map_err(|e| format!("WS send failed: {}", e))?;
        Ok(())
    } else {
        Err("WebSocket not connected".to_string())
    }
}

#[tauri::command]
async fn ws_close(
    connections: State<'_, Arc<WsConnections>>,
    request_id: String,
) -> Result<(), String> {
    let mut map = connections.map.lock().await;
    if let Some(tx) = map.remove(&request_id) {
        let _ = tx.send(WsCommand::Close);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = db::Database::new().expect("Failed to initialize database");
    let active_requests = Arc::new(ActiveRequests::new());
    let ws_connections = Arc::new(WsConnections::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(database)
        .manage(active_requests)
        .manage(ws_connections)
        .invoke_handler(tauri::generate_handler![
            send_request,
            cancel_request,
            ws_connect,
            ws_send,
            ws_close,
            // History
            commands::save_history,
            commands::get_history,
            commands::delete_history,
            commands::clear_history,
            commands::search_history,
            // Settings
            commands::set_setting,
            commands::get_setting,
            commands::get_all_settings,
            commands::delete_setting,
            // Cookies
            commands::save_cookie,
            commands::get_cookies_by_domain,
            commands::get_all_cookies,
            commands::delete_cookie,
            commands::clear_cookies_by_domain,
            // Recent
            commands::add_recent,
            commands::get_recent,
            commands::clear_recent,
            // Collections (filesystem)
            commands::save_collection,
            commands::load_collection,
            commands::list_collections,
            commands::delete_collection,
            // Environments (filesystem)
            commands::save_environment,
            commands::load_environment,
            commands::list_environments,
            commands::delete_environment,
            // Workspace (filesystem)
            commands::save_workspace,
            commands::load_workspace,
            commands::load_default_workspace,
            // Secrets (keychain)
            commands::store_secret,
            commands::get_secret,
            commands::delete_secret,
            commands::store_env_secret,
            commands::get_env_secret,
            commands::delete_env_secret,
            commands::store_auth_secret,
            commands::get_auth_secret,
            commands::delete_auth_secret,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
