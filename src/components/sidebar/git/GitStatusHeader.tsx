import { GitBranch, Download, ArrowDown, ArrowUp, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useFetch, usePull, usePush, useSync } from "@/hooks/useGitMutations";
import type { GitStatus } from "@/lib/git/types";

interface GitStatusHeaderProps {
  project: string;
  status: GitStatus;
}

export function GitStatusHeader({ project, status }: GitStatusHeaderProps) {
  const fetchM = useFetch(project);
  const pullM = usePull(project);
  const pushM = usePush(project);
  const syncM = useSync(project);

  const busy = fetchM.isPending || pullM.isPending || pushM.isPending || syncM.isPending;

  return (
    <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-b border-border">
      <div className="flex items-center gap-1.5 text-xs min-w-0">
        <GitBranch className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="font-medium truncate">{status.branch ?? "detached"}</span>
        {(status.ahead > 0 || status.behind > 0) && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {status.ahead > 0 && `↑${status.ahead}`}
            {status.behind > 0 && `↓${status.behind}`}
          </span>
        )}
      </div>
      <div className="flex items-center gap-0.5 shrink-0">
        <Button variant="ghost" size="icon-sm" title="Fetch" disabled={busy} onClick={() => fetchM.mutate()}>
          <Download className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Pull" disabled={busy} onClick={() => pullM.mutate()}>
          <ArrowDown className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Push" disabled={busy} onClick={() => pushM.mutate()}>
          <ArrowUp className="size-3" />
        </Button>
        <Button variant="ghost" size="icon-sm" title="Sync" disabled={busy} onClick={() => syncM.mutate()}>
          <RefreshCw className={cn("size-3", syncM.isPending && "animate-spin")} />
        </Button>
      </div>
    </div>
  );
}
