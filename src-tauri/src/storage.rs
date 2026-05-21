use std::fs;
use std::path::{Path, PathBuf};

use reqwest::header::{HeaderMap, SET_COOKIE};
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
const DEFAULT_COOKIE_PATH: &str = "/";

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
    let local_environment_file = paths.environments_dir.join("local.yaml");

    write_if_missing(
        &workspace_file,
        r#"{
  "name": "Default Workspace",
  "collections": ["core-api.json"],
  "environments": ["production.json", "local.yaml"]
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
  "auth_token": "{{secret.prod_token}}",
  "proxy": "system",
  "tls_verify": "true",
  "tls_hostname_verify": "true",
  "https_only": "false"
}
"#,
    )?;
    write_if_missing(
        &local_environment_file,
        r#"name: "Local Mock"
base_url: "http://127.0.0.1:8787"
auth_token: "dev-token"
proxy: "disabled"
tls_verify: "false"
tls_hostname_verify: "false"
https_only: "false"
cookie_jar: "workspace_local"
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

pub(crate) fn initialize_database(database_path: &Path) -> AppResult<()> {
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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCookie {
    name: String,
    value: String,
    domain: String,
    path: String,
    #[serde(default = "default_cookie_host_only")]
    host_only: bool,
    #[serde(default)]
    secure: bool,
}

#[derive(Debug)]
struct ParsedCookie {
    cookie: StoredCookie,
    remove: bool,
}

fn default_cookie_host_only() -> bool {
    true
}

pub fn load_cookie_header(
    paths: &StoragePaths,
    jar_name: &str,
    url: &reqwest::Url,
) -> AppResult<Option<String>> {
    let Some(host) = url.host_str().map(|value| value.to_ascii_lowercase()) else {
        return Ok(None);
    };
    let request_path = url.path();
    let is_secure_request = url.scheme() == "https";
    let mut cookies = read_cookie_rows(paths, jar_name)?;

    cookies.retain(|cookie| {
        cookie_domain_matches(&host, cookie)
            && path_matches(request_path, &cookie.path)
            && (!cookie.secure || is_secure_request)
    });
    cookies.sort_by(|left, right| {
        right
            .path
            .len()
            .cmp(&left.path.len())
            .then_with(|| left.name.cmp(&right.name))
    });

    let header = cookies
        .into_iter()
        .map(|cookie| format!("{}={}", cookie.name, cookie.value))
        .collect::<Vec<_>>()
        .join("; ");

    if header.is_empty() {
        Ok(None)
    } else {
        Ok(Some(header))
    }
}

pub fn store_set_cookie_headers(
    paths: &StoragePaths,
    jar_name: &str,
    url: &reqwest::Url,
    headers: &HeaderMap,
) -> AppResult<usize> {
    let mut updated = 0usize;

    for value in headers.get_all(SET_COOKIE).iter() {
        let Ok(raw_cookie) = value.to_str() else {
            continue;
        };
        let Some(parsed) = parse_set_cookie(raw_cookie, url) else {
            continue;
        };

        upsert_cookie(paths, jar_name, parsed)?;
        updated += 1;
    }

    Ok(updated)
}

fn read_cookie_rows(paths: &StoragePaths, jar_name: &str) -> AppResult<Vec<StoredCookie>> {
    let connection = open_connection(&paths.database_path)?;
    let mut statement = connection.prepare(
        r#"
        SELECT cookie_json
        FROM cookie_jars
        WHERE jar_name = ?1
        ORDER BY id ASC
        "#,
    )?;

    let rows = statement.query_map(params![jar_name], |row| row.get::<_, String>(0))?;
    let mut cookies = Vec::new();

    for row in rows {
        let payload = row?;
        let mut parsed = serde_json::from_str::<Vec<StoredCookie>>(&payload)
            .map_err(|error| AppError::InvalidData(error.to_string()))?;
        cookies.append(&mut parsed);
    }

    Ok(cookies)
}

fn read_domain_cookies(
    connection: &Connection,
    jar_name: &str,
    domain: &str,
) -> AppResult<Vec<StoredCookie>> {
    let mut statement = connection.prepare(
        r#"
        SELECT cookie_json
        FROM cookie_jars
        WHERE jar_name = ?1 AND domain = ?2
        ORDER BY id ASC
        "#,
    )?;
    let rows = statement.query_map(params![jar_name, domain], |row| row.get::<_, String>(0))?;
    let mut cookies = Vec::new();

    for row in rows {
        let payload = row?;
        let mut parsed = serde_json::from_str::<Vec<StoredCookie>>(&payload)
            .map_err(|error| AppError::InvalidData(error.to_string()))?;
        cookies.append(&mut parsed);
    }

    Ok(cookies)
}

fn upsert_cookie(paths: &StoragePaths, jar_name: &str, parsed: ParsedCookie) -> AppResult<()> {
    let connection = open_connection(&paths.database_path)?;
    let mut cookies = read_domain_cookies(&connection, jar_name, &parsed.cookie.domain)?;
    cookies.retain(|cookie| {
        !(cookie.name == parsed.cookie.name
            && cookie.domain == parsed.cookie.domain
            && cookie.path == parsed.cookie.path)
    });

    if !parsed.remove {
        cookies.push(parsed.cookie.clone());
    }

    connection.execute(
        "DELETE FROM cookie_jars WHERE jar_name = ?1 AND domain = ?2",
        params![jar_name, parsed.cookie.domain],
    )?;

    if !cookies.is_empty() {
        let payload = serde_json::to_string(&cookies)
            .map_err(|error| AppError::InvalidData(error.to_string()))?;
        connection.execute(
            r#"
            INSERT INTO cookie_jars (jar_name, domain, cookie_json, updated_at)
            VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)
            "#,
            params![jar_name, parsed.cookie.domain, payload],
        )?;
    }

    Ok(())
}

fn parse_set_cookie(raw_cookie: &str, origin_url: &reqwest::Url) -> Option<ParsedCookie> {
    let mut parts = raw_cookie.split(';');
    let (name, value) = parts.next()?.trim().split_once('=')?;
    let name = name.trim();
    if name.is_empty() {
        return None;
    }

    let origin_host = origin_url.host_str()?.to_ascii_lowercase();
    let mut domain = origin_host.clone();
    let mut path = default_cookie_path(origin_url);
    let mut host_only = true;
    let mut secure = false;
    let mut remove = false;

    for part in parts {
        let attribute = part.trim();
        if attribute.eq_ignore_ascii_case("secure") {
            secure = true;
            continue;
        }

        let Some((key, raw_value)) = attribute.split_once('=') else {
            continue;
        };
        let key = key.trim().to_ascii_lowercase();
        let raw_value = raw_value.trim();

        match key.as_str() {
            "domain" => {
                let candidate = normalize_cookie_domain(raw_value);
                if candidate.is_empty() || !domain_matches(&origin_host, &candidate) {
                    return None;
                }
                domain = candidate;
                host_only = false;
            }
            "path" => {
                if raw_value.starts_with('/') {
                    path = raw_value.to_string();
                }
            }
            "max-age" => {
                if raw_value.parse::<i64>().ok().is_some_and(|age| age <= 0) {
                    remove = true;
                }
            }
            "expires" => {
                if raw_value.contains("1970") || raw_value.eq_ignore_ascii_case("0") {
                    remove = true;
                }
            }
            _ => {}
        }
    }

    Some(ParsedCookie {
        cookie: StoredCookie {
            name: name.to_string(),
            value: value.trim().to_string(),
            domain,
            path,
            host_only,
            secure,
        },
        remove,
    })
}

fn normalize_cookie_domain(raw_domain: &str) -> String {
    raw_domain
        .trim()
        .trim_start_matches('.')
        .to_ascii_lowercase()
}

fn default_cookie_path(url: &reqwest::Url) -> String {
    let path = url.path();
    if path.is_empty() || path == DEFAULT_COOKIE_PATH {
        return DEFAULT_COOKIE_PATH.to_string();
    }

    match path.rfind('/') {
        Some(0) | None => DEFAULT_COOKIE_PATH.to_string(),
        Some(index) => path[..index].to_string(),
    }
}

fn domain_matches(host: &str, cookie_domain: &str) -> bool {
    host == cookie_domain
        || host
            .strip_suffix(cookie_domain)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

fn cookie_domain_matches(host: &str, cookie: &StoredCookie) -> bool {
    if cookie.host_only {
        host == cookie.domain
    } else {
        domain_matches(host, &cookie.domain)
    }
}

fn path_matches(request_path: &str, cookie_path: &str) -> bool {
    if cookie_path == DEFAULT_COOKIE_PATH {
        return true;
    }

    if request_path == cookie_path {
        return true;
    }
    if !request_path.starts_with(cookie_path) {
        return false;
    }
    if cookie_path.ends_with('/') {
        return true;
    }

    request_path
        .as_bytes()
        .get(cookie_path.len())
        .is_some_and(|value| *value == b'/')
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
        if path.is_file() && is_supported_environment_file(&path) {
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

    let formatted = serialize_environment_payload(&file_path, &Value::Object(payload))?;
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
    let parsed = parse_environment_payload(path, &contents)?;
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

#[derive(Debug, Clone, Copy)]
enum EnvironmentFileFormat {
    Json,
    Yaml,
}

fn is_supported_environment_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "json" | "yaml" | "yml"
            )
        })
        .unwrap_or(false)
}

