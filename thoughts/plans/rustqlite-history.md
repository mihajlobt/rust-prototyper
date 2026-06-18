# rusqlite-backed chat history Implementation Plan

**Goal:** Replace the per-entity `.chat.json` / `.compaction.json` / `.session.json` filesystem sidecars (used by Plans, Wizard, Screens, Components, Themes) with a single SQLite-backed key/value store via `rusqlite`, with zero behavior change for the five panels and a one-time automatic migration of existing files into the DB on first launch.

**Architecture:** One `history.db` SQLite file in the Tauri app-data dir (same place `settings.json`/`bonsai_config.json` already live), holding one table `chat_kv(key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`. The existing per-entity path strings (`projects/{project}/plans/{slug}.chat.json`, etc.) become the `key` column verbatim — this means the only code that changes is the storage backend behind 4 frontend files (`useChat.ts`, `sessionSnapshot.ts`, `compactSummary.ts`, `streamHandler.ts`) plus `SidebarChatsTab.tsx` (which discovers/displays chat history by reading the same files). No panel component, no entity-ID scheme, and no `UseChatOptions` field changes. A one-time Rust-side migration sweeps every project's existing `.chat.json`/`.compaction.json`/`.session.json`/`chats-archive.json` files into `chat_kv` rows on first launch after this change ships, then deletes the originals.

**Tech Stack:** `rusqlite` 0.31 with the `bundled-full` feature (statically links SQLite, includes FTS5 for future full-text search — not used yet, but free to keep available), Tauri v2 managed state, React/TypeScript frontend via existing `invoke()` wrapper pattern in `src/lib/ipc.ts`.

---

## Why this shape, not a richer schema

The existing code already treats each sidecar file as an opaque blob written/read whole (see `src/hooks/useChat.ts:158-220` cold-start reads, `:260/360/369/399/425` whole-array writes). A KV table keyed by the existing path string is the smallest correct migration: it swaps the storage engine without redesigning anything else, and it keeps the only future-relevant door open — SQLite's FTS5 can be added later as a virtual table over `chat_kv.value` without a schema migration, if full-text search across chat history becomes a real feature ask (see `thoughts/research/chat-history-db-options.md`).

## Known pitfall (already hit and fixed once in this codebase's research phase)

The current stable Rust toolchain fails to build `rusqlite`'s newest transitive dependency: `libsqlite3-sys` (latest) uses the unstable `cfg_select` macro in its build script and fails with `error[E0658]` on stable `rustc`. Pin `rusqlite = "0.31"` explicitly — that version's `libsqlite3-sys` builds cleanly. Do not let `cargo add rusqlite --features bundled-full` pick the latest version.

---

### Task 1: Add rusqlite dependency

**Files:**
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Add the pinned dependency**

In `src-tauri/Cargo.toml`, add to the `[dependencies]` block (after `gray_matter = "0.3.2"` on line 45):

```toml
rusqlite = { version = "0.31", features = ["bundled-full"] }
```

- [ ] **Step 2: Verify it builds**

Run: `cd src-tauri && cargo build`
Expected: builds successfully (no `cfg_select`/`E0658` error). If you see that error, you picked up the wrong version — check `cargo tree -p rusqlite` and confirm it resolved to `0.31.x`.

---

### Task 2: Core KV store module with unit tests

**Files:**
- Create: `src-tauri/src/commands/history.rs`
- Modify: `src-tauri/src/commands/mod.rs` (register the new module)

- [ ] **Step 1: Write the module with pure, connection-level functions and unit tests**

Create `src-tauri/src/commands/history.rs`:

```rust
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
```

Then add unit tests at the bottom of `src-tauri/src/commands/history.rs`:

```rust
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
```

- [ ] **Step 2: Run the unit tests**

