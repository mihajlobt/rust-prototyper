use std::path::{Path, PathBuf};
use super::tools::{WriteFileArgs, ReadFileArgs, EditFileArgs, BashArgs, TscCheckArgs, LintCheckArgs};

enum ToolError {
    InvalidArguments(String),
    #[cfg(not(target_os = "linux"))]
    Timeout { command: String, seconds: u64 },
    FileSystem(String),
    Security(String),
    NotFound(String),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ToolError::InvalidArguments(detail) =>
                write!(f, "Invalid arguments: {detail}. Check the parameter names and types."),
            #[cfg(not(target_os = "linux"))]
            ToolError::Timeout { command, seconds } =>
                write!(f, "Command timed out after {seconds}s: '{command}'. Try a simpler command or break it into smaller steps."),
            ToolError::FileSystem(detail) =>
                write!(f, "File system error: {detail}"),
            ToolError::Security(detail) =>
                write!(f, "Security error: {detail}"),
            ToolError::NotFound(detail) =>
                write!(f, "Not found: {detail}"),
        }
    }
}

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
        "edit_file" => execute_edit_file(args, app_data_dir).await,
        "bash" => execute_bash(args, project_dir).await,
        "run_tsc" => execute_run_tsc(args, project_dir).await,
        "run_lint" => execute_run_lint(args, project_dir).await,
        _ => ToolExecutionResult {
            success: false,
            output: format!("{name}: {}", ToolError::InvalidArguments(format!("unknown tool '{name}'"))),
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
            output: format!("write_file: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    let rel_path = output_path;

    if rel_path.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: format!("write_file: {}", ToolError::Security("path traversal not allowed".into())),
            written_path: None,
            written_content: None,
        };
    }

    let target = app_data_dir.join(rel_path);

    if let Some(parent) = target.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return ToolExecutionResult {
                success: false,
                output: format!("write_file: {}", ToolError::FileSystem(format!("failed to create directories: {e}"))),
                written_path: None,
                written_content: None,
            };
        }
    }

    let file_already_existed = target.exists();

    match tokio::fs::write(&target, &parsed.content).await {
        Ok(()) => {
            let mut output = format!("Written to: {rel_path}\nTo read this file, use read_file with path: {rel_path}");
            if file_already_existed {
                output.push_str("\n\nNote: This file already existed. Use edit_file for future changes to this file instead of write_file.");
            }
            ToolExecutionResult {
                success: true,
                output,
                written_path: Some(target),
                written_content: Some(parsed.content),
            }
        }
        Err(e) => ToolExecutionResult {
            success: false,
            output: format!("write_file: {}", ToolError::FileSystem(e.to_string())),
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
            output: format!("read_file: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    if parsed.path.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: format!("read_file: {}", ToolError::Security("path traversal not allowed".into())),
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
            output: format!("read_file: {}", ToolError::FileSystem(e.to_string())),
            written_path: None,
            written_content: None,
        },
    }
}

async fn execute_edit_file(
    args: &serde_json::Value,
    app_data_dir: &Path,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<EditFileArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("edit_file: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    if parsed.path.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: format!("edit_file: {}", ToolError::Security("path traversal not allowed".into())),
            written_path: None,
            written_content: None,
        };
    }

    let target = app_data_dir.join(&parsed.path);

    let current = match tokio::fs::read_to_string(&target).await {
        Ok(c) => c,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("edit_file: {}", ToolError::FileSystem(format!("could not read '{}': {e}", parsed.path))),
            written_path: None,
            written_content: None,
        },
    };

    let match_count = current.matches(parsed.old_string.as_str()).count();
    if match_count == 0 {
        return ToolExecutionResult {
            success: false,
            output: format!(
                "edit_file: {} — old_string not found in '{}'. Use read_file to verify the exact content.",
                ToolError::NotFound("old_string not found".into()),
                parsed.path
            ),
            written_path: None,
            written_content: None,
        };
    }
    if match_count > 1 {
        return ToolExecutionResult {
            success: false,
            output: format!(
                "edit_file: old_string appears {match_count} times in '{}' — it must be unique. Add more surrounding context to make it unambiguous.",
                parsed.path
            ),
            written_path: None,
            written_content: None,
        };
    }

    let updated = current.replacen(parsed.old_string.as_str(), parsed.new_string.as_str(), 1);

    match tokio::fs::write(&target, &updated).await {
        Ok(()) => ToolExecutionResult {
            success: true,
            output: format!("Edited: {}\nReplaced {} bytes with {} bytes.", parsed.path, parsed.old_string.len(), parsed.new_string.len()),
            written_path: Some(target),
            written_content: Some(updated),
        },
        Err(e) => ToolExecutionResult {
            success: false,
            output: format!("edit_file: {}", ToolError::FileSystem(e.to_string())),
            written_path: None,
            written_content: None,
        },
    }
}

