import { Image, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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
        <Image size={32} className="opacity-50" />
        <span className="text-sm">No images yet</span>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2 p-3">
      {assets.map((asset, index) => (
        <div
          key={asset.file_name}
          className={cn(
            "relative rounded-md overflow-hidden border cursor-pointer group transition-colors",
            selectedIndex === index
              ? "border-primary"
              : "border-border hover:border-primary/50"
          )}
          onClick={() => onSelect(index)}
        >
          <img
            src={assetUrl(asset.file_path)}
            alt={asset.file_name}
            className="w-full aspect-square object-cover"
          />
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
            <Button
              variant="destructive"
              size="icon"
              className="h-7 w-7"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(asset.file_name);
              }}
            >
              <Trash2 size={12} />
            </Button>
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/60 to-transparent p-1.5">
            <span className="text-[10px] text-white truncate block">{asset.file_name}</span>
          </div>
        </div>
      ))}
    </div>
  );
}