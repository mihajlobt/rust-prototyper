import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { useBonsaiStore } from "@/stores/bonsaiStore";
import type { BonsaiServerConfig } from "@/lib/bonsai";

const defaultConfig: BonsaiServerConfig = {
  install_path: "",
  port: 8000,
  variant: "ternary",
  auto_start: false,
  auto_stop_timeout_secs: 60,
  max_memory_gb: 4.0,
};

export function BonsaiConfigSection() {
  const { config, saveConfig } = useBonsaiStore();
  const [form, setForm] = useState<BonsaiServerConfig>(defaultConfig);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Only override form when config becomes available (not null)
    if (config) {
      setForm(config);
    }
  }, [config]);

  const handleSave = () => {
    saveConfig(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="px-3 py-3 border-b border-border space-y-3 bg-muted/20">
      <div className="text-xs font-medium text-muted-foreground">Server Configuration</div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Install Path</label>
        <Input
          value={form.install_path}
          onChange={(e) => setForm({ ...form, install_path: e.target.value })}
          placeholder="~/Bonsai-image-demo (leave empty for default)"
          className="text-xs h-8"
        />
        <p className="text-[10px] text-muted-foreground">
          Leave empty to use ~/Bonsai-image-demo. Must be an absolute path.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-muted-foreground">Variant</label>
        <select
          value={form.variant}
          onChange={(e) => setForm({ ...form, variant: e.target.value })}
          className="w-full h-8 rounded-md border border-input bg-background px-2 text-xs"
        >
          <option value="ternary">Ternary (1.58-bit)</option>
          <option value="q4">Q4 (4-bit)</option>
          <option value="q8">Q8 (8-bit)</option>
        </select>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Port</label>
          <span className="text-xs text-muted-foreground">{form.port}</span>
        </div>
        <Slider
          value={[form.port]}
          onValueChange={([v]) => setForm({ ...form, port: v })}
          min={8000}
          max={8005}
          step={1}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Auto-stop (sec)</label>
          <span className="text-xs text-muted-foreground">{form.auto_stop_timeout_secs}</span>
        </div>
        <Slider
          value={[form.auto_stop_timeout_secs]}
          onValueChange={([v]) => setForm({ ...form, auto_stop_timeout_secs: v })}
          min={30}
          max={300}
          step={10}
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">Max memory (GB)</label>
          <span className="text-xs text-muted-foreground">{form.max_memory_gb.toFixed(1)}</span>
        </div>
        <Slider
          value={[form.max_memory_gb]}
          onValueChange={([v]) => setForm({ ...form, max_memory_gb: v })}
          min={2}
          max={16}
          step={0.5}
        />
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input
          type="checkbox"
          checked={form.auto_start}
          onChange={(e) => setForm({ ...form, auto_start: e.target.checked })}
          className="rounded border-input"
        />
        Auto-start server when panel opens
      </label>

      <Button size="sm" className="w-full" onClick={handleSave}>
        {saved ? "Saved ✓" : "Save Configuration"}
      </Button>
    </div>
  );
}