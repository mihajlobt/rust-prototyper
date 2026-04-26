import { memo } from "react"
import { Copy, Code2, RefreshCw, Trash2 } from "lucide-react"
import { Tool } from "@/components/ui/tool"
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from "@/components/ui/chat-container"
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction } from "@/components/ui/message"
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ui/reasoning"
import { Loader } from "@/components/ui/loader"
import { ScrollButton } from "@/components/ui/scroll-button"
import type { ChatMessage } from "@/types/chat"

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  thinkingContent: string
  isToolMode?: boolean
  onApplyCode?: (content: string) => void
  onRegenerate?: () => void
  onDeleteFrom?: (index: number) => void
}

export function MessageList({
  messages, isStreaming, thinkingContent, isToolMode,
  onApplyCode, onRegenerate, onDeleteFrom,
}: MessageListProps) {
  return (
    <div className="relative flex-1 min-h-0">
      <ChatContainerRoot className="h-full">
        <ChatContainerContent className="gap-3 p-3">
          {messages.map((msg, i) => (
            <MessageBubble
              key={`${msg.role}-${i}`}
              message={msg}
              index={i}
              isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
              streamingThinking={isStreaming && i === messages.length - 1 && msg.role === "assistant" ? thinkingContent : ""}
              isLastAssistant={!isStreaming && i === messages.length - 1 && msg.role === "assistant"}
              isToolMode={isToolMode}
              onApplyCode={onApplyCode}
              onRegenerate={onRegenerate}
              onDeleteFrom={onDeleteFrom}
            />
          ))}
          <ChatContainerScrollAnchor />
        </ChatContainerContent>
        <div className="absolute right-4 bottom-4 z-10">
          <ScrollButton />
        </div>
      </ChatContainerRoot>
    </div>
  )
}

interface MessageBubbleProps {
  message: ChatMessage
  index: number
  isStreaming: boolean
  streamingThinking: string
  isLastAssistant: boolean
  isToolMode?: boolean
  onApplyCode?: (content: string) => void
  onRegenerate?: () => void
  onDeleteFrom?: (index: number) => void
}

const MessageBubble = memo(function MessageBubble({
  message, index, isStreaming, streamingThinking, isLastAssistant,
  isToolMode, onApplyCode, onRegenerate, onDeleteFrom,
}: MessageBubbleProps) {
  const content = message.content
  const isEmpty = isStreaming && content === "" && !streamingThinking

  const hasThinking = isStreaming ? streamingThinking.length > 0 : !!message.thinking
  const thinkingText = isStreaming ? streamingThinking : (message.thinking ?? "")

  const hasCode = content.includes("```")

  // ── User message ──────────────────────────────────────────────────
  if (message.role === "user") {
    return (
      <Message className="justify-end group">
        <div className="flex flex-col items-end gap-1 max-w-[85%]">
          <MessageContent className="text-sm">
            {content}
          </MessageContent>
          <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
            <MessageAction tooltip="Copy message">
              <button
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => navigator.clipboard.writeText(content)}
              >
                <Copy size={13} />
              </button>
            </MessageAction>
            {onDeleteFrom && (
              <MessageAction tooltip="Delete from here">
                <button
                  className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                  onClick={() => onDeleteFrom(index)}
                >
                  <Trash2 size={13} />
                </button>
              </MessageAction>
            )}
          </MessageActions>
        </div>
        <MessageAvatar src="" alt="User" fallback="U" />
      </Message>
    )
  }

  // ── Assistant message ─────────────────────────────────────────────
  return (
    <Message>
      <MessageAvatar src="" alt="AI" fallback="AI" />
      <div className="flex flex-col gap-1 max-w-[85%]">
        {isEmpty ? (
          <Loader variant="typing" size="sm" />
        ) : hasThinking ? (
          <>
            <Reasoning isStreaming={isStreaming}>
              <ReasoningTrigger className="text-xs text-muted-foreground">
                Thinking
              </ReasoningTrigger>
              <ReasoningContent markdown={!isStreaming} className="text-xs">
                {thinkingText}
              </ReasoningContent>
            </Reasoning>
            {content && (
              <MessageContent markdown isStreaming={isStreaming} className="text-sm">
                {content}
              </MessageContent>
            )}
          </>
        ) : (
          <MessageContent markdown isStreaming={isStreaming} className="text-sm">
            {content}
          </MessageContent>
        )}

        {/* Tool usage — only show after the model actually called the tool (FileWritten fired) */}
        {isToolMode && message.toolCalls?.length ? (
          message.toolCalls.map((tc, i) => (
            <Tool
              key={i}
              toolPart={{
                type: "write_file",
                state: isStreaming ? "input-streaming" : "output-available",
                output: { file: tc.path.split("/").pop() },
              }}
              defaultOpen
            />
          ))
        ) : null}

        {/* Generating indicator — streaming without tool call yet, or non-tool mode */}
        {isStreaming && !isEmpty && !(isToolMode && message.toolCalls?.length) && (
          <Loader variant="loading-dots" size="sm" text="Generating" />
        )}

        {/* Single-row actions: copy + apply + regenerate */}
        {!isStreaming && content && (
          <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity flex-wrap">
            <MessageAction tooltip="Copy message">
              <button
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => navigator.clipboard.writeText(content)}
              >
                <Copy size={13} />
              </button>
            </MessageAction>
            {onApplyCode && hasCode && (
              <MessageAction tooltip="Apply code">
                <button
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1 text-xs"
                  onClick={() => onApplyCode(content)}
                >
                  <Code2 size={13} />
                  Apply
                </button>
              </MessageAction>
            )}
            {isLastAssistant && onRegenerate && (
              <MessageAction tooltip="Regenerate">
                <button
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1 text-xs"
                  onClick={onRegenerate}
                >
                  <RefreshCw size={13} />
                  Retry
                </button>
              </MessageAction>
            )}
          </MessageActions>
        )}
      </div>
    </Message>
  )
}, (prev, next) =>
  prev.message.content === next.message.content &&
  prev.message.toolCalls === next.message.toolCalls &&
  prev.message.thinking === next.message.thinking &&
  prev.isStreaming === next.isStreaming &&
  prev.isLastAssistant === next.isLastAssistant &&
  prev.isToolMode === next.isToolMode &&
  prev.streamingThinking === next.streamingThinking &&
  prev.onApplyCode === next.onApplyCode &&
  prev.onRegenerate === next.onRegenerate &&
  prev.onDeleteFrom === next.onDeleteFrom
)
