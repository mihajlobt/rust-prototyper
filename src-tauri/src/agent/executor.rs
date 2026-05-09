use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, BufReader};
use super::tools::{WriteFileArgs, ReadFileArgs, EditFileArgs, BashArgs, TscCheckArgs, LintCheckArgs};

enum ToolError {
    InvalidArguments(String),
    #[cfg(not(target_os = "linux"))]
    Timeout { command: String, seconds: u64 },
    FileSystem(String),
    Security(String),
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
        "run_build" => execute_run_build(args, project_dir).await,
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
            output: "read_file: path traversal not allowed".to_string(),
            written_path: None,
            written_content: None,
        };
    }

    let target = app_data_dir.join(&parsed.path);

    if !target.exists() {
        return ToolExecutionResult {
            success: false,
            output: format!("read_file: file not found: {}", parsed.path),
            written_path: None,
            written_content: None,
        };
    }

    // Handle directory listing
    if target.is_dir() {
        match tokio::fs::read_dir(&target).await {
            Ok(mut dir) => {
                let mut entries = Vec::new();
                loop {
                    match dir.next_entry().await {
                        Ok(Some(entry)) => {
                            let name = entry.file_name().to_string_lossy().to_string();
                            // tokio DirEntry doesn't have file_type as sync, use metadata
                            let metadata = match entry.metadata().await {
                                Ok(m) => m.is_dir(),
                                Err(_) => false,
                            };
                            entries.push(if metadata { format!("{}/", name) } else { name });
                        }
                        Ok(None) => break,
                        Err(_) => continue,
                    }
                }
                entries.sort();
                let output = format!(
                    "<path>{}</path>\n<type>directory</type>\n<entries>\n{}\n</entries>",
                    parsed.path,
                    entries.join("\n")
                );
                return ToolExecutionResult {
                    success: true,
                    output,
                    written_path: None,
                    written_content: None,
                };
            }
            Err(e) => return ToolExecutionResult {
                success: false,
                output: format!("read_file: {}", ToolError::FileSystem(e.to_string())),
                written_path: None,
                written_content: None,
            },
        };
    }

    // Handle file reading with line offsets
    let file = match tokio::fs::File::open(&target).await {
        Ok(f) => f,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("read_file: {}", ToolError::FileSystem(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    let mut reader = BufReader::new(file).lines();

    // Convert 1-indexed offset to 0-indexed, default to 1
    let start_offset = parsed.offset.unwrap_or(1).saturating_sub(1) as usize;
    let max_lines = parsed.limit.unwrap_or(2000) as usize;
    const MAX_BYTES: usize = 50_000;

    let mut output = String::new();
    let mut current_line_num = 0;
    let mut bytes_written = 0;
    let mut truncated = false;

    // First pass: skip to offset
    while let Ok(Some(_)) = reader.next_line().await {
        current_line_num += 1;
        if current_line_num > start_offset {
            break;
        }
    }

    // Second pass: collect lines up to limit
    while let Ok(Some(line)) = reader.next_line().await {
        let line_prefix = format!("{}: ", current_line_num + 1);
        let line_with_newline = format!("{}{}\n", line_prefix, line);

        if bytes_written + line_with_newline.len() > MAX_BYTES || (current_line_num + 1 - start_offset) >= max_lines {
            truncated = true;
            break;
        }

        output.push_str(&line_with_newline);
        bytes_written += line_with_newline.len();
        current_line_num += 1;
    }

    // If we haven't read the full file yet, check if there's more
    if reader.next_line().await.is_ok() {
        truncated = true;
    }

    // Build XML output
    let total_lines = current_line_num;
    let output_xml = format!(
        "<path>{}</path>\n<type>file</type>\n<content>\n{}{}</content>",
        parsed.path,
        output,
        if truncated {
            format!(
                "\n(Showing {} lines. Use offset={} to continue.)",
                max_lines.min(current_line_num.saturating_sub(start_offset)),
                current_line_num + 1
            )
        } else {
            format!("\n(End of file - {} lines)", total_lines)
        }
    );

    ToolExecutionResult {
        success: true,
        output: output_xml,
        written_path: None,
        written_content: None,
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
            output: "edit_file: path traversal not allowed".to_string(),
            written_path: None,
            written_content: None,
        };
    }

    let target = app_data_dir.join(&parsed.path);

    let current = match tokio::fs::read_to_string(&target).await {
        Ok(c) => c,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("edit_file: could not read '{}': {}", parsed.path, e),
            written_path: None,
            written_content: None,
        },
    };

    let replace_all = parsed.replace_all.unwrap_or(false);

    // Try fuzzy matching (exact -> trimmed -> indent-flexible -> block-anchor)
    let updated = match fuzzy_replace(&current, &parsed.old_string, &parsed.new_string, replace_all) {
        Ok(u) => u,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: e,
            written_path: None,
            written_content: None,
        },
    };

    match tokio::fs::write(&target, &updated).await {
        Ok(()) => ToolExecutionResult {
            success: true,
            output: "Edit applied successfully.".to_string(),
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

/// Try multiple matching strategies in order, return first match
fn fuzzy_replace(content: &str, old: &str, new: &str, replace_all: bool) -> Result<String, String> {
    // 1. Exact match
    if replace_all {
        if content.contains(old) {
            return Ok(content.replace(old, new));
        }
    } else if content.contains(old) {
        return Ok(content.replacen(old, new, 1));
    }

    // 2. Trim whitespace
    let trimmed_old = old.trim();
    if content.contains(trimmed_old) {
        // Find each trimmed line, replace with proper indentation
        let result: String = content
            .lines()
            .map(|line| {
                if line.trim() == trimmed_old {
                    // Preserve original indentation
                    let indent_len = line.len() - line.trim_start().len();
                    let new_lines: Vec<&str> = new.lines().collect();
                    new_lines
                        .iter()
                        .enumerate()
                        .map(|(i, l)| {
                            if i == 0 {
                                format!("{}{}", " ".repeat(indent_len), l)
                            } else {
                                l.to_string()
                            }
                        })
                        .collect::<Vec<_>>()
                        .join("\n")
                } else {
                    line.to_string()
                }
            })
            .collect();
        return Ok(result);
    }

    // 3. Normalize indentation and try again
    let normalize = |s: &str| -> String {
        s.lines()
            .map(|line| {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    String::new()
                } else {
                    trimmed.to_string()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    };
    let normalized_old = normalize(old);
    let normalized_content = normalize(content);
    if normalized_content.contains(&normalized_old) {
        // Find the normalized match, reconstruct with original indentation
        let result = apply_indent_flexible_replace(content, old, new, replace_all);
        if result.is_some() {
            return Ok(result.unwrap());
        }
    }

    // 4. Block anchor (first/last non-empty lines as anchors)
    if let Some(replaced) = fuzzy_block_match(content, old, new, replace_all) {
        return Ok(replaced);
    }

    Err(format!(
        "edit_file: Could not find '{}' in the file. It must match exactly including whitespace and indentation.",
        old.lines().next().unwrap_or(old)
    ))
}

/// Replace with indentation preservation  
fn apply_indent_flexible_replace(content: &str, old: &str, new: &str, _replace_all: bool) -> Option<String> {
    let old_lines: Vec<&str> = old.lines().collect();
    let content_lines: Vec<&str> = content.lines().collect();

    for (i, content_line) in content_lines.iter().enumerate() {
        let trimmed = content_line.trim();
        let old_trimmed = old_lines.first()?.trim();

        if trimmed == old_trimmed {
            // Found start, calculate indent
            let indent_len = content_line.len() - content_line.trim_start().len();

            // Check if rest matches
            let mut matches = true;
            for (j, old_line) in old_lines.iter().skip(1).enumerate() {
                if i + 1 + j >= content_lines.len() {
                    matches = false;
                    break;
                }
                let content_trimmed = content_lines[i + 1 + j].trim();
                if content_trimmed != old_line.trim() {
                    matches = false;
                    break;
                }
            }

            if matches {
                // Build replacement with original indentation
                let new_lines: Vec<&str> = new.lines().collect();
                let replacement = new_lines
                    .iter()
                    .enumerate()
                    .map(|(j, l)| {
                        if j == 0 {
                            format!("{}{}", " ".repeat(indent_len), l)
                        } else {
                            l.to_string()
                        }
                    })
                    .collect::<Vec<_>>()
                    .join("\n");

                let end_idx = i + old_lines.len();
                let mut result = content_lines[..i].join("\n");
                if !result.is_empty() {
                    result.push('\n');
                }
                result.push_str(&replacement);
                if end_idx < content_lines.len() {
                    result.push('\n');
                    result.push_str(&content_lines[end_idx..].join("\n"));
                }
                return Some(result);
            }
        }
    }
    None
}

/// Block anchor matching - use first/last non-empty lines as anchors
fn fuzzy_block_match(content: &str, old: &str, new: &str, _replace_all: bool) -> Option<String> {
    let old_lines: Vec<&str> = old.lines().collect();
    if old_lines.len() < 2 {
        return None;
    }

    // Find first and last non-empty lines in old
    let first = old_lines.iter().find(|l| !l.trim().is_empty())?.trim();
    let last = old_lines.iter().rfind(|l| !l.trim().is_empty())?.trim();

    let content_lines: Vec<&str> = content.lines().collect();

    for i in 0..content_lines.len() {
        if content_lines[i].trim() != first {
            continue;
        }
        // Look for matching last anchor
        for j in (i + 2)..content_lines.len() {
            if content_lines[j].trim() == last {
                // Found block - verify middle content matches
                let block_len = j - i + 1;
                if block_len != old_lines.len() {
                    continue;
                }

                let mut matches = true;
                for k in 0..block_len {
                    if content_lines[i + k].trim() != old_lines[k].trim() {
                        matches = false;
                        break;
                    }
                }

                if matches {
                    // Replace the block
                    let new_lines: Vec<&str> = new.lines().collect();
                    let mut result = content_lines[..i].join("\n");
                    if !result.is_empty() && !new_lines.first().map(|l| l.trim().is_empty()).unwrap_or(true) {
                        result.push('\n');
                    }
                    result.push_str(&new_lines.join("\n"));
                    if j < content_lines.len() - 1 {
                        result.push('\n');
                        result.push_str(&content_lines[j + 1..].join("\n"));
                    }
                    return Some(result);
                }
            }
        }
    }
    None
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

    if parsed.path.as_deref().map(|p| p.contains("..")).unwrap_or(false) {
        return ToolExecutionResult {
            success: false,
            output: format!("run_tsc: {}", ToolError::Security("path traversal not allowed".into())),
            written_path: None,
            written_content: None,
        };
    }

    // Each component/screen dir has a tsconfig.json written at creation time (SidebarRail.tsx).
    // It extends component-preview/tsconfig.app.json and scopes "files" to that one .tsx file.
    // tsc ignores --project when files are passed as CLI args, so a dedicated tsconfig is the
    // only correct way to scope checking to one file. See: https://github.com/microsoft/TypeScript/issues/41865
    let tsconfig_arg = if let Some(ref file_path) = parsed.path {
        // Strip "projects/<id>/" prefix — path must be relative to project_dir
        let project_relative = if file_path.starts_with("projects/") {
            file_path.splitn(3, '/').nth(2).unwrap_or(file_path.as_str())
        } else {
            file_path.as_str()
        };
        // Derive the directory containing the .tsx file
        let dir = project_relative.rsplitn(2, '/').nth(1).unwrap_or(project_relative);
        let rel = format!("../{dir}/tsconfig.json");
        match shlex::try_quote(&rel) {
            Ok(quoted) => quoted.into_owned(),
            Err(_) => return ToolExecutionResult {
                success: false,
                output: format!("run_tsc: {}", ToolError::Security("path contains a nul byte".into())),
                written_path: None,
                written_content: None,
            },
        }
    } else {
        "../tsconfig.check.json".to_string()
    };

    let command = format!(
        r#"cd component-preview && bun run tsc --noEmit --project {tsconfig_arg} 2>&1; echo "EXIT:$?""#
    );
    let raw = run_sandboxed_command(&command, project_dir).await;
    let (body, exit_code) = extract_exit_code(&raw);

    let output = match exit_code {
        Some(code) => format!("{body}\nExit code: {code}"),
        None => body.to_string(),
    };

    ToolExecutionResult {
        success: exit_code == Some(0),
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

    // Exit 0 = clean; 1 = lint violations; 2 = config/internal error.
    ToolExecutionResult {
        success: exit_code == Some(0),
        output: body.to_string(),
        written_path: None,
        written_content: None,
    }
}

async fn execute_run_build(args: &serde_json::Value, project_dir: &Path) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<LintCheckArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("run_build: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    if parsed.path.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: format!("run_build: {}", ToolError::Security("path traversal not allowed".into())),
            written_path: None,
            written_content: None,
        };
    }

    let component_relative = if parsed.path.starts_with("projects/") {
        parsed.path.splitn(3, '/').nth(2).unwrap_or(&parsed.path)
    } else {
        &parsed.path
    };

    let escaped = match shlex::try_quote(&format!("../{}", component_relative)) {
        Ok(s) => s.into_owned(),
        Err(_) => return ToolExecutionResult {
            success: false,
            output: format!("run_build: {}", ToolError::Security("path contains a nul byte".into())),
            written_path: None,
            written_content: None,
        },
    };

    // esbuild is a Vite dependency — always available in component-preview/node_modules.
    let command = format!("cd component-preview && bunx esbuild {} --jsx=automatic --loader:.tsx=tsx 2>&1; echo \"EXIT:$?\"", escaped);
    let raw = run_sandboxed_command(&command, project_dir).await;
    let (body, exit_code) = extract_exit_code(&raw);

    ToolExecutionResult {
        success: exit_code == Some(0),
        output: body.to_string(),
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
