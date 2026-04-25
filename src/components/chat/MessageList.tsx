import { memo } from "react"
import { Copy, Code2, FileCode, RefreshCw } from "lucide-react"
import { extractCode } from "@/lib/preview"
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from "@/components/ui/chat-container"
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction } from "@/components/ui/message"
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ui/reasoning"
import { Loader } from "@/components/ui/loader"
import { ScrollButton } from "@/components/ui/scroll-button"
import type { ChatMessage } from "@/types/chat"


interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  /** Accumulated thinking text during streaming (empty string when not streaming or no thinking) */
  thinkingContent: string
  onApplyCode?: (content: string) => void
  onRegenerate?: () => void
}

export function MessageList({ messages, isStreaming, thinkingContent, onApplyCode, onRegenerate }: MessageListProps) {
  return (
    <div className="relative flex-1 min-h-0">
      <ChatContainerRoot className="h-full">
        <ChatContainerContent className="gap-3 p-3">
          {messages.map((msg, i) => (
            <MessageBubble
              key={`${msg.role}-${i}`}
              message={msg}
              isStreaming={isStreaming && i === messages.length - 1 && msg.role === "assistant"}
              streamingThinking={isStreaming && i === messages.length - 1 && msg.role === "assistant" ? thinkingContent : ""}
              isLastAssistant={!isStreaming && i === messages.length - 1 && msg.role === "assistant"}
              onApplyCode={onApplyCode}
              onRegenerate={onRegenerate}
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
  /** Thinking text from store, only for the currently-streaming message */
  streamingThinking: string
  isLastAssistant: boolean
  onApplyCode?: (content: string) => void
  onRegenerate?: () => void
}

const MessageBubble = memo(function MessageBubble({
  message,
  isStreaming,
  streamingThinking,
  isLastAssistant,
  onApplyCode,
  onRegenerate,
}: MessageBubbleProps) {
  const content = message.content
  const isEmpty = isStreaming && content === "" && !streamingThinking

  const hasThinking = isStreaming ? streamingThinking.length > 0 : !!message.thinking
  const thinkingText = isStreaming ? streamingThinking : (message.thinking ?? "")

  const hasCode = !!extractCode(content)

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
                Thinking
              </ReasoningTrigger>
              <ReasoningContent markdown={!isStreaming} className="text-xs">
                {thinkingText}
              </ReasoningContent>
            </Reasoning>
            <MessageContent markdown isStreaming={isStreaming} className="text-sm">
              {content}
            </MessageContent>
          </>
        ) : (
          <MessageContent markdown isStreaming={isStreaming} className="text-sm">
            {content}
          </MessageContent>
        )}
        {/* Tool call chips */}
        {message.toolCalls?.map((tc, i) => (
          <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-2 py-1 w-fit bg-muted/30">
            <FileCode size={12} />
            <span>Wrote <code className="font-mono">{tc.path.split("/").pop()}</code></span>
          </div>
        ))}
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
        {isLastAssistant && onRegenerate && (
          <button
            onClick={onRegenerate}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5 opacity-0 group-hover:opacity-100"
          >
            <RefreshCw size={12} />
            Regenerate
          </button>
        )}
      </div>
    </Message>
  )
}, (prev, next) =>
  prev.message.content === next.message.content &&
  prev.message.toolCalls === next.message.toolCalls &&
  prev.isStreaming === next.isStreaming &&
  prev.isLastAssistant === next.isLastAssistant &&
  prev.streamingThinking === next.streamingThinking &&
  prev.onApplyCode === next.onApplyCode &&
  prev.onRegenerate === next.onRegenerate
)