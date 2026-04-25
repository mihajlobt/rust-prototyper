import { create } from "zustand"
import type { ChatMessage } from "@/types/chat"

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  thinkingContent: string  // Accumulated thinking during streaming (separate field)
}

interface ChatStore {
  chats: Record<string, ChatState>
  getChat: (id: string) => ChatState
  setMessages: (id: string, messages: ChatMessage[]) => void
  setStreaming: (id: string, streaming: boolean) => void
  appendChunk: (id: string, chunk: string) => void
  setStreamingContent: (id: string, content: string) => void
  setStreamingThinking: (id: string, thinking: string) => void  // NEW: track thinking separately
  clearChat: (id: string) => void
}

const EMPTY: ChatState = { messages: [], isStreaming: false, thinkingContent: "" }

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: {},

  getChat: (id) => get().chats[id] ?? EMPTY,

  setMessages: (id, messages) =>
    set((s) => ({
      chats: { ...s.chats, [id]: { ...(s.chats[id] ?? EMPTY), messages } },
    })),

  setStreaming: (id, isStreaming) =>
    set((s) => ({
      chats: { ...s.chats, [id]: { ...(s.chats[id] ?? EMPTY), isStreaming } },
    })),

  // Mutates only the last assistant message — avoids full array replacement on every chunk
  appendChunk: (id, chunk) =>
    set((s) => {
      const chat = s.chats[id] ?? EMPTY
      const messages = [...chat.messages]
      const last = messages[messages.length - 1]
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, content: last.content + chunk }
      }
      return { chats: { ...s.chats, [id]: { ...chat, messages } } }
    }),

  // Sets the last assistant message content directly — used by rAF batcher in useChat
  setStreamingContent: (id, content) =>
    set((s) => {
      const chat = s.chats[id] ?? EMPTY
      const messages = [...chat.messages]
      const last = messages[messages.length - 1]
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, content }
      }
      return { chats: { ...s.chats, [id]: { ...chat, messages } } }
    }),

  // NEW: track thinking content separately during streaming
  setStreamingThinking: (id, thinking) =>
    set((s) => ({
      chats: { ...s.chats, [id]: { ...(s.chats[id] ?? EMPTY), thinkingContent: thinking } },
    })),

  clearChat: (id) =>
    set((s) => ({ chats: { ...s.chats, [id]: EMPTY } })),
}))
