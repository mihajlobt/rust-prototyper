import type { ChatMessage } from "@/types/chat"

/** Strip `thinking` from every message except the most recent assistant message.
 *  Keeps old reasoning out of the request payload; chat.json is untouched.
 *  See src-tauri/src/agent/agent_loop.rs:48-59, src/hooks/chat/messages.ts:32-34, :70-73. */
export function dropStaleThinking(messages: ChatMessage[]): ChatMessage[] {
  const lastAssistantIndex = messages
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.role === "assistant")?.index ?? -1
  return messages.map((message, index) => {
    if (message.thinking && index !== lastAssistantIndex) {
      return { ...message, thinking: undefined }
    }
    return message
  })
}
