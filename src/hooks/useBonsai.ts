import { useEffect, useCallback } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useBonsaiStore } from "@/stores/bonsaiStore";
import { useAppStore } from "@/stores/appStore";

export function useBonsai() {
  const project = useAppStore((s) => s.settings.project);
  const store = useBonsaiStore();

  useEffect(() => {
    if (!project) return;
    store.loadConfig();
    store.refreshStatus();
    store.listAssets(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable, project is the only reactive dep
  }, [project]);

  // Listen for auto-stop timer event from Rust backend.
  // React 19 Strict Mode mounts twice in dev; cleanup unlistens the orphaned first
  // registration when its .then resolves, so no separate guard ref is needed.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    listen("bonsai:stop-timeout", () => {
      store.stopServer();
      store.setStopScheduled(false);
    }).then((fn) => { unlisten = fn; });
    return () => {
      unlisten?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable
  }, []);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable
  const startServer = useCallback(() => store.startServer(), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable
  const stopServer = useCallback(() => store.stopServer(), []);
  const generateImage = useCallback(
    (prompt: string, opts?: { width?: number; height?: number; steps?: number; seed?: number; backend?: string }) => {
      if (!project) return Promise.resolve(null);
      return store.generateImage({
        projectId: project,
        prompt,
        ...opts,
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable, project is the only reactive dep
    [project]
  );
  const refreshAssets = useCallback(() => {
    if (!project) return;
    store.listAssets(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable, project is the only reactive dep
  }, [project]);
  const deleteAsset = useCallback((fileName: string) => {
    if (!project) return;
    store.deleteAsset(project, fileName);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable, project is the only reactive dep
  }, [project]);

  return {
    ...store,
    projectId: project,
    startServer,
    stopServer,
    generateImage,
    refreshAssets,
    deleteAsset,
  };
}