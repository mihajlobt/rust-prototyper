---
title: AI Streaming
layout: default
permalink: /architecture/ai-streaming/
description: The 8-variant CompletionEvent enum and the streaming protocol
---

# AI Streaming

The streaming protocol between the Rust backend and the React frontend. One `Channel<CompletionEvent>`, 8 event variants, two-way resolution for permissions and user questions.

## The pattern

The frontend creates a `Channel<CompletionEvent>`, hands it to `generate_completion_stream`, and the backend pushes typed events into it as the model streams. The frontend's `onmessage` handler dispatches on `event` type.

```typescript
import { Channel } from '@tauri-apps/api/core';
import type { CompletionEvent } from '@/lib/types';

export async function generateCompletionStream(
  model: string,
  messages: Message[],
  host: string,
  apiKey: string,
  onEvent: (event: CompletionEvent) => void,
): Promise<void> {
  const channel = new Channel<CompletionEvent>();
  channel.onmessage = onEvent;
  return invoke('generate_completion_stream', {
    model, messages, host, apiKey, onEvent: channel,
  });
}
```

The Rust side mirrors the same enum. Every event the backend can emit has a frontend dispatch case.

## The 8 event variants

| Event | Payload shape | Frontend action |
|-------|---------------|-----------------|
| `Chunk` | `{ text: string }` | Append to the current assistant message |
| `ToolCall` | `{ name, args, id }` | Show tool call UI, prepare for permission or result |
| `ToolPermission` | `{ name, args, id, reason }` | Render an accept/reject card; resolve via `resolveToolPermission` |
| `ToolResult` | `{ id, result, isError? }` | Show tool result, update message list |
| `AskUser` | `{ id, question, kind, options? }` | Render `AskUserCard` (text / choice / confirm); resolve via `resolveAskUser` |
| `AskUserForm` | `{ id, fields }` | Render `AskUserFormCard` (multi-field form); resolve via `resolveAskUserForm` |
| `Done` | `{}` | Set loading false, finalize the message |
| `Error` | `{ message }` | Show error, set loading false |

The Rust enum definition lives in `src-tauri/src/commands/ai.rs` and is serialized over the channel as `{ event, data }`.

## Example: full handler

```typescript
const channel = new Channel<CompletionEvent>();
channel.onmessage = (msg) => {
  switch (msg.event) {
    case 'Chunk':         append(msg.data.text); break;
    case 'ToolCall':      handleToolCall(msg.data); break;
    case 'ToolPermission': requestApproval(msg.data); break;
    case 'ToolResult':    showToolResult(msg.data); break;
    case 'AskUser':       promptUser(msg.data); break;
    case 'AskUserForm':  promptForm(msg.data); break;
    case 'Done':          setLoading(false); break;
    case 'Error':         setError(msg.data.message); break;
  }
};
await generateCompletionStream(model, messages, host, apiKey, channel);
```

## `ask_user` and `ask_user_form` semantics

Both events pause the backend's agent loop. The model called a tool (`ask_user` or `ask_user_form`) and is awaiting a response. The frontend has **180 seconds** to call the corresponding resolver before the backend unblocks with an empty answer.

| Event | Resolver | Question kind | Card component |
|-------|----------|---------------|----------------|
| `AskUser` | `resolveAskUser(id, answer)` | text / choice / confirm | `AskUserCard` |
| `AskUserForm` | `resolveAskUserForm(id, values)` | structured multi-field | `AskUserFormCard` |

Both are **section-agnostic** — any panel can register an `onAskUser` or `onAskUserForm` callback via `useChat`. If no handler is registered, the backend is immediately unblocked with an empty response.

The Wizard panel registers both. Simpler panels (Screens, Components, etc.) do not.

## Why this protocol

- **Order-preserved** — events arrive in the order the model emits them.
- **Type-checked** — the `Channel<T>` parameter is checked at the IPC boundary.
- **Two-way** — the backend can pause, the frontend can resolve.
- **Scoped** — the channel is tied to one `invoke` call. No global event pollution.

## What next

- [IPC]({{ '/architecture/ipc/' | relative_url }}) — `invoke` and `Channel` in detail
- [Chat Stream & Tool Flow]({{ '/architecture/chat-flow/' | relative_url }}) — Mermaid sequence diagram
- [Tool Permission System (proposal)]({{ '/plans/tool-permission-architecture/' | relative_url }}) — the `ToolPermission` event design rationale
