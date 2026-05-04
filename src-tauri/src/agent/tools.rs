use ollama_rs::generation::tools::{ToolInfo, ToolType, ToolFunctionInfo};
use schemars::{JsonSchema, generate::SchemaSettings};

#[derive(serde::Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    /// The complete raw source code to write. Must be raw code — NOT a JSON object, NOT wrapped in an envelope. Just the raw code. Only use this when creating a new file. For editing existing files, use edit_file instead.
    pub content: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct ReadFileArgs {
    /// Relative file path within the project to read (e.g. "projects/abc/screens/xyz/screen.tsx")
    pub path: String,
    /// Line number to start reading from (1-indexed). Default: 1 (first line).
    pub offset: Option<u32>,
    /// Maximum number of lines to read. Default: 2000.
    pub limit: Option<u32>,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct EditFileArgs {
    /// Relative file path to edit (e.g. "projects/abc/components/my-comp/component.tsx")
    pub path: String,
    /// Exact string to find and replace. Must match exactly including all whitespace and newlines. Must appear exactly once in the file. Use read_file first to get the current content.
    pub old_string: String,
    /// The string to replace old_string with.
    pub new_string: String,
    /// If true, replace all occurrences of old_string. Default: false (replace first occurrence only).
    pub replace_all: Option<bool>,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct BashArgs {
    /// Shell command to run in the project directory (30-second timeout). Use for general commands only — for TypeScript checking use run_tsc, for linting use run_lint.
    pub command: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct TscCheckArgs {}

#[derive(serde::Deserialize, JsonSchema)]
pub struct LintCheckArgs {
    /// Relative file path to lint (e.g. "components/my-folder/component.tsx")
    pub path: String,
}

fn make_schema<T: JsonSchema>() -> schemars::Schema {
    let mut settings = SchemaSettings::draft07();
    settings.inline_subschemas = true;
    settings.into_generator().into_root_schema_for::<T>()
}

pub fn build_tools() -> Vec<ToolInfo> {
    vec![
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "write_file".to_string(),
                description: "Write raw source code to the output file. Use ONLY when creating a new file from scratch. For editing existing files, always use edit_file instead — it is faster and safer. Pass only the content parameter — the destination path is fixed by the system.".to_string(),
                parameters: make_schema::<WriteFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "read_file".to_string(),
                description: "Read the contents of a file in the project. Use offset and limit to read a specific range of lines. Always call this before edit_file or write_file on existing files.".to_string(),
                parameters: make_schema::<ReadFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "edit_file".to_string(),
                description: "Edit an existing file by replacing text. Multiple matching strategies are tried automatically (exact, trimmed whitespace, indentation-normalized). Use replaceAll to replace all occurrences. Verify edit with read_file after.".to_string(),
                parameters: make_schema::<EditFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "run_tsc".to_string(),
                description: "Run TypeScript type-checking on the generated component/screen files. Always call this after writing or editing TypeScript files. Optionally filter output to a specific file path.".to_string(),
                parameters: make_schema::<TscCheckArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "run_lint".to_string(),
                description: "Run ESLint on a specific generated file. Call after run_tsc passes. Provide the relative path to the file (e.g. 'components/my-folder/component.tsx').".to_string(),
                parameters: make_schema::<LintCheckArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "run_build".to_string(),
                description: "Run esbuild on a specific file to catch JSX/Babel syntax errors that tsc misses (e.g. malformed JSX tags). Call after run_tsc passes. Provide the relative file path (e.g. 'components/my-folder/component.tsx').".to_string(),
                parameters: make_schema::<LintCheckArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "bash".to_string(),
                description: "Run a general shell command in the project root (30s timeout). Use ls/find/cat to inspect files. For TypeScript checking use run_tsc. For linting use run_lint.".to_string(),
                parameters: make_schema::<BashArgs>(),
            },
        },
    ]
}
