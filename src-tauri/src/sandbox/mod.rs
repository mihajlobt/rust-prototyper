pub mod bwrap;
pub mod error;
pub mod policy;
pub mod rlimits;
pub mod seccomp;
pub mod landlock;

use std::path::{Path, PathBuf};
use std::time::Duration;
use tokio::time::timeout;

pub use error::SandboxError;

#[cfg(target_os = "linux")]
use crate::agent::executor::ToolExecutionResult;

#[cfg(target_os = "linux")]
pub async fn execute_sandboxed(
    command: &str,
    project_dir: &Path,
    timeout_secs: u64,
    skip_policy: bool,
) -> Result<ToolExecutionResult, SandboxError> {
    if !skip_policy {
        if let Err(e) = policy::validate_command(command) {
            return Ok(ToolExecutionResult {
                success: false,
                output: e.to_string(),
                written_path: None,
                written_content: None,
            });
        }
    }

    let mut child_cmd = bwrap::build_sandbox_command(project_dir, command)?;
    let child = child_cmd.spawn().map_err(SandboxError::Io)?;

    match timeout(Duration::from_secs(timeout_secs), child.wait_with_output()).await {
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
            Ok(ToolExecutionResult {
                success: out.status.success(),
                output: if combined.is_empty() { "(no output)".to_string() } else { combined },
                written_path: None,
                written_content: None,
            })
        }
        Ok(Err(e)) => Err(SandboxError::Io(e)),
        Err(_) => Ok(ToolExecutionResult {
            success: false,
            output: format!("Command timed out after {timeout_secs}s: {command}"),
            written_path: None,
            written_content: None,
        }),
    }
}

#[cfg(target_os = "linux")]
pub fn sandbox_init(args: &[String]) -> ! {
    use std::os::unix::process::CommandExt;

    let debug = std::env::var("SANDBOX_DEBUG").is_ok();

    if debug {
        eprintln!("[sandbox-init] applying security restrictions...");
    }

    let project_dir = std::env::var("HOME").unwrap_or_else(|_| "/tmp".to_string());
    let project_path = Path::new(&project_dir);
    let self_exe = std::fs::read_link("/proc/self/exe").unwrap_or_else(|_| PathBuf::from("/proc/self/exe"));

    if let Err(e) = landlock::apply_landlock(project_path, &self_exe) {
        if debug {
            eprintln!("[sandbox-init] WARNING: Landlock not applied: {e}");
        }
    }

    if let Err(e) = seccomp::apply_seccomp_filter() {
        // Always fatal — seccomp failure is a security issue
        eprintln!("[sandbox-init] FATAL: seccomp filter failed: {e}");
        std::process::exit(127);
    }

    if let Err(e) = rlimits::apply_rlimits() {
        if debug {
            eprintln!("[sandbox-init] WARNING: rlimits not applied: {e}");
        }
    }

    if debug {
        eprintln!("[sandbox-init] security restrictions applied, executing command");
    }

    if args.is_empty() {
        eprintln!("[sandbox-init] ERROR: no command to execute");
        std::process::exit(126);
    }

    let program = &args[0];
    let exec_args: Vec<&str> = args[1..].iter().map(String::as_str).collect();

    let err = std::process::Command::new(program)
        .args(&exec_args)
        .exec();

    eprintln!("[sandbox-init] exec failed: {err}");
    std::process::exit(126);
}

#[cfg(not(target_os = "linux"))]
pub fn sandbox_init(_args: &[String]) -> ! {
    unreachable!("--sandbox-init only supported on Linux")
}