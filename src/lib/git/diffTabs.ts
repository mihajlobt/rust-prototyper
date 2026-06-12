/** Encodes git diff views as synthetic "tab paths" so they can live alongside
 *  regular file tabs in the Runner editor's tab bar. */

const PREFIX = "git-diff:";

export interface FileDiffTabParams {
  kind: "file";
  path: string;
  staged: boolean;
  untracked: boolean;
}

export interface CommitDiffTabParams {
  kind: "commit";
  hash: string;
}

export type DiffTabParams = FileDiffTabParams | CommitDiffTabParams;

export function isDiffTab(tabPath: string): boolean {
  return tabPath.startsWith(PREFIX);
}

export function makeFileDiffTabId(path: string, staged: boolean, untracked: boolean): string {
  return `${PREFIX}file:${staged}:${untracked}:${path}`;
}

export function makeCommitDiffTabId(hash: string): string {
  return `${PREFIX}commit:${hash}`;
}

export function parseDiffTab(tabPath: string): DiffTabParams | null {
  if (!tabPath.startsWith(PREFIX)) return null;
  const rest = tabPath.slice(PREFIX.length);

  if (rest.startsWith("file:")) {
    const [, stagedStr, untrackedStr, ...pathParts] = rest.split(":");
    return { kind: "file", path: pathParts.join(":"), staged: stagedStr === "true", untracked: untrackedStr === "true" };
  }
  if (rest.startsWith("commit:")) {
    return { kind: "commit", hash: rest.slice("commit:".length) };
  }
  return null;
}

/** Short label for the tab bar — filename or short commit hash. */
export function diffTabLabel(params: DiffTabParams): string {
  if (params.kind === "file") return params.path.split("/").pop() ?? params.path;
  return params.hash.slice(0, 7);
}
