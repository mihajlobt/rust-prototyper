import { X } from "lucide-react"
import type { AttachmentFile } from "@/types/chat"

interface AttachmentChipProps {
  file: AttachmentFile
  onRemove: () => void
}

export function AttachmentChip({ file, onRemove }: AttachmentChipProps) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs">
      <img
        src={file.previewUrl}
        alt={file.name}
        className="h-4 w-4 rounded object-cover flex-shrink-0"
      />
      <span className="max-w-[80px] truncate">{file.name}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Remove attachment"
      >
        <X size={10} />
      </button>
    </div>
  )
}
