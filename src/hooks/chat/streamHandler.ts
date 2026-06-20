import type { RefObject } from "react"
import { historySet, type CompletionEvent, type Provider, type TokenUsage } from "@/lib/ipc"
import { useChatStore } from "@/stores/chatStore"
import { useAskUserStore } from "@/stores/askUserStore"
import { useTaskListStore } from "@/stores/taskListStore"
import { notify } from "@/hooks/useToast"
import type { ChatMessage } from "@/types/chat"
import { persistSessionSnapshot } from "./sessionSnapshot"
import { stripFences } from "./messages"
import { findCompactionBoundary, runCompaction, KEEP_RECENT_TURNS } from "./compactSummary"

/** Params for proactively pre-generating the compaction summary once a completed turn's usage crosses the threshold. */
export interface CompactionParams {
  threshold: number
  contextWindow: number
  compactionPath: string
  modelId: string
  host: string
  apiKey: string
  provider: Provider
  toolOutputResendLimit: number
}

export interface StreamHandlerParams {
  entityId: string
  chatPath: string
  /** Sibling of `chatPath` for per-session state (last usage, live estimate). */
  sessionPath: string
  updatedMessages: ChatMessage[]
  stopRef: RefObject<boolean>
  activeRequestIdRef: RefObject<number | null>
  onOutputRef: RefObject<((content: string) => void) | undefined>
  onCodeOutputRef: RefObject<((content: string) => void) | undefined>
  onToolWriteRef: RefObject<((path: string, content: string) => void) | undefined>
  outputPath: string | undefined
  onToolCallRef?: RefObject<((tool: string, args: Record<string, unknown>) => void) | undefined>
  onToolResultRef?: RefObject<((tool: string, success: boolean, output: string, path?: string) => void) | undefined>
  compaction: CompactionParams
}

