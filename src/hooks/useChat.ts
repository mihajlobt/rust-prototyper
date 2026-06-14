import { useEffect, useRef, useState, useCallback, type MutableRefObject, type RefObject } from "react"
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
} from "@/lib/ipc"
import type { ChatMessage, MentionAsset, AttachmentFile } from "@/types/chat"
import { notify } from "@/hooks/useToast"
import { useModelCapabilities } from "@/hooks/useModelCapabilities"
import { resolveThinkParam } from "./chat/think"
import { buildApiMessages } from "./chat/messages"
import { createStreamHandler } from "./chat/streamHandler"

// Re-export for external consumers (ComponentsPanel, ScreensPanel).
// The implementation lives in ./chat/think to keep this hook file small.
export { resolveThinkParam }

// Stable reference used as fallback when entity has no chat state yet.
// Must be module-level so the reference is constant across renders —
// Zustand's useSyncExternalStore requires the snapshot to be cached.
const EMPTY_CHAT = { messages: [] as ChatMessage[], isStreaming: false }

interface UseChatOptions {
  entityId: string
  chatPath: string
  systemPrompt: string
  outputPath?: string
  /** Called when the final text arrives from a non-tool model (Done, no write_file). */
  onOutput?: (content: string) => void
  /** Called when write_file succeeds for the primary output file. Content is raw code, no fences. */
  onCodeOutput?: (content: string) => void
  /** Called for EVERY successful write_file / edit_file (path + content). Use for multi-file updates. */
  onToolWrite?: (path: string, content: string) => void
  /** If provided, only these tool names are offered to the model (overrides global all-tools default). */
  panelToolFilter?: string[]
  /** If provided, overrides global settings.maxToolCalls for this panel. */
  panelMaxToolCalls?: number
  /** Called for every ToolCall event before the store update. */
  onToolCall?: (tool: string, args: Record<string, unknown>) => void
  /** Called for every ToolResult event after the store update. */
  onToolResult?: (tool: string, success: boolean, output: string, path?: string) => void
}

// ─── useChat hook ──────────────────────────────────────────────────────────

