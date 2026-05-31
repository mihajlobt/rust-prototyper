"use client"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { CheckCircle, ChevronDown, Loader2, Settings, XCircle } from "lucide-react"
import { useState } from "react"
import type { ReactNode } from "react"

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToolPart = {
  type: string
  state:
    | "input-streaming"
    | "input-available"
    | "output-available"
    | "output-empty"
    | "output-error"
  input?: Record<string, unknown>
  output?: Record<string, unknown>
  toolCallId?: string
  errorText?: string
  /** edit_file: before/after strings for diff rendering. */
  diff?: { oldString: string; newString: string }
  /** read_file / write_file: file content for code view rendering. */
  fileContent?: { path: string; content: string }
}

export type ToolProps = {
  toolPart: ToolPart
  defaultOpen?: boolean
  className?: string
}

// ─── Diff block ───────────────────────────────────────────────────────────────

const MAX_DIFF_LINES = 80

function DiffBlock({ oldString, newString }: { oldString: string; newString: string }) {
  type DiffLine = { kind: "removed" | "added"; content: string }
  const removedLines: DiffLine[] = oldString.split("\n").map((content) => ({ kind: "removed", content }))
  const addedLines: DiffLine[]   = newString.split("\n").map((content) => ({ kind: "added",   content }))
  const allLines = [...removedLines, ...addedLines]
  const truncated = allLines.length > MAX_DIFF_LINES
  const displayLines = truncated ? allLines.slice(0, MAX_DIFF_LINES) : allLines

  return (
    <div className="rounded border overflow-hidden font-mono text-xs">
      {displayLines.map((line, i) => (
        <div
          key={i}
          className={cn(
            "flex gap-2 px-2 py-px whitespace-pre-wrap break-all leading-5",
            line.kind === "removed"
              ? "bg-red-500/10 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              : "bg-green-500/10 text-green-600 dark:bg-green-500/10 dark:text-green-400",
          )}
        >
          <span className="w-3 shrink-0 select-none opacity-50">{line.kind === "removed" ? "-" : "+"}</span>
          <span>{line.content || " "}</span>
        </div>
      ))}
      {truncated && (
        <div className="bg-muted/30 px-2 py-1 text-xs text-muted-foreground">
          … {allLines.length - MAX_DIFF_LINES} more lines
        </div>
      )}
    </div>
  )
}

// ─── File content block ───────────────────────────────────────────────────────

const MAX_CONTENT_LINES = 120

