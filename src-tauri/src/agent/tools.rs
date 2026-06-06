use ollama_rs::generation::tools::{ToolInfo, ToolType, ToolFunctionInfo};
use schemars::{JsonSchema, generate::SchemaSettings};

#[derive(serde::Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    /// Complete raw source code to write. No wrappers, no JSON envelope, no markdown fences — raw code only. Only use write_file for new files. For existing files always use edit_file.
    pub content: String,
    /// Optional path for the file. Project-root-relative (e.g. "generated/src/services/weather.ts", "generated/src/components/WeatherCard/component.tsx", "generated/src/pages/home.tsx") or app-data-root-relative (e.g. "projects/abc/generated/src/services/weather.ts"). Must be within the current project. Omit to write the primary output file.
    pub path: Option<String>,
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
    /// Glob pattern relative to the project root (e.g. "components/**/*.tsx", "screens/*/screen.tsx", "data/*.ts"). No ".." allowed. Returns all matching file paths.
    pub pattern: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct GrepArgs {
    /// Text or regex pattern to search for (e.g. "useNavigate", "import.*Button", "export default").
    pub pattern: String,
    /// Relative path or directory to search within (e.g. "components/", "screens/my-screen/screen.tsx"). Defaults to entire project. No ".." allowed.
    pub path: Option<String>,
}

/// question_type field for AskUserArgs — typed enum so schemars generates an enum constraint.
#[allow(dead_code)]
#[derive(serde::Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AskUserQuestionTypeArg {
    Text,
    Choice,
    Confirm,
}

#[allow(dead_code)]
#[derive(serde::Deserialize, JsonSchema)]
pub struct AskUserArgs {
    pub question: String,
    pub question_type: AskUserQuestionTypeArg,
    /// Required when question_type is "choice". Each entry must be a plain string.
    pub choices: Option<Vec<String>>,
}

#[allow(dead_code)]
#[derive(serde::Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum FormFieldTypeArg {
    Text,
    Choice,
    Multiselect,
    Confirm,
}

#[allow(dead_code)]
#[derive(serde::Deserialize, JsonSchema)]
pub struct FormFieldArg {
    /// Key used in the response JSON object.
    pub id: String,
    pub label: String,
    pub field_type: FormFieldTypeArg,
    /// Required for "choice" and "multiselect" field types.
    pub choices: Option<Vec<String>>,
    pub placeholder: Option<String>,
    /// Defaults to true.
    pub required: Option<bool>,
}

#[allow(dead_code)]
#[derive(serde::Deserialize, JsonSchema)]
pub struct AskUserFormArgs {
    pub title: String,
    pub fields: Vec<FormFieldArg>,
}

#[allow(dead_code)]
#[derive(serde::Deserialize, JsonSchema)]
pub struct RegisterScreenArgs {
    /// Kebab-case screen ID matching the page filename without extension (e.g. "dashboard" for pages/dashboard.tsx).
    pub screen_id: String,
    /// Human-readable screen title (e.g. "Dashboard").
    pub title: String,
    /// URL path for this screen (e.g. "/dashboard").
    pub path: String,
    /// If true, this screen is the app entry point (default route). Defaults to false.
    pub is_default: Option<bool>,
}

#[allow(dead_code)]
#[derive(serde::Deserialize, JsonSchema)]
pub struct SetActiveThemeArgs {
    /// The theme directory name under the project's themes/ folder (e.g. "wizard" for themes/wizard/).
    pub theme_slug: String,
}

#[allow(dead_code)]
#[derive(serde::Deserialize, JsonSchema)]
pub struct ValidateDesignJsonArgs {
    /// Path to the design.json file relative to the app data root (e.g. "projects/abc/themes/wizard/design.json").
    pub path: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct WebSearchArgs {
    /// Search query string.
    pub query: String,
    /// Number of results to return (1–10, default 5).
    pub num_results: Option<u32>,
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
                description: "Write a new file from scratch. Use ONLY when creating a file that does not yet exist — never to overwrite an existing file. For edits to existing files, always use edit_file instead. Omit 'path' to write the primary output file. Provide 'path' to write additional files within this project (e.g. services, sub-components, utilities).".to_string(),
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
                description: "Find files matching a glob pattern in the project. Call before writing new code to discover existing components, screens, data files, or utilities. Returns all matching relative file paths.".to_string(),
                parameters: make_schema::<GlobArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "grep".to_string(),
                description: "Search for a text or regex pattern across project files (.tsx, .ts, .css, .json). Use to find where a component is imported, how a type is defined, or whether something already exists before creating it. Returns file paths and matching lines.".to_string(),
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
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "ask_user".to_string(),
                description: r#"Pause and ask the user a single question, then wait for their answer before continuing. For collecting several pieces of information at once, prefer ask_user_form.

question_type values:
- "choice"  — single-select from a list; provide a choices array, e.g. choices: ["SaaS dashboard", "Marketing site", "Mobile app"]
- "confirm" — Yes / No; only use at major phase gates (e.g. "Here is the design system I'll use — ready to generate the screens?"). Do NOT use for procedural step confirmations like "I created this screen, continue?" or "I'm about to write the router, OK?" — just proceed.
- "text"    — open-ended free text, e.g. "Describe the main user workflow"

Schema: { question: string, question_type: "text"|"choice"|"confirm", choices?: string[] }"#.to_string(),
                parameters: make_schema::<AskUserArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "ask_user_form".to_string(),
                description: r#"Present a structured form with multiple fields and wait for the user to fill it in all at once. Returns a JSON object mapping each field id to the user's answer (string for text/choice/confirm, string[] for multiselect).

field_type values:
- "text"        — free-text input
- "choice"      — single-select buttons; provide choices array
- "multiselect" — multi-select checkboxes; provide choices array
- "confirm"     — Yes / No toggle

Example:
  ask_user_form(title: "Tell me about your app", fields: [
    { id: "name",     label: "App name",           field_type: "text",        placeholder: "e.g. TaskFlow" },
    { id: "type",     label: "What kind of app?",  field_type: "choice",      choices: ["SaaS dashboard", "Mobile app", "Landing page", "Internal tool"] },
    { id: "features", label: "Key features",        field_type: "multiselect", choices: ["Auth", "Dashboard", "Notifications", "Search", "Settings"] }
  ])
Returns: { "name": "TaskFlow", "type": "SaaS dashboard", "features": ["Dashboard", "Notifications"] }"#.to_string(),
                parameters: make_schema::<AskUserFormArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "register_screen".to_string(),
                description: "Register a screen in the project's navigation.json after writing its page file. Call immediately after each write_file that creates a new page. Required for the screen to appear in the Flows panel and router.".to_string(),
                parameters: make_schema::<RegisterScreenArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "set_active_theme".to_string(),
                description: "Set the project's active design theme to a generated theme directory. Call after writing design.json and theme.css to make the generated design tokens available for subsequent screen generation.".to_string(),
                parameters: make_schema::<SetActiveThemeArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "validate_design_json".to_string(),
                description: "Validate a design.json file against the DesignLanguageSpec schema. Returns a list of validation errors — empty output means valid. Call after writing design.json and fix all errors before proceeding.".to_string(),
                parameters: make_schema::<ValidateDesignJsonArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "web_search".to_string(),
                description: "Search the web via a local SearXNG instance and return titles, URLs, and snippets. Use to look up documentation, library releases, or any live information. Returns an error if SearXNG is not configured in Settings → AI.".to_string(),
                parameters: make_schema::<WebSearchArgs>(),
            },
        },
    ]
}
