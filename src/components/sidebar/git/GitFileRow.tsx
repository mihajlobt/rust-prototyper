import { Plus, Minus, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStatusInfo } from "@/lib/git/statusLabels";
import type { GitFileStatus } from "@/lib/git/types";

interface GitFileRowProps {
  file: GitFileStatus;
  staged: boolean;
  onClick: () => void;
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
}

export function GitFileRow({ file, staged, onClick, onStage, onUnstage, onDiscard }: GitFileRowProps) {
  const code = staged ? file.indexStatus : file.worktreeStatus;
  const { badge, colorClass, label } = getStatusInfo(code);
  const displayPath = file.origPath ? `${file.origPath} → ${file.path}` : file.path;

  return (
    <div
      className="group flex items-center gap-1.5 px-2 py-1 rounded hover:bg-accent/50 cursor-pointer text-xs"
      onClick={onClick}
      title={displayPath}
    >
      <span className={`w-4 shrink-0 text-center text-[10px] font-bold ${colorClass}`} title={label}>
        {badge}
      </span>
      <span className="flex-1 truncate text-foreground/90">{displayPath}</span>
      <div className="hidden group-hover:flex items-center gap-0.5 shrink-0">
        {onDiscard && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Discard changes"
            onClick={(e) => { e.stopPropagation(); onDiscard(); }}
          >
            <Undo2 className="size-3" />
          </Button>
        )}
        {onStage && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Stage changes"
            onClick={(e) => { e.stopPropagation(); onStage(); }}
          >
            <Plus className="size-3" />
          </Button>
        )}
        {onUnstage && (
          <Button
            variant="ghost"
            size="icon-sm"
            title="Unstage changes"
            onClick={(e) => { e.stopPropagation(); onUnstage(); }}
          >
            <Minus className="size-3" />
          </Button>
        )}
      </div>
    </div>
  );
}
