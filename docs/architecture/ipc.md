---
title: IPC
layout: default
permalink: /architecture/ipc/
description: Tauri invoke and Channel patterns
---

# IPC

Two ways the frontend talks to the Rust backend: `invoke` for one-shot calls, `Channel` for streaming. Both go through `src/lib/ipc.ts` on the frontend side.

## `invoke` — one-shot

`invoke` is a promise that resolves once with the return value. Use it for anything synchronous-ish: file reads, model lists, presets, config saves.

```typescript
import { invoke } from '@tauri-apps/api/core';
import type { ModelPreset } from './types';

export async function loadModelPresets(): Promise<ModelPreset[]> {
  return invoke('load_model_presets');
}
```

Rust side:

```rust
#[tauri::command]
pub async fn load_model_presets() -> Result<Vec<ModelPreset>, String> {
    // ...
}
```

## `Channel` — streaming

`Channel` is the streaming primitive. The frontend creates a `Channel<T>`, hands it to an `invoke`, and the backend pushes typed events into it as work progresses. The frontend's `onmessage` handler dispatches on event type.

```typescript
import { Channel } from '@tauri-apps/api/core';
import type { CompletionEvent } from './types';

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

Rust side:

```rust
#[tauri::command]
pub async fn generate_completion_stream(
    model: String,
    messages: Vec<Message>,
    host: String,
    api_key: String,
    on_event: tauri::Channel<CompletionEvent>,
) -> Result<(), String> {
    // Push events as the model streams
    on_event.send(CompletionEvent::Chunk { text: "...".into() })?;
    // ...
    on_event.send(CompletionEvent::Done)?;
    Ok(())
}
```

The 8 variants of `CompletionEvent` are documented in [AI Streaming]({{ '/architecture/ai-streaming/' | relative_url }}).

## Why Channel, not events

Tauri's `emit` / `listen` (window events) are global and unordered — fine for fire-and-forget UI hints, wrong for ordered streams. `Channel`:

- is tied to a specific `invoke` call's lifecycle
- delivers messages in order
- is type-checked end-to-end (the `Channel<T>` parameter)
- closes when the command returns or errors

## Async commands and `tokio::spawn`

Never block the command thread on heavy work. If your work is long-running (model downloads, scaffolding, large copies), spawn it:

```rust
#[tauri::command]
pub async fn bun_install(path: String) -> Result<(), String> {
    tokio::spawn(async move {
        // long-running work
    });
    Ok(())
}
```

The command returns immediately. The frontend either polls for completion or subscribes to a separate status command. Blocking the command thread is the most common cause of IPC timeouts.

## Plugin permissions

Every plugin-touching command needs its plugin permission declared in `src-tauri/capabilities/default.json`. Without it, the call returns "command not found" at runtime (silent failure — no compile error, no panic).

```json
{
  "permissions": [
    "shell:default",
    "fs:default",
    "http:default",
    "store:default",
    "dialog:default",
    "clipboard:default"
  ]
}
```

## v1 vs v2 imports

Always:

```typescript
import { invoke, Channel } from '@tauri-apps/api/core';
```

Never:

```typescript
import { invoke } from '@tauri-apps/api/tauri'; // v1, breaks on v2
```

## What next

- [AI Streaming]({{ '/architecture/ai-streaming/' | relative_url }}) — the 8-variant event enum
- [Backend]({{ '/architecture/backend/' | relative_url }}) — all 48 commands
- [Chat Stream & Tool Flow]({{ '/architecture/chat-flow/' | relative_url }}) — the full sequence diagram
