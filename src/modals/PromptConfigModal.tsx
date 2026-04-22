import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Sliders, Save, Plus, Trash2 } from "lucide-react";
import { useSettings } from "@/hooks/useSettings";

interface PromptConfig {
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  stopSequences: string[];
}

interface SavedPreset {
  name: string;
  config: PromptConfig;
}

interface PromptConfigModalProps {
  trigger?: React.ReactNode;
  onSave?: (config: PromptConfig) => void;
}

const DEFAULT_CONFIG: PromptConfig = {
  systemPrompt: "",
  temperature: 0.7,
  maxTokens: 4096,
  stopSequences: [],
};

export function PromptConfigModal({ trigger, onSave }: PromptConfigModalProps) {
  const { settings, setSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<PromptConfig>(() => {
    const tweaks = settings.tweaks as Record<string, unknown>;
    return {
      systemPrompt: (tweaks?.systemPrompt as string) || DEFAULT_CONFIG.systemPrompt,
      temperature: (tweaks?.temperature as number) ?? DEFAULT_CONFIG.temperature,
      maxTokens: (tweaks?.maxTokens as number) ?? DEFAULT_CONFIG.maxTokens,
      stopSequences: (tweaks?.stopSequences as string[]) || DEFAULT_CONFIG.stopSequences,
    };
  });
  const [presetName, setPresetName] = useState("");
  const [stopInput, setStopInput] = useState(() => config.stopSequences.join(", "));
  const [saving, setSaving] = useState(false);

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      const tweaks = settings.tweaks as Record<string, unknown>;
      setConfig({
        systemPrompt: (tweaks?.systemPrompt as string) || DEFAULT_CONFIG.systemPrompt,
        temperature: (tweaks?.temperature as number) ?? DEFAULT_CONFIG.temperature,
        maxTokens: (tweaks?.maxTokens as number) ?? DEFAULT_CONFIG.maxTokens,
        stopSequences: (tweaks?.stopSequences as string[]) || DEFAULT_CONFIG.stopSequences,
      });
      setStopInput(((tweaks?.stopSequences as string[]) || []).join(", "));
    }
    setOpen(isOpen);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const seqs = stopInput.split(",").map((s) => s.trim()).filter(Boolean);
      const finalConfig = { ...config, stopSequences: seqs };
      setConfig(finalConfig);
      await setSettings({
        tweaks: { ...settings.tweaks, ...finalConfig },
      });
      onSave?.(finalConfig);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSavePreset = async () => {
    if (!presetName.trim()) return;
    const seqs = stopInput.split(",").map((s) => s.trim()).filter(Boolean);
    const preset: SavedPreset = { name: presetName.trim(), config: { ...config, stopSequences: seqs } };
    const existing = (settings.tweaks?.promptPresets as SavedPreset[]) || [];
    await setSettings({
      tweaks: { ...settings.tweaks, promptPresets: [...existing, preset] },
    });
    setPresetName("");
  };

  const handleLoadPreset = (preset: SavedPreset) => {
    setConfig(preset.config);
    setStopInput(preset.config.stopSequences.join(", "));
  };

  const handleDeletePreset = async (index: number) => {
    const presets = (settings.tweaks?.promptPresets as SavedPreset[]) || [];
    const next = presets.filter((_, i) => i !== index);
    await setSettings({
      tweaks: { ...settings.tweaks, promptPresets: next },
    });
  };

  const presets = (settings.tweaks?.promptPresets as SavedPreset[]) || [];

  return (
    <Dialog open={open} onOpenChange={handleOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm" className="gap-1 text-xs h-7">
            <Sliders size={12} />
            Prompt Config
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Prompt Configuration</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="system-prompt">System Prompt Template</Label>
            <Textarea
              id="system-prompt"
              value={config.systemPrompt}
              onChange={(e) => setConfig({ ...config, systemPrompt: e.target.value })}
              placeholder="You are a helpful AI assistant…"
              className="min-h-[80px] text-sm"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="temperature">Temperature (0–2)</Label>
              <Input
                id="temperature"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={config.temperature}
                onChange={(e) => setConfig({ ...config, temperature: parseFloat(e.target.value) || 0 })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="max-tokens">Max Tokens</Label>
              <Input
                id="max-tokens"
                type="number"
                min={1}
                value={config.maxTokens}
                onChange={(e) => setConfig({ ...config, maxTokens: parseInt(e.target.value) || 1 })}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="stop-sequences">Stop Sequences (comma-separated)</Label>
            <Input
              id="stop-sequences"
              value={stopInput}
              onChange={(e) => setStopInput(e.target.value)}
              placeholder="e.g. \n, END, ###"
            />
          </div>

          {presets.length > 0 && (
            <div className="space-y-1.5">
              <Label>Saved Presets</Label>
              <div className="space-y-1">
                {presets.map((preset, i) => (
                  <div key={i} className="flex items-center justify-between p-2 rounded bg-muted">
                    <button
                      type="button"
                      className="text-sm hover:underline text-left"
                      onClick={() => handleLoadPreset(preset)}
                    >
                      {preset.name}
                    </button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDeletePreset(i)}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Save as Preset</Label>
            <div className="flex gap-2">
              <Input
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                placeholder="Preset name"
                className="h-8 text-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSavePreset();
                }}
              />
              <Button size="sm" onClick={handleSavePreset} disabled={!presetName.trim()}>
                <Plus size={14} />
              </Button>
            </div>
          </div>

          <Button className="w-full" onClick={handleSave} disabled={saving}>
            <Save size={14} className="mr-1" />
            {saving ? "Saving…" : "Apply Configuration"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}