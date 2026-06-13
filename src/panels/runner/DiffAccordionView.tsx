import { ScrollArea } from "@/components/ui/scroll-area";
import { parseDiffTab } from "@/lib/git/diffTabs";
import { DiffAccordionItem } from "@/panels/runner/DiffAccordionItem";
import type { DiffViewMode } from "@/lib/git/types";

interface DiffAccordionViewProps {
  project: string;
  openDiffs: string[];
  viewMode: DiffViewMode;
  onCloseDiff: (diffId: string) => void;
}

export function DiffAccordionView({ project, openDiffs, viewMode, onCloseDiff }: DiffAccordionViewProps) {
  if (openDiffs.length === 0) {
    return <div className="p-4 text-center text-xs text-muted-foreground">No diffs open</div>;
  }

  return (
    <ScrollArea className="h-full">
      {openDiffs.map((diffId) => {
        const params = parseDiffTab(diffId);
        if (!params) return null;
        return (
          <DiffAccordionItem key={diffId} project={project} params={params} viewMode={viewMode} onClose={() => onCloseDiff(diffId)} />
        );
      })}
    </ScrollArea>
  );
}
