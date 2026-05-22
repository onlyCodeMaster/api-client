use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use reqwest::header::{HeaderMap, SET_COOKIE};
use rusqlite::{params, Connection};
use serde_json::{Map, Value};
use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::models::{
    AppPaths, AppSettings, CacheSummary, CollectionSummary, CreateCollectionInput,
    DeleteCollectionInput, DeleteEnvironmentInput, DeleteRequestInput, EnvironmentSummary,
    EnvironmentVariable, HistoryEntry, LogSummary, MoveCollectionInput, MoveRequestInput,
    MoveRequestResult, RecordHistoryInput, RenameCollectionInput, RenameEnvironmentInput,
    ReorderRequestInput, RuntimeSummary, SaveEnvironmentInput, SaveRequestInput, StoredRequest,
};

const DEFAULT_SETTINGS_THEME: &str = "clay-light";
const DEFAULT_SETTINGS_WORKSPACE: &str = "default-workspace";
const DEFAULT_COOKIE_PATH: &str = "/";
const CACHE_INDEX_FILE_NAME: &str = "index.json";
const ACTIVE_LOG_FILE_NAME: &str = "api-client.log";

#[derive(Debug, Clone)]
pub struct StoragePaths {
    pub app_data_dir: PathBuf,
    pub database_path: PathBuf,
    pub workspaces_dir: PathBuf,
    pub collections_dir: PathBuf,
    pub environments_dir: PathBuf,
    pub cache_dir: PathBuf,
    pub logs_dir: PathBuf,
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
        let cache_dir = app_data_dir.join("cache");
        let logs_dir = app_data_dir.join("logs");
        let database_path = app_data_dir.join("api-client.sqlite3");

        Ok(Self {
            app_data_dir,
            database_path,
            workspaces_dir,
            collections_dir,
            environments_dir,
            cache_dir,
            logs_dir,
        })
    }

    pub fn to_model(&self) -> AppPaths {
        AppPaths {
            app_data_dir: self.app_data_dir.to_string_lossy().into_owned(),
            database_path: self.database_path.to_string_lossy().into_owned(),
            workspaces_dir: self.workspaces_dir.to_string_lossy().into_owned(),
            collections_dir: self.collections_dir.to_string_lossy().into_owned(),
            environments_dir: self.environments_dir.to_string_lossy().into_owned(),
            cache_dir: self.cache_dir.to_string_lossy().into_owned(),
            logs_dir: self.logs_dir.to_string_lossy().into_owned(),
        }
    }
}

pub fn initialize(app: &AppHandle) -> AppResult<StoragePaths> {
    let paths = StoragePaths::resolve(app)?;
    ensure_directories(&paths)?;
    ensure_seed_files(&paths)?;
    initialize_database(&paths.database_path)?;
    initialize_runtime_files(&paths)?;
    Ok(paths)
}

fn ensure_directories(paths: &StoragePaths) -> AppResult<()> {
    fs::create_dir_all(&paths.app_data_dir)?;
    fs::create_dir_all(&paths.workspaces_dir)?;
    fs::create_dir_all(&paths.collections_dir)?;
    fs::create_dir_all(&paths.environments_dir)?;
    fs::create_dir_all(&paths.cache_dir)?;
    fs::create_dir_all(&paths.logs_dir)?;
    Ok(())
}

fn initialize_runtime_files(paths: &StoragePaths) -> AppResult<()> {
    ensure_cache_index(paths)?;
    append_log_entry(
        paths,
        "runtime",
        "initialized",
        "Local runtime storage initialized",
        None,
    )?;
    Ok(())
}

