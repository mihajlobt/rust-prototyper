import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useGitDiff, useCommitDiff } from "@/hooks/useGitStatus";
import { parseUnifiedDiff, extractCommitSubject } from "@/lib/git/diff";
import { DiffHunkView } from "@/components/sidebar/git/DiffHunkView";
import type { DiffTabParams } from "@/lib/git/diffTabs";

interface DiffTabViewProps {
  project: string;
  params: DiffTabParams;
}

/** Renders a git diff (single file or full commit) as the body of a Runner editor tab. */
export function DiffTabView({ project, params }: DiffTabViewProps) {
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
  const files = diffText ? parseUnifiedDiff(diffText) : [];

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border text-xs shrink-0">
        {isFile ? (
          <>
            <span className="font-mono truncate">{params.path}</span>
            <Badge variant="outline" className="shrink-0">
              {params.untracked ? "Untracked" : params.staged ? "Staged" : "Changes"}
            </Badge>
          </>
        ) : (
          <>
            <span className="truncate">{extractCommitSubject(diffText)}</span>
            <Badge variant="outline" className="font-mono shrink-0">{params.hash.slice(0, 7)}</Badge>
          </>
        )}
      </div>
      <ScrollArea className="flex-1">
        {query.isLoading ? (
          <div className="p-4 text-center text-xs text-muted-foreground">Loading diff…</div>
        ) : (
          <DiffHunkView files={files} />
        )}
      </ScrollArea>
    </div>
  );
}
