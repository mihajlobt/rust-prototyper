import { Palette, Plug, Puzzle } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { DESIGN_BRIEF_TEMPLATES, type DesignBriefTemplate } from "@/lib/prompts";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useUIStore, EMPTY_GEN_CONTEXT } from "@/stores/uiStore";
import { useSettings } from "@/hooks/useSettings";
import type { FileEntry } from "@/lib/ipc";

interface CtxApi { id: string; name: string; method: string; url: string; proxyPath: string }
interface CtxComponent { id: string; name: string }

interface ScreensContextToolbarProps {
  themes: FileEntry[];
  ctxApis: CtxApi[];
  ctxComponents: CtxComponent[];
}

export function ScreensContextToolbar({ themes, ctxApis, ctxComponents }: ScreensContextToolbarProps) {
  const { settings } = useAppStore();
  const { ps, setPs } = useProjectSettingsStore();
  const { settings: globalSettings } = useSettings();
  const genContext = useUIStore((s) => s.screensGenContext[settings.project] ?? EMPTY_GEN_CONTEXT);
  const setGenContext = useUIStore((s) => s.setScreensGenContext);

  const ctxSelectedApiIds = genContext.apiIds;
  const ctxSelectedComponentIds = genContext.componentIds;
  const ctxSelectedBrief = genContext.brief;

  const allBriefs: DesignBriefTemplate[] = [
    ...DESIGN_BRIEF_TEMPLATES,
    ...globalSettings.styles.map((s) => ({
      name: s.name,
      description: s.value.slice(0, 80) + (s.value.length > 80 ? "…" : ""),
      palette: [] as string[],
      content: s.value,
    })),
  ];

  if (ctxApis.length === 0 && ctxComponents.length === 0 && themes.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {themes.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={ps.stylePreset ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
              <Palette size={10} />
              {ps.stylePreset || "Design"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuRadioGroup value={ps.stylePreset} onValueChange={(v) => setPs({ stylePreset: v, applyDesignBrief: true })}>
              <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
              {themes.map((t) => (
                <DropdownMenuRadioItem key={t.name} value={t.name} className="text-xs">{t.name}</DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant={ctxSelectedBrief ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
            <Palette size={10} />
            {ctxSelectedBrief ? ctxSelectedBrief.name : "Brief"}
            {ctxSelectedBrief && (
              <span
                className="ml-0.5 text-muted-foreground hover:text-foreground"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); setGenContext(settings.project, { brief: null }); }}
              >×</span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuRadioGroup
            value={ctxSelectedBrief?.name ?? ""}
            onValueChange={(v) => { const brief = allBriefs.find((b) => b.name === v) ?? null; setGenContext(settings.project, { brief }); }}
          >
            <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Built-in</DropdownMenuLabel>
            {DESIGN_BRIEF_TEMPLATES.map((brief) => (
              <DropdownMenuRadioItem key={brief.name} value={brief.name} className="flex-col items-start gap-0.5 py-2">
                <div className="flex items-center gap-2 w-full">
                  <div className="flex gap-0.5">
                    {brief.palette.map((color) => (
                      <span key={color} className="w-3 h-3 rounded-sm inline-block border border-border/30" style={{ background: color }} />
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
                <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Custom</DropdownMenuLabel>
                {globalSettings.styles.map((style) => (
                  <DropdownMenuRadioItem key={style.name} value={style.name} className="flex-col items-start gap-0.5 py-1.5">
                    <span className="text-xs font-medium">{style.name}</span>
                    <span className="text-[10px] text-muted-foreground pl-0.5 line-clamp-1">{style.value.slice(0, 60)}</span>
                  </DropdownMenuRadioItem>
                ))}
              </>
            )}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      {ctxApis.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={ctxSelectedApiIds.length > 0 ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
              <Plug size={10} />
              APIs{ctxSelectedApiIds.length > 0 ? ` (${ctxSelectedApiIds.length})` : ""}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {ctxApis.map((api) => (
              <DropdownMenuCheckboxItem
                key={api.id}
                checked={ctxSelectedApiIds.includes(api.id)}
                onCheckedChange={(checked) => setGenContext(settings.project, {
                  apiIds: checked ? [...ctxSelectedApiIds, api.id] : ctxSelectedApiIds.filter((id) => id !== api.id),
                })}
                className="text-xs"
              >
                <span className={["mr-1 text-[10px] font-bold px-1 py-0.5 rounded", api.method === "GET" ? "bg-green-500/10 text-green-600" : "bg-blue-500/10 text-blue-600"].join(" ")}>{api.method}</span>
                {api.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {ctxComponents.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant={ctxSelectedComponentIds.length > 0 ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
              <Puzzle size={10} />
              Components{ctxSelectedComponentIds.length > 0 ? ` (${ctxSelectedComponentIds.length})` : ""}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            {ctxComponents.map((comp) => (
              <DropdownMenuCheckboxItem
                key={comp.id}
                checked={ctxSelectedComponentIds.includes(comp.id)}
                onCheckedChange={(checked) => setGenContext(settings.project, {
                  componentIds: checked ? [...ctxSelectedComponentIds, comp.id] : ctxSelectedComponentIds.filter((id) => id !== comp.id),
                })}
                className="text-xs"
              >
                {comp.name}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
