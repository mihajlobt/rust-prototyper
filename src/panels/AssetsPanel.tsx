import { useState, useCallback } from "react";
import { Image, Power, PowerOff, Trash2, Loader2, RefreshCw, Settings2, AlertCircle, Clock, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Slider } from "@/components/ui/slider";
import { useBonsai } from "@/hooks/useBonsai";
import { toFileUrl } from "@/lib/ipc";
import { BonsaiConfigSection } from "@/panels/assets/BonsaiConfigSection";

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
  const [selectedAsset, setSelectedAsset] = useState<string | null>(null);

  const preset = SIZE_PRESETS[selectedPreset];
  const isRunning = bonsai.serverStatus?.healthy ?? false;

  const handleStart = useCallback(async () => {
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
    if (selectedAsset === fileName) {
      setSelectedAsset(null);
    }
  }, [bonsai, selectedAsset]);

  const selectedAssetData = bonsai.assets.find((a) => a.file_name === selectedAsset);
  const assetUrl = (relativePath: string) => {
    // Convert relative path to file URL using the Tauri asset protocol
    // The relative_path is relative to the app data dir, so we need to resolve it
    const appDataPrefix = `projects/${bonsai.projectId}/assets/`;
    return toFileUrl(relativePath.startsWith(appDataPrefix) ? relativePath : appDataPrefix + relativePath);
  };

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
        {isRunning && (
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
          <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={() => setShowConfig(true)}>
            <Settings2 size={10} />
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

      {/* Generation form */}
      {isRunning && (
        <div className="px-3 py-3 border-b border-border space-y-3">
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

          {/* Size preset */}
          <div className="flex gap-2">
            {SIZE_PRESETS.map((p, i) => (
              <Button
                key={p.label}
                variant={selectedPreset === i ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedPreset(i)}
                className="text-xs"
              >
                {p.label}
              </Button>
            ))}
          </div>

          {/* Steps slider */}
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground w-14">Steps</span>
            <Slider
              value={[steps]}
              onValueChange={([v]) => setSteps(v)}
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
      {bonsai.lastResult && !selectedAssetData && (
        <div className="px-3 py-2 border-b border-border">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">Last Generated</div>
          <div
            className="relative rounded-md overflow-hidden cursor-pointer border border-border hover:border-primary/50 transition-colors"
            onClick={() => setSelectedAsset(bonsai.lastResult!.file_name)}
          >
            <img
              src={assetUrl(bonsai.lastResult.relative_path)}
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
      <div className="flex-1 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-3">
            {bonsai.assets.length === 0 && !isRunning && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Image size={32} className="opacity-50" />
                <span className="text-sm">Start the Bonsai server to generate images</span>
              </div>
            )}
            {bonsai.assets.length === 0 && isRunning && (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
                <Image size={32} className="opacity-50" />
                <span className="text-sm">No assets yet. Generate your first image above.</span>
              </div>
            )}
            {bonsai.assets.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {bonsai.assets.map((asset) => (
                  <div
                    key={asset.file_name}
                    className={`relative rounded-md overflow-hidden border cursor-pointer group transition-colors ${
                      selectedAsset === asset.file_name ? "border-primary" : "border-border hover:border-primary/50"
                    }`}
                    onClick={() => setSelectedAsset(asset.file_name)}
                  >
                    <img
                      src={assetUrl(asset.relative_path)}
                      alt={asset.file_name}
                      className="w-full h-32 object-cover"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
                      <Button
                        variant="destructive"
                        size="icon"
                        className="h-7 w-7"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(asset.file_name);
                        }}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </div>
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
                      <span className="text-[10px] text-white truncate block">{asset.file_name}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* Selected asset detail */}
      {selectedAssetData && (
        <div className="border-t border-border p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium truncate flex-1 mr-2">{selectedAssetData.file_name}</span>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Delete"
                onClick={() => handleDelete(selectedAssetData.file_name)}
              >
                <Trash2 size={12} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                title="Close preview"
                onClick={() => setSelectedAsset(null)}
              >
                <X size={12} />
              </Button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">
            {(selectedAssetData.file_size / 1024).toFixed(1)} KB —{" "}
            {new Date(selectedAssetData.created_at * 1000).toLocaleString()}
          </div>
          <img
            src={assetUrl(selectedAssetData.relative_path)}
            alt={selectedAssetData.file_name}
            className="w-full max-h-40 object-contain rounded-md border border-border"
          />
        </div>
      )}

      {/* Auto-stop controls */}
      {isRunning && !bonsai.stopScheduled && (
        <div className="px-3 py-1.5 border-t border-border text-xs text-muted-foreground flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-5 text-xs" onClick={bonsai.scheduleStop}>
            <Clock size={10} className="mr-1" />Auto-stop
          </Button>
        </div>
      )}
    </div>
  );
}