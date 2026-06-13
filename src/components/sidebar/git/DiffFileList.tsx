import { useDiffFileContent } from "@/hooks/useGitStatus";
import { diffStats } from "@/lib/git/diff";
import { DiffFileCodeMirror } from "./DiffFileCodeMirror";
import { DiffFileMergeView } from "./DiffFileMergeView";
import type { DiffContentSource, DiffFile, DiffViewMode } from "@/lib/git/types";

interface DiffFileListProps {
  project: string;
  source: DiffContentSource;
  files: DiffFile[];
  viewMode: DiffViewMode;
}

interface DiffFileBodyProps {
  project: string;
  source: DiffContentSource;
  file: DiffFile;
  viewMode: DiffViewMode;
}

function DiffFileBody({ project, source, file, viewMode }: DiffFileBodyProps) {
  const contentQuery = useDiffFileContent(project, source, file);

  if (file.binary) return <div className="px-2 py-2 text-muted-foreground font-mono text-xs">Binary file not shown</div>;
  if (contentQuery.isLoading) return <div className="px-2 py-2 text-muted-foreground font-mono text-xs">Loading…</div>;

  const original = contentQuery.data?.original ?? "";
  const modified = contentQuery.data?.modified ?? "";
  const filePath = file.newPath || file.oldPath;

  return viewMode === "split" ? (
    <DiffFileMergeView original={original} modified={modified} filePath={filePath} />
  ) : (
    <DiffFileCodeMirror original={original} modified={modified} filePath={filePath} />
  );
}

export function DiffFileList({ project, source, files, viewMode }: DiffFileListProps) {
  if (files.length === 0) {
    return <div className="p-4 text-center text-xs text-muted-foreground">No changes</div>;
  }

  return (
    <div className="text-xs">
      {files.map((file, fileIndex) => {
        const { additions, deletions } = diffStats(file);
        return (
          <div key={fileIndex} className="border-b border-border last:border-b-0">
            {files.length > 1 && (
              <div className="flex items-center gap-1.5 px-2 py-1 bg-muted/50 text-muted-foreground text-[11px] sticky top-0">
                <span className="truncate min-w-0">
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
              </div>
            )}
            <DiffFileBody project={project} source={source} file={file} viewMode={viewMode} />
          </div>
        );
      })}
    </div>
  );
}
