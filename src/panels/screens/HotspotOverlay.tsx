import { ArrowRight, Trash2 } from "lucide-react";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { removeHotspot, syncGeneratedRouter, type Hotspot } from "@/lib/navigation";
import type { RefObject } from "react";

interface HotspotOverlayProps {
  hotspots: Hotspot[];
  selectedHotspotId: string | null;
  onSelectHotspot: (id: string | null) => void;
  isSelectingElement: boolean;
  computedHotspots: Record<string, { x: number; y: number; w: number; h: number }>;
  screenIds: string[];
  projectDir: string;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  onHotspotsChange: (hotspots: Hotspot[]) => void;
}

export function HotspotOverlay({
  hotspots,
  selectedHotspotId,
  onSelectHotspot,
  isSelectingElement,
  computedHotspots,
  screenIds,
  projectDir,
  iframeRef,
  onHotspotsChange,
}: HotspotOverlayProps) {
  const iframeWidth = iframeRef.current?.clientWidth ?? 0;

  return (
    <>
      {selectedHotspotId && !isSelectingElement && (
        <div className="absolute inset-0 z-10" onClick={() => onSelectHotspot(null)} />
      )}
      {hotspots.map((hotspot) => {
        const isSelected = selectedHotspotId === hotspot.id;
        const targetName = hotspot.targetScreenId
          ? (screenIds.find((id) => id === hotspot.targetScreenId) ?? hotspot.targetScreenId)
              .replace(/-/g, " ")
              .replace(/\b\w/g, (c) => c.toUpperCase())
          : null;
        const rect = computedHotspots[hotspot.id] ?? hotspot.rect;
        const popoverFlipLeft = iframeWidth > 0 && rect.x + rect.w + 170 > iframeWidth;

        return (
          <div
            key={hotspot.id}
            className="absolute z-20 group"
            style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
          >
            <div
              className="absolute inset-0 cursor-pointer rounded-sm transition-all"
              style={{
                border: `2px solid ${isSelected ? "oklch(0.85 0.2 195)" : "oklch(0.7 0.18 195)"}`,
                background: isSelected ? "oklch(0.7 0.18 195 / 0.3)" : "oklch(0.7 0.18 195 / 0.15)",
              }}
              onClick={(e) => { e.stopPropagation(); onSelectHotspot(isSelected ? null : hotspot.id); }}
            />

            {isSelected && (
              <div
                className="absolute z-30 bg-card border border-border rounded-md shadow-lg p-2 flex flex-col gap-1.5 min-w-[140px] text-[10px]"
                style={popoverFlipLeft ? { right: rect.w + 6, top: 0 } : { left: rect.w + 6, top: 0 }}
                onClick={(e) => e.stopPropagation()}
              >
                <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border pb-1">
                  {hotspot.name ?? hotspot.selector.split(" > ").pop() ?? "Hotspot"}
                </div>

                {targetName && (
                  <button
                    className="flex items-center gap-1 text-foreground/80 hover:text-foreground transition-colors"
                    onClick={() => useProjectSettingsStore.getState().setProjectSettings({ activeScreen: hotspot.targetScreenId })}
                    title="Go to target screen"
                  >
                    <ArrowRight size={9} className="text-cyan-400 shrink-0" />
                    <span className="truncate">{targetName}</span>
                  </button>
                )}

                <div className="text-[8px] text-muted-foreground font-mono truncate" title={hotspot.selector}>
                  {hotspot.selector.split(" > ").pop()}
                </div>

                <button
                  className="flex items-center gap-1 text-destructive hover:text-destructive/80 transition-colors mt-0.5 border-t border-border pt-1"
                  onClick={() => {
                    removeHotspot(projectDir, hotspot.id).then(() => {
                      onHotspotsChange(hotspots.filter((hs) => hs.id !== hotspot.id));
                      onSelectHotspot(null);
                      void syncGeneratedRouter(projectDir);
                      window.dispatchEvent(new Event("navigation-changed"));
                    });
                  }}
                >
                  <Trash2 size={9} />
                  <span>Delete hotspot</span>
                </button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}