Run: `cd src-tauri && cargo test --lib history`
Expected: 6 tests pass — `get_returns_none_for_missing_key`, `set_then_get_roundtrips`, `set_twice_overwrites`, `delete_removes_key`, `list_keys_filters_by_prefix`, `classifies_legacy_chat_filenames`.

- [ ] **Step 3: Register the module**

In `src-tauri/src/commands/mod.rs`, add (matching the existing `pub mod` list — check the file for the exact existing pattern, e.g. `pub mod fs;`, `pub mod ai;`):

```rust
pub mod history;
```

- [ ] **Step 4: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/commands/history.rs src-tauri/src/commands/mod.rs
git commit -m "feat: add rusqlite-backed chat_kv store with migration sweep"
```

---

### Task 3: Wire the DB into app startup and register commands

**Files:**
- Modify: `src-tauri/src/lib.rs:134-209` (builder chain, `.setup()`, `generate_handler!`)

- [ ] **Step 1: Open the DB and manage it in `.setup()`**

In `src-tauri/src/lib.rs`, replace the existing no-op setup at line 210:

```rust
.setup(|_app| Ok(()))
```

with:

```rust
.setup(|app| {
    let app_handle = app.handle().clone();
    let db_dir = app_data_dir(&app_handle)?;
    std::fs::create_dir_all(&db_dir).map_err(AppError::Io)?;
    let conn = rusqlite::Connection::open(db_dir.join("history.db"))
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
    commands::history::init_db(&conn)
        .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
    app.manage(commands::history::HistoryDb(Mutex::new(conn)));

    let migrate_handle = app_handle.clone();
    tauri::async_runtime::spawn(async move {
        match commands::history::migrate_legacy_files(&migrate_handle).await {
            Ok(n) if n > 0 => eprintln!("history migration: moved {n} legacy chat file(s) into history.db"),
            Ok(_) => {}
            Err(e) => eprintln!("history migration failed: {e}"),
        }
    });
    Ok(())
})
```

This requires `AppError` to implement Tauri's setup error trait — it already implements `serde::Serialize` and derives `thiserror::Error` (`lib.rs:39-53`), which is sufficient for `tauri::Builder::setup`'s `Result<(), Box<dyn std::error::Error>>` return (via `?`'s `From` conversion, since `thiserror::Error` types implement `std::error::Error`).

- [ ] **Step 2: Register the four new commands**

In `src-tauri/src/lib.rs`, inside `tauri::generate_handler![...]`, add after `commands::fs::reveal_in_explorer,` (line 179):

```rust
            commands::history::history_get,
            commands::history::history_set,
            commands::history::history_delete,
            commands::history::history_list_keys,
```

- [ ] **Step 3: Build and smoke-test**

Run: `cd src-tauri && cargo build`
Expected: builds with no errors.

Run: `bun run tauri:dev` from the repo root, then check the app data dir for a new `history.db` file (on Linux: `~/.local/share/com.<bundle-id>/history.db` — check `tauri.conf.json`'s `identifier` field for the exact bundle id, or just watch `ls ~/.local/share/ | grep -i prototyper` while the dev server is running).
Expected: `history.db` exists and is non-empty (contains at least the `chat_kv` schema + the `_meta:migrated_v1` row after the migration sweep runs once).

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: open history.db at startup and register history_* commands"
```

---

### Task 4: Frontend IPC wrappers

**Files:**
- Modify: `src/lib/ipc.ts`

- [ ] **Step 1: Add the four wrapper functions**

In `src/lib/ipc.ts`, add after the `renameFile` function (line 99):

```ts
// ─── Chat History (SQLite-backed) ───

export interface HistoryKeyMeta {
  key: string;
  updated_at: number;
}

export async function historyGet(key: string): Promise<string | null> {
  return invoke("history_get", { key });
}

export async function historySet(key: string, value: string): Promise<void> {
  return invoke("history_set", { key, value });
}

export async function historyDelete(key: string): Promise<void> {
  return invoke("history_delete", { key });
}

export async function historyListKeys(prefix: string): Promise<HistoryKeyMeta[]> {
  return invoke("history_list_keys", { prefix });
}
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors (the functions aren't used anywhere yet, so this just confirms the signatures compile).

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat: add historyGet/Set/Delete/ListKeys IPC wrappers"
```

