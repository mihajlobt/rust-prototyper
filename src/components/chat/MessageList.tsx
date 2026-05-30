import { memo } from "react"
import { Copy, Code2, RefreshCw, Trash2, Sparkles, Layout, Box, Palette, Globe, FileText } from "lucide-react"
import { cn } from "@/lib/utils"
import type { MentionAsset } from "@/types/chat"

/** Icon for a mention asset type, matching ProjectExplorer colors */
function mentionIcon(type: MentionAsset["type"]) {
  switch (type) {
    case "screen": return <Layout size={13} className="shrink-0 text-blue-400" />
    case "component": return <Box size={13} className="shrink-0 text-purple-400" />
    case "theme": return <Palette size={13} className="shrink-0 text-pink-400" />
    case "api": return <Globe size={13} className="shrink-0 text-yellow-400" />
    case "file": return <FileText size={13} className="shrink-0 text-green-400" />
  }
}

const MENTION_TYPE_LABEL: Record<MentionAsset["type"], string> = {
  screen: "Screen",
  component: "Component",
  theme: "Theme",
  api: "API",
  file: "File",
}

/** Card showing a referenced project item in a user message */
function MentionCard({ mention }: { mention: { type: MentionAsset["type"]; name: string; description?: string } }) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 px-2 py-1.5 text-xs max-w-[220px]">
      <span className="mt-0.5">{mentionIcon(mention.type)}</span>
      <div className="min-w-0 flex-1">
        <div className="font-medium text-foreground truncate">{mention.name}</div>
        <div className="text-muted-foreground text-[10px] leading-tight truncate">{mention.description ?? MENTION_TYPE_LABEL[mention.type]}</div>
      </div>
    </div>
  )
}

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
import { ToolPermissionCard, type ToolPermissionDecision } from "@/components/ui/ToolPermissionCard"
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from "@/components/ui/chat-container"
import { Message, MessageAvatar, MessageContent, MessageActions, MessageAction } from "@/components/ui/message"
import { Reasoning, ReasoningTrigger, ReasoningContent } from "@/components/ui/reasoning"
import { Loader } from "@/components/ui/loader"
import { ScrollButton } from "@/components/ui/scroll-button"
import type { ChatMessage, ToolCallRecord, ToolPermissionRecord } from "@/types/chat"

