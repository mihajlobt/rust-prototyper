---
title: Shared Chat System — Implementation Plan
layout: default
---

# Shared Chat System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ad-hoc chat code across ThemesPanel, ComponentsPanel, and ScreensPanel with a shared `useChat()` hook + thin presentational components, adding thinking block parsing, full vision (image) support, `@mention` picker, and drag-drop from the Project Explorer.

**Architecture:** Zustand `chatStore` holds per-entity chat state in-memory; `useChat()` hook wraps it with streaming, persistence, attachment, and mention logic; six thin presentational components handle rendering. ThemesPanel is upgraded from one-shot to full multi-turn chat; ComponentsPanel and ScreensPanel migrate their inline chat to the shared hook.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri v2 Channel IPC, Rust/reqwest (Ollama vision), shadcn/ui + Tailwind v4

---

## File Map

**New files:**
- `src/types/chat.ts` — ChatMessage, MessageBlock, MentionAsset, AttachmentFile types
- `src/lib/chat-utils.ts` — `parseBlocks()` utility (parses `<think>` tags)
- `src/stores/chatStore.ts` — Zustand store for in-memory chat state
- `src/components/chat/ThinkingBlock.tsx`
- `src/components/chat/AttachmentChip.tsx`
- `src/components/chat/MentionChip.tsx`
- `src/components/chat/MentionPicker.tsx`
- `src/components/chat/MessageList.tsx`
- `src/components/chat/ChatInput.tsx`
- `src/components/chat/index.ts`
- `src/hooks/useChat.ts`

**Modified files:**
- `src/lib/ipc.ts` — add `images?: string[]` to `Message` interface
- `src-tauri/src/lib.rs` — add `images` field to `Message` struct; pass to Ollama request body
- `src/panels/ThemesPanel.tsx` — migrate to `useChat`, add `<MessageList>` + `<ChatInput>`
- `src/panels/ComponentsPanel.tsx` — migrate inline chat state to `useChat`
- `src/panels/ScreensPanel.tsx` — migrate inline chat state to `useChat`
- `src/panels/RunnerPanel.tsx` — add `draggable` + `onDragStart` to file tree items

---

## Task 1: Types and parse utility

**Files:**
- Create: `src/types/chat.ts`
- Create: `src/lib/chat-utils.ts`

- [ ] **Step 1: Create `src/types/chat.ts`**

```ts
export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  images?: string[]
  blocks?: MessageBlock[]
}

export type MessageBlock =
  | { type: "thinking"; content: string; collapsed: boolean }
  | { type: "text"; content: string }

export interface MentionAsset {
  id: string
  type: "component" | "theme" | "screen"
  name: string
  path: string
  code: string
}

export interface AttachmentFile {
  name: string
  size: number
  mimeType: string
  base64: string
  previewUrl: string
}
```

- [ ] **Step 2: Create `src/lib/chat-utils.ts`**

```ts
import type { MessageBlock } from "@/types/chat"

export function parseBlocks(content: string): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let remaining = content
  while (remaining.length > 0) {
    const thinkStart = remaining.indexOf("<think>")
    if (thinkStart === -1) {
      if (remaining.trim()) blocks.push({ type: "text", content: remaining })
      break
    }
    if (thinkStart > 0) {
      const before = remaining.slice(0, thinkStart)
      if (before.trim()) blocks.push({ type: "text", content: before })
    }
    const thinkEnd = remaining.indexOf("</think>", thinkStart)
    if (thinkEnd === -1) {
      blocks.push({ type: "thinking", content: remaining.slice(thinkStart + 7), collapsed: true })
      break
    }
    blocks.push({ type: "thinking", content: remaining.slice(thinkStart + 7, thinkEnd), collapsed: true })
    remaining = remaining.slice(thinkEnd + 8)
  }
  return blocks
}
```

- [ ] **Step 3: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```
Expected: no errors related to the new files (other pre-existing errors are acceptable).

- [ ] **Step 4: Commit**

```bash
git add src/types/chat.ts src/lib/chat-utils.ts
git commit -m "feat: add chat types and parseBlocks utility"
```

---

## Task 2: Zustand chat store

**Files:**
- Create: `src/stores/chatStore.ts`

- [ ] **Step 1: Create `src/stores/chatStore.ts`**

```ts
import { create } from "zustand"
import type { ChatMessage } from "@/types/chat"

interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
}

interface ChatStore {
  chats: Record<string, ChatState>
  getChat: (id: string) => ChatState
  setMessages: (id: string, messages: ChatMessage[]) => void
  setStreaming: (id: string, streaming: boolean) => void
  appendChunk: (id: string, chunk: string) => void
  clearChat: (id: string) => void
}