---

### Task 5: Swap `useChat.ts` from file I/O to the history store

**Files:**
- Modify: `src/hooks/useChat.ts`

- [ ] **Step 1: Update imports**

Replace the import block (lines 5-17):

```ts
import {
  generateCompletionStream,
  stopGenerationRequest,
  readFile,
  writeFile,
  deleteFile,
  getHostForProvider,
  getApiKeyForProvider,
  getErrorMessage,
  type CompletionEvent,
  type Provider,
  type TokenUsage,
} from "@/lib/ipc"
```

with:

```ts
import {
  generateCompletionStream,
  stopGenerationRequest,
  historyGet,
  historySet,
  historyDelete,
  getHostForProvider,
  getApiKeyForProvider,
  getErrorMessage,
  type CompletionEvent,
  type Provider,
  type TokenUsage,
} from "@/lib/ipc"
```

- [ ] **Step 2: Update the three cold-start load effects**

Replace the messages cold-start effect (lines 151-175):

```ts
  useEffect(() => {
    if (loadedRef.current.has(entityId)) return
    if (useChatStore.getState().chats[entityId]?.messages.length) {
      loadedRef.current.add(entityId)
      return
    }
    let cancelled = false
    historyGet(chatPath)
      .then((raw) => {
        if (cancelled) return
        loadedRef.current.add(entityId)
        if (raw === null) return
        try {
          const messages = JSON.parse(raw) as ChatMessage[]
          if (Array.isArray(messages) && messages.length > 0) {
            useChatStore.getState().setMessages(entityId, messages)
          }
        } catch (e) {
          notify.error("Failed to load chat", getErrorMessage(e))
        }
      })
      .catch(() => {
        if (!cancelled) loadedRef.current.add(entityId)
      })
    return () => { cancelled = true }
  }, [entityId, chatPath])
```

Replace the compaction cold-start effect (lines 178-195):

```ts
  useEffect(() => {
    if (loadedRef.current.has(entityId)) return
    let cancelled = false
    historyGet(compactionPath)
      .then((raw) => {
        if (cancelled || raw === null) return
        try {
          const compaction = JSON.parse(raw) as Compaction
          if (typeof compaction.boundaryIndex === "number" && typeof compaction.summary === "string") {
            useChatStore.getState().setCompaction(entityId, compaction)
          }
        } catch (e) {
          notify.error("Failed to load compaction cache", getErrorMessage(e))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [entityId, compactionPath])
```

Replace the session cold-start effect (lines 198-220):

```ts
  useEffect(() => {
    if (loadedRef.current.has(entityId)) return
    if (useChatStore.getState().chats[entityId]?.sessionUsage) return
    let cancelled = false
    historyGet(sessionPath)
      .then((raw) => {
        if (cancelled || raw === null) return
        try {
          const snapshot = JSON.parse(raw) as { lastFinalUsage?: TokenUsage; liveEstimate?: number; updatedAt?: number }
          if (typeof snapshot.updatedAt === "number") {
            useChatStore.getState().setSessionUsage(entityId, {
              lastFinalUsage: snapshot.lastFinalUsage,
              liveEstimate: snapshot.liveEstimate,
              updatedAt: snapshot.updatedAt,
            })
          }
        } catch (e) {
          notify.error("Failed to load session cache", getErrorMessage(e))
        }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [entityId, sessionPath])
```

- [ ] **Step 3: Update `sendMessage`'s write (line 260)**

Replace:

```ts
    writeFile(chatPath, JSON.stringify(updatedMessages, null, 2)).catch(() => {})
```

with:

```ts
    historySet(chatPath, JSON.stringify(updatedMessages, null, 2)).catch(() => {})
```

