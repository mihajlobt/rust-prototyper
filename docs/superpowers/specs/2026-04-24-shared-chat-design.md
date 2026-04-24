# Shared Chat Component Design

**Date:** 2026-04-24  
**Status:** Approved

## Context

All three generation panels (Screens, Components, Themes) have their own ad-hoc chat implementations. ComponentsPanel and ScreensPanel have full multi-turn streaming chat; ThemesPanel has only a one-shot prompt textarea. None support thinking blocks, vision (images), or cross-asset context injection.

This spec defines a shared chat system that:
- Unifies the chat UX across all three panels
- Upgrades ThemesPanel to full multi-turn persistent chat
- Adds `<think>...</think>` block parsing with collapsible reasoning UI (for Ollama thinking models like DeepSeek-R1, Qwen3)
- Adds full vision API support (base64 image messages to Ollama)
- Adds `@mention` picker and drag-drop for referencing project assets (components, themes, screens) as context

---

## Architecture

### Store: `src/stores/chatStore.ts`

New Zustand store (in-memory only; disk persistence still goes to `chat.json` files):

```ts
interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
}

interface ChatStore {
  chats: Record<string, ChatState>   // keyed by entity ID (e.g. "comp-abc", "theme-main")
  getChat: (id: string) => ChatState
  setMessages: (id: string, messages: ChatMessage[]) => void
  setStreaming: (id: string, streaming: boolean) => void
  appendChunk: (id: string, chunk: string) => void  // updates last assistant message in-place
  clearChat: (id: string) => void
}
```

`appendChunk` mutates the last message's `content` string directly — avoids full array replacement on every stream chunk, preventing re-renders of earlier messages.

---

### Data Model

```ts
// src/types/chat.ts  (new file)

export interface ChatMessage {
  role: "user" | "assistant"
  content: string          // raw text — sent to API, persisted to chat.json
  images?: string[]        // base64-encoded strings for vision messages
  blocks?: MessageBlock[]  // derived at display time; NOT persisted
}

export type MessageBlock =
  | { type: "thinking"; content: string; collapsed: boolean }
  | { type: "text"; content: string }

export interface MentionAsset {
  id: string
  type: "component" | "theme" | "screen"
  name: string
  path: string
  code: string             // resolved content injected into message context on send
}
```

`blocks` is parsed from `content` each time a message is rendered — `<think>...</think>` → thinking block, everything else → text block. Not stored to disk.

On send, mention assets are serialized as hidden context fences prepended to the user's visible text:

```
<!-- @ComponentName -->
```tsx
// component code here
```
<!-- end @ComponentName -->

User's actual message here
```

The API sees the full context; the UI shows only chips + the user's typed text.

---

### Hook: `src/hooks/useChat.ts`

```ts
interface UseChatOptions {
  entityId: string           // key into chatStore
  chatPath: string           // path to chat.json for cold-start load + persistence
  systemPrompt: string       // injected as first system message on every send
  onOutput?: (content: string) => void  // called when assistant turn completes
}

interface UseChatReturn {
  messages: ChatMessage[]
  input: string
  setInput: (v: string) => void
  isStreaming: boolean
  sendMessage: () => Promise<void>
  clearChat: () => void
  // attachments
  attachments: AttachmentFile[]
  addAttachment: (file: File) => Promise<void>
  removeAttachment: (index: number) => void
  // mentions
  mentions: MentionAsset[]
  addMention: (asset: MentionAsset) => void
  removeMention: (id: string) => void
}
```

**Cold start:** On mount, if `chatStore.chats[entityId]` has no messages, load from `chatPath` via `readFile`. Populates the store. Subsequent mounts (e.g. switching panels and back) skip the file read.

**Send flow:**
1. Build user `ChatMessage`: `content = serializeMentions(mentions) + input`, `images = attachments.map(a => a.base64)`
2. Append to store via `setMessages`
3. Clear `input`, `attachments`, `mentions`
4. Append empty assistant message placeholder
5. Open `Channel<CompletionEvent>`, call `generateCompletionStream(model, fullMessages, host, apiKey, channel)`
6. `Chunk` events → `appendChunk(entityId, text)`
7. `Done` → `setStreaming(false)`, call `onOutput(finalContent)`, persist to `chatPath`

**Thinking parsing** happens in `appendChunk`: tracks an `inThink` boolean, routes characters to the thinking buffer or text buffer. The final `content` stored is the raw stream (with `<think>` tags); `blocks` are derived on render.

---

### Presentational Components: `src/components/chat/`

