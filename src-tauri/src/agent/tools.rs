use ollama_rs::generation::tools::{ToolInfo, ToolType, ToolFunctionInfo};
use schemars::{JsonSchema, generate::SchemaSettings};

#[derive(serde::Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    /// Complete raw source code to write. No wrappers, no JSON envelope, no markdown fences — raw code only. Only use write_file for new files. For existing files always use edit_file.
    pub content: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct ReadFileArgs {
    /// Relative path from the app data root (e.g. "projects/abc/screens/xyz/screen.tsx"). No ".." allowed.
    pub path: String,
    /// Line number to start reading from (1-indexed). Default: 1.
    pub offset: Option<u32>,
    /// Maximum number of lines to read. Default: 2000.
    pub limit: Option<u32>,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct EditFileArgs {
    /// Relative path to the file to edit (e.g. "projects/abc/components/my-comp/component.tsx"). No ".." allowed.
    pub path: String,
    /// The exact text to replace — must match character-for-character including whitespace and newlines. Must appear exactly once in the file. Call read_file first to get current content. The tool retries with whitespace-normalized matching if exact match fails, but provide the exact text.
    pub old_string: String,
    /// The text to replace old_string with.
    pub new_string: String,
    /// If true, replace all occurrences of old_string. Default: false.
    pub replace_all: Option<bool>,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct BashArgs {
    /// Shell command to run inside the sandboxed project dir (30s timeout). Sandbox allows: ls (any flags e.g. ls -la), find, cat, head, grep, sed, echo, bun, bunx, node. Disallowed: network access (curl, wget), privilege escalation, python/perl/ruby -e. Prefer specialized tools — run_tsc for type checking, run_lint for linting, read_file for reading files.
    pub command: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct TscCheckArgs {
    /// Relative path of the file to type-check, e.g. "screens/wedding-planner/screen.tsx" or "components/my-button/component.tsx". Only errors from this file are shown — errors in other project files are suppressed. Omit only when you want a full project-wide check.
    pub path: Option<String>,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct LintCheckArgs {
    /// Relative file path to check (e.g. "screens/my-screen/screen.tsx" or "components/my-comp/component.tsx"). No ".." allowed.
    pub path: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct GlobArgs {
    /// Glob pattern relative to the project root (e.g. "components/**/*.tsx", "screens/*/screen.tsx", "data/*.ts"). No ".." allowed. Returns up to 100 matching file paths.
    pub pattern: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct GrepArgs {
    /// Text or regex pattern to search for (e.g. "useNavigate", "import.*Button", "export default").
    pub pattern: String,
    /// Relative path or directory to search within (e.g. "components/", "screens/my-screen/screen.tsx"). Defaults to entire project. No ".." allowed.
    pub path: Option<String>,
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
                description: "Write a new file from scratch. Use ONLY when creating a file that does not yet exist — never to overwrite an existing file. For edits to existing files, always use edit_file instead.".to_string(),
                parameters: make_schema::<WriteFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "read_file".to_string(),
                description: "Read the contents of a file. Always call before edit_file to get the current content. Use offset and limit to read a specific range of lines for large files (default: first 2000 lines).".to_string(),
                parameters: make_schema::<ReadFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "edit_file".to_string(),
                description: "Replace a specific text block in an existing file. Finds old_string and replaces it with new_string. Retries with whitespace-normalized matching if exact match fails. Always call read_file first to get the current content.".to_string(),
                parameters: make_schema::<EditFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "run_tsc".to_string(),
                description: "Type-check TypeScript files. Pass path to scope output to a single file — without it, errors from all project files are shown. Always call after write_file or edit_file on .tsx/.ts files. Fix all reported errors before finishing.".to_string(),
                parameters: make_schema::<TscCheckArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "run_lint".to_string(),
                description: "Run ESLint on a specific file. Call after run_tsc passes. Provide the file-relative path (e.g. 'screens/my-screen/screen.tsx').".to_string(),
                parameters: make_schema::<LintCheckArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "run_build".to_string(),
                description: "Run esbuild on a specific file to catch JSX/Babel syntax errors that tsc misses (e.g. malformed JSX tags, missing imports). Call after run_lint passes.".to_string(),
                parameters: make_schema::<LintCheckArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "glob".to_string(),
                description: "Find files matching a glob pattern in the project. Call before writing new code to discover existing components, screens, data files, or utilities. Returns up to 100 matching relative file paths.".to_string(),
                parameters: make_schema::<GlobArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "grep".to_string(),
                description: "Search for a text or regex pattern across project files (.tsx, .ts, .css, .json). Use to find where a component is imported, how a type is defined, or whether something already exists before creating it. Returns file paths and matching lines (up to 100 results).".to_string(),
                parameters: make_schema::<GrepArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "bash".to_string(),
                description: "Run a shell command in the sandboxed project root (30s timeout, bwrap+landlock isolated). Use for ls/find/grep/cat to inspect the filesystem. Sandbox blocks network access and privilege escalation. Prefer specialized tools: run_tsc, run_lint, run_build, read_file.".to_string(),
                parameters: make_schema::<BashArgs>(),
            },
        },
    ]
}
