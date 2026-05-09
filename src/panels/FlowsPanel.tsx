import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useFlatProjectTree } from "@/hooks/useProjectFiles";
import { FlowsView } from "@/panels/FlowsView";
import { Button } from "@/components/ui/button";
import { LayoutGrid } from "lucide-react";

export function FlowsPanel() {
  const { settings } = useAppStore();
  const { setPs } = useProjectSettingsStore();
  const { data: screenEntries } = useFlatProjectTree(settings.project, "screens");
  const screenIds = (screenEntries ?? []).filter((e) => e.is_dir).map((e) => e.name);

  return (
    <div className="h-full flex flex-col">
      <div className="panel-toolbar h-10 px-3 gap-2 bg-card shrink-0">
        <span className="text-sm font-medium">Flows</span>
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs gap-1.5"
          onClick={() => setPs({ activeView: "screens" })}
        >
          <LayoutGrid size={11} />
          Go to Screens
        </Button>
      </div>
      <div className="flex-1 relative overflow-hidden">
        <FlowsView screenIds={screenIds} />
      </div>
    </div>
  );
}
