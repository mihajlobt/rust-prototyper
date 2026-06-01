import { useState, useEffect } from "react";
import {
  Folder, FolderOpen,
  FileCode, Code2, FileText,
  Braces, Paintbrush, Globe, ImageIcon, Settings2, File,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { readDir, type FileEntry } from "@/lib/ipc";
import type { MentionAsset } from "@/types/chat";
import { useUIStore } from "@/stores/uiStore";

export function getAssetType(filePath: string): MentionAsset["type"] | null {
  if (filePath.includes("/components/")) return "component";
  if (filePath.includes("/themes/")) return "theme";
  if (filePath.includes("/screens/")) return "screen";
  return null;
}

// CSS variable names set by App.tsx from the accent hue using color theory.
type FileColorVar =
  | "--file-ts"
  | "--file-tsx"
  | "--file-css"
  | "--file-json"
  | "--file-md"
  | "--file-img"
  | "--file-html"
  | "--file-config";

interface FileIconStyle {
  Icon: LucideIcon;
  colorVar: FileColorVar | null; // null = inherit from parent (muted-foreground / accent-foreground)
}

function getFileIconStyle(name: string, isDir: boolean, isExpanded: boolean): FileIconStyle {
  if (isDir) return { Icon: isExpanded ? FolderOpen : Folder, colorVar: null };

  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    // React components
    case "tsx":
    case "jsx": return { Icon: FileCode,   colorVar: "--file-tsx"    };
    // TypeScript / JavaScript
    case "ts":
    case "js":
    case "mjs":
    case "cjs": return { Icon: Code2,      colorVar: "--file-ts"     };
    // Stylesheets
    case "css":
    case "scss":
    case "sass":
    case "less": return { Icon: Paintbrush, colorVar: "--file-css"    };
    // Data / config
    case "json":
    case "jsonc": return { Icon: Braces,    colorVar: "--file-json"   };
    // Documentation
    case "md":
    case "mdx": return { Icon: FileText,   colorVar: "--file-md"     };
    // Markup
    case "html":
    case "htm": return { Icon: Globe,      colorVar: "--file-html"   };
    // Images and vector graphics
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
    case "ico":
    case "avif": return { Icon: ImageIcon,  colorVar: "--file-img"    };
    // Config, build, environment files
    case "env":
    case "toml":
    case "yaml":
    case "yml":
    case "lock":
    case "sh":
    case "bash": return { Icon: Settings2,  colorVar: "--file-config" };
    // Generic fallback
    default: return { Icon: File, colorVar: null };
  }
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
}

export function FileTree({
  entries, selectedFile, expandedDirs,
  onToggleDir, onSelectFile, onDeleteEntry,
  onRename, onNewFile, onNewFolder, onCollapse, onReveal, depth,
}: FileTreeProps) {
  return (
    <>
      {entries.map((file) => {
        const isSelected = selectedFile === file.path;
        const isExpanded = expandedDirs.has(file.path);
        const { Icon, colorVar } = getFileIconStyle(file.name, file.is_dir, isExpanded);

        return (
          <div key={file.path}>
            <ContextMenu>
              <ContextMenuTrigger asChild>
                <div
                  className={[
                    "group flex items-center gap-1.5 rounded transition-colors cursor-pointer",
                    isSelected
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  ].join(" ")}
                  style={{
                    paddingLeft: `${8 + depth * 12}px`,
                    paddingRight: "4px",
                    paddingTop: "2px",
                    paddingBottom: "2px",
                  }}
                  draggable={!file.is_dir && getAssetType(file.path) !== null}
                  onDragStart={(e) => {
                    const assetType = getAssetType(file.path);
                    if (!file.is_dir && assetType) {
                      e.dataTransfer.setData(
                        "application/prototyper-asset",
                        JSON.stringify({
                          filePath: file.path,
                          assetType,
                          assetName: file.name.replace(/\.(tsx|css)$/, ""),
                        }),
                      );
                      e.dataTransfer.effectAllowed = "copy";
                    }
                  }}
                  onClick={() => {
                    if (file.is_dir) onToggleDir(file.path);
                    else onSelectFile(file.path);
                  }}
                >
                  <Icon
                    size={12}
                    // When selected the parent applies text-accent-foreground — let that win.
                    // Otherwise apply the file-type color derived from the accent hue.
                    style={colorVar && !isSelected ? { color: `var(${colorVar})` } : undefined}
                  />
                  <span className="truncate text-xs">{file.name}</span>
                </div>
              </ContextMenuTrigger>
              <ContextMenuContent>
                <ContextMenuItem onClick={() => { if (file.is_dir) onToggleDir(file.path); else onSelectFile(file.path); }}>
                  Open
                </ContextMenuItem>
                <ContextMenuItem onClick={() => onReveal(file.path)}>
                  Show in File Explorer
                </ContextMenuItem>
                {file.is_dir && (
                  <>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => onNewFile(file.path)}>New File&#8230;</ContextMenuItem>
                    <ContextMenuItem onClick={() => onNewFolder(file.path)}>New Folder&#8230;</ContextMenuItem>
                    {isExpanded && (
                      <ContextMenuItem onClick={() => onCollapse(file.path)}>Collapse</ContextMenuItem>
                    )}
                  </>
                )}
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => onRename(file.path)}>Rename&#8230;</ContextMenuItem>
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => onDeleteEntry(file.path, file.is_dir)}
                >
                  Delete
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>

            {file.is_dir && isExpanded && (
              <AsyncDirChildren
                path={file.path}
                selectedFile={selectedFile}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
                onDeleteEntry={onDeleteEntry}
                onRename={onRename}
                onNewFile={onNewFile}
                onNewFolder={onNewFolder}
                onCollapse={onCollapse}
                onReveal={onReveal}
                depth={depth + 1}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function AsyncDirChildren(props: Omit<FileTreeProps, "entries"> & { path: string }) {
  const refreshKey = useUIStore((s) => s.fileTreeRefreshKey);
  const [children, setChildren] = useState<FileEntry[]>([]);
  useEffect(() => {
    let cancelled = false;
    readDir(props.path)
      .then((entries) => { if (!cancelled) setChildren(entries); })
      .catch(() => { if (!cancelled) setChildren([]); });
    return () => { cancelled = true; };
  }, [props.path, refreshKey]);
  return <FileTree entries={children} {...props} />;
}
