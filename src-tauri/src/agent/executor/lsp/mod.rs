pub(crate) mod client;
mod formatters;

use std::path::Path;
use std::sync::Arc;

use serde_json::json;
use tauri::Manager;

use super::{ToolError, ToolExecutionResult};
use crate::agent::tools::LspArgs;
use crate::AppState;
use client::{path_to_uri, LspClient};
use formatters::{format_document_symbols, format_hover, format_locations};

const SUPPORTED_EXTENSIONS: &[&str] = &["ts", "tsx", "js", "jsx", "mjs", "cjs"];

fn error_result(message: impl Into<String>) -> ToolExecutionResult {
    ToolExecutionResult { success: false, output: format!("lsp: {}", message.into()), written_path: None, written_content: None }
}

/// Returns the cached client for `root`, spawning and initializing one lazily on first use.
/// One server per project root — `typescript-language-server` already indexes the whole
/// workspace from `rootUri`, so per-file servers would be wasteful and slower to warm up.
async fn get_or_spawn_client(app_handle: &tauri::AppHandle, root: &Path) -> Result<Arc<LspClient>, String> {
    let state = app_handle.state::<AppState>();
    {
        let servers = state.lsp_servers.lock().await;
        if let Some(client) = servers.get(root) {
            return Ok(Arc::clone(client));
        }
    }
    let client = LspClient::spawn(root).await?;
    state.lsp_servers.lock().await.insert(root.to_path_buf(), Arc::clone(&client));
    Ok(client)
}

fn position_json(line: u32, character: u32) -> serde_json::Value {
    // LSP positions are 0-based; the model sees 1-based line/character numbers
    // (matching the numbered file listings it's already shown), so translate at the edge.
    json!({ "line": line.saturating_sub(1), "character": character.saturating_sub(1) })
}

pub(in crate::agent) async fn execute_lsp(
    args: &serde_json::Value,
    app_handle: &tauri::AppHandle,
    project_dir: &Path,
) -> ToolExecutionResult {
    let parsed: LspArgs = match serde_json::from_value(args.clone()) {
        Ok(p) => p,
        Err(e) => return error_result(ToolError::InvalidArguments(e.to_string()).to_string()),
    };

    let file_path = match &parsed {
        LspArgs::Definition { file_path, .. }
        | LspArgs::References { file_path, .. }
        | LspArgs::Hover { file_path, .. }
        | LspArgs::DocumentSymbol { file_path } => file_path,
    };
    if file_path.contains("..") {
        return error_result("path traversal not allowed");
    }
    let abs_path = project_dir.join(file_path);
    if !abs_path.starts_with(project_dir) {
        return error_result("path must be within the current project");
    }
    let is_supported = abs_path.extension().and_then(|e| e.to_str())
        .is_some_and(|ext| SUPPORTED_EXTENSIONS.contains(&ext));
    if !is_supported {
        return error_result(format!(
            "only TypeScript/JavaScript files are supported ({})",
            SUPPORTED_EXTENSIONS.join(", "),
        ));
    }

    let client = match get_or_spawn_client(app_handle, project_dir).await {
        Ok(client) => client,
        Err(e) => return error_result(e),
    };
    if let Err(e) = client.ensure_open(&abs_path).await {
        return error_result(e);
    }

    let uri = path_to_uri(&abs_path);
    let text_document = json!({ "uri": uri });

    let outcome = match &parsed {
        LspArgs::Definition { line, character, .. } => {
            let params = json!({ "textDocument": text_document, "position": position_json(*line, *character) });
            client.request("textDocument/definition", params).await.map(|v| format_locations(&v, project_dir))
        }
        LspArgs::References { line, character, .. } => {
            let params = json!({
                "textDocument": text_document,
                "position": position_json(*line, *character),
                "context": { "includeDeclaration": true },
            });
            client.request("textDocument/references", params).await.map(|v| format_locations(&v, project_dir))
        }
        LspArgs::Hover { line, character, .. } => {
            let params = json!({ "textDocument": text_document, "position": position_json(*line, *character) });
            client.request("textDocument/hover", params).await.map(|v| format_hover(&v))
        }
        LspArgs::DocumentSymbol { .. } => {
            let params = json!({ "textDocument": text_document });
            client.request("textDocument/documentSymbol", params).await.map(|v| format_document_symbols(&v))
        }
    };

    match outcome {
        Ok(output) => ToolExecutionResult { success: true, output, written_path: None, written_content: None },
        Err(e) => error_result(e),
    }
}
