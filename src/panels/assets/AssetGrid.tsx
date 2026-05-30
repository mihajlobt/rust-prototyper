import { useEffect, useRef } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { revealInExplorer } from "@/lib/ipc";
import type { AssetInfo } from "@/lib/bonsai";

export type AssetViewMode = "list" | "grid";

interface AssetGridProps {
  assets: AssetInfo[];
  selectedIndex: number | undefined;
  onSelect: (index: number) => void;
  onDelete: (fileName: string) => void;
  assetUrl: (filePath: string) => string;
  viewMode: AssetViewMode;
  highlightFileName?: string;
}

export function AssetGrid({ assets, selectedIndex, onSelect, onDelete, assetUrl, viewMode, highlightFileName }: AssetGridProps) {
  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <FolderOpen size={32} className="opacity-50" />
        <span className="text-sm">No images yet</span>
      </div>
    );
  }

  if (viewMode === "grid") {
    return (
      <div className="grid grid-cols-2 gap-2 p-3">
        {assets.map((asset, index) => (
          <AssetCardGrid
            key={asset.file_name}
            asset={asset}
            isSelected={selectedIndex === index}
            isHighlighted={asset.file_name === highlightFileName}
            onSelect={() => onSelect(index)}
            onDelete={() => onDelete(asset.file_name)}
            onReveal={() => revealInExplorer(asset.file_path)}
            assetUrl={assetUrl}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      {assets.map((asset, index) => (
        <AssetCardList
          key={asset.file_name}
          asset={asset}
          isSelected={selectedIndex === index}
          isHighlighted={asset.file_name === highlightFileName}
          onSelect={() => onSelect(index)}
          onDelete={() => onDelete(asset.file_name)}
          onReveal={() => revealInExplorer(asset.file_path)}
          assetUrl={assetUrl}
        />
      ))}
    </div>
  );
}

interface AssetCardBaseProps {
  asset: AssetInfo;
  isSelected: boolean;
  isHighlighted: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onReveal: () => void;
  assetUrl: (filePath: string) => string;
}

/* ── List view: dense row with inline thumbnail ── */

function AssetCardList({
  asset,
  isSelected,
  isHighlighted,
  onSelect,
  onDelete,
  onReveal,
  assetUrl,
}: AssetCardBaseProps) {
  const highlightRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isHighlighted && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isHighlighted]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <button
          ref={highlightRef}
          type="button"
          className={cn(
            "asset-row w-full flex items-start gap-2 px-3 py-1.5 border-b border-border text-left hover:bg-muted/50 transition-colors",
            isSelected && "bg-muted/50 border-l-2 border-l-primary",
            isHighlighted && "asset-highlight",
          )}
          onClick={onSelect}
        >
          <img
            src={assetUrl(asset.file_path)}
            alt={asset.file_name}
            className="w-10 h-10 rounded-sm object-cover shrink-0 bg-muted/30 border border-border"
          />
          <div className="flex-1 min-w-0 py-0.5">
            <div className="text-xs leading-tight" title={asset.prompt ?? asset.file_name}>
              {asset.prompt ?? asset.file_name}
            </div>
            <div className="flex items-center gap-2 text-[10px] font-mono text-muted-foreground leading-tight mt-0.5">
              <span>{asset.file_name}</span>
              <span className="text-border">|</span>
              <span>{(asset.file_size / 1024).toFixed(0)}KB</span>
            </div>
          </div>
          <button
            type="button"
            className="p-1 rounded text-muted-foreground opacity-0 hover:text-destructive shrink-0 [&:hover_->_svg]:text-destructive"
            onClick={(event) => { event.stopPropagation(); onDelete(); }}
          >
            <Trash2 size={12} />
          </button>
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onReveal}>
          <FolderOpen size={12} className="mr-2" />
          Show in File Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 size={12} className="mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

/* ── Grid view: thumbnail card with full metadata below ── */

function AssetCardGrid({
  asset,
  isSelected,
  isHighlighted,
  onSelect,
  onDelete,
  onReveal,
  assetUrl,
}: AssetCardBaseProps) {
  const highlightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isHighlighted && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isHighlighted]);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          ref={highlightRef}
          className={cn(
            "relative rounded-sm overflow-hidden border cursor-pointer group transition-colors",
            isSelected ? "border-primary" : "border-border hover:border-primary/50",
            isHighlighted && "asset-highlight",
          )}
          onClick={onSelect}
        >
          <img
            src={assetUrl(asset.file_path)}
            alt={asset.file_name}
            className="w-full aspect-square object-cover"
          />
          {/* Hover delete */}
          <button
            type="button"
            className="absolute top-1 right-1 p-1 rounded bg-background/80 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(event) => { event.stopPropagation(); onDelete(); }}
          >
            <Trash2 size={12} />
          </button>
          {/* Metadata block below image — no truncation */}
          <div className="p-2 border-t border-border bg-card">
            <div className="text-xs leading-snug">
              {asset.prompt ?? asset.file_name}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-mono text-muted-foreground mt-1">
              <span>{asset.file_name}</span>
              <span className="text-border">|</span>
              <span>{(asset.file_size / 1024).toFixed(0)}KB</span>
            </div>
          </div>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onReveal}>
          <FolderOpen size={12} className="mr-2" />
          Show in File Explorer
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
          <Trash2 size={12} className="mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}