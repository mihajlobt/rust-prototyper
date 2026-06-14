import type { ChatMessage } from "@/types/chat"

const MENTION_BLOCK_START = /<!-- @(.+?) -->/g
const MENTION_BLOCK_END = /<!-- end @(.+?) -->/g

/** FNV-1a-style 32-bit hash used only as a cache key for exact-block deduplication.
 *  Not a security primitive. */
function hashString(input: string): number {
  let hash = 2166136261
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    hash &= 0xffffffff
  }
  return hash >> 0
}

function findMentionBlocks(content: string): Array<{ name: string; start: number; end: number }> {
  const blocks: Array<{ name: string; start: number; end: number }> = []
  let startMatch: RegExpExecArray | null

  MENTION_BLOCK_START.lastIndex = 0
  while ((startMatch = MENTION_BLOCK_START.exec(content)) !== null) {
    const name = startMatch[1]
    const blockStart = startMatch.index
    const afterStart = MENTION_BLOCK_START.lastIndex

    // Match the end marker only after this start marker so nested same-name
    // mentions don't prematurely close the block.
    MENTION_BLOCK_END.lastIndex = afterStart
    let endMatch: RegExpExecArray | null = null
    while ((endMatch = MENTION_BLOCK_END.exec(content)) !== null) {
      if (endMatch[1] === name) break
    }

    if (endMatch === null) continue

    const blockEnd = MENTION_BLOCK_END.lastIndex
    blocks.push({ name, start: blockStart, end: blockEnd })
  }

  return blocks
}

/** Replace repeated identical `<!-- @name -->...<!-- end @name -->` blocks with a
 *  stub. Exact matches only; chat.json is untouched.
 *  Mention markers are produced in src/hooks/useChat.ts:172-185. */
export function dedupeMentions(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Map<string, number>()

  return messages.map((message) => {
    const blocks = findMentionBlocks(message.content)
    if (blocks.length === 0) return message

    let replacement = ""
    let cursor = 0
    let changed = false

    for (const block of blocks) {
      replacement += message.content.slice(cursor, block.start)
      const fullBlock = message.content.slice(block.start, block.end)
      const hash = hashString(fullBlock)
      const key = `${block.name}:${hash}`

      if (seen.has(key)) {
        changed = true
        replacement += `<!-- @${block.name} (content unchanged, shown earlier in this conversation) -->`
      } else {
        seen.set(key, 1)
        replacement += fullBlock
      }

      cursor = block.end
    }

    replacement += message.content.slice(cursor)

    if (!changed) return message
    return { ...message, content: replacement }
  })
}
