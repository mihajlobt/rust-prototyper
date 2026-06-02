import type { Dispatch, MutableRefObject, RefObject, SetStateAction } from "react"
import { writeFile, resolveAskUser, resolveAskUserForm, type CompletionEvent, type AskUserQuestionType, type FormField } from "@/lib/ipc"
import { useChatStore } from "@/stores/chatStore"
import { notify } from "@/hooks/useToast"
import type { ChatMessage } from "@/types/chat"
import { stripFences, type PendingToolResult } from "./messages"

export interface AskUserPayload {
  requestId: number
  question: string
  questionType: AskUserQuestionType
  choices?: string[]
}

export interface AskUserFormPayload {
  requestId: number
  title: string
  fields: FormField[]
}

// ─── Factory: createStreamHandler ──────────────────────────────────────────
//
// Extracted to eliminate ~80 lines of duplicated channel.onmessage + finalize
// logic between sendMessage and regenerate. Returns a bound handler that
// closes over accumulated state. Also fixes the regenerate path's missing
// rafThinkingId cancel (previously only finalize() in sendMessage cancelled
// both raf IDs; the inline Done handler in regenerate only cancelled rafId).

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
  pendingToolResultsRef: MutableRefObject<PendingToolResult[]>
  setToolResultTick: Dispatch<SetStateAction<number>>
  /** Called when the model invokes ask_user. Section-agnostic — any panel can provide this.
   *  If absent, the request is defensively resolved so the backend doesn't block. */
  onAskUserRef?: MutableRefObject<((payload: AskUserPayload) => void) | undefined>
  /** Called when the model invokes ask_user_form. Section-agnostic.
   *  If absent, the request is defensively resolved with empty answers. */
  onAskUserFormRef?: MutableRefObject<((payload: AskUserFormPayload) => void) | undefined>
  /** Called for every ToolCall event, before the store update. */
  onToolCallRef?: MutableRefObject<((tool: string, args: Record<string, unknown>) => void) | undefined>
  /** Called for every ToolResult event, after the store update. */
  onToolResultRef?: MutableRefObject<((tool: string, success: boolean, output: string, path?: string) => void) | undefined>
}

export function createStreamHandler(params: StreamHandlerParams) {
  const {
    entityId, chatPath, updatedMessages, stopRef, activeRequestIdRef,
    onOutputRef, onCodeOutputRef, onToolWriteRef, outputPath, pendingToolResultsRef, setToolResultTick,
    onAskUserRef, onAskUserFormRef, onToolCallRef, onToolResultRef,
  } = params

  let contentAccumulated = ""
  let thinkingAccumulated = ""
  let chunkIndex = 0
  let toolWritten = false
  let rafId: number | null = null
  let rafThinkingId: number | null = null

  const finalize = (content: string, thinking: string) => {
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
    if (rafThinkingId !== null) { cancelAnimationFrame(rafThinkingId); rafThinkingId = null }
    activeRequestIdRef.current = null
    // Flush any queued tool results synchronously so the finalized message
    // has pending=false and the correct path before we persist to disk.
    // (The useEffect drainer fires post-paint, which may be after Done arrives.)
    for (const result of pendingToolResultsRef.current.splice(0)) {
      useChatStore.getState().updateLastToolResult(entityId, result.tool, result.output, result.success)
      useChatStore.getState().patchLastToolCallPath(entityId, result.tool, result.path ?? "")
    }
    // Preserve toolCalls (now correctly flushed) in the finalized message
    const msgs = useChatStore.getState().chats[entityId]?.messages ?? []
    const currentLast = msgs[msgs.length - 1]
    const finalMessage: ChatMessage = {
      role: "assistant",
      content,
      ...(thinking ? { thinking } : {}),
      ...(currentLast?.toolCalls?.length ? { toolCalls: currentLast.toolCalls } : {}),
      ...(currentLast?.streamChunks?.length ? { streamChunks: currentLast.streamChunks } : {}),
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
      // Section-agnostic: any panel that registers onAskUser receives this.
      // If no handler is registered, immediately resolve so the Rust agent
      // loop is not blocked for the 600s timeout.
      if (onAskUserRef?.current) {
        onAskUserRef.current({
          requestId: msg.data.request_id,
          question: msg.data.question,
          questionType: msg.data.question_type,
          choices: msg.data.choices,
        })
      } else {
        resolveAskUser(msg.data.request_id, "ask_user not handled in this section").catch(() => {})
      }
    } else if (msg.event === "AskUserForm") {
      if (onAskUserFormRef?.current) {
        onAskUserFormRef.current({
          requestId: msg.data.request_id,
          title: msg.data.title,
          fields: msg.data.fields,
        })
      } else {
        resolveAskUserForm(msg.data.request_id, {}).catch(() => {})
      }
    } else if (msg.event === "ToolResult") {
      const { tool, success, output, path, content } = msg.data
      if ((tool === "write_file" || tool === "edit_file") && success) {
        if (tool === "write_file") {
          toolWritten = true
          // Clear any streaming text that was accumulating before this write
          contentAccumulated = ""
          useChatStore.getState().setStreamingContent(entityId, "")
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        }
        // Fire onCodeOutput for write_file and edit_file when the path matches the
        // designated primary output file. edit_file sends the full post-edit content
        // in `content` (written_content from executor), so the preview stays in sync.
        if (content && outputPath && path === outputPath) {
          onCodeOutputRef.current?.(stripFences(content))
        }
        // Fire onToolWrite for ALL successful write_file / edit_file calls so
        // consumers that manage multiple files (e.g. ThemesPanel) can react.
        if (content && path) {
          onToolWriteRef.current?.(path, stripFences(content))
        }
      }
      pendingToolResultsRef.current.push({ tool, success, output, path, content })
      setToolResultTick((tick) => tick + 1)
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
      finalize(finalContent, finalThinking)
      if (!toolWritten) onOutputRef.current?.(finalContent)
    } else if (msg.event === "Error") {
      finalize(`⚠ ${msg.data.message}`, "")
      notify.error("Generation failed", msg.data.message)
    }
  }

  return onMessage
}
