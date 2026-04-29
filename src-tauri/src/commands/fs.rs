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
