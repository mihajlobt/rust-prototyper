//! Cross-platform process/port cleanup helpers for the Bonsai server.
//!
//! Both functions are intentionally split by `#[cfg(unix)]` / `#[cfg(windows)]`
//! to match the original `bonsai.rs` implementation exactly. `kill_port_sync`
//! must always be called from `tokio::task::spawn_blocking` to avoid stalling
//! the async runtime with synchronous `lsof`/`taskkill` invocations.

use std::time::Duration;

/// Kill a process group by sending SIGTERM, waiting briefly, then SIGKILL.
/// The uvicorn process is started in its own process group (PGID = PID),
/// so killing the group also kills Python/CUDA worker children.
/// Async — uses tokio::time::sleep, never blocks the runtime.
#[cfg(unix)]
pub(super) async fn kill_process_group(pid: u32) {
    // Send SIGTERM to the process group (negative PID = process group)
    let pgid = format!("-{}", pid);
    let _ = tokio::process::Command::new("kill")
        .arg(&pgid)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;

    // Give group 2 seconds to clean up GPU memory gracefully
    tokio::time::sleep(Duration::from_secs(2)).await;

    // If still alive, SIGKILL the whole group
    let _ = tokio::process::Command::new("kill")
        .args(["-9", &pgid])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
}

#[cfg(windows)]
pub(super) async fn kill_process_group(pid: u32) {
    // On Windows, taskkill /T kills the process tree
    let _ = tokio::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;
}

/// Cross-platform port killing — synchronous, must be called via `tokio::task::spawn_blocking`
/// to avoid blocking the async runtime.
pub(super) fn kill_port_sync(port: u16) {
    #[cfg(unix)]
    {
        let output = std::process::Command::new("lsof")
            .args(["-t", &format!("-i:{}", port), "-s", "TCP:LISTEN"])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        if let Ok(out) = output {
            let pids = String::from_utf8_lossy(&out.stdout);
            for pid in pids.lines() {
                let pid = pid.trim();
                if pid.is_empty() {
                    continue;
                }
                let _ = std::process::Command::new("kill")
                    .args(["-9", pid])
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .output();
            }
        }
    }
    #[cfg(windows)]
    {
        let output = std::process::Command::new("cmd")
            .args(["/C", &format!("netstat -ano | findstr :{}", port)])
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output();

        if let Ok(out) = output {
            let text = String::from_utf8_lossy(&out.stdout);
            for line in text.lines() {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if let Some(pid) = parts.last() {
                    let _ = std::process::Command::new("taskkill")
                        .args(["/PID", pid, "/F"])
                        .stdout(std::process::Stdio::null())
                        .stderr(std::process::Stdio::null())
                        .output();
                }
            }
        }
    }
}
