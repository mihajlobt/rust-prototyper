import { Fragment } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import type { Settings } from "@/hooks/useSettings";
import {
  WIZARD_TOOL_FILTER_DEFAULT,
  SCREENS_TOOL_FILTER_DEFAULT,
  COMPONENTS_TOOL_FILTER_DEFAULT,
  DESIGN_TOOL_FILTER_DEFAULT,
} from "@/lib/agentToolDefaults";

interface AgentsTabProps {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

type PanelKey = "wizard" | "screens" | "components" | "themes";

const AGENTS: { label: string; panelKey: PanelKey }[] = [
  { label: "Wizard",     panelKey: "wizard" },
  { label: "Screens",    panelKey: "screens" },
  { label: "Components", panelKey: "components" },
  { label: "Design",     panelKey: "themes" },
];

const PANEL_DEFAULTS: Record<PanelKey, string[]> = {
  wizard:     WIZARD_TOOL_FILTER_DEFAULT,
  screens:    SCREENS_TOOL_FILTER_DEFAULT,
  components: COMPONENTS_TOOL_FILTER_DEFAULT,
  themes:     DESIGN_TOOL_FILTER_DEFAULT,
};

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
];

function getActivatedTools(settings: Settings, panelKey: PanelKey): string[] {
  return settings.panelToolFilter[panelKey] ?? PANEL_DEFAULTS[panelKey];
}

export function AgentsTab({ settings, setSettings }: AgentsTabProps) {
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
    <ScrollArea className="flex-1 min-h-0">
      <div className="space-y-3">
        <p className="text-xs text-muted-foreground">
          Controls which tools each agent can use. Unchecking a tool prevents the agent from calling it during generation.
        </p>
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border bg-muted/40">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground w-40">Tool</th>
                {AGENTS.map(({ label }) => (
                  <th key={label} className="text-center px-2 py-2 font-medium w-20">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {TOOL_GROUPS.map((group, groupIndex) => (
                <Fragment key={group.label}>
                  <tr className="bg-muted/20">
                    <td
                      colSpan={5}
                      className="px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground"
                    >
                      {group.label}
                    </td>
                  </tr>
                  {group.tools.map((toolName, toolIndex) => (
                    <tr
                      key={toolName}
                      className={
                        groupIndex === TOOL_GROUPS.length - 1 && toolIndex === group.tools.length - 1
                          ? ""
                          : "border-b border-border/50"
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
      </div>
    </ScrollArea>
  );
}
