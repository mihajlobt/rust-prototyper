import { memo, useMemo, useState } from "react"
import { ChevronRight } from "lucide-react"
import { marked } from "marked"

interface TocHeading {
  id: string
  text: string
  level: number
  children: TocHeading[]
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .trim()
}

function extractHeadings(markdown: string): TocHeading[] {
  const tokens = marked.lexer(markdown)
  const flat: { id: string; text: string; level: number }[] = []

  for (const token of tokens) {
    if (token.type !== "heading") continue
    const raw = token.raw
    let text = raw.replace(/^#+\s*/, "").replace(/\s*\{#[\w-]+\}\s*$/, "").trim()
    if (!text) continue
    const level = token.depth
    const id = slugify(text)
    flat.push({ id, text, level })
  }

  const roots: TocHeading[] = []
  const stack: TocHeading[] = []

  for (const item of flat) {
    const node: TocHeading = { ...item, children: [] }
    while (stack.length > 0 && stack[stack.length - 1].level >= node.level) {
      stack.pop()
    }
    if (stack.length === 0) {
      roots.push(node)
    } else {
      stack[stack.length - 1].children.push(node)
    }
    stack.push(node)
  }

  return roots
}

function scrollToHeading(id: string) {
  const el = document.getElementById(id)
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" })
  }
}

const TocTree = memo(function TocTree({ headings, depth = 0 }: { headings: TocHeading[]; depth?: number }) {
  return (
    <ul className={depth === 0 ? "" : "ml-3"}>
      {headings.map((h) => (
        <TocNode key={h.id} heading={h} depth={depth} />
      ))}
    </ul>
  )
})

const TocNode = memo(function TocNode({ heading, depth }: { heading: TocHeading; depth: number }) {
  const hasChildren = heading.children.length > 0
  const [expanded, setExpanded] = useState(depth < 1)

  return (
    <li>
      <div className="flex items-center gap-0.5 py-0.5 group overflow-hidden">
        {hasChildren && (
          <button
            className="p-0.5 text-muted-foreground hover:text-foreground shrink-0"
            onClick={() => setExpanded(!expanded)}
          >
            <ChevronRight
              size={10}
              className={expanded ? "rotate-90 transition-transform" : "transition-transform"}
            />
          </button>
        )}
      <button
        className="text-xs leading-relaxed text-muted-foreground hover:text-foreground text-left truncate transition-colors"
        onClick={() => scrollToHeading(heading.id)}
        title={heading.text}
      >
          {heading.text}
        </button>
      </div>
      {hasChildren && expanded && <TocTree headings={heading.children} depth={depth + 1} />}
    </li>
  )
})

export const DesignToc = memo(function DesignToc({ markdown }: { markdown: string }) {
  const headings = useMemo(() => extractHeadings(markdown), [markdown])

  if (headings.length === 0) return null

  return (
    <div className="h-full overflow-auto p-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1 px-0.5">
        Outline
      </div>
      <TocTree headings={headings} />
    </div>
  )
})
