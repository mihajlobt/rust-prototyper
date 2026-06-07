# Glob Tool Implementations Across AI Coding Agents

Research date: 2026-06-06

---

## Claude Code (Anthropic)

**Source:** https://github.com/Yuyz0112/claude-code-reverse/blob/main/results/tools/Glob.tool.yaml

**Tool name:** `Glob`

**Description:**
```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of
  globbing and grepping, use the Agent tool instead
- You have the capability to call multiple tools in a single response. It is
  always better to speculatively perform multiple searches as a batch that are
  potentially useful.
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | yes | `"The glob pattern to match files against"` |
| `path` | string | no | `"The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter 'undefined' or 'null' - simply omit it for the default behavior. Must be a valid directory path if provided."` |

**Behavior:** Results capped at 100 files, sorted by modification time. Does NOT respect `.gitignore` by default (opt-in via `CLAUDE_CODE_GLOB_NO_IGNORE=false`).

---

## OpenCode (sst/opencode)

**Source:**
- https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/glob.ts
- https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/glob.txt

**Tool name:** `glob`

**Description** (loaded from glob.txt):
```
- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths
- Use this tool when you need to find files by name patterns
- When you are doing an open-ended search that may require multiple rounds of
  globbing and grepping, use the Task tool instead
- You have the capability to call multiple tools in a single response. It is
  always better to speculatively perform multiple searches as a batch that are
  potentially useful.
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | yes | `"The glob pattern to match files against"` |
| `path` | string | no | `"The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter 'undefined' or 'null' - simply omit it for the default behavior. Must be a valid directory path if provided."` |

**Behavior:** Results capped at 100 files. If truncated, appends: `"(Results are truncated: showing first 100 results. Consider using a more specific path or pattern.)"`. Path param validated to be a directory (not a file). External directory access goes through permission check.

**Note:** Nearly identical schema to Claude Code. "Task tool" replaces "Agent tool" in the sub-agent reference — the only difference in the description text.

---

## Gemini CLI (google-gemini/gemini-cli)

**Source:**
- https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/definitions/model-family-sets/default-legacy.ts
- https://github.com/google-gemini/gemini-cli/blob/main/packages/core/src/tools/glob.ts

**Tool name:** `glob`

