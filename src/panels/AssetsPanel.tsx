import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Allotment } from "allotment";
import { Image, Power, PowerOff, Loader2, RefreshCw, AlertCircle, Clock, X, Terminal, LayoutList, LayoutGrid, SendHorizonal, Dice3, Square, ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { XTerminal, type XTerminalHandle } from "@/components/XTerminal";
import { useBonsai } from "@/hooks/useBonsai";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { toFileUrl } from "@/lib/ipc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { BonsaiConfigPopover } from "@/panels/assets/BonsaiConfigPopover";
import { AssetGrid } from "@/panels/assets/AssetGrid";
import { AssetPreviewLightbox } from "@/panels/assets/AssetPreviewLightbox";

interface BonsaiLogEvent {
  line: string;
  source: "stdout" | "stderr" | "system";
}

// Per Bonsai-Image-Demo README — dimensions must be multiples of 32
const SIZE_PRESETS = [
  { label: "512²", width: 512, height: 512 },
  { label: "1024²", width: 1024, height: 1024 },
  { label: "624×416", width: 624, height: 416 },
  { label: "1248×832", width: 1248, height: 832 },
  { label: "416×624", width: 416, height: 624 },
  { label: "832×1248", width: 832, height: 1248 },
  { label: "704×352", width: 704, height: 352 },
  { label: "1408×704", width: 1408, height: 704 },
  { label: "352×704", width: 352, height: 704 },
  { label: "704×1408", width: 704, height: 1408 },
];

export function AssetsPanel() {
  const bonsai = useBonsai();
  const ps = useProjectSettingsStore((s) => s.ps);
  const setPs = useProjectSettingsStore((s) => s.setPs);
  const { ref: allotmentRef, onDragEnd, defaultSizes } = useAllotmentLayout("assets", 2, [true, ps.assetsShowLog]);
  const [prompt, setPrompt] = useState("");
  const selectedPreset = ps.assetsPreset;
  const steps = ps.assetsSteps;
  const [seed, setSeed] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | undefined>(undefined);
  const xtermRef = useRef<XTerminalHandle>(null);

  const preset = SIZE_PRESETS[selectedPreset];
  const isRunning = bonsai.serverStatus?.healthy ?? false;

  useEffect(() => {
    let cancelled = false;
    let unlistenFn: UnlistenFn | null = null;
    listen<BonsaiLogEvent>("bonsai:log", (event) => {
      const { line, source } = event.payload;
      const color = source === "stderr" ? "\x1b[31m" : source === "system" ? "\x1b[36m" : "";
      xtermRef.current?.writeln(`${color}${line}\x1b[0m`);
    }).then((fn) => {
      if (!cancelled) {
        unlistenFn = fn;
      } else {
        fn();
      }
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  const handleStart = useCallback(async () => {
    xtermRef.current?.clear();
    if (isRunning) {
      await bonsai.stopServer();
    } else {
      await bonsai.startServer();
    }
  }, [isRunning, bonsai]);

  const handleGenerate = useCallback(async () => {
    if (!prompt.trim()) return;
    await bonsai.generateImage(prompt.trim(), {
      width: preset.width,
      height: preset.height,
      steps,
      seed: seed === 0 ? undefined : seed,
    });
  }, [prompt, preset, steps, seed, bonsai]);

  const assetUrl = (filePath: string) => {
    return toFileUrl(filePath);
  };

  // Track which asset was just generated so we can highlight it in the gallery.
  // Clears after the highlight animation plays so it doesn't re-trigger on re-renders.
  const [highlightFileName, setHighlightFileName] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (bonsai.lastResult?.file_name) {
      setHighlightFileName(bonsai.lastResult.file_name);
      const timer = setTimeout(() => setHighlightFileName(undefined), 2000);
      return () => clearTimeout(timer);
    }
  }, [bonsai.lastResult?.file_name]);

  const sortedAssets = useMemo(() => {
    const assets = [...bonsai.assets];
    switch (ps.assetsSortOrder) {
      case "oldest": return assets.sort((a, b) => a.created_at - b.created_at);
      case "largest": return assets.sort((a, b) => b.file_size - a.file_size);
      case "smallest": return assets.sort((a, b) => a.file_size - b.file_size);
      case "name": return assets.sort((a, b) => a.file_name.localeCompare(b.file_name));
      case "newest":
      default: return assets.sort((a, b) => b.created_at - a.created_at);
    }
  }, [bonsai.assets, ps.assetsSortOrder]);

  const handleDelete = useCallback(async (fileName: string) => {
    await bonsai.deleteAsset(fileName);
    if (previewIndex !== undefined) {
      const deletedIndex = sortedAssets.findIndex((a) => a.file_name === fileName);
      if (deletedIndex === previewIndex) {
        setPreviewIndex(undefined);
      }
    }
  }, [bonsai, previewIndex, sortedAssets]);

  const handleSelectAsset = useCallback((index: number) => {
    setPreviewIndex(index);
  }, []);

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="panel-toolbar px-3 py-2 gap-2">
        <Image size={16} className="text-muted-foreground" />
        <span className="text-sm font-medium">Assets</span>
        {isRunning && (
          <>
            <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
            {bonsai.serverStatus?.default_family && (
              <span className="text-xs text-muted-foreground truncate max-w-[160px]">
                {bonsai.serverStatus.default_family}
              </span>
            )}
          </>
        )}
        <div className="flex-1" />
        {isRunning && (
          <Button
            variant="outline"
            size="sm"
            className={bonsai.stopScheduled ? "h-7 text-xs gap-1 border-status-paused text-status-paused hover:bg-status-paused/10" : "h-7 text-xs gap-1"}
            onClick={bonsai.stopScheduled ? bonsai.cancelStop : bonsai.scheduleStop}
            title={bonsai.stopScheduled ? "Cancel auto-stop" : "Auto-stop server"}
          >
            <Clock size={12} />
            {bonsai.stopScheduled ? "Cancel" : "Auto-stop"}
          </Button>
        )}
        <BonsaiConfigPopover />
        <Button
          variant={isRunning ? "destructive" : "default"}
          size="sm"
          onClick={handleStart}
          disabled={bonsai.loading}
        >
          {bonsai.loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : isRunning ? (
            <><PowerOff size={14} className="mr-1" />Stop</>
          ) : (
            <><Power size={14} className="mr-1" />Start</>
          )}
        </Button>
        <Button variant={ps.assetsShowLog ? "secondary" : "ghost"} size="sm" onClick={() => setPs({ assetsShowLog: !ps.assetsShowLog })} title="Toggle server log">
          <Terminal size={14} />
        </Button>
      </div>

      {/* Error display */}
      {bonsai.error && (
        <div className="px-3 py-2 text-sm text-destructive bg-destructive/10 border-b flex gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{bonsai.error}</span>
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={bonsai.clearError}>
            <X size={12} />
          </Button>
        </div>
      )}

      {/* Main content area with split: controls + log */}
      <div className="flex-1 overflow-hidden">
        <Allotment ref={allotmentRef} onDragEnd={onDragEnd} defaultSizes={defaultSizes} onVisibleChange={(_i, v) => setPs({ assetsShowLog: v })} minSize={120}>
          {/* Left pane: generation form + assets */}
          <Allotment.Pane>
            <div className="h-full flex flex-col overflow-hidden">
              {/* Generation controls — compact strip */}
              <div className="shrink-0 border-b border-border">
                {/* Prompt row with generate action */}
                <div className="flex gap-1.5 px-3 pt-2 pb-1.5 font-mono text-sm">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the image to generate..."
                    className="flex-1 min-h-[56px] resize-y border bg-background p-2 focus:ring-ring disabled:opacity-50"
                    disabled={!isRunning}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleGenerate();
                      }
                    }}
                  />
                  {bonsai.generating ? (
                    <Button
                      className="self-stretch min-h-[56px] w-12 rounded-sm bg-gradient-to-b from-destructive to-destructive/80"
                      onClick={() => bonsai.cancelGeneration()}
                      title="Stop generation"
                    >
                      <Square size={18} fill="currentColor" />
                    </Button>
                  ) : (
                    <Button
                      className="self-stretch min-h-[56px] w-12 rounded-sm bg-gradient-to-b from-primary to-primary/80"
                      onClick={handleGenerate}
                      disabled={!isRunning || !prompt.trim()}
                      title="Generate (Ctrl+Enter)"
                    >
                      <SendHorizonal size={18} />
                    </Button>
                  )}
                </div>

                {/* Size presets row */}
                <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                  {SIZE_PRESETS.map((presetItem, i) => (
                    <Button
                      key={presetItem.label}
                      variant={selectedPreset === i ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPs({ assetsPreset: i })}
                      className="text-[10px] font-mono h-6 px-1.5"
                      disabled={!isRunning}
                    >
                      {presetItem.label}
                    </Button>
                  ))}
                </div>

                {/* Params row: steps + seed */}
                <div className="flex gap-3 px-3 pb-2 font-mono text-[10px] text-muted-foreground">
                  <span className="shrink-0">steps</span>
                  <Slider
                    value={[steps]}
                    onValueChange={([value]) => setPs({ assetsSteps: value })}
                    min={1}
                    max={20}
                    step={1}
                    className="w-24"
                    disabled={!isRunning}
                  />
                  <span className="w-3 text-right">{steps}</span>
                  <span className="text-border">|</span>
                  <span className="shrink-0">seed</span>
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                    className="w-16 h-6 rounded-sm border border-input bg-background px-1.5"
                    disabled={!isRunning}
                    min={0}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 shrink-0"
                    onClick={() => setSeed(Math.floor(Math.random() * 2147483647) + 1)}
                    disabled={!isRunning}
                    title="Randomize seed"
                  >
                    <Dice3 className="h-3 w-3" />
                  </Button>
                </div>
              </div>

              {/* Assets grid */}
              <div className="flex-1 overflow-auto">
                {bonsai.assets.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                    <Image size={32} className="opacity-50" />
                    <span className="text-sm">
                      {isRunning ? "Generate your first image above." : "No images yet. Start the server to generate."}
                    </span>
                  </div>
                ) : (
                  <>
                    <div className="sticky top-0 z-10 flex justify-end items-center gap-1 px-2 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => setPs({ assetsViewMode: ps.assetsViewMode === "list" ? "grid" : "list" })}
                        title={ps.assetsViewMode === "list" ? "Gallery view" : "List view"}
                      >
                        {ps.assetsViewMode === "list" ? <LayoutGrid size={13} /> : <LayoutList size={13} />}
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6" onClick={bonsai.refreshAssets} title="Refresh assets">
                        <RefreshCw size={13} />
                      </Button>
                      <Select value={ps.assetsSortOrder} onValueChange={(v) => setPs({ assetsSortOrder: v as typeof ps.assetsSortOrder })}>
                        <SelectTrigger className="h-6 w-auto gap-1 border-none shadow-sm text-[10px] font-mono px-1.5 [&>svg]:hidden hover:bg-muted">
                          <ArrowDownUp size={11} className="shrink-0" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="newest">Newest first</SelectItem>
                          <SelectItem value="oldest">Oldest first</SelectItem>
                          <SelectItem value="largest">Largest first</SelectItem>
                          <SelectItem value="smallest">Smallest first</SelectItem>
                          <SelectItem value="name">Name A–Z</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <AssetGrid
                      assets={sortedAssets}
                      selectedIndex={previewIndex}
                      onSelect={handleSelectAsset}
                      onDelete={handleDelete}
                      assetUrl={assetUrl}
                      viewMode={ps.assetsViewMode}
                      highlightFileName={highlightFileName}
                    />
                  </>
                )}
              </div>
            </div>
          </Allotment.Pane>

          {/* Right pane: Bonsai server log */}
          <Allotment.Pane visible={ps.assetsShowLog} preferredSize={40} minSize={120}>
            <div className="h-full flex flex-col">
              <div className="panel-toolbar px-3 py-1.5 gap-2">
                <Terminal size={12} className="text-muted-foreground" />
                <span className="text-[10px] font-medium text-muted-foreground">Server Log</span>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" className="h-5 text-[10px]" onClick={() => xtermRef.current?.clear()}>
                  Clear
                </Button>
              </div>
              <div className="flex-1 overflow-hidden">
                <XTerminal ref={xtermRef} />
              </div>
            </div>
          </Allotment.Pane>
        </Allotment>
      </div>

      {/* Lightbox overlay — portal, outside Allotment */}
      <AssetPreviewLightbox
        previewIndex={previewIndex}
        setPreviewIndex={setPreviewIndex}
        assets={sortedAssets}
        assetUrl={assetUrl}
        onDelete={handleDelete}
      />
    </div>
  );
}