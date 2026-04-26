use std::path::{Path, PathBuf};
use tokio::time::{timeout, Duration};
use tokio::process::Command;
use super::tools::{WriteFileArgs, ReadFileArgs, BashArgs};

pub struct ToolExecutionResult {
    pub success: bool,
    pub output: String,
    pub written_path: Option<PathBuf>,
    pub written_content: Option<String>,
}

pub async fn execute_tool(
    name: &str,
    args: &serde_json::Value,
    app_data_dir: &Path,
    output_path: &str,
    project_dir: &Path,
) -> ToolExecutionResult {
    match name {
        "write_file" => execute_write_file(args, app_data_dir, output_path).await,
        "read_file" => execute_read_file(args, app_data_dir).await,
        "bash" => execute_bash(args, project_dir).await,
        _ => ToolExecutionResult {
            success: false,
            output: format!("Unknown tool: {name}"),
            written_path: None,
            written_content: None,
        },
    }
}

async fn execute_write_file(
    args: &serde_json::Value,
    app_data_dir: &Path,
    output_path: &str,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<WriteFileArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("write_file: invalid arguments: {e}"),
            written_path: None,
            written_content: None,
        },
    };

    // Always use the output_path configured by the caller — the model must not
    // decide where to write, as it hallucinates filenames (e.g. "candy-pastel-theme.css"
    // in the app data root instead of the correct project path).
    let rel_path = output_path;

    if rel_path.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: "write_file: path traversal not allowed".to_string(),
            written_path: None,
            written_content: None,
        };
    }

    let target = app_data_dir.join(rel_path);

    if let Some(parent) = target.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return ToolExecutionResult {
                success: false,
                output: format!("write_file: failed to create directories: {e}"),
                written_path: None,
                written_content: None,
            };
        }
    }

    match tokio::fs::write(&target, &parsed.content).await {
        Ok(()) => ToolExecutionResult {
            success: true,
            output: format!("Written: {rel_path}"),
            written_path: Some(target),
            written_content: Some(parsed.content),
        },
        Err(e) => ToolExecutionResult {
            success: false,
            output: format!("write_file: {e}"),
            written_path: None,
            written_content: None,
        },
    }
}

async fn execute_read_file(
    args: &serde_json::Value,
    app_data_dir: &Path,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<ReadFileArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("read_file: invalid arguments: {e}"),
            written_path: None,
            written_content: None,
        },
    };

    if parsed.path.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: "read_file: path traversal not allowed".to_string(),
            written_path: None,
            written_content: None,
        };
    }

    let target = app_data_dir.join(&parsed.path);

    match tokio::fs::read_to_string(&target).await {
        Ok(contents) => ToolExecutionResult {
            success: true,
            output: contents,
            written_path: None,
            written_content: None,
        },
        Err(e) => ToolExecutionResult {
            success: false,
            output: format!("read_file: {e}"),
            written_path: None,
            written_content: None,
        },
    }
}

async fn execute_bash(
    args: &serde_json::Value,
    project_dir: &Path,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<BashArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("bash: invalid arguments: {e}"),
            written_path: None,
            written_content: None,
        },
    };

    let child = Command::new("sh")
        .arg("-c")
        .arg(&parsed.command)
        .current_dir(project_dir)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("bash: failed to spawn: {e}"),
            written_path: None,
            written_content: None,
        },
    };

    match timeout(Duration::from_secs(30), child.wait_with_output()).await {
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let combined = if stderr.is_empty() {
                stdout
            } else if stdout.is_empty() {
                stderr
            } else {
                format!("{stdout}\n{stderr}")
            };
            ToolExecutionResult {
                success: out.status.success(),
                output: if combined.is_empty() { "(no output)".to_string() } else { combined },
                written_path: None,
                written_content: None,
            }
        }
        Ok(Err(e)) => ToolExecutionResult {
            success: false,
            output: format!("bash: {e}"),
            written_path: None,
            written_content: None,
        },
        Err(_) => ToolExecutionResult {
            success: false,
            output: "bash: timed out after 30 seconds".to_string(),
            written_path: None,
            written_content: None,
        },
    }
}
