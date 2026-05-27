import { X, Component, Palette, Monitor, Plug } from "lucide-react"
import type { MentionAsset } from "@/types/chat"

const TYPE_ICONS: Record<MentionAsset["type"], React.ReactNode> = {
  component: <Component size={10} />,
  theme: <Palette size={10} />,
  screen: <Monitor size={10} />,
  api: <Plug size={10} />,
}

interface MentionChipProps {
  asset: MentionAsset
  onRemove: () => void
}

export function MentionChip({ asset, onRemove }: MentionChipProps) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-accent/10 px-1.5 py-0.5 text-xs">
      {TYPE_ICONS[asset.type]}
      <span>{asset.name}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Remove mention"
      >
        <X size={10} />
      </button>
    </div>
  )
}