const EMPTY: ChatState = { messages: [], isStreaming: false }

export const useChatStore = create<ChatStore>((set, get) => ({
  chats: {},

  getChat: (id) => get().chats[id] ?? EMPTY,

  setMessages: (id, messages) =>
    set((s) => ({
      chats: { ...s.chats, [id]: { ...(s.chats[id] ?? EMPTY), messages } },
    })),

  setStreaming: (id, isStreaming) =>
    set((s) => ({
      chats: { ...s.chats, [id]: { ...(s.chats[id] ?? EMPTY), isStreaming } },
    })),

  // Mutates only the last assistant message — avoids full array replacement on every chunk
  appendChunk: (id, chunk) =>
    set((s) => {
      const chat = s.chats[id] ?? EMPTY
      const messages = [...chat.messages]
      const last = messages[messages.length - 1]
      if (last?.role === "assistant") {
        messages[messages.length - 1] = { ...last, content: last.content + chunk }
      }
      return { chats: { ...s.chats, [id]: { ...chat, messages } } }
    }),

  clearChat: (id) =>
    set((s) => ({ chats: { ...s.chats, [id]: EMPTY } })),
}))
```

- [ ] **Step 2: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/stores/chatStore.ts
git commit -m "feat: add chatStore Zustand slice"
```

---

## Task 3: Rust — vision support in Message + Ollama request

**Files:**
- Modify: `src-tauri/src/lib.rs:391-394` (Message struct)
- Modify: `src-tauri/src/lib.rs:433-436` (Ollama message serialization)

- [ ] **Step 1: Add `images` field to `Message` struct**

Find this in `lib.rs` (around line 390):
```rust
#[derive(serde::Deserialize, Clone)]
struct Message {
    role: String,
    content: String,
}
```
Replace with:
```rust
#[derive(serde::Deserialize, Clone)]
struct Message {
    role: String,
    content: String,
    #[serde(default)]
    images: Vec<String>,
}
```

- [ ] **Step 2: Pass images into Ollama request body**

Find this block inside `chat_completion_ollama` (around line 433):
```rust
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| serde_json::json!({"role": m.role, "content": m.content}))
        .collect();
```
Replace with:
```rust
    let msgs: Vec<serde_json::Value> = messages.iter()
        .map(|m| {
            if m.images.is_empty() {
                serde_json::json!({"role": m.role, "content": m.content})
            } else {
                serde_json::json!({"role": m.role, "content": m.content, "images": m.images})
            }
        })
        .collect();
```

- [ ] **Step 3: Build to verify Rust compiles**

