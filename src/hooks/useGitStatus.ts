import { useQuery } from "@tanstack/react-query";
import { gitKeys } from "@/lib/queryKeys";
import { isGitRepo, gitCwd } from "@/lib/git/repo";
import { getStatus } from "@/lib/git/status";
import { getLog } from "@/lib/git/log";
import { getUnstagedDiff, getStagedDiff, getUntrackedDiff, getCommitDiff, getFileAtHead } from "@/lib/git/diff";

export function useIsGitRepo(project: string) {
  return useQuery({
    queryKey: gitKeys.isRepo(project),
    queryFn: () => isGitRepo(gitCwd(project)),
    enabled: !!project,
  });
}

export function useGitStatus(project: string, enabled: boolean) {
  return useQuery({
    queryKey: gitKeys.status(project),
    queryFn: () => getStatus(gitCwd(project)),
    enabled: !!project && enabled,
    staleTime: 5_000,
  });
}

export function useGitLog(project: string, enabled: boolean, limit = 50) {
  return useQuery({
    queryKey: gitKeys.log(project, limit),
    queryFn: () => getLog(gitCwd(project), limit),
    enabled: !!project && enabled,
    staleTime: 5_000,
  });
}

/** Diff for a single file — `untracked` synthesizes an all-added diff (git doesn't diff these). */
export function useGitDiff(project: string, path: string | null, staged: boolean, untracked: boolean) {
  return useQuery({
    queryKey: gitKeys.diff(project, path ?? "", staged),
    queryFn: () => {
      const cwd = gitCwd(project);
      if (untracked) return getUntrackedDiff(cwd, path!);
      return staged ? getStagedDiff(cwd, path!) : getUnstagedDiff(cwd, path!);
    },
    enabled: !!project && !!path,
  });
}

/** Full diff for a commit (`git show <hash>`), used by the commit history view. */
export function useCommitDiff(project: string, hash: string | null) {
  return useQuery({
    queryKey: gitKeys.commitDiff(project, hash ?? ""),
    queryFn: () => getCommitDiff(gitCwd(project), hash!),
    enabled: !!project && !!hash,
  });
}

/** Content of a file at HEAD — used to compute inline editor diff gutters. */
export function useFileAtHead(project: string, relPath: string | null) {
  return useQuery({
    queryKey: gitKeys.fileAtHead(project, relPath ?? ""),
    queryFn: () => getFileAtHead(gitCwd(project), relPath!),
    enabled: !!project && !!relPath,
    staleTime: 5_000,
  });
}