(There are three occurrences of this exact line in the file — at the `sendMessage`, `stopGeneration`, and `regenerate` call sites. Replace each occurrence in place; they are not extractable into one shared call without changing closures, so editing each is correct here, not duplication to fix.)

- [ ] **Step 4: Update `clearChat` (lines 358-363)**

Replace:

```ts
  const clearChat = useCallback(() => {
    useChatStore.getState().clearChat(entityId)
    writeFile(chatPath, "[]").catch(() => {})
    deleteFile(compactionPath).catch(() => {})
    deleteFile(sessionPath).catch(() => {})
  }, [entityId, chatPath, compactionPath, sessionPath])
```

with:

```ts
  const clearChat = useCallback(() => {
    useChatStore.getState().clearChat(entityId)
    historySet(chatPath, "[]").catch(() => {})
    historyDelete(compactionPath).catch(() => {})
    historyDelete(sessionPath).catch(() => {})
  }, [entityId, chatPath, compactionPath, sessionPath])
```

- [ ] **Step 5: Update `deleteFrom` (lines 365-385)**

Replace:

```ts
  const deleteFrom = useCallback((index: number) => {
    const current = useChatStore.getState().chats[entityId]?.messages ?? []
    const trimmed = current.slice(0, index)
    useChatStore.getState().setMessages(entityId, trimmed)
    writeFile(chatPath, JSON.stringify(trimmed, null, 2)).catch(() => {})
    const compaction = useChatStore.getState().chats[entityId]?.compaction
    if (compaction && compaction.boundaryIndex > trimmed.length) {
      useChatStore.getState().setCompaction(entityId, undefined)
      deleteFile(compactionPath).catch(() => {})
    }
    // If the trim removed the message that produced the last final usage,
    // the session snapshot is stale — reset it.
    const session = useChatStore.getState().chats[entityId]?.sessionUsage
    if (session?.lastFinalUsage) {
      const hasUsageAfterTrim = trimmed.some((m) => m.usage && m.usage === session.lastFinalUsage)
      if (!hasUsageAfterTrim) {
        useChatStore.getState().setSessionUsage(entityId, undefined)
        deleteFile(sessionPath).catch(() => {})
      }
    }
  }, [entityId, chatPath, compactionPath, sessionPath])
```

with:

```ts
  const deleteFrom = useCallback((index: number) => {
    const current = useChatStore.getState().chats[entityId]?.messages ?? []
    const trimmed = current.slice(0, index)
    useChatStore.getState().setMessages(entityId, trimmed)
    historySet(chatPath, JSON.stringify(trimmed, null, 2)).catch(() => {})
    const compaction = useChatStore.getState().chats[entityId]?.compaction
    if (compaction && compaction.boundaryIndex > trimmed.length) {
      useChatStore.getState().setCompaction(entityId, undefined)
      historyDelete(compactionPath).catch(() => {})
    }
    // If the trim removed the message that produced the last final usage,
    // the session snapshot is stale — reset it.
    const session = useChatStore.getState().chats[entityId]?.sessionUsage
    if (session?.lastFinalUsage) {
      const hasUsageAfterTrim = trimmed.some((m) => m.usage && m.usage === session.lastFinalUsage)
      if (!hasUsageAfterTrim) {
        useChatStore.getState().setSessionUsage(entityId, undefined)
        historyDelete(sessionPath).catch(() => {})
      }
    }
  }, [entityId, chatPath, compactionPath, sessionPath])
```

- [ ] **Step 6: Update `stopGeneration`'s write (lines 398-399) and `regenerate`'s write (line 425)**

In `stopGeneration`, replace:

```ts
    if (msgs.length > 0 && chatPath) {
      writeFile(chatPath, JSON.stringify(msgs, null, 2)).catch(() => {})
    }
```

with:

