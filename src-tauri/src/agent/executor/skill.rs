use std::path::Path;

use gray_matter::engine::YAML;
use gray_matter::Matter;
use serde::Deserialize;

use super::{ToolError, ToolExecutionResult};
use crate::agent::tools::SkillArgs;

fn error_result(output: String) -> ToolExecutionResult {
    ToolExecutionResult { success: false, output, written_path: None, written_content: None }
}

/// The two required SKILL.md frontmatter fields (per the spec: `name` matches
/// `[a-z0-9]+(-[a-z0-9]+)*`, ≤64 chars; `description` ≤1024 chars). Optional fields
/// the spec defines beyond these (`allowed-tools`, `context: fork`, ...) deserialize
/// into nothing here — `gray_matter`/`serde` ignore unknown YAML keys by default.
#[derive(Deserialize)]
struct SkillFrontmatter {
    name: Option<String>,
    description: Option<String>,
}

/// Parses a SKILL.md's `---`-delimited YAML frontmatter via `gray_matter` (the same
/// frontmatter-extraction approach `frontmatter.ts` uses on the frontend, here for the
/// Rust-side agent loop where `js-yaml` isn't reachable) and validates the two fields
/// this tool requires.
fn parse_frontmatter(content: &str) -> Result<(String, String, String), String> {
    let parsed = Matter::<YAML>::new()
        .parse::<SkillFrontmatter>(content)
        .map_err(|e| format!("failed to parse YAML frontmatter: {e}"))?;

    let frontmatter = parsed.data
        .ok_or_else(|| "SKILL.md must start with a '---' delimited YAML frontmatter block".to_string())?;
    let name = frontmatter.name
        .ok_or_else(|| "SKILL.md frontmatter is missing the required 'name' field".to_string())?;
    let description = frontmatter.description
        .ok_or_else(|| "SKILL.md frontmatter is missing the required 'description' field".to_string())?;

    if name.is_empty() || name.len() > 64 || !name.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') {
        return Err(format!("SKILL.md 'name' must be kebab-case and ≤64 characters, got '{name}'"));
    }
    if description.is_empty() || description.len() > 1024 {
        return Err("SKILL.md 'description' must be non-empty and ≤1024 characters".to_string());
    }

    Ok((name, description, parsed.content))
}

pub(in crate::agent) async fn execute_skill(args: &serde_json::Value, project_dir: &Path) -> ToolExecutionResult {
    let parsed = match serde_json::from_value::<SkillArgs>(args.clone()) {
        Ok(p) => p,
        Err(e) => return error_result(format!("skill: {}", ToolError::InvalidArguments(e.to_string()))),
    };

    if parsed.skill.contains("..") || parsed.skill.contains('/') || parsed.skill.contains('\\') {
        return error_result(format!("skill: invalid skill name '{}' — must be a plain directory name with no path separators", parsed.skill));
    }

    let skill_path = project_dir.join(".prototyper").join("skills").join(&parsed.skill).join("SKILL.md");

    let content = match tokio::fs::read_to_string(&skill_path).await {
        Ok(c) => c,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return error_result(format!(
                "skill: no skill named '{}' found at {}. List {}/.prototyper/skills/ to see available skills.",
                parsed.skill,
                skill_path.display(),
                project_dir.display(),
            ));
        }
        Err(e) => return error_result(format!("skill: {}", ToolError::FileSystem(format!("failed to read {}: {e}", skill_path.display())))),
    };

    let (name, description, body) = match parse_frontmatter(&content) {
        Ok(parsed) => parsed,
        Err(message) => return error_result(format!("skill: {} has invalid frontmatter — {message}", skill_path.display())),
    };

    if name != parsed.skill {
        return error_result(format!(
            "skill: {} declares name '{}', which does not match the requested skill '{}' (and its directory name) — the spec requires these to match.",
            skill_path.display(), name, parsed.skill,
        ));
    }

    let arguments = parsed.args.clone().unwrap_or_default();
    let instructions = body.replace("$ARGUMENTS", &arguments);

    ToolExecutionResult {
        success: true,
        output: format!("Skill '{name}': {description}\n\n{instructions}"),
        written_path: None,
        written_content: None,
    }
}
