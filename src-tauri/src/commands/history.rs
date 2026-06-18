use std::sync::Mutex;
use rusqlite::Connection;
use tauri::{AppHandle, Manager};
use crate::AppError;

/// Managed Tauri state wrapping the single `history.db` connection.
pub struct HistoryDb(pub Mutex<Connection>);

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Io(std::io::Error::other(e.to_string()))
    }
}

pub fn init_db(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS chat_kv (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_chat_kv_key_prefix ON chat_kv(key);"
    )
}

pub fn db_get(conn: &Connection, key: &str) -> rusqlite::Result<Option<String>> {
    conn.query_row(
        "SELECT value FROM chat_kv WHERE key = ?1",
        [key],
        |row| row.get(0),
    ).map(Some).or_else(|e| match e {
        rusqlite::Error::QueryReturnedNoRows => Ok(None),
        other => Err(other),
    })
}

pub fn db_set(conn: &Connection, key: &str, value: &str) -> rusqlite::Result<()> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    conn.execute(
        "INSERT INTO chat_kv (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        rusqlite::params![key, value, now_ms],
    )?;
    Ok(())
}

pub fn db_delete(conn: &Connection, key: &str) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM chat_kv WHERE key = ?1", [key])?;
    Ok(())
}

#[derive(serde::Serialize)]
pub struct HistoryKeyMeta {
    pub key: String,
    pub updated_at: i64,
}

pub fn db_list_keys(conn: &Connection, prefix: &str) -> rusqlite::Result<Vec<HistoryKeyMeta>> {
    let like_pattern = format!("{prefix}%");
    let mut stmt = conn.prepare("SELECT key, updated_at FROM chat_kv WHERE key LIKE ?1")?;
    let rows = stmt.query_map([like_pattern], |row| {
        Ok(HistoryKeyMeta { key: row.get(0)?, updated_at: row.get(1)? })
    })?;
    rows.collect()
}

// ─── Tauri commands ────────────────────────────────────────────────────────

#[tauri::command]
pub async fn history_get(key: String, state: tauri::State<'_, HistoryDb>) -> Result<Option<String>, AppError> {
    let conn = state.0.lock().unwrap();
    Ok(db_get(&conn, &key)?)
}

#[tauri::command]
pub async fn history_set(key: String, value: String, state: tauri::State<'_, HistoryDb>) -> Result<(), AppError> {
    let conn = state.0.lock().unwrap();
    db_set(&conn, &key, &value)?;
    Ok(())
}

#[tauri::command]
pub async fn history_delete(key: String, state: tauri::State<'_, HistoryDb>) -> Result<(), AppError> {
    let conn = state.0.lock().unwrap();
    db_delete(&conn, &key)?;
    Ok(())
}

#[tauri::command]
pub async fn history_list_keys(prefix: String, state: tauri::State<'_, HistoryDb>) -> Result<Vec<HistoryKeyMeta>, AppError> {
    let conn = state.0.lock().unwrap();
    Ok(db_list_keys(&conn, &prefix)?)
}

// ─── Migration: sweep legacy .chat.json / .compaction.json / .session.json
//     / chats-archive.json files into chat_kv, once, then delete originals ───

/// Classifies whether a project-relative path is one of the legacy chat
/// sidecar files this migration cares about. Pure function — unit tested
/// below without needing a filesystem or AppHandle.
pub fn is_legacy_chat_file(name: &str) -> bool {
    name.ends_with(".chat.json")
        || name == "chat.json"
        || name.ends_with(".compaction.json")
        || name.ends_with(".session.json")
        || name == "chats-archive.json"
}

// `migrate_legacy_files` holds the DB mutex for the whole sweep — it's a
// one-time, fast, startup-only operation, so holding the lock avoids
// partial-write races without needing finer-grained locking.
pub async fn migrate_legacy_files(app: &AppHandle) -> Result<u32, AppError> {
    let conn_state = app.state::<HistoryDb>();
    let conn = conn_state.0.lock().unwrap();
    if db_get(&conn, "_meta:migrated_v1")?.is_some() {
        return Ok(0);
    }

    let projects_root = crate::app_data_dir(app)?.join("projects");
    let mut migrated = 0u32;
    if projects_root.is_dir() {
        let mut project_dirs = std::fs::read_dir(&projects_root).map_err(AppError::Io)?;
        while let Some(Ok(project_entry)) = project_dirs.next() {
            if !project_entry.file_type().map(|t| t.is_dir()).unwrap_or(false) { continue; }
            migrated += migrate_one_project(&conn, &project_entry.path(), &projects_root)?;
        }
    }
    db_set(&conn, "_meta:migrated_v1", "done")?;
    Ok(migrated)
}

