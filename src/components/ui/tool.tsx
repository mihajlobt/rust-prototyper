"use client"

import { Button } from "@/components/ui/button"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  CheckCircle,
  ChevronDown,
  Loader2,
  Settings,
  XCircle,
} from "lucide-react"
import { useState } from "react"

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
  /** Present for edit_file — the before/after strings for diff rendering. */
  diff?: { oldString: string; newString: string }
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
          <span className="w-3 shrink-0 select-none opacity-50">
            {line.kind === "removed" ? "-" : "+"}
          </span>
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

// ─── Tool card ────────────────────────────────────────────────────────────────

const Tool = ({ toolPart, defaultOpen = false, className }: ToolProps) => {
  const [isOpen, setIsOpen] = useState(defaultOpen)
  const { state, input, output, toolCallId, diff } = toolPart

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

  // For edit_file show the filename alongside the tool name in the header.
  const filePath = typeof input?.path === "string" ? input.path : undefined
  const fileName = filePath ? filePath.split("/").pop() : undefined
  const isEditFile = toolPart.type === "edit_file"

  return (
    <div className={cn("border-border mt-3 overflow-hidden rounded-lg border", className)}>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="bg-background h-auto w-full justify-between rounded-b-none px-3 py-2 font-normal"
          >
            <div className="flex items-center gap-2 min-w-0">
              {stateIcon}
              <span className="font-mono text-sm font-medium shrink-0">{toolPart.type}</span>
              {isEditFile && fileName && (
                <span className="font-mono text-xs text-muted-foreground truncate">{fileName}</span>
              )}
              {stateBadge}
            </div>
            <ChevronDown className={cn("h-4 w-4 shrink-0", isOpen && "rotate-180")} />
          </Button>
        </CollapsibleTrigger>

        <CollapsibleContent className="border-border border-t data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
          <div className="bg-background space-y-3 p-3">

            {/* edit_file: show diff when available */}
            {isEditFile && diff && (
              <ScrollArea className="max-h-96 overflow-hidden">
                <DiffBlock oldString={diff.oldString} newString={diff.newString} />
              </ScrollArea>
            )}

            {/* edit_file: show path when diff is present (instead of generic input block) */}
            {isEditFile && filePath && (
              <p className="text-xs text-muted-foreground font-mono truncate">{filePath}</p>
            )}

            {/* All other tools: generic input block */}
            {!isEditFile && input && Object.keys(input).length > 0 && (
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

            {/* Generic output (all tools except edit_file which shows the diff) */}
            {!isEditFile && output && (
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
