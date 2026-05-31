import { Smartphone, Tablet, Monitor, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";

interface ThemePreviewToolbarProps {
  themesDevice: "mobile" | "tablet" | "desktop";
  themesDarkPreview: boolean;
  onSetDevice: (device: "mobile" | "tablet" | "desktop") => void;
  onToggleDarkPreview: () => void;
}

export function ThemePreviewToolbar({
  themesDevice,
  themesDarkPreview,
  onSetDevice,
  onToggleDarkPreview,
}: ThemePreviewToolbarProps) {
  return (
    <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
      <span className="text-sm font-medium">Preview</span>
      <div className="flex-1" />
      <div className="flex items-center gap-1">
        <Button
          variant={themesDevice === "mobile" ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          onClick={() => onSetDevice("mobile")}
        >
          <Smartphone size={12} />
        </Button>
        <Button
          variant={themesDevice === "tablet" ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          onClick={() => onSetDevice("tablet")}
        >
          <Tablet size={12} />
        </Button>
        <Button
          variant={themesDevice === "desktop" ? "secondary" : "ghost"}
          size="icon"
          className="h-7 w-7"
          onClick={() => onSetDevice("desktop")}
        >
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
