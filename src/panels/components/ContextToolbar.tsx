import { Palette, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useUIStore } from "@/stores/uiStore";
import { DESIGN_BRIEF_TEMPLATES, type DesignBriefTemplate } from "@/lib/prompts";
import { useSettings } from "@/hooks/useSettings";
import type { FileEntry } from "@/lib/ipc";

interface CtxApi {
  id: string;
  name: string;
  method: string;
  url: string;
  proxyPath: string;
}

interface ContextToolbarProps {
  themes: FileEntry[];
  selectedTheme: string;
  ctxApis: CtxApi[];
  ctxSelectedApiIds: string[];
  ctxSelectedBrief: DesignBriefTemplate | null;
}

/** Dropdowns above the chat input for injecting Design language, Design Brief,
 *  and selected APIs into the generation context. */
export function ContextToolbar({
  themes,
  selectedTheme,
  ctxApis,
  ctxSelectedApiIds,
  ctxSelectedBrief,
}: ContextToolbarProps) {
  const { settings } = useAppStore();
  const { settings: globalSettings } = useSettings();
  const { setProjectSettings } = useProjectSettingsStore();
  const setGenContext = useUIStore((s) => s.setComponentsGenContext);

  const allBriefs: DesignBriefTemplate[] = [
    ...DESIGN_BRIEF_TEMPLATES,
    ...globalSettings.styles.map((s) => ({
      name: s.name,
      description: s.value.slice(0, 80) + (s.value.length > 80 ? "…" : ""),
      palette: [] as string[],
      content: s.value,
    })),
  ];

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {/* Design language — the theme injected into generation. The preview
          theme is chosen separately in the preview toolbar. */}
      {themes.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant={selectedTheme ? "secondary" : "outline"}
              size="sm" className="h-6 text-[11px] gap-1 px-2"
            >
              <Palette size={10} />
              {selectedTheme || "Design"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuRadioGroup
              value={selectedTheme}
              onValueChange={(v) => setProjectSettings({ stylePreset: v, applyDesignBrief: true })}
            >
              <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
              {themes.map((t) => (
                <DropdownMenuRadioItem key={t.name} value={t.name} className="text-xs">
                  {t.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Design Brief — always available */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={ctxSelectedBrief ? "secondary" : "outline"}
            size="sm" className="h-6 text-[11px] gap-1 px-2"
          >
            <Palette size={10} />
            {ctxSelectedBrief ? ctxSelectedBrief.name : "Brief"}
            {ctxSelectedBrief && (
              <span
                className="ml-0.5 text-muted-foreground hover:text-foreground"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setGenContext(settings.project, { brief: null });
                }}
              >×</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuRadioGroup
            value={ctxSelectedBrief?.name ?? ""}
            onValueChange={(v) => {
              const b = allBriefs.find((bb) => bb.name === v) ?? null;
              setGenContext(settings.project, { brief: b });
            }}
          >
            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
              Built-in
            </DropdownMenuLabel>
            {DESIGN_BRIEF_TEMPLATES.map((brief) => (
              <DropdownMenuRadioItem
                key={brief.name} value={brief.name}
                className="flex-col items-start gap-0.5 py-2"
              >
                <div className="flex items-center gap-2 w-full">
                  <div className="flex gap-0.5">
                    {brief.palette.map((c) => (
                      <span
                        key={c}
                        className="w-3 h-3 rounded-sm inline-block border border-border/30"
                        style={{ background: c }}
                      />
                    ))}
                  </div>
                  <span className="text-xs font-medium">{brief.name}</span>
                </div>
                <span className="text-[10px] text-muted-foreground pl-0.5">{brief.description}</span>
              </DropdownMenuRadioItem>
            ))}
            {globalSettings.styles.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">
                  Custom
                </DropdownMenuLabel>
                {globalSettings.styles.map((s) => (
                  <DropdownMenuRadioItem
                    key={s.name} value={s.name}
                    className="flex-col items-start gap-0.5 py-1.5"
                  >
                    <span className="text-xs font-medium">{s.name}</span>
                    <span className="text-[10px] text-muted-foreground pl-0.5 line-clamp-1">
                      {s.value.slice(0, 60)}
                    </span>
                  </DropdownMenuRadioItem>
                ))}
              </>
            )}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* APIs */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={ctxSelectedApiIds.length > 0 ? "secondary" : "outline"}
            size="sm" className="h-6 text-[11px] gap-1 px-2"
          >
            <Plug size={10} />
            APIs{ctxSelectedApiIds.length > 0 ? ` (${ctxSelectedApiIds.length})` : ""}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          {ctxApis.map((api) => (
            <DropdownMenuCheckboxItem
              key={api.id}
              checked={ctxSelectedApiIds.includes(api.id)}
              onCheckedChange={(c) => setGenContext(settings.project, {
                apiIds: c
                  ? [...ctxSelectedApiIds, api.id]
                  : ctxSelectedApiIds.filter((x) => x !== api.id),
              })}
              className="text-xs"
            >
              <span className={[
                "mr-1 text-[10px] font-bold px-1 py-0.5 rounded",
                api.method === "GET"
                  ? "bg-green-500/10 text-green-600"
                  : "bg-blue-500/10 text-blue-600",
              ].join(" ")}>{api.method}</span>
              {api.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
