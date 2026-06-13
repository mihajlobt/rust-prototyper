// Shared preview toolbar (per plan §6). Lifts the chrome from
// ScreensPreviewToolbar, ThemePreviewToolbar, components/PreviewToolbar, and
// the toolbar half of WizardPreviewPane. The plan's feature inventory says
// PreviewChrome contains: dev server start/stop, current-path label, theme
// picker (createPreviewTheme), dark toggle (darkPreview), device-width
// segmented control (createDevice), zoom in/out (createZoom).
//
// The annotation toggle is Wizard-specific and lives in the headerActions
// slot of the chat panel — it's not a preview-pane concern, so it is not
// mounted here.

import { useState } from "react";
import {
  Loader2,
  Moon,
  Play,
  RefreshCw,
  Smartphone,
  Square,
  Sun,
  Tablet,
  Monitor,
  Minus,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDevServerStore } from "@/lib/dev-server-manager";

export type PreviewDevice = "desktop" | "tablet" | "mobile";
export type PreviewViewMode = "preview" | "gallery";

export interface PreviewThemeEntry {
  /** Slug / folder name under `projects/{p}/themes/`. */
  name: string;
  /** Human-readable label for the picker. */
  label?: string;
}

export interface PreviewChromeProps {
  // Project + dev server
  generatedDir: string;
  // Device + dark mode
  device: PreviewDevice;
  onSetDevice: (device: PreviewDevice) => void;
  darkPreview: boolean;
  onToggleDarkPreview: () => void;
  // Current path label (rendered when runner is running)
  currentPath?: string | null;
  // Refresh button (used by all modes to reload the iframe after model writes)
  onRefresh?: () => void;
  // Zoom (Screens only)
  showZoom?: boolean;
  zoom?: number;
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  // View mode (Themes tokens/gallery only)
  showViewMode?: boolean;
  viewMode?: PreviewViewMode;
  onSetViewMode?: (mode: PreviewViewMode) => void;
  // Theme picker (Screens/Components only — the preview-only override on
  // top of the runner's design tokens)
  showThemePicker?: boolean;
  previewTheme?: string;
  themes?: PreviewThemeEntry[];
  onSetPreviewTheme?: (name: string) => void;
}

export function PreviewChrome({
  generatedDir,
  device,
  onSetDevice,
  darkPreview,
  onToggleDarkPreview,
  currentPath,
  onRefresh,
  showZoom,
  zoom = 1,
  onZoomIn,
  onZoomOut,
  showViewMode,
  viewMode = "preview",
  onSetViewMode,
  showThemePicker,
  previewTheme,
  themes = [],
  onSetPreviewTheme,
}: PreviewChromeProps) {
  const { runnerStatus, runnerUrl, runnerError, startRunner, stopRunner } = useDevServerStore();
  // Toggle between the standard preview toolbar and a compact error strip
  // when the runner fails. Keeps the failure state visible without
  // crowding the chrome.
  const [errorExpanded, setErrorExpanded] = useState(false);

  return (
    <div className="panel-toolbar h-10 shrink-0 px-3 gap-2 bg-card">
      <span className="text-sm font-medium">Preview</span>

      {runnerStatus === "running" ? (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={stopRunner}
          title="Stop preview server"
        >
          <Square size={12} />
        </Button>
      ) : runnerStatus === "starting" ? (
        <Button variant="ghost" size="icon" className="h-7 w-7" disabled title="Starting preview…">
          <Loader2 size={12} className="animate-spin" />
        </Button>
      ) : (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={() => { void startRunner(generatedDir); }}
          title="Start preview server"
        >
          <Play size={12} />
        </Button>
      )}

      {currentPath && runnerUrl && (
        <span
          className="text-xs text-muted-foreground font-mono truncate max-w-[200px]"
          title={currentPath}
        >
          {currentPath}
        </span>
      )}

      {runnerStatus === "error" && runnerError && (
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[10px] text-destructive"
          onClick={() => setErrorExpanded((v) => !v)}
        >
          {errorExpanded ? runnerError : "Preview error"}
        </Button>
      )}

      <div className="flex-1" />

      {showThemePicker && onSetPreviewTheme && themes.length > 0 && (
        <Select
          value={previewTheme ?? ""}
          onValueChange={(value) => onSetPreviewTheme(value)}
        >
          <SelectTrigger className="h-6 text-xs w-[110px]">
            <SelectValue placeholder="Theme…" />
          </SelectTrigger>
          <SelectContent position="popper" side="bottom">
            {themes.map((t) => (
              <SelectItem key={t.name} value={t.name}>
                {t.label ?? t.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {showViewMode && onSetViewMode && (
        <ToggleGroup
          type="single"
          value={viewMode}
          onValueChange={(value) => {
            if (value) onSetViewMode(value as PreviewViewMode);
          }}
          spacing={0}
          size="sm"
          variant="outline"
        >
          <ToggleGroupItem value="preview" aria-label="Tokens" title="Tokens">
            Tokens
          </ToggleGroupItem>
          <ToggleGroupItem value="gallery" aria-label="Gallery" title="Gallery">
            Gallery
          </ToggleGroupItem>
        </ToggleGroup>
      )}

      <ToggleGroup
        type="single"
        value={device}
        onValueChange={(value) => {
          if (value) onSetDevice(value as PreviewDevice);
        }}
        spacing={0}
        size="sm"
        variant="outline"
      >
        <ToggleGroupItem value="mobile" aria-label="Mobile (375px)" title="Mobile (375px)">
          <Smartphone size={12} />
        </ToggleGroupItem>
        <ToggleGroupItem value="tablet" aria-label="Tablet (768px)" title="Tablet (768px)">
          <Tablet size={12} />
        </ToggleGroupItem>
        <ToggleGroupItem value="desktop" aria-label="Desktop" title="Desktop (full width)">
          <Monitor size={12} />
        </ToggleGroupItem>
      </ToggleGroup>

      {showZoom && onZoomIn && onZoomOut && (
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onZoomOut}
            title="Zoom out"
          >
            <Minus size={12} />
          </Button>
          <span className="text-xs text-muted-foreground w-10 text-center tabular-nums">
            {Math.round(zoom * 100)}%
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={onZoomIn}
            title="Zoom in"
          >
            <Plus size={12} />
          </Button>
        </div>
      )}

      <Button
        variant={darkPreview ? "secondary" : "ghost"}
        size="icon"
        className="h-7 w-7"
        onClick={onToggleDarkPreview}
        title={darkPreview ? "Light preview" : "Dark preview"}
      >
        {darkPreview ? <Moon size={12} /> : <Sun size={12} />}
      </Button>

      {onRefresh && (
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onRefresh}
          title="Refresh preview"
        >
          <RefreshCw size={12} />
        </Button>
      )}
    </div>
  );
}
