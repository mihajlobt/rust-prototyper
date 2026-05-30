import { useState, useCallback, useEffect, useRef } from "react";
import { Allotment } from "allotment";
import { Image, Power, PowerOff, Loader2, RefreshCw, AlertCircle, Clock, X, Terminal, LayoutList, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { XTerminal, type XTerminalHandle } from "@/components/XTerminal";
import { useBonsai } from "@/hooks/useBonsai";
import { toFileUrl } from "@/lib/ipc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { BonsaiConfigPopover } from "@/panels/assets/BonsaiConfigPopover";
import { AssetGrid, type AssetViewMode } from "@/panels/assets/AssetGrid";
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
  const [prompt, setPrompt] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [steps, setSteps] = useState(4);
  const [seed, setSeed] = useState(0);
  const [previewIndex, setPreviewIndex] = useState<number | undefined>(undefined);
  const [showLog, setShowLog] = useState(true);
  const [viewMode, setViewMode] = useState<AssetViewMode>("list");
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

  const handleDelete = useCallback(async (fileName: string) => {
    await bonsai.deleteAsset(fileName);
    if (previewIndex !== undefined) {
      const deletedIndex = bonsai.assets.findIndex((a) => a.file_name === fileName);
      if (deletedIndex === previewIndex) {
        setPreviewIndex(undefined);
      }
    }
  }, [bonsai, previewIndex]);

  const handleSelectAsset = useCallback((index: number) => {
    setPreviewIndex(index);
  }, []);

  const assetUrl = (filePath: string) => {
    return toFileUrl(filePath);
  };

  const lastResultIndex = bonsai.lastResult
    ? bonsai.assets.findIndex((a) => a.file_name === bonsai.lastResult!.file_name)
    : -1;

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="panel-toolbar px-3 py-2 border-b border-border flex items-center gap-2">
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
            variant={bonsai.stopScheduled ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
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
        {bonsai.assets.length > 0 && (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setViewMode(viewMode === "list" ? "grid" : "list")}
              title={viewMode === "list" ? "Gallery view" : "List view"}
            >
              {viewMode === "list" ? <LayoutGrid size={14} /> : <LayoutList size={14} />}
            </Button>
            <Button variant="ghost" size="sm" onClick={bonsai.refreshAssets} title="Refresh assets">
              <RefreshCw size={14} />
            </Button>
          </>
        )}
        <Button variant={showLog ? "secondary" : "ghost"} size="sm" onClick={() => setShowLog(!showLog)} title="Toggle server log">
          <Terminal size={14} />
        </Button>
      </div>

      {/* Error display */}
      {bonsai.error && (
        <div className="px-3 py-2 text-sm text-destructive bg-destructive/10 border-b border-border flex items-start gap-2">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span className="flex-1">{bonsai.error}</span>
          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={bonsai.clearError}>
            <X size={12} />
          </Button>
        </div>
      )}

      {/* Main content area with split: controls + log */}
      <div className="flex-1 overflow-hidden">
        <Allotment defaultSizes={[60, 40]} minSize={120}>
          {/* Left pane: generation form + assets */}
          <Allotment.Pane>
            <div className="h-full flex flex-col overflow-hidden">
              {/* Generation controls — compact strip */}
              <div className="shrink-0 border-b border-border">
                {/* Prompt row with generate action */}
                <div className="flex gap-1.5 px-3 pt-2 pb-1.5">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the image to generate..."
                    className="flex-1 min-h-[56px] max-h-[120px] resize-y rounded-sm border border-input bg-background px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    disabled={!isRunning}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleGenerate();
                      }
                    }}
                  />
                  <Button
                    className="shrink-0 self-end"
                    size="sm"
                    onClick={handleGenerate}
                    disabled={!isRunning || bonsai.generating || !prompt.trim()}
                  >
                    {bonsai.generating ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Image size={14} />
                    )}
                  </Button>
                </div>

                {/* Size presets row */}
                <div className="flex flex-wrap gap-1 px-3 pb-1.5">
                  {SIZE_PRESETS.map((presetItem, i) => (
                    <Button
                      key={presetItem.label}
                      variant={selectedPreset === i ? "default" : "outline"}
                      size="sm"
                      onClick={() => setSelectedPreset(i)}
                      className="text-[10px] font-mono h-6 px-1.5"
                      disabled={!isRunning}
                    >
                      {presetItem.label}
                    </Button>
                  ))}
                </div>

                {/* Params row: steps + seed */}
                <div className="flex items-center gap-3 px-3 pb-2">
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">steps</span>
                  <Slider
                    value={[steps]}
                    onValueChange={([value]) => setSteps(value)}
                    min={1}
                    max={20}
                    step={1}
                    className="w-24"
                    disabled={!isRunning}
                  />
                  <span className="text-[10px] font-mono text-muted-foreground w-3 text-right">{steps}</span>
                  <span className="text-border">|</span>
                  <span className="text-[10px] font-mono text-muted-foreground shrink-0">seed</span>
                  <input
                    type="number"
                    value={seed}
                    onChange={(e) => setSeed(Number(e.target.value))}
                    className="w-16 h-6 rounded-sm border border-input bg-background px-1.5 text-[10px] font-mono focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                    disabled={!isRunning}
                    min={0}
                  />
                </div>
              </div>

              {/* Last result preview */}
              {bonsai.lastResult && lastResultIndex >= 0 && (
                <div className="px-3 py-2 border-b border-border shrink-0">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Last</span>
                    <span className="font-mono text-[10px] text-muted-foreground">{bonsai.lastResult.width}×{bonsai.lastResult.height}</span>
                    <span className="font-mono text-[10px] text-muted-foreground">seed:{bonsai.lastResult.seed}</span>
                  </div>
                  <div
                    className="relative rounded-sm overflow-hidden cursor-pointer border border-border hover:border-primary/50 transition-colors"
                    onClick={() => setPreviewIndex(lastResultIndex)}
                  >
                    <img
                      src={assetUrl(bonsai.lastResult.file_path)}
                      alt={bonsai.lastResult.file_name}
                      className="w-full h-auto max-h-48 object-contain bg-muted/30"
                    />
                  </div>
                </div>
              )}

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
                  <AssetGrid
                    assets={bonsai.assets}
                    selectedIndex={previewIndex}
                    onSelect={handleSelectAsset}
                    onDelete={handleDelete}
                    assetUrl={assetUrl}
                    viewMode={viewMode}
                  />
                )}
              </div>
            </div>
          </Allotment.Pane>

          {/* Right pane: Bonsai server log */}
          <Allotment.Pane visible={showLog} preferredSize={40} minSize={120}>
            <div className="h-full flex flex-col">
              <div className="panel-toolbar px-3 py-1.5 border-b border-border flex items-center gap-2 shrink-0">
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
        assets={bonsai.assets}
        assetUrl={assetUrl}
        onDelete={handleDelete}
      />
    </div>
  );
}