```bash
cd /home/m/Desktop/Prototyper && cargo build --manifest-path src-tauri/Cargo.toml 2>&1 | tail -20
```
Expected: `Compiling prototyper ...` then `Finished`.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat: add vision image support to Ollama Message struct"
```

---

## Task 4: TypeScript IPC — extend Message type

**Files:**
- Modify: `src/lib/ipc.ts:114-116`

- [ ] **Step 1: Add `images` to Message interface**

Find in `src/lib/ipc.ts`:
```ts
export interface Message {
  role: string;
  content: string;
}
```
Replace with:
```ts
export interface Message {
  role: string;
  content: string;
  images?: string[];
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/ipc.ts
git commit -m "feat: add images field to IPC Message type"
```

---

## Task 5: ThinkingBlock, AttachmentChip, MentionChip components

**Files:**
- Create: `src/components/chat/ThinkingBlock.tsx`
- Create: `src/components/chat/AttachmentChip.tsx`
- Create: `src/components/chat/MentionChip.tsx`

- [ ] **Step 1: Create `src/components/chat/ThinkingBlock.tsx`**

```tsx
import { useState } from "react"
import { Brain, ChevronDown, ChevronRight } from "lucide-react"
import type { MessageBlock } from "@/types/chat"

type ThinkingBlockData = Extract<MessageBlock, { type: "thinking" }>

interface ThinkingBlockProps {
  block: ThinkingBlockData
}

export function ThinkingBlock({ block }: ThinkingBlockProps) {
  const [collapsed, setCollapsed] = useState(block.collapsed)

  return (
    <div className="my-1 rounded border border-border/50 bg-muted/30 text-xs">
      <button
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-muted-foreground hover:text-foreground transition-colors"
        onClick={() => setCollapsed(!collapsed)}
      >
        <Brain size={11} />
        <span>Reasoning</span>
        {collapsed
          ? <ChevronRight size={10} className="ml-auto" />
          : <ChevronDown size={10} className="ml-auto" />
        }
      </button>
      {!collapsed && (
        <div className="border-t border-border/50 px-2 py-1.5 text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed">
          {block.content}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `src/components/chat/AttachmentChip.tsx`**

```tsx
import { X } from "lucide-react"
import type { AttachmentFile } from "@/types/chat"

interface AttachmentChipProps {
  file: AttachmentFile
  onRemove: () => void
}

export function AttachmentChip({ file, onRemove }: AttachmentChipProps) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-muted px-1.5 py-0.5 text-xs">
      <img
        src={file.previewUrl}
        alt={file.name}
        className="h-4 w-4 rounded object-cover flex-shrink-0"
      />
      <span className="max-w-[80px] truncate">{file.name}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Remove attachment"
      >
        <X size={10} />
      </button>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/components/chat/MentionChip.tsx`**

```tsx
import { X, Component, Palette, Monitor } from "lucide-react"
import type { MentionAsset } from "@/types/chat"

const TYPE_ICONS = {
  component: <Component size={10} />,
  theme: <Palette size={10} />,
  screen: <Monitor size={10} />,
} as const

interface MentionChipProps {
  asset: MentionAsset
  onRemove: () => void
}

export function MentionChip({ asset, onRemove }: MentionChipProps) {
  return (
    <div className="flex items-center gap-1 rounded border border-border bg-accent/10 px-1.5 py-0.5 text-xs text-foreground">
      {TYPE_ICONS[asset.type]}
      <span>{asset.name}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 text-muted-foreground hover:text-foreground"
        aria-label="Remove mention"
      >
        <X size={10} />
      </button>
    </div>
  )
}
```

- [ ] **Step 4: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/components/chat/ThinkingBlock.tsx src/components/chat/AttachmentChip.tsx src/components/chat/MentionChip.tsx
git commit -m "feat: add ThinkingBlock, AttachmentChip, MentionChip components"
```

---

## Task 6: MentionPicker component

**Files:**
- Create: `src/components/chat/MentionPicker.tsx`

- [ ] **Step 1: Create `src/components/chat/MentionPicker.tsx`**

```tsx
import { useEffect, useRef, useState } from "react"
import { Component, Palette, Monitor } from "lucide-react"
import { readDir } from "@/lib/ipc"
import type { MentionAsset } from "@/types/chat"

const TYPE_ICONS = {
  component: <Component size={11} />,
  theme: <Palette size={11} />,
  screen: <Monitor size={11} />,
} as const

interface MentionPickerProps {
  query: string
  projectPath: string
  onSelect: (asset: Omit<MentionAsset, "code">) => void
  onClose: () => void
}

export function MentionPicker({ query, projectPath, onSelect, onClose }: MentionPickerProps) {
  const [assets, setAssets] = useState<Omit<MentionAsset, "code">[]>([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    loadProjectAssets(projectPath).then(setAssets)
  }, [projectPath])

  const filtered = assets.filter((a) =>
    a.name.toLowerCase().includes(query.toLowerCase())
  )

  useEffect(() => { setActiveIndex(0) }, [query])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowDown") {
        e.preventDefault()
        setActiveIndex((i) => Math.min(i + 1, filtered.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault()
        setActiveIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault()
        const item = filtered[activeIndex]
        if (item) onSelect(item)
      } else if (e.key === "Escape") {
        onClose()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [filtered, activeIndex, onSelect, onClose])

  if (filtered.length === 0) return null

  return (
    <div className="absolute bottom-full mb-1 left-0 z-50 w-64 rounded-md border border-border bg-popover shadow-lg overflow-auto max-h-48">
      {filtered.map((asset, i) => (
        <button
          key={asset.id}
          className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors hover:bg-accent/10 ${
            i === activeIndex ? "bg-accent/10" : ""
          }`}
          onMouseDown={(e) => {
            e.preventDefault() // don't blur textarea
            onSelect(asset)
          }}
        >
          {TYPE_ICONS[asset.type]}
          <span className="flex-1 text-left truncate">{asset.name}</span>
          <span className="text-xs text-muted-foreground">{asset.type}</span>
        </button>
      ))}
    </div>
  )
}

async function loadProjectAssets(projectPath: string): Promise<Omit<MentionAsset, "code">[]> {
  const assets: Omit<MentionAsset, "code">[] = []
  const sections: Array<{ dir: string; type: MentionAsset["type"]; file: string }> = [
    { dir: "components", type: "component", file: "component.tsx" },
    { dir: "themes",     type: "theme",     file: "theme.css" },
    { dir: "screens",    type: "screen",    file: "screen.tsx" },
  ]
  for (const { dir, type, file } of sections) {
    try {
      const entries = await readDir(`${projectPath}/${dir}`)
      for (const entry of entries) {
        if (entry.is_dir) {
          assets.push({
            id: entry.name,
            type,
            name: entry.name,
            path: `${projectPath}/${dir}/${entry.name}/${file}`,
          })
        }
      }
    } catch {
      // directory may not exist yet
    }
  }
  return assets
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MentionPicker.tsx
git commit -m "feat: add MentionPicker component"
```

---

## Task 7: MessageList component

**Files:**
- Create: `src/components/chat/MessageList.tsx`

- [ ] **Step 1: Create `src/components/chat/MessageList.tsx`**

```tsx
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
```

- [ ] **Step 2: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/MessageList.tsx
git commit -m "feat: add MessageList component with thinking block rendering"
```

---

## Task 8: ChatInput component

**Files:**
- Create: `src/components/chat/ChatInput.tsx`

- [ ] **Step 1: Create `src/components/chat/ChatInput.tsx`**

```tsx
import {
  useRef, useState,
  type KeyboardEvent, type DragEvent, type ClipboardEvent, type ChangeEvent,
} from "react"
import { Send, ImageIcon } from "lucide-react"
import { readFile } from "@/lib/ipc"
import { MentionPicker } from "./MentionPicker"
import { AttachmentChip } from "./AttachmentChip"
import { MentionChip } from "./MentionChip"
import type { AttachmentFile, MentionAsset } from "@/types/chat"

interface ChatInputProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled: boolean
  attachments: AttachmentFile[]
  onAddAttachment: (file: AttachmentFile) => void
  onRemoveAttachment: (index: number) => void
  mentions: MentionAsset[]
  onAddMention: (asset: MentionAsset) => void
  onRemoveMention: (id: string) => void
  projectPath: string
  placeholder?: string
}

export function ChatInput({
  value, onChange, onSend, disabled,
  attachments, onAddAttachment, onRemoveAttachment,
  mentions, onAddMention, onRemoveMention,
  projectPath, placeholder = "Ask anything… type @ to reference assets",
}: ChatInputProps) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleChange(text: string) {
    onChange(text)
    const lastAt = text.lastIndexOf("@")
    if (lastAt !== -1) {
      const before = text[lastAt - 1]
      if (lastAt === 0 || before === " " || before === "\n") {
        const afterAt = text.slice(lastAt + 1)
        if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
          setMentionQuery(afterAt)
          return
        }
      }
    }
    setMentionQuery(null)
  }

  function handleMentionSelect(asset: Omit<MentionAsset, "code">) {
    const lastAt = value.lastIndexOf("@")
    onChange(value.slice(0, lastAt))
    setMentionQuery(null)
    readFile(asset.path)
      .then((code) => onAddMention({ ...asset, code }))
      .catch(() => onAddMention({ ...asset, code: "" }))
    textareaRef.current?.focus()
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && mentionQuery === null) {
      e.preventDefault()
      if (!disabled && value.trim()) onSend()
    }
    if (e.key === "Escape") setMentionQuery(null)
  }

  async function processImageFile(file: File) {
    const base64 = await fileToBase64(file)
    const previewUrl = URL.createObjectURL(file)
    onAddAttachment({ name: file.name, size: file.size, mimeType: file.type, base64, previewUrl })
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find((item) => item.type.startsWith("image/"))
    if (imageItem) {
      e.preventDefault()
      const file = imageItem.getAsFile()
      if (file) processImageFile(file)
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)

    // Project file drag from RunnerPanel
    const projectData = e.dataTransfer.getData("application/prototyper-asset")
    if (projectData) {
      try {
        const { filePath, assetType, assetName } = JSON.parse(projectData) as {
          filePath: string
          assetType: MentionAsset["type"]
          assetName: string
        }
        readFile(filePath)
          .then((code) => onAddMention({ id: assetName, type: assetType, name: assetName, path: filePath, code }))
          .catch(() => onAddMention({ id: assetName, type: assetType, name: assetName, path: filePath, code: "" }))
      } catch {}
      return
    }

    // Image file drop
    Array.from(e.dataTransfer.files).forEach((file) => {
      if (file.type.startsWith("image/")) processImageFile(file)
    })
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    Array.from(e.target.files ?? []).forEach(processImageFile)
    e.target.value = ""
  }

  const hasChips = attachments.length > 0 || mentions.length > 0

  return (
    <div className="relative">
      {mentionQuery !== null && (
        <MentionPicker
          query={mentionQuery}
          projectPath={projectPath}
          onSelect={handleMentionSelect}
          onClose={() => setMentionQuery(null)}
        />
      )}
      <div
        className={`rounded-lg border transition-colors ${
          isDragOver ? "border-accent bg-accent/5" : "border-border bg-background"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {hasChips && (
          <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
            {mentions.map((m) => (
              <MentionChip key={m.id} asset={m} onRemove={() => onRemoveMention(m.id)} />
            ))}
            {attachments.map((a, i) => (
              <AttachmentChip key={i} file={a} onRemove={() => onRemoveAttachment(i)} />
            ))}
          </div>
        )}
        <div className="flex items-end gap-1 p-1.5">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={placeholder}
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
            style={{ maxHeight: "120px", overflowY: "auto" }}
          />
          <div className="flex items-center gap-1 flex-shrink-0">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleFileInputChange}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="p-1 text-muted-foreground hover:text-foreground transition-colors"
              title="Attach image"
              type="button"
            >
              <ImageIcon size={14} />
            </button>
            <button
              onClick={onSend}
              disabled={disabled || !value.trim()}
              className="rounded bg-accent px-2 py-1 text-accent-foreground disabled:opacity-40 transition-opacity"
              type="button"
            >
              <Send size={12} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/components/chat/ChatInput.tsx
git commit -m "feat: add ChatInput with @mention, image attach, drag-drop"
```

---

## Task 9: Chat barrel export

**Files:**
- Create: `src/components/chat/index.ts`

- [ ] **Step 1: Create `src/components/chat/index.ts`**

```ts
export { MessageList } from "./MessageList"
export { ThinkingBlock } from "./ThinkingBlock"
export { ChatInput } from "./ChatInput"
export { MentionPicker } from "./MentionPicker"
export { AttachmentChip } from "./AttachmentChip"
export { MentionChip } from "./MentionChip"
```

- [ ] **Step 2: Commit**

```bash
git add src/components/chat/index.ts
git commit -m "feat: add chat components barrel export"
```

---

## Task 10: useChat hook

**Files:**
- Create: `src/hooks/useChat.ts`

- [ ] **Step 1: Create `src/hooks/useChat.ts`**

```ts
import { useEffect, useRef, useState, useCallback } from "react"
import { Channel } from "@tauri-apps/api/core"
import { useChatStore } from "@/stores/chatStore"
import { useAppStore } from "@/stores/appStore"
import {
  generateCompletionStream,
  readFile,
  writeFile,
  getApiKey,
  getModelHost,
  type CompletionEvent,
} from "@/lib/ipc"
import type { ChatMessage, MentionAsset, AttachmentFile } from "@/types/chat"

interface UseChatOptions {
  entityId: string
  chatPath: string
  systemPrompt: string
  onOutput?: (content: string) => void
}

export function useChat({ entityId, chatPath, systemPrompt, onOutput }: UseChatOptions) {
  const store = useChatStore()
  const settings = useAppStore((s) => s.settings)
  const chat = useChatStore((s) => s.chats[entityId] ?? { messages: [], isStreaming: false })

  const [input, setInput] = useState("")
  const [attachments, setAttachments] = useState<AttachmentFile[]>([])
  const [mentions, setMentions] = useState<MentionAsset[]>([])

  // Track which entityIds we've already loaded from disk
  const loadedRef = useRef<Set<string>>(new Set())

  // Cold start: load from disk the first time this entityId is accessed
  useEffect(() => {
    if (loadedRef.current.has(entityId)) return
    loadedRef.current.add(entityId)
    if (chat.messages.length > 0) return
    readFile(chatPath)
      .then((raw) => {
        try {
          const messages = JSON.parse(raw) as ChatMessage[]
          if (Array.isArray(messages) && messages.length > 0) {
            store.setMessages(entityId, messages)
          }
        } catch {}
      })
      .catch(() => {})
  }, [entityId, chatPath])

  const sendMessage = useCallback(async () => {
    const currentChat = useChatStore.getState().chats[entityId] ?? { messages: [], isStreaming: false }
    if (currentChat.isStreaming) return

    const currentInput = input.trim()
    const currentAttachments = attachments
    const currentMentions = mentions

    if (!currentInput && currentAttachments.length === 0) return

    // Build mention context block
    const mentionContext = currentMentions
      .map(
        (m) =>
          `<!-- @${m.name} -->\n\`\`\`${m.type === "theme" ? "css" : "tsx"}\n${m.code}\n\`\`\`\n<!-- end @${m.name} -->`
      )
      .join("\n\n")

    const userContent = mentionContext ? `${mentionContext}\n\n${currentInput}` : currentInput

    const userMessage: ChatMessage = {
      role: "user",
      content: userContent,
      ...(currentAttachments.length > 0 ? { images: currentAttachments.map((a) => a.base64) } : {}),
    }
    const assistantPlaceholder: ChatMessage = { role: "assistant", content: "" }
    const updatedMessages: ChatMessage[] = [...currentChat.messages, userMessage, assistantPlaceholder]

    store.setMessages(entityId, updatedMessages)
    store.setStreaming(entityId, true)
    setInput("")
    setAttachments([])
    setMentions([])

    // Build API messages (system + history without trailing placeholder)
    const apiMessages = [
      { role: "system", content: systemPrompt },
      ...updatedMessages.slice(0, -1).map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.images?.length ? { images: m.images } : {}),
      })),
    ]

    const { modelId, host, ollamaCloudModels, apiKeys } = settings
    const resolvedHost = getModelHost(modelId, host, ollamaCloudModels, apiKeys["ollama"])
    const resolvedKey = getApiKey(modelId, apiKeys)

    const channel = new Channel<CompletionEvent>()
    let accumulated = ""

    channel.onmessage = (msg) => {
      if (msg.event === "Chunk") {
        accumulated += msg.data.text
        useChatStore.getState().appendChunk(entityId, msg.data.text)
      } else if (msg.event === "Done") {
        const finalMessages: ChatMessage[] = [
          ...updatedMessages.slice(0, -1),
          { role: "assistant", content: accumulated },
        ]
        useChatStore.getState().setMessages(entityId, finalMessages)
        useChatStore.getState().setStreaming(entityId, false)
        writeFile(chatPath, JSON.stringify(finalMessages, null, 2)).catch(() => {})
        onOutput?.(accumulated)
      } else if (msg.event === "Error") {
        useChatStore.getState().setMessages(entityId, updatedMessages.slice(0, -1))
        useChatStore.getState().setStreaming(entityId, false)
      }
    }

    try {
      await generateCompletionStream(modelId, apiMessages, resolvedHost, resolvedKey, channel)
    } catch {
      useChatStore.getState().setStreaming(entityId, false)
    }
  }, [input, attachments, mentions, entityId, chatPath, systemPrompt, settings, onOutput])

  const clearChat = useCallback(() => {
    store.clearChat(entityId)
    writeFile(chatPath, "[]").catch(() => {})
  }, [entityId, chatPath])

  const addAttachment = useCallback((file: AttachmentFile) => {
    setAttachments((prev) => [...prev, file])
  }, [])

  const removeAttachment = useCallback((index: number) => {
    setAttachments((prev) => {
      const next = [...prev]
      URL.revokeObjectURL(next[index].previewUrl)
      next.splice(index, 1)
      return next
    })
  }, [])

  const addMention = useCallback((asset: MentionAsset) => {
    setMentions((prev) => (prev.some((m) => m.id === asset.id) ? prev : [...prev, asset]))
  }, [])

  const removeMention = useCallback((id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id))
  }, [])

