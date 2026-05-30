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
import { Settings, RotateCcw, Trash2, Server, Cloud, Zap, Bot, Library } from "lucide-react";
import { SelectSeparator, SelectLabel, SelectGroup } from "@/components/ui/select";
import { useSettings } from "@/hooks/useSettings";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { ToggleSwitch } from "@/components/ui/toggle-switch";
import { ScrollArea } from "@/components/ui/scroll-area";
import { notify } from "@/hooks/useToast";
import { readFile, writeFile, bunInstall, getErrorMessage } from "@/lib/ipc";
import { EDITOR_THEMES } from "@/components/CodeMirrorEditor";
import { ICON_LIBRARY_PACKAGES, PROMPT_DEFINITIONS, type IconLibrary, type PromptGroup } from "@/lib/prompts";
import { StylesEditor } from "@/modals/StylesEditor";
import type { ToolPermissionMode } from "@/lib/ipc";

export function SettingsModal() {
  const { settings, setSettings } = useSettings();
  const { ps, setPs } = useProjectSettingsStore();
  const [open, setOpen] = useState(false);
  const [expandedPrompt, setExpandedPrompt] = useState<string | null>(null);

  const setPrompt = async (key: string, value: string) => {
    const next = { ...settings.prompts, [key]: value };
    await setSettings({ prompts: next });
  };

  const resetPrompt = async (key: string) => {
    const next = { ...settings.prompts };
    delete next[key];
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
        notify.error("Icon library install failed", getErrorMessage(e));
      }
    })();
  }, [settings.iconLibrary, settings.project]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Settings size={14} />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-4xl max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="general" className="flex-1 overflow-hidden flex flex-col">
          <TabsList variant="line" className="h-7">
            <TabsTrigger value="general" className="text-[11px]">General</TabsTrigger>
            <TabsTrigger value="ai" className="text-[11px]">AI</TabsTrigger>
            <TabsTrigger value="directories" className="text-[11px]">Directories</TabsTrigger>
            <TabsTrigger value="styles" className="text-[11px]">Styles</TabsTrigger>
            <TabsTrigger value="prompts" className="text-[11px]">Prompts</TabsTrigger>
          </TabsList>

          <TabsContent value="general" className="flex-1 mt-4">
            <ScrollArea className="flex-1 overflow-hidden">
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
                        {(["off", "subtle", "full"] as const).map((g) => (
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
          </TabsContent>

          <TabsContent value="ai" className="flex-1 mt-4">
            <ScrollArea className="flex-1 overflow-hidden">
              <div className="space-y-6">

                {/* Providers — 2-col grid */}
                <section className="space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Providers</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Server size={13} className="text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">Ollama Local</span>
                      </div>
                      <Input value={settings.host} onChange={(e) => setSettings({ host: e.target.value })}
                        placeholder="http://localhost:11434" className="h-8 text-xs" />
                    </div>
                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Cloud size={13} className="text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">Ollama Cloud</span>
                      </div>
                      <Input type="password" value={settings.apiKeys["ollama"] ?? ""}
                        onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, ollama: e.target.value } })}
                        placeholder="API key" className="h-8 text-xs" />
                    </div>
                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Zap size={13} className="text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">OpenAI</span>
                      </div>
                      <Input type="password" value={settings.apiKeys["openai"] ?? ""}
                        onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, openai: e.target.value } })}
                        placeholder="sk-..." className="h-8 text-xs" />
                    </div>
                    <div className="rounded-lg border border-border p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <Bot size={13} className="text-muted-foreground shrink-0" />
                        <span className="text-sm font-medium">Anthropic</span>
                      </div>
                      <Input type="password" value={settings.apiKeys["claude"] ?? ""}
                        onChange={(e) => setSettings({ apiKeys: { ...settings.apiKeys, claude: e.target.value } })}
                        placeholder="sk-ant-..." className="h-8 text-xs" />
                    </div>
                  </div>
                </section>