```ts
    if (msgs.length > 0 && chatPath) {
      historySet(chatPath, JSON.stringify(msgs, null, 2)).catch(() => {})
    }
```

In `regenerate`, replace:

```ts
    writeFile(chatPath, JSON.stringify(updatedMessages, null, 2)).catch(() => {})
```

with:

```ts
    historySet(chatPath, JSON.stringify(updatedMessages, null, 2)).catch(() => {})
```

- [ ] **Step 7: Type-check**

Run: `bunx tsc --noEmit`
Expected: no errors. Confirm there are zero remaining references to `readFile`, `writeFile`, or `deleteFile` in this file:

Run: `grep -n "readFile\|writeFile\|deleteFile" src/hooks/useChat.ts`
Expected: no output.

- [ ] **Step 8: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "refactor: back useChat persistence with history_* IPC instead of file I/O"
```

---

### Task 6: Swap the compaction and session-snapshot helpers

**Files:**
- Modify: `src/hooks/chat/sessionSnapshot.ts`
- Modify: `src/hooks/chat/compactSummary.ts`
- Modify: `src/hooks/chat/streamHandler.ts`

- [ ] **Step 1: Update `sessionSnapshot.ts`**

Replace the full file content:

```ts
import { useChatStore, type SessionUsageSnapshot } from "@/stores/chatStore"
import { historySet } from "@/lib/ipc"

/** Build a SessionUsageSnapshot from partial overrides, merging with the
 *  current store value. Persists to `sessionPath` and updates the store. */
export function persistSessionSnapshot(
  entityId: string,
  sessionPath: string,
  overrides: Partial<SessionUsageSnapshot>,
): SessionUsageSnapshot {
  const prev = useChatStore.getState().chats[entityId]?.sessionUsage ?? { updatedAt: 0 }
  const next: SessionUsageSnapshot = {
    lastFinalUsage: overrides.lastFinalUsage ?? prev.lastFinalUsage,
    liveEstimate: overrides.liveEstimate ?? prev.liveEstimate ?? 0,
    updatedAt: Date.now(),
  }
  useChatStore.getState().setSessionUsage(entityId, next)
  historySet(sessionPath, JSON.stringify(next, null, 2)).catch(() => {})
  return next
}
```

- [ ] **Step 2: Update `compactSummary.ts`**

In `src/hooks/chat/compactSummary.ts`, replace the `writeFile` call inside `runCompaction` (around line 114):

```ts
        if (messages.length >= boundaryIndex) {
          useChatStore.getState().setCompaction(entityId, compaction)
          writeFile(compactionPath, JSON.stringify(compaction)).catch(() => {})
        }
```

with:

```ts
        if (messages.length >= boundaryIndex) {
          useChatStore.getState().setCompaction(entityId, compaction)
          historySet(compactionPath, JSON.stringify(compaction)).catch(() => {})
        }
```

And update its import line from `writeFile` to `historySet` (check the top of the file for the existing `from "@/lib/ipc"` import and swap the named import).

- [ ] **Step 3: Update `streamHandler.ts`**

Replace the import line (line 2):

```ts
import { writeFile, type CompletionEvent, type Provider, type TokenUsage } from "@/lib/ipc"
```

with:

```ts
import { historySet, type CompletionEvent, type Provider, type TokenUsage } from "@/lib/ipc"
```

Replace the write inside `finalize` (line 77):

```ts
    writeFile(chatPath, JSON.stringify(finalMessages, null, 2)).catch(() => {})
```

with:

```ts
    historySet(chatPath, JSON.stringify(finalMessages, null, 2)).catch(() => {})
