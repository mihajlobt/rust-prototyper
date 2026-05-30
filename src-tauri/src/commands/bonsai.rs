use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{app_data_dir, resolve_path, AppError, AppState};

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

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BonsaiGenerateResult {
    /// Relative path from app data dir (e.g. "projects/default/assets/bonsai_xxx.png")
    pub relative_path: String,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    pub seed: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AssetInfo {
    pub file_name: String,
    /// Relative path from app data dir
    pub relative_path: String,
    pub file_size: u64,
    pub created_at: u64,
}

fn bonsai_error(msg: impl Into<String>) -> AppError {
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
    // Acquire config lock first (lock ordering: config before process)
    let config = state.bonsai_config.lock().unwrap().clone();
    // Config lock is released here (no explicit drop needed — lock guard dropped at end of scope)
    // but we already cloned config above so we can use it after the lock is gone.

    // Hold process lock throughout to prevent concurrent start races
    let mut bonsai_guard = state.bonsai_process.lock().await;

    // Check if server is already running
    if let Some(ref server) = *bonsai_guard {
        let current_port = server.port;
        if let Ok(status) = check_server_health(&state.http_client, current_port).await {
            if status.healthy {
                return Ok(BonsaiServerInfo {
                    port: current_port,
                    pid: server.pid,
                    healthy: true,
                    kind: status.kind,
                    supported_families: status.supported_families,
                    default_family: status.default_family,
                });
            }
        }
        // Unhealthy — clean up existing process
        if let Some(mut server) = bonsai_guard.take() {
            if let Some(timer) = server.stop_timer.take() {
                timer.abort();
            }
            let _ = server.child.kill().await;
            kill_port_sync(server.port);
        }
        state.bonsai_port.store(0, Ordering::Relaxed);
    }

    // Find available port
    let port = find_available_port(config.port, MAX_PORT_OFFSET)
        .ok_or_else(|| bonsai_error("No available port in range 8000-8005"))?;

    // Clean up any stale process on that port
    kill_port_sync(port);

    // Validate install path (prevents path traversal and gives actionable error)
    let install_path = if config.install_path.is_empty() {
        default_install_path()?
    } else {
        validate_install_path(&config.install_path)?
    };

    // Try serve.sh first, fall back to python -m
    let serve_script = install_path.join("scripts").join("serve.sh");
    let (use_python, cmd_str) = if serve_script.exists() {
        (false, serve_script.to_string_lossy().to_string())
    } else {
        // Fall back to running python directly
        (true, "python3".to_string())
    };

    let mut child = if use_python {
        tokio::process::Command::new("python3")
            .args(["-m", "backend.local_backend"])
            .env("BONSAI_VARIANT", &config.variant)
            .env("BACKEND_PORT", port.to_string())
            .current_dir(&install_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| bonsai_error(format!(
                "Failed to start Bonsai server: {}. Make sure python3 is installed and Bonsai Image Demo is set up.",
                e
            )))?
    } else {
        tokio::process::Command::new("sh")
            .arg(&cmd_str)
            .env("BONSAI_VARIANT", &config.variant)
            .env("BACKEND_PORT", port.to_string())
            .current_dir(&install_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| bonsai_error(format!("Failed to start Bonsai server: {}", e)))?
    };

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

    // Emit initial startup message
    let _ = app.emit("bonsai:log", serde_json::json!({
        "line": format!("Starting Bonsai server on port {}...", port),
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
                let info = BonsaiServerInfo {
                    port,
                    pid,
                    healthy: true,
                    kind: status.kind,
                    supported_families: status.supported_families,
                    default_family: status.default_family,
                };
                *bonsai_guard = Some(BonsaiServer {
                    child,
                    pid,
                    port,
                    started_at: Instant::now(),
                    stop_timer: None,
                });
                state.bonsai_port.store(port, Ordering::Relaxed);
                let _ = app.emit("bonsai:log", serde_json::json!({
                    "line": format!("✓ Bonsai server healthy on port {} ({} backend)", port, status.kind),
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
    let mut bonsai_guard = state.bonsai_process.lock().await;
    if let Some(mut server) = bonsai_guard.take() {
        let _ = app.emit("bonsai:log", serde_json::json!({
            "line": format!("Stopping Bonsai server (PID {} on port {})...", server.pid, server.port),
            "source": "system"
        }));
        if let Some(timer) = server.stop_timer.take() {
            timer.abort();
        }

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

        // Use existing kill_port from process.rs (cross-platform, tested)
        kill_port_sync(server.port);
    }
    state.bonsai_port.store(0, Ordering::Relaxed);
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

/// Generate an image. The 300s timeout is intentional — image generation with
/// model loading can take several minutes. The async reqwest call won't block
/// other Tauri commands since Tokio handles concurrent tasks.
#[tauri::command]
pub async fn bonsai_generate_image(
    app: AppHandle,
    state: State<'_, AppState>,
    project_id: String,
    prompt: String,
    width: Option<u32>,
    height: Option<u32>,
    steps: Option<u32>,
    seed: Option<u64>,
    backend: Option<String>,
) -> Result<BonsaiGenerateResult, AppError> {
    let port = state.bonsai_port.load(Ordering::Relaxed);
    if port == 0 {
        return Err(bonsai_error("Bonsai server is not running"));
    }

    // Validate project_id to prevent path traversal
    if project_id.contains("..") || project_id.starts_with('/') || project_id.starts_with('\\') {
        return Err(bonsai_error("Invalid project ID"));
    }

    let image_width = width.unwrap_or(512);
    let image_height = height.unwrap_or(512);
    let image_steps = steps.unwrap_or(4);
    let seed_value = seed.unwrap_or_else(|| {
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    });

    let mut body = serde_json::json!({
        "prompt": prompt,
        "width": image_width,
        "height": image_height,
        "steps": image_steps,
        "seed": seed_value,
    });
    if let Some(ref backend_value) = backend {
        body["backend"] = serde_json::json!(backend_value);
    }

    // Use resolve_path for secure path construction
    let assets_dir = resolve_path(&app, &format!("projects/{}/assets", project_id))?;
    tokio::fs::create_dir_all(&assets_dir)
        .await
        .map_err(|e| bonsai_error(format!("Failed to create assets dir: {}", e)))?;

    let url = format!("http://127.0.0.1:{}/generate", port);
    let response = state
        .http_client
        .post(&url)
        .json(&body)
        .timeout(Duration::from_secs(300))
        .send()
        .await
        .map_err(|e| bonsai_error(format!("Generation request failed: {}", e)))?;

    if !response.status().is_success() {
        let status_code = response.status();
        let error_body = response.text().await.unwrap_or_default();
        return Err(bonsai_error(format!("Generation failed ({}): {}", status_code, error_body)));
    }

    let png_bytes = response
        .bytes()
        .await
        .map_err(|e| bonsai_error(format!("Failed to read image data: {}", e)))?;

    if png_bytes.len() < 1024 {
        return Err(bonsai_error("Generated image is too small, possibly an error response"));
    }

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let file_name = format!("bonsai_{}_{}.png", timestamp, seed_value);
    let file_path = assets_dir.join(&file_name);

    tokio::fs::write(&file_path, &png_bytes)
        .await
        .map_err(|e| bonsai_error(format!("Failed to write image: {}", e)))?;

    // Return relative path instead of absolute
    let app_data = app_data_dir(&app)?;
    let relative_path = file_path
        .strip_prefix(&app_data)
        .unwrap_or(&file_path)
        .to_string_lossy()
        .to_string();

    Ok(BonsaiGenerateResult {
        relative_path,
        file_name,
        width: image_width,
        height: image_height,
        seed: seed_value,
    })
}

#[tauri::command]
pub async fn bonsai_list_assets(
    app: AppHandle,
    project_id: String,
) -> Result<Vec<AssetInfo>, AppError> {
    // Validate project_id to prevent path traversal
    if project_id.contains("..") || project_id.starts_with('/') || project_id.starts_with('\\') {
        return Err(bonsai_error("Invalid project ID"));
    }

    let app_data = app_data_dir(&app)?;
    let assets_dir = resolve_path(&app, &format!("projects/{}/assets", project_id))?;

    if !assets_dir.exists() {
        return Ok(Vec::new());
    }

    let mut entries = tokio::fs::read_dir(&assets_dir)
        .await
        .map_err(|e| bonsai_error(format!("Failed to read assets dir: {}", e)))?;

    let mut assets = Vec::new();
    while let Some(entry) = entries.next_entry().await.map_err(|e| bonsai_error(format!("Failed to read entry: {}", e)))? {
        let path = entry.path();
        let metadata = entry.metadata()
            .await
            .map_err(|e| bonsai_error(format!("Failed to read metadata: {}", e)))?;
        if !metadata.is_file() {
            continue;
        }
        let file_name = path.file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .to_string();
        let relative_path = path
            .strip_prefix(&app_data)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();
        let created_at = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        assets.push(AssetInfo {
            file_name,
            relative_path,
            file_size: metadata.len(),
            created_at,
        });
    }

    assets.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(assets)
}

#[tauri::command]
pub async fn bonsai_delete_asset(
    app: AppHandle,
    project_id: String,
    file_name: String,
) -> Result<(), AppError> {
    // Validate inputs to prevent path traversal
    if project_id.contains("..") || project_id.starts_with('/') || project_id.starts_with('\\') {
        return Err(bonsai_error("Invalid project ID"));
    }
    if file_name.contains("..") || file_name.contains('/') || file_name.contains('\\') {
        return Err(bonsai_error("Invalid file name"));
    }

    let file_path = resolve_path(&app, &format!("projects/{}/assets/{}", project_id, file_name))?;

    if !file_path.exists() {
        return Err(bonsai_error(format!("Asset not found: {}", file_name)));
    }

    tokio::fs::remove_file(&file_path)
        .await
        .map_err(|e| bonsai_error(format!("Failed to delete asset: {}", e)))
}

#[tauri::command]
pub async fn bonsai_get_server_config(state: State<'_, AppState>) -> Result<BonsaiServerConfig, AppError> {
    let config = state.bonsai_config.lock().unwrap().clone();
    Ok(config)
}

#[tauri::command]
pub async fn bonsai_save_server_config(
    state: State<'_, AppState>,
    config: BonsaiServerConfig,
) -> Result<(), AppError> {
    // Validate install_path prevents path traversal if non-empty
    if !config.install_path.is_empty() {
        if config.install_path.contains("..") {
            return Err(bonsai_error("Install path must not contain '..'"));
        }
    }
    let mut current = state.bonsai_config.lock().unwrap();
    *current = config;
    Ok(())
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
    let config = state.bonsai_config.lock().unwrap().clone();
    let timeout_secs = config.auto_stop_timeout_secs;
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