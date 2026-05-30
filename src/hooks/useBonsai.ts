import { useEffect, useCallback, useRef } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useBonsaiStore } from "@/stores/bonsaiStore";
import { useAppStore } from "@/stores/appStore";

export function useBonsai() {
  const project = useAppStore((s) => s.settings.project);
  const store = useBonsaiStore();

  useEffect(() => {
    store.loadConfig();
    store.refreshStatus();
    store.listAssets(project);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable, project is the only reactive dep
  }, [project]);

  // Listen for auto-stop timer event from Rust backend.
  // Guard with ref to prevent double-listening in React 19 Strict Mode (dev double-mount).
  const stopTimeoutRegisteredRef = useRef(false);
  useEffect(() => {
    if (stopTimeoutRegisteredRef.current) return;
    stopTimeoutRegisteredRef.current = true;
    let unlisten: UnlistenFn | null = null;
    listen("bonsai:stop-timeout", () => {
      store.stopServer();
      store.setStopScheduled(false);
    }).then((fn) => { unlisten = fn; });
    return () => {
      unlisten?.();
      stopTimeoutRegisteredRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable
  }, []);

  const startServer = useCallback(() => store.startServer(), []);
  const stopServer = useCallback(() => store.stopServer(), []);
  const generateImage = useCallback(
    (prompt: string, opts?: { width?: number; height?: number; steps?: number; seed?: number; backend?: string }) =>
      store.generateImage({
        projectId: project,
        prompt,
        ...opts,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- store ref is stable, project is the only reactive dep
    [project]
  );
  const refreshAssets = useCallback(() => store.listAssets(project), [project]);
  const deleteAsset = useCallback((fileName: string) => store.deleteAsset(project, fileName), [project]);

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