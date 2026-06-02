import { create } from "zustand"
import type { ChatMessage, StreamChunk, ToolPermissionRecord } from "@/types/chat"

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  thinkingContent: string
  pendingPermissions: ToolPermissionRecord[]
}

interface ChatStore {
  chats: Record<string, ChatState>
  getChat: (id: string) => ChatState
  setMessages: (id: string, messages: ChatMessage[]) => void
  setStreaming: (id: string, streaming: boolean) => void
  appendChunk: (id: string, chunk: string) => void
  setStreamingContent: (id: string, content: string) => void
  setStreamingThinking: (id: string, thinking: string) => void
  attachToolCall: (id: string, tool: string, path: string, args: Record<string, unknown>) => void
  /** Resolve the first pending tool call matching `tool` (front-to-back order matches
   *  ToolCall/ToolResult arrival order, fixing result swapping for parallel same-name tools). */
  resolveToolCall: (id: string, tool: string, result: string, success: boolean, path: string) => void
  clearChat: (id: string) => void
  addStreamChunk: (id: string, chunk: StreamChunk) => void
  attachToolPermission: (id: string, record: ToolPermissionRecord) => void
  resolveToolPermission: (id: string, requestId: number, decision: ToolPermissionRecord["decision"]) => void
}

const EMPTY: ChatState = { messages: [], isStreaming: false, thinkingContent: "", pendingPermissions: [] }

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

  attachToolCall: (id, tool, path, args) =>
    set((s) => {
      const chat = s.chats[id] ?? EMPTY
      const messages = [...chat.messages]
      const last = messages[messages.length - 1]
      if (last?.role === "assistant") {
        const prev = last.toolCalls ?? []
        messages[messages.length - 1] = { ...last, toolCalls: [...prev, { tool, path, arguments: args, pending: true }] }
      }
      return { chats: { ...s.chats, [id]: { ...chat, messages } } }
    }),

  resolveToolCall: (id, tool, result, success, path) =>
    set((s) => {
      const chat = s.chats[id] ?? EMPTY
      const messages = [...chat.messages]
      const last = messages[messages.length - 1]
      if (last?.role === "assistant" && last.toolCalls?.length) {
        const toolCalls = [...last.toolCalls]
        // Search front-to-back: ToolCall events arrive in index order and ToolResult
        // events are emitted in the same index order after parallel execution completes.
        // Searching from the front ensures result[0] matches toolCalls[0], not toolCalls[N].
        for (let i = 0; i < toolCalls.length; i++) {
          if (toolCalls[i].tool === tool && toolCalls[i].pending) {
            toolCalls[i] = { ...toolCalls[i], result, success, pending: false, path }
            break
          }
        }
        messages[messages.length - 1] = { ...last, toolCalls }
      }
      return { chats: { ...s.chats, [id]: { ...chat, messages } } }
    }),

  clearChat: (id) =>
    set((s) => ({ chats: { ...s.chats, [id]: EMPTY } })),

  addStreamChunk: (id, chunk) =>
    set((s) => {
      const chat = s.chats[id] ?? EMPTY
      const messages = [...chat.messages]
      const last = messages[messages.length - 1]
      if (last?.role === "assistant") {
        const prev = last.streamChunks ?? []
        messages[messages.length - 1] = { ...last, streamChunks: [...prev, chunk] }
      }
      return { chats: { ...s.chats, [id]: { ...chat, messages } } }
    }),

  attachToolPermission: (id, record) =>
    set((s) => {
      const chat = s.chats[id] ?? EMPTY
      const pendingPermissions = [...chat.pendingPermissions, record]
      return { chats: { ...s.chats, [id]: { ...chat, pendingPermissions } } }
    }),

  resolveToolPermission: (id, requestId, decision) =>
    set((s) => {
      const chat = s.chats[id] ?? EMPTY
      const pendingPermissions = chat.pendingPermissions.map((p) =>
        p.requestId === requestId ? { ...p, pending: false, decision } : p
      )
      return { chats: { ...s.chats, [id]: { ...chat, pendingPermissions } } }
    }),
}))
