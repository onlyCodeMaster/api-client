pub mod commands;
pub mod db;
pub mod secrets;
pub mod storage;

use reqwest::header::{HeaderMap, HeaderName, HeaderValue};
use reqwest::multipart;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::State;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Serialize, Deserialize)]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    pub enabled: bool,
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

    // Handle form-data (multipart)
    if payload.body_type.as_deref() == Some("form-data") {
        if let Some(form_fields) = &payload.form_data {
            let mut form = multipart::Form::new();
            for field in form_fields {
                if field.enabled && !field.key.is_empty() {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let database = db::Database::new().expect("Failed to initialize database");
    let active_requests = Arc::new(ActiveRequests::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(database)
        .manage(active_requests)
        .invoke_handler(tauri::generate_handler![
            send_request,
            cancel_request,
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
