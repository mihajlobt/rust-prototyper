import type { MessageBlock } from "@/types/chat"

export function parseBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let remaining = content
  while (remaining.length > 0) {
    const thinkStart = remaining.indexOf("<think>")
    if (thinkStart === -1) {
      if (remaining.trim()) blocks.push({ type: "text", content: remaining })
      break
    }
    if (thinkStart > 0) {
      const before = remaining.slice(0, thinkStart)
      if (before.trim()) blocks.push({ type: "text", content: before })
    }
    const thinkEnd = remaining.indexOf("</think>", thinkStart)
    if (thinkEnd === -1) {
      blocks.push({ type: "thinking", content: remaining.slice(thinkStart + 7), collapsed: true })
      break
    }
    blocks.push({ type: "thinking", content: remaining.slice(thinkStart + 7, thinkEnd), collapsed: true })
    remaining = remaining.slice(thinkEnd + 8)
  }
  return blocks
}
