import { useEffect, useRef, memo } from "react"
import ReactMarkdown from "react-markdown"
import { Copy, Code2 } from "lucide-react"
import { parseBlocks } from "@/lib/chat-utils"
import { extractCode } from "@/lib/preview"
import { ThinkingBlock } from "./ThinkingBlock"
import type { ChatMessage } from "@/types/chat"

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  onApplyCode?: (content: string) => void
}

export function MessageList({ messages, isStreaming, onApplyCode }: MessageListProps) {
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
          onApplyCode={onApplyCode}
        />
      ))}
      <div ref={bottomRef} />
    </div>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  isStreaming: boolean
  onApplyCode?: (content: string) => void
}

const MessageBubble = memo(function MessageBubble({ message, isStreaming, onApplyCode }: MessageBubbleProps) {
  const blocks = parseBlocks(message.content)
  const isEmpty = isStreaming && message.content === ""
  const hasCode = !!extractCode(message.content)

  return (
    <div className={`group flex flex-col gap-1 ${message.role === "user" ? "items-end" : "items-start"}`}>
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
              <span className="streaming-cursor">▋</span>
            ) : (
              <>
                {blocks.map((block, i) =>
                  block.type === "thinking" ? (
                    <ThinkingBlock key={i} block={block} />
                  ) : (
                    <div key={i} className="prose prose-sm dark:prose-invert max-w-none">
                      <ReactMarkdown
                        components={{
                          code({ className, children }) {
                            const code = String(children).replace(/\n$/, "")
                            const isInline = !className && !code.includes("\n")
                            if (isInline) {
                              return <code className="bg-muted-foreground/20 rounded px-1 py-0.5 text-xs font-mono">{children}</code>
                            }
                            return (
                              <div className="relative group/code my-1">
                                <pre className="bg-background border border-border rounded p-3 overflow-x-auto text-xs font-mono">
                                  <code>{code}</code>
                                </pre>
                                <button
                                  className="absolute top-1.5 right-1.5 opacity-0 group-hover/code:opacity-100 transition-opacity p-1 rounded bg-muted hover:bg-muted-foreground/20"
                                  onClick={() => navigator.clipboard.writeText(code)}
                                  title="Copy code"
                                >
                                  <Copy size={11} />
                                </button>
                              </div>
                            )
                          },
                          p({ children }) {
                            return <p className="mb-1 last:mb-0 leading-relaxed">{children}</p>
                          },
                          ul({ children }) {
                            return <ul className="list-disc list-inside mb-1 space-y-0.5">{children}</ul>
                          },
                          ol({ children }) {
                            return <ol className="list-decimal list-inside mb-1 space-y-0.5">{children}</ol>
                          },
                        }}
                      >
                        {block.content}
                      </ReactMarkdown>
                    </div>
                  )
                )}
                {isStreaming && <span className="streaming-cursor">▋</span>}
              </>
            )}
          </>
        ) : (
          <span className="whitespace-pre-wrap">{message.content}</span>
        )}
      </div>

      {/* Hover action bar — shown on completed assistant messages */}
      {message.role === "assistant" && !isStreaming && message.content && (
        <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            onClick={() => navigator.clipboard.writeText(message.content)}
            title="Copy message"
          >
            <Copy size={11} />
          </button>
          {onApplyCode && hasCode && (
            <button
              className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1 text-[10px]"
              onClick={() => onApplyCode(message.content)}
              title="Apply code"
            >
              <Code2 size={11} />
              Apply
            </button>
          )}
        </div>
      )}
    </div>
  )
}, (prev, next) =>
  prev.message.content === next.message.content &&
  prev.isStreaming === next.isStreaming &&
  prev.onApplyCode === next.onApplyCode
)
