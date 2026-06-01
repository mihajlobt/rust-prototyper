// Pure helpers for workflow node execution.
// No React, no IPC — these are unit-testable string/data transformations
// extracted from useWorkflowExecution to keep that hook focused on orchestration.

/** Strip a single outer markdown code fence if present, otherwise trim. */
export function stripCodeFences(input: string): string {
  const match = input.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return match ? match[1].trim() : input.trim();
}

/**
 * Walk a dot-notation path through a JSON-like value.
 * Supports objects, arrays (numeric segments), and returns undefined for any
 * missing or non-traversable intermediate value.
 */
export function traverseJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const index = Number(part);
      current = current[index];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Line-oriented unified diff between two strings.
 * Simple LCS-free diff: emits all lines from `after`, prefixed with
 * `+` for new/changed, `-` for removed, and ` ` for unchanged.
 * Output is suitable for human review, not patch application.
 */
export function computeDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const result: string[] = ["--- base", "+++ output"];
  let beforeIdx = 0;
  let afterIdx = 0;

  while (beforeIdx < beforeLines.length || afterIdx < afterLines.length) {
    if (beforeIdx >= beforeLines.length) {
      result.push(`+ ${afterLines[afterIdx++]}`);
    } else if (afterIdx >= afterLines.length) {
      result.push(`- ${beforeLines[beforeIdx++]}`);
    } else if (beforeLines[beforeIdx] === afterLines[afterIdx]) {
      result.push(`  ${beforeLines[beforeIdx++]}`);
      afterIdx++;
    } else {
      result.push(`- ${beforeLines[beforeIdx++]}`);
      result.push(`+ ${afterLines[afterIdx++]}`);
    }
  }
  return result.join("\n");
}
