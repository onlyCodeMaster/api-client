use tauri::State;
use crate::db::{Database, HistoryEntry, SettingEntry, CookieEntry, RecentEntry};
use crate::storage::{
    CollectionFile, EnvironmentFile, WorkspaceFile,
};
use crate::secrets;

// === History Commands ===

#[tauri::command]
pub fn save_history(db: State<Database>, entry: HistoryEntry) -> Result<(), String> {
    db.save_history(&entry)
}

#[tauri::command]
pub fn get_history(db: State<Database>, limit: usize, offset: usize) -> Result<Vec<HistoryEntry>, String> {
    db.get_history(limit, offset)
}

#[tauri::command]
pub fn delete_history(db: State<Database>, id: String) -> Result<(), String> {
    db.delete_history(&id)
}

#[tauri::command]
pub fn clear_history(db: State<Database>) -> Result<(), String> {
    db.clear_history()
}

#[tauri::command]
pub fn search_history(db: State<Database>, query: String) -> Result<Vec<HistoryEntry>, String> {
    db.search_history(&query)
}

// === Settings Commands ===

#[tauri::command]
pub fn set_setting(db: State<Database>, key: String, value: String) -> Result<(), String> {
    db.set_setting(&key, &value)
}

#[tauri::command]
pub fn get_setting(db: State<Database>, key: String) -> Result<Option<String>, String> {
    db.get_setting(&key)
}

#[tauri::command]
pub fn get_all_settings(db: State<Database>) -> Result<Vec<SettingEntry>, String> {
    db.get_all_settings()
}

#[tauri::command]
pub fn delete_setting(db: State<Database>, key: String) -> Result<(), String> {
    db.delete_setting(&key)
}

// === Cookie Commands ===

#[tauri::command]
pub fn save_cookie(db: State<Database>, cookie: CookieEntry) -> Result<(), String> {
    db.save_cookie(&cookie)
}

#[tauri::command]
pub fn get_cookies_by_domain(db: State<Database>, domain: String) -> Result<Vec<CookieEntry>, String> {
    db.get_cookies_by_domain(&domain)
}

#[tauri::command]
pub fn get_all_cookies(db: State<Database>) -> Result<Vec<CookieEntry>, String> {
    db.get_all_cookies()
}

#[tauri::command]
pub fn delete_cookie(db: State<Database>, id: String) -> Result<(), String> {
    db.delete_cookie(&id)
}

#[tauri::command]
pub fn clear_cookies_by_domain(db: State<Database>, domain: String) -> Result<(), String> {
    db.clear_cookies_by_domain(&domain)
}

// === Recent Opened Commands ===

#[tauri::command]
pub fn add_recent(db: State<Database>, entry: RecentEntry) -> Result<(), String> {
    db.add_recent(&entry)
}

#[tauri::command]
pub fn get_recent(db: State<Database>, limit: usize) -> Result<Vec<RecentEntry>, String> {
    db.get_recent(limit)
}

#[tauri::command]
pub fn clear_recent(db: State<Database>) -> Result<(), String> {
    db.clear_recent()
}

// === Collection Commands ===

#[tauri::command]
pub fn save_collection(collection: CollectionFile) -> Result<(), String> {
    crate::storage::save_collection(&collection)
}

#[tauri::command]
pub fn load_collection(id: String) -> Result<CollectionFile, String> {
    crate::storage::load_collection(&id)
}

#[tauri::command]
pub fn list_collections() -> Result<Vec<CollectionFile>, String> {
    crate::storage::list_collections()
}

#[tauri::command]
pub fn delete_collection(id: String) -> Result<(), String> {
    crate::storage::delete_collection(&id)
}

// === Environment Commands ===

#[tauri::command]
pub fn save_environment(env: EnvironmentFile) -> Result<(), String> {
    crate::storage::save_environment(&env)
}

#[tauri::command]
pub fn load_environment(id: String) -> Result<EnvironmentFile, String> {
    crate::storage::load_environment(&id)
}

#[tauri::command]
pub fn list_environments() -> Result<Vec<EnvironmentFile>, String> {
    crate::storage::list_environments()
}

#[tauri::command]
pub fn delete_environment(id: String) -> Result<(), String> {
    crate::storage::delete_environment(&id)
}

// === Workspace Commands ===

#[tauri::command]
pub fn save_workspace(workspace: WorkspaceFile) -> Result<(), String> {
    crate::storage::save_workspace(&workspace)
}

#[tauri::command]
pub fn load_workspace(id: String) -> Result<WorkspaceFile, String> {
    crate::storage::load_workspace(&id)
}

#[tauri::command]
pub fn load_default_workspace() -> Result<WorkspaceFile, String> {
    crate::storage::load_default_workspace()
}

// === Secret / Keychain Commands ===

#[tauri::command]
pub fn store_secret(key: String, value: String) -> Result<(), String> {
    secrets::store_secret(&key, &value)
}

#[tauri::command]
pub fn get_secret(key: String) -> Result<Option<String>, String> {
    secrets::get_secret(&key)
}

#[tauri::command]
pub fn delete_secret(key: String) -> Result<(), String> {
    secrets::delete_secret(&key)
}

#[tauri::command]
pub fn store_env_secret(env_id: String, var_key: String, value: String) -> Result<(), String> {
    secrets::store_env_secret(&env_id, &var_key, &value)
}

#[tauri::command]
pub fn get_env_secret(env_id: String, var_key: String) -> Result<Option<String>, String> {
    secrets::get_env_secret(&env_id, &var_key)
}

#[tauri::command]
pub fn delete_env_secret(env_id: String, var_key: String) -> Result<(), String> {
    secrets::delete_env_secret(&env_id, &var_key)
}

#[tauri::command]
pub fn store_auth_secret(scope_id: String, auth_key: String, value: String) -> Result<(), String> {
    secrets::store_auth_secret(&scope_id, &auth_key, &value)
}

#[tauri::command]
pub fn get_auth_secret(scope_id: String, auth_key: String) -> Result<Option<String>, String> {
    secrets::get_auth_secret(&scope_id, &auth_key)
}

#[tauri::command]
pub fn delete_auth_secret(scope_id: String, auth_key: String) -> Result<(), String> {
    secrets::delete_auth_secret(&scope_id, &auth_key)
}
