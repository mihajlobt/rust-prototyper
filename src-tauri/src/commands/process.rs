use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use crate::{AppState, AppError, resolve_cwd};

pub(crate) const ALLOWED_SHELL_COMMANDS: &[&str] = &[
    "bun", "bunx", "node", "npx", "git", "ls", "cat", "echo", "mkdir", "rm", "cp", "mv",
    "pwd", "find", "grep", "vite", "npm", "pnpm", "yarn", "tsc", "eslint", "prettier", "touch",
];

pub(crate) fn spawn_bun_command(
    app: &AppHandle,
    cmd: &str,
    args: Vec<String>,
    cwd: String,
) -> Result<u32, AppError> {
    let shell = app.shell();
    let mut command = shell.command(cmd);
    for arg in &args {
        command = command.arg(arg);
    }
    let (mut rx, child) = command.current_dir(cwd).spawn().map_err(|e| AppError::Process(e.to_string()))?;

    let pid = child.pid();
    let state = app.state::<AppState>();
    state.active_processes.lock().unwrap().insert(pid, child);

    let app_emit = app.clone();
    tokio::spawn(async move {
        while let Some(event) = rx.recv().await {
            let (line, source) = match event {
                CommandEvent::Stdout(buf) => (String::from_utf8_lossy(&buf).to_string(), "stdout"),
                CommandEvent::Stderr(buf) => (String::from_utf8_lossy(&buf).to_string(), "stderr"),
                _ => continue,
            };
            let _ = app_emit.emit("terminal-output", serde_json::json!({ "pid": pid, "line": line, "source": source }));
        }
        if let Some(state) = app_emit.try_state::<AppState>() {
            if let Ok(mut processes) = state.active_processes.lock() {
                processes.remove(&pid);
            }
        }
    });

    Ok(pid)
}

pub(crate) async fn spawn_bun_command_sync(
    app: &AppHandle,
    cmd: &str,
    args: Vec<String>,
    cwd: String,
) -> Result<(), AppError> {
    let (mut rx, child) = app
        .shell()
        .command(cmd)
        .args(&args)
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| AppError::Process(e.to_string()))?;

    let pid = child.pid();
    app.state::<AppState>().active_processes.lock().unwrap().insert(pid, child);

    // Accumulate child output so non-zero exits produce a self-diagnosing error
    // instead of the opaque "Process exited with code N". Keep last ~2KB.
    let mut output = String::new();
    const MAX_OUTPUT: usize = 2_000;

    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(buf) => {
                let line = String::from_utf8_lossy(&buf).to_string();
                let _ = app.emit("terminal-output", serde_json::json!({ "pid": pid, "line": line, "source": "stdout" }));
                append_capped(&mut output, &line, MAX_OUTPUT);
            }
            CommandEvent::Stderr(buf) => {
                let line = String::from_utf8_lossy(&buf).to_string();
                let _ = app.emit("terminal-output", serde_json::json!({ "pid": pid, "line": line, "source": "stderr" }));
                append_capped(&mut output, &line, MAX_OUTPUT);
            }
            CommandEvent::Terminated(payload) => {
                app.state::<AppState>().active_processes.lock().unwrap().remove(&pid);
                return match payload.code {
                    Some(0) | None => Ok(()),
                    Some(code) => {
                        let display_cmd = format!("{cmd} {}", args.join(" "));
                        let msg = if output.is_empty() {
                            format!("`{display_cmd}` exited with code {code} (no output captured)")
                        } else {
                            format!("`{display_cmd}` exited with code {code}. Output:\n{output}")
                        };
                        Err(AppError::Process(msg))
                    }
                };
            }
            CommandEvent::Error(e) => {
                app.state::<AppState>().active_processes.lock().unwrap().remove(&pid);
                let msg = if output.is_empty() {
                    format!("`{cmd}` process error: {e}")
                } else {
                    format!("`{cmd}` process error: {e}. Output:\n{output}")
                };
                return Err(AppError::Process(msg));
            }
            _ => {}
        }
    }

    app.state::<AppState>().active_processes.lock().unwrap().remove(&pid);
    Ok(())
}

/// Append a line to a capped buffer, keeping the most recent `cap` bytes.
fn append_capped(buf: &mut String, line: &str, cap: usize) {
    if buf.len() + line.len() + 1 > cap {
        let overflow = (buf.len() + line.len() + 1).saturating_sub(cap);
        let drop_at = buf.len().saturating_sub(overflow.min(buf.len()));
        // Drop a UTF-8 char boundary to avoid splitting mid-codepoint
        let mut idx = drop_at;
        while idx > 0 && !buf.is_char_boundary(idx) {
            idx -= 1;
        }
        buf.drain(..idx);
    }
    buf.push_str(line);
    if !buf.ends_with('\n') {
        buf.push('\n');
    }
}

