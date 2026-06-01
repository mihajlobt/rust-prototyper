import { Loader2, Moon, Monitor, Play, Smartphone, Square, Sun, Tablet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import type { FileEntry } from "@/lib/ipc";
import type { RefObject } from "react";

interface ScreensPreviewToolbarProps {
  themes: FileEntry[];
  livePreviewPath: string | null;
  initialPreviewSrc: string | undefined;
  iframeRef: RefObject<HTMLIFrameElement | null>;
  stoppedManuallyRef: RefObject<boolean>;
  generatedDir: string;
}

export function ScreensPreviewToolbar({
  themes,
  livePreviewPath,
  initialPreviewSrc,
  iframeRef,
  stoppedManuallyRef,
  generatedDir,
}: ScreensPreviewToolbarProps) {
  const { runnerStatus, runnerUrl, startRunner, stopRunner } = useDevServerStore();
  const { ps, setPs } = useProjectSettingsStore();

  const currentPath = livePreviewPath
    ?? (initialPreviewSrc ? new URL(initialPreviewSrc).pathname : null);

  return (
    <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
      <span className="text-sm font-medium">Preview</span>
      {runnerStatus === "running" ? (
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => { stoppedManuallyRef.current = true; stopRunner(); }}
          title="Stop preview server">
          <Square size={12} />
        </Button>
      ) : runnerStatus === "starting" ? (
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled title="Starting preview…">
          <Loader2 size={12} className="animate-spin" />
        </Button>
      ) : (
        <Button variant="ghost" size="icon" className="h-7 w-7"
          onClick={() => { stoppedManuallyRef.current = false; void startRunner(generatedDir, ps.runnerPort); }}
          title="Start preview server">
          <Play size={12} />
        </Button>
      )}
      {currentPath && runnerUrl && (
        <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]" title={currentPath}>
          {currentPath}
        </span>
      )}
      <div className="flex-1" />
      <Select value={ps.screensPreviewTheme} onValueChange={(v) => setPs({ screensPreviewTheme: v })}>
        <SelectTrigger className="h-6 text-xs w-[90px]">
          <SelectValue placeholder="Theme…" />
        </SelectTrigger>
        <SelectContent position="popper" side="bottom">
          {themes.map((t) => (
            <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <div className="w-px h-4 bg-border" />
      <Button
        variant={ps.screensDarkPreview ? "secondary" : "ghost"}
        size="icon" className="h-7 w-7"
        onClick={() => {
          setPs({ screensDarkPreview: !ps.screensDarkPreview });
          iframeRef.current?.contentWindow?.postMessage({ type: "set-dark", value: !ps.screensDarkPreview }, "*");
        }}
        title={ps.screensDarkPreview ? "Light preview" : "Dark preview"}
      >
        {ps.screensDarkPreview ? <Moon size={12} /> : <Sun size={12} />}
      </Button>
      <div className="w-px h-4 bg-border" />
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon" className="h-7 w-7 text-xs"
          onClick={() => setPs({ screensZoom: Math.max(ps.screensZoom - 0.1, 0.5) })}>-</Button>
        <span className="text-xs text-muted-foreground w-8 text-center">{Math.round(ps.screensZoom * 100)}%</span>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-xs"
          onClick={() => setPs({ screensZoom: Math.min(ps.screensZoom + 0.1, 2) })}>+</Button>
      </div>
      <div className="flex items-center gap-1">
        <Button variant={ps.screensDevice === "mobile" ? "secondary" : "ghost"} size="icon" className="h-7 w-7"
          onClick={() => setPs({ screensDevice: "mobile" })}><Smartphone size={12} /></Button>
        <Button variant={ps.screensDevice === "tablet" ? "secondary" : "ghost"} size="icon" className="h-7 w-7"
          onClick={() => setPs({ screensDevice: "tablet" })}><Tablet size={12} /></Button>
        <Button variant={ps.screensDevice === "desktop" ? "secondary" : "ghost"} size="icon" className="h-7 w-7"
          onClick={() => setPs({ screensDevice: "desktop" })}><Monitor size={12} /></Button>
      </div>
    </div>
  );
}
