use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{AppError, AppState};

// Re-export types from bonsai_assets so consumers can import from one path
pub use super::bonsai_assets::{BonsaiGenerateResult, AssetInfo};

const DEFAULT_PORT: u16 = 8000;
const MAX_PORT_OFFSET: u16 = 5;
const HEALTH_CHECK_TIMEOUT_SECS: u64 = 120;
const GRACEFUL_SHUTDOWN_TIMEOUT_SECS: u64 = 10;

/// Lock ordering: always acquire `bonsai_config` (std::sync::Mutex) before
/// `bonsai_process` (tokio::sync::Mutex), or never hold both simultaneously.
/// Never acquire in the reverse order to avoid deadlock.
pub struct BonsaiServer {
    pub child: tokio::process::Child,
    pub pid: u32,
    pub port: u16,
    pub started_at: Instant,
    pub stop_timer: Option<tokio::task::JoinHandle<()>>,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BonsaiServerConfig {
    pub install_path: String,
    pub port: u16,
    pub variant: String,
    pub auto_start: bool,
    pub auto_stop_timeout_secs: u64,
    pub max_memory_gb: f64,
}

impl Default for BonsaiServerConfig {
    fn default() -> Self {
        Self {
            install_path: String::new(),
            port: DEFAULT_PORT,
            variant: "ternary".to_string(),
            auto_start: false,
            auto_stop_timeout_secs: 60,
            max_memory_gb: 4.0,
        }
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BonsaiServerInfo {
    pub port: u16,
    pub pid: u32,
    pub healthy: bool,
    pub kind: String,
    pub supported_families: Vec<String>,
    pub default_family: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BonsaiServerStatus {
    pub healthy: bool,
    pub kind: String,
    pub supported_families: Vec<String>,
    pub default_family: String,
}

pub(crate) fn bonsai_error(msg: impl Into<String>) -> AppError {
    AppError::Bonsai(msg.into())
}

async fn check_server_health(http_client: &reqwest::Client, port: u16) -> Result<BonsaiServerStatus, AppError> {
    let url = format!("http://127.0.0.1:{}/backends", port);
    let response = http_client
        .get(&url)
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| bonsai_error(format!("Health check failed: {}", e)))?;

    let status: serde_json::Value = response
        .json()
        .await
        .map_err(|e| bonsai_error(format!("Health check parse failed: {}", e)))?;

    Ok(BonsaiServerStatus {
        healthy: status.get("healthy").and_then(|v| v.as_bool()).unwrap_or(false),
        kind: status.get("kind").and_then(|v| v.as_str()).unwrap_or("unknown").to_string(),
        supported_families: status
            .get("supported_families")
            .and_then(|v| v.as_array())
            .map(|arr| arr.iter().filter_map(|v| v.as_str().map(String::from)).collect())
            .unwrap_or_default(),
        default_family: status
            .get("default_family")
            .and_then(|v| v.as_str())
            .unwrap_or("unknown")
            .to_string(),
    })
}

fn find_available_port(base: u16, max_offset: u16) -> Option<u16> {
    for offset in 0..=max_offset {
        let port = base + offset;
        if let Ok(listener) = std::net::TcpListener::bind(format!("127.0.0.1:{}", port)) {
            drop(listener);
            return Some(port);
        }
    }
    None
}

/// Find the transformer-gemlite-* subdirectory within a model directory.
/// Returns the first match (e.g. transformer-gemlite-int2 for ternary, transformer-gemlite-int1 for binary).
fn find_transformer_dir(model_dir: &std::path::Path) -> Option<std::path::PathBuf> {
    if let Ok(entries) = std::fs::read_dir(model_dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name_str = name.to_string_lossy();
            if name_str.starts_with("transformer-gemlite-") && entry.path().is_dir() {
                return Some(entry.path());
            }
        }
    }
    None
}

/// Validate and resolve the install path, preventing path traversal attacks.
/// Returns the resolved absolute path or an error.
fn validate_install_path(raw: &str) -> Result<std::path::PathBuf, AppError> {
    let path = std::path::Path::new(raw);
    // Reject empty paths (caller should handle default)
    if raw.is_empty() {
        return Err(bonsai_error("Install path cannot be empty"));
    }
    // Reject paths with traversal components
    if raw.contains("..") {
        return Err(bonsai_error("Install path must not contain '..'"));
    }
    // Must be an absolute path
    if !path.is_absolute() {
        return Err(bonsai_error("Install path must be absolute"));
    }
    // Expand ~ to home directory
    let expanded = if raw.starts_with("~/") {
        let home = dirs_home_dir().ok_or_else(|| bonsai_error("Cannot determine home directory"))?;
        home.join(&raw[2..])
    } else {
        path.to_path_buf()
    };
    // Verify the resolved path exists as a directory
    if !expanded.is_dir() {
        return Err(bonsai_error(format!(
            "Install path does not exist: {}. Make sure Bonsai Image Demo is cloned and set up.",
            expanded.display()
        )));
    }
    Ok(expanded)
}

fn dirs_home_dir() -> Option<std::path::PathBuf> {
    #[cfg(unix)]
    {
        std::env::var("HOME").ok().map(std::path::PathBuf::from)
            .or_else(|| dirs::home_dir())
    }
    #[cfg(windows)]
    {
        std::env::var("USERPROFILE").ok().map(std::path::PathBuf::from)
            .or_else(|| dirs::home_dir())
    }
    #[cfg(not(any(unix, windows)))]
    {
        dirs::home_dir()
    }
}

fn default_install_path() -> Result<std::path::PathBuf, AppError> {
    let home = dirs_home_dir().ok_or_else(|| bonsai_error("Cannot determine home directory"))?;
    // Try the exact GitHub repo name first (case-sensitive on Linux), then lowercase fallback
    let candidates = [
        home.join("Bonsai-Image-Demo"),
        home.join("Bonsai-image-demo"),
        home.join("bonsai-image-demo"),
    ];
    for candidate in &candidates {
        if candidate.is_dir() {
            return Ok(candidate.clone());
        }
    }
    Err(bonsai_error(format!(
        "Bonsai Image Demo not found. Tried: {}. Clone it from GitHub and run setup, or configure the install path in Settings → Assets.",
        candidates.iter().map(|p| p.display().to_string()).collect::<Vec<_>>().join(", ")
    )))
}

/// Start the Bonsai server. Holds the `bonsai_process` lock throughout to prevent
/// race conditions from concurrent start calls. The health-check loop runs while
/// the lock is held, but only sends HTTP requests (non-blocking for other tasks).
#[tauri::command]
pub async fn bonsai_start_server(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BonsaiServerInfo, AppError> {
    // Clone config from std Mutex, then release before acquiring any tokio Mutex
    let config = state.bonsai_config.lock().unwrap().clone();

    // Phase 1: Kill any stale Bonsai process group (without holding the process lock).
    // Kill all ports in range first, then check our tracked process.
    for offset in 0..=MAX_PORT_OFFSET {
        kill_port_sync(config.port + offset);
    }
    {
        let mut bonsai_guard = state.bonsai_process.lock().await;
        if let Some(mut server) = bonsai_guard.take() {
            if let Some(timer) = server.stop_timer.take() {
                timer.abort();
            }
            let pid = server.pid;
            let port = server.port;
            // Drop lock before async kill — never hold locks across awaits
            drop(bonsai_guard);
            kill_process_group(pid).await;
            kill_port_sync(port);
        }
    }
    state.bonsai_port.store(0, Ordering::Relaxed);

    // Phase 2: Check if a server is already running (brief lock, no await between lock acquire and drop)
    {
        let bonsai_guard = state.bonsai_process.lock().await;
        if let Some(ref server) = *bonsai_guard {
            // Release lock before doing async health check — never hold locks across awaits
            let current_port = server.port;
            let current_pid = server.pid;
            drop(bonsai_guard);
            if let Ok(status) = check_server_health(&state.http_client, current_port).await {
                if status.healthy {
                    return Ok(BonsaiServerInfo {
                        port: current_port,
                        pid: current_pid,
                        healthy: true,
                        kind: status.kind,
                        supported_families: status.supported_families,
                        default_family: status.default_family,
                    });
                }
            }
        }
    }

    // Phase 3: Spawn and health-check without holding the lock.
    // Only brief lock acquisitions when reading/writing BonsaiServer state.
    // Avoids holding tokio::sync::Mutex across .await (blocks other commands).
    // See: https://tokio.rs/tokio/topics/tracing — "Don't hold locks across awaits"

    // Find available port
    let port = find_available_port(config.port, MAX_PORT_OFFSET)
        .ok_or_else(|| bonsai_error("No available port in range 8000-8005"))?;

    // Validate install path (prevents path traversal and gives actionable error)
    let install_path = if config.install_path.is_empty() {
        default_install_path()?
    } else {
        validate_install_path(&config.install_path)?
    };

    // Replicate env vars from serve.sh (lines 94-180) — only need backend API, not the Next.js frontend
    let variant = &config.variant;
    let model_dir = install_path.join(format!("models/bonsai-image-4B-{}-gemlite", variant));

    let transformer_path = find_transformer_dir(&model_dir)
        .ok_or_else(|| bonsai_error(format!(
            "No transformer-gemlite-* dir under {}. Run: ./scripts/download_model.sh {}",
            model_dir.display(), variant
        )))?;

    let text_encoder_path = model_dir.join("text_encoder-hqq-4bit");
    let vae_path = model_dir.join("vae");
    let tokenizer_path = model_dir.join("text_encoder-hqq-4bit/tokenizer");
    let _ = app.emit("bonsai:log", serde_json::json!({
        "line": format!("Starting Bonsai on port {} ({}); model dir: {}", port, variant, model_dir.display()),
        "source": "system"
    }));

    let venv_uvicorn = install_path.join(".venv/bin/uvicorn");
    let backend_module = "scripts.local_backend:app";
    let mut cmd = tokio::process::Command::new(&venv_uvicorn);
    cmd.arg(backend_module)
        .arg("--port").arg(port.to_string())
        .env("BONSAI_VARIANT", variant)
        .env("BACKEND_PORT", port.to_string())
        .env("MFLUX_STUDIO_GPU_DEFAULT_BACKEND", format!("bonsai-{}-gemlite", variant))
        .env("MFLUX_STUDIO_GPU_TERNARY_TRANSFORMER_PATH", transformer_path.to_string_lossy().to_string())
        // GpuPipeline requires both; point binary to ternary for single-variant use
        .env("MFLUX_STUDIO_GPU_BINARY_TRANSFORMER_PATH", transformer_path.to_string_lossy().to_string())
        .env("MFLUX_STUDIO_GPU_TEXT_ENCODER_PATH", text_encoder_path.to_string_lossy().to_string())
        .env("MFLUX_STUDIO_GPU_VAE_PATH", vae_path.to_string_lossy().to_string())
        .env("MFLUX_STUDIO_GPU_TOKENIZER_PATH", tokenizer_path.to_string_lossy().to_string())
        .current_dir(&install_path)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);

    // New process group so kill -{pgid} reaches the whole tree including CUDA workers
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn()
        .map_err(|e| bonsai_error(format!("Failed to start Bonsai server: {}", e)))?;

    let pid = child.id().ok_or_else(|| bonsai_error("Failed to get process ID — process may have exited immediately"))?;

    // Take stdout/stderr and spawn background tasks to forward logs to frontend
    if let Some(stdout) = child.stdout.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stdout);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_clone.emit("bonsai:log", serde_json::json!({
                    "line": line,
                    "source": "stdout"
                }));
            }
        });
    }
    if let Some(stderr) = child.stderr.take() {
        let app_clone = app.clone();
        tokio::spawn(async move {
            let reader = BufReader::new(stderr);
            let mut lines = reader.lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = app_clone.emit("bonsai:log", serde_json::json!({
                    "line": line,
                    "source": "stderr"
                }));
            }
        });
    }
    let _ = app.emit("bonsai:log", serde_json::json!({
        "line": format!("Spawning process (install: {})...", install_path.display()),
        "source": "system"
    }));
    let start_time = Instant::now();
    let timeout = Duration::from_secs(HEALTH_CHECK_TIMEOUT_SECS);
    let mut delay = Duration::from_secs(1);

    loop {
        if start_time.elapsed() > timeout {
            let _ = child.kill().await;
            let _ = app.emit("bonsai:log", serde_json::json!({
                "line": format!("Server failed to start within {} seconds.", HEALTH_CHECK_TIMEOUT_SECS),
                "source": "system"
            }));
            return Err(bonsai_error(format!(
                "Bonsai server failed to start within {} seconds. Check that the model is downloaded and the server can bind to port {}.",
                HEALTH_CHECK_TIMEOUT_SECS, port
            )));
        }

        // Log health-check attempts
        let elapsed = start_time.elapsed().as_secs();
        let _ = app.emit("bonsai:log", serde_json::json!({
            "line": format!("Health check attempt ({}s elapsed)...", elapsed),
            "source": "system"
        }));

        if let Ok(status) = check_server_health(&state.http_client, port).await {
            if status.healthy {
                let kind_label = status.kind.clone();
                let info = BonsaiServerInfo {
                    port,
                    pid,
                    healthy: true,
                    kind: status.kind,
                    supported_families: status.supported_families,
                    default_family: status.default_family,
                };
                // Acquire lock only briefly to write the server state — no await inside
                let mut bonsai_guard = state.bonsai_process.lock().await;
                *bonsai_guard = Some(BonsaiServer {
                    child,
                    pid,
                    port,
                    started_at: Instant::now(),
                    stop_timer: None,
                });
                drop(bonsai_guard);
                state.bonsai_port.store(port, Ordering::Relaxed);
                let _ = app.emit("bonsai:log", serde_json::json!({
                    "line": format!("✓ Bonsai server healthy on port {} ({} backend)", port, kind_label),
                    "source": "system"
                }));
                return Ok(info);
            }
            let _ = app.emit("bonsai:log", serde_json::json!({
                "line": "Server not yet healthy, retrying...".to_string(),
                "source": "system"
            }));
        }

        delay = std::cmp::min(delay * 2, Duration::from_secs(8));
        tokio::time::sleep(delay).await;
    }
}

