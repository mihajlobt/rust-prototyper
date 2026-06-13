import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DiffHunkCodeMirror } from "./DiffHunkCodeMirror";
import type { DiffFile } from "@/lib/git/types";

interface DiffHunkViewProps {
  files: DiffFile[];
}

function diffStats(file: DiffFile): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.type === "add") additions++;
      else if (line.type === "remove") deletions++;
    }
  }
  return { additions, deletions };
}

export function DiffHunkView({ files }: DiffHunkViewProps) {
  if (files.length === 0) {
    return <div className="p-4 text-center text-xs text-muted-foreground">No changes</div>;
  }

  return (
    <div className="font-mono text-xs">
      {files.map((file, fi) => {
        const { additions, deletions } = diffStats(file);
        return (
        <Collapsible key={fi} defaultOpen className="border-b border-border last:border-b-0">
          <CollapsibleTrigger className="flex w-full items-center gap-1.5 px-2 py-1 bg-muted/50 text-muted-foreground text-[11px] sticky top-0 group">
            <ChevronDown className="size-3 shrink-0 transition-transform group-data-[state=closed]:-rotate-90" />
            <span className="truncate">
              {file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`}
            </span>
            <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2 text-[10px] tabular-nums">
              {file.binary ? (
                <span className="text-muted-foreground/70">Binary</span>
              ) : (
                <>
                  {additions > 0 && <span className="text-green-600 dark:text-green-400">+{additions}</span>}
                  {deletions > 0 && <span className="text-red-600 dark:text-red-400">-{deletions}</span>}
                </>
              )}
            </span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            {file.binary ? (
              <div className="px-2 py-2 text-muted-foreground">Binary file not shown</div>
            ) : (
              file.hunks.map((hunk, hi) => (
                <div key={hi}>
                  <div className="px-2 py-0.5 text-muted-foreground/70 text-[10px] bg-muted/30">{hunk.header}</div>
                  <DiffHunkCodeMirror hunk={hunk} filePath={file.newPath || file.oldPath} />
                </div>
              ))
            )}
          </CollapsibleContent>
        </Collapsible>
        );
      })}
    </div>
  );
}
