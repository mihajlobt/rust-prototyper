mod agent;
pub mod commands;
pub mod sandbox;

use std::sync::{atomic::AtomicU16, atomic::AtomicU64, Mutex};
use std::collections::HashMap;
use std::time::Duration;
use tauri::{AppHandle, Manager, RunEvent, WindowEvent};
use tauri_plugin_shell::process::CommandChild;
use tokio_util::sync::CancellationToken;

use commands::bonsai::{BonsaiServer, BonsaiServerConfig};

pub struct AppState {
    pub active_processes: Mutex<HashMap<u32, CommandChild>>,
    pub cancellation_tokens: Mutex<HashMap<u32, CancellationToken>>,
    pub http_client: reqwest::Client,
    /// Maps permission request_id -> pending oneshot sender.
    pub pending_permissions: Mutex<HashMap<u64, commands::ai::PendingToolPermission>>,
    /// Maps ask_user request_id -> pending oneshot sender for the user's answer string.
    pub pending_ask_user: Mutex<HashMap<u64, tokio::sync::oneshot::Sender<String>>>,
    /// Maps ask_user_form request_id -> pending oneshot sender for the JSON answers string.
    pub pending_ask_user_form: Mutex<HashMap<u64, tokio::sync::oneshot::Sender<String>>>,
    /// Monotonically increasing counter for permission IDs and ask_user request IDs.
    pub next_permission_id: AtomicU64,
    pub bonsai_process: tokio::sync::Mutex<Option<BonsaiServer>>,
    pub bonsai_port: AtomicU16,
    pub bonsai_config: Mutex<BonsaiServerConfig>,
    /// Cancellation token for the in-flight Bonsai image generation request.
    /// `Some(token)` means a generation is running; cancelling it drops the HTTP connection.
    pub bonsai_generation_token: Mutex<Option<CancellationToken>>,
}

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Not found: {0}")]
    NotFound(String),
    #[error("Process error: {0}")]
    Process(String),
    #[error("Security error: {0}")]
    Security(String),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("Bonsai error: {0}")]
    Bonsai(String),
}

impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where S: serde::ser::Serializer {
        serializer.serialize_str(self.to_string().as_ref())
    }
}

pub fn app_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, AppError> {
    app.path().app_data_dir().map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
}

pub fn normalize_path(path: &std::path::Path) -> std::path::PathBuf {
    let mut result = std::path::PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::RootDir => result.push("/"),
            std::path::Component::Prefix(p) => result.push(p.as_os_str()),
            std::path::Component::Normal(c) => result.push(c),
            std::path::Component::ParentDir => { result.pop(); }
            std::path::Component::CurDir => {}
        }
    }
    result
}

pub fn resolve_path(app: &AppHandle, raw: &str) -> Result<std::path::PathBuf, AppError> {
    let base = app_data_dir(app)?;
    let relative = raw.strip_prefix("./").unwrap_or(raw);
    if raw.starts_with('/') || raw.starts_with('\\') || raw.contains("..") {
        return Err(AppError::Security("Invalid path".into()));
    }
    let target = base.join(relative);
    let normalized = normalize_path(&target);
    let normalized_base = normalize_path(&base);
    if !normalized.starts_with(&normalized_base) {
        return Err(AppError::Security("Path traversal detected".into()));
    }
    Ok(normalized)
}

pub fn resolve_cwd(app: &AppHandle, raw: &str) -> Result<std::path::PathBuf, AppError> {
    resolve_path(app, raw)
}