  return {
    messages: chat.messages,
    isStreaming: chat.isStreaming,
    input,
    setInput,
    sendMessage,
    clearChat,
    attachments,
    addAttachment,
    removeAttachment,
    mentions,
    addMention,
    removeMention,
  }
}
```

- [ ] **Step 2: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useChat.ts
git commit -m "feat: add useChat hook with Zustand store, streaming, vision, mentions"
```

---

## Task 11: ThemesPanel migration

**Files:**
- Modify: `src/panels/ThemesPanel.tsx`

The current ThemesPanel has a one-shot prompt textarea, `isGenerating` state, and a direct `generateCompletionStream` call. Replace that with `useChat`. The CSS editor and preview panes stay in their current positions — only the prompt input area changes.

- [ ] **Step 1: Read the current ThemesPanel to identify the prompt input area**

```bash
grep -n "isGenerating\|prompt\|sendPrompt\|generateCompletion\|textarea\|Textarea" /home/m/Desktop/Prototyper/src/panels/ThemesPanel.tsx | head -40
```

- [ ] **Step 2: Add imports at the top of ThemesPanel.tsx**

Add these imports (after existing imports):
```tsx
import { useChat } from "@/hooks/useChat"
import { MessageList, ChatInput } from "@/components/chat"
```

- [ ] **Step 3: Replace one-shot state with `useChat`**

