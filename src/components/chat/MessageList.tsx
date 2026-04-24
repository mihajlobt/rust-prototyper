import { useEffect, useRef } from "react"
import { parseBlocks } from "@/lib/chat-utils"
import { ThinkingBlock } from "./ThinkingBlock"
import type { ChatMessage } from "@/types/chat"

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
}

export function MessageList({ messages, isStreaming }: MessageListProps) {
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    <div className="flex flex-col gap-3 overflow-y-auto p-3 h-full">
      {messages.map((msg, i) => (
        <MessageBubble
          key={i}
          message={msg}
          isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming: boolean
}

function MessageBubble({ message, isStreaming }: MessageBubbleProps) {
  const blocks = parseBlocks(message.content)
  const isEmpty = isStreaming && message.content === ""

  return (
    <div className={`flex flex-col gap-1 ${message.role === "user" ? "items-end" : "items-start"}`}>
      {message.images && message.images.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-1">
          {message.images.map((img, i) => (
            <img
              key={i}
              src={`data:image/jpeg;base64,${img}`}
              alt="attachment"
              className="h-16 w-16 rounded object-cover border border-border"
            />
          ))}
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          message.role === "user"
            ? "bg-accent/20 text-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {message.role === "assistant" ? (
          <>
            {isEmpty ? (
              <span className="flex gap-1 items-center">
                <span className="thinking-dot" />
                <span className="thinking-dot" />
                <span className="thinking-dot" />
              </span>
            ) : (
              blocks.map((block, i) =>
                block.type === "thinking" ? (
                  <ThinkingBlock key={i} block={block} />
                ) : (
                  <span key={i} className="whitespace-pre-wrap">{block.content}</span>
                )
              )
            )}
          </>
        ) : (
          <span className="whitespace-pre-wrap">{message.content}</span>
        )}
      </div>
    </div>
  )
}
