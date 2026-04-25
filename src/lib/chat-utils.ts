import type { MessageBlock } from "@/types/chat"

/** Remove all <think>...</think> blocks from a string before code extraction. */
export function stripThinking(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/think>/g, "").trim()
}

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

/**
 * StreamChunkParser — stateful parser that splits incoming text chunks
 * into thinking content and response content, mirroring the old project's
 * approach of separating obj.thinking from obj.response at the streaming layer.
 *
 * Usage:
 *   const parser = createStreamChunkParser()
 *   // For each chunk from Tauri Channel:
 *   const { thinking, response } = parser.push(chunkText)
 *   if (thinking) thinkingStream.push(thinking)
 *   if (response) responseStream.push(response)
 *   // When stream ends:
 *   const remaining = parser.flush()
 */
export interface StreamChunkParser {
  push: (chunk: string) => { thinking: string; response: string }
  flush: () => { thinking: string; response: string }
}

export function createStreamChunkParser(): StreamChunkParser {
  let inThinking = false
  let thinkingAccumulator = ""
  let responseAccumulator = ""

  return {
    push(chunk: string): { thinking: string; response: string } {
      let thinking = ""
      let response = ""
      let buffer = chunk

      while (buffer.length > 0) {
        if (inThinking) {
          const endIdx = buffer.indexOf("</think>")
          if (endIdx !== -1) {
            // Found closing tag
            thinkingAccumulator += buffer.slice(0, endIdx)
            thinking += thinkingAccumulator
            thinkingAccumulator = ""
            inThinking = false
            buffer = buffer.slice(endIdx + 8) // skip "</think>"
          } else {
            // Still inside thinking block
            thinkingAccumulator += buffer
            buffer = ""
          }
        } else {
          const startIdx = buffer.indexOf("<think>")
          if (startIdx !== -1) {
            // Found opening tag
            const before = buffer.slice(0, startIdx)
            if (before) {
              responseAccumulator += before
              response += before
            }
            inThinking = true
            buffer = buffer.slice(startIdx + 7) // skip "<think>"

            // Flush response accumulator if we had been accumulating
            if (responseAccumulator && before) {
              response = responseAccumulator
              responseAccumulator = ""
            }
          } else {
            // No thinking tag — plain response content
            responseAccumulator += buffer
            response += buffer
            buffer = ""
          }
        }
      }

      return { thinking, response }
    },

    flush(): { thinking: string; response: string } {
      const thinking = inThinking ? thinkingAccumulator : ""
      const response = ""
      // Reset state
      thinkingAccumulator = ""
      responseAccumulator = ""
      inThinking = false
      return { thinking, response }
    },
  }
}