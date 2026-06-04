import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SelectSeparator, SelectLabel, SelectGroup } from "@/components/ui/select";
import { EDITOR_THEMES } from "@/components/CodeMirrorEditor";
import type { Settings } from "@/hooks/useSettings";

interface GeneralTabProps {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

const ACCENT_COLORS = [
  { label: "Indigo",   value: "oklch(0.488 0.243 264.376)" },
  { label: "Blue",     value: "oklch(0.55 0.22 240)" },
  { label: "Sky",      value: "oklch(0.62 0.19 220)" },
  { label: "Cyan",     value: "oklch(0.60 0.16 210)" },
  { label: "Teal",     value: "oklch(0.56 0.15 185)" },
  { label: "Emerald",  value: "oklch(0.55 0.18 155)" },
  { label: "Green",    value: "oklch(0.52 0.18 145)" },
  { label: "Lime",     value: "oklch(0.62 0.18 125)" },
  { label: "Yellow",   value: "oklch(0.72 0.17 90)" },
  { label: "Amber",    value: "oklch(0.68 0.19 65)" },
  { label: "Orange",   value: "oklch(0.65 0.20 50)" },
  { label: "Red",      value: "oklch(0.58 0.22 25)" },
  { label: "Rose",     value: "oklch(0.55 0.22 15)" },
  { label: "Pink",     value: "oklch(0.58 0.22 345)" },
  { label: "Fuchsia",  value: "oklch(0.55 0.25 320)" },
  { label: "Violet",   value: "oklch(0.52 0.25 300)" },
  { label: "Purple",   value: "oklch(0.50 0.24 285)" },
  { label: "Zinc",     value: "oklch(0.55 0.01 250)" },
] as const;

const GLOW_LEVELS = ["off", "subtle", "full"] as const;

export function GeneralTab({ settings, setSettings }: GeneralTabProps) {
  return (
    <ScrollArea className="flex-1 min-h-0">
      <div className="space-y-6">

        {/* Appearance */}
        <section className="space-y-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Appearance</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-4">
            {/* Dark mode */}
            <div className="flex items-center justify-between">
              <Label className="text-sm">Dark mode</Label>
              <ToggleSwitch checked={settings.dark} onCheckedChange={(v) => setSettings({ dark: v })} />
            </div>
            {/* AMOLED */}
            <div className="flex items-center justify-between">
              <Label className="text-sm">AMOLED black</Label>
              <ToggleSwitch checked={settings.amoled} onCheckedChange={(v) => setSettings({ amoled: v })} />
            </div>
            {/* Glow */}
            <div className="space-y-1.5">
              <Label className="text-sm">Glow</Label>
              <div className="flex gap-1">
                {GLOW_LEVELS.map((g) => (
                  <button key={g} onClick={() => setSettings({ glow: g })}
                    className={["px-3 py-1 rounded text-xs border transition-colors capitalize", settings.glow === g ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted"].join(" ")}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            {/* Editor theme */}
            <div className="space-y-1.5">
              <Label className="text-sm">Editor theme</Label>
              <Select value={settings.editorTheme} onValueChange={(v) => setSettings({ editorTheme: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" side="bottom">
                  <SelectGroup>
                    <SelectLabel className="text-xs text-muted-foreground">Dark</SelectLabel>
                    {Object.entries(EDITOR_THEMES).filter(([, { dark }]) => dark).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-border bg-zinc-800" />
                          {label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectSeparator />
                  <SelectGroup>
                    <SelectLabel className="text-xs text-muted-foreground">Light</SelectLabel>
                    {Object.entries(EDITOR_THEMES).filter(([, { dark }]) => !dark).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>
                        <span className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-border bg-zinc-100" />
                          {label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Accent — full width, color swatches */}
          <div className="space-y-1.5">
            <Label className="text-sm">Accent color</Label>
            <div className="flex flex-wrap gap-2">
              {ACCENT_COLORS.map(({ label, value }) => (
                <button key={value} title={label} onClick={() => setSettings({ accent: value })}
                  className={["h-7 w-7 rounded-full border-2 transition-all", settings.accent === value ? "border-foreground scale-110" : "border-transparent hover:scale-105"].join(" ")}
                  style={{ backgroundColor: value }} />
              ))}
            </div>
          </div>
        </section>

        {/* Layout */}
        <section className="border-t border-border pt-4 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Layout</p>
          <div className="flex items-center gap-4">
            <Button variant="outline" size="sm"
              onClick={() => { setSettings({ layout: {} }); window.dispatchEvent(new CustomEvent("prototyper:reset-layout")); }}>
              Reset Layout
            </Button>
            <p className="text-xs text-muted-foreground">Resets all panel pane positions to defaults</p>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
