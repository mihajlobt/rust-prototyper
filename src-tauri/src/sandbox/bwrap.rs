use std::path::Path;
use std::process::Stdio;
use tokio::process::Command;

use super::error::SandboxError;

/// Build a hardened bwrap command with namespace isolation.
/// Mount namespaces provide an empty filesystem; only explicitly mounted
/// paths are accessible. Security layers applied via --sandbox-init re-exec.
///
/// No --unshare-user: btrfs subvolume incompatibility (containers/bubblewrap#689).
/// No --unshare-net: required for bun install; network is unrestricted.
/// --ro-bind-try /etc: DNS (resolv.conf(5)) and TLS (openssl(1)).
/// --ro-bind self_exe: re-exec target must be mounted (bwrap(1)).
/// bwrap flags verified against bwrap(1).
pub fn build_sandbox_command(
    project_dir: &Path,
    shell_cmd: &str,
) -> Result<Command, SandboxError> {
    let self_exe = std::fs::read_link("/proc/self/exe")
        .map_err(SandboxError::Io)?;
    let self_exe_str = self_exe.to_string_lossy().to_string();
    let proj_str = project_dir.to_string_lossy().to_string();

    let mut cmd = Command::new("bwrap");
    cmd.arg("--ro-bind").arg("/usr").arg("/usr")
        .arg("--symlink").arg("usr/bin").arg("/bin")
        .arg("--symlink").arg("usr/sbin").arg("/sbin")
        .arg("--ro-bind-try").arg("/lib").arg("/lib")
        .arg("--ro-bind-try").arg("/lib64").arg("/lib64")
        .arg("--ro-bind-try").arg("/etc").arg("/etc")
        .arg("--ro-bind-try").arg("/run").arg("/run")
        .arg("--ro-bind").arg(&self_exe_str).arg(&self_exe_str)
        .arg("--proc").arg("/proc")
        .arg("--dev").arg("/dev")
        .arg("--tmpfs").arg("/tmp")
        .arg("--bind").arg(&proj_str).arg(&proj_str)
        .arg("--chdir").arg(&proj_str)
        .arg("--unshare-pid")
        .arg("--unshare-ipc")
        .arg("--unshare-uts")
        .arg("--hostname").arg("ai-sandbox")
        .arg("--new-session")
        .arg("--die-with-parent")
        .arg("--clearenv")
        .arg("--setenv").arg("HOME").arg(&proj_str)
        .arg("--setenv").arg("USER").arg("sandbox")
        .arg("--setenv").arg("PATH").arg("/usr/local/bin:/usr/bin:/bin");

    // Pass SANDBOX_DEBUG through to the sandbox-init process if set in parent
    if let Ok(debug_val) = std::env::var("SANDBOX_DEBUG") {
        cmd.arg("--setenv").arg("SANDBOX_DEBUG").arg(&debug_val);
    }

    cmd.arg("--").arg(&self_exe_str)
        .arg("--sandbox-init")
        .arg("--").arg("sh").arg("-c").arg(shell_cmd)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    Ok(cmd)
}