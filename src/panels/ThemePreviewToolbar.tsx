import { Smartphone, Tablet, Monitor, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ThemePreviewToolbarProps {
  themesDevice: "mobile" | "tablet" | "desktop";
  themesDarkPreview: boolean;
  viewMode: "preview" | "gallery";
  onSetDevice: (device: "mobile" | "tablet" | "desktop") => void;
  onToggleDarkPreview: () => void;
  onSetViewMode: (mode: "preview" | "gallery") => void;
}

export function ThemePreviewToolbar({
  themesDevice,
  themesDarkPreview,
  viewMode,
  onSetDevice,
  onToggleDarkPreview,
  onSetViewMode,
}: ThemePreviewToolbarProps) {
  return (
    <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
      <span className="text-sm font-medium">Preview</span>

      {/* View mode segmented control */}
      <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5 ml-1">
        <button
          onClick={() => onSetViewMode("preview")}
          className={cn(
            "px-2 py-0.5 text-[11px] rounded transition-colors",
            viewMode === "preview"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Tokens
        </button>
        <button
          onClick={() => onSetViewMode("gallery")}
          className={cn(
            "px-2 py-0.5 text-[11px] rounded transition-colors",
            viewMode === "gallery"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          Gallery
        </button>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1">
        <Button variant={themesDevice === "mobile" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => onSetDevice("mobile")}>
          <Smartphone size={12} />
        </Button>
        <Button variant={themesDevice === "tablet" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => onSetDevice("tablet")}>
          <Tablet size={12} />
        </Button>
        <Button variant={themesDevice === "desktop" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => onSetDevice("desktop")}>
          <Monitor size={12} />
        </Button>
      </div>
      <div className="w-px h-4 bg-border mx-1" />
      <Button
        variant={themesDarkPreview ? "secondary" : "ghost"}
        size="icon"
        className="h-7 w-7"
        onClick={onToggleDarkPreview}
        title={themesDarkPreview ? "Light preview" : "Dark preview"}
      >
        {themesDarkPreview ? <Moon size={12} /> : <Sun size={12} />}
      </Button>
    </div>
  );
}