export function createStreamHandler(params: StreamHandlerParams) {
  const {
    entityId, chatPath, sessionPath, updatedMessages, stopRef, activeRequestIdRef,
    onOutputRef, onCodeOutputRef, onToolWriteRef, outputPath,
    onToolCallRef, onToolResultRef,
    compaction,
  } = params

  let contentAccumulated = ""
  let thinkingAccumulated = ""
  let chunkIndex = 0
  let toolWritten = false
  let rafId: number | null = null
  let rafThinkingId: number | null = null
  let liveTokenEstimate = 0

  const finalize = (content: string, thinking: string, usage?: TokenUsage) => {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
    if (rafThinkingId !== null) { cancelAnimationFrame(rafThinkingId); rafThinkingId = null }
    const finalLiveEstimate = liveTokenEstimate
    liveTokenEstimate = 0
    useChatStore.getState().setLiveTokenCount(entityId, 0)
    activeRequestIdRef.current = null
    const msgs = useChatStore.getState().chats[entityId]?.messages ?? []
    const currentLast = msgs[msgs.length - 1]
    const finalMessage: ChatMessage = {
      role: "assistant",
      content,
      ...(thinking ? { thinking } : {}),
      ...(currentLast?.toolCalls?.length ? { toolCalls: currentLast.toolCalls } : {}),
      ...(currentLast?.streamChunks?.length ? { streamChunks: currentLast.streamChunks } : {}),
      ...(currentLast?.researchLog?.length ? { researchLog: currentLast.researchLog } : {}),
      ...(usage ? { usage } : {}),
    }
    const finalMessages: ChatMessage[] = [...updatedMessages.slice(0, -1), finalMessage]
    useChatStore.getState().setMessages(entityId, finalMessages)
    useChatStore.getState().setStreaming(entityId, false)
    useChatStore.getState().setStreamingThinking(entityId, "")
    historySet(chatPath, JSON.stringify(finalMessages, null, 2)).catch(() => {})
    // No usage (Error / truncated stream): carry the live estimate forward instead of dropping it.
    persistSessionSnapshot(entityId, sessionPath, usage
      ? { lastFinalUsage: usage, liveEstimate: 0 }
      : { liveEstimate: finalLiveEstimate })

    // Proactively pre-generate the compaction summary so it's cached before the next send.
    // KEEP_RECENT_TURNS - 1 here matches KEEP_RECENT_TURNS once the next user message is appended.
    if (usage && compaction.threshold > 0 && usage.prompt_tokens / compaction.contextWindow > compaction.threshold) {
      const boundaryIndex = findCompactionBoundary(finalMessages, KEEP_RECENT_TURNS - 1)
      const current = useChatStore.getState().chats[entityId]?.compaction
      if (boundaryIndex > 0 && current?.boundaryIndex !== boundaryIndex) {
        useChatStore.getState().setCompacting(entityId, true)
        // User-facing notification already happens inside runCompaction.
        runCompaction(
          entityId, compaction.compactionPath, boundaryIndex, finalMessages.slice(0, boundaryIndex),
          compaction.modelId, compaction.host, compaction.apiKey, compaction.provider, compaction.toolOutputResendLimit,
        )
          .catch((e) => console.error("Proactive compaction failed", e))
          .finally(() => useChatStore.getState().setCompacting(entityId, false))
      }
    }
  }

  const onMessage = (msg: CompletionEvent) => {
    if (stopRef.current) return
    if (msg.event === "Chunk") {
      if (msg.data.thinking) {
        thinkingAccumulated += msg.data.thinking
        liveTokenEstimate += Math.ceil(msg.data.thinking.length / 4)
        if (rafThinkingId === null) {
          rafThinkingId = requestAnimationFrame(() => {
            rafThinkingId = null
            useChatStore.getState().setStreamingThinking(entityId, thinkingAccumulated)
            useChatStore.getState().setLiveTokenCount(entityId, liveTokenEstimate)
          })
        }
      }
      if (msg.data.text) {
        contentAccumulated += msg.data.text
        liveTokenEstimate += Math.ceil(msg.data.text.length / 4)
      }
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          useChatStore.getState().setStreamingContent(entityId, contentAccumulated)
          useChatStore.getState().setLiveTokenCount(entityId, liveTokenEstimate)
        })
      }
    } else if (msg.event === "ToolCall") {
      onToolCallRef?.current?.(msg.data.tool, msg.data.args)
      useChatStore.getState().attachToolCall(entityId, msg.data.tool, "", msg.data.args)
      useChatStore.getState().addStreamChunk(entityId, {
        index: chunkIndex++,
        thinking: thinkingAccumulated,
        text: contentAccumulated,
      })
      thinkingAccumulated = ""
      contentAccumulated = ""
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      if (rafThinkingId !== null) { cancelAnimationFrame(rafThinkingId); rafThinkingId = null }
      useChatStore.getState().setStreamingContent(entityId, "")
      useChatStore.getState().setStreamingThinking(entityId, "")
    } else if (msg.event === "ToolPermission") {
      useChatStore.getState().attachToolPermission(entityId, {
        requestId: msg.data.request_id,
        tool: msg.data.tool,
        args: msg.data.args,
        pending: true,
      })
      useChatStore.getState().addStreamChunk(entityId, {
        index: chunkIndex++,
        thinking: thinkingAccumulated,
        text: contentAccumulated,
      })
      thinkingAccumulated = ""
      contentAccumulated = ""
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      if (rafThinkingId !== null) { cancelAnimationFrame(rafThinkingId); rafThinkingId = null }
      useChatStore.getState().setStreamingContent(entityId, "")
      useChatStore.getState().setStreamingThinking(entityId, "")
    } else if (msg.event === "AskUser") {
      useAskUserStore.getState().setAskUser({
        requestId: msg.data.request_id,
        question: msg.data.question,
        questionType: msg.data.question_type,
        choices: msg.data.choices,
      })
    } else if (msg.event === "AskUserForm") {
      useAskUserStore.getState().setAskUserForm({
        requestId: msg.data.request_id,
        title: msg.data.title,
        fields: msg.data.fields,
      })
    } else if (msg.event === "TodoUpdate") {
      useTaskListStore.getState().setTodos(msg.data.todos)
    } else if (msg.event === "ResearchPhase") {
      useChatStore.getState().appendResearchPhase(entityId, {
        phase: msg.data.phase, round: msg.data.round, maxRounds: msg.data.max_rounds,
        detail: msg.data.detail, sources: msg.data.sources,
      })
    } else if (msg.event === "ToolResult") {
      const { tool, success, output, path, content } = msg.data
      useChatStore.getState().resolveToolCall(entityId, tool, output, success, path ?? "")
      if ((tool === "write_file" || tool === "edit_file") && success) {
        if (tool === "write_file") {
          toolWritten = true
          contentAccumulated = ""
          useChatStore.getState().setStreamingContent(entityId, "")
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        }
        if (content && outputPath && path === outputPath) {
          onCodeOutputRef.current?.(stripFences(content))
        }
        if (content && path) {
          onToolWriteRef.current?.(path, stripFences(content))
        }
      }
      onToolResultRef?.current?.(tool, success, output, path)
    } else if (msg.event === "Done") {
      const finalThinking = thinkingAccumulated
      const finalContent = contentAccumulated
      if (thinkingAccumulated || contentAccumulated) {
        useChatStore.getState().addStreamChunk(entityId, {
          index: chunkIndex++,
          thinking: thinkingAccumulated,
          text: contentAccumulated,
        })
      }
      finalize(finalContent, finalThinking, msg.data?.usage)
      if (!toolWritten) onOutputRef.current?.(finalContent)
    } else if (msg.event === "Error") {
      finalize(`⚠ ${msg.data.message}`, "")
      notify.error("Generation failed", msg.data.message)
    }
  }

  return onMessage
}
