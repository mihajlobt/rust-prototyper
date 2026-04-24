import { useState } from "react"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"
import type { MessageBlock } from "@/types/chat"

type ThinkingBlockData = Extract<MessageBlock, { type: "thinking" }>

interface ThinkingBlockProps {
  block: ThinkingBlockData
}

export function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(block.collapsed)

  return (
    <div className="my-1 rounded border border-border/50 bg-muted/30 text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <Brain size={11} />
        <span>Reasoning</span>
        {collapsed
          ? <ChevronRight size={10} className="ml-auto" />
          : <ChevronDown size={10} className="ml-auto" />
        }
      </button>
      {!collapsed && (
        <div className="border-t border-border/50 px-2 py-1.5 text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
          {block.content}
        </div>
      )}
    </div>
  )
}