pub(crate) async fn capture_command_output(
    app: &AppHandle,
    cmd: &str,
    args: Vec<String>,
    cwd: String,
) -> Result<String, AppError> {
    let shell = app.shell();
    let mut command = shell.command(cmd);
    for arg in &args {
        command = command.arg(arg);
    }
    let (mut rx, child) = command
        .current_dir(&cwd)
        .spawn()
        .map_err(|e| AppError::Process(e.to_string()))?;

    let pid = child.pid();
    app.state::<AppState>().active_processes.lock().unwrap().insert(pid, child);

    let mut output = String::new();
    while let Some(event) = rx.recv().await {
        match event {
            CommandEvent::Stdout(buf) => { output.push_str(&String::from_utf8_lossy(&buf)); }
            CommandEvent::Stderr(buf) => { output.push_str(&String::from_utf8_lossy(&buf)); }
            CommandEvent::Terminated(_) => {
                app.state::<AppState>().active_processes.lock().unwrap().remove(&pid);
                break;
            }
            _ => {}
        }
    }
    app.state::<AppState>().active_processes.lock().unwrap().remove(&pid);

    // Truncate to 100KB to avoid flooding the frontend
    const MAX_OUTPUT: usize = 100_000;
    if output.len() > MAX_OUTPUT {
        output.truncate(MAX_OUTPUT);
        output.push_str("\n... (output truncated)");
    }
    Ok(output)
}

#[tauri::command]
pub async fn bun_dev(cwd: String, port: u16, app: AppHandle) -> Result<u32, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    spawn_bun_command(&app, "bun", vec!["dev".into(), "--port".into(), port.to_string()], cwd.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn bun_build(cwd: String, app: AppHandle) -> Result<u32, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    // The scaffolded Vite project uses "vite build", not "bun build"
    spawn_bun_command(&app, "bun", vec!["run".into(), "build".into()], cwd.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn bun_install(cwd: String, app: AppHandle) -> Result<u32, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    spawn_bun_command(&app, "bun", vec!["install".into()], cwd.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn bun_install_sync(cwd: String, app: AppHandle) -> Result<(), AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    spawn_bun_command_sync(&app, "bun", vec!["install".into()], cwd.to_string_lossy().to_string()).await
}

#[tauri::command]
pub async fn run_shell_command(cwd: String, command: String, app: AppHandle) -> Result<u32, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    let parts = shlex::split(&command).ok_or_else(|| AppError::Process("Invalid shell syntax".into()))?;
    if parts.is_empty() {
        return Err(AppError::Process("Empty command".into()));
    }
    if !ALLOWED_SHELL_COMMANDS.contains(&parts[0].as_str()) {
        return Err(AppError::Security(format!("Command '{}' not allowed", parts[0])));
    }
    let args = parts.iter().skip(1).map(|s| s.to_string()).collect();
    spawn_bun_command(&app, &parts[0], args, cwd.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn run_shell_command_sync(cwd: String, command: String, app: AppHandle) -> Result<(), AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    let parts = shlex::split(&command).ok_or_else(|| AppError::Process("Invalid shell syntax".into()))?;
    if parts.is_empty() {
        return Err(AppError::Process("Empty command".into()));
    }
    if !ALLOWED_SHELL_COMMANDS.contains(&parts[0].as_str()) {
        return Err(AppError::Security(format!("Command '{}' not allowed", parts[0])));
    }
    let args = parts.iter().skip(1).map(|s| s.to_string()).collect();
    spawn_bun_command_sync(&app, &parts[0], args, cwd.to_string_lossy().to_string()).await
}

#[tauri::command]
pub async fn run_shell_command_capture(cwd: String, command: String, app: AppHandle) -> Result<String, AppError> {
    let cwd = resolve_cwd(&app, &cwd)?;
    let parts = shlex::split(&command).ok_or_else(|| AppError::Process("Invalid shell syntax".into()))?;
    if parts.is_empty() {
        return Err(AppError::Process("Empty command".into()));
    }
    if !ALLOWED_SHELL_COMMANDS.contains(&parts[0].as_str()) {
        return Err(AppError::Security(format!("Command '{}' not allowed", parts[0])));
    }
    let args = parts.iter().skip(1).map(|s| s.to_string()).collect();
    capture_command_output(&app, &parts[0], args, cwd.to_string_lossy().to_string()).await
}

#[tauri::command]
pub async fn kill_process(pid: u32, state: State<'_, AppState>) -> Result<(), AppError> {
    let mut processes = state.active_processes.lock().unwrap();
    if let Some(child) = processes.remove(&pid) {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
pub async fn kill_all_processes(state: State<'_, AppState>) -> Result<(), AppError> {
    let mut processes = state.active_processes.lock().unwrap();
    for (_, child) in processes.drain() {
        let _ = child.kill();
    }
    Ok(())
}

#[tauri::command]
pub async fn kill_port(ports: Vec<u16>) -> Result<(), AppError> {
    tokio::task::spawn_blocking(move || {
        for port in ports {
            kill_port_impl(port);
        }
    }).await.map_err(|e| AppError::Process(format!("spawn_blocking error: {e}")))?;
    Ok(())
}

#[cfg(unix)]
fn kill_port_impl(port: u16) {
    let output = std::process::Command::new("lsof")
        .args(["-t", &format!("-i:{}", port), "-s", "TCP:LISTEN"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .output();

    if let Ok(out) = output {
        let pids = String::from_utf8_lossy(&out.stdout);
        for pid in pids.lines() {
            let pid = pid.trim();
            if pid.is_empty() { continue; }
            let _ = std::process::Command::new("kill")
                .args(["-9", pid])
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .output();
        }
    }
}

#[cfg(windows)]
fn kill_port_impl(port: u16) {
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
