import { useEffect, useState } from "react"
import { Component, Palette, Monitor } from "lucide-react"
import { readDir } from "@/lib/ipc"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { MentionAsset } from "@/types/chat"

const TYPE_ICONS = {
  component: <Component size={11} />,
  theme: <Palette size={11} />,
  screen: <Monitor size={11} />,
} as const

interface MentionPickerProps {
  query: string
  projectPath: string
  onSelect: (asset: Omit<MentionAsset, "code">) => void
  onClose: () => void
}

export function MentionPicker({ query, projectPath, onSelect, onClose }: MentionPickerProps) {
  const [assets, setAssets] = useState<Omit<MentionAsset, "code">[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    loadProjectAssets(projectPath).then(setAssets)
  }, [projectPath])

  const filtered = assets.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => { setActiveIndex(0) }, [query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const item = filtered[activeIndex]
        if (item) onSelect(item)
      } else if (e.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [filtered, activeIndex, onSelect, onClose])

  if (filtered.length === 0) return null

  return (
    <ScrollArea className="absolute bottom-full mb-1 left-0 z-50 w-64 rounded-md border border-border bg-popover shadow-lg max-h-48 overflow-hidden">
      <div>
        {filtered.map((asset, i) => (
          <button
            key={asset.id}
            className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent/10 ${
              i === activeIndex ? "bg-accent/10" : ""
            }`}
            onMouseDown={(e) => {
              e.preventDefault() // don't blur textarea
              onSelect(asset)
            }}
          >
            {TYPE_ICONS[asset.type]}
            <span className="flex-1 text-left truncate">{asset.name}</span>
            <span className="text-xs text-muted-foreground">{asset.type}</span>
          </button>
        ))}
      </div>
    </ScrollArea>
  )
}

async function loadProjectAssets(projectPath: string): Promise<Omit<MentionAsset, "code">[]> {
  const assets: Omit<MentionAsset, "code">[] = []
  const sections: Array<{ dir: string; type: MentionAsset["type"]; file: string }> = [
    { dir: "components", type: "component", file: "component.tsx" },
    { dir: "themes",     type: "theme",     file: "theme.css" },
    { dir: "screens",    type: "screen",    file: "screen.tsx" },
  ]
  for (const { dir, type, file } of sections) {
    try {
      const entries = await readDir(`${projectPath}/${dir}`)
      for (const entry of entries) {
        if (entry.is_dir) {
          assets.push({
            id: entry.name,
            type,
            name: entry.name,
            path: `${projectPath}/${dir}/${entry.name}/${file}`,
          })
        }
      }
    } catch {
      // directory may not exist yet
    }
  }
  return assets
}
