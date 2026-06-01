//! Bonsai server lifecycle commands: start, stop, status, schedule/cancel stop.
//!
//! Lock-ordering invariant: `bonsai_config` (std::sync::Mutex) must always be
//! acquired before `bonsai_process` (tokio::sync::Mutex), or the two locks must
//! never be held simultaneously. See the `BonsaiServer` doc in `mod.rs`.
//!
//! The health-check loop intentionally runs while the process lock is briefly
//! held (between `take()`/`set()`), but only performs non-blocking HTTP
//! requests — see https://tokio.rs/tokio/topics/tracing "Don't hold locks
//! across awaits" for the rationale.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tokio::io::{AsyncBufReadExt, BufReader};

use crate::{AppError, AppState};
use super::{
    bonsai_error, BonsaiServer, HEALTH_CHECK_TIMEOUT_SECS, MAX_PORT_OFFSET,
};
use super::paths::{default_install_path, find_transformer_dir, validate_install_path};
use super::process::{kill_port_sync, kill_process_group};

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

async fn check_server_health(
    http_client: &reqwest::Client,
    port: u16,
) -> Result<BonsaiServerStatus, AppError> {
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
    // spawn_blocking avoids blocking the async runtime with synchronous lsof/kill calls.
    let ports_to_kill: Vec<u16> = (0..=MAX_PORT_OFFSET).map(|offset| config.port + offset).collect();
    tokio::task::spawn_blocking(move || {
        for port in ports_to_kill {
            kill_port_sync(port);
        }
    }).await.map_err(|e| bonsai_error(format!("Port cleanup task failed: {}", e)))?;
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
            tokio::task::spawn_blocking(move || kill_port_sync(port))
                .await
                .map_err(|e| bonsai_error(format!("Port cleanup task failed: {}", e)))?;
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

    // Find available port — TcpListener::bind is synchronous; use spawn_blocking to avoid
    // stalling the async runtime during the bind loop.
    let base_port = config.port;
    let port = tokio::task::spawn_blocking(move || find_available_port(base_port, MAX_PORT_OFFSET))
        .await
        .map_err(|e| bonsai_error(format!("Port search task failed: {}", e)))?
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

        let deadline = Instant::now() + Duration::from_secs(super::GRACEFUL_SHUTDOWN_TIMEOUT_SECS);
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

        tokio::task::spawn_blocking(move || kill_port_sync(server.port))
            .await
            .map_err(|e| bonsai_error(format!("Port cleanup task failed: {}", e)))?;
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
/// `bonsai_stop_server`.
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

    // Single lock acquisition: check, spawn, and store atomically to prevent two concurrent
    // calls both passing the has_timer check and orphaning a timer task.
    // tokio::spawn is synchronous (returns immediately), so it's safe inside the lock.
    let mut bonsai_guard = state.bonsai_process.lock().await;
    match bonsai_guard.as_ref() {
        None => return Ok(()), // no server running — nothing to schedule
        Some(server) if server.stop_timer.is_some() => return Ok(()), // timer already set
        _ => {}
    }
    let app_handle = app.clone();
    let stop_handle = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(timeout_secs)).await;
        let _ = app_handle.emit("bonsai:stop-timeout", ());
    });
    if let Some(ref mut server) = *bonsai_guard {
        server.stop_timer = Some(stop_handle);
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