// Re-exported at crate root so agent module can use `crate::CompletionEvent`
pub use commands::ai::CompletionEvent;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // GTK overlay scrollbars are native OS widgets rendered above WebKit's compositor,
    // above position:fixed modals regardless of z-index. Disabling them hands rendering
    // back to WebKit, which is CSS-styleable and respects z-index correctly.
    #[cfg(target_os = "linux")]
    unsafe { std::env::set_var("GTK_OVERLAY_SCROLLING", "0"); }

    // WebKitGTK's DMA-BUF rendering path can crash with `Gdk-Message: Error 71
    // (Protocol error)` on Wayland compositors with newer Mesa/kwin combos where
    // GBM buffer creation returns EINVAL. Falling back to SHM buffers avoids the
    // crash while preserving GPU compositing via Skia — only the buffer-sharing
    // mechanism changes. X11 users are unaffected (DMA-BUF still used); users
    // who explicitly set the var are not overridden.
    #[cfg(target_os = "linux")]
    {
        let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
        let already_set = std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some();
        if wayland && !already_set {
            unsafe { std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"); }
        }
    }

    let http_client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 10 { return attempt.error("too many redirects"); }
            attempt.follow()
        }))
        .build()
        .expect("Failed to build HTTP client");

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_clipboard::init())
        .plugin(tauri_plugin_dialog::init());

    #[cfg(debug_assertions)]
    let builder = builder.plugin(tauri_plugin_mcp_bridge::init());

    builder
        .manage(AppState {
            active_processes: Mutex::new(HashMap::new()),
            cancellation_tokens: Mutex::new(HashMap::new()),
            http_client,
            pending_permissions: Mutex::new(HashMap::new()),
            pending_ask_user: Mutex::new(HashMap::new()),
            pending_ask_user_form: Mutex::new(HashMap::new()),
            next_permission_id: AtomicU64::new(1),
            bonsai_process: tokio::sync::Mutex::new(None),
            bonsai_port: AtomicU16::new(0),
            bonsai_config: Mutex::new(BonsaiServerConfig::default()),
            bonsai_generation_token: Mutex::new(None),
        })
        .invoke_handler(tauri::generate_handler![
            commands::process::bun_dev,
            commands::process::bun_build,
            commands::process::bun_install,
            commands::process::bun_install_sync,
            commands::process::run_shell_command,
            commands::process::run_shell_command_sync,
            commands::process::run_shell_command_capture,
            commands::process::kill_process,
            commands::process::kill_all_processes,
            commands::process::kill_port,
            commands::fs::read_dir,
            commands::fs::read_file,
            commands::fs::write_file,
            commands::fs::create_dir,
            commands::fs::delete_file,
            commands::fs::delete_dir,
            commands::fs::rename_file,
            commands::fs::create_symlink,
            commands::fs::reveal_in_explorer,
            commands::http::http_request,
            commands::http::test_searxng_connection,
            commands::ai::generate_completion,
            commands::ai::generate_completion_stream,
            commands::ai::stop_generation_stream,
            commands::ai::resolve_tool_permission,
            commands::ai::resolve_ask_user,
            commands::ai::resolve_ask_user_form,
            commands::ai::list_anthropic_models,
            commands::ai_ollama::list_ollama_models,
            commands::ai_ollama::save_model_presets,
            commands::ai_ollama::load_model_presets,
            commands::export::export_project,
            commands::export::export_component,
            commands::workflows::save_workflow,
            commands::workflows::load_workflow,
            commands::workflows::list_workflows,
            commands::bonsai::server::bonsai_start_server,
            commands::bonsai::server::bonsai_stop_server,
            commands::bonsai::server::bonsai_server_status,
            commands::bonsai::assets::bonsai_generate_image,
            commands::bonsai::assets::bonsai_cancel_generation,
            commands::bonsai::assets::bonsai_list_assets,
            commands::bonsai::assets::bonsai_delete_asset,
            commands::bonsai::assets::bonsai_get_server_config,
            commands::bonsai::assets::bonsai_save_server_config,
            commands::bonsai::server::bonsai_schedule_stop,
            commands::bonsai::server::bonsai_cancel_stop,
        ])
        .setup(|_app| Ok(()))
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<AppState>() {
                    let mut processes = state.active_processes.lock().unwrap();
                    for (_, child) in processes.drain() {
                        let _ = child.kill();
                    }
                    drop(processes);
                }
                if let Some(state) = window.try_state::<AppState>() {
                    // Use start_kill() (sync) instead of kill().await because this handler is synchronous.
                    // The process will be forcefully terminated when the app exits regardless.
                    if let Ok(mut bonsai) = state.bonsai_process.try_lock() {
                        if let Some(mut server) = bonsai.take() {
                            if let Some(timer) = server.stop_timer.take() {
                                timer.abort();
                            }
                            let _ = server.child.start_kill();
                        }
                    }
                }
                #[cfg(unix)]
                {
                    let _ = std::process::Command::new("sh")
                        .args(["-c", "for port in $(seq 5173 5184); do kill -9 $(lsof -t -i:${port}) 2>/dev/null; done"])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .output();
                }
                #[cfg(windows)]
                {
                    let _ = std::process::Command::new("cmd")
                        .args(["/C", "for %p in (5173 5174 5175 5176 5177 5178 5179 5180 5181 5182 5183 5184) do for /f \"tokens=5\" %a in ('netstat -ano ^| findstr :%p') do taskkill /PID %a /F"])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .output();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app_handle, event| {
            if let RunEvent::ExitRequested { .. } = event {}
        });
}