Remove the existing `prompt`, `isGenerating` state variables and the `sendPrompt`/`handleGenerate` function (or equivalent).

Add below where the component's project path is resolved (near `selectedThemeDir`):
```tsx
const chatPath = selectedThemeDir
  ? `projects/${settings.project}/themes/${selectedThemeDir}/chat.json`
  : "projects/__placeholder__/chat.json"

const {
  messages, isStreaming, input, setInput, sendMessage,
  clearChat, attachments, addAttachment, removeAttachment,
  mentions, addMention, removeMention,
} = useChat({
  entityId: selectedThemeDir ? `theme-${selectedThemeDir}` : "theme-none",
  chatPath,
  systemPrompt: settings.prompts["themes-system"] || getThemeSystemPrompt(framework) +
    (darkLightSupport ? "\n\nGenerate both light and dark mode variants using CSS custom properties and the `prefers-color-scheme` media query or `.dark` class selectors." : ""),
  onOutput: (content) => {
    // Strip markdown fences from CSS response
    const cleaned = content
      .replace(/^```css\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim()
    setCss(cleaned)
  },
})
```

- [ ] **Step 4: Replace the prompt textarea/button section in the JSX**

Find the section that renders the prompt input and generation button (usually a `<textarea>` + `<Button>` or similar). Replace it with:
```tsx
<div className="flex flex-col gap-2 h-48">
  <MessageList messages={messages} isStreaming={isStreaming} />
  <ChatInput
    value={input}
    onChange={setInput}
    onSend={sendMessage}
    disabled={isStreaming}
    attachments={attachments}
    onAddAttachment={addAttachment}
    onRemoveAttachment={removeAttachment}
    mentions={mentions}
    onAddMention={addMention}
    onRemoveMention={removeMention}
    projectPath={`projects/${settings.project}`}
    placeholder="Describe the theme you want…"
  />
