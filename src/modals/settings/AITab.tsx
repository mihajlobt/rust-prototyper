import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Server, Cloud, Zap, Bot, Library, Trash2 } from "lucide-react";
import { type IconLibrary } from "@/lib/prompts";
import type { ToolPermissionMode } from "@/lib/ipc";
import type { Settings } from "@/hooks/useSettings";

interface AITabProps {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

const PANEL_OVERRIDES = [
  { label: "Design",     panelKey: "themes" as const,     placeholder: "12" },
  { label: "Components", panelKey: "components" as const, placeholder: "20" },
  { label: "Screens",    panelKey: "screens" as const,    placeholder: "25" },
  { label: "Wizard",     panelKey: "wizard" as const,     placeholder: "60" },
];

export function AITab({ settings, setSettings }: AITabProps) {
  return (
    <ScrollArea className="flex-1 min-h-0">
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
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={1}
                max={200}
                className="w-24 text-xs"
                value={settings.maxToolCalls}
                onChange={(e) => {
                  const n = parseInt(e.target.value, 10);
                  if (!isNaN(n) && n >= 1) setSettings({ maxToolCalls: n });
                }}
              />
              <span className="text-xs text-muted-foreground">global default</span>
            </div>
            <p className="text-xs text-muted-foreground">
              Maximum tool-call iterations per generation. Default: 20.
            </p>
          </div>
          <div className="space-y-2 pt-1">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wide">Per-panel overrides</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {PANEL_OVERRIDES.map(({ label, panelKey, placeholder }) => {
                const value = settings.panelMaxToolCalls[panelKey];
                return (
                  <div key={label} className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-20 shrink-0">{label}</span>
                    <Input
                      type="number"
                      min={1}
                      max={200}
                      placeholder={placeholder}
                      className="w-16 text-xs"
                      value={value ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = parseInt(raw, 10);
                        setSettings({
                          panelMaxToolCalls: {
                            ...settings.panelMaxToolCalls,
                            [panelKey]: raw === "" || isNaN(n) ? undefined : n,
                          },
                        });
                      }}
                    />
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground">Leave blank to use global default.</p>
          </div>
        </section>
      </div>
    </ScrollArea>
  );
}
