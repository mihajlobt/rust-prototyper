import type { Message } from "@/lib/ipc"
import type { ChatMessage } from "@/types/chat"

/** Strip leading ```lang and trailing ``` from a code block. Used after the
 *  model emits a fenced file content via write_file / edit_file tool calls. */
export function stripFences(content: string): string {
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
export function buildApiMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  isOllama: boolean,
  toolOutputResendLimit: number,
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
      // Insert tool role messages after the assistant's tool_calls.
      // Cap resent tool results to the configured resend limit so long
      // conversations don't retransmit unbounded tool output every turn.
      for (const tc of m.toolCalls) {
        if (tc.result !== undefined) {
          const content = tc.result.length > toolOutputResendLimit
            ? `${tc.result.slice(0, toolOutputResendLimit)}\n... (output truncated, ${tc.result.length} characters total)`
            : tc.result
          result.push({
            role: "tool",
            content,
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
