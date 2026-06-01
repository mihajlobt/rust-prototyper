import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { RotateCcw } from "lucide-react";
import { PROMPT_DEFINITIONS, type PromptGroup } from "@/lib/prompts";
import type { Settings } from "@/hooks/useSettings";

interface PromptsTabProps {
  settings: Settings;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
}

const PROMPT_GROUPS: PromptGroup[] = ["Components", "Screens", "Themes", "Workflows"];

export function PromptsTab({ settings, setSettings }: PromptsTabProps) {
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

  return (
    <>
      <p className="text-xs text-muted-foreground mb-4">
        Edit the system prompts used during generation. Leave a slot empty to use the built-in default.
        Dynamic parts (icon library, current code, theme CSS) are always appended automatically.
      </p>
      <ScrollArea className="h-100 px-4 py-2">
        {PROMPT_GROUPS.map((group) => {
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
    </>
  );
}
