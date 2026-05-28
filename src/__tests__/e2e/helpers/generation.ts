import fs from "node:fs";
import path from "node:path";
import { getOllamaConfig, MODEL } from "./config";
import { runFileTypecheck, runLint, runFileBuild } from "./validation";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GenerationResult {
  primaryContent: string | null;
  extraFiles: Record<string, string>;
  assistantText: string;
}

/**
 * When provided, the generate() loop will write primaryContent to disk and
 * run real tsc/lint/build checks whenever the model calls those tools.
 * This tests the model's self-correction behavior on actual compiler output.
 */
export interface GenerationToolContext {
  previewDir: string;
  primaryRelPath: string;
}

// ─── Tool definitions (mirrors what the real Prototyper agent exposes) ────────

const TOOLS = [
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write a new file from scratch. Omit 'path' to write the primary output file. " +
        "Provide 'path' to write additional files within this project.",
      parameters: {
        type: "object",
        properties: {
          content: {
            type: "string",
            description: "Complete raw source code. No markdown fences.",
          },
          path: {
            type: "string",
            description: "Optional relative path. Omit for the primary output file.",
          },
        },
        required: ["content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file's contents.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_tsc",
      description: "Run TypeScript type-checking.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: [],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_lint",
      description: "Run ESLint on a file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_build",
      description: "Run a quick esbuild check on a file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "edit_file",
      description: "Edit a file by replacing a string.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old_string: { type: "string" },
          new_string: { type: "string" },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
];

// ─── Main generation loop ─────────────────────────────────────────────────────

type OllamaMessage = {
  role: string;
  content: string;
  tool_calls?: { function: { name: string; arguments: string | Record<string, unknown> } }[];
  tool_call_id?: string;
  name?: string;
};

/**
 * Call the model and return generated code. If the model returns pure text with no
 * write_file call and no extractable code block, retry once — this happens when the
 * model is overloaded or responds with a plain-text acknowledgement instead of code.
 */
export async function generate(
  systemPrompt: string,
  userPrompt: string,
  maxToolRounds = 12,
  toolContext?: GenerationToolContext,
): Promise<GenerationResult> {
  const result = await generateOnce(systemPrompt, userPrompt, maxToolRounds, toolContext);
  if (result.primaryContent !== null) return result;
  // Retry: model responded with text only (no tool call, no extractable code block)
  return generateOnce(systemPrompt, userPrompt, maxToolRounds, toolContext);
}

async function generateOnce(
  systemPrompt: string,
  userPrompt: string,
  maxToolRounds: number,
  toolContext: GenerationToolContext | undefined,
): Promise<GenerationResult> {
  const { host, key } = await getOllamaConfig();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };

  const conversation: OllamaMessage[] = [{ role: "user", content: userPrompt }];

  let primaryContent: string | null = null;
  const extraFiles: Record<string, string> = {};
  let assistantText = "";

  for (let round = 0; round < maxToolRounds; round++) {
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        tools: TOOLS,
        messages: [{ role: "system", content: systemPrompt }, ...conversation],
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as { message: OllamaMessage };
    const msg = data.message;
    if (msg.content) assistantText = msg.content;
    if (!msg.tool_calls?.length) break;

    conversation.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    for (const tc of msg.tool_calls) {
      const raw = tc.function.arguments;
      const args = (typeof raw === "string" ? JSON.parse(raw) : raw) as {
        content: string;
        path?: string;
        pattern?: string;
        old_string?: string;
        new_string?: string;
      };
      const toolCallId = `tool_${round}_${Math.random().toString(36).slice(2)}`;

      let toolResponse: string;

      if (tc.function.name === "write_file") {
        const code = stripFences(args.content ?? "");
        if (args.path) {
          extraFiles[args.path] = code;
          if (primaryContent === null && code.includes("export default")) {
            primaryContent = code;
          }
        } else {
          primaryContent = code;
        }
        toolResponse = "File written successfully.";
      } else if (tc.function.name === "edit_file") {
        const targetPath = args.path;
        if (
          targetPath &&
          extraFiles[targetPath] &&
          args.old_string &&
          args.new_string !== undefined
        ) {
          extraFiles[targetPath] = extraFiles[targetPath].replace(
            args.old_string,
            args.new_string,
          );
          if (extraFiles[targetPath] === primaryContent) {
            primaryContent = extraFiles[targetPath];
          }
        } else if (
          !targetPath &&
          primaryContent &&
          args.old_string &&
          args.new_string !== undefined
        ) {
          primaryContent = primaryContent.replace(args.old_string, args.new_string);
        }
        toolResponse = "Edit applied successfully.";
      } else if (tc.function.name === "glob") {
        toolResponse = "(no files matched)";
      } else if (tc.function.name === "read_file") {
        const filePath = args.path ?? "";
        const fileKey = Object.keys(extraFiles).find(
          (k) => filePath.endsWith(k) || k.endsWith(filePath),
        );
        toolResponse = fileKey ? extraFiles[fileKey] : `File not found: ${filePath}`;
      } else if (
        tc.function.name === "run_tsc" ||
        tc.function.name === "run_lint" ||
        tc.function.name === "run_build"
      ) {
        toolResponse = runRealToolCheck(tc.function.name, primaryContent, extraFiles, toolContext);
      } else {
        toolResponse = `Tool '${tc.function.name}' not available in test context.`;
      }

      conversation.push({
        role: "tool",
        content: toolResponse,
        tool_call_id: toolCallId,
        name: tc.function.name,
      });
    }
  }

  // Fallback: extract code from markdown text if model didn't call write_file
  if (primaryContent === null && assistantText) {
    const extracted = extractLargestCodeBlock(assistantText);
    if (extracted) primaryContent = extracted;
  }

  return { primaryContent, extraFiles, assistantText };
}

// ─── Tool execution ───────────────────────────────────────────────────────────

function runRealToolCheck(
  toolName: string,
  primaryContent: string | null,
  extraFiles: Record<string, string>,
  toolContext: GenerationToolContext | undefined,
): string {
  if (!toolContext || primaryContent === null) return "Exit code: 0";

  // Write all extra files the model has produced so far so that tsc can resolve cross-file imports.
  // previewDir sits at projects/{id}/component-preview or projects/{id}/screen-preview.
  const projectDir = path.join(toolContext.previewDir, "..");
  const appDataDir = path.join(toolContext.previewDir, "../../..");
  for (const [relPath, content] of Object.entries(extraFiles)) {
    for (const dest of resolveExtraFileDests(relPath, appDataDir, projectDir, toolContext.previewDir)) {
      try {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, content, "utf8");
      } catch {
        // Non-fatal: best-effort staging of helper files for tsc resolution
      }
    }
  }

  const absPath = path.join(toolContext.previewDir, toolContext.primaryRelPath);
  try {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, primaryContent, "utf8");
  } catch (err: unknown) {
    return `Could not write file for validation: ${(err as Error).message}`;
  }

  if (toolName === "run_tsc") {
    return runFileTypecheck(toolContext.previewDir, toolContext.primaryRelPath) || "Exit code: 0";
  }
  if (toolName === "run_lint") {
    return runLint(toolContext.previewDir, toolContext.primaryRelPath) || "Exit code: 0";
  }
  // run_build
  try {
    runFileBuild(toolContext.previewDir, toolContext.primaryRelPath);
    return "Exit code: 0";
  } catch (err: unknown) {
    return (err as Error).message;
  }
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function extractLargestCodeBlock(text: string): string | null {
  const fenced = [...text.matchAll(/```[\w]*\s*\n?([\s\S]*?)```/g)].map((m) => m[1].trim());
  if (fenced.length) {
    return fenced.reduce((a, b) => (b.length > a.length ? b : a));
  }
  const tsxMatch = text.match(
    /(import\s+(?:React|{)[\s\S]*?export\s+default\s+function\s+\w+[\s\S]*?^})/m,
  );
  if (tsxMatch) return tsxMatch[1].trim();
  const cssMatch = text.match(/(:root\s*{[\s\S]*?}|\.dark\s*{[\s\S]*?})/);
  if (cssMatch) return cssMatch[1].trim();
  return null;
}