```

- [ ] **Step 4: Type-check and grep for stragglers**

Run: `bunx tsc --noEmit`
Expected: no errors.

Run: `grep -rn "readFile\|writeFile\|deleteFile" src/hooks/`
Expected: no output (every chat-history read/write/delete in `src/hooks/` now goes through `historyGet`/`historySet`/`historyDelete`).

- [ ] **Step 5: Commit**

```bash
git add src/hooks/chat/sessionSnapshot.ts src/hooks/chat/compactSummary.ts src/hooks/chat/streamHandler.ts
git commit -m "refactor: back compaction/session-snapshot persistence with history_* IPC"
```

---

### Task 7: Rewrite `SidebarChatsTab.tsx` to query the DB instead of walking the filesystem

**Files:**
- Modify: `src/components/sidebar/SidebarChatsTab.tsx`

This is required, not optional: after Task 3's migration sweep runs, the original `.chat.json`/`chats-archive.json` files no longer exist on disk (they were moved into `chat_kv` and deleted). `SidebarChatsTab`'s current `readDir`/`readFile` walk (lines 103-181) would silently show an empty sidebar post-migration if left unchanged.

- [ ] **Step 1: Replace `loadArchive`**

Replace (lines 103-111):

```ts
  const loadArchive = useCallback(async (): Promise<Set<string>> => {
    try {
      const raw = await readFile(archivePath);
      const arr = JSON.parse(raw) as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }, [archivePath]);
```

with:

```ts
  const loadArchive = useCallback(async (): Promise<Set<string>> => {
    const raw = await historyGet(archivePath);
    if (raw === null) return new Set();
    try {
      const arr = JSON.parse(raw) as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }, [archivePath]);
```

- [ ] **Step 2: Replace the discovery logic in `loadEntries`**

Replace the body from `const results: ChatEntry[] = [];` through the `results.sort(...)` line (lines 119-175) with a single DB query plus per-key classification:

```ts
      const results: ChatEntry[] = [];
      const keyMetas = await historyListKeys(`${base}/`);

      const classify = (key: string): { panel: PanelType; entityId: string; displayName: string } | null => {
        const rel = key.slice(base.length + 1); // strip "projects/{project}/"
        if (rel === "wizard/chat.json") return { panel: "wizard", entityId: "wizard", displayName: "Wizard" };
        let m = rel.match(/^screens\/([^/]+)\/chat\.json$/);
        if (m) return { panel: "screens", entityId: m[1], displayName: kebabToTitle(m[1]) };
        m = rel.match(/^components\/([^/]+)\/chat\.json$/);
        if (m) return { panel: "components", entityId: m[1], displayName: kebabToTitle(m[1]) };
        m = rel.match(/^themes\/([^/]+)\/chat\.json$/);
        if (m) return { panel: "themes", entityId: m[1], displayName: kebabToTitle(m[1]) };
        m = rel.match(/^plans\/(.+)\.chat\.json$/);
        if (m) return { panel: "plans", entityId: m[1], displayName: kebabToTitle(m[1]) };
        return null;
      };

      for (const meta of keyMetas) {
        const classified = classify(meta.key);
        if (!classified) continue; // skip .compaction.json / .session.json / chats-archive.json rows
        const raw = await historyGet(meta.key);
        if (!raw) continue;
        let messages: ChatMessage[];
        try {
          messages = JSON.parse(raw) as ChatMessage[];
        } catch {
          continue;
        }
        const { title, preview, messageCount } = extractChatMeta(messages);
        if (messageCount === 0) continue;
        results.push({
          path: meta.key,
          panel: classified.panel,
          entityId: classified.entityId,
          displayName: classified.displayName,
          title, preview, messageCount,
          modifiedMs: meta.updated_at,
          archived: archived.has(meta.key),
        });
      }

      results.sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));
```

Confirm `extractChatMeta` already returns a `messageCount` field consistent with the `if (messageCount === 0) continue` check above — check its definition further up in this same file; if it does not currently expose `messageCount`, that field already existed before this change (the original `tryAdd`/`ChatEntry` push above used `messageCount` identically), so this is a like-for-like port, not a new requirement.

- [ ] **Step 3: Replace `saveArchive`**

Replace (lines 185-187):

```ts
  const saveArchive = async (paths: Set<string>) => {
    await writeFile(archivePath, JSON.stringify([...paths], null, 2));
  };
