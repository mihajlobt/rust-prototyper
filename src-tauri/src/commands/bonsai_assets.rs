use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::{AppHandle, State};

use crate::{resolve_path, AppError, AppState};
use super::bonsai::{bonsai_error, BonsaiServerConfig};

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct BonsaiGenerateResult {
    /// Absolute file path for use with convertFileSrc
    pub file_path: String,
    pub file_name: String,
    pub width: u32,
    pub height: u32,
    pub seed: u64,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct AssetInfo {
    pub file_name: String,
    /// Absolute file path for use with convertFileSrc
    pub file_path: String,
    pub file_size: u64,
    pub created_at: u64,
}

/// Generate an image via the Bonsai server. The 300s timeout is intentional —
/// image generation with model loading can take several minutes. The async
/// reqwest call won't block other Tauri commands since Tokio handles concurrent tasks.
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

    Ok(BonsaiGenerateResult {
        file_path: file_path.to_string_lossy().to_string(),
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
        let file_path = path.to_string_lossy().to_string();
        let created_at = metadata.modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        assets.push(AssetInfo {
            file_name,
            file_path,
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