</div>
```

Adjust the height class (`h-48`) to fit the existing panel layout without moving the CSS editor or preview panes.

- [ ] **Step 5: Remove unused state and imports**

Remove any unused variables (`prompt`, `isGenerating`, etc.) and imports that were only used for the old one-shot flow.

- [ ] **Step 6: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```
Fix any type errors before continuing.

- [ ] **Step 7: Commit**

```bash
git add src/panels/ThemesPanel.tsx
git commit -m "feat: migrate ThemesPanel to useChat with multi-turn streaming chat"
```

---

## Task 12: ComponentsPanel migration

**Files:**
- Modify: `src/panels/ComponentsPanel.tsx`

ComponentsPanel already has a full chat implementation. Replace its inline chat state with `useChat`.

- [ ] **Step 1: Identify inline chat state to remove**

```bash
grep -n "messages\|isStreaming\|setMessages\|sendMessage\|ChatMessage\|persistChat\|loadChat\|generateCompletionStream\|Channel" /home/m/Desktop/Prototyper/src/panels/ComponentsPanel.tsx | head -50
```

- [ ] **Step 2: Add imports**

```tsx
import { useChat } from "@/hooks/useChat"
import { MessageList, ChatInput } from "@/components/chat"
```

- [ ] **Step 3: Replace inline chat state with `useChat`**