```

with:

```ts
  const saveArchive = async (paths: Set<string>) => {
    await historySet(archivePath, JSON.stringify([...paths], null, 2));
  };
```

- [ ] **Step 4: Update imports**

At the top of the file, remove `readFile`, `writeFile`, `readDir` from the `@/lib/ipc` import (if no longer used elsewhere in this file — check remaining usages first with `grep -n "readDir\|readFile\|writeFile" src/components/sidebar/SidebarChatsTab.tsx`) and add `historyGet`, `historySet`, `historyListKeys`.

- [ ] **Step 5: Type-check and manually verify**

Run: `bunx tsc --noEmit`
Expected: no errors.

Run `bun run tauri:dev`, open a project with at least one existing Plans/Wizard/Screens/Components/Themes chat, open the sidebar's Chats tab.
Expected: existing chats still appear, grouped by panel, sorted by recency, with working archive/unarchive.

- [ ] **Step 6: Commit**

```bash
git add src/components/sidebar/SidebarChatsTab.tsx
git commit -m "refactor: query history.db instead of walking the filesystem in SidebarChatsTab"
```

---

### Task 8: End-to-end verification

- [ ] **Step 1: Verify migration runs once, idempotently**

Before this change, locate an existing project with chat history (or create one and chat in Plans + one Create sub-mode). Build and run with the new code:

```bash
bun run tauri:dev
```

Open DevTools or check stdout for the `history migration: moved N legacy chat file(s)` log line on first launch after the change. Restart the app a second time.
Expected: the log line does NOT print again (the `_meta:migrated_v1` guard in `migrate_legacy_files` short-circuits), and all previously visible chat history is still present and functional (send a message, refresh, confirm it persisted).

- [ ] **Step 2: Verify the old sidecar files are gone**

Run: `find ~/.local/share -iname "*.chat.json" -o -iname "*.compaction.json" -o -iname "*.session.json" 2>/dev/null` (adjust the base path per your OS/Tauri bundle id if not on Linux)
Expected: no results — confirms the migration deleted originals after copying into `history.db`.

- [ ] **Step 3: Full regression pass on all five panels**

For each of Plans, Wizard, Screens, Components, Themes: open an existing chat, send a new message, confirm it streams and persists across a reload; test `clearChat` (clears and reload shows empty); test deleting a message via `deleteFrom` if exposed in that panel's UI; test `regenerate`.
Expected: all behave identically to before the migration — this plan changes the storage backend only, not behavior.

- [ ] **Step 4: Final commit (if anything was fixed during verification)**

```bash
git add -A
git commit -m "fix: address issues found during history.db end-to-end verification"
```

(Skip this step if verification found nothing to fix.)

---

## Self-review notes

- **Spec coverage:** loading (Task 5 Step 2, Task 6), saving (Task 5 Steps 3-6, Task 6), "current functions" — `sendMessage`, `clearChat`, `deleteFrom`, `stopGeneration`, `regenerate`, compaction caching, session snapshot persistence, and the sidebar discovery view — are each addressed with literal before/after code, not descriptions.
- **All five panels covered:** Plans, Wizard, Screens, Components, Themes all route through the same `useChat.ts`/`sessionSnapshot.ts`/`compactSummary.ts`/`streamHandler.ts` files touched in Tasks 5-6, so no panel-specific code changes were needed — confirmed via the panel call-site table established during research (each panel only passes a different `chatPath`/`entityId` string into the same hook).
- **Workflows excluded deliberately:** confirmed via direct code search that Workflows has no chat-history persistence (`OutputChatPanel` is node console output, not AI chat) — nothing to migrate there.
- **No leftover dual-write path:** the migration deletes original files after copying (Task 2, `migrate_files_in_dir`), so there is exactly one source of truth post-migration, not a permanent fallback.
