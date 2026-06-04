<!-- Context: prototyper/backend/bonsai/concepts/bonsai-backend | Priority: high | Version: 1.1 | Updated: 2026-06-04 -->

# Bonsai Backend Integration

> Rust-side integration with the Bonsai (mflux) Python FastAPI server. Handles process spawning, health checks, GPU cleanup, and image generation.

## Server: Python FastAPI

The Bonsai server is a local Python backend started via uvicorn:

```bash
.venv/bin/uvicorn scripts.local_backend:app --port {port}
```

**Endpoints consumed by Prototyper**:
- `GET /backends` — health check + backend metadata (`kind`, `supported_families`, `default_family`, `healthy`)
- `POST /generate` — accepts JSON body, returns **raw PNG bytes**

**Code**: `src-tauri/src/commands/bonsai.rs` — `check_server_health`

## Environment Variables

```rust
cmd.env("BONSAI_VARIANT", variant)           // "ternary" | "binary"
   .env("BACKEND_PORT", port.to_string())
   .env("MFLUX_STUDIO_GPU_DEFAULT_BACKEND", format!("bonsai-{}-gemlite", variant))
   .env("MFLUX_STUDIO_GPU_TERNARY_TRANSFORMER_PATH", transformer_path)
   .env("MFLUX_STUDIO_GPU_BINARY_TRANSFORMER_PATH", transformer_path)  // same for single-variant
   .env("MFLUX_STUDIO_GPU_TEXT_ENCODER_PATH", text_encoder_path)
   .env("MFLUX_STUDIO_GPU_VAE_PATH", vae_path)
   .env("MFLUX_STUDIO_GPU_TOKENIZER_PATH", tokenizer_path);
```

These mirror the env setup from the upstream `serve.sh` script.

## Process Management

```rust
let mut cmd = tokio::process::Command::new(&venv_uvicorn);
cmd.arg(backend_module)
   .stdout(std::process::Stdio::piped())
   .stderr(std::process::Stdio::piped())
   .kill_on_drop(true);

// Unix: new process group so kill -{pgid} reaches CUDA workers
#[cfg(unix)]
cmd.process_group(0);
```

- `process_group(0)` sets PGID = PID. Killing the group ensures Python subprocesses and CUDA workers are cleaned up.
- `kill_on_drop(true)` kills the child if the Rust `Child` handle is dropped.

**Code**: `src-tauri/src/commands/bonsai.rs` — `bonsai_start_server`

## Port Range & Health Check

```rust
const DEFAULT_PORT: u16 = 8000;
const MAX_PORT_OFFSET: u16 = 5;   // 8000-8005
const HEALTH_CHECK_TIMEOUT_SECS: u64 = 120;
```

Startup sequence:
1. Scan 8000-8005 with `TcpListener::bind` to find a free port.
2. Spawn uvicorn on that port.
3. Poll `GET /backends` with exponential backoff (1s → 2s → 4s → 8s cap).
4. If 120s elapse without health, kill the child and return an error.

**Code**: `src-tauri/src/commands/bonsai.rs` — `bonsai_start_server`

## Lock Ordering

AppState holds two mutexes for Bonsai:

```rust
pub bonsai_config: std::sync::Mutex<BonsaiServerConfig>,      // std — brief, sync-only
pub bonsai_process: tokio::sync::Mutex<Option<BonsaiServer>>, // tokio — async, long-lived
```

**Rule**: Always acquire `bonsai_config` (std) first, then `bonsai_process` (tokio), or never hold both simultaneously. Never reverse the order — deadlock risk.

**Why**: `std::sync::Mutex` blocks the async thread; holding it across an `.await` would stall the Tokio runtime. The code clones config data, drops the std lock, then acquires the tokio lock.

**Code**: `src-tauri/src/commands/bonsai.rs` — `bonsai_start_server`, `bonsai_schedule_stop`

## Clean Shutdown

```rust
async fn kill_process_group(pid: u32) {
    // SIGTERM to group
    let _ = Command::new("kill").arg(format!("-{}", pid)).status().await;
    tokio::time::sleep(Duration::from_secs(2)).await;
    // SIGKILL if still alive
    let _ = Command::new("kill").args(["-9", &format!("-{}", pid)]).status().await;
}
```

- SIGTERM gives Python/CUDA a chance to release GPU memory.
- 2-second grace period, then SIGKILL.
- Windows uses `taskkill /PID {pid} /T /F`.

**Code**: `src-tauri/src/commands/bonsai.rs` — `kill_process_group`

## Auto-Stop Timer

```rust
#[tauri::command]
pub async fn bonsai_schedule_stop(app: AppHandle, state: State<'_, AppState>) -> Result<(), AppError> {
    let timeout_secs = {
        let config = state.bonsai_config.lock().unwrap().clone();
        config.auto_stop_timeout_secs
    };

    let handle = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(timeout_secs)).await;
        let _ = app_handle.emit("bonsai:stop-timeout", ());
    });

    // Briefly re-lock to store the handle
    let mut guard = state.bonsai_process.lock().await;
    if let Some(ref mut server) = *guard {
        server.stop_timer = Some(handle);
    }
    Ok(())
}
```

- The timer task emits a Tauri event; the frontend listens and calls `bonsai_stop_server`.
- This avoids holding any lock during the sleep.

**Code**: `src-tauri/src/commands/bonsai.rs` — `bonsai_schedule_stop`, `bonsai_cancel_stop`

## Path Validation

Install path is validated to prevent traversal attacks:

```rust
fn validate_install_path(raw: &str) -> Result<PathBuf, AppError> {
    if raw.is_empty() { return Err(...); }
    if raw.contains("..") { return Err(...); }
    if !path.is_absolute() { return Err(...); }
    // Expand ~ to home
    // Verify directory exists
}
```

Default path tries `~/Bonsai-Image-Demo` with case variants.

**Code**: `src-tauri/src/commands/bonsai.rs` — `validate_install_path`, `default_install_path`

## Related

- **Assets panel architecture** → `assets-panel.md`
- **Assets UI patterns** → `assets-ui-patterns.md`
- **AppState definition** → `src-tauri/src/lib.rs`
