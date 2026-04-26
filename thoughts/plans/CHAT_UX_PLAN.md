# Plan: Chat UX — Claude.ai-Parity Improvements

## Context

The Rust backend now uses ollama-rs (stream + tool-calling via `WriteFileTool`). The frontend chat has a solid foundation — streaming, collapsible thinking, markdown, Shiki syntax highlighting — but several Claude.ai-defining interactions are missing or incomplete:

- **Code blocks have no header** — no language label, no copy button
- **Tool calls are invisible** — when the AI writes a file via tool, nothing appears in the chat
- **Streaming markdown breaks on incomplete code fences** — `marked.lexer` on mid-stream content creates rendering glitches inside code blocks
- **No regenerate button** — can't redo the last response
- **No streaming indicator during Coordinator (tool mode)** — tool mode is non-streaming; the UI shows nothing until the tool resolves

This plan addresses all five, in priority order.

---

## Critical Files

| File | Change |
|------|--------|
| `src/components/ui/code-block.tsx` | Add `CodeBlockHeader` with language badge + copy button |
| `src/components/ui/markdown.tsx` | Add streaming-safe mode (single ReactMarkdown pass, skip block-split) |
| `src/types/chat.ts` | Add `toolCalls?: ToolCallRecord[]` to `ChatMessage` |
| `src/stores/chatStore.ts` | Expose method to attach tool calls to the last message |
| `src/hooks/useChat.ts` | Populate `toolCalls` on `FileWritten` event; add `toolPending` state for Coordinator wait |
| `src/components/chat/MessageList.tsx` | Render tool call chips; add regenerate button; pass `isStreaming` to `Markdown` |
| `src/components/ui/message.tsx` | No changes needed |

---

## Step 1 — Code block header (language + copy)

**File: `src/components/ui/code-block.tsx`**

Add a `CodeBlockHeader` sub-component rendered above `CodeBlockCode` inside every fenced block:

```tsx
function CodeBlockHeader({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center justify-between px-4 py-1.5 border-b border-border text-xs text-muted-foreground bg-muted/40">
      <span className="font-mono">{language !== "plaintext" ? language : ""}</span>
      <button
        onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
        className="flex items-center gap-1 hover:text-foreground transition-colors"
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
```

In `markdown.tsx`, update the `code` component to render:
```tsx
<CodeBlock>
  <CodeBlockHeader language={language} code={children as string} />
  <CodeBlockCode code={children as string} language={language} />
</CodeBlock>
```

**Imports to add:** `Copy`, `Check` from `lucide-react`; `useState` from `react`.

---

## Step 2 — Streaming-safe markdown

**File: `src/components/ui/markdown.tsx`**

Add `isStreaming?: boolean` prop to `MarkdownProps` and `MarkdownComponent`.

During streaming, skip `parseMarkdownIntoBlocks` (which uses `marked.lexer` and breaks on unclosed fences) and render as a single `ReactMarkdown` pass instead:

```tsx
function MarkdownComponent({ children, id, className, components = INITIAL_COMPONENTS, isStreaming }: MarkdownProps) {
  const blocks = useMemo(() => isStreaming ? [children] : parseMarkdownIntoBlocks(children), [children, isStreaming])
  // rest unchanged — same map over blocks
}
```

When `isStreaming`, the array is always `[children]` (one block = one `ReactMarkdown` call = no key-based memoization fighting partial state). After streaming completes the component naturally switches to the memoized block approach.

**Update `MessageContent`** in `message.tsx` to accept and forward `isStreaming` down to `Markdown`:
```tsx
type MessageContentProps = { ... isStreaming?: boolean }
// Inside: <Markdown isStreaming={isStreaming} ...>
```

**Update `MessageList.tsx`**: pass `isStreaming` to the `<MessageContent>` that renders the streaming assistant reply.

---

## Step 3 — Tool call chips in messages

### 3a — Type change

**File: `src/types/chat.ts`**

Add to `ChatMessage`:
```ts
toolCalls?: Array<{ tool: string; path: string }>
```

