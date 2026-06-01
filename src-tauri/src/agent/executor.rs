use std::path::{Path, PathBuf};
use tokio::io::{AsyncBufReadExt, BufReader};
use crate::commands::ai::ToolPermissionMode;
use super::tools::{WriteFileArgs, ReadFileArgs, EditFileArgs, BashArgs, TscCheckArgs, LintCheckArgs, GlobArgs, GrepArgs, RegisterScreenArgs, SetActiveThemeArgs, ValidateDesignJsonArgs};

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
    permission_mode: ToolPermissionMode,
) -> ToolExecutionResult {
    let skip_policy = matches!(permission_mode, ToolPermissionMode::AutoAcceptAll);
    match name {
        "write_file" => execute_write_file(args, app_data_dir, output_path, project_dir).await,
        "read_file" => execute_read_file(args, app_data_dir, project_dir).await,
        "edit_file" => execute_edit_file(args, app_data_dir, project_dir).await,
        "bash" => execute_bash(args, app_data_dir, skip_policy).await,
        "run_tsc" => execute_run_tsc(args, project_dir, skip_policy).await,
        "run_lint" => execute_run_lint(args, project_dir, skip_policy).await,
        "run_build" => execute_run_build(args, project_dir, skip_policy).await,
        "glob" => execute_glob(args, app_data_dir, skip_policy).await,
        "grep" => execute_grep(args, app_data_dir, skip_policy).await,
        "register_screen" => execute_register_screen(args, app_data_dir, output_path).await,
        "set_active_theme" => execute_set_active_theme(args, app_data_dir, output_path).await,
        "validate_design_json" => execute_validate_design_json(args, app_data_dir).await,
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
    project_dir: &Path,
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

    // Resolve target path: model-specified path takes precedence over the default output_path.
    let (target, display_path) = if let Some(model_path) = parsed.path.as_deref() {
        if model_path.contains("..") {
            return ToolExecutionResult {
                success: false,
                output: format!("write_file: {}", ToolError::Security("path traversal not allowed".into())),
                written_path: None,
                written_content: None,
            };
        }
        // Resolve: app-data-root-relative if starts with "projects/", else project-dir-relative.
        let resolved = if model_path.starts_with("projects/") {
            app_data_dir.join(model_path)
        } else {
            project_dir.join(model_path)
        };
        // Sandbox: must stay within the current project directory.
        if !resolved.starts_with(project_dir) {
            return ToolExecutionResult {
                success: false,
                output: format!("write_file: {}", ToolError::Security("path must be within the current project".into())),
                written_path: None,
                written_content: None,
            };
        }
        // strip_prefix cannot fail here: sandbox guarantees resolved ⊆ project_dir ⊆ app_data_dir.
        let display = match resolved.strip_prefix(app_data_dir) {
            Ok(p) => p.to_string_lossy().to_string(),
            Err(_) => return ToolExecutionResult {
                success: false,
                output: format!("write_file: {}", ToolError::Security("path resolution failed".into())),
                written_path: None,
                written_content: None,
            },
        };
        (resolved, display)
    } else {
        if output_path.contains("..") {
            return ToolExecutionResult {
                success: false,
                output: format!("write_file: {}", ToolError::Security("path traversal not allowed".into())),
                written_path: None,
                written_content: None,
            };
        }
        (app_data_dir.join(output_path), output_path.to_string())
    };

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
            let mut output = format!("Written to: {display_path}\nTo read this file, use read_file with path: {display_path}");
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
    project_dir: &Path,
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

    // Resolve path: app-data-root-relative (e.g. "projects/abc/generated/src/pages/home.tsx")
    // or project-relative (e.g. "generated/src/pages/home.tsx", "generated/src/components/foo/component.tsx").
    let target = match resolve_file_path(&parsed.path, app_data_dir, project_dir) {
        Some(t) => t,
        None => return ToolExecutionResult {
            success: false,
            output: "read_file: path traversal not allowed".to_string(),
            written_path: None,
            written_content: None,
        },
    };

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
    project_dir: &Path,
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

    // Resolve path: app-data-root-relative (e.g. "projects/abc/generated/src/pages/home.tsx")
    // or project-relative (e.g. "generated/src/pages/home.tsx", "generated/src/components/foo/component.tsx").
    let target = match resolve_file_path(&parsed.path, app_data_dir, project_dir) {
        Some(t) => t,
        None => return ToolExecutionResult {
            success: false,
            output: "edit_file: path traversal not allowed".to_string(),
            written_path: None,
            written_content: None,
        },
    };

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
        if let Some(replaced) = apply_indent_flexible_replace(content, old, new, replace_all) {
            return Ok(replaced);
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

/// Strip outer path wrappers so the result is relative to `generated/`.
/// Handles:
///   "projects/<id>/generated/src/pages/home.tsx" → "src/pages/home.tsx"
///   "generated/src/pages/home.tsx"               → "src/pages/home.tsx"
///   "src/pages/home.tsx"                          → "src/pages/home.tsx"
fn to_generated_relative(path: &str) -> &str {
    let p = if path.starts_with("projects/") {
        path.splitn(3, '/').nth(2).unwrap_or(path)
    } else {
        path
    };
    p.strip_prefix("generated/").unwrap_or(p)
}

async fn execute_run_tsc(
    args: &serde_json::Value,
    project_dir: &Path,
    skip_policy: bool,
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

    // All generated code lives in generated/ which has its own complete tsconfig.app.json.
    // Run tsc over the whole project; if a specific file path was given, filter the output.
    // Note: "bun run tsc" uses the root tsconfig.json which only has references and no files,
    // so we must use "bun tsc --project tsconfig.app.json" to run against the actual source.
    let filter_path = parsed.path.as_deref().map(to_generated_relative).map(str::to_owned);

    let command = r#"cd generated && bun tsc --noEmit --project tsconfig.app.json 2>&1; echo "EXIT:$?""#.to_string();
    let raw = run_sandboxed_command(&command, project_dir, skip_policy).await;
    let (body, exit_code) = extract_exit_code(&raw);

    // When a specific file was requested, filter output to lines mentioning that file.
    let output_text = if let Some(ref fp) = filter_path {
        let filtered: Vec<&str> = body
            .lines()
            .filter(|l| l.contains(fp.as_str()) || l.trim().is_empty())
            .collect();
        if filtered.is_empty() { body.to_string() } else { filtered.join("\n") }
    } else {
        body.to_string()
    };

    let output = match exit_code {
        Some(code) => format!("{output_text}\nExit code: {code}"),
        None => output_text,
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
    skip_policy: bool,
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

    // Strip outer prefixes so path is relative to generated/.
    // ESLint v9 flat config applies to files inside the project root, so we run from generated/.
    let generated_relative = to_generated_relative(&parsed.path).to_owned();
    let escaped = match shlex::try_quote(&generated_relative) {
        Ok(s) => s.into_owned(),
        Err(_) => return ToolExecutionResult {
            success: false,
            output: format!("run_lint: {}", ToolError::Security("path contains a nul byte".into())),
            written_path: None,
            written_content: None,
        },
    };
    let command = format!("cd generated && bunx eslint {} 2>&1; echo \"EXIT:$?\"", escaped);
    let raw = run_sandboxed_command(&command, project_dir, skip_policy).await;

    let (body, exit_code) = extract_exit_code(&raw);

    // Exit 0 = clean; 1 = lint violations; 2 = config/internal error.
    ToolExecutionResult {
        success: exit_code == Some(0),
        output: body.to_string(),
        written_path: None,
        written_content: None,
    }
}

async fn execute_run_build(args: &serde_json::Value, project_dir: &Path, skip_policy: bool) -> ToolExecutionResult {
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

    let generated_relative = to_generated_relative(&parsed.path).to_owned();
    let escaped = match shlex::try_quote(&generated_relative) {
        Ok(s) => s.into_owned(),
        Err(_) => return ToolExecutionResult {
            success: false,
            output: format!("run_build: {}", ToolError::Security("path contains a nul byte".into())),
            written_path: None,
            written_content: None,
        },
    };

    // esbuild is a Vite dependency — available in generated/node_modules.
    let command = format!("cd generated && bunx esbuild {} --jsx=automatic --loader:.tsx=tsx 2>&1; echo \"EXIT:$?\"", escaped);
    let raw = run_sandboxed_command(&command, project_dir, skip_policy).await;
    let (body, exit_code) = extract_exit_code(&raw);

    ToolExecutionResult {
        success: exit_code == Some(0),
        output: body.to_string(),
        written_path: None,
        written_content: None,
    }
}

async fn execute_glob(args: &serde_json::Value, app_data_dir: &Path, skip_policy: bool) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<GlobArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("glob: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    if parsed.pattern.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: format!("glob: {}", ToolError::Security("path traversal not allowed".into())),
            written_path: None,
            written_content: None,
        };
    }

    // Extract the non-glob prefix as the find base directory so recursive search works.
    // "projects/newesttest/**/*" → base "projects/newesttest", find runs from app_data_dir.
    let base = glob_base_dir(&parsed.pattern);
    let escaped_base = match shlex::try_quote(base) {
        Ok(q) => q.into_owned(),
        Err(_) => return ToolExecutionResult {
            success: false,
            output: format!("glob: {}", ToolError::Security("pattern contains a nul byte".into())),
            written_path: None,
            written_content: None,
        },
    };

    // Run recursive find from the base directory; no -path filter needed because
    // find already searches only within the given base.
    let command = format!(
        r#"find {escaped_base} -not -path '*/node_modules/*' -not -path '*/.git/*' -type f | head -200; echo "EXIT:$?""#
    );
    let raw = run_sandboxed_command(&command, app_data_dir, skip_policy).await;
    let (body, exit_code) = extract_exit_code(&raw);

    ToolExecutionResult {
        success: exit_code == Some(0),
        output: if body.trim().is_empty() { "(no files matched)".to_string() } else { body.to_string() },
        written_path: None,
        written_content: None,
    }
}

async fn execute_grep(args: &serde_json::Value, app_data_dir: &Path, skip_policy: bool) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<GrepArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("grep: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    if parsed.pattern.contains("..") || parsed.path.as_deref().map(|p| p.contains("..")).unwrap_or(false) {
        return ToolExecutionResult {
            success: false,
            output: format!("grep: {}", ToolError::Security("path traversal not allowed".into())),
            written_path: None,
            written_content: None,
        };
    }

    let escaped_pattern = match shlex::try_quote(&parsed.pattern) {
        Ok(q) => q.into_owned(),
        Err(_) => return ToolExecutionResult {
            success: false,
            output: format!("grep: {}", ToolError::Security("pattern contains a nul byte".into())),
            written_path: None,
            written_content: None,
        },
    };

    let search_path = parsed.path.as_deref().unwrap_or(".");
    let escaped_path = match shlex::try_quote(search_path) {
        Ok(q) => q.into_owned(),
        Err(_) => return ToolExecutionResult {
            success: false,
            output: format!("grep: {}", ToolError::Security("path contains a nul byte".into())),
            written_path: None,
            written_content: None,
        },
    };

    let command = format!(
        r#"grep -rn --include='*.tsx' --include='*.ts' --include='*.css' --include='*.json' --exclude-dir=node_modules --exclude-dir=.git {escaped_pattern} {escaped_path} | head -100; echo "EXIT:$?""#
    );
    let raw = run_sandboxed_command(&command, app_data_dir, skip_policy).await;
    let (body, exit_code) = extract_exit_code(&raw);

    // grep exits 1 when no matches found — that's not an error for our purposes.
    ToolExecutionResult {
        success: exit_code == Some(0) || exit_code == Some(1),
        output: if body.trim().is_empty() { "(no matches found)".to_string() } else { body.to_string() },
        written_path: None,
        written_content: None,
    }
}

/// Resolve a path argument that may be app-data-root-relative (e.g. "projects/abc/generated/src/pages/home.tsx")
/// or project-relative (e.g. "generated/src/pages/home.tsx" or "generated/src/components/foo/component.tsx").
/// If the path starts with "projects/", treat it as app-data-root-relative.
/// Otherwise, resolve it relative to the project directory.
/// Returns None if the path contains ".." (path traversal).
fn resolve_file_path(path: &str, app_data_dir: &Path, project_dir: &Path) -> Option<PathBuf> {
    if path.contains("..") {
        return None;
    }
    if path.starts_with("projects/") {
        Some(app_data_dir.join(path))
    } else {
        Some(project_dir.join(path))
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

/// Derive the project directory (projects/{id}/) from the output_path.
/// output_path format: "projects/{id}/generated/src/pages/foo.tsx"
fn project_dir_from_output_path(app_data_dir: &Path, output_path: &str) -> PathBuf {
    let parts: Vec<&str> = output_path.splitn(3, '/').collect();
    if parts.len() >= 2 {
        app_data_dir.join(parts[0]).join(parts[1])
    } else {
        app_data_dir.to_path_buf()
    }
}

async fn execute_register_screen(
    args: &serde_json::Value,
    app_data_dir: &Path,
    output_path: &str,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<RegisterScreenArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("register_screen: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    let proj_dir = project_dir_from_output_path(app_data_dir, output_path);
    let nav_path = proj_dir.join("navigation.json");

    // Load or create navigation.json
    let mut nav: serde_json::Value = if nav_path.exists() {
        match tokio::fs::read_to_string(&nav_path).await {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|_| {
                serde_json::json!({ "defaultScreen": "", "screens": [], "hotspots": [] })
            }),
            Err(_) => serde_json::json!({ "defaultScreen": "", "screens": [], "hotspots": [] }),
        }
    } else {
        serde_json::json!({ "defaultScreen": "", "screens": [], "hotspots": [] })
    };

    // Ensure required fields exist
    if nav.get("screens").is_none() { nav["screens"] = serde_json::json!([]); }
    if nav.get("hotspots").is_none() { nav["hotspots"] = serde_json::json!([]); }
    if nav.get("defaultScreen").is_none() { nav["defaultScreen"] = serde_json::json!(""); }

    // Upsert screen entry — merge with existing to preserve x/y/layout fields
    let screens = match nav["screens"].as_array_mut() {
        Some(s) => s,
        None => return ToolExecutionResult {
            success: false,
            output: "register_screen: navigation.json has invalid 'screens' field (not an array)".to_string(),
            written_path: None,
            written_content: None,
        },
    };
    let existing_pos = screens.iter().position(|s| {
        s.get("id").and_then(|v| v.as_str()) == Some(parsed.screen_id.as_str())
    });
    if let Some(pos) = existing_pos {
        // Merge: update only the fields we know about, preserve everything else (x, y, layout, etc.)
        if let Some(entry) = screens[pos].as_object_mut() {
            entry.insert("id".to_string(), serde_json::json!(parsed.screen_id));
            entry.insert("path".to_string(), serde_json::json!(parsed.path));
            entry.insert("title".to_string(), serde_json::json!(parsed.title));
        }
    } else {
        screens.push(serde_json::json!({
            "id": parsed.screen_id,
            "path": parsed.path,
            "title": parsed.title,
        }));
    }

    // Set default screen if none is set or explicitly requested
    let default_screen = nav["defaultScreen"].as_str().unwrap_or("").to_string();
    let is_default = parsed.is_default.unwrap_or(false);
    if default_screen.is_empty() || is_default {
        nav["defaultScreen"] = serde_json::json!(parsed.screen_id);
    }

    // Write back
    let serialized = match serde_json::to_string_pretty(&nav) {
        Ok(s) => s,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("register_screen: failed to serialize navigation.json: {e}"),
            written_path: None,
            written_content: None,
        },
    };

    if let Some(parent) = nav_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    match tokio::fs::write(&nav_path, &serialized).await {
        Ok(()) => ToolExecutionResult {
            success: true,
            output: format!("Screen '{}' registered at path '{}'. navigation.json updated.", parsed.screen_id, parsed.path),
            written_path: Some(nav_path),
            written_content: Some(serialized),
        },
        Err(e) => ToolExecutionResult {
            success: false,
            output: format!("register_screen: {}", ToolError::FileSystem(e.to_string())),
            written_path: None,
            written_content: None,
        },
    }
}

async fn execute_set_active_theme(
    args: &serde_json::Value,
    app_data_dir: &Path,
    output_path: &str,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<SetActiveThemeArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("set_active_theme: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    // The projectSettingsStore persists to tauri-plugin-store file `project-{id}.json`
    // located in app_data_dir — NOT inside the project folder.
    // File: {app_data_dir}/project-{id}.json  (tauri-plugin-store format = plain JSON)
    let project_id = output_path.splitn(3, '/').nth(1).unwrap_or("");
    let settings_path = app_data_dir.join(format!("project-{}.json", project_id));

    // Load existing store or start with empty object — preserve all other keys
    let mut project_settings: serde_json::Value = if settings_path.exists() {
        match tokio::fs::read_to_string(&settings_path).await {
            Ok(raw) => serde_json::from_str(&raw).unwrap_or_else(|_| serde_json::json!({})),
            Err(_) => serde_json::json!({}),
        }
    } else {
        serde_json::json!({})
    };

    project_settings["stylePreset"] = serde_json::json!(parsed.theme_slug);

    let serialized = match serde_json::to_string_pretty(&project_settings) {
        Ok(s) => s,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("set_active_theme: failed to serialize settings: {e}"),
            written_path: None,
            written_content: None,
        },
    };

    if let Some(parent) = settings_path.parent() {
        let _ = tokio::fs::create_dir_all(parent).await;
    }

    match tokio::fs::write(&settings_path, &serialized).await {
        Ok(()) => ToolExecutionResult {
            success: true,
            output: format!("Active theme set to '{}'. Design tokens from this theme will be used in subsequent screen generation.", parsed.theme_slug),
            written_path: Some(settings_path),
            written_content: Some(serialized),
        },
        Err(e) => ToolExecutionResult {
            success: false,
            output: format!("set_active_theme: {}", ToolError::FileSystem(e.to_string())),
            written_path: None,
            written_content: None,
        },
    }
}

// Required top-level keys for DesignLanguageSpec (from src/lib/design/spec.ts:166-189)
const REQUIRED_DESIGN_KEYS: &[&str] = &[
    "meta", "color", "typography", "spacing", "radii", "shadows",
    "borders", "motion", "components", "iconography", "layout",
    "voice", "content", "antiPatterns",
];
// Required color token keys for light/dark palettes (18 tokens from spec.ts)
const REQUIRED_COLOR_TOKENS: &[&str] = &[
    "background", "foreground", "card", "cardForeground", "popover", "popoverForeground",
    "primary", "primaryForeground", "secondary", "secondaryForeground",
    "muted", "mutedForeground", "accent", "accentForeground",
    "destructive", "destructiveForeground", "border", "input", "ring",
];

async fn execute_validate_design_json(
    args: &serde_json::Value,
    app_data_dir: &Path,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<ValidateDesignJsonArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("validate_design_json: {}", ToolError::InvalidArguments(e.to_string())),
            written_path: None,
            written_content: None,
        },
    };

    if parsed.path.contains("..") {
        return ToolExecutionResult {
            success: false,
            output: format!("validate_design_json: {}", ToolError::Security("path traversal not allowed".into())),
            written_path: None,
            written_content: None,
        };
    }

    let target = if parsed.path.starts_with("projects/") {
        app_data_dir.join(&parsed.path)
    } else {
        app_data_dir.join(&parsed.path)
    };

    let raw = match tokio::fs::read_to_string(&target).await {
        Ok(s) => s,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("validate_design_json: cannot read file: {e}"),
            written_path: None,
            written_content: None,
        },
    };

    let value: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => return ToolExecutionResult {
            success: false,
            output: format!("validate_design_json: invalid JSON: {e}"),
            written_path: None,
            written_content: None,
        },
    };

    let mut errors: Vec<String> = Vec::new();

    // Check required top-level keys
    for key in REQUIRED_DESIGN_KEYS {
        if value.get(key).is_none() {
            errors.push(format!("Missing required top-level key: '{key}'"));
        }
    }

    // Check color token keys for light and dark palettes
    if let Some(color) = value.get("color") {
        for palette in &["light", "dark"] {
            if let Some(palette_obj) = color.get(palette) {
                for token in REQUIRED_COLOR_TOKENS {
                    if palette_obj.get(token).is_none() {
                        errors.push(format!("Missing color token '{}' in color.{}", token, palette));
                    }
                }
            } else {
                errors.push(format!("Missing color.{palette} palette"));
            }
        }
    }

    if errors.is_empty() {
        ToolExecutionResult {
            success: true,
            output: "design.json is valid — all required keys present.".to_string(),
            written_path: None,
            written_content: None,
        }
    } else {
        ToolExecutionResult {
            success: false,
            output: format!("design.json validation failed:\n{}", errors.join("\n")),
            written_path: None,
            written_content: None,
        }
    }
}