Remove: `messages`, `setMessages`, `isStreaming`, `setIsStreaming`, `persistChat`, chat-loading `useEffect`, `sendMessage` function, and any `Channel` + `generateCompletionStream` calls that belong to the chat flow.

Add:
```tsx
const chatPath = componentId
  ? `projects/${settings.project}/components/${componentId}/chat.json`
  : "projects/__placeholder__/chat.json"

const {
  messages, isStreaming, input, setInput, sendMessage,
  clearChat, attachments, addAttachment, removeAttachment,
  mentions, addMention, removeMention,
} = useChat({
  entityId: componentId ? `component-${componentId}` : "component-none",
  chatPath,
  systemPrompt: settings.prompts["components-system"] || getComponentNewPrompt(settings.iconLibrary) +
    (themeCss ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties:\n\`\`\`css\n${themeCss}\n\`\`\`` : ""),
  onOutput: (content) => {
    const extracted = extractCode(content)
    if (extracted) applyCode(extracted)
  },
})
```

- [ ] **Step 4: Replace message list + input JSX**

Find the existing `<MessageList>`-equivalent rendering and chat input. Replace with:
```tsx
<MessageList messages={messages} isStreaming={isStreaming} />
<ChatInput
  value={input}
  onChange={setInput}
  onSend={sendMessage}
  disabled={isStreaming}
  attachments={attachments}
  onAddAttachment={addAttachment}
  onRemoveAttachment={removeAttachment}
  mentions={mentions}
  onAddMention={addMention}
  onRemoveMention={removeMention}
  projectPath={`projects/${settings.project}`}
/>
```

- [ ] **Step 5: Remove unused imports and state**

Remove all imports that are no longer used (`Channel` from tauri, old `ChatMessage` interface if defined locally, etc.).

- [ ] **Step 6: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/panels/ComponentsPanel.tsx
git commit -m "feat: migrate ComponentsPanel to shared useChat hook"
```

---

## Task 13: ScreensPanel migration

**Files:**
- Modify: `src/panels/ScreensPanel.tsx`

ScreensPanel has chat + image attachment (metadata-only). Remove the old image attachment code — `useChat` handles real vision now.

- [ ] **Step 1: Identify inline chat and attachment state**

```bash
grep -n "messages\|isStreaming\|attachment\|images\|Channel\|generateCompletionStream\|sendMessage" /home/m/Desktop/Prototyper/src/panels/ScreensPanel.tsx | head -50
```

