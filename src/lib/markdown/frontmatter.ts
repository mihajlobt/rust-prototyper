// Frontmatter parser for plan documents.
//
// Tolerant of leading whitespace, missing closing `---`, and the absence of
// frontmatter entirely. Pure function — easy to unit test.
//
// On parse failure the raw YAML is preserved as `frontmatterRaw` so the
// preview can still show the user what was wrong. We never silently drop data.

import YAML from "js-yaml";
import { z } from "zod";

/**
 * Recognised values for the `status` frontmatter field. Drives the colour of
 * the status pill in the frontmatter header card.
 *   draft      — gold/amber
 *   planning   — violet
 *   in_review  — blue
 *   approved   — emerald
 *   done       — emerald
 *   blocked    — red
 *   risk       — red
 */
export const PLAN_STATUSES = [
  "draft",
  "planning",
  "in_review",
  "approved",
  "done",
  "blocked",
  "risk",
] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export const PlanFrontmatterSchema = z.object({
  title: z.string().optional(),
  status: z.enum(PLAN_STATUSES).optional(),
  author: z.string().optional(),
  area: z.string().optional(),
  target: z.string().optional(),
  /** ISO date string ("YYYY-MM-DD") or any string the user prefers. */
  updated: z.string().optional(),
  /** Comma-separated tag list, matching the convention used by other panels. */
  tags: z.string().optional(),
});

export type PlanFrontmatter = z.infer<typeof PlanFrontmatterSchema>;

/** Returns the tags list, splitting on commas and trimming whitespace. */
export function parseTags(tags: string | undefined): string[] {
  if (!tags) return [];
  return tags
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export interface ParsedPlan {
  frontmatter: PlanFrontmatter | null;
  /** Raw YAML text (between the `---` fences) when frontmatter was present. */
  frontmatterRaw: string | null;
  /** The markdown body, with the frontmatter block removed. */
  body: string;
  /** True if the frontmatter was found but failed to parse as YAML. */
  frontmatterError: string | null;
}

const FENCE_RE = /^---\s*$/m;

/**
 * Split a plan source into frontmatter and body.
 *
 * Rules:
 *   - The first non-blank line must be `---` (with optional trailing whitespace).
 *   - The second `---` line ends the frontmatter block.
 *   - If either rule fails, the entire source is returned as `body` with
 *     `frontmatter: null`.
 *   - If YAML parses successfully, the result is zod-validated. Fields that
 *     fail validation are dropped (the rest of the frontmatter is kept).
 */
export function parseFrontmatter(source: string): ParsedPlan {
  if (!source) {
    return { frontmatter: null, frontmatterRaw: null, body: "", frontmatterError: null };
  }

  // Tolerate leading blank lines
  const trimmed = source.replace(/^\s*\n/, "");
  if (!trimmed.startsWith("---")) {
    return { frontmatter: null, frontmatterRaw: null, body: source, frontmatterError: null };
  }

  // Find the closing fence: the next line that is exactly `---` (whitespace ok)
  // after the opening one.
  const lines = trimmed.split("\n");
  // lines[0] is the opening fence
  let closingIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      closingIdx = i;
      break;
    }
  }
  if (closingIdx === -1) {
    // Unclosed fence — treat the whole thing as body
    return { frontmatter: null, frontmatterRaw: null, body: source, frontmatterError: null };
  }

  const yamlText = lines.slice(1, closingIdx).join("\n");
  // Keep the blank line after `---` so body line indices match source line indices.
  // toggleTaskInSource computes absoluteLine = fmEnd + 1 + bodyLine, which
  // accounts for this separator line — stripping it would shift every task by 1.
  const body = lines.slice(closingIdx + 1).join("\n");

  let parsed: unknown;
  try {
    parsed = YAML.load(yamlText);
  } catch (err) {
    return {
      frontmatter: null,
      frontmatterRaw: yamlText,
      body,
      frontmatterError: err instanceof Error ? err.message : String(err),
    };
  }

  if (parsed === null || parsed === undefined) {
    // Empty frontmatter (just `---` `---`) — treat as no frontmatter
    return { frontmatter: null, frontmatterRaw: null, body, frontmatterError: null };
  }

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      frontmatter: null,
      frontmatterRaw: yamlText,
      body,
      frontmatterError: "Frontmatter must be a YAML mapping (key: value lines)",
    };
  }

  // Zod validation — drop unknown/invalid fields, keep the rest. Schema is
  // strict about *types* but not exhaustive about *keys*: extra keys are
  // preserved as a separate property on the result if we ever want to read
  // them. For now we just return the validated object.
  const result = PlanFrontmatterSchema.safeParse(parsed);
  if (!result.success) {
    return {
      frontmatter: null,
      frontmatterRaw: yamlText,
      body,
      frontmatterError: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    };
  }

  return {
    frontmatter: result.data,
    frontmatterRaw: yamlText,
    body,
    frontmatterError: null,
  };
}

/** Count words in a string — splits on whitespace, filters empties. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/** Count task checkboxes (open + done) in a markdown body. */
export function countTasks(body: string): { done: number; total: number } {
  const re = /^\s*-\s+\[( |x|X)\]\s+/gm;
  const matches = body.match(re);
  const total = matches?.length ?? 0;
  const done = body.match(/^\s*-\s+\[x\]\s+/gim)?.length ?? 0;
  return { done, total };
}

/**
 * Return the index of the closing `---` line of the YAML frontmatter block,
 * or -1 if the source has no frontmatter / unclosed fence.
 */
export function findFrontmatterEnd(lines: string[]): number {
  if (lines.length === 0) return -1;
  if (lines[0].trim() !== "---") return -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") return i;
  }
  return -1;
}

/**
 * Toggle a task checkbox at the given body line (0-indexed, post-frontmatter).
 * Returns the modified source unchanged if the line is not a task.
 */
export function toggleTaskInSource(source: string, bodyLine: number): string {
  const lines = source.split("\n");
  const fmEnd = findFrontmatterEnd(lines);
  const absoluteLine = fmEnd + 1 + bodyLine;
  if (absoluteLine >= lines.length) return source;
  const line = lines[absoluteLine];
  if (/^\s*-\s+\[\s\]\s+/.test(line)) {
    lines[absoluteLine] = line.replace(/\[ \]/, "[x]");
  } else if (/^\s*-\s+\[x\]\s+/i.test(line)) {
    lines[absoluteLine] = line.replace(/\[x\]/i, "[ ]");
  }
  return lines.join("\n");
}
