use std::collections::HashSet;

use ollama_rs::generation::tools::ToolInfo;

/// Names from `tools::DEFERRED_TOOL_NAMES` that are also present in `available_tools`
/// (the panel's already-filtered tool set).
pub(in crate::agent) fn deferred_names_in(available_tools: &[ToolInfo]) -> HashSet<String> {
    super::tools::DEFERRED_TOOL_NAMES
        .iter()
        .map(|s| s.to_string())
        .filter(|name| available_tools.iter().any(|t| &t.function.name == name))
        .collect()
}

/// System message listing deferred tools by name + one-line description, telling the
/// model to call `tool_search("select:<name>")` before calling one directly. `None` when
/// this panel has no deferred tools.
pub(in crate::agent) fn deferred_tools_system_message(
    available_tools: &[ToolInfo],
    deferred_names: &HashSet<String>,
) -> Option<serde_json::Value> {
    if deferred_names.is_empty() {
        return None;
    }
    let mut block = String::from(
        "<available-deferred-tools>\nThe following tools exist but their schemas are not loaded to save context space. \
         Call tool_search with query \"select:<name>[,<name>...]\" to load one before calling it directly:\n"
    );
    for tool in available_tools.iter().filter(|t| deferred_names.contains(&t.function.name)) {
        block.push_str(&format!("- {}: {}\n", tool.function.name, tool.function.description));
    }
    block.push_str("</available-deferred-tools>");
    Some(serde_json::json!({ "role": "system", "content": block }))
}

/// Tools whose schemas are sent to the model this turn: every non-deferred tool, plus
/// every deferred tool whose name is in `loaded`. Called fresh each iteration because
/// `loaded` is mutated by `tool_search` calls within the loop (see `agent_loop.rs`).
pub(in crate::agent) fn visible_tools(
    available_tools: &[ToolInfo],
    deferred_names: &HashSet<String>,
    loaded: &HashSet<String>,
) -> Vec<ToolInfo> {
    available_tools
        .iter()
        .filter(|t| !deferred_names.contains(&t.function.name) || loaded.contains(&t.function.name))
        .cloned()
        .collect()
}