- [ ] **Step 2: Add imports**

```tsx
import { useChat } from "@/hooks/useChat"
import { MessageList, ChatInput } from "@/components/chat"
```

- [ ] **Step 3: Replace inline chat + attachment state with `useChat`**

Remove: inline `messages`, `isStreaming`, `attachments` state; old `sendMessage`, `persistChat`, `Channel`/`generateCompletionStream` calls; metadata-only attachment code.

Add:
```tsx
const chatPath = screenId
  ? `projects/${settings.project}/screens/${screenId}/chat.json`
  : "projects/__placeholder__/chat.json"

const {
  messages, isStreaming, input, setInput, sendMessage,
  clearChat, attachments, addAttachment, removeAttachment,
  mentions, addMention, removeMention,
} = useChat({
  entityId: screenId ? `screen-${screenId}` : "screen-none",
  chatPath,
  systemPrompt: settings.prompts["screens-system"] || getScreenNewPrompt(settings.iconLibrary) +
    (themeCss ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties:\n\`\`\`css\n${themeCss}\n\`\`\`` : ""),
  onOutput: (content) => {
    const extracted = extractCode(content)
    if (extracted) applyCode(extracted)
  },
})
```

- [ ] **Step 4: Replace chat + input JSX**

```tsx
<MessageList messages={messages} isStreaming={isStreaming} />
<ChatInput
  value={input}
  onChange={setInput}
  onSend={sendMessage}
  disabled={isStreaming}
  attachments={attachments}
  onAddAttachment={addAttachment}
  onRemoveAttachment={removeAttachment}
  mentions={mentions}
  onAddMention={addMention}
  onRemoveMention={removeMention}
  projectPath={`projects/${settings.project}`}
/>
```

- [ ] **Step 5: Remove unused state, imports, and old attachment UI**

Remove `modelSupportsVision`, old drag-drop handlers, old attachment chip UI, and any imports only used for those.

- [ ] **Step 6: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add src/panels/ScreensPanel.tsx
git commit -m "feat: migrate ScreensPanel to shared useChat hook with real vision support"
```

---

## Task 14: RunnerPanel drag-drop

**Files:**
- Modify: `src/panels/RunnerPanel.tsx`

Add `draggable` and `onDragStart` to file tree items so they can be dragged into `<ChatInput>`.

- [ ] **Step 1: Find the file tree item render location**

```bash
grep -n "FileEntry\|entry\.name\|onReveal\|contextMenu\|draggable" /home/m/Desktop/Prototyper/src/panels/RunnerPanel.tsx | head -30
```

- [ ] **Step 2: Add drag helper function**

Add this function inside or near the `FileTree` component (before the return):
```tsx
function getAssetType(filePath: string): MentionAsset["type"] | null {
  if (filePath.includes("/components/")) return "component"
  if (filePath.includes("/themes/")) return "theme"
  if (filePath.includes("/screens/")) return "screen"
  return null
}
```

Add the import at top of file:
```tsx
import type { MentionAsset } from "@/types/chat"
```

- [ ] **Step 3: Add `draggable` and `onDragStart` to file items**

Find the JSX element that renders each file entry (the `<div>` or `<button>` with the filename). Add:
```tsx
draggable={getAssetType(entry.path) !== null}
onDragStart={(e) => {
  const assetType = getAssetType(entry.path)
  if (assetType) {
    e.dataTransfer.setData(
      "application/prototyper-asset",
      JSON.stringify({ filePath: entry.path, assetType, assetName: entry.name.replace(/\.(tsx|css)$/, "") })
    )
    e.dataTransfer.effectAllowed = "copy"
  }
}}
```

- [ ] **Step 4: Type-check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add src/panels/RunnerPanel.tsx
git commit -m "feat: add drag-to-chat on project file tree items"
```

---

## Task 15: Final verification

- [ ] **Step 1: Full type check**

```bash
cd /home/m/Desktop/Prototyper && bunx tsc --noEmit
```
Expected: 0 errors.

- [ ] **Step 2: Build the app**

```bash
cd /home/m/Desktop/Prototyper && bun run tauri:dev
```
Smoke-test:
1. Open ThemesPanel → type a theme prompt → response streams in → CSS updates in editor
2. Switch away from Themes and back → chat history still present
3. Open ComponentsPanel → type `@` → dropdown shows project assets → select one → chip appears
4. Paste an image into chat → thumbnail chip appears → send → no errors
5. Drag a `.tsx` file from RunnerPanel into the chat → mention chip appears
6. Use a thinking model (DeepSeek-R1) → "Reasoning" block appears collapsed above response

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "feat: shared chat system — useChat hook, thinking blocks, vision, @mentions, drag-drop"
```
