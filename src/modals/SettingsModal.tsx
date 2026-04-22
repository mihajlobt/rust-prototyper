import { useState, useEffect } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Settings, Plus, Trash2 } from "lucide-react";
import { SelectSeparator, SelectLabel, SelectGroup } from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { listOllamaModels, type ModelInfo } from "@/lib/ipc";
import { EDITOR_THEMES } from "@/components/CodeMirrorEditor";

export function SettingsModal() {
  const { settings, setSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetValue, setNewPresetValue] = useState("");
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptValue, setNewPromptValue] = useState("");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [newProviderName, setNewProviderName] = useState("");
  const [newProviderKey, setNewProviderKey] = useState("");

  const addPreset = async () => {
    if (!newPresetName || !newPresetValue) return;
    const next = [...settings.styles, { name: newPresetName, value: newPresetValue }];
    await setSettings({ styles: next });
    setNewPresetName("");
    setNewPresetValue("");
  };

  const removePreset = async (index: number) => {
    const next = settings.styles.filter((_, i) => i !== index);
    await setSettings({ styles: next });
  };

  const addPrompt = async () => {
    if (!newPromptName || !newPromptValue) return;
    const next = { ...settings.prompts, [newPromptName]: newPromptValue };
    await setSettings({ prompts: next });
    setNewPromptName("");
    setNewPromptValue("");
  };

  const removePrompt = async (name: string) => {
    const next = { ...settings.prompts };
    delete next[name];
    await setSettings({ prompts: next });
  };

  // Load models when AI tab is visible
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listOllamaModels(settings.host);
        if (!cancelled) setModels(list);
      } catch {
        if (!cancelled) setModels([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open, settings.host]);

  const addProvider = async () => {
    if (!newProviderName.trim() || !newProviderKey.trim()) return;
    const next = { ...settings.apiKeys, [newProviderName.trim().toLowerCase()]: newProviderKey.trim() };
    await setSettings({ apiKeys: next });
    setNewProviderName("");
    setNewProviderKey("");
  };

  const removeProvider = async (name: string) => {
    const next = { ...settings.apiKeys };
    delete next[name];
    await setSettings({ apiKeys: next });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="general">General</TabsTrigger>
            <TabsTrigger value="ai">AI</TabsTrigger>
            <TabsTrigger value="styles">Styles</TabsTrigger>
            <TabsTrigger value="prompts">Prompts</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="flex items-center justify-between">
              <Label>Dark mode</Label>
              <button
                onClick={() => setSettings({ dark: !settings.dark })}
                className={[
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  settings.dark ? "bg-primary" : "bg-input",
                ].join(" ")}
              >
                <span className={["inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform", settings.dark ? "translate-x-4.5" : "translate-x-0.5"].join(" ")} />
              </button>
            </div>

            <div className="space-y-2">
              <Label>Accent color</Label>
              <div className="flex flex-wrap gap-2.5">
                {[
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
                ].map(({ label, value }) => (
                  <button
                    key={value}
                    title={label}
                    onClick={() => setSettings({ accent: value })}
                    className={[
                      "h-7 w-7 rounded-full border-2 transition-all",
                      settings.accent === value ? "border-foreground scale-110" : "border-transparent hover:scale-105",
                    ].join(" ")}
                    style={{ backgroundColor: value }}
                  />
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="project">Project</Label>
              <Input
                id="project"
                value={settings.project}
                onChange={(e) => setSettings({ project: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="stylePreset">Default Style Preset</Label>
              <Input
                id="stylePreset"
                value={settings.stylePreset}
                onChange={(e) => setSettings({ stylePreset: e.target.value })}
              />
            </div>

            <div className="flex items-center justify-between">
              <Label>AMOLED dark (true black)</Label>
              <button
                onClick={() => setSettings({ amoled: !settings.amoled })}
                className={[
                  "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  settings.amoled ? "bg-primary" : "bg-input",
                ].join(" ")}
              >
                <span className={["inline-block h-3.5 w-3.5 rounded-full bg-background shadow transition-transform", settings.amoled ? "translate-x-4.5" : "translate-x-0.5"].join(" ")} />
              </button>
            </div>

            <div className="space-y-2">
              <Label>Glow intensity</Label>
              <div className="flex gap-1">
                {(["off", "subtle", "full"] as const).map((g) => (
                  <button
                    key={g}
                    onClick={() => setSettings({ glow: g })}
                    className={[
                      "px-3 py-1 rounded text-xs border transition-colors capitalize",
                      settings.glow === g
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted",
                    ].join(" ")}
                  >
                    {g}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Editor theme</Label>
              <Select value={settings.editorTheme} onValueChange={(v) => setSettings({ editorTheme: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
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
          </TabsContent>

          <TabsContent value="ai" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="space-y-2">
              <Label htmlFor="host">Ollama Host</Label>
              <Input
                id="host"
                value={settings.host}
                onChange={(e) => setSettings({ host: e.target.value })}
                placeholder="http://localhost:11434"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modelId">Default Model</Label>
              <Select value={settings.modelId} onValueChange={(v) => setSettings({ modelId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select model" />
                </SelectTrigger>
                <SelectContent>
                  {models.map((m) => (
                    <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>
                  ))}
                  {models.length === 0 && (
                    <SelectItem value="custom" disabled>No models found — enter manually below</SelectItem>
                  )}
                </SelectContent>
              </Select>
              <Input
                value={settings.modelId}
                onChange={(e) => setSettings({ modelId: e.target.value })}
                placeholder="Or type model ID manually (e.g. qwen2.5-coder:32b)"
                className="h-8 text-xs"
              />
            </div>
            <div className="space-y-2">
              <Label>API Keys</Label>
              {Object.entries(settings.apiKeys).map(([name, key]) => (
                <div key={name} className="flex items-center gap-2">
                  <span className="text-xs font-medium w-24 truncate">{name}</span>
                  <Input
                    type="password"
                    value={key}
                    onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, [name]: e.target.value } })}
                    className="h-8 text-xs flex-1"
                    placeholder={`${name} API key`}
                  />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeProvider(name)}>
                    <Trash2 size={10} />
                  </Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input
                  placeholder="Provider name (e.g. openai, claude, custom)"
                  value={newProviderName}
                  onChange={(e) => setNewProviderName(e.target.value)}
                  className="h-8 text-xs"
                />
                <Input
                  type="password"
                  placeholder="API key"
                  value={newProviderKey}
                  onChange={(e) => setNewProviderKey(e.target.value)}
                  className="h-8 text-xs"
                />
                <Button size="sm" onClick={addProvider} disabled={!newProviderName.trim() || !newProviderKey.trim()}>
                  <Plus size={14} />
                </Button>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="styles" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="space-y-2">
              <Label>New Style Preset</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Name"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                />
                <Input
                  placeholder="Value"
                  value={newPresetValue}
                  onChange={(e) => setNewPresetValue(e.target.value)}
                />
                <Button size="sm" onClick={addPreset}>
                  <Plus size={14} />
                </Button>
              </div>
            </div>
            <div className="space-y-1">
              {settings.styles.map((preset, i) => (
                <div key={i} className="flex items-center justify-between p-2 rounded bg-muted">
                  <span className="text-sm">{preset.name}</span>
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removePreset(i)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="prompts" className="flex-1 overflow-auto space-y-4 mt-4">
            <div className="space-y-2">
              <Label>New Prompt Template</Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Name"
                  value={newPromptName}
                  onChange={(e) => setNewPromptName(e.target.value)}
                />
                <Button size="sm" onClick={addPrompt}>
                  <Plus size={14} />
                </Button>
              </div>
              <Textarea
                placeholder="Prompt template value..."
                value={newPromptValue}
                onChange={(e) => setNewPromptValue(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              {Object.entries(settings.prompts).map(([name, value]) => (
                <div key={name} className="flex items-start justify-between p-2 rounded bg-muted gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground truncate">{value as string}</div>
                  </div>
                  <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removePrompt(name)}>
                    <Trash2 size={12} />
                  </Button>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
