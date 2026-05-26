use std::sync::Arc;
use tauri::State;
use crate::db::{Database, HistoryEntry, SettingEntry, CookieEntry, RecentEntry};
use crate::storage::{
    CollectionFile, EnvironmentFile, WorkspaceFile,
};
use crate::secrets;
use crate::AppCookies;

// === History Commands ===

#[tauri::command]
pub fn save_history(db: State<Database>, entry: HistoryEntry) -> Result<(), String> {
    db.save_history(&entry)
}

#[tauri::command]
pub fn get_history(
    db: State<Database>,
    workspace_id: Option<String>,
    limit: usize,
    offset: usize,
) -> Result<Vec<HistoryEntry>, String> {
    db.get_history(workspace_id.as_deref(), limit, offset)
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
pub fn search_history(
    db: State<Database>,
    workspace_id: Option<String>,
    query: String,
) -> Result<Vec<HistoryEntry>, String> {
    db.search_history(workspace_id.as_deref(), &query)
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
pub fn delete_cookie(
    db: State<Database>,
    cookies: State<Arc<AppCookies>>,
    id: String,
) -> Result<(), String> {
    db.delete_cookie(&id)?;
    // SQLite is now the source of truth — rebuild the in-memory jar so the
    // deleted cookie isn't sent on the next request.
    cookies.rebuild_from_db(&db);
    Ok(())
}

#[tauri::command]
pub fn clear_cookies_by_domain(
    db: State<Database>,
    cookies: State<Arc<AppCookies>>,
    domain: String,
) -> Result<(), String> {
    db.clear_cookies_by_domain(&domain)?;
    cookies.rebuild_from_db(&db);
    Ok(())
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
pub fn list_collections(workspace_id: Option<String>) -> Result<Vec<CollectionFile>, String> {
    crate::storage::list_collections(workspace_id.as_deref())
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
pub fn list_environments(workspace_id: Option<String>) -> Result<Vec<EnvironmentFile>, String> {
    crate::storage::list_environments(workspace_id.as_deref())
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

#[tauri::command]
pub fn list_workspaces() -> Result<Vec<WorkspaceFile>, String> {
    crate::storage::list_workspaces()
}

#[tauri::command]
pub fn create_workspace(name: String) -> Result<WorkspaceFile, String> {
    crate::storage::create_workspace(&name)
}

/// Cascade-delete a workspace: removes its collections, environments and
/// SQLite history rows, then deletes the workspace file. Returns the IDs of
/// the deleted artifacts so the frontend can also drop them from its store.
#[tauri::command]
pub fn delete_workspace(
    db: State<Database>,
    id: String,
) -> Result<crate::storage::DeletedWorkspaceArtifacts, String> {
    let artifacts = crate::storage::delete_workspace(&id)?;
    db.delete_workspace_history(&id)?;
    Ok(artifacts)
}

/// Run once at startup: stamp every legacy unscoped collection /
/// environment / history row with the default workspace id so they appear in
/// exactly one workspace going forward.
#[tauri::command]
pub fn migrate_legacy_to_workspace(
    db: State<Database>,
    workspace_id: String,
) -> Result<usize, String> {
    let storage_count = crate::storage::migrate_legacy_to_workspace(&workspace_id)?;
    let history_count = db.migrate_legacy_history_to_workspace(&workspace_id)?;
    Ok(storage_count + history_count)
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
