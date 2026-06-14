use std::path::Path;

use lsp_types::{
    DocumentSymbol, DocumentSymbolResponse, GotoDefinitionResponse, Hover, HoverContents,
    Location, MarkedString, SymbolInformation, SymbolKind,
};
use serde_json::Value;

use super::client::uri_to_path;
use super::super::{cap_tool_output, DEFAULT_TOOL_OUTPUT_MAX_BYTES, DEFAULT_TOOL_OUTPUT_MAX_LINES};

fn display_path(uri: &str, project_dir: &Path) -> String {
    match uri_to_path(uri) {
        Some(path) => match path.strip_prefix(project_dir) {
            Ok(rel) => rel.display().to_string(),
            Err(_) => path.display().to_string(),
        },
        None => uri.to_string(),
    }
}

fn symbol_kind_name(kind: SymbolKind) -> &'static str {
    match kind {
        SymbolKind::FILE => "File",
        SymbolKind::MODULE => "Module",
        SymbolKind::NAMESPACE => "Namespace",
        SymbolKind::PACKAGE => "Package",
        SymbolKind::CLASS => "Class",
        SymbolKind::METHOD => "Method",
        SymbolKind::PROPERTY => "Property",
        SymbolKind::FIELD => "Field",
        SymbolKind::CONSTRUCTOR => "Constructor",
        SymbolKind::ENUM => "Enum",
        SymbolKind::INTERFACE => "Interface",
        SymbolKind::FUNCTION => "Function",
        SymbolKind::VARIABLE => "Variable",
        SymbolKind::CONSTANT => "Constant",
        SymbolKind::STRUCT => "Struct",
        SymbolKind::ENUM_MEMBER => "EnumMember",
        SymbolKind::TYPE_PARAMETER => "TypeParameter",
        _ => "Symbol",
    }
}

/// Renders a `textDocument/definition` or `textDocument/references` result as entries
/// grouped by file, translating 0-based LSP positions back to the 1-based coordinates
/// the model passes in.
pub(crate) fn format_locations(value: &Value, project_dir: &Path) -> String {
    let locations = match parse_locations(value) {
        Some(locations) if !locations.is_empty() => locations,
        _ => return "No results.".to_string(),
    };

    let mut by_file: Vec<(String, Vec<String>)> = Vec::new();
    for loc in &locations {
        let file = display_path(loc.uri.as_str(), project_dir);
        let entry = format!("  Line {}:{}", loc.range.start.line + 1, loc.range.start.character + 1);
        match by_file.iter_mut().find(|(f, _)| f == &file) {
            Some((_, lines)) => lines.push(entry),
            None => by_file.push((file, vec![entry])),
        }
    }

    let total = locations.len();
    let mut out = format!(
        "Found {total} location{} across {} file{}:\n",
        if total == 1 { "" } else { "s" },
        by_file.len(),
        if by_file.len() == 1 { "" } else { "s" },
    );
    for (file, lines) in &by_file {
        out.push_str(&format!("{file}:\n{}\n", lines.join("\n")));
    }
    cap_tool_output(&out, DEFAULT_TOOL_OUTPUT_MAX_BYTES, DEFAULT_TOOL_OUTPUT_MAX_LINES)
}

fn parse_locations(value: &Value) -> Option<Vec<Location>> {
    if value.is_null() {
        return Some(Vec::new());
    }
    if let Ok(response) = serde_json::from_value::<GotoDefinitionResponse>(value.clone()) {
        return Some(match response {
            GotoDefinitionResponse::Scalar(loc) => vec![loc],
            GotoDefinitionResponse::Array(locs) => locs,
            GotoDefinitionResponse::Link(links) => links
                .into_iter()
                .map(|link| Location { uri: link.target_uri, range: link.target_selection_range })
                .collect(),
        });
    }
    serde_json::from_value::<Vec<Location>>(value.clone()).ok()
}

/// Renders a `textDocument/hover` result as plain prose — `MarkedString`/`MarkupContent`
/// both ultimately carry a markdown-or-plaintext string the model can read directly.
pub(crate) fn format_hover(value: &Value) -> String {
    if value.is_null() {
        return "No hover information available.".to_string();
    }
    let Ok(hover) = serde_json::from_value::<Hover>(value.clone()) else {
        return "No hover information available.".to_string();
    };
    let text = match hover.contents {
        HoverContents::Scalar(marked) => marked_string_text(marked),
        HoverContents::Array(items) => items.into_iter().map(marked_string_text).collect::<Vec<_>>().join("\n---\n"),
        HoverContents::Markup(content) => content.value,
    };
    let output = if text.trim().is_empty() {
        "No hover information available.".to_string()
    } else {
        text
    };
    cap_tool_output(&output, DEFAULT_TOOL_OUTPUT_MAX_BYTES, DEFAULT_TOOL_OUTPUT_MAX_LINES)
}

fn marked_string_text(marked: MarkedString) -> String {
    match marked {
        MarkedString::String(s) => s,
        MarkedString::LanguageString(ls) => ls.value,
    }
}

/// Renders a `textDocument/documentSymbol` result as an indented outline. The LSP spec
/// defines two valid response shapes for this request — the newer hierarchical
/// `DocumentSymbol[]` and the legacy flat `SymbolInformation[]` — and `DocumentSymbolResponse`
/// is the untagged enum over both; this function handles each variant.
pub(crate) fn format_document_symbols(value: &Value) -> String {
    if value.is_null() {
        return "No symbols found.".to_string();
    }
    let Ok(response) = serde_json::from_value::<DocumentSymbolResponse>(value.clone()) else {
        return "No symbols found.".to_string();
    };

    let mut out = String::new();
    match response {
        DocumentSymbolResponse::Nested(symbols) if !symbols.is_empty() => {
            for symbol in &symbols {
                push_nested_symbol(&mut out, symbol, 0);
            }
        }
        DocumentSymbolResponse::Flat(infos) if !infos.is_empty() => {
            for info in &infos {
                push_flat_symbol(&mut out, info);
            }
        }
        _ => return "No symbols found.".to_string(),
    }
    cap_tool_output(&out, DEFAULT_TOOL_OUTPUT_MAX_BYTES, DEFAULT_TOOL_OUTPUT_MAX_LINES)
}

fn push_nested_symbol(out: &mut String, symbol: &DocumentSymbol, depth: usize) {
    out.push_str(&"  ".repeat(depth));
    out.push_str(&format!("{} {} — line {}\n", symbol_kind_name(symbol.kind), symbol.name, symbol.range.start.line + 1));
    if let Some(children) = &symbol.children {
        for child in children {
            push_nested_symbol(out, child, depth + 1);
        }
    }
}

fn push_flat_symbol(out: &mut String, info: &SymbolInformation) {
    out.push_str(&format!(
        "{} {} — line {}\n",
        symbol_kind_name(info.kind), info.name, info.location.range.start.line + 1
    ));
}
