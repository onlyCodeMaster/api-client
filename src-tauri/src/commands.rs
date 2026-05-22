use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use tauri::{AppHandle, Emitter, State};

use crate::curl;
use crate::error::AppError;
use crate::file_transfer;
use crate::http;
use crate::models::{
    BootstrapState, BridgeEvent, CollectionSummary, CreateCollectionInput, CurlExportInput,
    CurlImportInput, DeleteCollectionInput, DeleteEnvironmentInput, DeleteRequestInput,
    EnvironmentSummary, FileDownloadInput, FileDownloadResult, FileUploadInput, FileUploadResult,
    MoveCollectionInput, MoveRequestInput, MoveRequestResult, PostmanImportInput,
    RecordHistoryInput, RenameCollectionInput, RenameEnvironmentInput, ReorderRequestInput,
    SaveCollectionOrganizationInput, SaveEnvironmentInput, SaveRequestInput, SaveResponseBodyInput,
    SaveResponseBodyResult, SaveSecretInput, SaveSettingsInput, SecretStatus, SendRequestInput,
    SendRequestResult, StoredRequest,
};
use crate::postman;
use crate::secrets;
use crate::storage::{self, StoragePaths};

pub struct AppState {
    pub paths: StoragePaths,
    pub current_workspace: Mutex<String>,
}

fn current_workspace_name(state: &State<'_, AppState>) -> String {
    state
        .current_workspace
        .lock()
        .map(|workspace| {
            let trimmed = workspace.trim();
            if trimmed.is_empty() {
                "default-workspace".to_string()
            } else {
                trimmed.to_string()
            }
        })
        .unwrap_or_else(|_| "default-workspace".to_string())
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
    paths: &StoragePaths,
    command: &str,
    phase: &str,
    message: impl Into<String>,
    detail: Option<String>,
) {
    let timestamp = now_millis();
    let message = message.into();
    let payload = BridgeEvent {
        id: format!("{command}-{phase}-{timestamp}"),
        command: command.to_string(),
        phase: phase.to_string(),
        message,
        timestamp: timestamp.to_string(),
        detail: detail.clone(),
    };

    let _ = storage::append_log_entry(
        paths,
        command,
        phase,
        &payload.message,
        payload.detail.as_deref(),
    );
    let _ = app.emit(BRIDGE_EVENT_NAME, payload);
}

#[tauri::command]
pub fn load_bootstrap_state(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BootstrapState, String> {
    emit_bridge_event(
        &app,
        &state.paths,
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
                &state.paths,
                "load_bootstrap_state",
                "failed",
                "Failed to load settings",
                Some(message.clone()),
            );
            return Err(message);
        }
    };
    if let Ok(mut workspace) = state.current_workspace.lock() {
        *workspace = settings.recent_workspace.clone();
    }
    let history = match storage::list_history(&state.paths) {
        Ok(history) => history,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
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
                &state.paths,
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
                &state.paths,
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
                &state.paths,
                "load_bootstrap_state",
                "failed",
                "Failed to inspect keychain secrets",
                Some(message.clone()),
            );
            return Err(message);
        }
    };
    let runtime = match storage::record_cache_entry(
        &state.paths,
        "bootstrap-state",
        "metadata",
        0,
        &format!(
            "{} collections / {} environments / {} history rows",
            collections.len(),
            environments.len(),
            history.len()
        ),
    )
    .and_then(|_| storage::runtime_summary(&state.paths))
    {
        Ok(runtime) => runtime,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "load_bootstrap_state",
                "failed",
                "Failed to inspect runtime cache and logs",
                Some(message.clone()),
            );
            return Err(message);
        }
    };

    emit_bridge_event(
        &app,
        &state.paths,
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
        runtime,
        history,
        collections,
        environments,
        secrets,
    })
}