{/* Icon Library */}
                  <section className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Icon Library</p>
                    <div className="flex items-start gap-6">
                      <div className="w-64 space-y-1.5">
                        <Select value={settings.iconLibrary} onValueChange={(v) => setSettings({ iconLibrary: v as IconLibrary })}>
                          <SelectTrigger className="text-xs">
                            <div className="flex items-center gap-1.5">
                              <Library size={12} />
                              <SelectValue placeholder="Select icon library" />
                            </div>
                          </SelectTrigger>
                          <SelectContent position="popper" side="bottom">
                            <SelectItem value="lucide" className="text-xs">lucide-react (React components)</SelectItem>
                            <SelectItem value="tabler" className="text-xs">Tabler Icons (CSS font)</SelectItem>
                            <SelectItem value="fontawesome" className="text-xs">Font Awesome (CSS font)</SelectItem>
                            <SelectItem value="bootstrap" className="text-xs">Bootstrap Icons (CSS font)</SelectItem>
                            <SelectItem value="material" className="text-xs">Material Symbols (CSS font)</SelectItem>
                            <SelectItem value="none" className="text-xs">None</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <p className="text-xs text-muted-foreground pt-1.5">
                        Auto-installed in the generated folder.<br />Affects component and screen generation prompts.
                      </p>
                    </div>
                  </section>

                  {/* Tool Permission Mode */}
                  <section className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tool Permission</p>
                    <div className="space-y-2">
                      <Select
                        value={settings.toolPermissionMode}
                        onValueChange={(v) => setSettings({ toolPermissionMode: v as ToolPermissionMode })}
                      >
                        <SelectTrigger className="w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper" side="bottom">
                          <SelectItem value="ask_every_time" className="text-xs">
                            <span className="flex flex-col gap-0.5">
                              <span>Ask every time</span>
                              <span className="text-[10px] text-muted-foreground">Prompt before each tool use</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="auto_accept_read_only" className="text-xs">
                            <span className="flex flex-col gap-0.5">
                              <span>Auto-accept read-only</span>
                              <span className="text-[10px] text-muted-foreground">Auto-allow read_file, reject writes/executes</span>
                            </span>
                          </SelectItem>
                          <SelectItem value="auto_accept_all" className="text-xs">
                            <span className="flex flex-col gap-0.5">
                              <span>Auto-accept all</span>
                              <span className="text-[10px] text-muted-foreground">No prompting, allow all tools</span>
                            </span>
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Controls how the AI agent requests permission to use tools (read_file, write_file, bash, etc.).
                      </p>
                    </div>
                    {/* Tool Allowlist */}
                    {settings.toolAllowlist.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Allowed Tools</p>
                        <div className="flex flex-wrap gap-1.5">
                          {settings.toolAllowlist.map((tool) => (
                            <div key={tool} className="flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-xs">
                              <span className="font-mono">{tool}</span>
                              <button
                                onClick={() => setSettings({ toolAllowlist: settings.toolAllowlist.filter((t) => t !== tool) })}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                <Trash2 size={10} />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </section>

                  {/* Max Tool Calls */}
                  <section className="space-y-3">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Max Tool Calls</p>
                    <div className="space-y-2">
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        className="w-24 text-xs"
                        value={settings.maxToolCalls}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          if (!isNaN(n) && n >= 1) setSettings({ maxToolCalls: n });
                        }}
                      />
                      <p className="text-xs text-muted-foreground">
                        Maximum number of tool-call iterations the agent runs per generation. Default: 20.
                      </p>
                    </div>
                  </section>
                </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="directories" className="flex-1 mt-4">
            <ScrollArea className="flex-1 overflow-hidden">
              <div className="space-y-6">

                {/* Fixed paths — read-only reference */}
                <section className="space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Project paths</p>
                  <p className="text-xs text-muted-foreground">Fixed paths inside the generated Vite project where files are written.</p>
                  <div className="rounded-lg border border-border overflow-hidden">
                    {[
                      { label: "Components",   path: "generated/src/components/{name}/component.tsx" },
                      { label: "Screens",      path: "generated/src/pages/{name}.tsx" },
                      { label: "Active theme", path: "generated/src/styles/preview-theme.css" },
                    ].map(({ label, path }, i, arr) => (
                      <div key={label} className={`flex items-center gap-4 px-3 py-2.5 ${i < arr.length - 1 ? "border-b border-border" : ""}`}>
                        <span className="text-sm text-muted-foreground w-28 shrink-0">{label}</span>
                        <code className="text-xs font-mono text-foreground/80">{path}</code>
                      </div>
                    ))}
                  </div>
                </section>

                {/* Theme export path — the one actually configurable setting */}
                <section className="space-y-3">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Theme export path</p>
                  <p className="text-xs text-muted-foreground">
                    Where <strong>Save to Runner</strong> in the Themes panel writes exported CSS files, relative to <code className="text-[11px] bg-muted px-1 py-0.5 rounded">generated/</code>.
                  </p>
                  <div className="space-y-1.5">
                    <Input
                      value={ps.directories.themes}
                      onChange={(e) => setPs({ directories: { ...ps.directories, themes: e.target.value } })}
                      placeholder="src/styles/themes"
                      className="font-mono text-xs max-w-xs"
                    />
                    <p className="text-[10px] text-muted-foreground font-mono">
                      generated/{ps.directories.themes || "…"}/{"{name}"}.css
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPs({ directories: { ...ps.directories, themes: "src/styles/themes" } })}
                    disabled={ps.directories.themes === "src/styles/themes"}
                  >
                    Reset to default
                  </Button>
                </section>

                {/* Runner port */}
                <section className="space-y-3 border-t border-border pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Dev Server</p>
                  <div className="flex items-center gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="runnerPort" className="text-sm">Runner port</Label>
                      <Input
                        id="runnerPort"
                        type="number"
                        min={1024}
                        max={65535}
                        value={ps.runnerPort}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          if (!isNaN(val) && val >= 1024 && val <= 65535) setPs({ runnerPort: val });
                        }}
                        className="h-8 text-xs w-28"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground pt-5">Restart the dev server for port changes to take effect.</p>
                  </div>
                </section>

              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="styles" className="flex-1 overflow-hidden mt-4">
            <StylesEditor />
          </TabsContent>

          <TabsContent value="prompts" className="flex-1 mt-4">
            <p className="text-xs text-muted-foreground mb-4">
              Edit the system prompts used during generation. Leave a slot empty to use the built-in default.
              Dynamic parts (icon library, current code, theme CSS) are always appended automatically.
            </p>
            <ScrollArea className="h-100 px-4 py-2">
              {(["Components", "Screens", "Themes", "Workflows"] as PromptGroup[]).map((group) => {
                const defs = PROMPT_DEFINITIONS.filter((d) => d.group === group);
                return (
                  <div key={group} className="mb-5">
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 px-0.5">{group}</p>
                    <div className="space-y-1">
                      {defs.map((def) => {
                        const isCustom = !!settings.prompts[def.key];
                        const isExpanded = expandedPrompt === def.key;
                        return (
                          <div key={def.key} className="rounded-lg border border-border overflow-hidden">
                            <button
                              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors"
                              onClick={() => setExpandedPrompt(isExpanded ? null : def.key)}
                            >
                              <span className="flex-1 text-sm font-medium">{def.label}</span>
                              <span className={[
                                "text-[10px] px-1.5 py-0.5 rounded-full font-medium",
                                isCustom
                                  ? "bg-primary/15 text-primary"
                                  : "bg-muted text-muted-foreground",
                              ].join(" ")}>
                                {isCustom ? "Custom" : "Default"}
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="px-3 pb-3 space-y-2 border-t border-border bg-muted/20">
                                <p className="text-[11px] text-muted-foreground pt-2">{def.description}</p>
                                <Textarea
                                  className="font-mono text-xs min-h-[180px] resize-y"
                                  placeholder={def.getDefault()}
                                  value={settings.prompts[def.key] ?? ""}
                                  onChange={(e) => setPrompt(def.key, e.target.value)}
                                />
                                <div className="flex justify-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-7 text-xs gap-1.5"
                                    disabled={!isCustom}
                                    onClick={() => resetPrompt(def.key)}
                                  >
                                    <RotateCcw size={11} />
                                    Reset to default
                                  </Button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
