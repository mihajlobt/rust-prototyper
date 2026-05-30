import { X, Component, Palette, Monitor, Plug, FileText } from "lucide-react"
import type { MentionAsset } from "@/types/chat"

const TYPE_ICONS: Record<MentionAsset["type"], React.ReactNode> = {
  component: <Component size={10} />,
  theme: <Palette size={10} />,
  screen: <Monitor size={10} />,
  api: <Plug size={10} />,
  file: <FileText size={10} />,
}

interface MentionChipProps {
  asset: MentionAsset
  onRemove: () => void
}

export function MentionChip({ asset, onRemove }: MentionChipProps) {
  return (
    <div className="flex items-start gap-1.5 rounded border border-border bg-accent/10 px-2 py-1 text-xs max-w-48">
      <span className="text-muted-foreground mt-0.5 shrink-0">{TYPE_ICONS[asset.type]}</span>
      <div className="flex-1 min-w-0">
        <div className="font-medium leading-tight truncate">{asset.name}</div>
        {asset.description && (
          <div className="text-[10px] text-muted-foreground leading-tight truncate mt-0.5">{asset.description}</div>
        )}
      </div>
      <button
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground shrink-0 mt-0.5"
        aria-label="Remove mention"
      >
        <X size={10} />
      </button>
    </div>
  )
}
