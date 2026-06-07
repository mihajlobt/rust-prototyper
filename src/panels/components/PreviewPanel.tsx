import { AlertCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import type { RefObject } from "react";

interface ComponentsPreviewProps {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  selectedComponent: string | null;
  onRetry: () => void;
}

/** Iframe + status/error/loading/idle states for the components runner preview. */
export function ComponentsPreview({ iframeRef, selectedComponent, onRetry }: ComponentsPreviewProps) {
  const { runnerStatus, runnerUrl, runnerError } = useDevServerStore();
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
    if (!selectedComponent) {
      return (
        <div className="flex items-center justify-center text-muted-foreground text-sm h-full">
          Select a component to preview
        </div>
      );
    }
    const base = runnerUrl.replace(/\/$/, "");
    const src = `${base}/__preview/${selectedComponent}?dark=${darkPreview}`;
    return (
      <iframe
        key={`comp-${darkPreview}`}
        ref={iframeRef}
        src={src}
        className="w-full h-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    );
  }

  // idle or no URL yet
  return (
    <div className="flex items-center justify-center text-muted-foreground text-sm">
      Generated components will preview here
    </div>
  );
}
