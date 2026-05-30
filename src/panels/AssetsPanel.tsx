import { useState, useCallback, useEffect, useRef } from "react";
import { Allotment } from "allotment";
import { Image, Power, PowerOff, Loader2, RefreshCw, Settings2, AlertCircle, Clock, X, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { XTerminal, type XTerminalHandle } from "@/components/XTerminal";
import { useBonsai } from "@/hooks/useBonsai";
import { toFileUrl } from "@/lib/ipc";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { BonsaiConfigSection } from "@/panels/assets/BonsaiConfigSection";
import { AssetGrid } from "@/panels/assets/AssetGrid";
import { AssetPreviewLightbox } from "@/panels/assets/AssetPreviewLightbox";

interface BonsaiLogEvent {
  line: string;
  source: "stdout" | "stderr" | "system";
}

const SIZE_PRESETS = [
  { label: "512²", width: 512, height: 512 },
  { label: "768×512", width: 768, height: 512 },
  { label: "512×768", width: 512, height: 768 },
  { label: "1024×768", width: 1024, height: 768 },
];

export function AssetsPanel() {
  const bonsai = useBonsai();
  const [prompt, setPrompt] = useState("");
  const [selectedPreset, setSelectedPreset] = useState(0);
  const [steps, setSteps] = useState(4);
  const [showConfig, setShowConfig] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | undefined>(undefined);
  const xtermRef = useRef<XTerminalHandle>(null);

  const preset = SIZE_PRESETS[selectedPreset];
  const isRunning = bonsai.serverStatus?.healthy ?? false;

  const listenerRegisteredRef = useRef(false);
  // xtermRef is stable — guard prevents double-mount, ref.current is always valid
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (listenerRegisteredRef.current) return;
    listenerRegisteredRef.current = true;
    let unlisten: UnlistenFn | null = null;
    listen<BonsaiLogEvent>("bonsai:log", (event) => {
      const { line, source } = event.payload;
      const color = source === "stderr" ? "\x1b[31m" : source === "system" ? "\x1b[36m" : "";
      xtermRef.current?.writeln(`${color}${line}\x1b[0m`);
    }).then((fn) => { unlisten = fn; });
    return () => {
      unlisten?.();
      listenerRegisteredRef.current = false;
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
    });
  }, [prompt, preset, steps, bonsai]);

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
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => setShowConfig(!showConfig)} title="Server settings">
          <Settings2 size={14} />
        </Button>
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
          <Button variant="ghost" size="sm" onClick={bonsai.refreshAssets} title="Refresh assets">
            <RefreshCw size={14} />
          </Button>
        )}
      </div>

      {/* Server status */}
      {isRunning && bonsai.serverStatus && (
        <div className="px-3 py-1.5 text-xs text-muted-foreground border-b border-border bg-muted/30 flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 shrink-0" />
          <span>Bonsai server running</span>
          {bonsai.serverStatus.supported_families.length > 0 && (
            <span className="ml-auto truncate">
              {bonsai.serverStatus.supported_families.join(", ")}
            </span>
          )}
        </div>
      )}

      {/* Auto-stop indicator */}
      {bonsai.stopScheduled && (
        <div className="px-3 py-1.5 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border-b border-border flex items-center gap-2">
          <Clock size={12} />
          <span className="flex-1">Auto-stop scheduled</span>
          <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={bonsai.cancelStop}>
            Cancel
          </Button>
        </div>
      )}

      {/* Config section */}
      {showConfig && <BonsaiConfigSection />}

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
              {/* Generation form */}
              {isRunning && (
                <div className="px-3 py-3 border-b border-border space-y-3 shrink-0">
                  <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Describe the image you want to generate..."
                    className="w-full min-h-[80px] resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleGenerate();
                      }
                    }}
                  />
                  <div className="flex gap-2">
                    {SIZE_PRESETS.map((presetItem, i) => (
                      <Button
                        key={presetItem.label}
                        variant={selectedPreset === i ? "default" : "outline"}
                        size="sm"
                        onClick={() => setSelectedPreset(i)}
                        className="text-xs"
                      >
                        {presetItem.label}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-14">Steps</span>
                    <Slider
                      value={[steps]}
                      onValueChange={([value]) => setSteps(value)}
                      min={1}
                      max={20}
                      step={1}
                      className="flex-1"
                    />
                    <span className="text-xs text-muted-foreground w-6 text-right">{steps}</span>
                  </div>
                  <Button
                    className="w-full"
                    onClick={handleGenerate}
                    disabled={bonsai.generating || !prompt.trim()}
                  >
                    {bonsai.generating ? (
                      <><Loader2 size={14} className="animate-spin mr-2" />Generating...</>
                    ) : (
                      <><Image size={14} className="mr-2" />Generate</>
                    )}
                  </Button>
                </div>
              )}

              {/* Last result preview */}
              {bonsai.lastResult && lastResultIndex >= 0 && (
                <div className="px-3 py-2 border-b border-border shrink-0">
                  <div className="text-xs font-medium text-muted-foreground mb-1.5">Last Generated</div>
                  <div
                    className="relative rounded-md overflow-hidden cursor-pointer border border-border hover:border-primary/50 transition-colors"
                    onClick={() => setPreviewIndex(lastResultIndex)}
                  >
                    <img
                      src={assetUrl(bonsai.lastResult.file_path)}
                      alt={bonsai.lastResult.file_name}
                      className="w-full h-auto max-h-48 object-contain bg-muted/30"
                    />
                  </div>
                  <div className="text-xs text-muted-foreground mt-1.5">
                    {bonsai.lastResult.width}×{bonsai.lastResult.height} — seed: {bonsai.lastResult.seed}
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
                  />
                )}
              </div>

              {/* Auto-stop controls */}
              {isRunning && !bonsai.stopScheduled && (
                <div className="px-3 py-1.5 border-t border-border text-xs text-muted-foreground shrink-0">
                  <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={bonsai.scheduleStop}>
                    <Clock size={10} className="mr-1" />Auto-stop
                  </Button>
                </div>
              )}
            </div>
          </Allotment.Pane>

          {/* Right pane: Bonsai server log */}
          <Allotment.Pane>
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
      />
    </div>
  );
}