import { useEffect, useRef, useState, useCallback, type MutableRefObject, type RefObject } from "react"

interface PendingToolResult {
  tool: string
  success: boolean
  output: string
  path: string | undefined
  content: string | undefined
}

function stripFences(content: string): string {
  return content
    .replace(/^```[\w]*\r?\n?/, "")
    .replace(/\r?\n?```\s*$/, "")
    .trim()
}

/** Build API messages for the completion request.
 *  For Ollama provider, includes tool_calls in assistant messages and
 *  tool role messages with tool_name after them, per the Ollama API format:
 *  https://github.com/ollama/ollama/blob/main/docs/api.md
 *  "Chat request (With history, with tools)" */
function buildApiMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  isOllama: boolean,
): Message[] {
  const system: Message = { role: "system", content: systemPrompt }
  if (!isOllama) {
    // Non-Ollama providers: simple flat mapping (no tool history support yet)
    return [
      system,
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        ...(m.images?.length ? { images: m.images } : {}),
      })),
    ]
  }

  // Ollama: include tool_calls and tool role messages for multi-turn context
  const result: Message[] = [system]
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      // Assistant message with tool calls — serialize to Ollama API format.
      result.push({
        role: "assistant",
        content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.tool, arguments: tc.arguments },
        })),
      })
      // Insert tool role messages after the assistant's tool_calls
      for (const tc of m.toolCalls) {
        if (tc.result !== undefined) {
          result.push({
            role: "tool",
            content: tc.result,
            tool_name: tc.tool,
          })
        }
      }
    } else {
      result.push({
        role: m.role,
        content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        ...(m.images?.length ? { images: m.images } : {}),
      })
    }
  }
  return result
}

/** Resolves the think parameter to send to Ollama based on model capabilities and user toggle.
 *  - gpt-oss family: always sends a level (low/medium/high), can't fully disable
 *  - Other models: sends false to disable, true/level to enable, undefined if model doesn't support */
export function resolveThinkParam(
  caps: { thinking: boolean; thinkLevel?: "low" | "medium" | "high" },
  isGptOssFamily: boolean,
  thinkEnabled: boolean,
  thinkLevel: "low" | "medium" | "high",
): boolean | "low" | "medium" | "high" | undefined {
  if (!caps.thinking) return undefined

  if (isGptOssFamily) {
    return thinkEnabled ? thinkLevel : "low"
  }

  return thinkEnabled ? (caps.thinkLevel ?? true) : undefined
}

import { Channel } from "@tauri-apps/api/core"
import { useChatStore } from "@/stores/chatStore"
import { useAppStore } from "@/stores/appStore"
import {
  generateCompletionStream,
  stopGenerationRequest,
  readFile,
  writeFile,
  getHostForProvider,
  getApiKeyForProvider,
  getErrorMessage,
  type CompletionEvent,
  type Provider,
  type Message,
  } from "@/lib/ipc"
import type { ChatMessage, MentionAsset, AttachmentFile } from "@/types/chat"
import { notify } from "@/hooks/useToast"
import { useModelCapabilities } from "@/hooks/useModelCapabilities"

// Stable reference used as fallback when entity has no chat state yet.
// Must be module-level so the reference is constant across renders —
// Zustand's useSyncExternalStore requires the snapshot to be cached.
const EMPTY_CHAT = { messages: [] as ChatMessage[], isStreaming: false }

interface UseChatOptions {
  entityId: string
  chatPath: string
  systemPrompt: string
  outputPath?: string
  onOutput?: (content: string) => void
}

// ─── Factory: createStreamHandler ──────────────────────────────────────────
//
// Extracted to eliminate ~80 lines of duplicated channel.onmessage + finalize
// logic between sendMessage and regenerate. Returns a bound handler that
// closes over accumulated state. Also fixes the regenerate path's missing
// rafThinkingId cancel (previously only finalize() in sendMessage cancelled
// both raf IDs; the inline Done handler in regenerate only cancelled rafId).

