import { useMutation, useQueryClient } from "@tanstack/react-query";
import { gitKeys } from "@/lib/queryKeys";
import { getErrorMessage } from "@/lib/ipc";
import { notify } from "@/hooks/useToast";
import { initRepo, gitCwd as cwdFor } from "@/lib/git/repo";
import { stageFile, stageAll, unstageFile, unstageAll, discardFile } from "@/lib/git/staging";
import { commit } from "@/lib/git/commit";
import { gitFetch, gitPull, gitPush, gitSync } from "@/lib/git/remote";

/** Invalidates status + diff queries shared by every staging/commit mutation. */
function invalidateChanges(queryClient: ReturnType<typeof useQueryClient>, project: string) {
  queryClient.invalidateQueries({ queryKey: gitKeys.status(project) });
  queryClient.invalidateQueries({ queryKey: ["git", project, "diff"] });
}

export function useInitRepo(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => initRepo(cwdFor(project)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.isRepo(project) });
      invalidateChanges(queryClient, project);
      notify.success("Git repository initialized");
    },
    onError: (e) => notify.error("Failed to initialize repository", getErrorMessage(e)),
  });
}

export function useStageFile(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => stageFile(cwdFor(project), path),
    onSuccess: () => invalidateChanges(queryClient, project),
    onError: (e) => notify.error("Failed to stage file", getErrorMessage(e)),
  });
}

export function useUnstageFile(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (path: string) => unstageFile(cwdFor(project), path),
    onSuccess: () => invalidateChanges(queryClient, project),
    onError: (e) => notify.error("Failed to unstage file", getErrorMessage(e)),
  });
}

export function useStageAll(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => stageAll(cwdFor(project)),
    onSuccess: () => invalidateChanges(queryClient, project),
    onError: (e) => notify.error("Failed to stage all changes", getErrorMessage(e)),
  });
}

export function useUnstageAll(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => unstageAll(cwdFor(project)),
    onSuccess: () => invalidateChanges(queryClient, project),
    onError: (e) => notify.error("Failed to unstage all changes", getErrorMessage(e)),
  });
}

export function useDiscardFile(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, isUntracked }: { path: string; isUntracked: boolean }) =>
      discardFile(cwdFor(project), path, isUntracked),
    onSuccess: (_, { path }) => {
      invalidateChanges(queryClient, project);
      queryClient.invalidateQueries({ queryKey: gitKeys.fileAtHead(project, path) });
    },
    onError: (e) => notify.error("Failed to discard changes", getErrorMessage(e)),
  });
}

export function useCommit(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (message: string) => commit(cwdFor(project), message),
    onSuccess: () => {
      invalidateChanges(queryClient, project);
      queryClient.invalidateQueries({ queryKey: ["git", project, "log"] });
      queryClient.invalidateQueries({ queryKey: ["git", project, "head"] });
      notify.success("Committed");
    },
    onError: (e) => notify.error("Commit failed", getErrorMessage(e)),
  });
}

export function useFetch(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => gitFetch(cwdFor(project)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.status(project) });
      notify.success("Fetched");
    },
    onError: (e) => notify.error("Fetch failed", getErrorMessage(e)),
  });
}

export function usePull(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => gitPull(cwdFor(project)),
    onSuccess: () => {
      invalidateChanges(queryClient, project);
      queryClient.invalidateQueries({ queryKey: ["git", project, "log"] });
      queryClient.invalidateQueries({ queryKey: ["git", project, "head"] });
      notify.success("Pulled");
    },
    onError: (e) => notify.error("Pull failed", getErrorMessage(e)),
  });
}

export function usePush(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => gitPush(cwdFor(project)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: gitKeys.status(project) });
      notify.success("Pushed");
    },
    onError: (e) => notify.error("Push failed", getErrorMessage(e)),
  });
}

export function useSync(project: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => gitSync(cwdFor(project)),
    onSuccess: () => {
      invalidateChanges(queryClient, project);
      queryClient.invalidateQueries({ queryKey: ["git", project, "log"] });
      queryClient.invalidateQueries({ queryKey: ["git", project, "head"] });
      notify.success("Synced");
    },
    onError: (e) => notify.error("Sync failed", getErrorMessage(e)),
  });
}
