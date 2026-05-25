use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

const APP_DIR_NAME: &str = "com.apiclient.dev";

pub fn app_data_dir() -> Result<PathBuf, String> {
    let base = dirs::data_dir()
        .ok_or_else(|| "Failed to get data directory".to_string())?;
    Ok(base.join(APP_DIR_NAME))
}

fn collections_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("collections");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create collections dir: {}", e))?;
    Ok(dir)
}

fn environments_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("environments");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create environments dir: {}", e))?;
    Ok(dir)
}

fn workspace_dir() -> Result<PathBuf, String> {
    let dir = app_data_dir()?.join("workspaces");
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create workspaces dir: {}", e))?;
    Ok(dir)
}

// === Collection Types ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionKeyValue {
    pub id: String,
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionRequest {
    pub id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: Vec<CollectionKeyValue>,
    pub params: Vec<CollectionKeyValue>,
    pub body: String,
    pub body_type: String,
    pub auth: Option<AuthConfig>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionFolder {
    pub id: String,
    pub name: String,
    pub requests: Vec<CollectionRequest>,
    pub folders: Vec<CollectionFolder>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CollectionFile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub auth: Option<AuthConfig>,
    pub requests: Vec<CollectionRequest>,
    pub folders: Vec<CollectionFolder>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuthConfig {
    pub auth_type: String, // "none" | "bearer" | "basic" | "api_key"
    pub bearer_token: Option<String>,
    pub basic_username: Option<String>,
    pub basic_password: Option<String>,
    pub api_key_key: Option<String>,
    pub api_key_value: Option<String>,
    pub api_key_in: Option<String>, // "header" | "query"
}

// === Environment Types ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvVariable {
    pub key: String,
    pub value: String,
    pub enabled: bool,
    pub is_secret: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct EnvironmentFile {
    pub id: String,
    pub name: String,
    pub variables: Vec<EnvVariable>,
    pub created_at: i64,
    pub updated_at: i64,
}

// === Workspace Types ===

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WorkspaceFile {
    pub id: String,
    pub name: String,
    pub active_environment_id: Option<String>,
    pub active_collection_id: Option<String>,
    pub active_request_id: Option<String>,
    pub window_state: Option<WindowState>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct WindowState {
    pub sidebar_width: Option<f64>,
    pub request_panel_height: Option<f64>,
    pub sidebar_tab: Option<String>,
}

// === Collection CRUD ===

pub fn save_collection(collection: &CollectionFile) -> Result<(), String> {
    let dir = collections_dir()?;
    let file_path = dir.join(format!("{}.json", collection.id));
    let json = serde_json::to_string_pretty(collection)
        .map_err(|e| format!("Failed to serialize collection: {}", e))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write collection file: {}", e))?;
    Ok(())
}

pub fn load_collection(id: &str) -> Result<CollectionFile, String> {
    let dir = collections_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read collection file: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse collection: {}", e))
}

pub fn list_collections() -> Result<Vec<CollectionFile>, String> {
    let dir = collections_dir()?;
    let mut collections = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read collections dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            if let Ok(collection) = serde_json::from_str::<CollectionFile>(&content) {
                collections.push(collection);
            }
        }
    }

    collections.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
    Ok(collections)
}

pub fn delete_collection(id: &str) -> Result<(), String> {
    let dir = collections_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete collection: {}", e))?;
    }
    Ok(())
}

// === Environment CRUD ===

pub fn save_environment(env: &EnvironmentFile) -> Result<(), String> {
    let dir = environments_dir()?;
    let file_path = dir.join(format!("{}.json", env.id));
    let json = serde_json::to_string_pretty(env)
        .map_err(|e| format!("Failed to serialize environment: {}", e))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write environment file: {}", e))?;
    Ok(())
}

pub fn load_environment(id: &str) -> Result<EnvironmentFile, String> {
    let dir = environments_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read environment file: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse environment: {}", e))
}

pub fn list_environments() -> Result<Vec<EnvironmentFile>, String> {
    let dir = environments_dir()?;
    let mut environments = Vec::new();

    let entries = fs::read_dir(&dir)
        .map_err(|e| format!("Failed to read environments dir: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read file: {}", e))?;
            if let Ok(env) = serde_json::from_str::<EnvironmentFile>(&content) {
                environments.push(env);
            }
        }
    }

    environments.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(environments)
}

pub fn delete_environment(id: &str) -> Result<(), String> {
    let dir = environments_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to delete environment: {}", e))?;
    }
    Ok(())
}

// === Workspace CRUD ===

pub fn save_workspace(workspace: &WorkspaceFile) -> Result<(), String> {
    let dir = workspace_dir()?;
    let file_path = dir.join(format!("{}.json", workspace.id));
    let json = serde_json::to_string_pretty(workspace)
        .map_err(|e| format!("Failed to serialize workspace: {}", e))?;
    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write workspace file: {}", e))?;
    Ok(())
}

pub fn load_workspace(id: &str) -> Result<WorkspaceFile, String> {
    let dir = workspace_dir()?;
    let file_path = dir.join(format!("{}.json", id));
    let content = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read workspace file: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse workspace: {}", e))
}

pub fn load_default_workspace() -> Result<WorkspaceFile, String> {
    let dir = workspace_dir()?;

    // Try to find existing workspace
    if let Ok(entries) = fs::read_dir(&dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                let content = fs::read_to_string(&path).ok();
                if let Some(content) = content {
                    if let Ok(ws) = serde_json::from_str::<WorkspaceFile>(&content) {
                        return Ok(ws);
                    }
                }
            }
        }
    }

    // Create default workspace
    let now = chrono::Utc::now().timestamp_millis();
    let workspace = WorkspaceFile {
        id: uuid::Uuid::new_v4().to_string(),
        name: "Default Workspace".to_string(),
        active_environment_id: None,
        active_collection_id: None,
        active_request_id: None,
        window_state: None,
        created_at: now,
        updated_at: now,
    };
    save_workspace(&workspace)?;
    Ok(workspace)
}