| File | Responsibility |
|------|----------------|
| `MessageList.tsx` | Renders message array; parses `blocks` from each message's `content`; owns auto-scroll ref |
| `ThinkingBlock.tsx` | Collapsible `<think>` section; collapsed by default; "Reasoning..." toggle header |
| `ChatInput.tsx` | Textarea + send; detects `@` → opens `MentionPicker`; handles paste/drop for images; renders `MentionChip` + `AttachmentChip` above input |
| `MentionPicker.tsx` | Floating dropdown anchored at cursor; loads components/themes/screens from project filesystem; fuzzy-filters on text after `@`; keyboard-navigable (↑↓ Enter Esc) |
| `AttachmentChip.tsx` | Image thumbnail + filename + remove × |
| `MentionChip.tsx` | Colored chip: asset type icon (component/theme/screen) + name + remove × |
| `index.ts` | Re-exports all six |

---

### Backend: Vision Support

**`src/lib/ipc.ts`** — extend `Message`:
```ts
export interface Message {
  role: string
  content: string
  images?: string[]   // ← new
}
```

**`src-tauri/src/lib.rs`** — extend `Message` struct and `chat_completion_ollama`:
```rust
#[derive(Serialize, Deserialize)]
struct Message {
    role: String,
    content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    images: Option<Vec<String>>,
}
```
Ollama accepts `images` as a top-level field on each message object. No other provider changes needed (Ollama-only scope).

---

## Panel Changes

### ThemesPanel (`src/panels/ThemesPanel.tsx`)
- Replace `prompt` string state + `isGenerating` with `useChat({ entityId: themeId, chatPath, systemPrompt, onOutput: applyCss })`
- `<MessageList>` + `<ChatInput>` slot into the existing prompt input area
- **Layout unchanged** — CSS editor and preview pane positions stay exactly as-is
- Chat persisted to `themes/{themeId}/chat.json`
- System prompt: existing `getThemeSystemPrompt(framework)` + settings override

### ComponentsPanel (`src/panels/ComponentsPanel.tsx`)
- Replace inline chat state with `useChat({ entityId: componentId, chatPath, systemPrompt, onOutput: applyCode })`
- Replace inline `<MessageList>`-equivalent UI with shared `<MessageList>` + `<ChatInput>`
- Existing split-pane layout preserved

### ScreensPanel (`src/panels/ScreensPanel.tsx`)
- Same migration: replace inline chat state with `useChat`
- Existing image attachment code removed (handled by `useChat` + `addAttachment`)
- Existing layout preserved

---

## Drag-Drop from Project Explorer

**`src/panels/RunnerPanel.tsx`** — file tree items:
- Add `draggable` + `onDragStart` to individual file items
- `dragstart` sets `dataTransfer` payload: `{ filePath, assetType }` (derived from file extension: `.tsx` → component, `.css` → theme)

**`<ChatInput>`** — drop zone:
- `onDragOver` + `onDrop` handlers
- `.tsx` / `.css` drops: read file content via `readFile(path)`, resolve as `MentionAsset`, call `addMention()`
- Image extension drops (`.png`, `.jpg`, `.webp`, etc.): read as base64, call `addAttachment()`
- Visual drop highlight on `dragover`

---

## Files Created / Modified

**New:**
- `src/types/chat.ts`
- `src/stores/chatStore.ts`
- `src/hooks/useChat.ts`
- `src/components/chat/MessageList.tsx`
- `src/components/chat/ThinkingBlock.tsx`
- `src/components/chat/ChatInput.tsx`
- `src/components/chat/MentionPicker.tsx`
- `src/components/chat/AttachmentChip.tsx`
- `src/components/chat/MentionChip.tsx`
- `src/components/chat/index.ts`

**Modified:**
- `src/panels/ThemesPanel.tsx`
- `src/panels/ComponentsPanel.tsx`
- `src/panels/ScreensPanel.tsx`
- `src/panels/RunnerPanel.tsx` (drag-drop on file items)
- `src/lib/ipc.ts` (Message type)
- `src-tauri/src/lib.rs` (Message struct + Ollama vision)

---

## Verification

1. **ThemesPanel chat:** Open a theme → type a prompt → response streams in, CSS updates in editor + preview. Switch away and back — messages still present (store). Reload app — messages reload from `chat.json`.
2. **Thinking blocks:** Select a thinking model (DeepSeek-R1, Qwen3) → send message → "Reasoning..." section appears collapsed above response text. Click to expand/collapse.
3. **Vision:** Paste or drop an image into chat input → thumbnail chip appears → send → Ollama vision model receives base64 image.
4. **@mention:** Type `@` → dropdown shows project components/themes/screens → select one → chip appears → send → model receives the asset's code as context.
5. **Drag-drop:** Drag a `.tsx` file from the Project Explorer → drop into chat input → mention chip appears with component name.
6. **No regressions:** ComponentsPanel and ScreensPanel chat still works; ThemesPanel layout unchanged; `bunx tsc --noEmit` passes.