fn environment_file_format(path: &Path) -> AppResult<EnvironmentFileFormat> {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
        .as_deref()
    {
        Some("yaml") | Some("yml") => Ok(EnvironmentFileFormat::Yaml),
        Some("json") | None => Ok(EnvironmentFileFormat::Json),
        Some(extension) => Err(AppError::InvalidData(format!(
            "unsupported environment file extension .{extension}: {}",
            path.display()
        ))),
    }
}

fn parse_environment_payload(path: &Path, contents: &str) -> AppResult<Value> {
    match environment_file_format(path)? {
        EnvironmentFileFormat::Json => {
            serde_json::from_str(contents).map_err(|error| AppError::InvalidData(error.to_string()))
        }
        EnvironmentFileFormat::Yaml => parse_yaml_environment(path, contents),
    }
}

fn serialize_environment_payload(path: &Path, payload: &Value) -> AppResult<String> {
    match environment_file_format(path)? {
        EnvironmentFileFormat::Json => serde_json::to_string_pretty(payload)
            .map_err(|error| AppError::InvalidData(error.to_string())),
        EnvironmentFileFormat::Yaml => serialize_yaml_environment(payload),
    }
}

fn parse_yaml_environment(path: &Path, contents: &str) -> AppResult<Value> {
    let mut object = Map::new();

    for (index, raw_line) in contents.lines().enumerate() {
        let line_number = index + 1;
        let trimmed_start = raw_line.trim_start();
        if trimmed_start.is_empty()
            || trimmed_start.starts_with('#')
            || trimmed_start == "---"
            || trimmed_start == "..."
        {
            continue;
        }

        if raw_line
            .chars()
            .next()
            .is_some_and(|character| character.is_whitespace())
        {
            return Err(AppError::InvalidData(format!(
                "nested YAML is not supported in environment file {} at line {line_number}",
                path.display()
            )));
        }

        let line = strip_yaml_comment(raw_line).trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('-') {
            return Err(AppError::InvalidData(format!(
                "YAML sequences are not supported in environment file {} at line {line_number}",
                path.display()
            )));
        }

        let Some(separator) = find_yaml_mapping_separator(line) else {
            return Err(AppError::InvalidData(format!(
                "expected key/value mapping in environment file {} at line {line_number}",
                path.display()
            )));
        };
        let key = parse_yaml_scalar(line[..separator].trim()).map_err(|message| {
            AppError::InvalidData(format!(
                "invalid YAML key in environment file {} at line {line_number}: {message}",
                path.display()
            ))
        })?;
        if key.is_empty() {
            return Err(AppError::InvalidData(format!(
                "empty YAML key in environment file {} at line {line_number}",
                path.display()
            )));
        }

        let value = parse_yaml_scalar(line[separator + 1..].trim()).map_err(|message| {
            AppError::InvalidData(format!(
                "invalid YAML value in environment file {} at line {line_number}: {message}",
                path.display()
            ))
        })?;
        object.insert(key, Value::String(value));
    }

    Ok(Value::Object(object))
}

