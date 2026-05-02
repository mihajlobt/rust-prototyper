import { memo } from "react"
import { Copy, Code2, RefreshCw, Trash2, Sparkles } from "lucide-react"
import { cn } from "@/lib/utils"

/** Small action button used inside message action rows. */
function MsgActionBtn({ className, children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn("p-1 rounded flex items-center gap-1 text-xs transition-colors text-muted-foreground hover:text-foreground hover:bg-muted", className)}
      {...props}
    >
      {children}
    </button>
  )
}
import { Tool } from "@/components/ui/tool"
import type { ToolPart } from "@/components/ui/tool"
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from "@/components/ui/chat-container"
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction } from "@/components/ui/message"
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ui/reasoning"
import { Loader } from "@/components/ui/loader"
import { ScrollButton } from "@/components/ui/scroll-button"
import type { ChatMessage, ToolCallRecord } from "@/types/chat"

function toolPartFromRecord(tc: ToolCallRecord): ToolPart {
  // "(no output)" from grep/filter commands ≠ error (just no match)
  // Always show as info, ignore the success field for this case
  const isEmptyOutput = tc.result === "" || tc.result === undefined || tc.result === "(no output)"
  // Only show error if success is explicitly false AND output has actual content
  const isRealError = tc.success === false && !isEmptyOutput
  const state = tc.pending
    ? "input-streaming"
    : isEmptyOutput
    ? "output-empty"
    : isRealError
    ? "output-error"
    : "output-available"

  const filename = tc.path ? tc.path.split("/").pop() : undefined

  switch (tc.tool) {
    case "write_file":
      return {
        type: "write_file",
        state,
        input: filename ? { file: filename } : tc.arguments,
        output: tc.result !== undefined ? { written: filename ?? "file" } : undefined,
      }
    case "read_file":
      return {
        type: "read_file",
        state,
        input: { path: (tc.arguments.path as string) ?? tc.path },
        output: tc.result !== undefined ? { contents: tc.result.slice(0, 500) + (tc.result.length > 500 ? "…" : "") } : undefined,
        errorText: tc.success === false ? tc.result : undefined,
      }
    case "bash":
      return {
        type: "bash",
        state,
        input: { command: tc.arguments.command as string },
        output: tc.result !== undefined ? { output: tc.result } : undefined,
        errorText: tc.success === false ? tc.result : undefined,
      }
    default:
      return {
        type: tc.tool,
        state,
        input: tc.arguments,
        output: tc.result !== undefined ? { result: tc.result } : undefined,
      }
  }
}

interface MessageListProps {
  messages: ChatMessage[]
  isStreaming: boolean
  thinkingContent: string
  onApplyCode?: (content: string) => void
  onRegenerate?: () => void
  onDeleteFrom?: (index: number) => void
}

export function MessageList({
  messages, isStreaming, thinkingContent,
  onApplyCode, onRegenerate, onDeleteFrom,
}: MessageListProps) {
  if (messages.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2 text-muted-foreground">
          <Sparkles size={20} strokeWidth={1.5} />
          <p className="text-sm">Send a message to start</p>
        </div>
      </div>
    )
  }

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
  onApplyCode?: (content: string) => void
  onRegenerate?: () => void
  onDeleteFrom?: (index: number) => void
}

const MessageBubble = memo(function MessageBubble({
  message, index, isStreaming, streamingThinking, isLastAssistant,
  onApplyCode, onRegenerate, onDeleteFrom,
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
              <MsgActionBtn onClick={() => navigator.clipboard.writeText(content)}>
                <Copy size={13} />
              </MsgActionBtn>
            </MessageAction>
            {onDeleteFrom && (
              <MessageAction tooltip="Delete from here">
                <MsgActionBtn className="hover:text-destructive" onClick={() => onDeleteFrom(index)}>
                  <Trash2 size={13} />
                </MsgActionBtn>
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

        {/* Tool cards — pending spinner while executing, result when done */}
        {message.toolCalls?.length ? (
          message.toolCalls.map((tc, i) => (
            <Tool
              key={i}
              toolPart={toolPartFromRecord(tc)}
              defaultOpen
            />
          ))
        ) : null}

        {/* Generating indicator — streaming with no tool calls yet */}
        {isStreaming && !isEmpty && !message.toolCalls?.length && (
          <Loader variant="loading-dots" size="sm" text="Generating" />
        )}

        {/* Single-row actions: copy + apply + regenerate */}
        {!isStreaming && content && (
          <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity flex-wrap">
            <MessageAction tooltip="Copy message">
              <MsgActionBtn onClick={() => navigator.clipboard.writeText(content)}>
                <Copy size={13} />
              </MsgActionBtn>
            </MessageAction>
            {onApplyCode && hasCode && (
              <MessageAction tooltip="Apply code">
                <MsgActionBtn onClick={() => onApplyCode(content)}>
                  <Code2 size={13} /> Apply
                </MsgActionBtn>
              </MessageAction>
            )}
            {isLastAssistant && onRegenerate && (
              <MessageAction tooltip="Regenerate">
                <MsgActionBtn onClick={onRegenerate}>
                  <RefreshCw size={13} /> Retry
                </MsgActionBtn>
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
  prev.streamingThinking === next.streamingThinking &&
  prev.onApplyCode === next.onApplyCode &&
  prev.onRegenerate === next.onRegenerate &&
  prev.onDeleteFrom === next.onDeleteFrom
)
