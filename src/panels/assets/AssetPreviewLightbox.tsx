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
}

function LightboxOverlay({
  previewIndex,
  setPreviewIndex,
  assets,
  assetUrl,
}: AssetPreviewLightboxProps) {
  const asset = previewIndex !== undefined ? assets[previewIndex] : undefined;
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
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      style={{ backgroundColor: "rgba(0, 0, 0, 0.85)" }}
      onClick={handleClose}
    >
      {/* Top-right actions */}
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <button
          type="button"
          className="p-2 rounded text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          title="Show in File Explorer"
          onClick={(event) => {
            event.stopPropagation();
            revealInExplorer(asset.file_path);
          }}
        >
          <FolderOpen size={18} />
        </button>
        <button
          type="button"
          className="p-2 rounded text-white/80 hover:text-red-400 hover:bg-white/10 transition-colors"
          title="Delete"
          onClick={(event) => {
            event.stopPropagation();
            handleClose();
            // Deletion is handled by parent after closing
          }}
        >
          <Trash2 size={18} />
        </button>
        <button
          type="button"
          className="p-2 rounded text-white/80 hover:text-white hover:bg-white/10 transition-colors"
          onClick={handleClose}
        >
          <X size={20} />
        </button>
      </div>

      {/* Prev button */}
      {assets.length > 1 && (
        <button
          type="button"
          className="absolute left-3 top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white disabled:text-white/30 transition-colors"
          disabled={!canPrev}
          onClick={(event) => {
            event.stopPropagation();
            handlePrev();
          }}
        >
          <ChevronLeft size={28} />
        </button>
      )}

      {/* Image */}
      <div
        className="flex flex-col items-center max-h-full px-14 py-10"
        onClick={(event) => event.stopPropagation()}
      >
        <img
          src={assetUrl(asset.file_path)}
          alt={asset.file_name}
          className="max-w-full max-h-[calc(100vh-8rem)] object-contain select-none"
          draggable={false}
        />
        <div className="mt-2 text-xs text-neutral-400 flex items-center gap-3">
          <span className="truncate max-w-[200px]">{asset.file_name}</span>
          <span>{(asset.file_size / 1024).toFixed(1)} KB</span>
          <span>{new Date(asset.created_at * 1000).toLocaleString()}</span>
        </div>
      </div>

      {/* Next button */}
      {assets.length > 1 && (
        <button
          type="button"
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 text-white/80 hover:text-white disabled:text-white/30 transition-colors"
          disabled={!canNext}
          onClick={(event) => {
            event.stopPropagation();
            handleNext();
          }}
        >
          <ChevronRight size={28} />
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