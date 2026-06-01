import { useState, useRef, useEffect, useCallback, type RefObject } from "react";
import { loadNavigation, createHotspot, type Hotspot, type MigrationReport } from "@/lib/navigation";
import { notify } from "@/hooks/useToast";
import { getErrorMessage } from "@/lib/ipc";

interface UseHotspotTrackingOptions {
  screenId: string | null | undefined;
  projectDir: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  runnerUrl: string | null;
}

interface UseHotspotTrackingResult {
  hotspots: Hotspot[];
  setHotspots: React.Dispatch<React.SetStateAction<Hotspot[]>>;
  computedHotspots: Record<string, { x: number; y: number; w: number; h: number }>;
  setComputedHotspots: React.Dispatch<React.SetStateAction<Record<string, { x: number; y: number; w: number; h: number }>>>;
  isSelectingElement: boolean;
  setIsSelectingElement: React.Dispatch<React.SetStateAction<boolean>>;
  newHotspotId: string | null;
  setNewHotspotId: React.Dispatch<React.SetStateAction<string | null>>;
  hotspotsRef: React.RefObject<Hotspot[]>;
}

export function useHotspotTracking({
  screenId,
  projectDir,
  iframeRef,
  runnerUrl,
}: UseHotspotTrackingOptions): UseHotspotTrackingResult {
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [computedHotspots, setComputedHotspots] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});
  const [isSelectingElement, setIsSelectingElement] = useState(false);
  const [newHotspotId, setNewHotspotId] = useState<string | null>(null);
  const hotspotsRef = useRef<Hotspot[]>(hotspots);
  useEffect(() => { hotspotsRef.current = hotspots; }, [hotspots]);

  const reloadScreenNav = useCallback(async () => {
    if (!screenId) { setHotspots([]); setComputedHotspots({}); return; }
    try {
      const nav = await loadNavigation(projectDir, {
        onMigration: (report: MigrationReport) => {
          const parts: string[] = [];
          if (report.syntheticCount > 0)
            parts.push(`${report.syntheticCount} manual link${report.syntheticCount > 1 ? "s" : ""} converted to logical connections`);
          if (report.droppedDataLinkCount > 0)
            parts.push(`${report.droppedDataLinkCount} data link${report.droppedDataLinkCount > 1 ? "s" : ""} removed`);
          notify.info("Navigation migrated", parts.join("; ") + ". Open the Links tab to review.");
        },
      });
      setHotspots(nav.hotspots.filter((h) => h.screenId === screenId));
      setComputedHotspots({});
    } catch { /* ignore */ }
  }, [screenId, projectDir]);

  useEffect(() => { void reloadScreenNav(); }, [reloadScreenNav]);

  // Cancel element selection when switching screens
  useEffect(() => {
    setIsSelectingElement(false);
    iframeRef.current?.contentWindow?.postMessage({ type: "disable-link-mode" }, "*");
  }, [screenId, iframeRef]);

  useEffect(() => {
    window.addEventListener("navigation-changed", reloadScreenNav);
    return () => window.removeEventListener("navigation-changed", reloadScreenNav);
  }, [reloadScreenNav]);

  // Sync hotspot list to iframe for position tracking
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;
    const payload = hotspotsRef.current.map((h) => ({ id: h.id, portId: h.id, selector: h.selector }));
    iframe.contentWindow.postMessage({ type: "__set-hotspots", hotspots: payload }, "*");
  }, [hotspots, runnerUrl, iframeRef]);

  // Receive position updates from iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "__hotspot-positions") return;
      const positions = event.data.positions as Record<string, { x: number; y: number; w: number; h: number }>;
      setComputedHotspots((prev) => ({ ...prev, ...positions }));
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Re-request positions when the iframe is resized (panel drag, zoom change)
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const observer = new ResizeObserver(() => {
      const payload = hotspotsRef.current.map((h) => ({ id: h.id, portId: h.id, selector: h.selector }));
      iframe.contentWindow?.postMessage({ type: "__set-hotspots", hotspots: payload }, "*");
    });
    observer.observe(iframe);
    return () => observer.disconnect();
  // runnerUrl triggers re-attachment when the iframe src changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runnerUrl]);

  // Handle element-selected from iframe — create hotspot immediately with empty target
  useEffect(() => {
    if (!isSelectingElement) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "element-selected") return;
      const { selector, rect } = event.data as { selector: string; rect: { x: number; y: number; w: number; h: number } };
      setIsSelectingElement(false);
      if (!screenId) return;
      createHotspot(projectDir, screenId, selector, rect, "")
        .then((hotspot) => {
          setHotspots((prev) => [...prev, hotspot]);
          setNewHotspotId(hotspot.id);
          window.dispatchEvent(new Event("navigation-changed"));
        })
        .catch((e) => notify.error("Failed to create link", getErrorMessage(e)));
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [isSelectingElement, screenId, projectDir]);

  return {
    hotspots, setHotspots,
    computedHotspots, setComputedHotspots,
    isSelectingElement, setIsSelectingElement,
    newHotspotId, setNewHotspotId,
    hotspotsRef,
  };
}