fn serialize_yaml_environment(payload: &Value) -> AppResult<String> {
    let object = payload.as_object().ok_or_else(|| {
        AppError::InvalidData("environment payload must be an object".to_string())
    })?;
    let mut lines = Vec::new();

    if let Some(name) = object.get("name") {
        lines.push(format!(
            "{}: {}",
            yaml_key("name"),
            yaml_scalar_from_value(name)
        ));
    }

    let mut keys = object
        .keys()
        .filter(|key| key.as_str() != "name")
        .collect::<Vec<_>>();
    keys.sort();

    for key in keys {
        if let Some(value) = object.get(key) {
            lines.push(format!(
                "{}: {}",
                yaml_key(key),
                yaml_scalar_from_value(value)
            ));
        }
    }

    Ok(lines.join("\n"))
}

fn strip_yaml_comment(line: &str) -> &str {
    let mut quote = None;
    let mut escaped = false;

    for (index, character) in line.char_indices() {
        match quote {
            Some('"') if escaped => {
                escaped = false;
            }
            Some('"') if character == '\\' => {
                escaped = true;
            }
            Some(active_quote) if character == active_quote => {
                quote = None;
            }
            Some(_) => {}
            None if character == '"' || character == '\'' => {
                quote = Some(character);
            }
            None if character == '#'
                && (index == 0
                    || line[..index]
                        .chars()
                        .last()
                        .is_some_and(|previous| previous.is_whitespace())) =>
            {
                return &line[..index];
            }
            None => {}
        }
    }

    line
}