**Description:**
```
Efficiently finds files matching specific glob patterns (e.g., `src/**/*.ts`, `**/*.md`),
returning absolute paths sorted by modification time (newest first). Ideal for quickly
locating files based on their name or path structure, especially in large codebases.
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | yes | `"The glob pattern to match against (e.g., '**/*.py', 'docs/*.md')."` |
| `dir_path` | string | no | `"Optional: The absolute path to the directory to search within. If omitted, searches the root directory."` |
| `case_sensitive` | boolean | no | `"Optional: Whether the search should be case-sensitive. Defaults to false."` |
| `respect_git_ignore` | boolean | no | `"Optional: Whether to respect .gitignore patterns when finding files. Only available in git repositories. Defaults to true."` |
| `respect_gemini_ignore` | boolean | no | `"Optional: Whether to respect .geminiignore patterns when finding files. Defaults to true."` |

**Behavior:** Returns absolute paths. Sorts "recent" files (modified within last 24h) newest-first; older files sorted alphabetically after. Searches all workspace directories if no `dir_path` given. Respects `getFileExclusions().getGlobExcludes()` for dotfiles.

**Note:** Most parameters of any agent surveyed (5 total). Only agent exposing `case_sensitive` and gitignore control to the model. Uses `dir_path` instead of `path`.

---

## Continue.dev

**Source:** https://github.com/continuedev/continue/blob/main/core/tools/definitions/globSearch.ts

**Tool name:** `file_glob_search` (from `BuiltInToolNames.FileGlobSearch`)

**Description:**
```
Search for files recursively in the project using glob patterns. Supports ** for recursive
directory search. Will not show many build, cache, secrets dirs/files (can use ls tool
instead). Output may be truncated; use targeted patterns
```

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `pattern` | string | yes | `"Glob pattern for file path matching"` |

**No directory parameter** — only takes a pattern.

**Notable fields in tool definition:**
- `defaultToolPolicy: "allowedWithoutPermission"` — no user confirmation required
- `isInstant: true` — executes immediately
- `systemMessageDescription.exampleArgs: [["pattern", "*.py"]]` — example injected into system message, not the description itself
- `wouldLikeTo: 'search for files like "{{{ pattern }}}"'` — UI display string

**Behavior:** Build, cache, and secrets directories excluded automatically. Output truncated; description tells model to use targeted patterns.

---

## Cursor

**Source (Agent Prompt 2.0):** https://github.com/x1xhlol/system-prompts-and-models-of-ai-tools/blob/main/Cursor%20Prompts/Agent%20Prompt%202.0.txt

**Tool name:** `glob_file_search`

**Description:** `"Tool to search for files matching a glob pattern"`

**Parameters:**
| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `glob_pattern` | string | yes | `"The glob pattern to match files against"` |
| `target_directory` | string | no | `"Path to directory to search in"` |

**Note:** Only agent that uses `glob_pattern` instead of `pattern` as the field name, and `target_directory` instead of `path`.

**Cursor March 2025 prompt (gist.github.com/sshh12/25ad2e40529b269a88b80e7cf1c38084):** No glob tool at all. Uses `file_search` (fuzzy filename match) and `grep_search` instead.

---

## Agents With No Glob Tool

| Agent | Reason |
|-------|--------|
| **Aider** | No tool-calling architecture. Model writes diffs directly. `/add *.tsx` is CLI argument handling, not an agent tool. |
| **OpenAI Codex** | Uses shell commands via MCP. `search_tool/tool_description.md` is for MCP connector discovery, not file glob. |
| **Amazon Q Developer CLI** | Glob patterns appear only in `allowedPaths`/`deniedPaths` permission configs on `fs_read`/`fs_write`, not as a model-callable tool. Source: https://github.com/aws/amazon-q-developer-cli/blob/main/docs/built-in-tools.md |

---

## Cross-Agent Comparison

| Agent | Tool name | Pattern field | Dir param | Dir field name | case_sensitive | gitignore | Cap |
|-------|-----------|---------------|-----------|----------------|----------------|-----------|-----|
| Claude Code | `Glob` | `pattern` | yes | `path` | no | no (env opt-in) | 100 |
| OpenCode | `glob` | `pattern` | yes | `path` | no | no | 100 |
| Gemini CLI | `glob` | `pattern` | yes | `dir_path` (absolute) | yes | yes (default true) | none |
| Continue.dev | `file_glob_search` | `pattern` | no | — | no | implicit | truncated |
| Cursor 2.0 | `glob_file_search` | `glob_pattern` | yes | `target_directory` | no | not stated | not stated |

---

## Observations

1. **Every implementation includes examples** — either in the description, in parameter descriptions, or in a system-message injection. No implementation omits examples entirely.

2. **Bullet-list format with behavioral guidance** — Claude Code and OpenCode both use a bullet-list description that includes meta-instructions to the model ("speculatively batch multiple searches", "use the Agent/Task tool for open-ended searches"). This is not just documentation — it is behavioral steering.

3. **Internal path routing is never mentioned** — no implementation exposes how patterns are mapped to disk (what prefix is prepended, what the working directory is at the OS level). That detail lives in the implementation, not the tool description.

4. **Scoping is handled via an optional directory parameter**, not by requiring a prefix in the pattern itself. The `path`/`dir_path`/`target_directory` field handles narrowing. The `pattern` field is always just the glob expression.

5. **"Sorted by modification time"** appears in Claude Code, OpenCode, and Gemini CLI descriptions. Continue.dev omits it.

6. **The "DO NOT enter undefined or null"** warning in the `path` parameter description (Claude Code and OpenCode) is a direct counter to observed model behavior — models sometimes emit `"undefined"` as a string value for optional fields.

7. **OpenCode forked Claude Code's design** — the descriptions are word-for-word identical except "Agent tool" → "Task tool".
