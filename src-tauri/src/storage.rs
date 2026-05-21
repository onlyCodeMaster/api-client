use std::fs;
use std::path::{Path, PathBuf};

use rusqlite::{params, Connection};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::models::{
    AppPaths, AppSettings, CollectionSummary, EnvironmentSummary, EnvironmentVariable,
    HistoryEntry, RecordHistoryInput, SaveEnvironmentInput, SaveRequestInput, StoredRequest,
};

const DEFAULT_SETTINGS_THEME: &str = "clay-light";
const DEFAULT_SETTINGS_WORKSPACE: &str = "default-workspace";

#[derive(Debug, Clone)]
pub struct StoragePaths {
    pub app_data_dir: PathBuf,
    pub database_path: PathBuf,
    pub workspaces_dir: PathBuf,
    pub collections_dir: PathBuf,
    pub environments_dir: PathBuf,
}

impl StoragePaths {
    pub fn resolve(app: &AppHandle) -> AppResult<Self> {
        let app_data_dir = app
            .path()
            .app_data_dir()
            .map_err(|_| AppError::MissingPath("app_data_dir"))?;
        let workspaces_dir = app_data_dir.join("workspaces");
        let collections_dir = app_data_dir.join("collections");
        let environments_dir = app_data_dir.join("environments");
        let database_path = app_data_dir.join("api-client.sqlite3");

        Ok(Self {
            app_data_dir,
            database_path,
            workspaces_dir,
            collections_dir,
            environments_dir,
        })
    }

    pub fn to_model(&self) -> AppPaths {
        AppPaths {
            app_data_dir: self.app_data_dir.to_string_lossy().into_owned(),
            database_path: self.database_path.to_string_lossy().into_owned(),
            workspaces_dir: self.workspaces_dir.to_string_lossy().into_owned(),
            collections_dir: self.collections_dir.to_string_lossy().into_owned(),
            environments_dir: self.environments_dir.to_string_lossy().into_owned(),
        }
    }
}

pub fn initialize(app: &AppHandle) -> AppResult<StoragePaths> {
    let paths = StoragePaths::resolve(app)?;
    ensure_directories(&paths)?;
    ensure_seed_files(&paths)?;
    initialize_database(&paths.database_path)?;
    Ok(paths)
}

fn ensure_directories(paths: &StoragePaths) -> AppResult<()> {
    fs::create_dir_all(&paths.app_data_dir)?;
    fs::create_dir_all(&paths.workspaces_dir)?;
    fs::create_dir_all(&paths.collections_dir)?;
    fs::create_dir_all(&paths.environments_dir)?;
    Ok(())
}

fn ensure_seed_files(paths: &StoragePaths) -> AppResult<()> {
    let workspace_file = paths.workspaces_dir.join("default-workspace.json");
    let collection_file = paths.collections_dir.join("core-api.json");
    let environment_file = paths.environments_dir.join("production.json");

    write_if_missing(
        &workspace_file,
        r#"{
  "name": "Default Workspace",
  "collections": ["core-api.json"],
  "environments": ["production.json"]
}
"#,
    )?;
    write_if_missing(
        &collection_file,
        r#"{
  "name": "Core API",
  "requests": [
    {
      "id": "req-workspaces",
      "name": "GET /workspaces",
      "method": "GET",
      "url": "https://api.example.com/v1/workspaces",
      "params": [
        { "key": "page", "value": "1", "enabled": true },
        { "key": "limit", "value": "20", "enabled": true },
        { "key": "include", "value": "details,owner", "enabled": true }
      ],
      "headers": [
        { "key": "Accept", "value": "application/json", "enabled": true },
        { "key": "Authorization", "value": "Bearer {{secret.prod_token}}", "enabled": true },
        { "key": "X-Workspace-Trace", "value": "req_live_4021", "enabled": true }
      ],
      "body": "",
      "authType": "bearer",
      "authToken": "{{secret.prod_token}}"
    },
    {
      "id": "req-search",
      "name": "POST /workspaces/search",
      "method": "POST",
      "url": "https://api.example.com/v1/workspaces/search",
      "params": [
        { "key": "query", "value": "workspace", "enabled": true },
        { "key": "limit", "value": "20", "enabled": true }
      ],
      "headers": [
        { "key": "Accept", "value": "application/json", "enabled": true },
        { "key": "Authorization", "value": "Bearer {{secret.prod_token}}", "enabled": true },
        { "key": "Content-Type", "value": "application/json", "enabled": true },
        { "key": "Cookie", "value": "workspace_session=auto", "enabled": true }
      ],
      "body": "{\n  \"query\": \"workspace\",\n  \"limit\": 20,\n  \"include\": [\"details\", \"owner\"],\n  \"filters\": {\n    \"region\": \"apac\",\n    \"status\": \"active\"\n  },\n  \"preview\": true\n}",
      "authType": "bearer",
      "authToken": "{{secret.prod_token}}"
    }
  ]
}
"#,
    )?;
    let auth_collection_file = paths.collections_dir.join("auth.json");
    write_if_missing(
        &auth_collection_file,
        r#"{
  "name": "Auth",
  "requests": [
    {
      "id": "req-login",
      "name": "POST /login",
      "method": "POST",
      "url": "https://api.example.com/v1/login",
      "params": [],
      "headers": [
        { "key": "Accept", "value": "application/json", "enabled": true },
        { "key": "Content-Type", "value": "application/json", "enabled": true }
      ],
      "body": "{\n  \"email\": \"dev@example.com\",\n  \"password\": \"••••••••\"\n}",
      "authType": "none",
      "authToken": ""
    }
  ]
}
"#,
    )?;
    write_if_missing(
        &environment_file,
        r#"{
  "name": "Production",
  "base_url": "https://api.example.com",
  "auth_token": "{{secret.prod_token}}"
}
"#,
    )?;

    Ok(())
}