#[tauri::command]
pub async fn bonsai_stop_server(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Take the server out and release lock immediately — never hold lock across awaits
    let server_opt = {
        let mut bonsai_guard = state.bonsai_process.lock().await;
        bonsai_guard.take()
    };
    state.bonsai_port.store(0, Ordering::Relaxed);

    if let Some(mut server) = server_opt {
        let _ = app.emit("bonsai:log", serde_json::json!({
            "line": format!("Stopping Bonsai server (PID {} on port {})...", server.pid, server.port),
            "source": "system"
        }));
        if let Some(timer) = server.stop_timer.take() {
            timer.abort();
        }

        // Kill the whole process group (uvicorn + CUDA workers) for proper GPU cleanup.
        // process_group(0) was set at spawn, so PGID == PID.
        kill_process_group(server.pid).await;

        // Also try async kill on the tracked child as a fallback
        let _ = server.child.kill().await;

        let deadline = Instant::now() + Duration::from_secs(GRACEFUL_SHUTDOWN_TIMEOUT_SECS);
        loop {
            match server.child.try_wait() {
                Ok(Some(_)) => break,
                Ok(None) => {
                    if Instant::now() > deadline {
                        let _ = server.child.kill().await;
                        break;
                    }
                    tokio::time::sleep(Duration::from_millis(500)).await;
                }
                Err(_) => break,
            }
        }

        kill_port_sync(server.port);
    }
    Ok(())
}

