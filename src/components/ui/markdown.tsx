import { cn } from "@/lib/utils"
import { marked } from "marked"
import React, { memo, useId, useMemo } from "react"
import ReactMarkdown, { Components } from "react-markdown"
import remarkBreaks from "remark-breaks"
import remarkGfm from "remark-gfm"
import { CodeBlock, CodeBlockCode, CodeBlockHeader } from "./code-block"

// ─── Color detection for inline swatches ────────────────────────────────────
// Matches: #RGB, #RRGGBB, #RRGGBBAA, oklch(...), rgb(...), rgba(...),
// hsl(...), hsla(...), and CSS named colors in prose context.
// See: https://www.w3.org/TR/css-color-4/

const NAMED_COLORS = new Set([
  "red","blue","green","yellow","orange","purple","pink","brown","black","white",
  "gray","grey","cyan","magenta","lime","navy","teal","maroon","olive","silver",
  "gold","coral","violet","indigo","crimson","turquoise","salmon","plum","khaki",
  "tan","azure","ivory","beige","wheat","lavender","mint","skyblue","tomato",
  "orangered","hotpink","darkred","darkblue","darkgreen","darkorange",
])

const COLOR_RE = /(#[0-9a-fA-F]{3,8}\b)|(oklch\([^)]+\))|(rgba?\([^)]+\))|(hsla?\([^)]+\))/g

function parseColorValue(text: string): string | null {
  const trimmed = text.trim()
  // Inline code: `#ff0000`, `oklch(0.5 0.2 30)`
  const match = trimmed.match(COLOR_RE)
  if (match) return match[0]
  // Named colors (lowercase)
  if (NAMED_COLORS.has(trimmed.toLowerCase())) return trimmed.toLowerCase()
  return null
}

function ColorSwatch({ color }: { color: string }) {
  return (
    <span
      className="inline-block size-3 rounded border border-border align-middle mx-0.5 shrink-0"
      style={{ backgroundColor: color }}
      title={color}
    />
  )
}

export type MarkdownProps = {
  children: string
  id?: string
  className?: string
  isStreaming?: boolean
  components?: Partial<Components>
}

function parseMarkdownIntoBlocks(markdown: string): string[] {
  const tokens = marked.lexer(markdown)
  return tokens.map((token) => token.raw)
}

// Override `pre` to handle ALL fenced code blocks (with or without a language tag).
// react-markdown routes block code as <pre><code className="language-*">...</code></pre>.
// Intercepting `pre` is robust: it handles named fences (```tsx) and unnamed (```)
// alike, without relying on node position heuristics.
// Source: react-markdown README — "Use custom components (syntax highlight)"
// https://github.com/remarkjs/react-markdown#use-custom-components-syntax-highlight
const INITIAL_COMPONENTS: Partial<Components> = {
  pre: function PreComponent({ children }) {
    // Find the inner <code> element — use toArray to avoid throwing on edge cases
    const codeEl = React.Children.toArray(children).find(
      (c): c is React.ReactElement<{ className?: string; children?: string }> =>
        React.isValidElement(c)
    )
    if (!codeEl) return <pre>{children}</pre>

    const language = /language-(\w+)/.exec(codeEl.props.className ?? "")?.[1] ?? "text"
    // String() handles ReactNode; strip the trailing newline react-markdown appends
    const code = String(codeEl.props.children ?? "").replace(/\n$/, "")
    return (
      <CodeBlock>
        <CodeBlockHeader language={language} code={code} />
        <CodeBlockCode code={code} language={language} />
      </CodeBlock>
    )
  },
  // Only inline code reaches this renderer — block code is fully handled by pre
  code: function CodeComponent({ children, className }) {
    const text = String(children ?? "")
    const color = parseColorValue(text)
    return (
      <span
        className={cn(
          "bg-primary-foreground rounded-sm px-1 font-mono text-sm inline-flex items-center gap-0.5",
          className
        )}
      >
        {color && <ColorSwatch color={color} />}
        {children}
      </span>
    )
  },
}

const MemoizedMarkdownBlock = memo(
  function MarkdownBlock({
    content,
    components = INITIAL_COMPONENTS,
  }: {
    content: string
    components?: Partial<Components>
  }) {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} components={components}>
        {content}
      </ReactMarkdown>
    )
  },
  (prev, next) => prev.content === next.content
)

MemoizedMarkdownBlock.displayName = "MemoizedMarkdownBlock"

function MarkdownComponent({
  children,
  id,
  className,
  isStreaming,
  components: customComponents,
}: MarkdownProps) {
  const generatedId = useId()
  const blockId = id ?? generatedId
  // Merge default renderers (pre/code for fenced blocks) with caller overrides
  const components = useMemo(
    () => ({ ...INITIAL_COMPONENTS, ...customComponents }),
    [customComponents],
  )
  // During streaming, skip marked.lexer block-split — it breaks on unclosed fences.
  // A single ReactMarkdown pass handles partial markdown safely.
  const blocks = useMemo(
    () => (isStreaming ? [children] : parseMarkdownIntoBlocks(children)),
    [children, isStreaming]
  )

  return (
    <div className={className}>
      {blocks.map((block, index) => (
        <MemoizedMarkdownBlock
          key={`${blockId}-block-${index}`}
          content={block}
          components={components}
        />
      ))}
    </div>
  )
}

const Markdown = memo(MarkdownComponent)
Markdown.displayName = "Markdown"

export { Markdown }
