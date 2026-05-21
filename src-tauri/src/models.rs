use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppPaths {
    pub app_data_dir: String,
    pub database_path: String,
    pub workspaces_dir: String,
    pub collections_dir: String,
    pub environments_dir: String,
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
pub struct BootstrapState {
    pub paths: AppPaths,
    pub settings: AppSettings,
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
    pub auth_type: String,
    pub auth_token: String,
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
pub struct SendRequestInput {
    pub request_id: String,
    pub request_name: String,
    pub collection: String,
    pub method: String,
    pub url: String,
    pub params: Vec<RequestKeyValue>,
    pub headers: Vec<RequestKeyValue>,
    pub body: String,
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
