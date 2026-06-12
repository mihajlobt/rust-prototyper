import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useGitLog } from "@/hooks/useGitStatus";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { formatRelativeDate } from "@/lib/git/log";
import { makeCommitDiffTabId } from "@/lib/git/diffTabs";

interface GitHistoryViewProps {
  project: string;
}

const PAGE_SIZE = 50;

export function GitHistoryView({ project }: GitHistoryViewProps) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const openRunnerDiffTab = useProjectSettingsStore((s) => s.openRunnerDiffTab);
  const logQuery = useGitLog(project, true, limit);
  const commits = logQuery.data ?? [];

  return (
    <ScrollArea className="flex-1">
      {commits.length === 0 ? (
        <div className="p-4 text-center text-xs text-muted-foreground">No commits yet</div>
      ) : (
        commits.map((c) => (
          <button
            key={c.hash}
            className="flex flex-col gap-0.5 w-full text-left px-2 py-1.5 hover:bg-accent/50 border-b border-border/50"
            onClick={() => openRunnerDiffTab(makeCommitDiffTabId(c.hash))}
          >
            <span className="text-xs truncate">{c.subject}</span>
            <span className="text-[10px] text-muted-foreground">
              <span className="font-mono">{c.shortHash}</span> · {c.author} · {formatRelativeDate(c.date)}
            </span>
          </button>
        ))
      )}
      {commits.length === limit && (
        <div className="p-2">
          <Button variant="ghost" size="sm" className="w-full" onClick={() => setLimit((l) => l + PAGE_SIZE)}>
            Load more
          </Button>
        </div>
      )}
    </ScrollArea>
  );
}
