import { useMemo } from "react";
import { ChevronDown, X } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { useGitDiff, useCommitDiff } from "@/hooks/useGitStatus";
import { parseUnifiedDiff, extractCommitSubject, diffStats } from "@/lib/git/diff";
import { DiffFileList } from "@/components/sidebar/git/DiffFileList";
import type { DiffContentSource, DiffViewMode } from "@/lib/git/types";
import type { DiffTabParams } from "@/lib/git/diffTabs";

interface DiffAccordionItemProps {
  project: string;
  params: DiffTabParams;
  viewMode: DiffViewMode;
  onClose: () => void;
}

export function DiffAccordionItem({ project, params, viewMode, onClose }: DiffAccordionItemProps) {
  const isFile = params.kind === "file";

  const fileDiffQuery = useGitDiff(
    project,
    isFile ? params.path : null,
    isFile ? params.staged : false,
    isFile ? params.untracked : false
  );
  const commitDiffQuery = useCommitDiff(project, !isFile ? params.hash : null);

  const query = isFile ? fileDiffQuery : commitDiffQuery;
  const diffText = query.data ?? "";
  const files = useMemo(() => (diffText ? parseUnifiedDiff(diffText) : []), [diffText]);
  const source: DiffContentSource = isFile
    ? { kind: "file", path: params.path, staged: params.staged, untracked: params.untracked }
    : { kind: "commit", hash: params.hash };

  const { additions, deletions } = useMemo(
    () =>
      files.reduce(
        (totals, file) => {
          const stats = diffStats(file);
          return { additions: totals.additions + stats.additions, deletions: totals.deletions + stats.deletions };
        },
        { additions: 0, deletions: 0 }
      ),
    [files]
  );

  return (
    <Collapsible defaultOpen className="border-b border-border">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs sticky top-0 bg-card z-10 border-b border-border">
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer group">
            <ChevronDown className="size-3 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
            {isFile ? (
              <>
                <span className="font-mono truncate min-w-0">{params.path}</span>
                <Badge variant="outline" className="shrink-0">
                  {params.untracked ? "Untracked" : params.staged ? "Staged" : "Changes"}
                </Badge>
              </>
            ) : (
              <>
                <span className="truncate min-w-0">{extractCommitSubject(diffText)}</span>
                <Badge variant="outline" className="font-mono shrink-0">{params.hash.slice(0, 7)}</Badge>
              </>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[10px] tabular-nums">
              {additions > 0 && <span className="text-green-600 dark:text-green-400">+{additions}</span>}
              {deletions > 0 && <span className="text-red-600 dark:text-red-400">-{deletions}</span>}
            </span>
          </div>
        </CollapsibleTrigger>
        <button
          onClick={onClose}
          className="shrink-0 flex items-center justify-center w-4 h-4 rounded-sm opacity-50 hover:opacity-100 hover:bg-muted"
          title="Close diff"
        >
          <X size={11} />
        </button>
      </div>
      <CollapsibleContent>
        {query.isLoading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">Loading diff…</div>
        ) : (
          <DiffFileList project={project} source={source} files={files} viewMode={viewMode} />
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