function toolPartFromRecord(tc: ToolCallRecord): ToolPart {
  // "(no output)" from grep/filter commands ≠ error (just no match)
  // Also handle empty string results from write/edit tools
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
    case "write_file": {
      const writePath = (tc.arguments.path as string) ?? tc.path ?? filename ?? "unknown"
      const writeContent = typeof tc.arguments.content === "string" ? tc.arguments.content : undefined
      return {
        type: "write_file",
        state,
        input: { path: writePath },
        fileContent: writeContent !== undefined
          ? { path: writePath, content: writeContent }
          : undefined,
        errorText: tc.success === false ? tc.result : undefined,
      }
    }
    case "read_file": {
      const filePath = (tc.arguments.path as string) ?? tc.path ?? ""
      // Extract content between XML tags when executor wraps it
      let content = tc.result ?? ""
      if (content.includes("<content>")) {
        const match = content.match(/<content>([\s\S]*?)<\/content>/)
        if (match) content = match[1].trim()
      }
      return {
        type: "read_file",
        state,
        input: { path: filePath },
        fileContent: tc.result !== undefined && tc.success !== false
          ? { path: filePath, content }
          : undefined,
        errorText: tc.success === false ? tc.result : undefined,
      }
    }
    case "edit_file": {
      const editPath = (tc.arguments.path as string) ?? tc.path ?? filename ?? "unknown"
      const oldString = typeof tc.arguments.old_string === "string" ? tc.arguments.old_string : undefined
      const newString = typeof tc.arguments.new_string === "string" ? tc.arguments.new_string : undefined
      return {
        type: "edit_file",
        state,
        input: { path: editPath },
        diff: oldString !== undefined && newString !== undefined ? { oldString, newString } : undefined,
        fileContent: { path: editPath, content: "" }, // path only, used for caption
        errorText: tc.success === false ? tc.result : undefined,
      }
    }
case "run_tsc": {
      // Output now includes "Exit code: N"
      return {
        type: "run_tsc",
        state,
        input: {},
        output: tc.result !== undefined ? { result: tc.result } : undefined,
        errorText: tc.success === false ? tc.result : undefined,
      }
    }
    case "bash": {
      return {
        type: "bash",
        state,
        input: { command: tc.arguments.command as string },
        output: tc.result !== undefined ? { output: tc.result } : undefined,
        errorText: tc.success === false ? tc.result : undefined,
      }
    }
    default: {
      return {
        type: tc.tool,
        state,
        input: tc.arguments,
        output: tc.result !== undefined ? { result: tc.result } : undefined,
      }
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
  /** Active permission requests for the current streaming session */
  pendingPermissions?: ToolPermissionRecord[]
  /** Called when user resolves a permission request (to update local state) */
  onResolvePermission?: (requestId: number, decision: ToolPermissionDecision, toolName: string) => void
}

export function MessageList({
  messages, isStreaming, thinkingContent,
  onApplyCode, onRegenerate, onDeleteFrom,
  pendingPermissions, onResolvePermission,
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
          {pendingPermissions && pendingPermissions.length > 0 && (
            <div className="flex flex-col gap-2" data-role="permissions">
              {pendingPermissions
                .filter((perm) => perm.pending)
                .map((perm) => (
                  <ToolPermissionCard
                    key={`perm-${perm.requestId}`}
                    requestId={perm.requestId}
                    tool={perm.tool}
                    args={perm.args}
                    onResolve={(decision) => onResolvePermission?.(perm.requestId, decision, perm.tool)}
                  />
                ))}
            </div>
          )}
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
  const hasChunks = !!message.streamChunks?.length
  const hasTools = !!message.toolCalls?.length
  const isEmpty = isStreaming && content === "" && !streamingThinking && !hasChunks && !hasTools

  const hasThinking = isStreaming ? streamingThinking.length > 0 : !!message.thinking
  const thinkingText = isStreaming ? streamingThinking : (message.thinking ?? "")

  const hasCode = content.includes("```")

  // ── User message ──────────────────────────────────────────────────
  if (message.role === "user") {
    const hasImages = !!message.images?.length
    const hasMentions = !!message.mentions?.length
    // Strip injected mention context blocks from display — chips above already show them
    const displayContent = content.replace(/<!-- @[^>]+ -->\n[\s\S]*?<!-- end @[^>]+ -->\n\n?/g, "").trim()
    return (
      <Message className="justify-end group">
        <div className="flex flex-col items-end gap-1 max-w-[85%]">
          {hasImages && (
            <div className="flex gap-1 flex-wrap justify-end">
              {message.images!.map((img, imgIdx) => (
                <img
                  key={imgIdx}
                  src={`data:image/png;base64,${img}`}
                  alt="Attached image"
                  className="max-h-20 max-w-20 rounded object-contain border border-border"
                />
              ))}
            </div>
          )}
          {hasMentions && (
            <div className="flex gap-1.5 flex-wrap justify-end">
              {message.mentions!.map((m) => (
                <MentionCard key={`${m.type}-${m.name}`} mention={m} />
              ))}
            </div>
          )}
          <MessageContent markdown className="text-sm">
            {displayContent}
          </MessageContent>
          <MessageActions className="opacity-0 group-hover:opacity-100 transition-opacity">
            <MessageAction tooltip="Copy message">
              <MsgActionBtn onClick={() => navigator.clipboard.writeText(displayContent)}>
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

  /*
   * Renders stream chunks and their corresponding tool calls in the order
   * they occurred: think[i] → tool[i] → think[i+1] → tool[i+1] → liveThink
   *
   * Each chunk captures what was accumulated between tool boundaries.
   * The live thinking/content (after the last stored chunk) is rendered
   * separately so it updates in real time without waiting for the next
   * tool call to create a stored chunk.
   */
  const renderInterleaved = () => {
    const chunks = message.streamChunks ?? []
    const toolCalls = message.toolCalls ?? []
    const elements: React.ReactNode[] = []

    // Pair each stored chunk with its corresponding tool call
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      // Stored chunks are finalized — never streaming
      if (chunk.thinking) {
        elements.push(
          <Reasoning key={`think-${i}`} isStreaming={false}>
            <ReasoningTrigger className="text-xs text-muted-foreground">Thinking</ReasoningTrigger>
            <ReasoningContent markdown className="text-xs">{chunk.thinking}</ReasoningContent>
          </Reasoning>
        )
      }
      if (chunk.text) {
        elements.push(<MessageContent key={`text-${i}`} markdown className="text-sm">{chunk.text}</MessageContent>)
      }
      // The tool call that followed this chunk
      if (i < toolCalls.length) {
        elements.push(
          <Tool
            key={`tool-${i}`}
            toolPart={toolPartFromRecord(toolCalls[i])}
            defaultOpen={i === toolCalls.length - 1 && isStreaming}
          />
        )
      }
    }

    // If there are more tools than chunks, render remaining tools
    for (let i = chunks.length; i < toolCalls.length; i++) {
      elements.push(
        <Tool
          key={`tool-${i}`}
          toolPart={toolPartFromRecord(toolCalls[i])}
          defaultOpen={i === toolCalls.length - 1 && isStreaming}
        />
      )
    }

    // Live thinking that arrived after the last stored chunk (or before any tool)
    // This is the "current" segment that is actively streaming
    if (isStreaming && streamingThinking.length > 0) {
      elements.push(
        <Reasoning key="think-live" isStreaming={true}>
          <ReasoningTrigger className="text-xs text-muted-foreground">Thinking</ReasoningTrigger>
          <ReasoningContent markdown className="text-xs">{streamingThinking}</ReasoningContent>
        </Reasoning>
      )
    }

    return elements
  }

  // ── Assistant message ─────────────────────────────────────────────
  return (
    <Message>
      <MessageAvatar src="" alt="AI" fallback="AI" />
      <div className="flex flex-col gap-1 max-w-[85%]">
        {isEmpty ? (
          <Loader variant="typing" size="sm" />
        ) : (
          <>
            {(hasChunks || hasTools) ? renderInterleaved() : (
              <>
                {hasThinking && (
                  <>
                    <Reasoning isStreaming={isStreaming}>
                      <ReasoningTrigger className="text-xs text-muted-foreground">Thinking</ReasoningTrigger>
                      <ReasoningContent markdown={!isStreaming} className="text-xs">{thinkingText}</ReasoningContent>
                    </Reasoning>
                    {content && <MessageContent markdown isStreaming={isStreaming} className="text-sm">{content}</MessageContent>}
                  </>
                )}
                {!hasThinking && <MessageContent markdown isStreaming={isStreaming} className="text-sm">{content}</MessageContent>}
              </>
            )}

            {/* Live content after all tools — only when streaming */}
            {(isStreaming && hasTools) && (
              <MessageContent markdown isStreaming className="text-sm">{content}</MessageContent>
            )}

            {/* Generating indicator — streaming with no content yet */}
            {isStreaming && !hasThinking && content === "" && !hasTools && (
              <Loader variant="loading-dots" size="sm" text="Generating" />
            )}
          </>
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
  prev.message.streamChunks === next.message.streamChunks &&
  prev.isStreaming === next.isStreaming &&
  prev.isLastAssistant === next.isLastAssistant &&
  prev.streamingThinking === next.streamingThinking &&
  prev.onApplyCode === next.onApplyCode &&
  prev.onRegenerate === next.onRegenerate &&
  prev.onDeleteFrom === next.onDeleteFrom
)
