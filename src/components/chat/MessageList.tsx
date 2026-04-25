import { memo } from "react"
import { Copy, Code2 } from "lucide-react"
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from "@/components/ui/chat-container"
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction } from "@/components/ui/message"
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ui/reasoning"
import { Loader } from "@/components/ui/loader"
import { ScrollButton } from "@/components/ui/scroll-button"
import type { ChatMessage } from "@/types/chat"

// Extract thinking content from <think>...</think> tags
function getThinking(content: string): string {
  const match = content.match(/<think>([\s\S]*?)<\/think>/)
  return match ? match[1].trim() : ""
}

// Extract response content without thinking tags
function getResponse(content: string): string {
  return content.replace(/<think>[\s\S]*?<\/?think>/g, "").trim()
}

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  onApplyCode?: (content: string) => void
}

export function MessageList({ messages, isStreaming, onApplyCode }: MessageListProps) {
  return (
    <div className="relative flex-1 min-h-0">
      <ChatContainerRoot className="h-full">
        <ChatContainerContent className="gap-3 p-3">
          {messages.map((msg, i) => (
            <MessageBubble
              key={`${msg.role}-${i}`}
              message={msg}
              isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
              onApplyCode={onApplyCode}
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
  isStreaming: boolean
  onApplyCode?: (content: string) => void
}

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  onApplyCode,
}: MessageBubbleProps) {
  const content = message.content
  const isEmpty = isStreaming && content === ""
  const hasThinking = content.includes("<think>")
  const hasCode = content.includes("```")

  if (message.role === "user") {
    return (
      <Message className="justify-end">
        <MessageAvatar src="" alt="User" fallback="U" />
        <MessageContent className="text-sm">
          {content}
        </MessageContent>
      </Message>
    )
  }

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
                Reasoning
              </ReasoningTrigger>
              <ReasoningContent markdown className="text-xs">
                {getThinking(content)}
              </ReasoningContent>
            </Reasoning>
            <MessageContent markdown className="text-sm">
              {getResponse(content)}
            </MessageContent>
          </>
        ) : (
          <MessageContent markdown className="text-sm">
            {content}
          </MessageContent>
        )}
        {isStreaming && !isEmpty && (
          <Loader variant="loading-dots" size="sm" text="Generating" />
        )}
        {!isStreaming && content && (
          <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
            <MessageAction tooltip="Copy message">
              <button
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                onClick={() => navigator.clipboard.writeText(content)}
              >
                <Copy size={14} />
              </button>
            </MessageAction>
            {onApplyCode && hasCode && (
              <MessageAction tooltip="Apply code">
                <button
                  className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors flex items-center gap-1 text-xs"
                  onClick={() => onApplyCode(content)}
                >
                  <Code2 size={14} />
                  Apply
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
  prev.isStreaming === next.isStreaming &&
  prev.onApplyCode === next.onApplyCode
)