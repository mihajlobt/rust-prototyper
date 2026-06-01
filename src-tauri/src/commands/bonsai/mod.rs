//! Bonsai image-generation server: lifecycle, process control, path resolution, and asset I/O.
//!
//! Public API surface:
//! - `commands::bonsai::*` — `BonsaiServer`, `BonsaiServerConfig`,
//!   `BonsaiServerInfo`, `BonsaiServerStatus`, `BonsaiGenerateResult`, `AssetInfo`
//! - `commands::bonsai::server::*` — the five `#[tauri::command]` server commands
//!   (exposed via a `pub mod` because the `tauri::command` macro emits hidden
//!   `__cmd__*` items that `generate_handler!` resolves by name; `pub use`
//!   re-exports the function but not the hidden companion).
//! - `commands::bonsai::assets::*` — the six asset `#[tauri::command]`s and the
//!   `BonsaiGenerateResult` / `AssetInfo` / `BonsaiAssetMeta` types.

use std::time::Instant;

mod process;
pub mod server;
mod paths;
pub mod assets;

// Re-export asset result/listing types so consumers can import from a single path.
pub use assets::{AssetInfo, BonsaiGenerateResult};

// Re-export server response types used by commands.
pub use server::{BonsaiServerInfo, BonsaiServerStatus};

pub(crate) const DEFAULT_PORT: u16 = 8000;
pub(crate) const MAX_PORT_OFFSET: u16 = 5;
pub(crate) const HEALTH_CHECK_TIMEOUT_SECS: u64 = 120;
pub(crate) const GRACEFUL_SHUTDOWN_TIMEOUT_SECS: u64 = 10;

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
    pub auto_stop_timeout_secs: u64,
}

impl Default for BonsaiServerConfig {
    fn default() -> Self {
        Self {
            install_path: String::new(),
            port: DEFAULT_PORT,
            variant: "ternary".to_string(),
            auto_stop_timeout_secs: 60,
        }
    }
}

pub(crate) fn bonsai_error(msg: impl Into<String>) -> crate::AppError {
    crate::AppError::Bonsai(msg.into())
}