interface StreamHandlerParams {
  entityId: string
  chatPath: string
  /** The updatedMessages array built by the caller (includes placeholder). */
  updatedMessages: ChatMessage[]
  stopRef: RefObject<boolean>
  activeRequestIdRef: MutableRefObject<number | null>
  onOutputRef: MutableRefObject<((content: string) => void) | undefined>
  pendingToolResultsRef: MutableRefObject<PendingToolResult[]>
  setToolResultTick: React.Dispatch<React.SetStateAction<number>>
}

function createStreamHandler(params: StreamHandlerParams) {
  const {
    entityId, chatPath, updatedMessages, stopRef, activeRequestIdRef,
    onOutputRef, pendingToolResultsRef, setToolResultTick,
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
        console.log("[think-chunk] got thinking chunk len=%d preview=%s", msg.data.thinking.length, msg.data.thinking.slice(0, 80))
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
      console.log("[think-toolcall] tool=%s thinkingAccumulated.len=%d", msg.data.tool, thinkingAccumulated.length)
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
    } else if (msg.event === "ToolResult") {
      const { tool, success, output, path, content } = msg.data
      if (tool === "write_file" && success) toolWritten = true
      if (tool === "write_file" && success) {
        contentAccumulated = ""
        // Prevent stale text from appearing after write_file result
        useChatStore.getState().setStreamingContent(entityId, "")
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        if (content) onOutputRef.current?.(stripFences(content))
      }
      pendingToolResultsRef.current.push({ tool, success, output, path, content })
      setToolResultTick((tick) => tick + 1)
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

// ─── useChat hook ──────────────────────────────────────────────────────────

export function useChat({ entityId, chatPath, systemPrompt, outputPath, onOutput }: UseChatOptions) {
  // Destructure individual settings fields instead of selecting the full
  // settings object. Zustand's shallow equality means each selector re-renders
  // only when its specific value changes. The full `settings` object was
  // previously a single selector that changed reference on every store update,
  // causing sendMessage/regenerate to recreate on every keystroke.
  const modelId       = useAppStore((s) => s.settings.modelId)
  const host          = useAppStore((s) => s.settings.host)
  const apiKeys       = useAppStore((s) => s.settings.apiKeys)
  const provider      = useAppStore((s) => s.settings.provider)
  const modelOptions  = useAppStore((s) => s.settings.modelOptions)
  const toolPermissionMode = useAppStore((s) => s.settings.toolPermissionMode)
  const toolAllowlist = useAppStore((s) => s.settings.toolAllowlist)

  const chat = useChatStore((s) => s.chats[entityId] ?? EMPTY_CHAT)

  const onOutputRef = useRef(onOutput) as MutableRefObject<typeof onOutput>
  useEffect(() => { onOutputRef.current = onOutput }, [onOutput])

  // Shared stop flag — set to true to abort the current stream mid-flight
  const stopRef = useRef(false) as RefObject<boolean>
  // Active request ID returned by the Rust backend — used to cancel
  // the stream server-side via stopGenerationRequest
  const activeRequestIdRef = useRef<number | null>(null)

  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [mentions, setMentions] = useState<MentionAsset[]>([])

  const caps = useModelCapabilities(modelId)

  // gpt-oss family uses reasoning effort levels instead of on/off toggle
  const isGptOssFamily = caps.family === "gptoss"

  const [thinkEnabled, setThinkEnabled] = useState(false)
  const [thinkLevel, setThinkLevel] = useState<"low" | "medium" | "high">("medium")
  useEffect(() => {
    if (caps.thinking) {
      setThinkEnabled(true)
      if (caps.thinkLevel) setThinkLevel(caps.thinkLevel)
    } else {
      setThinkEnabled(false)
    }
    console.log("[think-auto] modelId=%s caps.thinking=%s → thinkEnabled=%s", modelId, caps.thinking, caps.thinking)
  // modelId re-runs on model switch (handles switching between two thinking-capable models).
  // caps.thinking re-runs when capabilities load after a switch (handles caps arriving after modelId change).
  // https://docs.ollama.com/capabilities/thinking
  }, [modelId, caps.thinking, caps.thinkLevel])

  const [toolsEnabled, setToolsEnabled] = useState(true)
  const prevCanToolsRef = useRef(false)
  useEffect(() => {
    if (caps.tools && !prevCanToolsRef.current) {
      setToolsEnabled(true)
    } else if (!caps.tools) {
      setToolsEnabled(false)
    }
    prevCanToolsRef.current = caps.tools
  }, [caps.tools])

  // Track which entityIds we've already loaded from disk
  const loadedRef = useRef<Set<string>>(new Set())

  // Queue of ToolResult payloads waiting for a post-paint flush.
  // Written synchronously from channel.onmessage; drained by the effect below
  // or synchronously by finalize() before writing to disk.
  const pendingToolResultsRef = useRef<PendingToolResult[]>([])
  // Incrementing this causes the post-paint useEffect to drain the queue.
  const [toolResultTick, setToolResultTick] = useState(0)

  // Cold start: load from disk the first time this entityId is accessed
  useEffect(() => {
    if (loadedRef.current.has(entityId)) return
    loadedRef.current.add(entityId)
    if (useChatStore.getState().chats[entityId]?.messages.length) return
    let cancelled = false
    readFile(chatPath)
      .then((raw) => {
        if (cancelled) return
        try {
          const messages = JSON.parse(raw) as ChatMessage[]
          if (Array.isArray(messages) && messages.length > 0) {
            useChatStore.getState().setMessages(entityId, messages)
          }
        } catch { /* ignore corrupt chat file */ }
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [entityId, chatPath])

  // Drain pending tool results after the browser has painted so the pending
  // spinner (Tool card "input-streaming" state) is visible for at least one frame.
  //
  // The Tauri Channel while-loop dispatches ToolCall + ToolResult synchronously
  // in a single JS call stack. Any React state update inside that stack can't
  // produce a visible paint until JS yields. Queuing the visual store update
  // here and applying it in useEffect — which React guarantees fires after the
  // browser has painted (react.dev/reference/react/useEffect) — breaks the
  // synchronous batch and ensures the spinner paints first.
  //
  // finalize() also drains the queue synchronously before writing to disk,
  // so the persisted chat.json always has pending=false on tool calls.
  useEffect(() => {
    if (toolResultTick === 0) return
    for (const result of pendingToolResultsRef.current.splice(0)) {
      useChatStore.getState().updateLastToolResult(entityId, result.tool, result.output, result.success)
      if (result.tool === "write_file" && result.content) {
        if (useChatStore.getState().chats[entityId]?.isStreaming) {
          useChatStore.getState().setStreamingContent(entityId, "")
        }
        useChatStore.getState().patchLastToolCallPath(entityId, result.tool, result.path ?? "")
      }
    }
  }, [toolResultTick, entityId])

  const sendMessage = useCallback(async () => {
    const currentChat = useChatStore.getState().chats[entityId] ?? { messages: [], isStreaming: false }
    if (currentChat.isStreaming) return

    const currentInput = input.trim()
    const currentAttachments = attachments
    const currentMentions = mentions

    if (!currentInput && currentAttachments.length === 0) return

    // Build mention context block
    const mentionContext = currentMentions
      .map((m) => {
        if (m.type === "api") {
          // API context as prose — no code fence needed
          return `<!-- @${m.name} -->\nAPI: ${m.name}\n${m.code}\n<!-- end @${m.name} -->`
        }
        const lang = m.type === "theme" ? "css" : "tsx"
        return `<!-- @${m.name} -->\n\`\`\`${lang}\n${m.code}\n\`\`\`\n<!-- end @${m.name} -->`
      })
      .join("\n\n")

    const userContent = mentionContext ? `${mentionContext}\n\n${currentInput}` : currentInput

    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      ...(currentAttachments.length > 0 ? { images: currentAttachments.map((a) => a.base64) } : {}),
    }
    const assistantPlaceholder: ChatMessage = { role: "assistant", content: "" }
    const updatedMessages: ChatMessage[] = [...currentChat.messages, userMessage, assistantPlaceholder]

    useChatStore.getState().setMessages(entityId, updatedMessages)
    useChatStore.getState().setStreaming(entityId, true)
    useChatStore.getState().setStreamingThinking(entityId, "")  // Clear previous thinking
    setInput("")
    setAttachments([])
    setMentions([])

    const isOllama = (provider as Provider).startsWith("ollama")
    const apiMessages = buildApiMessages(
      updatedMessages.slice(0, -1),
      systemPrompt,
      isOllama,
    )

    const resolvedHost = getHostForProvider(provider as Provider, host)
    const resolvedKey = getApiKeyForProvider(provider as Provider, apiKeys)
    const useThinking = resolveThinkParam(caps, isGptOssFamily, thinkEnabled, thinkLevel)
    const effectiveOutputPath = outputPath && toolsEnabled ? outputPath : undefined
    console.log("[think-send] model=%s thinkEnabled=%s caps.thinking=%s isGptOss=%s → think=%s outputPath=%s",
      modelId, thinkEnabled, caps.thinking, isGptOssFamily, useThinking, effectiveOutputPath ?? "(none)")

    ;(stopRef as MutableRefObject<boolean>).current = false

    const channel = new Channel<CompletionEvent>()
    const onMessage = createStreamHandler({
      entityId, chatPath, updatedMessages,
      stopRef, activeRequestIdRef, onOutputRef,
      pendingToolResultsRef, setToolResultTick,
    })
    channel.onmessage = onMessage

    try {
      const requestId = await generateCompletionStream(
        modelId, apiMessages, resolvedHost, resolvedKey,
        channel, useThinking, effectiveOutputPath,
        provider as Provider,
        isOllama ? modelOptions : undefined,
        toolPermissionMode,
        toolAllowlist,
        caps.family,
      )
      activeRequestIdRef.current = requestId
    } catch (e) {
      activeRequestIdRef.current = null
      useChatStore.getState().setStreaming(entityId, false)
      useChatStore.getState().setStreamingThinking(entityId, "")
      notify.error("Generation failed", getErrorMessage(e))
    }
  }, [
    input, attachments, mentions, entityId, chatPath, systemPrompt,
    modelId, host, apiKeys, provider, modelOptions,
    thinkEnabled, thinkLevel, caps, isGptOssFamily, outputPath, toolsEnabled,
    toolPermissionMode, toolAllowlist,
  ])

  const clearChat = useCallback(() => {
    useChatStore.getState().clearChat(entityId)
    writeFile(chatPath, "[]").catch(() => {})
  }, [entityId, chatPath])

  const deleteFrom = useCallback((index: number) => {
    const current = useChatStore.getState().chats[entityId]?.messages ?? []
    const trimmed = current.slice(0, index)
    useChatStore.getState().setMessages(entityId, trimmed)
    writeFile(chatPath, JSON.stringify(trimmed, null, 2)).catch(() => {})
  }, [entityId, chatPath])

  const stopGeneration = useCallback(() => {
    ;(stopRef as MutableRefObject<boolean>).current = true
    useChatStore.getState().setStreaming(entityId, false)
    useChatStore.getState().setStreamingThinking(entityId, "")
    // Cancel the backend stream — signals the Rust CancellationToken which
    // drops the HTTP connection, stopping generation at the source.
    // Per Ollama API docs there is no /api/abort; dropping the connection
    // is the standard cancellation pattern.
    if (activeRequestIdRef.current !== null) {
      stopGenerationRequest(activeRequestIdRef.current).catch(() => {})
      activeRequestIdRef.current = null
    }
  }, [entityId])

  const regenerate = useCallback(async () => {
    const currentChat = useChatStore.getState().chats[entityId] ?? { messages: [], isStreaming: false }
    if (currentChat.isStreaming) return
    const msgs = currentChat.messages
    // Find the last user message index (messages end with assistant reply)
    let lastUserIdx = -1
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") { lastUserIdx = i; break }
    }
    if (lastUserIdx === -1) return
    // Trim back to just before that user message, then replay
    const trimmed = msgs.slice(0, lastUserIdx)
    const userMsg = msgs[lastUserIdx]
    useChatStore.getState().setMessages(entityId, trimmed)

    const assistantPlaceholder: ChatMessage = { role: "assistant", content: "" }
    const updatedMessages: ChatMessage[] = [...trimmed, userMsg, assistantPlaceholder]
    useChatStore.getState().setMessages(entityId, updatedMessages)
    useChatStore.getState().setStreaming(entityId, true)
    useChatStore.getState().setStreamingThinking(entityId, "")

    const isOllamaRegen = (provider as Provider).startsWith("ollama")
    const apiMessages = buildApiMessages(
      updatedMessages.slice(0, -1),
      systemPrompt,
      isOllamaRegen,
    )

    const resolvedHost = getHostForProvider(provider as Provider, host)
    const resolvedKey = getApiKeyForProvider(provider as Provider, apiKeys)
    const useThinking = resolveThinkParam(caps, isGptOssFamily, thinkEnabled, thinkLevel)
    const effectiveOutputPath = outputPath && toolsEnabled ? outputPath : undefined
    console.log("[think-regen] model=%s thinkEnabled=%s caps.thinking=%s isGptOss=%s → think=%s outputPath=%s",
      modelId, thinkEnabled, caps.thinking, isGptOssFamily, useThinking, effectiveOutputPath ?? "(none)")

    ;(stopRef as MutableRefObject<boolean>).current = false

    const channel = new Channel<CompletionEvent>()
    const onMessage = createStreamHandler({
      entityId, chatPath, updatedMessages,
      stopRef, activeRequestIdRef, onOutputRef,
      pendingToolResultsRef, setToolResultTick,
    })
    channel.onmessage = onMessage

    try {
      const requestId = await generateCompletionStream(
        modelId, apiMessages, resolvedHost, resolvedKey,
        channel, useThinking, effectiveOutputPath,
        provider as Provider,
        isOllamaRegen ? modelOptions : undefined,
        toolPermissionMode,
        toolAllowlist,
        caps.family,
      )
      activeRequestIdRef.current = requestId
    } catch (e) {
      activeRequestIdRef.current = null
      useChatStore.getState().setStreaming(entityId, false)
      useChatStore.getState().setStreamingThinking(entityId, "")
      notify.error("Generation failed", getErrorMessage(e))
    }
  }, [
    entityId, chatPath, systemPrompt,
    modelId, host, apiKeys, provider, modelOptions,
    thinkEnabled, thinkLevel, caps, isGptOssFamily, outputPath, toolsEnabled,
    toolPermissionMode, toolAllowlist,
  ])

  const addAttachment = useCallback((file: AttachmentFile) => {
    setAttachments((prev) => [...prev, file])
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const next = [...prev]
      URL.revokeObjectURL(next[index].previewUrl)
      next.splice(index, 1)
      return next
    })
  }, [])

  const addMention = useCallback((asset: MentionAsset) => {
    setMentions((prev) => (prev.some((m) => m.id === asset.id) ? prev : [...prev, asset]))
  }, [])

  const removeMention = useCallback((id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return {
    messages: chat.messages,
    isStreaming: chat.isStreaming,
    thinkingContent: chat.thinkingContent,
    pendingPermissions: chat.pendingPermissions,
    input,
    setInput,
    sendMessage,
    stopGeneration,
    regenerate,
    clearChat,
    deleteFrom,
    attachments,
    addAttachment,
    removeAttachment,
    mentions,
    addMention,
    removeMention,
    thinkEnabled,
    toggleThink: () => setThinkEnabled((v) => !v),
    thinkLevel,
    setThinkLevel: (level: "low" | "medium" | "high") => setThinkLevel(level),
    isGptOssFamily,
    canThink: caps.thinking,
    toolsEnabled,
    toggleTools: () => setToolsEnabled((v) => !v),
    canTools: caps.tools,
    canVision: caps.vision,
    capsLoading: caps.loading,
  }
}