fn ensure_seed_files(paths: &StoragePaths) -> AppResult<()> {
    let workspace_file = paths.workspaces_dir.join("default-workspace.json");

    write_if_missing(
        &workspace_file,
        r#"{
  "name": "Default Workspace",
  "collections": [],
  "environments": []
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

fn timestamp_millis() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn cache_index_path(paths: &StoragePaths) -> PathBuf {
    paths.cache_dir.join(CACHE_INDEX_FILE_NAME)
}

fn active_log_path(paths: &StoragePaths) -> PathBuf {
    paths.logs_dir.join(ACTIVE_LOG_FILE_NAME)
}

fn ensure_cache_index(paths: &StoragePaths) -> AppResult<()> {
    fs::create_dir_all(&paths.cache_dir)?;
    let index_path = cache_index_path(paths);
    if !index_path.exists() {
        let payload = serde_json::json!({
            "version": 1,
            "updatedAt": timestamp_millis(),
            "entries": []
        });
        let formatted = serde_json::to_string_pretty(&payload)
            .map_err(|error| AppError::InvalidData(error.to_string()))?;
        fs::write(index_path, format!("{formatted}\n"))?;
    }

    Ok(())
}

fn read_cache_index(paths: &StoragePaths) -> AppResult<Value> {
    ensure_cache_index(paths)?;
    let contents = fs::read_to_string(cache_index_path(paths))?;
    serde_json::from_str(&contents).map_err(|error| AppError::InvalidData(error.to_string()))
}

pub fn record_cache_entry(
    paths: &StoragePaths,
    key: &str,
    kind: &str,
    size_bytes: u64,
    detail: &str,
) -> AppResult<CacheSummary> {
    ensure_cache_index(paths)?;
    let mut payload = read_cache_index(paths)?;
    let updated_at = timestamp_millis();
    let entry = serde_json::json!({
        "key": key,
        "kind": kind,
        "sizeBytes": size_bytes,
        "detail": detail,
        "updatedAt": updated_at
    });

    let object = payload.as_object_mut().ok_or_else(|| {
        AppError::InvalidData(format!(
            "cache index is not an object: {}",
            cache_index_path(paths).display()
        ))
    })?;
    object.insert("version".to_string(), Value::Number(1.into()));
    object.insert("updatedAt".to_string(), Value::String(updated_at));

    let entries = object
        .entry("entries")
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .ok_or_else(|| {
            AppError::InvalidData(format!(
                "cache index entries is not an array: {}",
                cache_index_path(paths).display()
            ))
        })?;
    entries.retain(|item| item.get("key").and_then(Value::as_str) != Some(key));
    entries.push(entry);
    entries.sort_by(|left, right| {
        left.get("key")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .cmp(right.get("key").and_then(Value::as_str).unwrap_or_default())
    });

    let formatted = serde_json::to_string_pretty(&payload)
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    fs::write(cache_index_path(paths), format!("{formatted}\n"))?;

    cache_summary(paths)
}

pub fn append_log_entry(
    paths: &StoragePaths,
    command: &str,
    phase: &str,
    message: &str,
    detail: Option<&str>,
) -> AppResult<LogSummary> {
    fs::create_dir_all(&paths.logs_dir)?;
    let timestamp = timestamp_millis();
    let mut line = format!(
        "{timestamp}\t{command}\t{phase}\t{}",
        sanitize_log_field(message)
    );
    if let Some(detail) = detail.filter(|value| !value.is_empty()) {
        line.push('\t');
        line.push_str(&sanitize_log_field(detail));
    }
    line.push('\n');

    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(active_log_path(paths))?;
    file.write_all(line.as_bytes())?;

    log_summary(paths)
}

pub fn runtime_summary(paths: &StoragePaths) -> AppResult<RuntimeSummary> {
    Ok(RuntimeSummary {
        cache: cache_summary(paths)?,
        logs: log_summary(paths)?,
    })
}

pub fn cache_summary(paths: &StoragePaths) -> AppResult<CacheSummary> {
    ensure_cache_index(paths)?;
    let index_path = cache_index_path(paths);
    let payload = read_cache_index(paths)?;
    let entries = payload
        .get("entries")
        .and_then(Value::as_array)
        .map(Vec::len)
        .unwrap_or_default();
    let updated_at = payload
        .get("updatedAt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let size_bytes = fs::metadata(&index_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);

    Ok(CacheSummary {
        directory: paths.cache_dir.to_string_lossy().into_owned(),
        index_file: index_path.to_string_lossy().into_owned(),
        entries,
        size_bytes,
        updated_at,
    })
}

pub fn log_summary(paths: &StoragePaths) -> AppResult<LogSummary> {
    fs::create_dir_all(&paths.logs_dir)?;
    let log_path = active_log_path(paths);
    if !log_path.exists() {
        fs::write(&log_path, "")?;
    }

    let contents = fs::read_to_string(&log_path)?;
    let last_line = contents
        .lines()
        .last()
        .map(ToOwned::to_owned)
        .unwrap_or_default();
    let size_bytes = fs::metadata(&log_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let updated_at = last_line.split('\t').next().unwrap_or_default().to_string();

    Ok(LogSummary {
        directory: paths.logs_dir.to_string_lossy().into_owned(),
        active_file: log_path.to_string_lossy().into_owned(),
        size_bytes,
        last_line,
        updated_at,
    })
}

fn sanitize_log_field(value: &str) -> String {
    let normalized = value
        .chars()
        .map(|character| match character {
            '\n' | '\r' | '\t' => ' ',
            other => other,
        })
        .collect::<String>();

    redact_sensitive_log_values(&normalized)
}

fn redact_sensitive_log_values(value: &str) -> String {
    const SENSITIVE_KEYS: &[&str] = &[
        "authorization",
        "token",
        "auth_token",
        "access_token",
        "refresh_token",
        "api_key",
        "apikey",
        "password",
        "secret",
        "cookie",
    ];

    SENSITIVE_KEYS
        .iter()
        .fold(value.to_string(), |current, key| {
            redact_value_after_separator(redact_value_after_separator(current, key, '='), key, ':')
        })
}

fn redact_value_after_separator(mut value: String, key: &str, separator: char) -> String {
    let pattern = format!("{key}{separator}");
    let mut search_start = 0usize;

    loop {
        let lower = value.to_ascii_lowercase();
        let Some(relative_position) = lower[search_start..].find(&pattern) else {
            break;
        };

        let value_start = search_start + relative_position + pattern.len();
        let mut value_end = value.len();
        for (offset, character) in value[value_start..].char_indices() {
            let is_delimiter = match separator {
                '=' => matches!(character, '&' | ' ' | ',' | ';'),
                ':' => matches!(character, ',' | ';'),
                _ => false,
            };

            if is_delimiter {
                value_end = value_start + offset;
                break;
            }
        }

        if value_end > value_start {
            value.replace_range(value_start..value_end, "***");
            search_start = value_start + 3;
        } else {
            search_start = value_start;
        }
    }

    value
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
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            request_name TEXT NOT NULL DEFAULT '',
            collection TEXT NOT NULL DEFAULT '',
            params_json TEXT NOT NULL DEFAULT '[]',
            headers_json TEXT NOT NULL DEFAULT '[]',
            body TEXT NOT NULL DEFAULT '',
            auth_type TEXT NOT NULL DEFAULT 'none',
            auth_token TEXT NOT NULL DEFAULT '',
            environment_name TEXT NOT NULL DEFAULT '',
            environment_source TEXT NOT NULL DEFAULT '',
            environment_vars_json TEXT NOT NULL DEFAULT '[]'
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

    let history_columns = [
        ("request_name", "TEXT NOT NULL DEFAULT ''"),
        ("collection", "TEXT NOT NULL DEFAULT ''"),
        ("params_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("headers_json", "TEXT NOT NULL DEFAULT '[]'"),
        ("body", "TEXT NOT NULL DEFAULT ''"),
        ("auth_type", "TEXT NOT NULL DEFAULT 'none'"),
        ("auth_token", "TEXT NOT NULL DEFAULT ''"),
        ("environment_name", "TEXT NOT NULL DEFAULT ''"),
        ("environment_source", "TEXT NOT NULL DEFAULT ''"),
        ("environment_vars_json", "TEXT NOT NULL DEFAULT '[]'"),
    ];

    for (column, definition) in history_columns {
        if !columns.iter().any(|existing| existing == column) {
            connection.execute(
                &format!("ALTER TABLE request_history ADD COLUMN {column} {definition}"),
                [],
            )?;
        }
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
        SELECT
            id,
            request_id,
            method,
            url,
            status,
            duration_ms,
            created_at,
            request_name,
            collection,
            params_json,
            headers_json,
            body,
            auth_type,
            auth_token,
            environment_name,
            environment_source,
            environment_vars_json
        FROM request_history
        ORDER BY id DESC
        LIMIT 20
        "#,
    )?;

    let rows = statement.query_map([], |row| {
        let params_json = row.get::<_, String>(9)?;
        let headers_json = row.get::<_, String>(10)?;
        let environment_vars_json = row.get::<_, String>(16)?;
        Ok(HistoryEntry {
            id: row.get(0)?,
            request_id: row.get(1)?,
            method: row.get(2)?,
            url: row.get(3)?,
            status: row.get(4)?,
            duration_ms: row.get(5)?,
            created_at: row.get(6)?,
            request_name: row.get(7)?,
            collection: row.get(8)?,
            params: serde_json::from_str(&params_json).unwrap_or_default(),
            headers: serde_json::from_str(&headers_json).unwrap_or_default(),
            body: row.get(11)?,
            auth_type: row.get(12)?,
            auth_token: row.get(13)?,
            environment_name: row.get(14)?,
            environment_source: row.get(15)?,
            environment_vars: serde_json::from_str(&environment_vars_json).unwrap_or_default(),
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
    let params_json = serde_json::to_string(&input.params)
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    let headers_json = serde_json::to_string(&input.headers)
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    let environment_vars_json = serde_json::to_string(&input.environment.vars)
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
    connection.execute(
        r#"
        INSERT INTO request_history (
            request_id,
            method,
            url,
            status,
            duration_ms,
            request_name,
            collection,
            params_json,
            headers_json,
            body,
            auth_type,
            auth_token,
            environment_name,
            environment_source,
            environment_vars_json
        )
        VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)
        "#,
        params![
            input.request_id,
            input.method,
            input.url,
            input.status,
            input.duration_ms,
            input.request_name,
            input.collection,
            params_json,
            headers_json,
            input.body,
            input.auth_type,
            input.auth_token,
            input.environment.name,
            input.environment.file_path,
            environment_vars_json
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

pub fn rename_environment(
    paths: &StoragePaths,
    input: RenameEnvironmentInput,
) -> AppResult<EnvironmentSummary> {
    let current_file_path = resolve_storage_path(&paths.environments_dir, &input.current_file_path);
    if !current_file_path.exists() {
        return Err(AppError::NotFound(format!(
            "environment file does not exist: {}",
            current_file_path.display()
        )));
    }

    let new_file_path = resolve_storage_path(&paths.environments_dir, &input.new_file_path);
    if current_file_path != new_file_path && new_file_path.exists() {
        return Err(AppError::InvalidData(format!(
            "target environment file already exists: {}",
            new_file_path.display()
        )));
    }
    if let Some(parent) = new_file_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut environment = read_environment_file(&current_file_path)?;
    environment.name = input.new_name;
    environment.file_path = new_file_path.to_string_lossy().into_owned();

    let save_input = SaveEnvironmentInput {
        name: environment.name.clone(),
        file_path: environment.file_path.clone(),
        vars: environment.vars.clone(),
    };
    let renamed = save_environment(paths, save_input)?;

    if current_file_path != new_file_path && current_file_path.exists() {
        fs::remove_file(&current_file_path)?;
    }

    Ok(renamed)
}

pub fn delete_environment(paths: &StoragePaths, input: DeleteEnvironmentInput) -> AppResult<()> {
    let file_path = resolve_storage_path(&paths.environments_dir, &input.file_path);
    if !file_path.exists() {
        return Err(AppError::NotFound(format!(
            "environment file does not exist: {}",
            file_path.display()
        )));
    }

    fs::remove_file(&file_path)?;
    Ok(())
}

pub fn save_request(paths: &StoragePaths, input: SaveRequestInput) -> AppResult<CollectionSummary> {
    let file_path = resolve_storage_path(&paths.collections_dir, &input.collection_file);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut collection = if file_path.exists() {
        read_collection_file(&file_path)?
    } else {
        CollectionSummary {
            name: input.collection.clone(),
            file_path: file_path.to_string_lossy().into_owned(),
            requests: Vec::new(),
        }
    };
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
    ensure_workspace_collection_reference(paths, DEFAULT_SETTINGS_WORKSPACE, &file_path)?;

    read_collection_file(&file_path)
}

pub fn create_collection(
    paths: &StoragePaths,
    input: CreateCollectionInput,
) -> AppResult<CollectionSummary> {
    let file_path = resolve_storage_path(&paths.collections_dir, &input.file_path);
    if file_path.exists() {
        return Err(AppError::InvalidData(format!(
            "collection file already exists: {}",
            file_path.display()
        )));
    }
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let collection = CollectionSummary {
        name: input.name,
        file_path: file_path.to_string_lossy().into_owned(),
        requests: Vec::new(),
    };

    write_collection_file(&file_path, &collection)?;
    ensure_workspace_collection_reference(paths, DEFAULT_SETTINGS_WORKSPACE, &file_path)?;
    read_collection_file(&file_path)
}

pub fn rename_collection(
    paths: &StoragePaths,
    input: RenameCollectionInput,
) -> AppResult<CollectionSummary> {
    let current_file_path = resolve_storage_path(&paths.collections_dir, &input.current_file_path);
    if !current_file_path.exists() {
        return Err(AppError::NotFound(format!(
            "collection file does not exist: {}",
            current_file_path.display()
        )));
    }

    let new_file_path = resolve_storage_path(&paths.collections_dir, &input.new_file_path);
    if current_file_path != new_file_path && new_file_path.exists() {
        return Err(AppError::InvalidData(format!(
            "target collection file already exists: {}",
            new_file_path.display()
        )));
    }
    if let Some(parent) = new_file_path.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut collection = read_collection_file(&current_file_path)?;
    collection.name = input.new_name;
    collection.file_path = new_file_path.to_string_lossy().into_owned();
    for request in &mut collection.requests {
        request.collection = collection.name.clone();
        request.collection_file = collection.file_path.clone();
    }

    write_collection_file(&new_file_path, &collection)?;
    if current_file_path != new_file_path && current_file_path.exists() {
        fs::remove_file(&current_file_path)?;
    }

    remove_workspace_collection_reference(paths, DEFAULT_SETTINGS_WORKSPACE, &current_file_path)?;
    ensure_workspace_collection_reference(paths, DEFAULT_SETTINGS_WORKSPACE, &new_file_path)?;

    read_collection_file(&new_file_path)
}

pub fn delete_collection(
    paths: &StoragePaths,
    input: DeleteCollectionInput,
) -> AppResult<()> {
    let file_path = resolve_storage_path(&paths.collections_dir, &input.file_path);
    if !file_path.exists() {
        return Err(AppError::NotFound(format!(
            "collection file does not exist: {}",
            file_path.display()
        )));
    }

    fs::remove_file(&file_path)?;
    remove_workspace_collection_reference(paths, DEFAULT_SETTINGS_WORKSPACE, &file_path)?;
    Ok(())
}

pub fn delete_request(paths: &StoragePaths, input: DeleteRequestInput) -> AppResult<CollectionSummary> {
    let file_path = resolve_storage_path(&paths.collections_dir, &input.collection_file);
    if !file_path.exists() {
        return Err(AppError::NotFound(format!(
            "collection file does not exist: {}",
            file_path.display()
        )));
    }

    let mut collection = read_collection_file(&file_path)?;
    let original_len = collection.requests.len();
    collection
        .requests
        .retain(|request| request.id != input.request_id);

    if collection.requests.len() == original_len {
        return Err(AppError::NotFound(format!(
            "request {} not found in collection {}",
            input.request_id, collection.name
        )));
    }

    write_collection_file(&file_path, &collection)?;
    read_collection_file(&file_path)
}

pub fn move_collection(
    paths: &StoragePaths,
    input: MoveCollectionInput,
) -> AppResult<Vec<CollectionSummary>> {
    let file_path = resolve_storage_path(&paths.collections_dir, &input.file_path);
    if !file_path.exists() {
        return Err(AppError::NotFound(format!(
            "collection file does not exist: {}",
            file_path.display()
        )));
    }

    let mut workspace = read_workspace_file(paths, DEFAULT_SETTINGS_WORKSPACE)?;
    let relative_collection = file_path
        .strip_prefix(&paths.collections_dir)
        .unwrap_or(&file_path)
        .to_string_lossy()
        .into_owned();
    let current_index = workspace
        .collections
        .iter()
        .position(|item| item == &relative_collection)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "collection {} is not referenced by workspace {}",
                relative_collection, DEFAULT_SETTINGS_WORKSPACE
            ))
        })?;

    let entry = workspace.collections.remove(current_index);
    let target_index = input.target_index.min(workspace.collections.len());
    workspace.collections.insert(target_index, entry);
    write_workspace_file(paths, DEFAULT_SETTINGS_WORKSPACE, &workspace)?;

    list_collections(paths, DEFAULT_SETTINGS_WORKSPACE)
}

pub fn reorder_request(
    paths: &StoragePaths,
    input: ReorderRequestInput,
) -> AppResult<CollectionSummary> {
    let file_path = resolve_storage_path(&paths.collections_dir, &input.collection_file);
    if !file_path.exists() {
        return Err(AppError::NotFound(format!(
            "collection file does not exist: {}",
            file_path.display()
        )));
    }

    let mut collection = read_collection_file(&file_path)?;
    let current_index = collection
        .requests
        .iter()
        .position(|request| request.id == input.request_id)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "request {} not found in collection {}",
                input.request_id, collection.name
            ))
        })?;

    let request = collection.requests.remove(current_index);
    let target_index = input.target_index.min(collection.requests.len());
    collection.requests.insert(target_index, request);
    write_collection_file(&file_path, &collection)?;

    read_collection_file(&file_path)
}

pub fn move_request(
    paths: &StoragePaths,
    input: MoveRequestInput,
) -> AppResult<MoveRequestResult> {
    let source_file_path = resolve_storage_path(&paths.collections_dir, &input.source_collection_file);
    if !source_file_path.exists() {
        return Err(AppError::NotFound(format!(
            "source collection file does not exist: {}",
            source_file_path.display()
        )));
    }

    let target_file_path = resolve_storage_path(&paths.collections_dir, &input.target_collection_file);
    if !target_file_path.exists() {
        return Err(AppError::NotFound(format!(
            "target collection file does not exist: {}",
            target_file_path.display()
        )));
    }

    if source_file_path == target_file_path {
        let request_id = input.request_id.clone();
        let reordered = reorder_request(
            paths,
            ReorderRequestInput {
                collection_file: input.source_collection_file,
                request_id,
                target_index: input.target_index,
            },
        )?;
        let moved_request = reordered
            .requests
            .iter()
            .find(|request| request.id == input.request_id)
            .cloned()
            .ok_or_else(|| {
                AppError::NotFound(format!(
                    "request {} not found after reordering collection {}",
                    input.request_id, reordered.name
                ))
            })?;
        return Ok(MoveRequestResult {
            source_collection: reordered.clone(),
            target_collection: reordered,
            moved_request,
        });
    }

    let mut source_collection = read_collection_file(&source_file_path)?;
    let request_index = source_collection
        .requests
        .iter()
        .position(|request| request.id == input.request_id)
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "request {} not found in collection {}",
                input.request_id, source_collection.name
            ))
        })?;
    let mut moved_request = source_collection.requests.remove(request_index);

    let mut target_collection = read_collection_file(&target_file_path)?;
    moved_request.collection = target_collection.name.clone();
    moved_request.collection_file = target_file_path.to_string_lossy().into_owned();
    let target_index = input.target_index.min(target_collection.requests.len());
    target_collection.requests.insert(target_index, moved_request.clone());

    write_collection_file(&source_file_path, &source_collection)?;
    write_collection_file(&target_file_path, &target_collection)?;

    Ok(MoveRequestResult {
        source_collection: read_collection_file(&source_file_path)?,
        target_collection: read_collection_file(&target_file_path)?,
        moved_request,
    })
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