#[tauri::command]
pub async fn bonsai_server_status(state: State<'_, AppState>) -> Result<BonsaiServerStatus, AppError> {
    let port = state.bonsai_port.load(Ordering::Relaxed);
    if port == 0 {
        return Ok(BonsaiServerStatus {
            healthy: false,
            kind: String::new(),
            supported_families: Vec::new(),
            default_family: String::new(),
        });
    }
    check_server_health(&state.http_client, port).await
}

/// Schedule an automatic stop. The spawned task sleeps for the configured timeout,
/// then emits a `bonsai:stop-timeout` event that the frontend listens for to call
/// `bonsai_stop_server`. It also directly stops the server after emitting the event
/// as a safety net.
#[tauri::command]
pub async fn bonsai_schedule_stop(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    // Acquire config lock, clone data, drop guard before acquiring process lock.
    // Lock ordering: std Mutex (config) before tokio Mutex (process) — never hold both.
    let timeout_secs = {
        let config = state.bonsai_config.lock().unwrap().clone();
        config.auto_stop_timeout_secs
        // config guard dropped here — no longer holding std Mutex
    };
    let mut bonsai_guard = state.bonsai_process.lock().await;

    if let Some(ref mut server) = *bonsai_guard {
        if server.stop_timer.is_some() {
            return Ok(());
        }
        let app_handle = app.clone();
        let stop_handle = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(timeout_secs)).await;
            // Notify frontend so it can update UI state
            let _ = app_handle.emit("bonsai:stop-timeout", ());
            // The frontend will call bonsai_stop_server after receiving this event
        });
        server.stop_timer = Some(stop_handle);
        // Store whether a timer is active so frontend can query it
        // (bonsai_server_status could be extended to include this info)
    }
    Ok(())
}