async fn execute_run_tsc(
    args: &serde_json::Value,
    project_dir: &Path,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<TscCheckArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("run_tsc: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    let command = "cd component-preview && bun run tsc --noEmit --project ../tsconfig.check.json 2>&1";
    let raw = run_sandboxed_command(command, project_dir).await;

    let output = if let Some(filter_path) = parsed.path.filter(|p| !p.is_empty()) {
        // Strip "projects/<id>/" prefix so the filter matches tsc output (project-relative paths).
        let component_relative = if filter_path.starts_with("projects/") {
            filter_path.splitn(3, '/').nth(2).unwrap_or(&filter_path).to_string()
        } else {
            filter_path.clone()
        };
        raw.lines()
            .filter(|line| line.contains(component_relative.as_str()))
            .collect::<Vec<&str>>()
            .join("\n")
    } else {
        raw
    };

    let success = !output.contains("error TS");
    ToolExecutionResult {
        success,
        output,
        written_path: None,
        written_content: None,
    }
}

async fn execute_run_lint(
    args: &serde_json::Value,
    project_dir: &Path,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<LintCheckArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("run_lint: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    if parsed.path.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: format!("run_lint: {}", ToolError::Security("path traversal not allowed".into())),
            written_path: None,
            written_content: None,
        };
    }

    // LLM may pass either a project-relative path ("components/foo/component.tsx")
    // or a full app_data_dir-relative path ("projects/abc/components/foo/component.tsx").
    // Strip "projects/<id>/" prefix so the path is always relative to project_dir.
    let component_relative = if parsed.path.starts_with("projects/") {
        parsed.path.splitn(3, '/').nth(2).unwrap_or(&parsed.path)
    } else {
        &parsed.path
    };
    let escaped = match shlex::try_quote(&format!("../{}", component_relative)) {
        Ok(s) => s.into_owned(),
        Err(_) => return ToolExecutionResult {
            success: false,
            output: format!("run_lint: {}", ToolError::Security("path contains a nul byte".into())),
            written_path: None,
            written_content: None,
        },
    };
    let command = format!("cd component-preview && bunx eslint {} 2>&1; echo \"EXIT:$?\"", escaped);
    let raw = run_sandboxed_command(&command, project_dir).await;

    let (body, exit_code) = extract_exit_code(&raw);

    let output = if body.trim().is_empty() {
        format!("✅ No ESLint errors in {}", parsed.path)
    } else {
        body.to_string()
    };

    // Exit 0 = clean; 1 = lint violations; 2 = config/internal error.
    let success = exit_code == Some(0);
    ToolExecutionResult {
        success,
        output,
        written_path: None,
        written_content: None,
    }
}

// Parses `EXIT:<n>` sentinel we append via `echo "EXIT:$?"`. Returns None if absent (sandbox timeout).
fn extract_exit_code(raw: &str) -> (&str, Option<i32>) {
    if let Some(pos) = raw.rfind("EXIT:") {
        let sentinel = raw[pos..].trim_end();
        if let Some(code_str) = sentinel.strip_prefix("EXIT:") {
            if let Ok(code) = code_str.parse::<i32>() {
                let body = raw[..pos].trim_end_matches('\n');
                return (body, Some(code));
            }
        }
    }
    (raw, None)
}

#[cfg(target_os = "linux")]
async fn run_sandboxed_command(command: &str, project_dir: &Path) -> String {
    match crate::sandbox::execute_sandboxed(command, project_dir, 60).await {
        Ok(result) => result.output,
        Err(e) => format!("sandbox error: {e}"),
    }
}

#[cfg(not(target_os = "linux"))]
async fn run_sandboxed_command(command: &str, project_dir: &Path) -> String {
    use std::process::Stdio;
    use tokio::process::Command;
    use tokio::time::{timeout, Duration};

    let child = match Command::new("sh")
        .arg("-c")
        .arg(command)
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return format!("failed to spawn: {e}"),
    };

    match timeout(Duration::from_secs(60), child.wait_with_output()).await {
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            if stderr.is_empty() { stdout } else if stdout.is_empty() { stderr } else { format!("{stdout}\n{stderr}") }
        }
        Ok(Err(e)) => format!("process error: {e}"),
        Err(_) => format!("command timed out after 60s"),
    }
}

#[cfg(target_os = "linux")]
async fn execute_bash(
    args: &serde_json::Value,
    project_dir: &Path,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<BashArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("bash: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    match crate::sandbox::execute_sandboxed(&parsed.command, project_dir, 30).await {
        Ok(result) => result,
        Err(crate::sandbox::SandboxError::InjectionDetected(detail)) => ToolExecutionResult {
            success: false,
            output: format!("bash: {}", ToolError::Security(detail)),
            written_path: None,
            written_content: None,
        },
        Err(crate::sandbox::SandboxError::PolicyDenied(detail)) => ToolExecutionResult {
            success: false,
            output: format!("bash: {}", ToolError::Security(detail)),
            written_path: None,
            written_content: None,
        },
        Err(e) => ToolExecutionResult {
            success: false,
            output: format!("bash: {e}"),
            written_path: None,
            written_content: None,
        },
    }
}

#[cfg(not(target_os = "linux"))]
async fn execute_bash(
    args: &serde_json::Value,
    project_dir: &Path,
) -> ToolExecutionResult {
    use std::process::Stdio;
    use tokio::process::Command;
    use tokio::time::{timeout, Duration};

    let parsed = match serde_json::from_value::<BashArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("bash: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    let child = match Command::new("sh")
        .arg("-c")
        .arg(&parsed.command)
        .current_dir(project_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(c) => c,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("bash: {}", ToolError::FileSystem(format!("failed to spawn process: {e}"))),
            written_path: None,
            written_content: None,
        },
    };

    match timeout(Duration::from_secs(30), child.wait_with_output()).await {
        Ok(Ok(out)) => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            let stderr = String::from_utf8_lossy(&out.stderr).to_string();
            let combined = if stderr.is_empty() { stdout } else if stdout.is_empty() { stderr } else { format!("{stdout}\n{stderr}") };
            ToolExecutionResult {
                success: out.status.success(),
                output: if combined.is_empty() { "(no output)".to_string() } else { combined },
                written_path: None,
                written_content: None,
            }
        }
        Ok(Err(e)) => ToolExecutionResult {
            success: false,
            output: format!("bash: {}", ToolError::FileSystem(e.to_string())),
            written_path: None,
            written_content: None,
        },
        Err(_) => ToolExecutionResult {
            success: false,
            output: format!("bash: {}", ToolError::Timeout { command: parsed.command.clone(), seconds: 30 }),
            written_path: None,
            written_content: None,
        },
    }
}
