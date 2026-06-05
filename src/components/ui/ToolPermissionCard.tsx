"use client"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { Shield, Check, X, ShieldCheck } from "lucide-react"
import { useCallback, memo } from "react"
import { resolveToolPermission, type ToolPermissionDecision } from "@/lib/ipc"
export type { ToolPermissionDecision };

export interface ToolPermissionCardProps {
  requestId: number
  tool: string
  args: Record<string, unknown>
  /** Called AFTER the IPC resolves. Used to update local store. */
  onResolve?: (decision: ToolPermissionDecision) => void
}

export const ToolPermissionCard = memo(function ToolPermissionCard({ requestId, tool, args, onResolve }: ToolPermissionCardProps) {
  const handleDecision = useCallback(async (decision: ToolPermissionDecision) => {
    try {
      await resolveToolPermission(requestId, decision)
    } catch (e) {
      console.error("[ToolPermissionCard] resolveToolPermission failed:", e)
    }
    onResolve?.(decision)
  }, [requestId, onResolve])

  const toolLabel = () => {
    if (tool === "bash") {
      const cmd = String(args.command ?? "")
      return `bash: ${cmd.substring(0, 80)}${cmd.length > 80 ? "…" : ""}`
    }
    if (tool === "write_file") {
      return "write file"
    }
    if (tool === "read_file") {
      const path = String(args.path ?? "")
      return `read file: ${path}`
    }
    return `${tool}: ${JSON.stringify(args).substring(0, 120)}`
  }

  return (
    <div
      className={cn(
        "my-2 overflow-hidden rounded-lg border",
        "border-amber-200 bg-amber-50/60",
        "dark:border-amber-900/50 dark:bg-amber-950/15"
      )}
    >
      <div className="flex items-start gap-2.5 px-3 py-2.5">
        <Shield className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            Permission Required
          </p>
          <p className="mt-0.5 font-mono text-xs text-muted-foreground truncate">
            {toolLabel()}
          </p>
        </div>
      </div>
<div className="flex items-center gap-2 border-t border-amber-200/60 px-3 py-2 dark:border-amber-900/40">
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1 rounded-md bg-amber-700 text-xs text-white hover:bg-amber-800 dark:bg-amber-600 dark:hover:bg-amber-500"
            onClick={() => handleDecision("accepted")}
          >
            <Check className="h-3.5 w-3.5" />
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 rounded-md border-amber-300 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:text-amber-400 dark:hover:bg-amber-950"
            onClick={() => handleDecision("rejected")}
          >
            <X className="h-3.5 w-3.5" />
            Reject
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1 rounded-md text-xs text-muted-foreground hover:bg-amber-100 dark:hover:bg-amber-950"
            onClick={() => handleDecision("always_allowed")}
          >
            <ShieldCheck className="h-3.5 w-3.5" />
            Always Allow
        </Button>
      </div>
    </div>
  )
}, (prev, next) =>
  prev.requestId === next.requestId &&
  prev.tool === next.tool &&
  prev.args === next.args &&
  prev.onResolve === next.onResolve
)
