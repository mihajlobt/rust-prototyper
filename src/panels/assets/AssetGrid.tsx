import { FolderOpen, Trash2 } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { cn } from "@/lib/utils";
import { revealInExplorer } from "@/lib/ipc";
import type { AssetInfo } from "@/lib/bonsai";

interface AssetGridProps {
  assets: AssetInfo[];
  selectedIndex: number | undefined;
  onSelect: (index: number) => void;
  onDelete: (fileName: string) => void;
  assetUrl: (filePath: string) => string;
}

export function AssetGrid({ assets, selectedIndex, onSelect, onDelete, assetUrl }: AssetGridProps) {
  if (assets.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-muted-foreground gap-2">
        <FolderOpen size={32} className="opacity-50" />
        <span className="text-sm">No images yet</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {assets.map((asset, index) => (
        <AssetCard
          key={asset.file_name}
          asset={asset}
          isSelected={selectedIndex === index}
          onSelect={() => onSelect(index)}
          onDelete={() => onDelete(asset.file_name)}
          onReveal={() => revealInExplorer(asset.file_path)}
          assetUrl={assetUrl}
        />
      ))}
    </div>
  );
}

function AssetCard({
  asset,
  isSelected,
  onSelect,
  onDelete,
  onReveal,
  assetUrl,
}: {
  asset: AssetInfo;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onReveal: () => void;
  assetUrl: (filePath: string) => string;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "relative rounded-md overflow-hidden border cursor-pointer group transition-colors",
            isSelected ? "border-primary" : "border-border hover:border-primary/50",
          )}
          onClick={onSelect}
        >
          <img
            src={assetUrl(asset.file_path)}
            alt={asset.file_name}
            className="w-full aspect-square object-cover"
          />
          {/* Top-right delete button on hover */}
          <button
            type="button"
            className="absolute top-1 right-1 p-1 rounded bg-black/50 text-white/70 hover:text-white hover:bg-black/70 opacity-0 group-hover:opacity-100 transition-all"
            onClick={(event) => {
              event.stopPropagation();
              onDelete();
            }}
          >
            <Trash2 size={12} />
          </button>
          {/* Filename label at bottom */}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
            <span className="text-[10px] text-white truncate block">{asset.file_name}</span>
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