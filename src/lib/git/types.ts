export interface GitFileStatus {
  path: string;
  /** Original path, present for renames/copies (status code R/C). */
  origPath?: string;
  /** Staged (index) status code: M, A, D, R, C, U, or " " (unchanged). */
  indexStatus: string;
  /** Working tree status code: M, D, U, or " " (unchanged). "?" for untracked. */
  worktreeStatus: string;
}

export interface GitStatus {
  isRepo: boolean;
  branch: string | null;
  upstream: string | null;
  ahead: number;
  behind: number;
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

export interface GitCommit {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
}

export interface DiffHunkLine {
  type: "add" | "remove" | "context" | "meta";
  content: string;
  oldLineNo?: number;
  newLineNo?: number;
}

export interface DiffHunk {
  header: string;
  lines: DiffHunkLine[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  binary: boolean;
  hunks: DiffHunk[];
}
