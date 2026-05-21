use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, State};

use crate::curl;
use crate::error::AppError;
use crate::file_transfer;
use crate::http;
use crate::models::{
    BootstrapState, BridgeEvent, CollectionSummary, CurlExportInput, CurlImportInput,
    EnvironmentSummary, FileDownloadInput, FileDownloadResult, FileUploadInput, FileUploadResult,
    PostmanImportInput, RecordHistoryInput, SaveEnvironmentInput, SaveRequestInput,
    SaveSecretInput, SecretStatus, SendRequestInput, SendRequestResult, StoredRequest,
};
use crate::postman;
use crate::secrets;
use crate::storage::{self, StoragePaths};

pub struct AppState {
    pub paths: StoragePaths,
}

const BRIDGE_EVENT_NAME: &str = "api-client://bridge-event";

fn to_command_error(error: AppError) -> String {
    error.to_string()
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn emit_bridge_event(
    app: &AppHandle,
    command: &str,
    phase: &str,
    message: impl Into<String>,
    detail: Option<String>,
) {
    let timestamp = now_millis();
    let payload = BridgeEvent {
        id: format!("{command}-{phase}-{timestamp}"),
        command: command.to_string(),
        phase: phase.to_string(),
        message: message.into(),
        timestamp: timestamp.to_string(),
        detail,
    };

    let _ = app.emit(BRIDGE_EVENT_NAME, payload);
}

#[tauri::command]
pub fn load_bootstrap_state(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BootstrapState, String> {
    emit_bridge_event(
        &app,
        "load_bootstrap_state",
        "started",
        "Loading local workspace state",
        Some(state.paths.app_data_dir.to_string_lossy().into_owned()),
    );

    let settings = match storage::load_settings(&state.paths) {
        Ok(settings) => settings,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "load_bootstrap_state",
                "failed",
                "Failed to load settings",
                Some(message.clone()),
            );
            return Err(message);
        }
    };
    let history = match storage::list_history(&state.paths) {
        Ok(history) => history,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "load_bootstrap_state",
                "failed",
                "Failed to load request history",
                Some(message.clone()),
            );
            return Err(message);
        }
    };
    let collections = match storage::list_collections(&state.paths, &settings.recent_workspace) {
        Ok(collections) => collections,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "load_bootstrap_state",
                "failed",
                "Failed to load collections",
                Some(message.clone()),
            );
            return Err(message);
        }
    };
    let environments = match storage::list_environments(&state.paths) {
        Ok(environments) => environments,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "load_bootstrap_state",
                "failed",
                "Failed to load environments",
                Some(message.clone()),
            );
            return Err(message);
        }
    };
    let secrets = match secrets::list_secret_statuses(&app) {
        Ok(secrets) => secrets,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "load_bootstrap_state",
                "failed",
                "Failed to inspect keychain secrets",
                Some(message.clone()),
            );
            return Err(message);
        }
    };

    emit_bridge_event(
        &app,
        "load_bootstrap_state",
        "completed",
        "Local workspace state loaded",
        Some(format!(
            "{} collections / {} environments / {} history rows",
            collections.len(),
            environments.len(),
            history.len()
        )),
    );

    Ok(BootstrapState {
        paths: state.paths.to_model(),
        settings,
        history,
        collections,
        environments,
        secrets,
    })
}

