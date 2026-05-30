import { useState, useEffect } from "react";
import { Settings2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { useBonsaiStore, BONSAI_DEFAULT_CONFIG } from "@/stores/bonsaiStore";
import type { BonsaiServerConfig } from "@/lib/bonsai";

export function BonsaiConfigPopover() {
  const { config, saveConfig } = useBonsaiStore();
  const [form, setForm] = useState<BonsaiServerConfig>(BONSAI_DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (config) setForm(config);
  }, [config]);

  useEffect(() => {
    setSaved(false);
  }, [form]);

  const handleSave = () => {
    saveConfig(form);
    setSaved(true);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) setSaved(false);
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" title="Server settings">
          <Settings2 size={13} />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[280px] p-0">
        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
          <p className="text-xs font-semibold">Server Configuration</p>
        </div>

        <div className="p-3 space-y-3">
          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium leading-none">Install Path</Label>
            <Input
              value={form.install_path}
              onChange={(e) => setForm({ ...form, install_path: e.target.value })}
              placeholder="~/Bonsai-image-demo"
              className="h-7 text-xs px-2"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-[10px] font-medium leading-none">Variant</Label>
            <Select
              value={form.variant}
              onValueChange={(v) => setForm({ ...form, variant: v })}
            >
              <SelectTrigger size="sm" className="w-full text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ternary">Ternary (1.58-bit)</SelectItem>
                <SelectItem value="binary">Binary (1-bit)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-medium leading-none">Port</Label>
              <span className="text-[9px] text-muted-foreground">{form.port}</span>
            </div>
            <Slider
              value={[form.port]}
              onValueChange={([v]) => setForm({ ...form, port: v })}
              min={8000}
              max={8005}
              step={1}
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-[10px] font-medium leading-none">Auto-stop (sec)</Label>
              <span className="text-[9px] text-muted-foreground">{form.auto_stop_timeout_secs}</span>
            </div>
            <Slider
              value={[form.auto_stop_timeout_secs]}
              onValueChange={([v]) => setForm({ ...form, auto_stop_timeout_secs: v })}
              min={30}
              max={300}
              step={10}
            />
          </div>
        </div>

        <div className="px-3 py-2 border-t border-border">
          <Button size="sm" className="w-full h-7 text-xs" onClick={handleSave}>
            {saved ? "Saved ✓" : "Save Configuration"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}