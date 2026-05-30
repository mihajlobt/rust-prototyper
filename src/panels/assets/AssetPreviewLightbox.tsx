import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ChevronLeft, ChevronRight, FolderOpen, Trash2 } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { AssetInfo } from "@/lib/bonsai";
import { revealInExplorer } from "@/lib/ipc";

interface AssetPreviewLightboxProps {
  previewIndex: number | undefined;
  setPreviewIndex: Dispatch<SetStateAction<number | undefined>>;
  assets: AssetInfo[];
  assetUrl: (filePath: string) => string;
  onDelete?: (fileName: string) => void;
}

function LightboxOverlay({
  previewIndex,
  setPreviewIndex,
  assets,
  assetUrl,
  onDelete,
}: AssetPreviewLightboxProps) {
  const asset = previewIndex !== undefined ? assets[previewIndex] : undefined;
  const currentIndex = previewIndex ?? 0;
  const canPrev = previewIndex !== undefined && previewIndex > 0;
  const canNext = previewIndex !== undefined && previewIndex < assets.length - 1;

  const handleClose = useCallback(() => {
    setPreviewIndex(undefined);
  }, [setPreviewIndex]);

  const handlePrev = useCallback(() => {
    if (canPrev) setPreviewIndex((prev) => (prev !== undefined ? prev - 1 : prev));
  }, [canPrev, setPreviewIndex]);

  const handleNext = useCallback(() => {
    if (canNext) setPreviewIndex((prev) => (prev !== undefined ? prev + 1 : prev));
  }, [canNext, setPreviewIndex]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        handlePrev();
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        handleNext();
      }
    },
    [handleClose, handlePrev, handleNext],
  );

  useEffect(() => {
    document.addEventListener("keydown", handleKeyDown);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = prevOverflow;
    };
  }, [handleKeyDown]);

  if (!asset) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-background/95"
      onClick={handleClose}
    >
      {/* Top bar — close + actions */}
      <div className="absolute top-0 left-0 right-0 h-10 flex items-center gap-1 px-3 border-b border-border bg-background">
        <span className="text-xs font-mono text-muted-foreground">{currentIndex + 1}/{assets.length}</span>
        <div className="flex-1" />
        <button
          type="button"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Show in File Explorer"
          onClick={(event) => {
            event.stopPropagation();
            revealInExplorer(asset.file_path);
          }}
        >
          <FolderOpen size={14} />
        </button>
        <button
          type="button"
          className="p-1.5 rounded text-muted-foreground hover:text-destructive transition-colors"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            if (onDelete) onDelete(asset.file_name);
            handleClose();
          }}
        >
          <Trash2 size={14} />
        </button>
        <button
          type="button"
          className="p-1.5 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          onClick={handleClose}
        >
          <X size={14} />
        </button>
      </div>

      {/* Prev button */}
      {assets.length > 1 && (
        <button
          type="button"
          className="absolute left-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground disabled:text-muted-foreground/30 transition-colors"
          disabled={!canPrev}
          onClick={(event) => {
            event.stopPropagation();
            handlePrev();
          }}
        >
          <ChevronLeft size={20} />
        </button>
      )}

      {/* Image + metadata */}
      <div
        className="flex flex-col items-center max-h-full px-14 py-10"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={assetUrl(asset.file_path)}
          alt={asset.file_name}
          className="max-w-full max-h-[calc(100vh-10rem)] object-contain select-none border border-border"
          draggable={false}
        />

        {/* Metadata strip — monospace, code-native */}
        <div className="mt-3 flex flex-col items-center gap-1.5 max-w-[600px]">
          {asset.prompt && (
            <span className="text-sm text-foreground text-center leading-snug">{asset.prompt}</span>
          )}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 justify-center font-mono text-[10px] text-muted-foreground">
            <span className="truncate max-w-[200px]">{asset.file_name}</span>
            <span>{(asset.file_size / 1024).toFixed(1)}KB</span>
            <span>{new Date(asset.created_at * 1000).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Next button */}
      {assets.length > 1 && (
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-muted-foreground hover:text-foreground disabled:text-muted-foreground/30 transition-colors"
          disabled={!canNext}
          onClick={(event) => {
            event.stopPropagation();
            handleNext();
          }}
        >
          <ChevronRight size={20} />
        </button>
      )}
    </div>,
    document.body,
  );
}

export function AssetPreviewLightbox(props: AssetPreviewLightboxProps) {
  if (props.previewIndex === undefined || props.assets.length === 0) return null;
  return <LightboxOverlay {...props} />;
}