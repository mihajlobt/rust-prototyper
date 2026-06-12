import { Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { GitFileRow } from "./GitFileRow";
import type { GitFileStatus } from "@/lib/git/types";

export interface ChangeItem {
  file: GitFileStatus;
  isUntracked: boolean;
}

interface GitChangesSectionProps {
  title: string;
  items: ChangeItem[];
  staged: boolean;
  onFileClick: (item: ChangeItem) => void;
  onStageFile?: (path: string) => void;
  onUnstageFile?: (path: string) => void;
  onDiscardFile?: (item: ChangeItem) => void;
  onStageAll?: () => void;
  onUnstageAll?: () => void;
}

export function GitChangesSection({
  title, items, staged, onFileClick, onStageFile, onUnstageFile, onDiscardFile, onStageAll, onUnstageAll,
}: GitChangesSectionProps) {
  if (items.length === 0) return null;

  return (
    <div className="py-1">
      <div className="flex items-center justify-between px-2 py-1">
        <span className="text-xs font-medium text-muted-foreground">
          {title} ({items.length})
        </span>
        {onStageAll && (
          <Button variant="ghost" size="icon-sm" title="Stage all changes" onClick={onStageAll}>
            <Plus className="size-3" />
          </Button>
        )}
        {onUnstageAll && (
          <Button variant="ghost" size="icon-sm" title="Unstage all changes" onClick={onUnstageAll}>
            <Minus className="size-3" />
          </Button>
        )}
      </div>
      <div>
        {items.map((item) => (
          <GitFileRow
            key={`${item.file.path}-${staged ? "staged" : "unstaged"}`}
            file={item.file}
            staged={staged}
            onClick={() => onFileClick(item)}
            onStage={onStageFile ? () => onStageFile(item.file.path) : undefined}
            onUnstage={onUnstageFile ? () => onUnstageFile(item.file.path) : undefined}
            onDiscard={onDiscardFile ? () => onDiscardFile(item) : undefined}
          />
        ))}
      </div>
    </div>
  );
}