fn find_yaml_mapping_separator(line: &str) -> Option<usize> {
    let mut quote = None;
    let mut escaped = false;

    for (index, character) in line.char_indices() {
        match quote {
            Some('"') if escaped => {
                escaped = false;
            }
            Some('"') if character == '\\' => {
                escaped = true;
            }
            Some(active_quote) if character == active_quote => {
                quote = None;
            }
            Some(_) => {}
            None if character == '"' || character == '\'' => {
                quote = Some(character);
            }
            None if character == ':' => {
                return Some(index);
            }
            None => {}
        }
    }

    None
}

fn parse_yaml_scalar(raw_value: &str) -> Result<String, String> {
    let value = raw_value.trim();
    if value.is_empty() {
        return Ok(String::new());
    }

    if value.starts_with('"') || value.ends_with('"') {
        if !(value.starts_with('"') && value.ends_with('"') && value.len() >= 2) {
            return Err("unterminated double-quoted scalar".to_string());
        }
        return serde_json::from_str::<String>(value).map_err(|error| error.to_string());
    }

    if value.starts_with('\'') || value.ends_with('\'') {
        if !(value.starts_with('\'') && value.ends_with('\'') && value.len() >= 2) {
            return Err("unterminated single-quoted scalar".to_string());
        }
        return Ok(value[1..value.len() - 1].replace("''", "'"));
    }

    Ok(value.to_string())
}

fn yaml_key(key: &str) -> String {
    if !key.is_empty()
        && key
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
    {
        key.to_string()
    } else {
        serde_json::to_string(key).unwrap_or_else(|_| "\"invalid-key\"".to_string())
    }
}

