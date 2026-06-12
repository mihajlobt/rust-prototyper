import { runShellCommandCapture } from "@/lib/ipc";
import type { GitFileStatus, GitStatus } from "./types";

const ORDINARY_RE = /^1 (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/;
const RENAME_RE = /^2 (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/;
const UNMERGED_RE = /^u (\S\S) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/;
const UNTRACKED_RE = /^\? (.*)$/;

/**
 * Runs `git status --porcelain=v2 --branch -z` and parses the NUL-delimited
 * output into branch/upstream/ahead-behind info plus staged/unstaged/untracked
 * file lists. A file can appear in both `staged` and `unstaged` if it has both
 * staged and further working-tree changes (matches VS Code's source control view).
 */
export async function getStatus(cwd: string): Promise<GitStatus> {
  const output = await runShellCommandCapture(cwd, "git status --porcelain=v2 --branch -z");
  const tokens = output.split("\0").filter((t) => t.length > 0);

  const result: GitStatus = {
    isRepo: true,
    branch: null,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    untracked: [],
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];

    if (token.startsWith("# branch.head ")) {
      const head = token.slice("# branch.head ".length);
      result.branch = head === "(detached)" ? null : head;
      continue;
    }
    if (token.startsWith("# branch.upstream ")) {
      result.upstream = token.slice("# branch.upstream ".length);
      continue;
    }
    if (token.startsWith("# branch.ab ")) {
      const m = token.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (m) {
        result.ahead = parseInt(m[1], 10);
        result.behind = parseInt(m[2], 10);
      }
      continue;
    }
    if (token.startsWith("#")) continue;
    if (token.startsWith("!")) continue;

    let entry: GitFileStatus | null = null;

    const ordinary = token.match(ORDINARY_RE);
    const rename = token.match(RENAME_RE);
    const unmerged = token.match(UNMERGED_RE);
    const untracked = token.match(UNTRACKED_RE);

    if (ordinary) {
      const [, xy, , , , , , , path] = ordinary;
      entry = { path, indexStatus: xy[0], worktreeStatus: xy[1] };
    } else if (rename) {
      const [, xy, , , , , , , , path] = rename;
      const origPath = tokens[++i];
      entry = { path, origPath, indexStatus: xy[0], worktreeStatus: xy[1] };
    } else if (unmerged) {
      const [, xy, , , , , , , , , path] = unmerged;
      entry = { path, indexStatus: xy[0], worktreeStatus: xy[1] };
    } else if (untracked) {
      const [, path] = untracked;
      entry = { path, indexStatus: "?", worktreeStatus: "?" };
    }

    if (!entry) continue;

    if (entry.indexStatus === "?") {
      result.untracked.push(entry);
      continue;
    }
    if (entry.indexStatus !== ".") {
      result.staged.push(entry);
    }
    if (entry.worktreeStatus !== ".") {
      result.unstaged.push(entry);
    }
  }

  return result;
}