fn migrate_one_project(conn: &Connection, project_dir: &std::path::Path, projects_root: &std::path::Path) -> Result<u32, AppError> {
    let mut count = 0u32;
    count += migrate_files_in_dir(conn, project_dir, projects_root)?;
    for sub in ["wizard", "screens", "components", "themes", "plans"] {
        let dir = project_dir.join(sub);
        if !dir.is_dir() { continue; }
        count += migrate_files_in_dir(conn, &dir, projects_root)?;
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                if entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    count += migrate_files_in_dir(conn, &entry.path(), projects_root)?;
                }
            }
        }
    }
    Ok(count)
}

fn migrate_files_in_dir(conn: &Connection, dir: &std::path::Path, projects_root: &std::path::Path) -> Result<u32, AppError> {
    let mut count = 0u32;
    let entries = match std::fs::read_dir(dir) { Ok(e) => e, Err(_) => return Ok(0) };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) { continue; }
        if !is_legacy_chat_file(&name) { continue; }
        let full_path = entry.path();
        let content = match std::fs::read_to_string(&full_path) { Ok(c) => c, Err(_) => continue };
        let parent_of_root = match projects_root.parent() { Some(p) => p, None => continue };
        let rel_key = full_path.strip_prefix(parent_of_root).unwrap_or(&full_path).to_string_lossy().replace('\\', "/");
        db_set(conn, &rel_key, &content)?;
        let _ = std::fs::remove_file(&full_path);
        count += 1;
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_conn() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        init_db(&conn).unwrap();
        conn
    }

    #[test]
    fn get_returns_none_for_missing_key() {
        let conn = test_conn();
        assert_eq!(db_get(&conn, "missing").unwrap(), None);
    }

    #[test]
    fn set_then_get_roundtrips() {
        let conn = test_conn();
        db_set(&conn, "projects/foo/plans/bar.chat.json", "[]").unwrap();
        assert_eq!(db_get(&conn, "projects/foo/plans/bar.chat.json").unwrap(), Some("[]".to_string()));
    }

    #[test]
    fn set_twice_overwrites() {
        let conn = test_conn();
        db_set(&conn, "k", "v1").unwrap();
        db_set(&conn, "k", "v2").unwrap();
        assert_eq!(db_get(&conn, "k").unwrap(), Some("v2".to_string()));
    }

    #[test]
    fn delete_removes_key() {
        let conn = test_conn();
        db_set(&conn, "k", "v").unwrap();
        db_delete(&conn, "k").unwrap();
        assert_eq!(db_get(&conn, "k").unwrap(), None);
    }

    #[test]
    fn list_keys_filters_by_prefix() {
        let conn = test_conn();
        db_set(&conn, "projects/a/plans/x.chat.json", "[]").unwrap();
        db_set(&conn, "projects/a/plans/y.chat.json", "[]").unwrap();
        db_set(&conn, "projects/b/plans/z.chat.json", "[]").unwrap();
        let keys = db_list_keys(&conn, "projects/a/").unwrap();
        assert_eq!(keys.len(), 2);
        assert!(keys.iter().all(|k| k.key.starts_with("projects/a/")));
    }

    #[test]
    fn classifies_legacy_chat_filenames() {
        assert!(is_legacy_chat_file("foo.chat.json"));
        assert!(is_legacy_chat_file("chat.json"));
        assert!(is_legacy_chat_file("foo.compaction.json"));
        assert!(is_legacy_chat_file("foo.session.json"));
        assert!(is_legacy_chat_file("chats-archive.json"));
        assert!(!is_legacy_chat_file("foo.md"));
        assert!(!is_legacy_chat_file("settings.json"));
    }
}
