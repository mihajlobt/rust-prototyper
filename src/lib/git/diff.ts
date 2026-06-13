import { runShellCommandCapture, readFile } from "@/lib/ipc";
import { quotePath } from "./shellQuote";
import type { DiffFile, DiffHunk, DiffHunkLine } from "./types";

export function diffStats(file: DiffFile): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions++;
      else if (line.type === "remove") deletions++;
    }
  }
  return { additions, deletions };
}

const NOT_FOUND_MARKERS = ["fatal:", "does not exist", "exists on disk, but not in"];

/** Diff of unstaged changes for a single tracked file (working tree vs index). */
export async function getUnstagedDiff(cwd: string, path: string): Promise<string> {
  return runShellCommandCapture(cwd, `git diff -- ${quotePath(path)}`);
}

/** Diff of staged changes for a single file (index vs HEAD). */
export async function getStagedDiff(cwd: string, path: string): Promise<string> {
  return runShellCommandCapture(cwd, `git diff --cached -- ${quotePath(path)}`);
}

/** Synthesizes an "all added" diff for an untracked file (git doesn't diff these by default). */
export async function getUntrackedDiff(cwd: string, path: string): Promise<string> {
  const content = await readFile(`${cwd}/${path}`).catch(() => "");
  const lines = content.length > 0 ? content.split("\n") : [];
  // Drop a single trailing empty line produced by a final newline in the file.
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const body = lines.map((line) => `+${line}`).join("\n");
  return [
    `diff --git a/${path} b/${path}`,
    "new file mode 100644",
    "index 0000000..0000000",
    "--- /dev/null",
    `+++ b/${path}`,
    `@@ -0,0 +1,${lines.length} @@`,
    body,
  ].join("\n");
}

/** Diff for an entire commit (`git show <hash>`). */
export async function getCommitDiff(cwd: string, hash: string): Promise<string> {
  return runShellCommandCapture(cwd, `git show ${hash}`);
}

/** Extracts the commit subject (first message line) from `git show` output. */
export function extractCommitSubject(showOutput: string): string {
  const headerEnd = showOutput.indexOf("\ndiff --git");
  const header = headerEnd >= 0 ? showOutput.slice(0, headerEnd) : showOutput;
  const messageLine = header
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !/^(commit |Author:|Date:|Merge:)/.test(line));
  return messageLine ?? "";
}

/** Content of `relPath` at `ref` (e.g. "HEAD", a commit hash, or "<hash>^"), or "" if it doesn't exist there. */
export async function getFileAtRef(cwd: string, ref: string, relPath: string): Promise<string> {
  const output = await runShellCommandCapture(cwd, `git show ${ref}:${quotePath(relPath)}`);
  if (NOT_FOUND_MARKERS.some((marker) => output.includes(marker))) return "";
  return output;
}

/** Content of `relPath` at HEAD, or "" if the file is new (not yet tracked). */
export async function getFileAtHead(cwd: string, relPath: string): Promise<string> {
  return getFileAtRef(cwd, "HEAD", relPath);
}

/** Content of `relPath` in the index (staging area), or "" if it isn't staged. */
export async function getFileAtIndex(cwd: string, relPath: string): Promise<string> {
  return getFileAtRef(cwd, "", relPath);
}

/** Before/after content for an unstaged-changes diff (working tree vs index). */
export async function getUnstagedFileContent(
  cwd: string,
  path: string,
  untracked: boolean
): Promise<{ original: string; modified: string }> {
  const [modified, original] = await Promise.all([
    readFile(`${cwd}/${path}`).catch(() => ""),
    untracked ? Promise.resolve("") : getFileAtIndex(cwd, path),
  ]);
  return { original, modified };
}

/** Before/after content for a staged-changes diff (index vs HEAD). */
export async function getStagedFileContent(cwd: string, path: string): Promise<{ original: string; modified: string }> {
  const [original, modified] = await Promise.all([getFileAtHead(cwd, path), getFileAtIndex(cwd, path)]);
  return { original, modified };
}

/** Before/after content for a single file within a commit diff (parent vs commit). */
export async function getCommitFileContent(
  cwd: string,
  hash: string,
  oldPath: string,
  newPath: string
): Promise<{ original: string; modified: string }> {
  const [original, modified] = await Promise.all([
    getFileAtRef(cwd, `${hash}^`, oldPath),
    getFileAtRef(cwd, hash, newPath),
  ]);
  return { original, modified };
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** Parses unified diff text (possibly multiple files) into structured hunks for rendering. */
export function parseUnifiedDiff(diffText: string): DiffFile[] {
  const files: DiffFile[] = [];
  const lines = diffText.split("\n");

  let current: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = { oldPath: m?.[1] ?? "", newPath: m?.[2] ?? "", binary: false, hunks: [] };
      files.push(current);
      hunk = null;
      continue;
    }
    if (!current) continue;

    if (line.startsWith("Binary files ") && line.endsWith(" differ")) {
      current.binary = true;
      continue;
    }
    if (line.startsWith("--- ") || line.startsWith("+++ ") || line.startsWith("index ") || line.startsWith("new file mode") || line.startsWith("deleted file mode") || line.startsWith("rename ") || line.startsWith("similarity index")) {
      continue;
    }

    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      oldLine = parseInt(hunkMatch[1], 10);
      newLine = parseInt(hunkMatch[2], 10);
      hunk = { header: line, lines: [] };
      current.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const lineEntry = (): DiffHunkLine | null => {
      if (line.startsWith("+")) return { type: "add", content: line.slice(1), newLineNo: newLine++ };
      if (line.startsWith("-")) return { type: "remove", content: line.slice(1), oldLineNo: oldLine++ };
      if (line.startsWith("\\")) return { type: "meta", content: line.slice(1).trim() };
      if (line.startsWith(" ") || line === "") {
        return { type: "context", content: line.slice(1), oldLineNo: oldLine++, newLineNo: newLine++ };
      }
      return null;
    };

    const entry = lineEntry();
    if (entry) hunk.lines.push(entry);
  }

  return files;
}