fn ensure_workspace_collection_reference(
    paths: &StoragePaths,
    workspace_name: &str,
    collection_file: &Path,
) -> AppResult<()> {
    let file_name = if workspace_name.ends_with(".json") {
        workspace_name.to_string()
    } else {
        format!("{workspace_name}.json")
    };
    let path = paths.workspaces_dir.join(file_name);
    let mut workspace = if path.exists() {
        let contents = fs::read_to_string(&path)?;
        serde_json::from_str::<WorkspaceFile>(&contents)
            .map_err(|error| AppError::InvalidData(error.to_string()))?
    } else {
        WorkspaceFile {
            collections: Vec::new(),
        }
    };

    let relative_collection = collection_file
        .strip_prefix(&paths.collections_dir)
        .unwrap_or(collection_file)
        .to_string_lossy()
        .into_owned();

    if !workspace.collections.iter().any(|item| item == &relative_collection) {
        workspace.collections.push(relative_collection);
        let payload = serde_json::to_string_pretty(&serde_json::json!({
            "name": "Default Workspace",
            "collections": workspace.collections,
        }))
        .map_err(|error| AppError::InvalidData(error.to_string()))?;
        fs::write(path, format!("{payload}\n"))?;
    }

    Ok(())
}

fn remove_workspace_collection_reference(
    paths: &StoragePaths,
    workspace_name: &str,
    collection_file: &Path,
) -> AppResult<()> {
    let file_name = if workspace_name.ends_with(".json") {
        workspace_name.to_string()
    } else {
        format!("{workspace_name}.json")
    };
    let path = paths.workspaces_dir.join(file_name);
    let mut workspace = if path.exists() {
        let contents = fs::read_to_string(&path)?;
        serde_json::from_str::<WorkspaceFile>(&contents)
            .map_err(|error| AppError::InvalidData(error.to_string()))?
    } else {
        WorkspaceFile {
            collections: Vec::new(),
        }
    };

    let relative_collection = collection_file
        .strip_prefix(&paths.collections_dir)
        .unwrap_or(collection_file)
        .to_string_lossy()
        .into_owned();

    workspace.collections.retain(|item| item != &relative_collection);
    let payload = serde_json::to_string_pretty(&serde_json::json!({
        "name": "Default Workspace",
        "collections": workspace.collections,
    }))
    .map_err(|error| AppError::InvalidData(error.to_string()))?;
    fs::write(path, format!("{payload}\n"))?;
    Ok(())
}

