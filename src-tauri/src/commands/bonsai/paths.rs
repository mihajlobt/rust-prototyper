//! Filesystem path resolution for the Bonsai install location and model layout.
//!
//! All functions are pure: they take paths/strings, return either a resolved
//! `PathBuf` or an `AppError`. No I/O is performed beyond `std::fs::read_dir`
//! in `find_transformer_dir` (to locate the `transformer-gemlite-*` subdir).

use crate::AppError;
use super::bonsai_error;

/// Find the transformer-gemlite-* subdirectory within a model directory.
/// Returns the first match (e.g. transformer-gemlite-int2 for ternary, transformer-gemlite-int1 for binary).
pub(super) fn find_transformer_dir(model_dir: &std::path::Path) -> Option<std::path::PathBuf> {
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
pub(super) fn validate_install_path(raw: &str) -> Result<std::path::PathBuf, AppError> {
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

pub(super) fn default_install_path() -> Result<std::path::PathBuf, AppError> {
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
