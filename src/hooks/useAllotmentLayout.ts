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
 * @param paneVisible Per-pane visibility flags. Pass `false` for panes that are
 *                    currently hidden (visible={false}). The corresponding entry in
 *                    defaultSizes is forced to 0 so Allotment never allocates space
 *                    to them on first layout, preventing the flash where a hidden pane
 *                    briefly appears at full size before being collapsed.
 */
export function useAllotmentLayout(key: string, paneCount?: number, paneVisible?: boolean[]) {
  const ref = useRef<AllotmentHandle>(null);
  const { settings, setSettings } = useAppStore();
  const saved = settings.layout[key];

  const rawSizes: number[] | undefined =
    saved && saved.length > 0 && (paneCount === undefined || saved.length === paneCount)
      ? saved
      : undefined;

  const defaultSizes: number[] | undefined = (() => {
    if (!paneVisible) return rawSizes;
    if (rawSizes) return rawSizes.map((s, i) => paneVisible[i] === false ? 0 : s);
    // No saved layout but some panes are hidden — synthesize sizes so hidden panes
    // start at 0. Without this, Allotment uses preferredSize for all panes on mount,
    // paints that frame, then collapses hidden panes after a ResizeObserver re-render.
    if (paneVisible.some((v) => v === false)) {
      return paneVisible.map((v) => (v === false ? 0 : 1));
    }
    return undefined;
  })();

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
      if (sizes.some((s) => s === 0)) return;
      setSettings({
        layout: { ...settings.layout, [key]: sizes },
      });
    },
    [key, paneCount, settings.layout, setSettings]
  );

  return { ref, onDragEnd, defaultSizes };
}