fn yaml_scalar_from_value(value: &Value) -> String {
    let scalar = match value {
        Value::String(inner) => inner.clone(),
        _ => value.to_string(),
    };

    serde_json::to_string(&scalar).unwrap_or_else(|_| "\"\"".to_string())
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
    use reqwest::header::HeaderValue;

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

    #[test]
    fn list_environments_reads_json_yaml_and_yml_files() {
        let paths = make_test_paths("environment-formats");

        fs::write(
            paths.environments_dir.join("json-env.json"),
            r#"{
  "name": "JSON Env",
  "base_url": "https://api.example.com",
  "enabled": true
}
"#,
        )
        .expect("write json env");
        fs::write(
            paths.environments_dir.join("yaml-env.yaml"),
            r#"name: "YAML Env"
base_url: "http://127.0.0.1:8787"
auth_token: "token # not comment"
proxy: disabled # inline comments are ignored
"#,
        )
        .expect("write yaml env");
        fs::write(
            paths.environments_dir.join("yml-env.yml"),
            r#"name: 'YML Env'
base_url: https://example.test/v1
cookie_jar: workspace_local
"#,
        )
        .expect("write yml env");
        fs::write(paths.environments_dir.join("README.txt"), "ignore me")
            .expect("write ignored file");

        let environments = list_environments(&paths).expect("list environments");
        assert_eq!(environments.len(), 3);

        let json_env = environments
            .iter()
            .find(|environment| environment.name == "JSON Env")
            .expect("json env");
        assert!(json_env.file_path.ends_with("json-env.json"));
        assert!(json_env
            .vars
            .iter()
            .any(|row| row.key == "enabled" && row.value == "true"));

        let yaml_env = environments
            .iter()
            .find(|environment| environment.name == "YAML Env")
            .expect("yaml env");
        assert!(yaml_env.file_path.ends_with("yaml-env.yaml"));
        assert!(yaml_env
            .vars
            .iter()
            .any(|row| row.key == "base_url" && row.value == "http://127.0.0.1:8787"));
        assert!(yaml_env
            .vars
            .iter()
            .any(|row| row.key == "auth_token" && row.value == "token # not comment"));
        assert!(yaml_env
            .vars
            .iter()
            .any(|row| row.key == "proxy" && row.value == "disabled"));

        let yml_env = environments
            .iter()
            .find(|environment| environment.name == "YML Env")
            .expect("yml env");
        assert!(yml_env.file_path.ends_with("yml-env.yml"));
        assert!(yml_env
            .vars
            .iter()
            .any(|row| row.key == "cookie_jar" && row.value == "workspace_local"));
    }

    #[test]
    fn save_environment_writes_json_yaml_and_yml_by_extension() {
        let paths = make_test_paths("environment-save-formats");
        let vars = vec![
            EnvironmentVariable {
                key: "base_url".to_string(),
                value: "http://127.0.0.1:8787".to_string(),
            },
            EnvironmentVariable {
                key: "auth_token".to_string(),
                value: "dev-token".to_string(),
            },
        ];

        let json = save_environment(
            &paths,
            SaveEnvironmentInput {
                name: "JSON Save".to_string(),
                file_path: "json-save.json".to_string(),
                vars: vars.clone(),
            },
        )
        .expect("save json environment");
        assert_eq!(json.name, "JSON Save");
        let json_contents =
            fs::read_to_string(paths.environments_dir.join("json-save.json")).expect("read json");
        assert!(json_contents.trim_start().starts_with('{'));

        let yaml = save_environment(
            &paths,
            SaveEnvironmentInput {
                name: "YAML Save".to_string(),
                file_path: "yaml-save.yaml".to_string(),
                vars: vars.clone(),
            },
        )
        .expect("save yaml environment");
        assert_eq!(yaml.name, "YAML Save");
        assert_eq!(yaml.vars.len(), 2);
        let yaml_contents =
            fs::read_to_string(paths.environments_dir.join("yaml-save.yaml")).expect("read yaml");
        assert!(yaml_contents.contains("name: \"YAML Save\""));
        assert!(yaml_contents.contains("base_url: \"http://127.0.0.1:8787\""));
        assert!(!yaml_contents.trim_start().starts_with('{'));

        let yml = save_environment(
            &paths,
            SaveEnvironmentInput {
                name: "YML Save".to_string(),
                file_path: "yml-save.yml".to_string(),
                vars,
            },
        )
        .expect("save yml environment");
        assert_eq!(yml.name, "YML Save");
        assert!(paths.environments_dir.join("yml-save.yml").exists());
    }

    #[test]
    fn seed_files_include_real_local_yaml_environment() {
        let paths = make_test_paths("environment-seed-yaml");
        ensure_seed_files(&paths).expect("seed files");

        let local_yaml = paths.environments_dir.join("local.yaml");
        assert!(local_yaml.exists());

        let workspace_contents =
            fs::read_to_string(paths.workspaces_dir.join("default-workspace.json"))
                .expect("read workspace seed");
        assert!(workspace_contents.contains("local.yaml"));

        let environments = list_environments(&paths).expect("list seeded environments");
        let local = environments
            .iter()
            .find(|environment| environment.name == "Local Mock")
            .expect("local yaml environment");
        assert!(local.file_path.ends_with("local.yaml"));
        assert!(local
            .vars
            .iter()
            .any(|row| row.key == "cookie_jar" && row.value == "workspace_local"));
    }

    #[test]
    fn yaml_environment_rejects_nested_content() {
        let paths = make_test_paths("environment-yaml-invalid");
        let path = paths.environments_dir.join("nested.yaml");
        fs::write(
            &path,
            r#"name: Nested
auth:
  token: secret
"#,
        )
        .expect("write nested yaml");

        let error = read_environment_file(&path).expect_err("reject nested yaml");
        assert!(error.to_string().contains("nested YAML is not supported"));
    }

    #[test]
    fn cookie_jar_persists_matches_and_removes_cookies() {
        let paths = make_test_paths("cookie-jar");
        initialize_database(&paths.database_path).expect("initialize database");
        let origin_url =
            reqwest::Url::parse("https://api.example.com/v1/login").expect("parse origin url");
        let request_url =
            reqwest::Url::parse("https://api.example.com/v1/workspaces").expect("parse url");
        let other_url =
            reqwest::Url::parse("https://other.example.test/v1/workspaces").expect("parse url");
        let subdomain_url =
            reqwest::Url::parse("https://team.api.example.com/v1/workspaces").expect("parse url");
        let insecure_url =
            reqwest::Url::parse("http://api.example.com/v1/workspaces").expect("parse url");

        let mut headers = HeaderMap::new();
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("workspace_session=abc123; Path=/v1; HttpOnly"),
        );
        headers.append(
            SET_COOKIE,
            HeaderValue::from_static("secure_session=ssl; Path=/v1; Secure"),
        );

        let updated =
            store_set_cookie_headers(&paths, "integration", &origin_url, &headers).expect("store");
        assert_eq!(updated, 2);

        let cookie_header = load_cookie_header(&paths, "integration", &request_url)
            .expect("load cookies")
            .expect("cookie header");
        assert!(cookie_header.contains("workspace_session=abc123"));
        assert!(cookie_header.contains("secure_session=ssl"));

        let insecure_cookie_header = load_cookie_header(&paths, "integration", &insecure_url)
            .expect("load insecure cookies")
            .expect("cookie header");
        assert!(insecure_cookie_header.contains("workspace_session=abc123"));
        assert!(!insecure_cookie_header.contains("secure_session=ssl"));

        assert!(load_cookie_header(&paths, "integration", &other_url)
            .expect("load other domain cookies")
            .is_none());
        assert!(load_cookie_header(&paths, "integration", &subdomain_url)
            .expect("load host-only cookie on subdomain")
            .is_none());

        let mut removal_headers = HeaderMap::new();
        removal_headers.append(
            SET_COOKIE,
            HeaderValue::from_static("workspace_session=gone; Path=/v1; Max-Age=0"),
        );
        store_set_cookie_headers(&paths, "integration", &origin_url, &removal_headers)
            .expect("remove cookie");

        let cookie_header = load_cookie_header(&paths, "integration", &request_url)
            .expect("reload cookies")
            .expect("remaining cookie header");
        assert!(!cookie_header.contains("workspace_session=abc123"));
        assert!(cookie_header.contains("secure_session=ssl"));
    }

    #[test]
    fn legacy_cookie_json_defaults_to_host_only() {
        let paths = make_test_paths("legacy-cookie-json");
        initialize_database(&paths.database_path).expect("initialize database");
        let connection = Connection::open(&paths.database_path).expect("open sqlite");
        connection
            .execute(
                r#"
                INSERT INTO cookie_jars (jar_name, domain, cookie_json)
                VALUES (?1, ?2, ?3)
                "#,
                params![
                    "legacy",
                    "api.example.com",
                    r#"[{"name":"legacy_session","value":"old","domain":"api.example.com","path":"/","secure":false}]"#
                ],
            )
            .expect("insert legacy cookie row");

        let exact_url = reqwest::Url::parse("https://api.example.com/v1").expect("parse url");
        let subdomain_url =
            reqwest::Url::parse("https://team.api.example.com/v1").expect("parse url");

        let exact_cookie_header = load_cookie_header(&paths, "legacy", &exact_url)
            .expect("load exact host cookie")
            .expect("exact host cookie header");
        assert!(exact_cookie_header.contains("legacy_session=old"));
        assert!(load_cookie_header(&paths, "legacy", &subdomain_url)
            .expect("load subdomain cookie")
            .is_none());
    }
}
