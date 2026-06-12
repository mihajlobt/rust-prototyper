import { cn } from "@/lib/utils";
import type { DiffFile } from "@/lib/git/types";

interface DiffHunkViewProps {
  files: DiffFile[];
}

const PREFIX: Record<string, string> = { add: "+", remove: "-", context: " " };

export function DiffHunkView({ files }: DiffHunkViewProps) {
  if (files.length === 0) {
    return <div className="p-4 text-center text-xs text-muted-foreground">No changes</div>;
  }

  return (
    <div className="font-mono text-xs">
      {files.map((file, fi) => (
        <div key={fi} className="border-b border-border last:border-b-0">
          <div className="px-2 py-1 bg-muted/50 text-muted-foreground text-[11px] sticky top-0">
            {file.oldPath === file.newPath ? file.newPath : `${file.oldPath} → ${file.newPath}`}
          </div>
          {file.binary ? (
            <div className="px-2 py-2 text-muted-foreground">Binary file not shown</div>
          ) : (
            file.hunks.map((hunk, hi) => (
              <div key={hi}>
                <div className="px-2 py-0.5 text-muted-foreground/70 text-[10px]">{hunk.header}</div>
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className={cn(
                      "px-2 whitespace-pre-wrap break-all",
                      line.type === "add" && "bg-green-500/10 text-green-700 dark:text-green-400",
                      line.type === "remove" && "bg-red-500/10 text-red-700 dark:text-red-400",
                      line.type === "meta" && "text-muted-foreground/60 italic"
                    )}
                  >
                    {line.type === "meta" ? line.content : `${PREFIX[line.type]}${line.content}`}
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      ))}
    </div>
  );
}
