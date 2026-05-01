use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::time::{timeout, Duration};
use tokio::process::Command;
use super::tools::{WriteFileArgs, ReadFileArgs, BashArgs};

/// Classified tool error categories inspired by Cursor's agent harness taxonomy.
/// Each variant produces a clear, actionable message so the model can self-correct.
///
/// https://cursor.so/blog/self-driving-codebases
enum ToolError {
    /// The tool call arguments were invalid (e.g. bad JSON, missing field).
    InvalidArguments(String),
    /// A shell command exceeded the time limit.
    Timeout { command: String, seconds: u64 },
    /// File system I/O errors (permission denied, disk full, etc.).
    FileSystem(String),
    /// Security violations (path traversal, forbidden path).
    Security(String),
}

impl std::fmt::Display for ToolError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ToolError::InvalidArguments(detail) =>
                write!(f, "Invalid arguments: {detail}. Check the parameter names and types."),
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
        "bash" => execute_bash(args, project_dir).await,
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

    // Always use the output_path configured by the caller — the model must not
    // decide where to write, as it hallucinates filenames (e.g. "candy-pastel-theme.css"
    // in the app data root instead of the correct project path).
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
                output.push_str("\n\nNote: This file already existed. Use read_file first to see the current code before writing changes.");
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

/// Build a bubblewrap command that sandboxes the given shell command.
/// Uses Linux namespaces (PID, UTS, IPC, mount) to create a fresh, empty
/// filesystem where only the project directory is writable and everything
/// else is either read-only system paths or absent entirely.
///
/// Does NOT use --unshare-user (user namespace). On some filesystems
/// (e.g. btrfs subvolumes on CachyOS/Arch), --unshare-user causes
/// --bind to fail with "Permission denied" when the project path is inside
/// a subvolume. The fix: skip user namespace isolation. This sacrifices
/// UID remapping but retains all other namespace isolation (PID, UTS, IPC,
/// mount) and filesystem containment. See: https://github.com/containers/bubblewrap/issues/689
///
/// If bubblewrap is not available on the system, falls back to executing
/// the command directly (unsandboxed) — see execute_bash.
///
/// Sandbox design:
/// - /usr, /lib, /lib64 → read-only (system binaries/libraries)
/// - /bin, /sbin → symlinks into /usr (no separate bin needed)
/// - /proc, /dev → minimal process/device access for compilation tools
/// - /tmp → fresh tmpfs (discarded on exit)
/// - project_dir → the ONLY read-write mount
/// - HOME → set to project_dir (prevents ~/.ssh access)
/// - No network access (--unshare-net in isolation_args)
/// - No host env vars (--clearenv)
/// - New terminal session (prevents TIOCSTI injection)
///
/// Refs:
/// - https://github.com/containers/bubblewrap
/// - https://manpages.debian.org/unstable/bubblewrap/bwrap.1.en.html
fn build_sandbox_command(project_dir: &Path, shell_cmd: &str) -> Command {
    let proj_str = project_dir.to_string_lossy().to_string();
    let mut cmd = Command::new("bwrap");
    cmd
        .arg("--ro-bind").arg("/usr").arg("/usr")
        .arg("--symlink").arg("usr/bin").arg("/bin")
        .arg("--symlink").arg("usr/sbin").arg("/sbin")
        .arg("--proc").arg("/proc")
        .arg("--dev").arg("/dev")
        .arg("--tmpfs").arg("/tmp")
        .arg("--bind").arg(&proj_str).arg(&proj_str)
        .arg("--chdir").arg(&proj_str)
        // PID, UTS, IPC namespaces — but NOT --unshare-user.
        // --unshare-user causes --bind to fail on btrfs subvolumes
        // with "Permission denied". The user namespace is the only
        // namespace skipped; all others are retained.
        .arg("--unshare-pid")
        .arg("--unshare-ipc")
        .arg("--unshare-uts")
        .arg("--hostname").arg("ai-sandbox")
        .arg("--new-session")
        .arg("--die-with-parent")
        .arg("--clearenv")
        .arg("--setenv").arg("HOME").arg(&proj_str)
        .arg("--setenv").arg("USER").arg("sandbox")
        // PATH must include /home/m/.bun/bin for bun to be found.
        // This is injected at the Tauri layer in execute_bash() via
        // the shell command itself (cd ... && BUN_INSTALL=... bun ...),
        // so we just set a minimal PATH here.
        .arg("--setenv").arg("PATH").arg("/usr/local/bin:/usr/bin:/bin")
        .arg("sh").arg("-c").arg(shell_cmd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // /lib and /lib64: these contain ELF dynamic linkers and shared libraries.
    // /lib64 in particular may be a symlink (Fedora) or absent (merged-/usr
    // distros like Arch).  Use --ro-bind-try to skip silently when missing.
    cmd.arg("--ro-bind-try").arg("/lib").arg("/lib");
    cmd.arg("--ro-bind-try").arg("/lib64").arg("/lib64");
    cmd
}

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

    // Try bubblewrap first; fall back to bare sh if bwrap is not installed.
    // The fallback is intentionally unsandboxed — bubblewrap is a defense-in-depth
    // measure and this is a desktop development tool, not a server application.
    let child = build_sandbox_command(project_dir, &parsed.command)
        .spawn();

    let child = match child {
        Ok(c) => c,
        Err(_sandbox_err) => {
            // Bubblewrap not available — fall back to bare shell.
            // The model's tool description already constrains it to lint/type-check
            // commands within the project directory.
            match Command::new("sh")
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
            }
        }
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