#[tauri::command]
pub fn save_settings(
    app: AppHandle,
    input: SaveSettingsInput,
    state: State<'_, AppState>,
) -> Result<crate::models::AppSettings, String> {
    match storage::save_settings(&state.paths, input) {
        Ok(settings) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "save_settings",
                "completed",
                "Settings saved",
                Some(settings.recent_workspace.clone()),
            );
            Ok(settings)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "save_settings",
                "failed",
                "Failed to save settings",
                Some(message.clone()),
            );
            Err(message)
        }
    }
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
                &state.paths,
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
                &state.paths,
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
    state: State<'_, AppState>,
) -> Result<SecretStatus, String> {
    match secrets::save_secret(&input.name, &input.value) {
        Ok(secret) => {
            emit_bridge_event(
                &app,
                &state.paths,
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
                &state.paths,
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
                &state.paths,
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
                &state.paths,
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
pub fn rename_environment(
    app: AppHandle,
    input: RenameEnvironmentInput,
    state: State<'_, AppState>,
) -> Result<EnvironmentSummary, String> {
    match storage::rename_environment(&state.paths, input) {
        Ok(environment) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "rename_environment",
                "completed",
                "Environment renamed",
                Some(environment.file_path.clone()),
            );
            Ok(environment)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "rename_environment",
                "failed",
                "Failed to rename environment",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn delete_environment(
    app: AppHandle,
    input: DeleteEnvironmentInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    match storage::delete_environment(&state.paths, input) {
        Ok(()) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "delete_environment",
                "completed",
                "Environment deleted",
                None,
            );
            Ok(())
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "delete_environment",
                "failed",
                "Failed to delete environment",
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
    let workspace_name = current_workspace_name(&state);
    match storage::save_request_in_workspace(&state.paths, &workspace_name, input) {
        Ok(collection) => {
            emit_bridge_event(
                &app,
                &state.paths,
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
                &state.paths,
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
pub fn create_collection(
    app: AppHandle,
    input: CreateCollectionInput,
    state: State<'_, AppState>,
) -> Result<CollectionSummary, String> {
    let workspace_name = current_workspace_name(&state);
    match storage::create_collection_in_workspace(&state.paths, &workspace_name, input) {
        Ok(collection) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "create_collection",
                "completed",
                "Collection created",
                Some(collection.file_path.clone()),
            );
            Ok(collection)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "create_collection",
                "failed",
                "Failed to create collection",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn rename_collection(
    app: AppHandle,
    input: RenameCollectionInput,
    state: State<'_, AppState>,
) -> Result<CollectionSummary, String> {
    let workspace_name = current_workspace_name(&state);
    match storage::rename_collection_in_workspace(&state.paths, &workspace_name, input) {
        Ok(collection) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "rename_collection",
                "completed",
                "Collection renamed",
                Some(collection.file_path.clone()),
            );
            Ok(collection)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "rename_collection",
                "failed",
                "Failed to rename collection",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn delete_collection(
    app: AppHandle,
    input: DeleteCollectionInput,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let workspace_name = current_workspace_name(&state);
    match storage::delete_collection_in_workspace(&state.paths, &workspace_name, input) {
        Ok(()) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "delete_collection",
                "completed",
                "Collection deleted",
                None,
            );
            Ok(())
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "delete_collection",
                "failed",
                "Failed to delete collection",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn delete_request(
    app: AppHandle,
    input: DeleteRequestInput,
    state: State<'_, AppState>,
) -> Result<CollectionSummary, String> {
    match storage::delete_request(&state.paths, input) {
        Ok(collection) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "delete_request",
                "completed",
                "Request deleted from collection",
                Some(collection.file_path.clone()),
            );
            Ok(collection)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "delete_request",
                "failed",
                "Failed to delete request",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn move_collection(
    app: AppHandle,
    input: MoveCollectionInput,
    state: State<'_, AppState>,
) -> Result<Vec<CollectionSummary>, String> {
    let workspace_name = current_workspace_name(&state);
    match storage::move_collection_in_workspace(&state.paths, &workspace_name, input) {
        Ok(collections) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "move_collection",
                "completed",
                "Collection order updated",
                Some(format!("{} collections", collections.len())),
            );
            Ok(collections)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "move_collection",
                "failed",
                "Failed to move collection",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn save_collection_organization(
    app: AppHandle,
    input: SaveCollectionOrganizationInput,
    state: State<'_, AppState>,
) -> Result<Vec<CollectionSummary>, String> {
    let workspace_name = current_workspace_name(&state);
    match storage::save_collection_organization_in_workspace(&state.paths, &workspace_name, input) {
        Ok(collections) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "save_collection_organization",
                "completed",
                "Collection organization saved",
                Some(format!("{} collections", collections.len())),
            );
            Ok(collections)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "save_collection_organization",
                "failed",
                "Failed to save collection organization",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn reorder_request(
    app: AppHandle,
    input: ReorderRequestInput,
    state: State<'_, AppState>,
) -> Result<CollectionSummary, String> {
    match storage::reorder_request(&state.paths, input) {
        Ok(collection) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "reorder_request",
                "completed",
                "Request order updated",
                Some(collection.file_path.clone()),
            );
            Ok(collection)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "reorder_request",
                "failed",
                "Failed to reorder request",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn move_request(
    app: AppHandle,
    input: MoveRequestInput,
    state: State<'_, AppState>,
) -> Result<MoveRequestResult, String> {
    match storage::move_request(&state.paths, input) {
        Ok(result) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "move_request",
                "completed",
                "Request moved between collections",
                Some(result.moved_request.collection_file.clone()),
            );
            Ok(result)
        }
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
                "move_request",
                "failed",
                "Failed to move request",
                Some(message.clone()),
            );
            Err(message)
        }
    }
}

#[tauri::command]
pub fn import_curl(
    app: AppHandle,
    input: CurlImportInput,
    state: State<'_, AppState>,
) -> Result<StoredRequest, String> {
    match curl::import_command(input) {
        Ok(request) => {
            emit_bridge_event(
                &app,
                &state.paths,
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
                &state.paths,
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
pub fn export_curl(
    app: AppHandle,
    input: CurlExportInput,
    state: State<'_, AppState>,
) -> Result<String, String> {
    match curl::export_command(input) {
        Ok(command) => {
            emit_bridge_event(
                &app,
                &state.paths,
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
                &state.paths,
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
    state: State<'_, AppState>,
) -> Result<Vec<StoredRequest>, String> {
    match postman::import_collection(input) {
        Ok(requests) => {
            emit_bridge_event(
                &app,
                &state.paths,
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
                &state.paths,
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
pub fn upload_file(
    app: AppHandle,
    input: FileUploadInput,
    state: State<'_, AppState>,
) -> Result<FileUploadResult, String> {
    match file_transfer::upload_file(input) {
        Ok(result) => {
            emit_bridge_event(
                &app,
                &state.paths,
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
                &state.paths,
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
    state: State<'_, AppState>,
) -> Result<FileDownloadResult, String> {
    match file_transfer::download_file(input) {
        Ok(result) => {
            emit_bridge_event(
                &app,
                &state.paths,
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
                &state.paths,
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
pub fn save_response_body(
    app: AppHandle,
    input: SaveResponseBodyInput,
    state: State<'_, AppState>,
) -> Result<SaveResponseBodyResult, String> {
    match file_transfer::save_response_body(input) {
        Ok(result) => {
            emit_bridge_event(
                &app,
                &state.paths,
                "save_response_body",
                "completed",
                "Response body saved",
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
                &state.paths,
                "save_response_body",
                "failed",
                "Failed to save response body",
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
        &state.paths,
        "send_request",
        "started",
        "HTTP request started",
        Some(format!("{} {}", input.method, input.url)),
    );

    let result = match http::execute_request(&state.paths, input.clone()) {
        Ok(result) => result,
        Err(error) => {
            let message = to_command_error(error);
            emit_bridge_event(
                &app,
                &state.paths,
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
            request_name: input.request_name,
            collection: input.collection,
            params: input.params,
            headers: input.headers,
            body: input.body,
            body_mode: input.body_mode,
            body_content_type: input.body_content_type,
            body_rows: input.body_rows,
            auth_type: input.auth_type,
            auth_token: input.auth_token,
            auth_basic_username: input.auth_basic_username,
            auth_basic_password: input.auth_basic_password,
            auth_api_key_name: input.auth_api_key_name,
            auth_api_key_value: input.auth_api_key_value,
            auth_api_key_in: input.auth_api_key_in,
            environment: input.environment,
        },
    ) {
        let message = to_command_error(error);
        emit_bridge_event(
            &app,
            &state.paths,
            "send_request",
            "failed",
            "HTTP response received but history recording failed",
            Some(message.clone()),
        );
        return Err(message);
    }

    emit_bridge_event(
        &app,
        &state.paths,
        "send_request",
        "completed",
        "HTTP request completed",
        Some(format!("{} in {}ms", result.status, result.duration_ms)),
    );

    Ok(result)
}
