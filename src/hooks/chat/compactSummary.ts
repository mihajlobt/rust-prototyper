import type { ChatMessage } from "@/types/chat"
import { generateCompletion, writeFile, getErrorMessage, type Provider } from "@/lib/ipc"
import { useChatStore } from "@/stores/chatStore"
import { notify } from "@/hooks/useToast"

/** How many of the most recent user turns are kept uncompacted. */
export const KEEP_RECENT_TURNS = 4

/** Mirrors opencode's compaction summary template: https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction */
const SUMMARY_INSTRUCTIONS = `Summarize the conversation below for a coding assistant that is about to continue it. Be concise but keep anything a future turn would need. Use exactly these headings:

## Goal
What the user is ultimately trying to accomplish.

## Constraints
Explicit requirements, preferences, or limits the user stated.

## Progress
What has been done so far (files read/edited, commands run, decisions implemented).

## Key Decisions
Choices made and why, especially anything non-obvious.

## Next Steps
What remains to be done, including anything explicitly deferred.

## Critical Context
File paths, identifiers, error messages, or other specifics a future turn must not lose.`

/** Flattens messages and tool results into plain text for the summarization prompt. */
function flattenTranscript(messages: ChatMessage[], toolOutputResendLimit: number): string {
  return messages.map((m) => {
    const lines = [`[${m.role.toUpperCase()}]: ${m.content}`]
    for (const tc of m.toolCalls ?? []) {
      if (tc.result === undefined) continue
      const result = tc.result.length > toolOutputResendLimit
        ? `${tc.result.slice(0, toolOutputResendLimit)}\n... (truncated, ${tc.result.length} characters total)`
        : tc.result
      lines.push(`  [TOOL ${tc.tool}${tc.path ? ` ${tc.path}` : ""}]: ${result}`)
    }
    return lines.join("\n")
  }).join("\n\n")
}

/** Throws on failure or an empty summary — callers must catch, notify, and fall back to uncompacted messages. */
export async function generateCompactionSummary(
  messagesToSummarize: ChatMessage[],
  modelId: string,
  host: string,
  apiKey: string,
  provider: Provider,
  toolOutputResendLimit: number,
): Promise<string> {
  const transcript = flattenTranscript(messagesToSummarize, toolOutputResendLimit)
  const prompt = `${SUMMARY_INSTRUCTIONS}\n\n---\n\n${transcript}`
  const summary = await generateCompletion(modelId, [{ role: "user", content: prompt }], host, apiKey, provider)
  const trimmed = summary.trim()
  if (!trimmed) throw new Error("Compaction summary was empty")
  return trimmed
}

/** Replaces `messages[0..boundaryIndex)` with one recap message; `boundaryIndex` must be a `role === "user"` index. */
export function buildCompactedMessages(messages: ChatMessage[], boundaryIndex: number, summary: string): ChatMessage[] {
  const summaryMessage: ChatMessage = {
    role: "assistant",
    content: `## Earlier conversation (compacted)\n\n${summary}`,
  }
  return [summaryMessage, ...messages.slice(boundaryIndex)]
}

/** Index of the user message starting the `keepRecentTurns`-th most recent turn; 0 if nothing to compact. */
export function findCompactionBoundary(messages: ChatMessage[], keepRecentTurns: number): number {
  let userTurnsFromEnd = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userTurnsFromEnd++
      if (userTurnsFromEnd > keepRecentTurns) return i + 1
    }
  }
  return 0
}

export interface Compaction {
  boundaryIndex: number
  summary: string
}

// Keyed by `${entityId}:${boundaryIndex}` so the proactive (post-Done) and
// reactive (pre-send) compaction checks share a single in-flight request.
const inFlight = new Map<string, Promise<Compaction>>()

/** Generates (or reuses an in-flight) compaction summary, then caches it to the store and `compactionPath`. */
export function runCompaction(
  entityId: string,
  compactionPath: string,
  boundaryIndex: number,
  messagesToSummarize: ChatMessage[],
  modelId: string,
  host: string,
  apiKey: string,
  provider: Provider,
  toolOutputResendLimit: number,
): Promise<Compaction> {
  const key = `${entityId}:${boundaryIndex}`
  let promise = inFlight.get(key)
  if (!promise) {
    promise = generateCompactionSummary(messagesToSummarize, modelId, host, apiKey, provider, toolOutputResendLimit)
      .then((summary) => {
        const compaction: Compaction = { boundaryIndex, summary }
        // Discard if the chat was cleared/trimmed below the summarized boundary while this was in flight.
        const messages = useChatStore.getState().chats[entityId]?.messages ?? []
        if (messages.length >= boundaryIndex) {
          useChatStore.getState().setCompaction(entityId, compaction)
          writeFile(compactionPath, JSON.stringify(compaction)).catch(() => {})
        }
        return compaction
      })
      // Notify once here, on the shared promise, rather than in each caller's catch —
      // proactive and reactive callers can both await the same in-flight promise.
      .catch((e) => {
        notify.error("Compaction failed", getErrorMessage(e))
        throw e
      })
      .finally(() => inFlight.delete(key))
    inFlight.set(key, promise)
  }
  return promise
}
