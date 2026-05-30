import { useEffect, useState } from "react"
import { Component, Palette, Monitor, Plug, FileText } from "lucide-react"
import { readFile } from "@/lib/ipc"
import { ScrollArea } from "@/components/ui/scroll-area"
import type { MentionAsset } from "@/types/chat"

// PickerItem extends MentionAsset (minus code) with optional fields:
//   preCode  — content already known at load time (APIs); skips file read on select
//   palette  — up to 5 oklch/hex color strings extracted from theme CSS for swatch preview
export type PickerItem = Omit<MentionAsset, "code"> & {
  preCode?: string
  description?: string
  palette?: string[]
}

const TYPE_ICONS: Record<MentionAsset["type"], React.ReactNode> = {
  component: <Component size={11} />,
  theme: <Palette size={11} />,
  screen: <Monitor size={11} />,
  api: <Plug size={11} />,
  file: <FileText size={11} />,
}

interface MentionPickerProps {
  query: string
  projectPath: string
  onSelect: (item: PickerItem) => void
  onClose: () => void
}

export function MentionPicker({ query, projectPath, onSelect, onClose }: MentionPickerProps) {
  const [assets, setAssets] = useState<PickerItem[]>([])
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
    <div className="absolute bottom-full mb-1 left-0 z-50 w-72 rounded-md border border-border bg-popover shadow-lg">
      <ScrollArea className="h-48">
        <div className="p-1">
          {filtered.map((asset, i) => (
            <button
              key={asset.id}
              className={`flex w-full items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-accent/10 rounded ${
                i === activeIndex ? "bg-accent/10" : ""
              }`}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(asset)
              }}
            >
              <span className="text-muted-foreground shrink-0">{TYPE_ICONS[asset.type]}</span>

              <div className="flex-1 min-w-0 text-left">
                <div className="font-medium truncate leading-tight">{asset.name}</div>
                {asset.description && (
                  <div className="text-[10px] text-muted-foreground truncate mt-0.5">{asset.description}</div>
                )}
              </div>

              {/* Theme palette swatches */}
              {asset.palette && asset.palette.length > 0 && (
                <div className="flex gap-0.5 shrink-0">
                  {asset.palette.map((color, ci) => (
                    <span
                      key={ci}
                      className="w-3 h-3 rounded-sm inline-block border border-border/30"
                      style={{ background: color }}
                    />
                  ))}
                </div>
              )}

              {/* API method badge */}
              {asset.type === "api" && asset.description && (
                <span className={[
                  "shrink-0 text-[9px] font-bold px-1 py-0.5 rounded",
                  asset.description.startsWith("POST") ? "bg-blue-500/10 text-blue-600" : "bg-green-500/10 text-green-600",
                ].join(" ")}>
                  {asset.description.split(" ")[0]}
                </span>
              )}
            </button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}

// ─── Palette extraction ────────────────────────────────────────────────────────

function extractThemePalette(css: string): string[] {
  const keys = ["--background", "--primary", "--secondary", "--accent", "--destructive"]
  const colors: string[] = []
  for (const key of keys) {
    const match = css.match(new RegExp(`${key}:\\s*([^;\\n]+)`))
    if (match) colors.push(match[1].trim())
  }
  return colors
}

// ─── Asset loader ──────────────────────────────────────────────────────────────

async function loadProjectAssets(projectPath: string): Promise<PickerItem[]> {
  const assets: PickerItem[] = []
  const { readDir } = await import("@/lib/ipc")

  // Components
  try {
    const entries = await readDir(`${projectPath}/components`)
    for (const e of entries) {
      if (e.is_dir) assets.push({
        id: e.name,
        type: "component",
        name: e.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: "React component",
        path: `${projectPath}/components/${e.name}/component.tsx`,
      })
    }
  } catch { /* no components dir */ }

  // Screens
  try {
    const entries = await readDir(`${projectPath}/screens`)
    for (const e of entries) {
      if (e.is_dir) assets.push({
        id: e.name,
        type: "screen",
        name: e.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: "Screen component",
        path: `${projectPath}/screens/${e.name}/screen.tsx`,
      })
    }
  } catch { /* no screens dir */ }

  // Themes — load CSS to extract palette swatches
  try {
    const entries = await readDir(`${projectPath}/themes`)
    for (const e of entries) {
      if (!e.is_dir) continue
      const cssPath = `${projectPath}/themes/${e.name}/theme.css`
      let palette: string[] = []
      try {
        const css = await readFile(cssPath)
        palette = extractThemePalette(css)
      } catch { /* palette stays empty */ }
      assets.push({
        id: e.name,
        type: "theme",
        name: e.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        description: "CSS theme",
        path: cssPath,
        palette,
      })
    }
  } catch { /* no themes dir */ }

  // Markdown docs — .md files at the project root (e.g. coding-standards.md, README.md)
  try {
    const entries = await readDir(projectPath)
    for (const e of entries) {
      if (!e.is_dir && e.name.endsWith(".md")) {
        assets.push({
          id: e.name,
          type: "file",
          name: e.name,
          description: "Markdown document",
          path: `${projectPath}/${e.name}`,
        })
      }
    }
  } catch { /* no docs */ }

  // APIs — code computed eagerly; description = "METHOD url"
  try {
    const raw = await readFile(`${projectPath}/apis/apis.json`)
    const list = JSON.parse(raw) as Array<{
      id: string; name: string; method: string; url: string; proxyPath?: string
    }>
    for (const api of list) {
      const base = api.proxyPath?.trim() || api.url
      const keyMatch = api.url.match(/\{\{(\w+)\}\}/)
      const authLine = keyMatch ? `\nAuth: import.meta.env.VITE_${keyMatch[1]}` : ""
      assets.push({
        id: api.id,
        type: "api",
        name: api.name,
        // description drives the method badge + subtitle
        description: `${api.method} ${base}`,
        path: `${projectPath}/apis/apis.json`,
        preCode: `${api.method} ${base}${authLine}`,
      })
    }
  } catch { /* no apis yet */ }

  return assets
}
