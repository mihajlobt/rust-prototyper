use tauri::AppHandle;
use crate::{AppError, app_data_dir, resolve_path};
use crate::commands::fs::FileEntry;

#[tauri::command]
pub async fn save_workflow(project_id: String, workflow_id: String, data: String, app: AppHandle) -> Result<(), AppError> {
    let dir = resolve_path(&app, &format!("projects/{}/workflows", project_id))?;
    tokio::fs::create_dir_all(&dir).await.map_err(AppError::Io)?;
    let path = dir.join(format!("{}.json", workflow_id));
    tokio::fs::write(&path, data).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn load_workflow(project_id: String, workflow_id: String, app: AppHandle) -> Result<String, AppError> {
    let path = resolve_path(&app, &format!("projects/{}/workflows/{}.json", project_id, workflow_id))?;
    tokio::fs::read_to_string(&path).await.map_err(AppError::Io)
}

#[tauri::command]
pub async fn list_workflows(project_id: String, app: AppHandle) -> Result<Vec<FileEntry>, AppError> {
    let base = app_data_dir(&app)?;
    let dir = resolve_path(&app, &format!("projects/{}/workflows", project_id))?;
    let mut entries = Vec::new();
    let mut rd = tokio::fs::read_dir(&dir).await.map_err(AppError::Io)?;
    while let Some(entry) = rd.next_entry().await.map_err(AppError::Io)? {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.ends_with(".json") {
            let abs_path = entry.path();
            let rel_path = abs_path.strip_prefix(&base).unwrap_or(&abs_path).to_string_lossy().to_string();
            entries.push(FileEntry { name, path: rel_path, is_dir: false });
        }
    }
    Ok(entries)
}
