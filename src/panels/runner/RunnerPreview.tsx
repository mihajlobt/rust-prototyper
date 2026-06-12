import { useRef } from "react";
import {
  RotateCw, Minus, Plus, Smartphone, Tablet, Monitor, Moon, Sun, Play,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import type { ProjectSettings } from "@/stores/projectSettingsStore";

export interface RunnerPreviewProps {
  devUrl: string | null;
  runnerDevice: ProjectSettings["runnerDevice"];
  runnerZoom: number;
  setProjectSettings: (patch: Partial<ProjectSettings>) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  zoomReset: () => void;
}

const deviceWidth = { desktop: "100%", tablet: "768px", mobile: "375px" } as const;

/** Preview pane: toolbar (refresh / device / dark / zoom) + iframe. */
export function RunnerPreview({
  devUrl,
  runnerDevice,
  runnerZoom,
  setProjectSettings,
  zoomIn,
  zoomOut,
  zoomReset,
}: RunnerPreviewProps) {
  const darkPreview = useProjectSettingsStore((s) => s.ps.darkPreview);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const handleRefreshPreview = () => {
    const el = iframeRef.current;
    if (el) el.src = el.src;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="panel-toolbar h-7 px-2 gap-1 bg-card">
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={handleRefreshPreview} title="Refresh"><RotateCw size={11} /></Button>
        <span className="text-[10px] text-muted-foreground shrink-0">Preview:</span>
        {devUrl ? (
          <span className="text-xs text-muted-foreground font-mono truncate max-w-[180px]" title={devUrl}>
            {devUrl.replace(/\/$/, "").replace(/^http:\/\/localhost:\d+/, "") || "/"}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground font-mono">—</span>
        )}
        <div className="flex items-center gap-0.5 ml-auto shrink-0">
          <Button variant={runnerDevice === "mobile"  ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setProjectSettings({ runnerDevice: "mobile"  })} title="Mobile" ><Smartphone size={11} /></Button>
          <Button variant={runnerDevice === "tablet"  ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setProjectSettings({ runnerDevice: "tablet"  })} title="Tablet" ><Tablet     size={11} /></Button>
          <Button variant={runnerDevice === "desktop" ? "secondary" : "ghost"} size="icon" className="h-5 w-5" onClick={() => setProjectSettings({ runnerDevice: "desktop" })} title="Desktop"><Monitor    size={11} /></Button>
        </div>
        <div className="w-px h-3 bg-border shrink-0" />
        <Button variant={darkPreview ? "secondary" : "ghost"} size="icon" className="h-5 w-5 shrink-0" title={darkPreview ? "Switch to light" : "Switch to dark"} onClick={() => { setProjectSettings({ darkPreview: !darkPreview }); }}>{darkPreview ? <Sun size={11} /> : <Moon size={11} />}</Button>
        <div className="w-px h-3 bg-border shrink-0" />
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={zoomOut}><Minus size={11} /></Button>
        <button className="text-[10px] text-muted-foreground hover:text-foreground cursor-pointer min-w-[32px] text-center select-none shrink-0" onClick={zoomReset}>{Math.round(runnerZoom * 100)}%</button>
        <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={zoomIn}><Plus size={11} /></Button>
      </div>
      <div className="flex-1 overflow-auto p-2 bg-muted/30 flex justify-center">
        {devUrl ? (
          <div className="h-full bg-background shadow-lg border border-border overflow-hidden" style={{ width: deviceWidth[runnerDevice], transform: `scale(${runnerZoom})`, transformOrigin: "top center" }}>
            <iframe ref={iframeRef} key={`runner-${darkPreview}`} src={`${devUrl.replace(/\/$/, "")}?dark=${darkPreview}`} className="w-full h-full" sandbox="allow-scripts allow-same-origin allow-forms" />
          </div>
        ) : (
          <div className="flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center">
              <Play size={32} className="mx-auto mb-3 opacity-30" />
              <p>Click Run to start the dev server</p>
              <p className="text-xs opacity-50 mt-1">Preview will appear here</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