#[cfg(target_os = "linux")]
async fn run_sandboxed_command(command: &str, project_dir: &Path, skip_policy: bool) -> String {
    match crate::sandbox::execute_sandboxed(command, project_dir, 60, skip_policy).await {
        Ok(result) => result.output,
        Err(e) => format!("sandbox error: {e}"),
    }
}

#[cfg(not(target_os = "linux"))]
async fn run_sandboxed_command(command: &str, project_dir: &Path, _skip_policy: bool) -> String {
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


/// Extract the non-glob prefix directory from a glob pattern so find can use it as the base.
/// `projects/newesttest/**/*.tsx` → `projects/newesttest`
fn glob_base_dir(pattern: &str) -> &str {
    let first_glob = pattern.find(['*', '?', '[']).unwrap_or(pattern.len());
    let before_glob = &pattern[..first_glob];
    match before_glob.rfind('/') {
        Some(pos) => &pattern[..pos],
        None => ".",
    }
}

#[cfg(target_os = "linux")]
async fn execute_bash(
    args: &serde_json::Value,
    app_data_dir: &Path,
    skip_policy: bool,
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

    // Do NOT apply expand_combined_flags here — the bash command is a raw shell
    // pipeline with operators (&&, |, >) that must not be re-tokenized and re-quoted.
    match crate::sandbox::execute_sandboxed(&parsed.command, app_data_dir, 30, skip_policy).await {
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
    app_data_dir: &Path,
    _skip_policy: bool,
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
        .current_dir(app_data_dir)
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
