use std::collections::HashSet;

use ollama_rs::generation::tools::ToolInfo;

use super::{ToolError, ToolExecutionResult};
use crate::agent::tools::ToolSearchArgs;

/// Splits a free-text query into lowercase alphanumeric tokens, treating snake_case
/// boundaries as word boundaries so "user form" matches `ask_user_form`.
fn tokenize(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string())
        .collect()
}

/// Token-overlap score: name matches count for more than description matches, since a
/// query naming the capability directly ("fetch a url") should outrank one that merely
/// shares a common word with several descriptions.
fn score(tool: &ToolInfo, query_tokens: &[String]) -> u32 {
    let name_tokens = tokenize(&tool.function.name);
    let description_tokens = tokenize(&tool.function.description);
    let mut total = 0;
    for token in query_tokens {
        if name_tokens.iter().any(|t| t == token) {
            total += 3;
        } else if name_tokens.iter().any(|t| t.contains(token.as_str())) {
            total += 2;
        }
        if description_tokens.iter().any(|t| t == token) {
            total += 1;
        }
    }
    total
}

/// Resolves a `tool_search` call against the panel's available tool set.
///
/// Returns the textual tool result plus the names this `select:` query resolved out of
/// the deferred set. The caller (agent_loop) folds these into its `loaded_deferred` set,
/// which it owns because that state persists across loop iterations.
pub(in crate::agent) fn resolve_tool_search(
    args: &serde_json::Value,
    available_tools: &[ToolInfo],
    deferred_names: &HashSet<String>,
) -> (ToolExecutionResult, Vec<String>) {
    let parsed = match serde_json::from_value::<ToolSearchArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => {
            return (
                ToolExecutionResult {
                    success: false,
                    output: format!("tool_search: {}", ToolError::InvalidArguments(e.to_string())),
                    written_path: None,
                    written_content: None,
                },
                Vec::new(),
            );
        }
    };

    let query = parsed.query.trim();

    if let Some(names_part) = query.strip_prefix("select:") {
        let requested: Vec<&str> = names_part.split(',').map(|s| s.trim()).filter(|s| !s.is_empty()).collect();
        if requested.is_empty() {
            return (
                ToolExecutionResult {
                    success: false,
                    output: "tool_search: 'select:' requires at least one tool name, e.g. 'select:web_fetch,skill'".to_string(),
                    written_path: None,
                    written_content: None,
                },
                Vec::new(),
            );
        }

        let mut loaded = Vec::new();
        let mut already_available = Vec::new();
        let mut not_found = Vec::new();
        let mut newly_loaded_deferred = Vec::new();

        for name in requested {
            match available_tools.iter().find(|t| t.function.name == name) {
                Some(_) if deferred_names.contains(name) => {
                    loaded.push(name.to_string());
                    newly_loaded_deferred.push(name.to_string());
                }
                Some(_) => already_available.push(name.to_string()),
                None => not_found.push(name.to_string()),
            }
        }

        let mut out = String::new();
        if !loaded.is_empty() {
            out.push_str(&format!("Loaded: {} — call {} directly now.\n", loaded.join(", "), if loaded.len() == 1 { "it" } else { "them" }));
        }
        if !already_available.is_empty() {
            out.push_str(&format!("Already available (no action needed): {}\n", already_available.join(", ")));
        }
        if !not_found.is_empty() {
            out.push_str(&format!("Not found in this panel's tool set: {}\n", not_found.join(", ")));
        }
        if out.is_empty() {
            out = "No tools matched the requested names.".to_string();
        }

        return (
            ToolExecutionResult { success: true, output: out, written_path: None, written_content: None },
            newly_loaded_deferred,
        );
    }

    let max_results = parsed.max_results.unwrap_or(5).clamp(1, 20) as usize;
    let query_tokens = tokenize(query);
    if query_tokens.is_empty() {
        return (
            ToolExecutionResult {
                success: false,
                output: "tool_search: query must not be empty".to_string(),
                written_path: None,
                written_content: None,
            },
            Vec::new(),
        );
    }

    let mut scored: Vec<(&ToolInfo, u32)> = available_tools
        .iter()
        .filter(|t| t.function.name != "tool_search")
        .map(|t| (t, score(t, &query_tokens)))
        .filter(|(_, s)| *s > 0)
        .collect();
    scored.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.function.name.cmp(&b.0.function.name)));

    if scored.is_empty() {
        return (
            ToolExecutionResult {
                success: true,
                output: format!("No tools matched '{query}'. Try different keywords or use 'select:<name>' if you know the exact name."),
                written_path: None,
                written_content: None,
            },
            Vec::new(),
        );
    }

    let mut out = format!("Tools matching '{query}':\n");
    for (tool, _) in scored.into_iter().take(max_results) {
        let suffix = if deferred_names.contains(&tool.function.name) {
            " (deferred — use 'select:<name>' to load its schema before calling it)"
        } else {
            ""
        };
        out.push_str(&format!("- {}: {}{suffix}\n", tool.function.name, tool.function.description));
    }

    (
        ToolExecutionResult { success: true, output: out, written_path: None, written_content: None },
        Vec::new(),
    )
}