#[tauri::command]
pub fn record_history_entry(
    app: AppHandle,
    input: RecordHistoryInput,
    state: State<'_, AppState>,
) -> Result<Vec<crate::models::HistoryEntry>, String> {
    let method = input.method.clone();
    let url = input.url.clone();
    match storage::record_history(&state.paths, input) {
        Ok(history) => {
            emit_bridge_event(
                &app,
                "record_history_entry",
                "completed",
                "History entry recorded",
                Some(format!("{method} {url}")),
            );
            Ok(history)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "record_history_entry",
                "failed",
                "Failed to record history entry",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn save_secret(
    app: AppHandle,
    input: SaveSecretInput,
    _state: State<'_, AppState>,
) -> Result<SecretStatus, String> {
    match secrets::save_secret(&input.name, &input.value) {
        Ok(secret) => {
            emit_bridge_event(
                &app,
                "save_secret",
                "completed",
                "Secret saved to keychain",
                Some(secret.name.clone()),
            );
            Ok(secret)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "save_secret",
                "failed",
                "Failed to save secret",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn save_environment(
    app: AppHandle,
    input: SaveEnvironmentInput,
    state: State<'_, AppState>,
) -> Result<EnvironmentSummary, String> {
    match storage::save_environment(&state.paths, input) {
        Ok(environment) => {
            emit_bridge_event(
                &app,
                "save_environment",
                "completed",
                "Environment file saved",
                Some(environment.file_path.clone()),
            );
            Ok(environment)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "save_environment",
                "failed",
                "Failed to save environment",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn save_request(
    app: AppHandle,
    input: SaveRequestInput,
    state: State<'_, AppState>,
) -> Result<CollectionSummary, String> {
    match storage::save_request(&state.paths, input) {
        Ok(collection) => {
            emit_bridge_event(
                &app,
                "save_request",
                "completed",
                "Collection request saved",
                Some(collection.file_path.clone()),
            );
            Ok(collection)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "save_request",
                "failed",
                "Failed to save request",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn import_curl(app: AppHandle, input: CurlImportInput) -> Result<StoredRequest, String> {
    match curl::import_command(input) {
        Ok(request) => {
            emit_bridge_event(
                &app,
                "import_curl",
                "completed",
                "cURL command imported",
                Some(format!("{} {}", request.method, request.url)),
            );
            Ok(request)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "import_curl",
                "failed",
                "Failed to import cURL command",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn export_curl(app: AppHandle, input: CurlExportInput) -> Result<String, String> {
    match curl::export_command(input) {
        Ok(command) => {
            emit_bridge_event(
                &app,
                "export_curl",
                "completed",
                "cURL command exported",
                None,
            );
            Ok(command)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "export_curl",
                "failed",
                "Failed to export cURL command",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn import_postman_collection(
    app: AppHandle,
    input: PostmanImportInput,
) -> Result<Vec<StoredRequest>, String> {
    match postman::import_collection(input) {
        Ok(requests) => {
            emit_bridge_event(
                &app,
                "import_postman_collection",
                "completed",
                "Postman collection imported",
                Some(format!("{} requests", requests.len())),
            );
            Ok(requests)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "import_postman_collection",
                "failed",
                "Failed to import Postman collection",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn upload_file(app: AppHandle, input: FileUploadInput) -> Result<FileUploadResult, String> {
    match file_transfer::upload_file(input) {
        Ok(result) => {
            emit_bridge_event(
                &app,
                "upload_file",
                "completed",
                "File uploaded",
                Some(format!(
                    "{} / {} bytes",
                    result.file_name, result.size_bytes
                )),
            );
            Ok(result)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "upload_file",
                "failed",
                "Failed to upload file",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn download_file(
    app: AppHandle,
    input: FileDownloadInput,
) -> Result<FileDownloadResult, String> {
    match file_transfer::download_file(input) {
        Ok(result) => {
            emit_bridge_event(
                &app,
                "download_file",
                "completed",
                "File downloaded",
                Some(format!(
                    "{} bytes -> {}",
                    result.size_bytes, result.destination_path
                )),
            );
            Ok(result)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "download_file",
                "failed",
                "Failed to download file",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn send_request(
    app: AppHandle,
    input: SendRequestInput,
    state: State<'_, AppState>,
) -> Result<SendRequestResult, String> {
    emit_bridge_event(
        &app,
        "send_request",
        "started",
        "HTTP request started",
        Some(format!("{} {}", input.method, input.url)),
    );

    let result = match http::execute_request(input.clone()) {
        Ok(result) => result,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                "send_request",
                "failed",
                "HTTP request failed",
                Some(message.clone()),
            );
            return Err(message);
        }
    };

    if let Err(error) = storage::record_history(
        &state.paths,
        RecordHistoryInput {
            request_id: input.request_id,
            method: input.method,
            url: input.url,
            status: result.status.clone(),
            duration_ms: result.duration_ms,
        },
    ) {
        let message = to_command_error(error);
        emit_bridge_event(
            &app,
            "send_request",
            "failed",
            "HTTP response received but history recording failed",
            Some(message.clone()),
        );
        return Err(message);
    }

    emit_bridge_event(
        &app,
        "send_request",
        "completed",
        "HTTP request completed",
        Some(format!("{} in {}ms", result.status, result.duration_ms)),
    );

    Ok(result)
}
