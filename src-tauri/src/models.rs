use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub app_data_dir: String,
    pub database_path: String,
    pub workspaces_dir: String,
    pub collections_dir: String,
    pub environments_dir: String,
    pub cache_dir: String,
    pub logs_dir: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    pub recent_workspace: String,
    pub auto_save: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryEntry {
    pub id: i64,
    pub request_id: String,
    pub method: String,
    pub url: String,
    pub status: String,
    pub duration_ms: i64,
    pub created_at: String,
    pub request_name: String,
    pub collection: String,
    pub body: String,
    pub body_mode: String,
    pub body_content_type: String,
    pub body_rows: Vec<RequestBodyRow>,
    pub auth_type: String,
    pub auth_token: String,
    pub environment_name: String,
    pub environment_source: String,
    pub params: Vec<RequestKeyValue>,
    pub headers: Vec<RequestKeyValue>,
    pub environment_vars: Vec<EnvironmentVariable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentSummary {
    pub name: String,
    pub file_path: String,
    pub vars: Vec<EnvironmentVariable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentVariable {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretStatus {
    pub name: String,
    pub exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BridgeEvent {
    pub id: String,
    pub command: String,
    pub phase: String,
    pub message: String,
    pub timestamp: String,
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSummary {
    pub cache: CacheSummary,
    pub logs: LogSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheSummary {
    pub directory: String,
    pub index_file: String,
    pub entries: usize,
    pub size_bytes: u64,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogSummary {
    pub directory: String,
    pub active_file: String,
    pub size_bytes: u64,
    pub last_line: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapState {
    pub paths: AppPaths,
    pub settings: AppSettings,
    pub runtime: RuntimeSummary,
    pub history: Vec<HistoryEntry>,
    pub collections: Vec<CollectionSummary>,
    pub environments: Vec<EnvironmentSummary>,
    pub secrets: Vec<SecretStatus>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSummary {
    pub name: String,
    pub file_path: String,
    pub requests: Vec<StoredRequest>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordHistoryInput {
    pub request_id: String,
    pub method: String,
    pub url: String,
    pub status: String,
    pub duration_ms: i64,
    pub request_name: String,
    pub collection: String,
    pub params: Vec<RequestKeyValue>,
    pub headers: Vec<RequestKeyValue>,
    pub body: String,
    pub body_mode: String,
    pub body_content_type: String,
    pub body_rows: Vec<RequestBodyRow>,
    pub auth_type: String,
    pub auth_token: String,
    pub environment: EnvironmentSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveSecretInput {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEnvironmentInput {
    pub name: String,
    pub file_path: String,
    pub vars: Vec<EnvironmentVariable>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameEnvironmentInput {
    pub current_file_path: String,
    pub new_name: String,
    pub new_file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteEnvironmentInput {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveRequestInput {
    pub id: String,
    pub name: String,
    pub collection: String,
    pub collection_file: String,
    pub method: String,
    pub url: String,
    pub params: Vec<RequestKeyValue>,
    pub headers: Vec<RequestKeyValue>,
    pub body: String,
    pub body_mode: String,
    pub body_content_type: String,
    pub body_rows: Vec<RequestBodyRow>,
    pub auth_type: String,
    pub auth_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCollectionInput {
    pub name: String,
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenameCollectionInput {
    pub current_file_path: String,
    pub new_name: String,
    pub new_file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteCollectionInput {
    pub file_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteRequestInput {
    pub request_id: String,
    pub collection_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveCollectionInput {
    pub file_path: String,
    pub target_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReorderRequestInput {
    pub collection_file: String,
    pub request_id: String,
    pub target_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRequestInput {
    pub request_id: String,
    pub source_collection_file: String,
    pub target_collection_file: String,
    pub target_index: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MoveRequestResult {
    pub source_collection: CollectionSummary,
    pub target_collection: CollectionSummary,
    pub moved_request: StoredRequest,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurlImportInput {
    pub command: String,
    pub request_id: String,
    pub collection: String,
    pub collection_file: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurlExportInput {
    pub method: String,
    pub url: String,
    pub params: Vec<RequestKeyValue>,
    pub headers: Vec<RequestKeyValue>,
    pub body: String,
    pub body_mode: String,
    pub body_content_type: String,
    pub body_rows: Vec<RequestBodyRow>,
    pub auth_type: String,
    pub auth_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PostmanImportInput {
    pub collection: String,
    pub collection_file: String,
    pub collection_json: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadInput {
    pub url: String,
    pub file_path: String,
    pub field_name: String,
    pub headers: Vec<RequestKeyValue>,
    pub environment: EnvironmentSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileUploadResult {
    pub status: String,
    pub duration_ms: i64,
    pub size_bytes: u64,
    pub file_name: String,
    pub response_body: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDownloadInput {
    pub url: String,
    pub destination_path: String,
    pub overwrite: bool,
    pub headers: Vec<RequestKeyValue>,
    pub environment: EnvironmentSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDownloadResult {
    pub status: String,
    pub duration_ms: i64,
    pub size_bytes: u64,
    pub destination_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequestInput {
    pub request_id: String,
    pub request_name: String,
    pub collection: String,
    pub method: String,
    pub url: String,
    pub params: Vec<RequestKeyValue>,
    pub headers: Vec<RequestKeyValue>,
    pub body: String,
    pub body_mode: String,
    pub body_content_type: String,
    pub body_rows: Vec<RequestBodyRow>,
    pub auth_type: String,
    pub auth_token: String,
    pub environment: EnvironmentSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RequestKeyValue {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct RequestBodyRow {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    pub field_type: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredRequest {
    pub id: String,
    pub name: String,
    pub collection: String,
    pub collection_file: String,
    pub method: String,
    pub url: String,
    pub params: Vec<RequestKeyValue>,
    pub headers: Vec<RequestKeyValue>,
    pub body: String,
    pub body_mode: String,
    pub body_content_type: String,
    pub body_rows: Vec<RequestBodyRow>,
    pub auth_type: String,
    pub auth_token: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendRequestResult {
    pub status: String,
    pub duration_ms: i64,
    pub size_bytes: usize,
    pub protocol: String,
    pub body: String,
    pub headers: Vec<ResponseHeader>,
    pub timeline: Vec<ResponseTimelineItem>,
    pub summary: ResponseSummary,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseHeader {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseTimelineItem {
    pub step: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseSummary {
    pub cookie_jar: String,
    pub secret_source: String,
    pub collection_file: String,
}