export function useChat({ entityId, chatPath, systemPrompt, outputPath, onOutput, onCodeOutput, onToolWrite, panelToolFilter, panelMaxToolCalls, onToolCall, onToolResult }: UseChatOptions) {
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
  const maxToolCalls = useAppStore((s) => s.settings.maxToolCalls)
  const searxngUrl  = useAppStore((s) => s.settings.searxngUrl)
  const writeFileLimit = useAppStore((s) => s.settings.writeFileLimit)
  const toolOutputHistoryLimit = useAppStore((s) => s.settings.toolOutputHistoryLimit)

  const chat = useChatStore((s) => s.chats[entityId] ?? EMPTY_CHAT)

  const onOutputRef = useRef(onOutput) as MutableRefObject<typeof onOutput>
  useEffect(() => { onOutputRef.current = onOutput }, [onOutput])
  const onCodeOutputRef = useRef(onCodeOutput) as MutableRefObject<typeof onCodeOutput>
  useEffect(() => { onCodeOutputRef.current = onCodeOutput }, [onCodeOutput])
  const onToolWriteRef = useRef(onToolWrite) as MutableRefObject<typeof onToolWrite>
  useEffect(() => { onToolWriteRef.current = onToolWrite }, [onToolWrite])
  const onToolCallRef = useRef(onToolCall) as MutableRefObject<typeof onToolCall>
  useEffect(() => { onToolCallRef.current = onToolCall }, [onToolCall])
  const onToolResultRef = useRef(onToolResult) as MutableRefObject<typeof onToolResult>
  useEffect(() => { onToolResultRef.current = onToolResult }, [onToolResult])

  // Shared stop flag — set to true to abort the current stream mid-flight
  const stopRef = useRef(false) as RefObject<boolean>
  // Active request ID returned by the Rust backend — used to cancel
  // the stream server-side via stopGenerationRequest
  const activeRequestIdRef = useRef<number | null>(null)

  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [mentions, setMentions] = useState<MentionAsset[]>([])
  // Refs so sendMessage reads current values at call time without being in its
  // dep array — keeps sendMessage stable across keystrokes.
  const inputRef = useRef(input)
  const attachmentsRef = useRef(attachments)
  const mentionsRef = useRef(mentions)
  useEffect(() => { inputRef.current = input }, [input])
  useEffect(() => { attachmentsRef.current = attachments }, [attachments])
  useEffect(() => { mentionsRef.current = mentions }, [mentions])
  const activeBriefNameRef = useRef<string>("")

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

  // Cold start: load from disk the first time this entityId is accessed
  useEffect(() => {
    if (loadedRef.current.has(entityId)) return
    if (useChatStore.getState().chats[entityId]?.messages.length) return
    let cancelled = false
    readFile(chatPath)
      .then((raw) => {
        if (cancelled) return
        // After cancelled check: StrictMode cleanup sets cancelled=true on Effect 1 so Effect 2 can retry — react.dev/reference/react/useEffect#my-effect-runs-twice-when-the-component-mounts
        loadedRef.current.add(entityId)
        try {
          const messages = JSON.parse(raw) as ChatMessage[]
          if (Array.isArray(messages) && messages.length > 0) {
            useChatStore.getState().setMessages(entityId, messages)
          }
        } catch { /* ignore corrupt chat file */ }
      })
      .catch(() => {
        if (!cancelled) loadedRef.current.add(entityId)
      })
    return () => { cancelled = true }
  }, [entityId, chatPath])

  const sendMessage = useCallback(async (textOverride?: string) => {
    const currentChat = useChatStore.getState().chats[entityId] ?? { messages: [], isStreaming: false }
    if (currentChat.isStreaming) return

    const currentInput = (textOverride ?? inputRef.current).trim()
    const currentAttachments = attachmentsRef.current
    const currentMentions = mentionsRef.current

    if (!currentInput && currentAttachments.length === 0) return
    useChatStore.getState().clearPendingPermissions(entityId)

    // Build mention context block
    const mentionContext = currentMentions
      .map((m) => {
        if (m.type === "api") {
          const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
          const hookName = "use" + m.name.replace(/[^a-zA-Z0-9]+(.)?/g, (_: string, c: string) => (c ? c.toUpperCase() : "")).replace(/^./, (c: string) => c.toUpperCase())
          return `<!-- @${m.name} -->\nAPI available: ${m.name}\n${m.code}\nService hook: import { ${hookName} } from '@/services/${slug}'\nYou MUST use this hook. Do NOT use fetch() directly, useEffect for data fetching, or mock data.\n<!-- end @${m.name} -->`
        }
        const lang = m.type === "theme" ? "css" : m.type === "file" || m.type === "plan" ? "md" : "tsx"
        return `<!-- @${m.name} -->\n\`\`\`${lang}\n${m.code}\n\`\`\`\n<!-- end @${m.name} -->`
      })
      .join("\n\n")

    const userContent = mentionContext ? `${mentionContext}\n\n${currentInput}` : currentInput

    const briefName = activeBriefNameRef.current
    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      ...(currentAttachments.length > 0 ? { images: currentAttachments.map((a) => a.base64) } : {}),
      ...(currentMentions.length > 0 ? { mentions: currentMentions.map((m) => ({ type: m.type, name: m.name, description: m.description })) } : {}),
      ...(briefName ? { brief: briefName } : {}),
    }
    const assistantPlaceholder: ChatMessage = { role: "assistant", content: "" }
    const updatedMessages: ChatMessage[] = [...currentChat.messages, userMessage, assistantPlaceholder]

    useChatStore.getState().setMessages(entityId, updatedMessages)
    writeFile(chatPath, JSON.stringify(updatedMessages, null, 2)).catch(() => {})
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

    ;(stopRef as MutableRefObject<boolean>).current = false

    const channel = new Channel<CompletionEvent>()
    const onMessage = createStreamHandler({
      entityId, chatPath, updatedMessages,
      stopRef, activeRequestIdRef, onOutputRef, onCodeOutputRef, onToolWriteRef, outputPath,
      onToolCallRef, onToolResultRef,
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
        panelMaxToolCalls ?? maxToolCalls,
        panelToolFilter,
        searxngUrl || undefined,
        writeFileLimit,
        toolOutputHistoryLimit,
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
    toolPermissionMode, toolAllowlist, maxToolCalls,
    panelToolFilter, panelMaxToolCalls, searxngUrl,
    writeFileLimit, toolOutputHistoryLimit,
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
    useChatStore.getState().clearPendingPermissions(entityId)
    // Cancel the backend stream — signals the Rust CancellationToken which
    // drops the HTTP connection, stopping generation at the source.
    // Per Ollama API docs there is no /api/abort; dropping the connection
    // is the standard cancellation pattern.
    if (activeRequestIdRef.current !== null) {
      stopGenerationRequest(activeRequestIdRef.current).catch(() => {})
      activeRequestIdRef.current = null
    }
    // Persist partial response — finalize() won't run when stopRef is true
    const msgs = useChatStore.getState().chats[entityId]?.messages ?? []
    if (msgs.length > 0 && chatPath) {
      writeFile(chatPath, JSON.stringify(msgs, null, 2)).catch(() => {})
    }
  }, [entityId, chatPath])

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
    writeFile(chatPath, JSON.stringify(updatedMessages, null, 2)).catch(() => {})
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

    ;(stopRef as MutableRefObject<boolean>).current = false

    const channel = new Channel<CompletionEvent>()
    const onMessage = createStreamHandler({
      entityId, chatPath, updatedMessages,
      stopRef, activeRequestIdRef, onOutputRef, onCodeOutputRef, onToolWriteRef, outputPath,
      onToolCallRef, onToolResultRef,
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
        panelMaxToolCalls ?? maxToolCalls,
        panelToolFilter,
        searxngUrl || undefined,
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
    toolPermissionMode, toolAllowlist, maxToolCalls,
    panelToolFilter, panelMaxToolCalls, searxngUrl,
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
    setActiveBriefName: useCallback((name: string) => { activeBriefNameRef.current = name }, []),
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
