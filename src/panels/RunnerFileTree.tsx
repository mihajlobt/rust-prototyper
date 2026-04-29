import { useState, useEffect } from "react";
import { Folder, FileCode } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { readDir, type FileEntry } from "@/lib/ipc";
import type { MentionAsset } from "@/types/chat";

export function getAssetType(filePath: string): MentionAsset["type"] | null {
  if (filePath.includes("/components/")) return "component";
  if (filePath.includes("/themes/")) return "theme";
  if (filePath.includes("/screens/")) return "screen";
  return null;
}

export interface FileTreeProps {
  entries: FileEntry[];
  selectedFile: string | null;
  expandedDirs: Set<string>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
  onDeleteEntry: (path: string, isDir: boolean) => void;
  onRename: (path: string) => void;
  onNewFile: (parentPath: string) => void;
  onNewFolder: (parentPath: string) => void;
  onCollapse: (path: string) => void;
  onReveal: (path: string) => void;
  depth: number;
  nonce: number;
}

export function FileTree({ entries, selectedFile, expandedDirs, onToggleDir, onSelectFile, onDeleteEntry, onRename, onNewFile, onNewFolder, onCollapse, onReveal, depth, nonce }: FileTreeProps) {
  return (
    <>
      {entries.map((file) => (
        <div key={file.path}>
          <ContextMenu>
            <ContextMenuTrigger asChild>
              <div
                className={["group flex items-center gap-1.5 rounded transition-colors cursor-pointer", selectedFile === file.path ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"].join(" ")}
                style={{ paddingLeft: `${8 + depth * 12}px`, paddingRight: "4px", paddingTop: "2px", paddingBottom: "2px" }}
                draggable={!file.is_dir && getAssetType(file.path) !== null}
                onDragStart={(e) => {
                  const assetType = getAssetType(file.path);
                  if (!file.is_dir && assetType) {
                    e.dataTransfer.setData("application/prototyper-asset", JSON.stringify({ filePath: file.path, assetType, assetName: file.name.replace(/\.(tsx|css)$/, "") }));
                    e.dataTransfer.effectAllowed = "copy";
                  }
                }}
                onClick={() => { if (file.is_dir) onToggleDir(file.path); else onSelectFile(file.path); }}
              >
                {file.is_dir ? <Folder size={12} /> : <FileCode size={12} />}
                <span className="truncate text-xs">{file.name}</span>
              </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => { if (file.is_dir) onToggleDir(file.path); else onSelectFile(file.path); }}>Open</ContextMenuItem>
              <ContextMenuItem onClick={() => onReveal(file.path)}>Show in File Explorer</ContextMenuItem>
              {file.is_dir && (
                <>
                  <ContextMenuSeparator />
                  <ContextMenuItem onClick={() => onNewFile(file.path)}>New File&#8230;</ContextMenuItem>
                  <ContextMenuItem onClick={() => onNewFolder(file.path)}>New Folder&#8230;</ContextMenuItem>
                  {expandedDirs.has(file.path) && <ContextMenuItem onClick={() => onCollapse(file.path)}>Collapse</ContextMenuItem>}
                </>
              )}
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => onRename(file.path)}>Rename&#8230;</ContextMenuItem>
              <ContextMenuItem className="text-destructive focus:text-destructive" onClick={() => onDeleteEntry(file.path, file.is_dir)}>Delete</ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
          {file.is_dir && expandedDirs.has(file.path) && (
            <AsyncDirChildren path={file.path} selectedFile={selectedFile} expandedDirs={expandedDirs} onToggleDir={onToggleDir} onSelectFile={onSelectFile} onDeleteEntry={onDeleteEntry} onRename={onRename} onNewFile={onNewFile} onNewFolder={onNewFolder} onCollapse={onCollapse} onReveal={onReveal} depth={depth + 1} nonce={nonce} />
          )}
        </div>
      ))}
    </>
  );
}

function AsyncDirChildren(props: Omit<FileTreeProps, "entries"> & { path: string }) {
  const [children, setChildren] = useState<FileEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    readDir(props.path).then((entries) => { if (!cancelled) setChildren(entries); }).catch(() => { if (!cancelled) setChildren([]); });
    return () => { cancelled = true; };
  }, [props.path, props.nonce]);
  return <FileTree entries={children} {...props} />;
}
