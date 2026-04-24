import { useRef, useCallback, useEffect } from "react";
import type { AllotmentHandle } from "allotment";
import { useAppStore } from "@/stores/appStore";

/**
 * Hook for persisting and restoring Allotment pane sizes.
 *
 * - Restores saved sizes via the `defaultSizes` prop on initial mount.
 * - Saves layout on drag-end (fires once per drag, not continuously).
 * - Listens for `prototyper:reset-layout` and calls `ref.current?.reset()`.
 *
 * @param key        Unique key under `settings.layout[key]`.
 * @param paneCount  Expected number of panes; ignores stale arrays with wrong length.
 */
export function useAllotmentLayout(key: string, paneCount?: number) {
  const ref = useRef<AllotmentHandle>(null);
  const { settings, setSettings } = useAppStore();
  const saved = settings.layout[key];

  const defaultSizes: number[] | undefined =
    saved && saved.length > 0 && (paneCount === undefined || saved.length === paneCount)
      ? saved
      : undefined;

  // Listen for global reset event
  useEffect(() => {
    const handler = () => {
      ref.current?.reset();
    };
    window.addEventListener("prototyper:reset-layout", handler);
    return () => window.removeEventListener("prototyper:reset-layout", handler);
  }, []);

  const onDragEnd = useCallback(
    (sizes: number[]) => {
      if (paneCount !== undefined && sizes.length !== paneCount) return;
      setSettings({
        layout: { ...settings.layout, [key]: sizes },
      });
    },
    [key, paneCount, settings.layout, setSettings]
  );

  return { ref, onDragEnd, defaultSizes };
}
