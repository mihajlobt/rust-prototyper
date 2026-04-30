import { useEffect, useRef, useState, useCallback, type MutableRefObject, type RefObject } from "react"

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
      // Assistant message with tool calls
      result.push({
        role: "assistant",
        content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        toolCalls: m.toolCalls.map((tc) => ({
          function: { name: tc.tool, arguments: tc.arguments },
        })),
      })
      // Insert tool role messages after the assistant's tool_calls
      for (const tc of m.toolCalls) {
        if (tc.result !== undefined) {
          result.push({
            role: "tool",
            content: tc.result,
            toolName: tc.tool,
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

export function useChat({ entityId, chatPath, systemPrompt, outputPath, onOutput }: UseChatOptions) {
  const settings = useAppStore((s) => s.settings)
  const chat = useChatStore((s) => s.chats[entityId] ?? EMPTY_CHAT)

  const onOutputRef = useRef(onOutput) as MutableRefObject<typeof onOutput>
  useEffect(() => { onOutputRef.current = onOutput }, [onOutput])

  // Shared stop flag — set to true to abort the current stream mid-flight
  const stopRef = useRef(false) as RefObject<boolean>
  // Active request ID returned by the Rust backend — used to cancel
  // the stream server-side via stopGenerationRequest
  const activeRequestId = useRef<number | null>(null)

  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [mentions, setMentions] = useState<MentionAsset[]>([])

  const caps = useModelCapabilities(settings.modelId)

  const [thinkEnabled, setThinkEnabled] = useState(false)
  const prevCanThinkRef = useRef(false)
  useEffect(() => {
    if (caps.thinking && !prevCanThinkRef.current) {
      setThinkEnabled(true)
    } else if (!caps.thinking) {
      setThinkEnabled(false)
    }
    prevCanThinkRef.current = caps.thinking
  }, [caps.thinking])

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

  const sendMessage = useCallback(async () => {
    const currentChat = useChatStore.getState().chats[entityId] ?? { messages: [], isStreaming: false }
    if (currentChat.isStreaming) return

    const currentInput = input.trim()
    const currentAttachments = attachments
    const currentMentions = mentions

    if (!currentInput && currentAttachments.length === 0) return

    // Build mention context block
    const mentionContext = currentMentions
      .map(
        (m) =>
          `<!-- @${m.name} -->\n\`\`\`${m.type === "theme" ? "css" : "tsx"}\n${m.code}\n\`\`\`\n<!-- end @${m.name} -->`
      )
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

    const { modelId, host, apiKeys, provider } = settings
    const isOllama = (provider as Provider).startsWith("ollama")
    const apiMessages = buildApiMessages(
      updatedMessages.slice(0, -1),
      systemPrompt,
      isOllama,
    )

    const resolvedHost = getHostForProvider(provider as Provider, host)
    const resolvedKey = getApiKeyForProvider(provider as Provider, apiKeys)
    const useThinking = thinkEnabled && caps.thinking
    const effectiveOutputPath = outputPath && toolsEnabled ? outputPath : undefined

    const channel = new Channel<CompletionEvent>()
    let contentAccumulated = ""
    let thinkingAccumulated = ""
    let toolWritten = false
    let rafId: number | null = null
    let rafThinkingId: number | null = null
    ;(stopRef as MutableRefObject<boolean>).current = false

    const finalize = (content: string, thinking: string) => {
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
      if (rafThinkingId !== null) { cancelAnimationFrame(rafThinkingId); rafThinkingId = null }
      activeRequestId.current = null
      // Preserve toolCalls attached by attachToolCall (which updated the store mid-stream)
      const msgs = useChatStore.getState().chats[entityId]?.messages ?? []
      const currentLast = msgs[msgs.length - 1]
      const finalMessage: ChatMessage = {
        role: "assistant",
        content,
        ...(thinking ? { thinking } : {}),
        ...(currentLast?.toolCalls?.length ? { toolCalls: currentLast.toolCalls } : {}),
      }
      const finalMessages: ChatMessage[] = [...updatedMessages.slice(0, -1), finalMessage]
      useChatStore.getState().setMessages(entityId, finalMessages)
      useChatStore.getState().setStreaming(entityId, false)
      useChatStore.getState().setStreamingThinking(entityId, "")
      writeFile(chatPath, JSON.stringify(finalMessages, null, 2)).catch(() => {})
    }

    channel.onmessage = (msg) => {
      if ((stopRef as MutableRefObject<boolean>).current) return
      if (msg.event === "Chunk") {
        // Handle thinking chunk (sent separately from content)
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
        useChatStore.getState().attachToolCall(entityId, msg.data.tool, "", msg.data.args)
      } else if (msg.event === "ToolResult") {
        const { tool, success, output, path, content } = msg.data
        // Logical flags update synchronously — Done handler depends on toolWritten
        if (tool === "write_file" && content) {
          toolWritten = true
          contentAccumulated = ""
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
          onOutputRef.current?.(stripFences(content))
        }
        // Defer visual store updates to next macrotask so the pending spinner
        // gets at least one paint frame before being replaced by the result state.
        // The Tauri Channel while-loop batches ToolCall+ToolResult synchronously,
        // preventing any paint between them — setTimeout(0) breaks out of that.
        setTimeout(() => {
          useChatStore.getState().updateLastToolResult(entityId, tool, output, success)
          if (tool === "write_file" && content) {
            if (useChatStore.getState().chats[entityId]?.isStreaming) {
              useChatStore.getState().setStreamingContent(entityId, "")
            }
            useChatStore.getState().patchLastToolCallPath(entityId, tool, path ?? "")
          }
        }, 0)
      } else if (msg.event === "Done") {
        finalize(contentAccumulated, thinkingAccumulated)
        if (!toolWritten) onOutputRef.current?.(contentAccumulated)
      } else if (msg.event === "Error") {
        finalize(`⚠ ${msg.data.message}`, "")
        notify.error("Generation failed", msg.data.message)
       }
     }

    try {
      const requestId = await generateCompletionStream(
        modelId, apiMessages, resolvedHost, resolvedKey,
        channel, useThinking || undefined, effectiveOutputPath,
        provider as Provider,
        isOllama ? settings.modelOptions : undefined,
      )
      activeRequestId.current = requestId
    } catch (e) {
      activeRequestId.current = null
      useChatStore.getState().setStreaming(entityId, false)
      useChatStore.getState().setStreamingThinking(entityId, "")
      notify.error("Generation failed", e instanceof Error ? e.message : String(e))
    }
  }, [input, attachments, mentions, entityId, chatPath, systemPrompt, settings, thinkEnabled, caps.thinking, outputPath, toolsEnabled])

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
    if (activeRequestId.current !== null) {
      stopGenerationRequest(activeRequestId.current).catch(() => {})
      activeRequestId.current = null
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

    const { modelId, host, apiKeys, provider } = settings
    const isOllamaRegen = (provider as Provider).startsWith("ollama")
    const apiMessages = buildApiMessages(
      updatedMessages.slice(0, -1),
      systemPrompt,
      isOllamaRegen,
    )

    const resolvedHost = getHostForProvider(provider as Provider, host)
    const resolvedKey = getApiKeyForProvider(provider as Provider, apiKeys)
    const useThinking = thinkEnabled && caps.thinking
    const effectiveOutputPath = outputPath && toolsEnabled ? outputPath : undefined

    const channel = new Channel<CompletionEvent>()
    let contentAccumulated = ""
    let thinkingAccumulated = ""
    let toolWrittenRegen = false
    let rafId: number | null = null
    let rafThinkingId: number | null = null
    ;(stopRef as MutableRefObject<boolean>).current = false

    channel.onmessage = (msg) => {
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
        if (msg.data.text) contentAccumulated += msg.data.text
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            rafId = null
            useChatStore.getState().setStreamingContent(entityId, contentAccumulated)
          })
        }
      } else if (msg.event === "ToolCall") {
        useChatStore.getState().attachToolCall(entityId, msg.data.tool, "", msg.data.args)
      } else if (msg.event === "ToolResult") {
        const { tool, success, output, path, content } = msg.data
        if (tool === "write_file" && content) {
          toolWrittenRegen = true
          contentAccumulated = ""
          if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
          onOutputRef.current?.(stripFences(content))
        }
        setTimeout(() => {
          useChatStore.getState().updateLastToolResult(entityId, tool, output, success)
          if (tool === "write_file" && content) {
            if (useChatStore.getState().chats[entityId]?.isStreaming) {
              useChatStore.getState().setStreamingContent(entityId, "")
            }
            useChatStore.getState().patchLastToolCallPath(entityId, tool, path ?? "")
          }
        }, 0)
      } else if (msg.event === "Done") {
        activeRequestId.current = null
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
        const msgs = useChatStore.getState().chats[entityId]?.messages ?? []
        const currentLast = msgs[msgs.length - 1]
        const finalMessage: ChatMessage = {
          role: "assistant",
          content: contentAccumulated,
          ...(thinkingAccumulated ? { thinking: thinkingAccumulated } : {}),
          ...(currentLast?.toolCalls?.length ? { toolCalls: currentLast.toolCalls } : {}),
        }
        const finalMessages: ChatMessage[] = [...updatedMessages.slice(0, -1), finalMessage]
        useChatStore.getState().setMessages(entityId, finalMessages)
        useChatStore.getState().setStreaming(entityId, false)
        useChatStore.getState().setStreamingThinking(entityId, "")
        writeFile(chatPath, JSON.stringify(finalMessages, null, 2)).catch(() => {})
        if (!toolWrittenRegen) onOutputRef.current?.(contentAccumulated)
      } else if (msg.event === "Error") {
        activeRequestId.current = null
        useChatStore.getState().setMessages(entityId, [...updatedMessages.slice(0, -1), { role: "assistant" as const, content: `⚠ ${msg.data.message}` }])
        useChatStore.getState().setStreaming(entityId, false)
        useChatStore.getState().setStreamingThinking(entityId, "")
        notify.error("Generation failed", msg.data.message)
      }
    }

    try {
      const requestId = await generateCompletionStream(
        modelId, apiMessages, resolvedHost, resolvedKey,
        channel, useThinking || undefined, effectiveOutputPath,
        provider as Provider,
        isOllamaRegen ? settings.modelOptions : undefined,
      )
      activeRequestId.current = requestId
    } catch (e) {
      activeRequestId.current = null
      useChatStore.getState().setStreaming(entityId, false)
      useChatStore.getState().setStreamingThinking(entityId, "")
      notify.error("Generation failed", e instanceof Error ? e.message : String(e))
    }
  }, [entityId, chatPath, systemPrompt, settings, thinkEnabled, caps.thinking, outputPath, toolsEnabled])

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
    canThink: caps.thinking,
    toolsEnabled,
    toggleTools: () => setToolsEnabled((v) => !v),
    canTools: caps.tools,
    canVision: caps.vision,
    capsLoading: caps.loading,
  }
}