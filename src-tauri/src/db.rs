use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

use crate::storage;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HistoryEntry {
    pub id: String,
    pub name: String,
    pub method: String,
    pub url: String,
    pub headers: String,   // JSON string
    pub params: String,    // JSON string
    pub body: String,
    pub body_type: String,
    pub response_status: Option<u16>,
    pub response_time_ms: Option<u64>,
    pub created_at: i64,
    pub updated_at: i64,
    /// Workspace this history entry belongs to. `None` on legacy rows;
    /// `migrate_legacy_history_to_workspace` stamps them at startup.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub workspace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SettingEntry {
    pub key: String,
    pub value: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CookieEntry {
    pub id: String,
    pub domain: String,
    pub name: String,
    pub value: String,
    pub path: String,
    pub expires: Option<i64>,
    pub secure: bool,
    pub http_only: bool,
    pub created_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RecentEntry {
    pub id: String,
    pub item_type: String,  // "request" | "collection" | "environment"
    pub item_id: String,
    pub name: String,
    pub opened_at: i64,
}

pub struct Database {
    conn: Mutex<Connection>,
}

impl Database {
    pub fn new() -> Result<Self, String> {
        let db_path = Self::db_path()?;
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create db directory: {}", e))?;
        }

        let conn = Connection::open(&db_path)
            .map_err(|e| format!("Failed to open database: {}", e))?;

        let db = Database {
            conn: Mutex::new(conn),
        };
        db.init_tables()?;
        Ok(db)
    }

    fn db_path() -> Result<PathBuf, String> {
        let base = storage::app_data_dir()?;
        Ok(base.join("api-client.db"))
    }

    fn init_tables(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS history (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL DEFAULT 'Untitled',
                method TEXT NOT NULL DEFAULT 'GET',
                url TEXT NOT NULL DEFAULT '',
                headers TEXT NOT NULL DEFAULT '[]',
                params TEXT NOT NULL DEFAULT '[]',
                body TEXT NOT NULL DEFAULT '',
                body_type TEXT NOT NULL DEFAULT 'none',
                response_status INTEGER,
                response_time_ms INTEGER,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_history_updated ON history(updated_at DESC);
            CREATE INDEX IF NOT EXISTS idx_history_url ON history(url);
            CREATE INDEX IF NOT EXISTS idx_history_workspace ON history(workspace_id);

            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS cookies (
                id TEXT PRIMARY KEY,
                domain TEXT NOT NULL,
                name TEXT NOT NULL,
                value TEXT NOT NULL,
                path TEXT NOT NULL DEFAULT '/',
                expires INTEGER,
                secure INTEGER NOT NULL DEFAULT 0,
                http_only INTEGER NOT NULL DEFAULT 0,
                created_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_cookies_domain ON cookies(domain);

            CREATE TABLE IF NOT EXISTS recent_opened (
                id TEXT PRIMARY KEY,
                item_type TEXT NOT NULL,
                item_id TEXT NOT NULL,
                name TEXT NOT NULL,
                opened_at INTEGER NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_recent_opened ON recent_opened(opened_at DESC);
            ",
        )
        .map_err(|e| format!("Failed to initialize tables: {}", e))?;

        // Backfill: add workspace_id column to legacy history tables. Wrapped
        // in a transaction-safe check so we don't fail when the column
        // already exists.
        let has_col: bool = {
            let mut stmt = conn
                .prepare("SELECT 1 FROM pragma_table_info('history') WHERE name = 'workspace_id'")
                .map_err(|e| format!("Failed to check workspace_id column: {}", e))?;
            stmt.exists([])
                .map_err(|e| format!("Failed to check workspace_id column: {}", e))?
        };
        if !has_col {
            conn.execute("ALTER TABLE history ADD COLUMN workspace_id TEXT", [])
                .map_err(|e| format!("Failed to add workspace_id column: {}", e))?;
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_history_workspace ON history(workspace_id)",
                [],
            )
            .map_err(|e| format!("Failed to create workspace index: {}", e))?;
        }
        Ok(())
    }

    // === History ===

    pub fn save_history(&self, entry: &HistoryEntry) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO history (id, name, method, url, headers, params, body, body_type, response_status, response_time_ms, created_at, updated_at, workspace_id)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
            params![
                entry.id,
                entry.name,
                entry.method,
                entry.url,
                entry.headers,
                entry.params,
                entry.body,
                entry.body_type,
                entry.response_status,
                entry.response_time_ms,
                entry.created_at,
                entry.updated_at,
                entry.workspace_id,
            ],
        )
        .map_err(|e| format!("Failed to save history: {}", e))?;
        Ok(())
    }

    /// Fetch history rows. When `workspace_id` is `Some`, only rows whose
    /// `workspace_id` matches OR is NULL (legacy, unmigrated) are returned.
    pub fn get_history(
        &self,
        workspace_id: Option<&str>,
        limit: usize,
        offset: usize,
    ) -> Result<Vec<HistoryEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let limit = limit as i64;
        let offset = offset as i64;
        let mut entries = Vec::new();
        match workspace_id {
            Some(ws) => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, method, url, headers, params, body, body_type, response_status, response_time_ms, created_at, updated_at, workspace_id
                         FROM history WHERE workspace_id IS NULL OR workspace_id = ?1
                         ORDER BY updated_at DESC LIMIT ?2 OFFSET ?3",
                    )
                    .map_err(|e| format!("Failed to prepare query: {}", e))?;
                let rows = stmt
                    .query_map(params![ws, limit, offset], row_to_history)
                    .map_err(|e| format!("Failed to query history: {}", e))?;
                for row in rows {
                    entries.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
                }
            }
            None => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, method, url, headers, params, body, body_type, response_status, response_time_ms, created_at, updated_at, workspace_id
                         FROM history ORDER BY updated_at DESC LIMIT ?1 OFFSET ?2",
                    )
                    .map_err(|e| format!("Failed to prepare query: {}", e))?;
                let rows = stmt
                    .query_map(params![limit, offset], row_to_history)
                    .map_err(|e| format!("Failed to query history: {}", e))?;
                for row in rows {
                    entries.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
                }
            }
        }
        Ok(entries)
    }

    pub fn delete_history(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM history WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete history: {}", e))?;
        Ok(())
    }

    pub fn clear_history(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM history", [])
            .map_err(|e| format!("Failed to clear history: {}", e))?;
        Ok(())
    }

    pub fn search_history(
        &self,
        workspace_id: Option<&str>,
        query: &str,
    ) -> Result<Vec<HistoryEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let pattern = format!("%{}%", query);
        let mut entries = Vec::new();
        match workspace_id {
            Some(ws) => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, method, url, headers, params, body, body_type, response_status, response_time_ms, created_at, updated_at, workspace_id
                         FROM history WHERE (url LIKE ?1 OR name LIKE ?1) AND (workspace_id IS NULL OR workspace_id = ?2)
                         ORDER BY updated_at DESC LIMIT 50",
                    )
                    .map_err(|e| format!("Failed to prepare search: {}", e))?;
                let rows = stmt
                    .query_map(params![pattern, ws], row_to_history)
                    .map_err(|e| format!("Failed to search history: {}", e))?;
                for row in rows {
                    entries.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
                }
            }
            None => {
                let mut stmt = conn
                    .prepare(
                        "SELECT id, name, method, url, headers, params, body, body_type, response_status, response_time_ms, created_at, updated_at, workspace_id
                         FROM history WHERE url LIKE ?1 OR name LIKE ?1 ORDER BY updated_at DESC LIMIT 50",
                    )
                    .map_err(|e| format!("Failed to prepare search: {}", e))?;
                let rows = stmt
                    .query_map(params![pattern], row_to_history)
                    .map_err(|e| format!("Failed to search history: {}", e))?;
                for row in rows {
                    entries.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
                }
            }
        }
        Ok(entries)
    }

    /// Stamp every history row with `workspace_id IS NULL` to the given id.
    /// Used at startup so legacy rows migrate into the default workspace.
    pub fn migrate_legacy_history_to_workspace(&self, workspace_id: &str) -> Result<usize, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let updated = conn
            .execute(
                "UPDATE history SET workspace_id = ?1 WHERE workspace_id IS NULL",
                params![workspace_id],
            )
            .map_err(|e| format!("Failed to migrate legacy history: {}", e))?;
        Ok(updated)
    }

    /// Delete all history rows belonging to a workspace. Called when the
    /// workspace itself is deleted.
    pub fn delete_workspace_history(&self, workspace_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM history WHERE workspace_id = ?1",
            params![workspace_id],
        )
        .map_err(|e| format!("Failed to delete workspace history: {}", e))?;
        Ok(())
    }

    pub fn clear_workspace_history(&self, workspace_id: &str) -> Result<(), String> {
        self.delete_workspace_history(workspace_id)
    }

    // === Settings ===

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
            params![key, value],
        )
        .map_err(|e| format!("Failed to save setting: {}", e))?;
        Ok(())
    }

    pub fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let result = conn.query_row(
            "SELECT value FROM settings WHERE key = ?1",
            params![key],
            |row| row.get(0),
        );
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(format!("Failed to get setting: {}", e)),
        }
    }

    pub fn get_all_settings(&self) -> Result<Vec<SettingEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT key, value FROM settings")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(SettingEntry {
                    key: row.get(0)?,
                    value: row.get(1)?,
                })
            })
            .map_err(|e| format!("Failed to query settings: {}", e))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }
        Ok(entries)
    }

    pub fn delete_setting(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM settings WHERE key = ?1", params![key])
            .map_err(|e| format!("Failed to delete setting: {}", e))?;
        Ok(())
    }

    // === Cookies ===

    pub fn save_cookie(&self, cookie: &CookieEntry) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO cookies (id, domain, name, value, path, expires, secure, http_only, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                cookie.id,
                cookie.domain,
                cookie.name,
                cookie.value,
                cookie.path,
                cookie.expires,
                cookie.secure as i32,
                cookie.http_only as i32,
                cookie.created_at,
            ],
        )
        .map_err(|e| format!("Failed to save cookie: {}", e))?;
        Ok(())
    }

    pub fn get_cookies_by_domain(&self, domain: &str) -> Result<Vec<CookieEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, domain, name, value, path, expires, secure, http_only, created_at FROM cookies WHERE domain = ?1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map(params![domain], |row| {
                Ok(CookieEntry {
                    id: row.get(0)?,
                    domain: row.get(1)?,
                    name: row.get(2)?,
                    value: row.get(3)?,
                    path: row.get(4)?,
                    expires: row.get(5)?,
                    secure: row.get::<_, i32>(6)? != 0,
                    http_only: row.get::<_, i32>(7)? != 0,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|e| format!("Failed to query cookies: {}", e))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }
        Ok(entries)
    }

    pub fn get_all_cookies(&self) -> Result<Vec<CookieEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, domain, name, value, path, expires, secure, http_only, created_at FROM cookies ORDER BY domain, name")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map([], |row| {
                Ok(CookieEntry {
                    id: row.get(0)?,
                    domain: row.get(1)?,
                    name: row.get(2)?,
                    value: row.get(3)?,
                    path: row.get(4)?,
                    expires: row.get(5)?,
                    secure: row.get::<_, i32>(6)? != 0,
                    http_only: row.get::<_, i32>(7)? != 0,
                    created_at: row.get(8)?,
                })
            })
            .map_err(|e| format!("Failed to query cookies: {}", e))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }
        Ok(entries)
    }

    pub fn delete_cookie(&self, id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM cookies WHERE id = ?1", params![id])
            .map_err(|e| format!("Failed to delete cookie: {}", e))?;
        Ok(())
    }

    pub fn clear_cookies_by_domain(&self, domain: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM cookies WHERE domain = ?1", params![domain])
            .map_err(|e| format!("Failed to clear cookies: {}", e))?;
        Ok(())
    }

    // === Recent Opened ===

    pub fn add_recent(&self, entry: &RecentEntry) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT OR REPLACE INTO recent_opened (id, item_type, item_id, name, opened_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                entry.id,
                entry.item_type,
                entry.item_id,
                entry.name,
                entry.opened_at,
            ],
        )
        .map_err(|e| format!("Failed to add recent: {}", e))?;

        // Keep only the last 30 entries
        conn.execute(
            "DELETE FROM recent_opened WHERE id NOT IN (SELECT id FROM recent_opened ORDER BY opened_at DESC LIMIT 30)",
            [],
        )
        .map_err(|e| format!("Failed to trim recent: {}", e))?;
        Ok(())
    }

    pub fn get_recent(&self, limit: usize) -> Result<Vec<RecentEntry>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare("SELECT id, item_type, item_id, name, opened_at FROM recent_opened ORDER BY opened_at DESC LIMIT ?1")
            .map_err(|e| format!("Failed to prepare query: {}", e))?;

        let rows = stmt
            .query_map(params![limit as i64], |row| {
                Ok(RecentEntry {
                    id: row.get(0)?,
                    item_type: row.get(1)?,
                    item_id: row.get(2)?,
                    name: row.get(3)?,
                    opened_at: row.get(4)?,
                })
            })
            .map_err(|e| format!("Failed to query recent: {}", e))?;

        let mut entries = Vec::new();
        for row in rows {
            entries.push(row.map_err(|e| format!("Failed to read row: {}", e))?);
        }
        Ok(entries)
    }

    pub fn clear_recent(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM recent_opened", [])
            .map_err(|e| format!("Failed to clear recent: {}", e))?;
        Ok(())
    }
}

/// Row mapper for `history` queries. Shared by `get_history` and
/// `search_history` so the column order stays in sync.
fn row_to_history(row: &rusqlite::Row<'_>) -> rusqlite::Result<HistoryEntry> {
    Ok(HistoryEntry {
        id: row.get(0)?,
        name: row.get(1)?,
        method: row.get(2)?,
        url: row.get(3)?,
        headers: row.get(4)?,
        params: row.get(5)?,
        body: row.get(6)?,
        body_type: row.get(7)?,
        response_status: row.get(8)?,
        response_time_ms: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        workspace_id: row.get(12)?,
    })
}