### 3b — Store method

**File: `src/stores/chatStore.ts`**

Add:
```ts
attachToolCall(entityId: string, tool: string, path: string) {
  // Append to toolCalls[] of the last message in chats[entityId]
}
```

### 3c — Hook wiring

**File: `src/hooks/useChat.ts`**

In the `FileWritten` branch, after calling `onOutputRef.current?.(msg.data.content)`, also call:
```ts
useChatStore.getState().attachToolCall(entityId, "write_file", msg.data.path)
```

### 3d — Render chip

**File: `src/components/chat/MessageList.tsx`**

After the `<MessageContent>` block for assistant messages, render tool call chips when present:
```tsx
{message.toolCalls?.map((tc, i) => (
  <div key={i} className="flex items-center gap-1.5 text-xs text-muted-foreground border border-border rounded-md px-2 py-1 w-fit bg-muted/30">
    <FileCode size={12} />
    <span>Wrote <code className="font-mono">{tc.path.split("/").pop()}</code></span>
  </div>
))}
```

Import `FileCode` from `lucide-react`.

---

## Step 4 — Coordinator "thinking" skeleton

**File: `src/hooks/useChat.ts`**

When `outputPath` is set (Coordinator/tool mode), there are no `Chunk` events before `FileWritten`. The UI shows a typing loader but no text accumulates — which is correct — but we need to keep `isStreaming = true` until `Done` fires so the loader stays visible.

No code change needed here — the existing `isStreaming` flag already stays `true` until `Done`. The empty-message path renders `<Loader variant="typing">`, which is the right behaviour. Just verify this works end-to-end when testing.

If it needs enhancement: add a `toolPending` boolean to the streaming message that shows "Calling write_file…" text inside the loader bubble.

---

## Step 5 — Regenerate last response

**File: `src/hooks/useChat.ts`**

Add a `regenerate` function:
```ts
const regenerate = useCallback(async () => {
  const currentChat = useChatStore.getState().chats[entityId] ?? { messages: [], isStreaming: false }
  if (currentChat.isStreaming) return
  // Find last user message (may be >1 message back since last entry is assistant)
  const msgs = currentChat.messages
  const lastUserIdx = [...msgs].reverse().findIndex(m => m.role === "user")
  if (lastUserIdx === -1) return
  const userMsg = msgs[msgs.length - 1 - lastUserIdx]
  // Truncate to just before that user message and re-send
  useChatStore.getState().setMessages(entityId, msgs.slice(0, msgs.length - 1 - lastUserIdx))
  // Re-trigger by setting input and calling sendMessage, or inline the send logic
}, [entityId, ...])
```

Expose `regenerate` from `useChat`. 

**File: `src/components/chat/MessageList.tsx`**

Pass `onRegenerate?: () => void` prop. Render a small "↻ Regenerate" button below the last assistant message when not streaming:

```tsx
{isLastAssistant && !isStreaming && onRegenerate && (
  <button onClick={onRegenerate} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-1">
    <RefreshCw size={12} /> Regenerate
  </button>
)}
```

Update panel `useChat` destructuring to pull `regenerate` and pass as `onRegenerate` to `<MessageList>`.

---

## Verification

1. `bunx tsc --noEmit` — no TypeScript errors
2. `cargo build` in `src-tauri/` — not needed (no Rust changes)
3. Run `bun run tauri:dev`:
   - **Code blocks**: every fenced block shows language label + "Copy" button in a header bar; clicking copies the code
   - **Streaming markdown**: stream a long response with inline code and a code block — no rendering glitches mid-stream; code block renders correctly after Done
   - **Tool chip**: generate a screen with an Ollama model → after completion, a "Wrote screen.tsx" chip appears below the assistant message
   - **Coordinator loader**: in tool mode (outputPath set), a typing loader shows the whole time until the file is written
   - **Regenerate**: "↻ Regenerate" appears under the last assistant message; clicking it strips the last reply and re-runs the last user prompt
