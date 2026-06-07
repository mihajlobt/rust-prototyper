import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HotspotOverlay } from "@/panels/screens/HotspotOverlay";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import type { RefObject } from "react";
import type { Hotspot } from "@/lib/navigation";

interface ScreensIframePreviewProps {
  runnerStatus: "idle" | "starting" | "running" | "error";
  runnerError: string | null;
  runnerUrl: string | null;
  screenId: string | null;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  hotspotsRef: RefObject<Hotspot[]>;
  hotspots: Hotspot[];
  screensCodeTab: string;
  selectedHotspotId: string | null;
  onSelectHotspot: (id: string | null) => void;
  isSelectingElement: boolean;
  computedHotspots: Record<string, { x: number; y: number; w: number; h: number }>;
  screenIds: string[];
  projectDir: string;
  onHotspotsChange: (hotspots: Hotspot[]) => void;
  onRetry: () => void;
}

export function ScreensIframePreview({
  runnerStatus,
  runnerError,
  runnerUrl,
  screenId,
  iframeRef,
  hotspotsRef,
  hotspots,
  screensCodeTab,
  selectedHotspotId,
  onSelectHotspot,
  isSelectingElement,
  computedHotspots,
  screenIds,
  projectDir,
  onHotspotsChange,
  onRetry,
}: ScreensIframePreviewProps) {
  const darkPreview = useProjectSettingsStore((s) => s.ps.darkPreview);
  if (runnerStatus === "error") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 p-4 h-full text-center">
        <AlertCircle size={24} className="text-destructive" />
        <p className="text-xs font-medium text-destructive">Preview Error</p>
        <p className="text-[10px] text-muted-foreground max-w-full line-clamp-3">
          {runnerError || "Failed to start dev server"}
        </p>
        <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (runnerStatus === "starting") {
    return (
      <div className="flex flex-col items-center justify-center gap-2 h-full">
        <Loader2 size={20} className="animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Starting preview…</p>
      </div>
    );
  }

  if (runnerStatus === "running" && runnerUrl) {
    const base = runnerUrl.replace(/\/$/, "");
    const src = screenId ? `${base}/${screenId}?dark=${darkPreview}` : `${base}?dark=${darkPreview}`;
    return (
      <div className="relative w-full h-full overflow-hidden">
        <iframe
          ref={iframeRef}
          key={`screen-${darkPreview}`}
          src={src}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
          onLoad={() => {
            const iframe = iframeRef.current;
            if (!iframe?.contentWindow) return;
            const payload = hotspotsRef.current.map((h) => ({ id: h.id, portId: h.id, selector: h.selector }));
            iframe.contentWindow.postMessage({ type: "__set-hotspots", hotspots: payload }, "*");
          }}
        />
        {screensCodeTab === "links" && (
          <HotspotOverlay
            hotspots={hotspots}
            selectedHotspotId={selectedHotspotId}
            onSelectHotspot={onSelectHotspot}
            isSelectingElement={isSelectingElement}
            computedHotspots={computedHotspots}
            screenIds={screenIds}
            projectDir={projectDir}
            iframeRef={iframeRef}
            onHotspotsChange={onHotspotsChange}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center text-muted-foreground text-sm">
      Generated screens will preview here
    </div>
  );
}