#[tauri::command]
pub async fn bonsai_cancel_stop(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut bonsai_guard = state.bonsai_process.lock().await;
    if let Some(ref mut server) = *bonsai_guard {
        if let Some(timer) = server.stop_timer.take() {
            timer.abort();
        }
    }
    Ok(())
}

/// Kill a process group by sending SIGTERM, waiting briefly, then SIGKILL.
/// The uvicorn process is started in its own process group (PGID = PID),
/// so killing the group also kills Python/CUDA worker children.
/// Async — uses tokio::time::sleep, never blocks the runtime.
#[cfg(unix)]
async fn kill_process_group(pid: u32) {
    // Send SIGTERM to the process group (negative PID = process group)
    let pgid = format!("-{}", pid);
    let _ = tokio::process::Command::new("kill")
        .arg(&pgid)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;

    // Give group 2 seconds to clean up GPU memory gracefully
    tokio::time::sleep(Duration::from_secs(2)).await;

    // If still alive, SIGKILL the whole group
    let _ = tokio::process::Command::new("kill")
        .args(["-9", &pgid])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
}

#[cfg(windows)]
async fn kill_process_group(pid: u32) {
    // On Windows, taskkill /T kills the process tree
    let _ = tokio::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
}

/// Cross-platform port killing — reuses the same pattern as process.rs kill_port_impl.
/// Runs on spawn_blocking to not block the async runtime.
fn kill_port_sync(port: u16) {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("lsof")
            .args(["-t", &format!("-i:{}", port), "-s", "TCP:LISTEN"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        if let Ok(out) = output {
            let pids = String::from_utf8_lossy(&out.stdout);
            for pid in pids.lines() {
                let pid = pid.trim();
                if pid.is_empty() { continue; }
                let _ = std::process::Command::new("kill")
                    .args(["-9", pid])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .output();
            }
        }
    }
    #[cfg(windows)]
    {
        let output = std::process::Command::new("cmd")
            .args(["/C", &format!("netstat -ano | findstr :{}", port)])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(pid) = parts.last() {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/PID", pid, "/F"])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .output();
                }
            }
        }
    }
}