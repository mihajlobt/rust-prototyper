use ollama_rs::generation::tools::{ToolInfo, ToolType, ToolFunctionInfo};
use schemars::{JsonSchema, generate::SchemaSettings};

#[derive(serde::Deserialize, JsonSchema)]
pub struct WriteFileArgs {
    /// The complete raw source code to write. Must be raw code — NOT a JSON object, NOT wrapped in an envelope. Just the raw code.
    pub content: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct ReadFileArgs {
    /// Relative file path within the project to read (e.g. "projects/abc/screens/xyz/screen.tsx")
    pub path: String,
}

#[derive(serde::Deserialize, JsonSchema)]
pub struct BashArgs {
    /// Shell command to run in the project directory (30-second timeout)
    pub command: String,
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
                description: "Write raw source code to the output file. Pass only the content parameter — the destination path is fixed by the system. The content must be raw code — NOT a JSON object, NOT wrapped in an envelope. IMPORTANT: If the file already exists, use read_file first to see the current code before making changes.".to_string(),
                parameters: make_schema::<WriteFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "read_file".to_string(),
                description: "Read the contents of a file in the project. Use this to inspect existing code before modifying it.".to_string(),
                parameters: make_schema::<ReadFileArgs>(),
            },
        },
        ToolInfo {
            tool_type: ToolType::Function,
            function: ToolFunctionInfo {
                name: "bash".to_string(),
                description: "Run a shell command in the project root. After write_file, ALWAYS run both: 1) Type-check: cd component-preview && bun node_modules/typescript/lib/tsc.js --noEmit --project ../tsconfig.check.json 2>&1 | grep 'components/YOUR-FILE/component.tsx'. 2) Lint: bunx eslint components/YOUR-FILE/component.tsx. Replace YOUR-FILE with the actual folder name you wrote. NEVER run tsc or eslint on the whole project. Use ls/find/cat to inspect. 30s timeout.".to_string(),
                parameters: make_schema::<BashArgs>(),
            },
        },
    ]
}
