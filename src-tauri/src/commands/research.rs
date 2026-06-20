use tauri::State;
use crate::{AppError, AppState};
use crate::agent::ResearchLoopConfig;

#[tauri::command]
pub async fn research_get_config(
    state: State<'_, AppState>,
) -> Result<ResearchLoopConfig, AppError> {
    Ok(state.research_config.lock().unwrap().clone())
}

#[tauri::command]
pub async fn research_save_config(
    config: ResearchLoopConfig,
    state: State<'_, AppState>,
) -> Result<(), AppError> {
    *state.research_config.lock().unwrap() = config.clamped();
    Ok(())
}