function stripFences(s: string): string {
  return s
    .replace(/^```[\w]*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "")
    .trim();
}

/**
 * Resolve all filesystem destinations for a model-written extra file.
 *
 * Models use several path conventions for helper files:
 *   - "projects/{id}/data/store.ts"  — absolute project path
 *   - "data/store.ts"                — relative, ambiguous
 *   - "src/data/store.ts"            — relative to preview root
 *
 * The @/ alias in both preview projects resolves to previewDir/src/.
 * We write to multiple candidate locations so both @/ imports and
 * deep-relative imports (../../..) can resolve without model-specific logic.
 */
export function resolveExtraFileDests(
  relPath: string,
  appDataDir: string,
  projectDir: string,
  previewDir: string,
): string[] {
  if (relPath.startsWith("projects/")) {
    // Absolute project path — write to both the natural location and previewDir/src/
    // so @/ imports inside the preview resolve too.
    const naturalDest = path.join(appDataDir, relPath);
    const parts = relPath.split("/");
    // parts: ["projects", "{id}", ...rest]
    if (parts.length > 2) {
      const afterProjectId = parts.slice(2).join("/");
      const normalized = afterProjectId.startsWith("src/")
        ? afterProjectId.slice(4)
        : afterProjectId;
      return [naturalDest, path.join(previewDir, "src", normalized)];
    }
    return [naturalDest];
  }

  // Non-project path: strip a leading "src/" so "src/data/store.ts" and "data/store.ts"
  // both land at previewDir/src/data/store.ts (covering @/ imports).
  const normalized = relPath.startsWith("src/") ? relPath.slice(4) : relPath;
  return [
    path.join(projectDir, relPath),        // for deep relative imports (../../../data/)
    path.join(previewDir, "src", normalized), // for @/ alias imports
  ];
}