fn write_if_missing(path: &Path, contents: &str) -> AppResult<()> {
    if !path.exists() {
        fs::write(path, contents)?;
    }
    Ok(())
}

fn initialize_database(database_path: &Path) -> AppResult<()> {
    let connection = Connection::open(database_path)?;
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS request_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            request_id TEXT NOT NULL DEFAULT '',
            method TEXT NOT NULL,
            url TEXT NOT NULL,
            status TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS cookie_jars (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            jar_name TEXT NOT NULL,
            domain TEXT NOT NULL,
            cookie_json TEXT NOT NULL,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );
        "#,
    )?;

    connection.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        params!["theme", DEFAULT_SETTINGS_THEME],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        params!["recent_workspace", DEFAULT_SETTINGS_WORKSPACE],
    )?;
    connection.execute(
        "INSERT OR IGNORE INTO settings (key, value) VALUES (?1, ?2)",
        params!["auto_save", "true"],
    )?;

    ensure_history_schema(&connection)?;

    Ok(())
}

fn ensure_history_schema(connection: &Connection) -> AppResult<()> {
    let mut statement = connection.prepare("PRAGMA table_info(request_history)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<Vec<_>, _>>()?;

    if !columns.iter().any(|column| column == "request_id") {
        connection.execute(
            "ALTER TABLE request_history ADD COLUMN request_id TEXT NOT NULL DEFAULT ''",
            [],
        )?;
    }

    Ok(())
}

fn open_connection(database_path: &Path) -> AppResult<Connection> {
    Ok(Connection::open(database_path)?)
}

pub fn load_settings(paths: &StoragePaths) -> AppResult<AppSettings> {
    let connection = open_connection(&paths.database_path)?;
    let theme = read_setting(&connection, "theme", DEFAULT_SETTINGS_THEME)?;
    let recent_workspace =
        read_setting(&connection, "recent_workspace", DEFAULT_SETTINGS_WORKSPACE)?;
    let auto_save = read_setting(&connection, "auto_save", "true")? == "true";

    Ok(AppSettings {
        theme,
        recent_workspace,
        auto_save,
    })
}

fn read_setting(connection: &Connection, key: &str, fallback: &str) -> AppResult<String> {
    let mut statement = connection.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let result = statement.query_row(params![key], |row| row.get::<_, String>(0));

    match result {
        Ok(value) => Ok(value),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(fallback.to_owned()),
        Err(error) => Err(error.into()),
    }
}

pub fn list_history(paths: &StoragePaths) -> AppResult<Vec<HistoryEntry>> {
    let connection = open_connection(&paths.database_path)?;
    let mut statement = connection.prepare(
        r#"
        SELECT id, request_id, method, url, status, duration_ms, created_at
        FROM request_history
        ORDER BY id DESC
        LIMIT 20
        "#,
    )?;

    let rows = statement.query_map([], |row| {
        Ok(HistoryEntry {
            id: row.get(0)?,
            request_id: row.get(1)?,
            method: row.get(2)?,
            url: row.get(3)?,
            status: row.get(4)?,
            duration_ms: row.get(5)?,
            created_at: row.get(6)?,
        })
    })?;

    let history = rows.collect::<Result<Vec<_>, _>>()?;
    Ok(history)
}

pub fn record_history(
    paths: &StoragePaths,
    input: RecordHistoryInput,
) -> AppResult<Vec<HistoryEntry>> {
    let connection = open_connection(&paths.database_path)?;
    connection.execute(
        r#"
        INSERT INTO request_history (request_id, method, url, status, duration_ms)
        VALUES (?1, ?2, ?3, ?4, ?5)
        "#,
        params![
            input.request_id,
            input.method,
            input.url,
            input.status,
            input.duration_ms
        ],
    )?;

    list_history(paths)
}

pub fn list_environments(paths: &StoragePaths) -> AppResult<Vec<EnvironmentSummary>> {
    let mut environments = Vec::new();
    for entry in fs::read_dir(&paths.environments_dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.is_file() {
            environments.push(read_environment_file(&path)?);
        }
    }
    environments.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(environments)
}

pub fn list_collections(
    paths: &StoragePaths,
    workspace_name: &str,
) -> AppResult<Vec<CollectionSummary>> {
    let workspace = read_workspace_file(paths, workspace_name)?;
    let mut collections = Vec::new();

    for file_name in workspace.collections {
        let path = paths.collections_dir.join(file_name);
        collections.push(read_collection_file(&path)?);
    }

    collections.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(collections)
}

pub fn save_environment(
    paths: &StoragePaths,
    input: SaveEnvironmentInput,
) -> AppResult<EnvironmentSummary> {
    let file_path = resolve_storage_path(&paths.environments_dir, &input.file_path);

    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut payload = Map::new();
    payload.insert("name".to_string(), Value::String(input.name.clone()));
    for item in &input.vars {
        payload.insert(item.key.clone(), Value::String(item.value.clone()));
    }

    let formatted = serde_json::to_string_pretty(&Value::Object(payload))
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    fs::write(&file_path, format!("{formatted}\n"))?;

    read_environment_file(&file_path)
}

pub fn save_request(paths: &StoragePaths, input: SaveRequestInput) -> AppResult<CollectionSummary> {
    let file_path = resolve_storage_path(&paths.collections_dir, &input.collection_file);

    let mut collection = read_collection_file(&file_path)?;
    let stored_request = StoredRequest {
        id: input.id,
        name: input.name,
        collection: input.collection,
        collection_file: file_path.to_string_lossy().into_owned(),
        method: input.method,
        url: input.url,
        params: input.params,
        headers: input.headers,
        body: input.body,
        auth_type: input.auth_type,
        auth_token: input.auth_token,
    };

    if let Some(position) = collection
        .requests
        .iter()
        .position(|request| request.id == stored_request.id)
    {
        collection.requests[position] = stored_request;
    } else {
        collection.requests.push(stored_request);
    }

    let payload = serde_json::to_string_pretty(&serde_json::json!({
        "name": collection.name,
        "requests": collection.requests,
    }))
    .map_err(|error| AppError::InvalidData(error.to_string()))?;
    fs::write(&file_path, format!("{payload}\n"))?;

    read_collection_file(&file_path)
}

fn resolve_storage_path(root: &Path, raw_path: &str) -> PathBuf {
    let requested_path = PathBuf::from(raw_path);
    if requested_path.is_absolute() {
        return requested_path;
    }

    let normalized = requested_path
        .strip_prefix("collections")
        .or_else(|_| requested_path.strip_prefix("environments"))
        .map(PathBuf::from)
        .unwrap_or(requested_path);

    root.join(normalized)
}

fn read_workspace_file(paths: &StoragePaths, workspace_name: &str) -> AppResult<WorkspaceFile> {
    let file_name = if workspace_name.ends_with(".json") {
        workspace_name.to_string()
    } else {
        format!("{workspace_name}.json")
    };
    let path = paths.workspaces_dir.join(file_name);
    let contents = fs::read_to_string(path)?;
    serde_json::from_str(&contents).map_err(|error| AppError::InvalidData(error.to_string()))
}

fn read_collection_file(path: &Path) -> AppResult<CollectionSummary> {
    let contents = fs::read_to_string(path)?;
    let parsed: CollectionFile = serde_json::from_str(&contents)
        .map_err(|error| AppError::InvalidData(error.to_string()))?;

    let file_path = path.to_string_lossy().into_owned();
    let requests = parsed
        .requests
        .into_iter()
        .map(|request| StoredRequest {
            id: request.id,
            name: request.name,
            collection: parsed.name.clone(),
            collection_file: file_path.clone(),
            method: request.method,
            url: request.url,
            params: request.params,
            headers: request.headers,
            body: request.body,
            auth_type: request.auth_type,
            auth_token: request.auth_token,
        })
        .collect();

    Ok(CollectionSummary {
        name: parsed.name,
        file_path,
        requests,
    })
}

fn read_environment_file(path: &Path) -> AppResult<EnvironmentSummary> {
    let contents = fs::read_to_string(path)?;
    let parsed: Value = serde_json::from_str(&contents)
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    let object = parsed.as_object().ok_or_else(|| {
        AppError::InvalidData(format!(
            "environment file is not an object: {}",
            path.display()
        ))
    })?;

    let name = object
        .get("name")
        .and_then(Value::as_str)
        .map(ToOwned::to_owned)
        .or_else(|| {
            path.file_stem()
                .map(|value| value.to_string_lossy().into_owned())
        })
        .unwrap_or_else(|| "unknown".to_string());

    let mut vars = object
        .iter()
        .filter_map(|(key, value)| {
            if key == "name" {
                return None;
            }

            let value_string = match value {
                Value::String(inner) => inner.clone(),
                _ => value.to_string(),
            };

            Some(EnvironmentVariable {
                key: key.clone(),
                value: value_string,
            })
        })
        .collect::<Vec<_>>();

    vars.sort_by(|left, right| left.key.cmp(&right.key));

    Ok(EnvironmentSummary {
        name,
        file_path: path.to_string_lossy().into_owned(),
        vars,
    })
}

#[derive(serde::Deserialize)]
struct WorkspaceFile {
    collections: Vec<String>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectionFile {
    name: String,
    requests: Vec<CollectionFileRequest>,
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct CollectionFileRequest {
    id: String,
    name: String,
    method: String,
    url: String,
    #[serde(default)]
    params: Vec<crate::models::RequestKeyValue>,
    #[serde(default)]
    headers: Vec<crate::models::RequestKeyValue>,
    #[serde(default)]
    body: String,
    auth_type: String,
    auth_token: String,
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::*;

    fn make_test_paths(label: &str) -> StoragePaths {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time before unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("api-client-{label}-{nonce}"));

        fs::create_dir_all(root.join("workspaces")).expect("create workspaces dir");
        fs::create_dir_all(root.join("collections")).expect("create collections dir");
        fs::create_dir_all(root.join("environments")).expect("create environments dir");

        StoragePaths {
            app_data_dir: root.clone(),
            database_path: root.join("api-client.sqlite3"),
            workspaces_dir: root.join("workspaces"),
            collections_dir: root.join("collections"),
            environments_dir: root.join("environments"),
        }
    }

    #[test]
    fn record_history_persists_request_id() {
        let paths = make_test_paths("history-record");
        initialize_database(&paths.database_path).expect("initialize database");

        record_history(
            &paths,
            RecordHistoryInput {
                request_id: "req-search".to_string(),
                method: "POST".to_string(),
                url: "https://api.example.com/v1/workspaces/search".to_string(),
                status: "200 OK".to_string(),
                duration_ms: 182,
            },
        )
        .expect("record history");

        let history = list_history(&paths).expect("list history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].request_id, "req-search");
        assert_eq!(history[0].method, "POST");
    }

    #[test]
    fn initialize_database_migrates_history_table_with_request_id() {
        let paths = make_test_paths("history-migration");
        let connection = Connection::open(&paths.database_path).expect("open sqlite");

        connection
            .execute_batch(
                r#"
                CREATE TABLE request_history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    method TEXT NOT NULL,
                    url TEXT NOT NULL,
                    status TEXT NOT NULL,
                    duration_ms INTEGER NOT NULL,
                    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
                );
                "#,
            )
            .expect("create legacy request_history");

        drop(connection);

        initialize_database(&paths.database_path).expect("initialize database");

        let connection = Connection::open(&paths.database_path).expect("reopen sqlite");
        let mut statement = connection
            .prepare("PRAGMA table_info(request_history)")
            .expect("prepare pragma");
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .expect("query pragma")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect pragma");

        assert!(columns.iter().any(|column| column == "request_id"));
    }

    #[test]
    fn list_collections_and_save_request_persist_workspace_backed_requests() {
        let paths = make_test_paths("collections-save");

        let workspace_file = paths.workspaces_dir.join("default-workspace.json");
        let collection_file = paths.collections_dir.join("core-api.json");

        fs::write(
            &workspace_file,
            r#"{
  "name": "Default Workspace",
  "collections": ["core-api.json"]
}
"#,
        )
        .expect("write workspace file");

        fs::write(
            &collection_file,
            r#"{
  "name": "Core API",
  "requests": [
    {
      "id": "req-one",
      "name": "GET /hello",
      "method": "GET",
      "url": "http://localhost:3000/hello",
      "params": [],
      "headers": [],
      "body": "",
      "authType": "none",
      "authToken": ""
    }
  ]
}
"#,
        )
        .expect("write collection file");

        let collections =
            list_collections(&paths, "default-workspace").expect("list workspace collections");
        assert_eq!(collections.len(), 1);
        assert_eq!(collections[0].name, "Core API");
        assert_eq!(collections[0].requests.len(), 1);
        assert_eq!(collections[0].requests[0].collection, "Core API");

        let saved = save_request(
            &paths,
            SaveRequestInput {
                id: "req-one".to_string(),
                name: "GET /hello".to_string(),
                collection: "Core API".to_string(),
                collection_file: "core-api.json".to_string(),
                method: "GET".to_string(),
                url: "http://localhost:3000/hello-updated".to_string(),
                params: vec![crate::models::RequestKeyValue {
                    key: "page".to_string(),
                    value: "2".to_string(),
                    enabled: true,
                }],
                headers: vec![crate::models::RequestKeyValue {
                    key: "Accept".to_string(),
                    value: "application/json".to_string(),
                    enabled: true,
                }],
                body: "".to_string(),
                auth_type: "none".to_string(),
                auth_token: "".to_string(),
            },
        )
        .expect("save request");

        assert_eq!(saved.requests.len(), 1);
        assert_eq!(saved.requests[0].url, "http://localhost:3000/hello-updated");
        assert_eq!(saved.requests[0].params.len(), 1);

        let reloaded =
            read_collection_file(&collection_file).expect("reload updated collection file");
        assert_eq!(
            reloaded.requests[0].url,
            "http://localhost:3000/hello-updated"
        );
        assert_eq!(reloaded.requests[0].headers.len(), 1);
        assert_eq!(
            reloaded.requests[0].collection_file,
            collection_file.to_string_lossy()
        );
    }

    #[test]
    fn save_request_and_environment_normalize_prefixed_relative_paths() {
        let paths = make_test_paths("path-normalization");

        fs::write(
            paths.collections_dir.join("core-api.json"),
            r#"{
  "name": "Core API",
  "requests": []
}
"#,
        )
        .expect("write collection seed");

        save_request(
            &paths,
            SaveRequestInput {
                id: "req-normalized".to_string(),
                name: "GET /normalized".to_string(),
                collection: "Core API".to_string(),
                collection_file: "collections/core-api.json".to_string(),
                method: "GET".to_string(),
                url: "http://localhost:3000/normalized".to_string(),
                params: vec![],
                headers: vec![],
                body: "".to_string(),
                auth_type: "none".to_string(),
                auth_token: "".to_string(),
            },
        )
        .expect("save normalized request");

        assert!(paths.collections_dir.join("core-api.json").exists());
        assert!(!paths
            .collections_dir
            .join("collections")
            .join("core-api.json")
            .exists());

        save_environment(
            &paths,
            SaveEnvironmentInput {
                name: "Production".to_string(),
                file_path: "environments/production.json".to_string(),
                vars: vec![EnvironmentVariable {
                    key: "base_url".to_string(),
                    value: "https://api.example.com".to_string(),
                }],
            },
        )
        .expect("save normalized environment");

        assert!(paths.environments_dir.join("production.json").exists());
        assert!(!paths
            .environments_dir
            .join("environments")
            .join("production.json")
            .exists());
    }
}