fn write_workspace_file(
    paths: &StoragePaths,
    workspace_name: &str,
    workspace: &WorkspaceFile,
) -> AppResult<()> {
    let file_name = if workspace_name.ends_with(".json") {
        workspace_name.to_string()
    } else {
        format!("{workspace_name}.json")
    };
    let path = paths.workspaces_dir.join(file_name);
    let payload = serde_json::to_string_pretty(&serde_json::json!({
        "name": "Default Workspace",
        "collections": workspace.collections,
    }))
    .map_err(|error| AppError::InvalidData(error.to_string()))?;
    fs::write(path, format!("{payload}\n"))?;
    Ok(())
}

fn write_collection_file(path: &Path, collection: &CollectionSummary) -> AppResult<()> {
    let payload = serde_json::to_string_pretty(&serde_json::json!({
        "name": collection.name,
        "requests": collection.requests,
    }))
    .map_err(|error| AppError::InvalidData(error.to_string()))?;
    fs::write(path, format!("{payload}\n"))?;
    Ok(())
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

#[derive(serde::Deserialize, serde::Serialize)]
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
        fs::create_dir_all(root.join("cache")).expect("create cache dir");
        fs::create_dir_all(root.join("logs")).expect("create logs dir");

        StoragePaths {
            app_data_dir: root.clone(),
            database_path: root.join("api-client.sqlite3"),
            workspaces_dir: root.join("workspaces"),
            collections_dir: root.join("collections"),
            environments_dir: root.join("environments"),
            cache_dir: root.join("cache"),
            logs_dir: root.join("logs"),
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
                request_name: "POST /workspaces/search".to_string(),
                collection: "Core API".to_string(),
                params: vec![crate::models::RequestKeyValue {
                    key: "query".to_string(),
                    value: "workspace".to_string(),
                    enabled: true,
                }],
                headers: vec![crate::models::RequestKeyValue {
                    key: "Accept".to_string(),
                    value: "application/json".to_string(),
                    enabled: true,
                }],
                body: "{\"query\":\"workspace\"}".to_string(),
                auth_type: "bearer".to_string(),
                auth_token: "{{secret.prod_token}}".to_string(),
                environment: EnvironmentSummary {
                    name: "Production".to_string(),
                    file_path: "environments/production.json".to_string(),
                    vars: vec![EnvironmentVariable {
                        key: "base_url".to_string(),
                        value: "https://api.example.com".to_string(),
                    }],
                },
            },
        )
        .expect("record history");

        let history = list_history(&paths).expect("list history");
        assert_eq!(history.len(), 1);
        assert_eq!(history[0].request_id, "req-search");
        assert_eq!(history[0].method, "POST");
        assert_eq!(history[0].request_name, "POST /workspaces/search");
        assert_eq!(history[0].collection, "Core API");
        assert_eq!(history[0].params.len(), 1);
        assert_eq!(history[0].headers.len(), 1);
        assert_eq!(history[0].auth_type, "bearer");
        assert_eq!(history[0].environment_name, "Production");
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
        assert!(columns.iter().any(|column| column == "request_name"));
        assert!(columns.iter().any(|column| column == "params_json"));
        assert!(columns.iter().any(|column| column == "environment_vars_json"));
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
    fn create_collection_persists_empty_collection_and_updates_workspace() {
        let paths = make_test_paths("create-collection");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        let created = create_collection(
            &paths,
            CreateCollectionInput {
                name: "Payments".to_string(),
                file_path: "collections/payments.json".to_string(),
            },
        )
        .expect("create collection");

        assert_eq!(created.name, "Payments");
        assert!(created.requests.is_empty());
        assert!(paths.collections_dir.join("payments.json").exists());

        let workspace_contents =
            fs::read_to_string(paths.workspaces_dir.join("default-workspace.json"))
                .expect("read workspace");
        assert!(workspace_contents.contains("payments.json"));
    }

    #[test]
    fn create_collection_rejects_existing_file() {
        let paths = make_test_paths("create-collection-duplicate");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        create_collection(
            &paths,
            CreateCollectionInput {
                name: "Payments".to_string(),
                file_path: "collections/payments.json".to_string(),
            },
        )
        .expect("create first collection");

        let error = create_collection(
            &paths,
            CreateCollectionInput {
                name: "Payments Again".to_string(),
                file_path: "collections/payments.json".to_string(),
            },
        )
        .expect_err("reject duplicate collection file");

        assert!(error
            .to_string()
            .contains("collection file already exists"));
    }

    #[test]
    fn rename_collection_updates_file_requests_and_workspace_reference() {
        let paths = make_test_paths("rename-collection");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        save_request(
            &paths,
            SaveRequestInput {
                id: "req-payments".to_string(),
                name: "POST /payments".to_string(),
                collection: "Payments".to_string(),
                collection_file: "collections/payments.json".to_string(),
                method: "POST".to_string(),
                url: "http://localhost:3000/payments".to_string(),
                params: vec![],
                headers: vec![],
                body: "{}".to_string(),
                auth_type: "none".to_string(),
                auth_token: "".to_string(),
            },
        )
        .expect("seed payments collection");

        let renamed = rename_collection(
            &paths,
            RenameCollectionInput {
                current_file_path: "collections/payments.json".to_string(),
                new_name: "Billing".to_string(),
                new_file_path: "collections/billing.json".to_string(),
            },
        )
        .expect("rename collection");

        assert_eq!(renamed.name, "Billing");
        assert_eq!(renamed.requests.len(), 1);
        assert_eq!(renamed.requests[0].collection, "Billing");
        assert!(paths.collections_dir.join("billing.json").exists());
        assert!(!paths.collections_dir.join("payments.json").exists());

        let workspace_contents =
            fs::read_to_string(paths.workspaces_dir.join("default-workspace.json"))
                .expect("read workspace");
        assert!(workspace_contents.contains("billing.json"));
        assert!(!workspace_contents.contains("payments.json"));
    }

    #[test]
    fn rename_collection_rejects_existing_target_file() {
        let paths = make_test_paths("rename-collection-duplicate");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        create_collection(
            &paths,
            CreateCollectionInput {
                name: "Payments".to_string(),
                file_path: "collections/payments.json".to_string(),
            },
        )
        .expect("create payments");
        create_collection(
            &paths,
            CreateCollectionInput {
                name: "Billing".to_string(),
                file_path: "collections/billing.json".to_string(),
            },
        )
        .expect("create billing");

        let error = rename_collection(
            &paths,
            RenameCollectionInput {
                current_file_path: "collections/payments.json".to_string(),
                new_name: "Billing".to_string(),
                new_file_path: "collections/billing.json".to_string(),
            },
        )
        .expect_err("reject duplicate target file");

        assert!(error
            .to_string()
            .contains("target collection file already exists"));
    }

    #[test]
    fn delete_collection_removes_file_and_workspace_reference() {
        let paths = make_test_paths("delete-collection");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        create_collection(
            &paths,
            CreateCollectionInput {
                name: "Archive".to_string(),
                file_path: "collections/archive.json".to_string(),
            },
        )
        .expect("create collection");

        delete_collection(
            &paths,
            DeleteCollectionInput {
                file_path: "collections/archive.json".to_string(),
            },
        )
        .expect("delete collection");

        assert!(!paths.collections_dir.join("archive.json").exists());
        let workspace_contents =
            fs::read_to_string(paths.workspaces_dir.join("default-workspace.json"))
                .expect("read workspace");
        assert!(!workspace_contents.contains("archive.json"));
    }

    #[test]
    fn delete_request_removes_request_from_collection_file() {
        let paths = make_test_paths("delete-request");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        save_request(
            &paths,
            SaveRequestInput {
                id: "req-1".to_string(),
                name: "GET /one".to_string(),
                collection: "Core API".to_string(),
                collection_file: "collections/core-api.json".to_string(),
                method: "GET".to_string(),
                url: "http://localhost:3000/one".to_string(),
                params: vec![],
                headers: vec![],
                body: "".to_string(),
                auth_type: "none".to_string(),
                auth_token: "".to_string(),
            },
        )
        .expect("save first request");

        save_request(
            &paths,
            SaveRequestInput {
                id: "req-2".to_string(),
                name: "GET /two".to_string(),
                collection: "Core API".to_string(),
                collection_file: "collections/core-api.json".to_string(),
                method: "GET".to_string(),
                url: "http://localhost:3000/two".to_string(),
                params: vec![],
                headers: vec![],
                body: "".to_string(),
                auth_type: "none".to_string(),
                auth_token: "".to_string(),
            },
        )
        .expect("save second request");

        let collection = delete_request(
            &paths,
            DeleteRequestInput {
                request_id: "req-1".to_string(),
                collection_file: "collections/core-api.json".to_string(),
            },
        )
        .expect("delete request");

        assert_eq!(collection.requests.len(), 1);
        assert_eq!(collection.requests[0].id, "req-2");

        let reloaded =
            read_collection_file(&paths.collections_dir.join("core-api.json"))
                .expect("reload collection");
        assert_eq!(reloaded.requests.len(), 1);
        assert_eq!(reloaded.requests[0].id, "req-2");
    }

    #[test]
    fn move_collection_updates_workspace_order() {
        let paths = make_test_paths("move-collection-order");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        create_collection(
            &paths,
            CreateCollectionInput {
                name: "Alpha".to_string(),
                file_path: "collections/alpha.json".to_string(),
            },
        )
        .expect("create alpha");
        create_collection(
            &paths,
            CreateCollectionInput {
                name: "Bravo".to_string(),
                file_path: "collections/bravo.json".to_string(),
            },
        )
        .expect("create bravo");
        create_collection(
            &paths,
            CreateCollectionInput {
                name: "Charlie".to_string(),
                file_path: "collections/charlie.json".to_string(),
            },
        )
        .expect("create charlie");

        let collections = move_collection(
            &paths,
            MoveCollectionInput {
                file_path: "collections/charlie.json".to_string(),
                target_index: 0,
            },
        )
        .expect("move collection");

        assert_eq!(collections[0].name, "Charlie");
        let workspace = read_workspace_file(&paths, DEFAULT_SETTINGS_WORKSPACE).expect("read workspace");
        assert_eq!(
            workspace.collections,
            vec![
                "charlie.json".to_string(),
                "alpha.json".to_string(),
                "bravo.json".to_string()
            ]
        );
    }

    #[test]
    fn reorder_request_updates_request_order_in_collection_file() {
        let paths = make_test_paths("reorder-request");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        for (id, name) in [
            ("req-1", "GET /one"),
            ("req-2", "GET /two"),
            ("req-3", "GET /three"),
        ] {
            save_request(
                &paths,
                SaveRequestInput {
                    id: id.to_string(),
                    name: name.to_string(),
                    collection: "Core API".to_string(),
                    collection_file: "collections/core-api.json".to_string(),
                    method: "GET".to_string(),
                    url: format!("http://localhost:3000/{id}"),
                    params: vec![],
                    headers: vec![],
                    body: "".to_string(),
                    auth_type: "none".to_string(),
                    auth_token: "".to_string(),
                },
            )
            .expect("seed request");
        }

        let reordered = reorder_request(
            &paths,
            ReorderRequestInput {
                collection_file: "collections/core-api.json".to_string(),
                request_id: "req-3".to_string(),
                target_index: 0,
            },
        )
        .expect("reorder request");

        assert_eq!(reordered.requests[0].id, "req-3");
        let reloaded =
            read_collection_file(&paths.collections_dir.join("core-api.json"))
                .expect("reload collection");
        assert_eq!(reloaded.requests[0].id, "req-3");
        assert_eq!(reloaded.requests[1].id, "req-1");
        assert_eq!(reloaded.requests[2].id, "req-2");
    }

    #[test]
    fn move_request_transfers_request_between_collections() {
        let paths = make_test_paths("move-request-between-collections");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        save_request(
            &paths,
            SaveRequestInput {
                id: "req-source".to_string(),
                name: "GET /source".to_string(),
                collection: "Source".to_string(),
                collection_file: "collections/source.json".to_string(),
                method: "GET".to_string(),
                url: "http://localhost:3000/source".to_string(),
                params: vec![],
                headers: vec![],
                body: "".to_string(),
                auth_type: "none".to_string(),
                auth_token: "".to_string(),
            },
        )
        .expect("seed source request");
        save_request(
            &paths,
            SaveRequestInput {
                id: "req-target".to_string(),
                name: "GET /target".to_string(),
                collection: "Target".to_string(),
                collection_file: "collections/target.json".to_string(),
                method: "GET".to_string(),
                url: "http://localhost:3000/target".to_string(),
                params: vec![],
                headers: vec![],
                body: "".to_string(),
                auth_type: "none".to_string(),
                auth_token: "".to_string(),
            },
        )
        .expect("seed target request");

        let moved = move_request(
            &paths,
            MoveRequestInput {
                request_id: "req-source".to_string(),
                source_collection_file: "collections/source.json".to_string(),
                target_collection_file: "collections/target.json".to_string(),
                target_index: 0,
            },
        )
        .expect("move request");

        assert_eq!(moved.moved_request.collection, "Target");
        assert_eq!(moved.source_collection.requests.len(), 0);
        assert_eq!(moved.target_collection.requests[0].id, "req-source");
        assert_eq!(moved.target_collection.requests[0].collection, "Target");

        let source_reloaded =
            read_collection_file(&paths.collections_dir.join("source.json"))
                .expect("reload source collection");
        let target_reloaded =
            read_collection_file(&paths.collections_dir.join("target.json"))
                .expect("reload target collection");
        assert!(source_reloaded.requests.is_empty());
        assert_eq!(target_reloaded.requests[0].id, "req-source");
        assert_eq!(target_reloaded.requests[1].id, "req-target");
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
    fn seed_files_create_empty_default_workspace_without_sample_data() {
        let paths = make_test_paths("empty-workspace-seed");
        ensure_seed_files(&paths).expect("seed files");

        let workspace_contents =
            fs::read_to_string(paths.workspaces_dir.join("default-workspace.json"))
                .expect("read workspace seed");
        assert!(workspace_contents.contains("\"collections\": []"));
        assert!(workspace_contents.contains("\"environments\": []"));
        assert!(!paths.collections_dir.join("core-api.json").exists());
        assert!(!paths.collections_dir.join("auth.json").exists());
        assert!(!paths.environments_dir.join("production.json").exists());
        assert!(!paths.environments_dir.join("local.yaml").exists());
    }

    #[test]
    fn save_request_creates_collection_file_and_updates_default_workspace() {
        let paths = make_test_paths("save-request-bootstrap");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        let saved = save_request(
            &paths,
            SaveRequestInput {
                id: "req-first".to_string(),
                name: "GET /first".to_string(),
                collection: "First Collection".to_string(),
                collection_file: "collections/first-collection.json".to_string(),
                method: "GET".to_string(),
                url: "http://localhost:3000/first".to_string(),
                params: vec![],
                headers: vec![],
                body: "".to_string(),
                auth_type: "none".to_string(),
                auth_token: "".to_string(),
            },
        )
        .expect("save first request");

        assert_eq!(saved.name, "First Collection");
        assert_eq!(saved.requests.len(), 1);
        assert!(paths.collections_dir.join("first-collection.json").exists());

        let workspace_contents =
            fs::read_to_string(paths.workspaces_dir.join("default-workspace.json"))
                .expect("read updated workspace");
        assert!(workspace_contents.contains("first-collection.json"));
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
    fn rename_environment_updates_name_and_file_path() {
        let paths = make_test_paths("rename-environment");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

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
        .expect("seed environment");

        let renamed = rename_environment(
            &paths,
            RenameEnvironmentInput {
                current_file_path: "environments/production.json".to_string(),
                new_name: "Staging".to_string(),
                new_file_path: "environments/staging.yaml".to_string(),
            },
        )
        .expect("rename environment");

        assert_eq!(renamed.name, "Staging");
        assert_eq!(renamed.file_path, paths.environments_dir.join("staging.yaml").to_string_lossy());
        assert_eq!(renamed.vars.len(), 1);
        assert!(paths.environments_dir.join("staging.yaml").exists());
        assert!(!paths.environments_dir.join("production.json").exists());
    }

    #[test]
    fn rename_environment_rejects_existing_target_file() {
        let paths = make_test_paths("rename-environment-duplicate");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        save_environment(
            &paths,
            SaveEnvironmentInput {
                name: "Production".to_string(),
                file_path: "environments/production.json".to_string(),
                vars: vec![],
            },
        )
        .expect("seed production");
        save_environment(
            &paths,
            SaveEnvironmentInput {
                name: "Staging".to_string(),
                file_path: "environments/staging.json".to_string(),
                vars: vec![],
            },
        )
        .expect("seed staging");

        let error = rename_environment(
            &paths,
            RenameEnvironmentInput {
                current_file_path: "environments/production.json".to_string(),
                new_name: "Staging".to_string(),
                new_file_path: "environments/staging.json".to_string(),
            },
        )
        .expect_err("reject duplicate environment target");

        assert!(error
            .to_string()
            .contains("target environment file already exists"));
    }

    #[test]
    fn delete_environment_removes_file() {
        let paths = make_test_paths("delete-environment");
        ensure_directories(&paths).expect("create directories");
        ensure_seed_files(&paths).expect("seed workspace");

        save_environment(
            &paths,
            SaveEnvironmentInput {
                name: "Archive".to_string(),
                file_path: "environments/archive.json".to_string(),
                vars: vec![],
            },
        )
        .expect("seed archive environment");

        delete_environment(
            &paths,
            DeleteEnvironmentInput {
                file_path: "environments/archive.json".to_string(),
            },
        )
        .expect("delete environment");

        assert!(!paths.environments_dir.join("archive.json").exists());
    }

    #[test]
    fn runtime_cache_and_logs_initialize_write_and_summarize() {
        let paths = make_test_paths("runtime-cache-logs");
        initialize_runtime_files(&paths).expect("initialize runtime files");

        let initial = runtime_summary(&paths).expect("read initial runtime summary");
        assert!(paths.cache_dir.exists());
        assert!(paths.logs_dir.exists());
        assert!(paths.cache_dir.join(CACHE_INDEX_FILE_NAME).exists());
        assert!(paths.logs_dir.join(ACTIVE_LOG_FILE_NAME).exists());
        assert_eq!(initial.cache.entries, 0);
        assert!(initial.logs.size_bytes > 0);

        let cache = record_cache_entry(
            &paths,
            "bootstrap-state",
            "metadata",
            512,
            "2 collections / 3 environments / 4 history rows",
        )
        .expect("record cache entry");
        assert_eq!(cache.entries, 1);
        assert!(cache.size_bytes > 0);

        append_log_entry(
            &paths,
            "load_bootstrap_state",
            "completed",
            "Loaded\nworkspace token=abc123",
            Some("detail\twith whitespace authorization: Bearer secret"),
        )
        .expect("append log entry");

        let summary = runtime_summary(&paths).expect("read runtime summary");
        assert_eq!(summary.cache.entries, 1);
        assert!(summary.cache.index_file.ends_with(CACHE_INDEX_FILE_NAME));
        assert!(summary.logs.active_file.ends_with(ACTIVE_LOG_FILE_NAME));
        assert!(summary.logs.last_line.contains("load_bootstrap_state"));
        assert!(summary.logs.last_line.contains("Loaded workspace"));
        assert!(summary.logs.last_line.contains("detail with whitespace"));
        assert!(summary.logs.last_line.contains("token=***"));
        assert!(summary.logs.last_line.contains("authorization:***"));
        assert!(!summary.logs.last_line.contains("abc123"));
        assert!(!summary.logs.last_line.contains("secret"));

        let cache_payload =
            fs::read_to_string(paths.cache_dir.join(CACHE_INDEX_FILE_NAME)).expect("read cache");
        assert!(cache_payload.contains("\"bootstrap-state\""));
        let log_payload =
            fs::read_to_string(paths.logs_dir.join(ACTIVE_LOG_FILE_NAME)).expect("read log");
        assert!(log_payload.contains("runtime\tinitialized"));
        assert!(log_payload.contains("load_bootstrap_state\tcompleted"));
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