function FileContentBlock({ content }: { content: string }) {
  // Lines may be "N: code" (read_file) or plain (write_file). Both are handled.
  // Strip trailing pagination note "(Showing N lines. Use offset=M to continue.)"
  const lines = content.split("\n")
  const noteIndex = lines.findIndex((l) => /^\(Showing \d+ lines/.test(l.trim()))
  const codeLines = noteIndex >= 0 ? lines.slice(0, noteIndex) : lines
  const note      = noteIndex >= 0 ? lines.slice(noteIndex).join(" ").trim() : undefined
  const truncated = codeLines.length > MAX_CONTENT_LINES
  const displayLines = truncated ? codeLines.slice(0, MAX_CONTENT_LINES) : codeLines

  return (
    <div className="rounded border overflow-hidden font-mono text-xs">
      {displayLines.map((line, i) => {
        const match = line.match(/^(\s*\d+):\s?(.*)$/)
        const lineNum = match ? match[1].trim() : null
        const code    = match ? match[2] : line
        return (
          <div key={i} className="flex leading-5 hover:bg-muted/30">
            <span className="w-10 shrink-0 select-none text-right pr-3 text-muted-foreground/50 border-r border-border">
              {lineNum ?? ""}
            </span>
            <span className="px-3 whitespace-pre-wrap break-all text-foreground/90">{code}</span>
          </div>
        )
      })}
      {(truncated || note) && (
        <div className="bg-muted/30 px-3 py-1 text-xs text-muted-foreground border-t border-border">
          {truncated && `… ${codeLines.length - MAX_CONTENT_LINES} more lines`}
          {truncated && note && " · "}
          {note}
        </div>
      )}
    </div>
  )
}

// ─── Renderer registry ────────────────────────────────────────────────────────
//
// To add custom rendering for a new tool type, add an entry here.
// Each renderer receives the full ToolPart and returns ReactNode (or null to
// fall through to the generic input/output blocks).

type ToolRenderer = (part: ToolPart) => ReactNode

const TOOL_RENDERERS: Partial<Record<string, ToolRenderer>> = {
  edit_file: (part) =>
    part.diff ? (
      <>
        <ScrollArea className="max-h-96 overflow-hidden">
          <DiffBlock oldString={part.diff.oldString} newString={part.diff.newString} />
        </ScrollArea>
        {part.fileContent?.path && (
          <p className="text-xs text-muted-foreground font-mono truncate">{part.fileContent.path}</p>
        )}
      </>
    ) : null,

  read_file: (part) =>
    part.fileContent ? (
      <>
        <ScrollArea className="max-h-96 overflow-hidden">
          <FileContentBlock content={part.fileContent.content} />
        </ScrollArea>
        <p className="text-xs text-muted-foreground font-mono truncate">{part.fileContent.path}</p>
      </>
    ) : null,

  write_file: (part) =>
    part.fileContent ? (
      <>
        <ScrollArea className="max-h-96 overflow-hidden">
          <FileContentBlock content={part.fileContent.content} />
        </ScrollArea>
        <p className="text-xs text-muted-foreground font-mono truncate">{part.fileContent.path}</p>
      </>
    ) : null,
}

// Tool types that show filename in the header alongside the tool name.
const SHOW_FILENAME_FOR = new Set(["edit_file", "read_file", "write_file"])

// ─── Tool card ────────────────────────────────────────────────────────────────

const Tool = ({ toolPart, defaultOpen = false, className }: ToolProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const { state, input, output, toolCallId } = toolPart

  const stateIcon = (() => {
    switch (state) {
      case "input-streaming": return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
      case "input-available":  return <Settings className="h-4 w-4 text-orange-500" />
      case "output-available": return <CheckCircle className="h-4 w-4 text-green-500" />
      case "output-empty":     return <CheckCircle className="h-4 w-4 text-muted-foreground" />
      case "output-error":     return <XCircle className="h-4 w-4 text-red-500" />
      default:                 return <Settings className="text-muted-foreground h-4 w-4" />
    }
  })()

  const stateBadge = (() => {
    const base = "px-2 py-1 rounded-full text-xs font-medium"
    switch (state) {
      case "input-streaming": return <span className={cn(base, "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400")}>Processing</span>
      case "input-available":  return <span className={cn(base, "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400")}>Ready</span>
      case "output-available": return <span className={cn(base, "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400")}>Completed</span>
      case "output-empty":     return <span className={cn(base, "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400")}>Info</span>
      case "output-error":     return <span className={cn(base, "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400")}>Error</span>
      default:                 return <span className={cn(base, "bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400")}>Pending</span>
    }
  })()

  const formatValue = (value: unknown): string => {
    if (value === null || value === undefined) return String(value)
    if (typeof value === "string") return value
    return JSON.stringify(value, null, 2)
  }

  const filePath = toolPart.fileContent?.path ?? (typeof input?.path === "string" ? input.path : undefined)
  const fileName = filePath ? filePath.split("/").pop() : undefined
  const customContent = TOOL_RENDERERS[toolPart.type]?.(toolPart) ?? null
  const useGenericBlocks = customContent === null

  return (
    <div className={cn("border-border overflow-hidden rounded-lg border", className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="bg-background h-auto w-full justify-between rounded-b-none px-3 py-2 font-normal"
          >
            <div className="flex items-center gap-2 min-w-0">
              {stateIcon}
              <span className="font-mono text-sm font-medium shrink-0">{toolPart.type}</span>
              {SHOW_FILENAME_FOR.has(toolPart.type) && fileName && (
                <span className="font-mono text-xs text-muted-foreground truncate">{fileName}</span>
              )}
              {stateBadge}
            </div>
            <ChevronDown className={cn("h-4 w-4 shrink-0", isOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-border border-t data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
          <div className="bg-background space-y-3 p-3">

            {/* Custom renderer output */}
            {customContent}

            {/* Generic input/output blocks for tools without a custom renderer */}
            {useGenericBlocks && input && Object.keys(input).length > 0 && (
              <div>
                <h4 className="text-muted-foreground mb-2 text-sm font-medium">Input</h4>
                <div className="bg-background rounded border p-2 font-mono text-sm">
                  {Object.entries(input).map(([key, value]) => (
                    <div key={key} className="mb-1">
                      <span className="text-muted-foreground">{key}:</span>{" "}
                      <span>{formatValue(value)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {useGenericBlocks && output && (
              <div>
                <h4 className="text-muted-foreground mb-2 text-sm font-medium">Output</h4>
                <ScrollArea className="max-h-60 overflow-hidden">
                  <div className="bg-background rounded border p-2 font-mono text-sm">
                    <pre className="whitespace-pre-wrap">{formatValue(output)}</pre>
                  </div>
                </ScrollArea>
              </div>
            )}

            {state === "output-error" && toolPart.errorText && (
              <div>
                <h4 className="mb-2 text-sm font-medium text-red-500">Error</h4>
                <div className="bg-background rounded border border-red-200 p-2 text-sm dark:border-red-950 dark:bg-red-900/20">
                  {toolPart.errorText}
                </div>
              </div>
            )}

            {state === "input-streaming" && (
              <div className="text-muted-foreground text-sm">Processing tool call…</div>
            )}

            {toolCallId && (
              <div className="text-muted-foreground border-t border-blue-200 pt-2 text-xs">
                <span className="font-mono">Call ID: {toolCallId}</span>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}

export { Tool }
