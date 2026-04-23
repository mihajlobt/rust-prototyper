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
import { Settings, Plus, Trash2, Server, Cloud, Zap, Bot, Library } from "lucide-react";
import { SelectSeparator, SelectLabel, SelectGroup } from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { notify } from "@/hooks/useToast";
import { listOllamaModels, type ModelInfo, readFile, writeFile, bunInstall } from "@/lib/ipc";
import { EDITOR_THEMES } from "@/components/CodeMirrorEditor";
import { OPENAI_MODELS, ANTHROPIC_MODELS } from "@/lib/models";
import { ICON_LIBRARY_PACKAGES, type IconLibrary } from "@/lib/prompts";

export function SettingsModal() {
  const { settings, setSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [newPresetName, setNewPresetName] = useState("");
  const [newPresetValue, setNewPresetValue] = useState("");
  const [newPromptName, setNewPromptName] = useState("");
  const [newPromptValue, setNewPromptValue] = useState("");
  const [localModels, setLocalModels] = useState<ModelInfo[]>([]);
  const [cloudModels, setCloudModels] = useState<ModelInfo[]>([]);
  const [localStatus, setLocalStatus] = useState<"online" | "offline" | "loading">("loading");
  const [cloudStatus, setCloudStatus] = useState<"online" | "offline" | "loading">("loading");

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

  // Auto-install icon library when changed
  useEffect(() => {
    if (!settings.project) return;
    const iconLib = settings.iconLibrary;
    (async () => {
      try {
        const pkgPath = `projects/${settings.project}/generated/package.json`;
        let pkg: Record<string, unknown> = { dependencies: {} };
        try {
          const existing = await readFile(pkgPath);
          pkg = JSON.parse(existing);
        } catch {
          // create new
        }
        const deps = (pkg.dependencies as Record<string, string>) || {};

        // Remove all icon library packages
        const allIconPackages = Object.values(ICON_LIBRARY_PACKAGES).filter(Boolean);
        let changed = false;
        for (const pkgName of allIconPackages) {
          if (deps[pkgName]) {
            delete deps[pkgName];
            changed = true;
          }
        }

        // Add selected icon library package
        const selectedPkg = ICON_LIBRARY_PACKAGES[iconLib];
        if (selectedPkg) {
          deps[selectedPkg] = "latest";
          changed = true;
        }

        if (changed) {
          pkg.dependencies = deps;
          await writeFile(pkgPath, JSON.stringify(pkg, null, 2));
          await bunInstall(`./projects/${settings.project}/generated`);
        }
      } catch (e) {
        notify.error("Icon library install failed", e instanceof Error ? e.message : String(e));
      }
    })();
  }, [settings.iconLibrary, settings.project]);

  // Fetch local and cloud Ollama models independently
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLocalStatus("loading");
    (async () => {
      try {
        const list = await listOllamaModels(settings.host, "");
        if (!cancelled) { setLocalModels(list); setLocalStatus("online"); }
      } catch {
        if (!cancelled) { setLocalModels([]); setLocalStatus("offline"); }
      }
    })();
    return () => { cancelled = true; };
  }, [open, settings.host]);

  useEffect(() => {
    if (!open) return;
    const key = settings.apiKeys["ollama"] ?? "";
    if (!key) { setCloudModels([]); setCloudStatus("offline"); void setSettings({ ollamaCloudModels: [] }); return; }
    let cancelled = false;
    setCloudStatus("loading");
    (async () => {
      try {
        const list = await listOllamaModels("https://ollama.com", key);
        if (!cancelled) {
          setCloudModels(list);
          setCloudStatus("online");
          await setSettings({ ollamaCloudModels: list.map((m) => m.id) });
        }
      } catch {
        if (!cancelled) { setCloudModels([]); setCloudStatus("offline"); }
      }
    })();
    return () => { cancelled = true; };
  }, [open, settings.apiKeys]);

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
              <Label htmlFor="stylePreset">Default Theme</Label>
              <p className="text-xs text-muted-foreground">Name of the theme folder auto-selected when generating components.</p>
              <Input
                id="stylePreset"
                value={settings.stylePreset}
                onChange={(e) => setSettings({ stylePreset: e.target.value })}
                placeholder="e.g. main"
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

            {/* Provider cards */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5">Providers</p>

              {/* Ollama Local */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Server size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium flex-1">Ollama Local</span>
                  <span className={[
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    localStatus === "online" ? "bg-green-500" : localStatus === "loading" ? "bg-yellow-500" : "bg-muted-foreground/40",
                  ].join(" ")} />
                  <span className="text-[10px] text-muted-foreground capitalize">{localStatus}</span>
                </div>
                <Input
                  value={settings.host}
                  onChange={(e) => setSettings({ host: e.target.value })}
                  placeholder="http://localhost:11434"
                  className="h-8 text-xs"
                />
              </div>

              {/* Ollama Cloud */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Cloud size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium flex-1">Ollama Cloud</span>
                  <span className={[
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    cloudStatus === "online" ? "bg-green-500" : cloudStatus === "loading" ? "bg-yellow-500" : "bg-muted-foreground/40",
                  ].join(" ")} />
                  <span className="text-[10px] text-muted-foreground capitalize">{cloudStatus}</span>
                </div>
                <Input
                  type="password"
                  value={settings.apiKeys["ollama"] ?? ""}
                  onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, ollama: e.target.value } })}
                  placeholder="API key — ollama.com/settings/keys"
                  className="h-8 text-xs"
                />
              </div>

              {/* OpenAI */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Zap size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">OpenAI</span>
                </div>
                <Input
                  type="password"
                  value={settings.apiKeys["openai"] ?? ""}
                  onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, openai: e.target.value } })}
                  placeholder="sk-..."
                  className="h-8 text-xs"
                />
              </div>

              {/* Anthropic */}
              <div className="rounded-lg border border-border p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <Bot size={13} className="text-muted-foreground shrink-0" />
                  <span className="text-sm font-medium">Anthropic</span>
                </div>
                <Input
                  type="password"
                  value={settings.apiKeys["claude"] ?? ""}
                  onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, claude: e.target.value } })}
                  placeholder="sk-ant-..."
                  className="h-8 text-xs"
                />
              </div>
            </div>

            {/* Active model */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5">Active Model</p>
              <Select value={settings.modelId} onValueChange={(v) => setSettings({ modelId: v })}>
                <SelectTrigger className="text-xs">
                  <SelectValue placeholder="Select a model…" />
                </SelectTrigger>
                <SelectContent>
                  {localModels.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="flex items-center gap-1.5 text-[10px]">
                        <Server size={10} /> Ollama Local
                      </SelectLabel>
                      {localModels.map((m) => (
                        <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  {cloudModels.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className="flex items-center gap-1.5 text-[10px]">
                        <Cloud size={10} /> Ollama Cloud
                      </SelectLabel>
                      {cloudModels.map((m) => (
                        <SelectItem key={`cloud-${m.id}`} value={m.id} className="text-xs">{m.name}</SelectItem>
                      ))}
                    </SelectGroup>
                  )}
                  <SelectGroup>
                    <SelectLabel className="flex items-center gap-1.5 text-[10px]">
                      <Zap size={10} /> OpenAI
                    </SelectLabel>
                    {OPENAI_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                    ))}
                  </SelectGroup>
                  <SelectGroup>
                    <SelectLabel className="flex items-center gap-1.5 text-[10px]">
                      <Bot size={10} /> Anthropic
                    </SelectLabel>
                    {ANTHROPIC_MODELS.map((m) => (
                      <SelectItem key={m.id} value={m.id} className="text-xs">{m.name}</SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Input
                value={settings.modelId}
                onChange={(e) => setSettings({ modelId: e.target.value })}
                placeholder="Or type a model ID manually (e.g. qwen2.5-coder:32b)"
                className="h-8 text-xs"
              />
            </div>

            {/* Icon Library */}
            <div className="space-y-1.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground px-0.5">Icon Library</p>
              <Select
                value={settings.iconLibrary}
                onValueChange={(v) => setSettings({ iconLibrary: v as IconLibrary })}
              >
                <SelectTrigger className="text-xs">
                  <div className="flex items-center gap-1.5">
                    <Library size={12} />
                    <SelectValue placeholder="Select icon library" />
                  </div>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lucide" className="text-xs">lucide-react (React components)</SelectItem>
                  <SelectItem value="tabler" className="text-xs">Tabler Icons (CSS font)</SelectItem>
                  <SelectItem value="fontawesome" className="text-xs">Font Awesome (CSS font)</SelectItem>
                  <SelectItem value="bootstrap" className="text-xs">Bootstrap Icons (CSS font)</SelectItem>
                  <SelectItem value="material" className="text-xs">Material Symbols (CSS font)</SelectItem>
                  <SelectItem value="none" className="text-xs">None</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">
                Auto-installed in the generated folder. Affects component/screen generation prompts.
              </p>
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
