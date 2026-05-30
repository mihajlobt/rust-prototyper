import { useState, useEffect } from "react";
import { Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
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

export function BonsaiConfigPopover() {
  const { config, saveConfig } = useBonsaiStore();
  const [form, setForm] = useState<BonsaiServerConfig>(defaultConfig);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  const handleSave = () => {
    saveConfig(form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Server settings">
          <Settings2 size={13} />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[280px] p-0">
        {/* Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <p className="text-xs font-semibold">Server Configuration</p>
        </div>

        <div className="p-3 space-y-3">
          {/* Install Path */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground">Install Path</label>
            <Input
              value={form.install_path}
              onChange={(e) => setForm({ ...form, install_path: e.target.value })}
              placeholder="~/Bonsai-image-demo"
              className="h-7 text-xs px-2"
            />
          </div>

          {/* Variant */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-medium text-muted-foreground">Variant</label>
            <select
              value={form.variant}
              onChange={(e) => setForm({ ...form, variant: e.target.value })}
              className="w-full h-7 rounded-md border border-input bg-background px-2 text-xs"
            >
              <option value="ternary">Ternary (1.58-bit)</option>
              <option value="q4">Q4 (4-bit)</option>
              <option value="q8">Q8 (8-bit)</option>
            </select>
          </div>

          {/* Port */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-medium text-muted-foreground">Port</label>
              <span className="text-[10px] text-muted-foreground">{form.port}</span>
            </div>
            <Slider
              value={[form.port]}
              onValueChange={([v]) => setForm({ ...form, port: v })}
              min={8000}
              max={8005}
              step={1}
            />
          </div>

          {/* Auto-stop timeout */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-medium text-muted-foreground">Auto-stop (sec)</label>
              <span className="text-[10px] text-muted-foreground">{form.auto_stop_timeout_secs}</span>
            </div>
            <Slider
              value={[form.auto_stop_timeout_secs]}
              onValueChange={([v]) => setForm({ ...form, auto_stop_timeout_secs: v })}
              min={30}
              max={300}
              step={10}
            />
          </div>

          {/* Max memory */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-medium text-muted-foreground">Max memory (GB)</label>
              <span className="text-[10px] text-muted-foreground">{form.max_memory_gb.toFixed(1)}</span>
            </div>
            <Slider
              value={[form.max_memory_gb]}
              onValueChange={([v]) => setForm({ ...form, max_memory_gb: v })}
              min={2}
              max={16}
              step={0.5}
            />
          </div>

          {/* Auto-start */}
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={form.auto_start}
              onChange={(e) => setForm({ ...form, auto_start: e.target.checked })}
              className="rounded border-input"
            />
            Auto-start when panel opens
          </label>
        </div>

        {/* Footer */}
        <div className="px-3 py-2 border-t border-border">
          <Button size="sm" className="w-full h-7 text-xs" onClick={handleSave}>
            {saved ? "Saved ✓" : "Save Configuration"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}