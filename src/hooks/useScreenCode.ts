import { useState, useCallback, useEffect } from "react";
import type { QueryClient } from "@tanstack/react-query";
import { readFile, writeFile, createDir, isNotFoundError, getErrorMessage } from "@/lib/ipc";
import { syncGeneratedRouter } from "@/lib/navigation";
import { saveItemMeta } from "@/lib/item-meta";
import { projectKeys } from "@/lib/queryKeys";
import { useChatStore } from "@/stores/chatStore";
import { notify } from "@/hooks/useToast";

interface UseScreenCodeOptions {
  screenId: string | null | undefined;
  screenPath: string;
  projectDir: string;
  queryClient: QueryClient;
  runnerUrl: string | null;
}

interface UseScreenCodeResult {
  code: string;
  setCode: React.Dispatch<React.SetStateAction<string>>;
  handleCodeChange: (value: string) => void;
  handleCodeBlur: () => void;
  applyScreenCode: (code: string) => void;
}

export function useScreenCode({
  screenId,
  screenPath,
  projectDir,
  queryClient,
  runnerUrl,
}: UseScreenCodeOptions): UseScreenCodeResult {
  const [code, setCode] = useState("");

  const applyScreenCode = useCallback((newCode: string) => {
    setCode(newCode);
    const parentDir = screenPath.substring(0, screenPath.lastIndexOf("/"));
    const entityId = screenId ? `screen-${screenId}` : "screen-none";
    const msgs = useChatStore.getState().chats[entityId]?.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content ?? "";
    createDir(parentDir)
      .then(() => writeFile(screenPath, newCode))
      .then(() => syncGeneratedRouter(projectDir))
      .then(() => {
        if (screenId) {
          void saveItemMeta(projectDir, "screens", screenId, prompt)
            .then(() => queryClient.invalidateQueries({ queryKey: projectKeys.library(projectDir.replace("projects/", "")) }));
        }
      })
      .catch((e) => notify.error("Failed to save screen", getErrorMessage(e)));
  }, [screenPath, projectDir, screenId, queryClient]);

  const saveScreenCode = useCallback(async (value: string) => {
    if (!screenId || !value) return;
    try {
      const parentDir = screenPath.substring(0, screenPath.lastIndexOf("/"));
      await createDir(parentDir);
      await writeFile(screenPath, value);
    } catch (e) {
      notify.error("Failed to save screen", getErrorMessage(e));
    }
  }, [screenId, screenPath]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  const handleCodeBlur = useCallback(() => {
    void saveScreenCode(code);
  }, [code, saveScreenCode]);

  // Ctrl+S to save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void saveScreenCode(code);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [code, saveScreenCode]);

  // Load code when screen changes
  useEffect(() => {
    if (!screenId) { setCode(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const content = await readFile(screenPath);
        if (!cancelled && content) setCode(content);
      } catch (e) {
        if (!cancelled) {
          setCode("");
          if (!isNotFoundError(e)) notify.error("Failed to load screen", getErrorMessage(e));
        }
      }
    })();
    return () => { cancelled = true; };
  // runnerUrl in deps so re-loading happens after scaffold completes (runnerUrl set after server starts)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screenId, screenPath, runnerUrl]);

  return { code, setCode, handleCodeChange, handleCodeBlur, applyScreenCode };
}
