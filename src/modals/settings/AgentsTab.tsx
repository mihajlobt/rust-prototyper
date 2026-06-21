import { Fragment, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ChevronDown, Trash2 } from "lucide-react";
import type { Settings } from "@/hooks/useSettings";
import type { ToolPermissionMode, ResearchLoopConfig } from "@/lib/ipc";
import {
  WIZARD_TOOL_FILTER_DEFAULT,
  SCREENS_TOOL_FILTER_DEFAULT,
  COMPONENTS_TOOL_FILTER_DEFAULT,
  DESIGN_TOOL_FILTER_DEFAULT,
  PLANS_TOOL_FILTER_DEFAULT,
  PLANS_RESEARCH_TOOL_FILTER_DEFAULT,
} from "@/lib/agentToolDefaults";

const RESEARCH_CONFIG_DEFAULTS: Required<ResearchLoopConfig> = {
  max_rounds: 8,
  max_time_secs: 300,
  min_rounds: 2,
  max_empty_rounds: 2,
};

interface AgentsTabProps {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

type PanelKey = "wizard" | "screens" | "components" | "themes" | "plans" | "plansResearch";

const AGENTS: { label: string; panelKey: PanelKey }[] = [
  { label: "Wizard",     panelKey: "wizard" },
  { label: "Screens",    panelKey: "screens" },
  { label: "Components", panelKey: "components" },
  { label: "Design",     panelKey: "themes" },
  { label: "Plans",      panelKey: "plans" },
  { label: "Plans (Research)", panelKey: "plansResearch" },
];

const PANEL_DEFAULTS: Record<PanelKey, string[]> = {
  wizard:        WIZARD_TOOL_FILTER_DEFAULT,
  screens:       SCREENS_TOOL_FILTER_DEFAULT,
  components:    COMPONENTS_TOOL_FILTER_DEFAULT,
  themes:        DESIGN_TOOL_FILTER_DEFAULT,
  plans:         PLANS_TOOL_FILTER_DEFAULT,
  plansResearch: PLANS_RESEARCH_TOOL_FILTER_DEFAULT,
};

const PANEL_MAX_TOOL_CALLS_OVERRIDES = [
  { label: "Design",           panelKey: "themes" as const,        placeholder: "12" },
  { label: "Components",       panelKey: "components" as const,    placeholder: "20" },
  { label: "Screens",          panelKey: "screens" as const,       placeholder: "25" },
  { label: "Wizard",           panelKey: "wizard" as const,        placeholder: "60" },
  { label: "Plans",            panelKey: "plans" as const,         placeholder: "20" },
  { label: "Plans (Research)",  panelKey: "plansResearch" as const, placeholder: "30" },
];

interface ToolGroup {
  label: string;
  tools: string[];
}

const TOOL_GROUPS: ToolGroup[] = [
  { label: "Read",        tools: ["read_file", "glob", "grep"] },
  { label: "Write",       tools: ["write_file", "edit_file"] },
  { label: "Execution",   tools: ["bash", "run_tsc", "run_lint", "run_build"] },
  { label: "Interaction", tools: ["ask_user", "ask_user_form"] },
  { label: "Wizard",      tools: ["register_screen", "set_active_theme", "validate_design_json"] },
  { label: "Search",      tools: ["web_search"] },
  { label: "Advanced",    tools: ["web_fetch", "task_list", "tool_search", "skill", "lsp"] },
];

function getActivatedTools(settings: Settings, panelKey: PanelKey): string[] {
  return settings.panelToolFilter[panelKey] ?? PANEL_DEFAULTS[panelKey];
}

export function AgentsTab({ settings, setSettings }: AgentsTabProps) {
  const [toolTableOpen, setToolTableOpen] = useState(false);
  const [safetyLimitsOpen, setSafetyLimitsOpen] = useState(false);
  const [researchOpen, setResearchOpen] = useState(false);

  function toggle(panelKey: PanelKey, toolName: string, checked: boolean) {
    const current = getActivatedTools(settings, panelKey);
    const updated = checked
      ? [...current, toolName]
      : current.filter((t) => t !== toolName);

    const defaults = PANEL_DEFAULTS[panelKey];
    const matchesDefault =
      updated.length === defaults.length &&
      defaults.every((t) => updated.includes(t));

    setSettings({
      panelToolFilter: {
        ...settings.panelToolFilter,
        [panelKey]: matchesDefault ? undefined : updated,
      },
    });
  }

  return (
    <div className="flex-1 min-h-0 overflow-y-auto pr-1">
      <div className="space-y-6 pb-4">

        {/* Tool Permission */}
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
              Controls how the agent requests permission to use tools. Use the permission card in chat to always-allow specific tools.
            </p>
          </div>
          {settings.toolAllowlist.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Always Allowed</p>
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
              {PANEL_MAX_TOOL_CALLS_OVERRIDES.map(({ label, panelKey, placeholder }) => {
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

        {/* Research Settings — collapsible */}
        <Collapsible open={researchOpen} onOpenChange={setResearchOpen}>
          <section className="space-y-2">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left group">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Research</p>
              <ChevronDown
                size={13}
                className="text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
              />
            </CollapsibleTrigger>
            {!researchOpen && (
              <p className="text-xs text-muted-foreground">
                Bounds for the Plans research loop.
              </p>
            )}
            <CollapsibleContent>
              <div className="space-y-3 pt-1">
                {([
                  { key: "max_rounds",        label: "Max rounds",       min: 1,  max: 20,   step: 1,   hint: "Hard cap on research rounds (default 8)" },
                  { key: "max_time_secs",     label: "Max time (s)",    min: 30, max: 1800, step: 30,  hint: "Wall-clock timeout (default 300s)" },
                  { key: "min_rounds",        label: "Min rounds",       min: 1,  max: 20,   step: 1,   hint: "Rounds before early-stop is evaluated (default 2)" },
                  { key: "max_empty_rounds",  label: "Max empty rounds",  min: 1, max: 10,   step: 1,   hint: "Consecutive empty rounds before abort (default 2)" },
                ] as const).map(({ key, label, min, max, step, hint }) => (
                  <div key={key} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-40 shrink-0">{label}</span>
                    <Input
                      type="number"
                      min={min}
                      max={max}
                      step={step}
                      className="w-24 text-xs"
                      placeholder={String(RESEARCH_CONFIG_DEFAULTS[key])}
                      value={settings.researchConfig[key] ?? ""}
                      onChange={(e) => {
                        const raw = e.target.value;
                        const n = parseInt(raw, 10);
                        const next = raw === "" || isNaN(n)
                          ? { ...settings.researchConfig, [key]: undefined }
                          : n >= min && n <= max
                            ? { ...settings.researchConfig, [key]: n }
                            : settings.researchConfig;
                        setSettings({ researchConfig: next });
                      }}
                    />
                    <span className="text-xs text-muted-foreground">{hint}</span>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">Leave blank to use the backend default.</p>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>

        {/* Safety Limits — collapsible */}
        <Collapsible open={safetyLimitsOpen} onOpenChange={setSafetyLimitsOpen}>
          <section className="space-y-2">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left group">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Safety Limits</p>
              <ChevronDown
                size={13}
                className="text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
              />
            </CollapsibleTrigger>
            {!safetyLimitsOpen && (
              <p className="text-xs text-muted-foreground">
                Configure safety limits for agent tool usage.
              </p>
            )}
            <CollapsibleContent>
              <div className="space-y-3 pt-1">
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40 shrink-0">writeFileLimit</span>
                  <Input
                    type="number"
                    min={1}
                    max={255}
                    className="w-24 text-xs"
                    value={settings.writeFileLimit}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!isNaN(n) && n >= 1) setSettings({ writeFileLimit: n });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">max write_file calls per session</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40 shrink-0">toolOutputHistoryLimit</span>
                  <Input
                    type="number"
                    min={1000}
                    max={100000}
                    step={1000}
                    className="w-24 text-xs"
                    value={settings.toolOutputHistoryLimit}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!isNaN(n) && n >= 1000) setSettings({ toolOutputHistoryLimit: n });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">max chars of tool output in history</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40 shrink-0">toolOutputResendLimit</span>
                  <Input
                    type="number"
                    min={100}
                    max={100000}
                    step={100}
                    className="w-24 text-xs"
                    value={settings.toolOutputResendLimit}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      if (!isNaN(n) && n >= 100) setSettings({ toolOutputResendLimit: n });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">max chars of tool output on resend</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground w-40 shrink-0">compactionThreshold</span>
                  <Input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    className="w-24 text-xs"
                    value={settings.compactionThreshold}
                    onChange={(e) => {
                      const n = parseFloat(e.target.value);
                      if (!isNaN(n) && n >= 0 && n <= 1) setSettings({ compactionThreshold: n });
                    }}
                  />
                  <span className="text-xs text-muted-foreground">% of context window that triggers an LLM summary of old messages (0 = off)</span>
                </div>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>

        {/* Tool Access — collapsible */}
        <Collapsible open={toolTableOpen} onOpenChange={setToolTableOpen}>
          <section className="space-y-2">
            <CollapsibleTrigger className="flex w-full items-center justify-between text-left group">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Tool Access</p>
              <ChevronDown
                size={13}
                className="text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
              />
            </CollapsibleTrigger>
            {!toolTableOpen && (
              <p className="text-xs text-muted-foreground">
                Which tools each agent can call during generation.
              </p>
            )}
            <CollapsibleContent>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b-2 border-border bg-muted/50">
                      <th className="text-left px-3 py-2 font-medium text-muted-foreground w-40">Tool</th>
                      {AGENTS.map(({ label }) => (
                        <th key={label} className="text-center px-2 py-2 font-medium w-20">{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {TOOL_GROUPS.map((group, groupIndex) => (
                      <Fragment key={group.label}>
                        <tr className={groupIndex > 0 ? "border-t-2 border-border bg-muted/30" : "bg-muted/30"}>
                          <td
                            colSpan={6}
                            className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                          >
                            {group.label}
                          </td>
                        </tr>
                        {group.tools.map((toolName, toolIndex) => (
                          <tr
                            key={toolName}
                            className={
                              toolIndex < group.tools.length - 1
                                ? "border-b border-border/40"
                                : ""
                            }
                          >
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">{toolName}</td>
                            {AGENTS.map(({ panelKey }) => {
                              const activatedTools = getActivatedTools(settings, panelKey);
                              const isChecked = activatedTools.includes(toolName);
                              return (
                                <td key={panelKey} className="text-center px-2 py-1.5">
                                  <Checkbox
                                    checked={isChecked}
                                    onCheckedChange={(checked) => toggle(panelKey, toolName, checked === true)}
                                    className="mx-auto"
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleContent>
          </section>
        </Collapsible>

      </div>
    </div>
  );
}
