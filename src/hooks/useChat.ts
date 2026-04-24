import { useEffect, useRef, useState, useCallback } from "react"
import { Channel } from "@tauri-apps/api/core"
import { useChatStore } from "@/stores/chatStore"
import { useAppStore } from "@/stores/appStore"
import {
  generateCompletionStream,
  readFile,
  writeFile,
  getApiKey,
  getModelHost,
  type CompletionEvent,
} from "@/lib/ipc"
import type { ChatMessage, MentionAsset, AttachmentFile } from "@/types/chat"

// Stable reference used as fallback when entity has no chat state yet.
// Must be module-level so the reference is constant across renders —
// Zustand's useSyncExternalStore requires the snapshot to be cached.
const EMPTY_CHAT = { messages: [] as ChatMessage[], isStreaming: false }

interface UseChatOptions {
  entityId: string
  chatPath: string
  systemPrompt: string
  onOutput?: (content: string) => void
}

export function useChat({ entityId, chatPath, systemPrompt, onOutput }: UseChatOptions) {
  const store = useChatStore()
  const settings = useAppStore((s) => s.settings)
  const chat = useChatStore((s) => s.chats[entityId] ?? EMPTY_CHAT)

  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [mentions, setMentions] = useState<MentionAsset[]>([])

  // Track which entityIds we've already loaded from disk
  const loadedRef = useRef<Set<string>>(new Set())

  // Cold start: load from disk the first time this entityId is accessed
  useEffect(() => {
    if (loadedRef.current.has(entityId)) return
    loadedRef.current.add(entityId)
    if (chat.messages.length > 0) return
    readFile(chatPath)
      .then((raw) => {
        try {
          const messages = JSON.parse(raw) as ChatMessage[]
          if (Array.isArray(messages) && messages.length > 0) {
            store.setMessages(entityId, messages)
          }
        } catch {}
      })
      .catch(() => {})
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

    store.setMessages(entityId, updatedMessages)
    store.setStreaming(entityId, true)
    setInput("")
    setAttachments([])
    setMentions([])

    // Build API messages (system + history without trailing placeholder)
    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...updatedMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images?.length ? { images: m.images } : {}),
      })),
    ]

    const { modelId, host, ollamaCloudModels, apiKeys } = settings
    const resolvedHost = getModelHost(modelId, host, ollamaCloudModels, apiKeys["ollama"])
    const resolvedKey = getApiKey(modelId, apiKeys)

    const channel = new Channel<CompletionEvent>()
    let accumulated = ""

    channel.onmessage = (msg) => {
      if (msg.event === "Chunk") {
        accumulated += msg.data.text
        useChatStore.getState().appendChunk(entityId, msg.data.text)
      } else if (msg.event === "Done") {
        const finalMessages: ChatMessage[] = [
          ...updatedMessages.slice(0, -1),
          { role: "assistant", content: accumulated },
        ]
        useChatStore.getState().setMessages(entityId, finalMessages)
        useChatStore.getState().setStreaming(entityId, false)
        writeFile(chatPath, JSON.stringify(finalMessages, null, 2)).catch(() => {})
        onOutput?.(accumulated)
      } else if (msg.event === "Error") {
        useChatStore.getState().setMessages(entityId, updatedMessages.slice(0, -1))
        useChatStore.getState().setStreaming(entityId, false)
      }
    }

    try {
      await generateCompletionStream(modelId, apiMessages, resolvedHost, resolvedKey, channel)
    } catch {
      useChatStore.getState().setStreaming(entityId, false)
    }
  }, [input, attachments, mentions, entityId, chatPath, systemPrompt, settings, onOutput])

  const clearChat = useCallback(() => {
    store.clearChat(entityId)
    writeFile(chatPath, "[]").catch(() => {})
  }, [entityId, chatPath])

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
    input,
    setInput,
    sendMessage,
    clearChat,
    attachments,
    addAttachment,
    removeAttachment,
    mentions,
    addMention,
    removeMention,
  }
}
