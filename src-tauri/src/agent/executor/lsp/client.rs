use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::{oneshot, Mutex as AsyncMutex};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

/// Hand-rolled JSON-RPC-over-stdio client for `typescript-language-server`. The LSP wire
/// format — `Content-Length: N\r\n\r\n` followed by N bytes of JSON — is simple enough that
/// a small dependency-free client is more conservative than an immature async LSP crate.
pub(crate) struct LspClient {
    stdin: AsyncMutex<ChildStdin>,
    next_id: AtomicU64,
    pending: StdMutex<HashMap<u64, oneshot::Sender<Result<Value, String>>>>,
    open_files: AsyncMutex<HashSet<PathBuf>>,
    // Held only to keep the process alive for the client's lifetime; `kill_on_drop` then
    // tears it down when the cache entry (and this Arc) is dropped.
    _child: AsyncMutex<Child>,
}

impl LspClient {
    /// Spawns `typescript-language-server --stdio` rooted at `root`, performs the
    /// `initialize`/`initialized` handshake, and returns a client ready for requests.
    pub(crate) async fn spawn(root: &Path) -> Result<Arc<Self>, String> {
        let mut child = Command::new("typescript-language-server")
            .arg("--stdio")
            .current_dir(root)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!(
                "failed to spawn typescript-language-server: {e}. Install it with \
                 `bun add -g typescript-language-server typescript` and ensure it's on PATH."
            ))?;

        let stdin = child.stdin.take().ok_or("typescript-language-server: no stdin handle")?;
        let stdout = child.stdout.take().ok_or("typescript-language-server: no stdout handle")?;

        let client = Arc::new(Self {
            stdin: AsyncMutex::new(stdin),
            next_id: AtomicU64::new(1),
            pending: StdMutex::new(HashMap::new()),
            open_files: AsyncMutex::new(HashSet::new()),
            _child: AsyncMutex::new(child),
        });

        let reader = Arc::clone(&client);
        tokio::spawn(async move { reader.read_loop(stdout).await });

        client.initialize(root).await?;
        Ok(client)
    }

    async fn initialize(&self, root: &Path) -> Result<(), String> {
        let params = json!({
            "processId": std::process::id(),
            "rootUri": path_to_uri(root),
            "capabilities": {
                "textDocument": {
                    "synchronization": { "didSave": true },
                    "hover": { "contentFormat": ["markdown", "plaintext"] },
                    "documentSymbol": { "hierarchicalDocumentSymbolSupport": true },
                    "definition": {},
                    "references": {},
                }
            },
        });
        self.request("initialize", params).await?;
        self.notify("initialized", json!({})).await
    }

    /// Sends `textDocument/didOpen` for `path` the first time it's referenced by this
    /// client — the server can't answer queries about a file it doesn't know is open.
    pub(crate) async fn ensure_open(&self, path: &Path) -> Result<(), String> {
        let mut open = self.open_files.lock().await;
        if open.contains(path) {
            return Ok(());
        }
        let text = tokio::fs::read_to_string(path).await
            .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
        let params = json!({
            "textDocument": {
                "uri": path_to_uri(path),
                "languageId": language_id_for(path),
                "version": 1,
                "text": text,
            }
        });
        self.notify("textDocument/didOpen", params).await?;
        open.insert(path.to_path_buf());
        Ok(())
    }

    /// Sends a JSON-RPC request and awaits its matched response (by id) or a timeout.
    pub(crate) async fn request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().unwrap().insert(id, tx);

        let message = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        if let Err(e) = self.write_message(&message).await {
            self.pending.lock().unwrap().remove(&id);
            return Err(format!("failed to write to language server: {e}"));
        }

        match tokio::time::timeout(REQUEST_TIMEOUT, rx).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("language server closed the connection".to_string()),
            Err(_) => {
                self.pending.lock().unwrap().remove(&id);
                Err(format!("{method} timed out after {}s", REQUEST_TIMEOUT.as_secs()))
            }
        }
    }

    async fn notify(&self, method: &str, params: Value) -> Result<(), String> {
        let message = json!({ "jsonrpc": "2.0", "method": method, "params": params });
        self.write_message(&message).await.map_err(|e| format!("failed to write to language server: {e}"))
    }

    async fn write_message(&self, message: &Value) -> std::io::Result<()> {
        let body = serde_json::to_vec(message).expect("LSP message serialization should never fail");
        let mut stdin = self.stdin.lock().await;
        stdin.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes()).await?;
        stdin.write_all(&body).await?;
        stdin.flush().await
    }

    /// Reads `Content-Length`-framed JSON-RPC messages until the server closes its
    /// stdout, routing each by id to the request that's waiting on it. Server-initiated
    /// requests and notifications (diagnostics, logs, ...) are intentionally discarded —
    /// this client only supports the request/response operations the `lsp` tool needs.
    async fn read_loop(self: Arc<Self>, stdout: ChildStdout) {
        let mut reader = BufReader::new(stdout);
        while let Ok(Some(msg)) = read_message(&mut reader).await {
            self.route_response(msg);
        }
        for (_, tx) in self.pending.lock().unwrap().drain() {
            let _ = tx.send(Err("language server process exited".to_string()));
        }
    }

    fn route_response(&self, msg: Value) {
        // Requests/notifications from the server carry "method" — not a response to us.
        if msg.get("method").is_some() {
            return;
        }
        let Some(id) = msg.get("id").and_then(Value::as_u64) else { return };
        let Some(tx) = self.pending.lock().unwrap().remove(&id) else { return };
        let result = match msg.get("error") {
            Some(error) => Err(error.get("message").and_then(Value::as_str).unwrap_or("unknown LSP error").to_string()),
            None => Ok(msg.get("result").cloned().unwrap_or(Value::Null)),
        };
        let _ = tx.send(result);
    }
}

async fn read_message(reader: &mut BufReader<ChildStdout>) -> std::io::Result<Option<Value>> {
    let mut content_length: Option<usize> = None;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).await? == 0 {
            return Ok(None);
        }
        let trimmed = line.trim_end();
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = value.trim().parse().ok();
        }
    }
    let Some(len) = content_length else { return Ok(None) };
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body).await?;
    Ok(serde_json::from_slice(&body).ok())
}

fn language_id_for(path: &Path) -> &'static str {
    match path.extension().and_then(|e| e.to_str()) {
        Some("tsx") => "typescriptreact",
        Some("jsx") => "javascriptreact",
        Some("js") | Some("mjs") | Some("cjs") => "javascript",
        _ => "typescript",
    }
}

/// Percent-encodes everything outside the URI-safe set so paths with spaces or non-ASCII
/// characters round-trip — `lsp-types::Uri` requires a well-formed URI string as input.
pub(crate) fn path_to_uri(path: &Path) -> String {
    let mut out = String::from("file://");
    for byte in path.to_string_lossy().bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' | b'/' => out.push(byte as char),
            _ => out.push_str(&format!("%{byte:02X}")),
        }
    }
    out
}

/// Inverse of [`path_to_uri`]: strips the `file://` scheme and percent-decodes the rest,
/// returning the absolute path it encodes. Project-relative rendering is the caller's
/// job (see `formatters::display_path`).
pub(crate) fn uri_to_path(uri: &str) -> Option<PathBuf> {
    let encoded = uri.strip_prefix("file://")?;
    Some(PathBuf::from(percent_decode(encoded)))
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}
