import type { MutableRefObject, RefObject } from "react"
import { writeFile, type CompletionEvent, type TokenUsage } from "@/lib/ipc"
import { useChatStore } from "@/stores/chatStore"
import { useAskUserStore } from "@/stores/askUserStore"
import { useTaskListStore } from "@/stores/taskListStore"
import { notify } from "@/hooks/useToast"
import type { ChatMessage } from "@/types/chat"
import { stripFences } from "./messages"

// ─── Factory: createStreamHandler ──────────────────────────────────────────
//
// Extracted to eliminate ~80 lines of duplicated channel.onmessage + finalize
// logic between sendMessage and regenerate. Returns a bound handler that
// closes over accumulated state.
//
// Tool results are written directly to Zustand in the ToolResult handler.
// The previous pendingToolResultsRef + useEffect drain approach was intended
// to ensure the "Processing" spinner painted for one frame before being cleared,
// but it introduced a tab-switch bug: if the component unmounted before the
// useEffect fired, pending:true was never cleared. Direct Zustand writes are
// simpler and correct.

export interface StreamHandlerParams {
  entityId: string
  chatPath: string
  /** The updatedMessages array built by the caller (includes placeholder). */
  updatedMessages: ChatMessage[]
  stopRef: RefObject<boolean>
  activeRequestIdRef: MutableRefObject<number | null>
  onOutputRef: MutableRefObject<((content: string) => void) | undefined>
  onCodeOutputRef: MutableRefObject<((content: string) => void) | undefined>
  onToolWriteRef: MutableRefObject<((path: string, content: string) => void) | undefined>
  outputPath: string | undefined
  /** Called for every ToolCall event, before the store update. */
  onToolCallRef?: MutableRefObject<((tool: string, args: Record<string, unknown>) => void) | undefined>
  /** Called for every ToolResult event, after the store update. */
  onToolResultRef?: MutableRefObject<((tool: string, success: boolean, output: string, path?: string) => void) | undefined>
}

export function createStreamHandler(params: StreamHandlerParams) {
  const {
    entityId, chatPath, updatedMessages, stopRef, activeRequestIdRef,
    onOutputRef, onCodeOutputRef, onToolWriteRef, outputPath,
    onToolCallRef, onToolResultRef,
  } = params

  let contentAccumulated = ""
  let thinkingAccumulated = ""
  let chunkIndex = 0
  let toolWritten = false
  let rafId: number | null = null
  let rafThinkingId: number | null = null

  const finalize = (content: string, thinking: string, usage?: TokenUsage) => {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
    if (rafThinkingId !== null) { cancelAnimationFrame(rafThinkingId); rafThinkingId = null }
    activeRequestIdRef.current = null
    const msgs = useChatStore.getState().chats[entityId]?.messages ?? []
    const currentLast = msgs[msgs.length - 1]
    const finalMessage: ChatMessage = {
      role: "assistant",
      content,
      ...(thinking ? { thinking } : {}),
      ...(currentLast?.toolCalls?.length ? { toolCalls: currentLast.toolCalls } : {}),
      ...(currentLast?.streamChunks?.length ? { streamChunks: currentLast.streamChunks } : {}),
      ...(usage ? { usage } : {}),
    }
    const finalMessages: ChatMessage[] = [...updatedMessages.slice(0, -1), finalMessage]
    useChatStore.getState().setMessages(entityId, finalMessages)
    useChatStore.getState().setStreaming(entityId, false)
    useChatStore.getState().setStreamingThinking(entityId, "")
    writeFile(chatPath, JSON.stringify(finalMessages, null, 2)).catch(() => {})
  }

  const onMessage = (msg: CompletionEvent) => {
    if ((stopRef as MutableRefObject<boolean>).current) return
    if (msg.event === "Chunk") {
      if (msg.data.thinking) {
        thinkingAccumulated += msg.data.thinking
        if (rafThinkingId === null) {
          rafThinkingId = requestAnimationFrame(() => {
            rafThinkingId = null
            useChatStore.getState().setStreamingThinking(entityId, thinkingAccumulated)
          })
        }
      }
      if (msg.data.text) {
        contentAccumulated += msg.data.text
      }
      if (rafId === null) {
        rafId = requestAnimationFrame(() => {
          rafId = null
          useChatStore.getState().setStreamingContent(entityId, contentAccumulated)
        })
      }
    } else if (msg.event === "ToolCall") {
      onToolCallRef?.current?.(msg.data.tool, msg.data.args)
      useChatStore.getState().attachToolCall(entityId, msg.data.tool, "", msg.data.args)
      // Flush accumulated thinking/text as a chunk at tool boundary
      useChatStore.getState().addStreamChunk(entityId, {
        index: chunkIndex++,
        thinking: thinkingAccumulated,
        text: contentAccumulated,
      })
      thinkingAccumulated = ""
      contentAccumulated = ""
      // Clear live accumulators so they don't duplicate the chunk we just stored
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
    } else if (msg.event === "ToolResult") {
      const { tool, success, output, path, content } = msg.data
      // Single atomic mutation: first pending match (front-to-back) gets result + path.
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
      // Flush remaining accumulated thinking/text as final chunk
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
