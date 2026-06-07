use std::path::Path;

use super::{ToolError, ToolExecutionResult};
use crate::agent::tools::TaskListArgs;
use crate::commands::ai::{CompletionEvent, TodoItem, TodoStatus};

fn error_result(output: String) -> ToolExecutionResult {
    ToolExecutionResult { success: false, output, written_path: None, written_content: None }
}

/// Sidecar path for the project's active todo list, overwritten in full on every
/// `task_list` call. `AgentLoopParams` carries no session/chat identifier to key
/// per-conversation files by, unlike Plans (`{slug}.chat.json`).
fn todo_list_path(project_dir: &Path) -> std::path::PathBuf {
    project_dir.join(".prototyper").join("todos.json")
}

fn format_summary(todos: &[TodoItem]) -> String {
    if todos.is_empty() {
        return "Task list cleared — no tasks remaining.".to_string();
    }
    let mut out = String::from("Task list updated:\n");
    for todo in todos {
        let marker = match todo.status {
            TodoStatus::Pending => "[ ]",
            TodoStatus::InProgress => "[~]",
            TodoStatus::Completed => "[x]",
        };
        out.push_str(&format!("{marker} {}\n", todo.content));
    }
    out
}

pub(in crate::agent) async fn execute_task_list(
    args: &serde_json::Value,
    project_dir: &Path,
    channel: &tauri::ipc::Channel<CompletionEvent>,
) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<TaskListArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return error_result(format!("task_list: {}", ToolError::InvalidArguments(e.to_string()))),
    };

    let in_progress_count = parsed.todos.iter().filter(|t| matches!(t.status, TodoStatus::InProgress)).count();
    if in_progress_count > 1 {
        return error_result(format!(
            "task_list: {in_progress_count} tasks are marked in_progress — exactly one task may be in_progress at a time. Mark the others pending or completed and call task_list again."
        ));
    }

    let path = todo_list_path(project_dir);
    if let Some(parent) = path.parent() {
        if let Err(e) = tokio::fs::create_dir_all(parent).await {
            return error_result(format!("task_list: {}", ToolError::FileSystem(format!("failed to create {}: {e}", parent.display()))));
        }
    }

    // Once every task is completed, reset the sidecar to [] so a stale "all done" list
    // doesn't get picked back up as the active list on the next run. The event sent to
    // the UI still carries the final all-completed state the model reported.
    let all_completed = !parsed.todos.is_empty() && parsed.todos.iter().all(|t| matches!(t.status, TodoStatus::Completed));
    let persisted: &[TodoItem] = if all_completed { &[] } else { &parsed.todos };

    let serialized = match serde_json::to_string_pretty(persisted) {
        Ok(s) => s,
        Err(e) => return error_result(format!("task_list: failed to serialize todo list — {e}")),
    };
    if let Err(e) = tokio::fs::write(&path, serialized).await {
        return error_result(format!("task_list: {}", ToolError::FileSystem(format!("failed to write {}: {e}", path.display()))));
    }

    let _ = channel.send(CompletionEvent::TodoUpdate { todos: parsed.todos.clone() });

    ToolExecutionResult {
        success: true,
        output: format_summary(&parsed.todos),
        written_path: None,
        written_content: None,
    }
}
