use tauri::AppHandle;
use crate::{AppError, app_data_dir, resolve_path};

#[derive(serde::Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

#[tauri::command]
pub async fn read_dir(path: String, app: AppHandle) -> Result<Vec<FileEntry>, AppError> {
    let base = app_data_dir(&app)?;
    let resolved = resolve_path(&app, &path)?;
    let mut entries = Vec::new();
    let mut dir = tokio::fs::read_dir(&resolved).await.map_err(AppError::Io)?;
    while let Some(entry) = dir.next_entry().await.map_err(AppError::Io)? {
        let name = entry.file_name().to_string_lossy().to_string();
        let abs_path = entry.path();
        let rel_path = abs_path.strip_prefix(&base).unwrap_or(&abs_path).to_string_lossy().to_string();
        let is_dir = entry.file_type().await.map_err(AppError::Io)?.is_dir();
        entries.push(FileEntry { name, path: rel_path, is_dir });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn read_file(path: String, app: AppHandle) -> Result<String, AppError> {
    let path = resolve_path(&app, &path)?;
    tokio::fs::read_to_string(&path).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn write_file(path: String, content: String, app: AppHandle) -> Result<(), AppError> {
    let path = resolve_path(&app, &path)?;
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(AppError::Io)?;
    }
    tokio::fs::write(&path, content).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn create_dir(path: String, app: AppHandle) -> Result<(), AppError> {
    let path = resolve_path(&app, &path)?;
    tokio::fs::create_dir_all(&path).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn delete_file(path: String, app: AppHandle) -> Result<(), AppError> {
    let path = resolve_path(&app, &path)?;
    tokio::fs::remove_file(&path).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn delete_dir(path: String, app: AppHandle) -> Result<(), AppError> {
    let path = resolve_path(&app, &path)?;
    tokio::fs::remove_dir_all(&path).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn rename_file(from: String, to: String, app: AppHandle) -> Result<(), AppError> {
    let from = resolve_path(&app, &from)?;
    let to = resolve_path(&app, &to)?;
    tokio::fs::rename(&from, &to).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn create_symlink(link_path: String, target: String, app: AppHandle) -> Result<(), AppError> {
    let link = resolve_path(&app, &link_path)?;
    let parent = link.parent().ok_or_else(|| AppError::Io(std::io::Error::other("link path has no parent")))?;
    tokio::fs::create_dir_all(parent).await.map_err(AppError::Io)?;
    if let Ok(existing) = tokio::fs::read_link(&link).await {
        if existing.to_string_lossy() == target {
            return Ok(());
        }
        tokio::fs::remove_file(&link).await.map_err(AppError::Io)?;
    } else if tokio::fs::metadata(&link).await.is_ok() {
        tokio::fs::remove_dir_all(&link).await.map_err(AppError::Io)?;
    }
    let target_owned = target.clone();
    let link_owned = link.clone();
    tokio::task::spawn_blocking(move || {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&target_owned, &link_owned)
                .map_err(AppError::Io)?;
        }
        #[cfg(windows)]
        {
            let parent = link_owned.parent().ok_or_else(|| AppError::Io(std::io::Error::other("link path has no parent")))?;
            let resolved_target = if std::path::Path::new(&target_owned).is_absolute() {
                std::path::PathBuf::from(&target_owned)
            } else {
                parent.join(&target_owned)
            };
            let is_dir = resolved_target.is_dir();
            let output = if is_dir {
                std::process::Command::new("cmd")
                    .args(["/C", "mklink", "/J", &link_owned.to_string_lossy(), &resolved_target.to_string_lossy()])
                    .output()
            } else {
                std::process::Command::new("cmd")
                    .args(["/C", "mklink", &link_owned.to_string_lossy(), &resolved_target.to_string_lossy()])
                    .output()
            }.map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))?;
            if !output.status.success() {
                let stderr = String::from_utf8_lossy(&output.stderr);
                return Err(AppError::Io(std::io::Error::other(format!("mklink failed: {stderr}"))));
            }
        }
        Ok::<(), AppError>(())
    }).await.map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))??;
    Ok(())
}

#[tauri::command]
pub async fn reveal_in_explorer(path: String, app: AppHandle) -> Result<(), AppError> {
    let resolved = resolve_path(&app, &path)?;
    let target = if resolved.is_file() {
        resolved.parent().map(|p| p.to_path_buf()).unwrap_or(resolved)
    } else {
        resolved
    };
    let target_str = target.to_string_lossy().to_string();
    #[cfg(target_os = "linux")]
    std::process::Command::new("xdg-open").arg(&target_str).spawn().map_err(AppError::Io)?;
    #[cfg(target_os = "macos")]
    std::process::Command::new("open").arg(&target_str).spawn().map_err(AppError::Io)?;
    #[cfg(target_os = "windows")]
    std::process::Command::new("explorer.exe").arg(&target_str).spawn().map_err(AppError::Io)?;
    Ok(())
}
