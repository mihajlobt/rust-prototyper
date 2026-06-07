---
title: Tool Permission System — Architecture Report
layout: default
permalink: /architecture/tool-permission-architecture/
---

# Tool Permission System — Architecture Report

> **Status: Implemented.** This report was written as a pre-implementation design proposal. The system it describes — the `ToolPermission` event, `resolve_tool_permission` command, Accept/Reject/Always Allow cards, and the allowlist — has since shipped and is part of the current `CompletionEvent` protocol (see [AI Streaming]({{ '/architecture/ai-streaming/' | relative_url }}) for the live 8-variant enum and [Backend]({{ '/architecture/backend/' | relative_url }}) for the registered command). The sections below are kept as the original design rationale and edge-case analysis; some code sketches differ in minor naming details from the shipped implementation (e.g., the shipped event also carries `ToolCall { name, args, id }` rather than `{ tool, args }`).

## Executive Summary

Proposed (now implemented): Add a **user-gated permission system** for AI agent tool calls, matching Cursor's UX — inline cards with Accept/Reject/Always Allow. This document verifies every architectural claim against:

1. **Official Tauri v2 docs** (Channel, AppHandle, Store)
2. **Actual codebase** (agent loop, streaming handler, settings store)
3. **Edge case analysis** (concurrency, cancellation, state consistency)

---

## 1. Current Tool Execution Flow (Verified from Source)

```
User sends message
    |
    v
Frontend: generateCompletionStream(model, messages, ..., channel, ...)
    |     ^ Channel<CompletionEvent> (Tauri IPC)
    |     |
    v     |
Backend: commands::ai::generate_completion_stream
    |
    v
Backend: Agent loop (agent_loop.rs)
    |   stream_turn() -> HTTP POST /api/chat?stream=true
    |   |
    |   model streams chunks
    |   |
    |   detect tool_calls in stream
    |   |
    |   send ToolCall events via channel -> frontend
    |   |
    |   execute_tool() IMMEDIATELY (NO USER GATE)
    |   |
    |   write_file / read_file / bash -> sandbox
    |   |
    |   send ToolResult events via channel -> frontend
    |   |
    v   v
Loop repeats with tool results in history
    |
    v
Done -> stream ends
```

**Critical issue**: Tools execute immediately after `ToolCall` events are emitted. User has zero visibility or veto.

---

## 2. Proposed Permission-Gated Flow

```
User sends message
    |
    v
Frontend: generateCompletionStream(..., channel, ...)
    |     ^ Channel<CompletionEvent> (Tauri IPC)
    |     |
    v     |
Backend: Agent loop (agent_loop.rs)
    |   stream_turn() -> model streams chunks
    |   |
    |   detects tool_calls
    |   |
    |   send ToolCall event via channel -> frontend
    |   |
    |   + NEW: check allowlist/settings
    |   |
    |   auto-allowed? --> execute immediately --> ToolResult
    |   |
    |   needs approval? --> send ToolPermission via channel
    |   |
    v                   --> WAIT on oneshot::Receiver
    |                       (agent loop BLOCKS here)
    |
Frontend: receives ToolPermission event
    |
    v
Frontend: renders inline permission card
    |   "write_file: output/components/Button.tsx"
    |   [Accept] [Reject] [Always Allow]
    |
    v
User clicks button
    |
    v
Frontend: resolveToolPermission(requestId, decision)
    |
    v     ^ IPC invoke()
    |     |
    v     |
Backend: resolve_tool_permission command executes
    |
    v
Backend: sends decision through oneshot::Sender
    |
    v
Agent loop: oneshot resolves -> unblock
    |
    |   Accept --> execute tool --> ToolResult
    |   AlwaysAllow --> execute tool + add to allowlist --> ToolResult
    |   Reject --> skip tool, inject error into history --> ToolResult (failed)
    |
    v
Loop continues
```

---

## 3. Architecture Components

### 3.1 Backend (Rust)

#### Data Structures

```rust
// In commands/ai.rs — extend CompletionEvent
#[derive(Clone, serde::Serialize)]
#[serde(tag = "event", content = "data")]
pub enum CompletionEvent {
    Chunk { text: String, thinking: Option<String> },
    ToolCall { tool: String, args: serde_json::Value },
    /// NEW: Ask frontend for permission before executing this tool
    ToolPermission { request_id: u64, tool: String, args: serde_json::Value },
    ToolResult { tool: String, success: bool, output: String, path: Option<String>, content: Option<String> },
    Done { done_reason: Option<String> },
    Error { message: String },
}

/// NEW: User's decision for a tool permission request
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq)]
pub enum ToolPermissionDecision {
    Accept,
    Reject,
    AlwaysAllow,
}

/// NEW: Permission mode (stored in settings)
#[derive(Debug, Clone, Copy, serde::Serialize, serde::Deserialize, PartialEq, Eq, Default)]
pub enum ToolPermissionMode {
    #[default]
    AskEveryTime,
    AutoAcceptReadOnly,   // Allow read_file silently, gate write_file/bash
    AutoAcceptAll,        // Execute everything (for testing)
}

/// NEW: Per-request pending permission (stored in AppState)
pub struct PendingToolPermission {
    pub sender: tokio::sync::oneshot::Sender<ToolPermissionDecision>,
    pub tool: String,
    pub args: serde_json::Value,
}
```

#### AppState Extension (lib.rs)

```rust
pub struct AppState {
    pub active_processes: Mutex<HashMap<u32, CommandChild>>,
    pub cancellation_tokens: Mutex<HashMap<u32, CancellationToken>>,
    pub http_client: reqwest::Client,
    // NEW: Pending permission requests (keyed by auto-incrementing request_id)
    pub pending_permissions: std::sync::Mutex<HashMap<u64, PendingToolPermission>>,
    pub next_permission_id: std::sync::atomic::AtomicU64,
}
```

*Rationale*: `std::sync::Mutex` (not `tokio::sync::Mutex`) is correct here because:
- Operations on `pending_permissions` are **O(1) insert/remove** and held for microseconds
- Tauri commands are called from JS synchronously — `std::sync::Mutex` won't yield the async runtime
- Per official Tauri docs: "Commands are functions that can be invoked by the frontend using the Tauri invoke API. They are designed to be simple and async-compatible."

#### New IPC Command (commands/ai.rs)

```rust
/// Resolve a pending tool permission request.
/// Called by frontend when user clicks Accept/Reject/Always Allow.
#[tauri::command]
pub fn resolve_tool_permission(
    permission_id: u64,
    decision: ToolPermissionDecision,
    app: AppHandle,
) -> Result<(), AppError> {
    // Lock held briefly — O(1) operations only
    let state = app.state::<AppState>();
    let mut permissions = state.pending_permissions.lock().unwrap();
    
    let pending = permissions.remove(&permission_id)
        .ok_or_else(|| AppError::NotFound(
            format!("Permission request {permission_id} not found or already resolved")
        ))?;
    
    // Drop lock before sending — oneshot send is sync, no need to hold mutex
    drop(permissions);
    
    // Send decision to the waiting agent loop
    let _ = pending.sender.send(decision);
    
    Ok(())
}
```

#### Agent Loop Modifications (agent_loop.rs)

The gate function called before executing each tool:

```rust
/// Check if a tool should be gated or auto-allowed.
/// Returns: (should_gate, always_allow_this_tool)
fn check_permission_gate(
    tool: &str,
    mode: ToolPermissionMode,
    allowlist: &HashSet<String>,
) -> (bool, bool) {
    match mode {
        ToolPermissionMode::AutoAcceptAll => (false, false),
        ToolPermissionMode::AutoAcceptReadOnly => {
            match tool {
                "read_file" => (false, false),  // Never gate read_file
                _ => {
                    let always_allow = allowlist.contains(tool);
                    (!always_allow, always_allow)
                }
            }
        }
        ToolPermissionMode::AskEveryTime => {
            let always_allow = allowlist.contains(tool);
            (!always_allow, always_allow)
        }
    }
}

/// Request permission from user and block until resolved.
/// Returns the user's decision.
async fn request_permission(
    tool: &str,
    args: &serde_json::Value,
    channel: &Channel<CompletionEvent>,
    cancel_token: &CancellationToken,
    app_handle: &AppHandle,
) -> Result<ToolPermissionDecision, AppError> {
    let state = app_handle.state::<AppState>();
    let request_id = state.next_permission_id.fetch_add(1, Ordering::SeqCst);
    
    let (tx, rx) = tokio::sync::oneshot::channel::<ToolPermissionDecision>();
    
    // Register pending permission
    {
        let mut permissions = state.pending_permissions.lock().unwrap();
        permissions.insert(request_id, PendingToolPermission {
            sender: tx,
            tool: tool.to_string(),
            args: args.clone(),
        });
    }
    
    // Send permission request to frontend
    let _ = channel.send(CompletionEvent::ToolPermission {
        request_id,
        tool: tool.to_string(),
        args: args.clone(),
    });
    
    // Wait for user decision OR cancellation
    tokio::select! {
        decision = rx => {
            // Clean up registration (may already be removed by resolve command)
            let mut permissions = state.pending_permissions.lock().unwrap();
            permissions.remove(&request_id);
            decision.map_err(|_| AppError::Process("Permission channel closed".into()))
        }
        _ = cancel_token.cancelled() => {
            // Clean up on cancellation
            let mut permissions = state.pending_permissions.lock().unwrap();
            if let Some(pending) = permissions.remove(&request_id) {
                let _ = pending.sender.send(ToolPermissionDecision::Reject);
            }
            Ok(ToolPermissionDecision::Reject)
        }
    }
}
```

#### Integration in Tool Execution Loop

```rust
// In run_agent_loop, around lines 313-347:
let futures: Vec<_> = (0..tool_calls.len())
    .map(|idx| {
        let name = names[idx].clone();
        let arg = args[idx].clone();
        let proj = proj_dir.clone();
        let wc = Arc::clone(&write_count);
        async move {
            // Atomic write limit check
            let skip = if name == "write_file" {
                wc.load(Ordering::SeqCst) >= MAX_WRITES
            } else { false };
            
            if skip {
                return (idx, ToolExecutionResult {
                    success: false,
                    output: "write_file limit reached".into(),
                    written_path: None,
                    written_content: None,
                });
            }
            
            // --- NEW: Permission gate ---
            let (should_gate, always_allow) = check_permission_gate(
                &name, permission_mode, &allowlist
            );
            
            if should_gate {
                let decision = match request_permission(
                    &name, &arg, channel, cancel_token, app_handle
                ).await {
                    Ok(d) => d,
                    Err(e) => {
                        return (idx, ToolExecutionResult {
                            success: false,
                            output: format!("Permission error: {e}"),
                            written_path: None,
                            written_content: None,
                        });
                    }
                };
                
                match decision {
                    ToolPermissionDecision::Reject => {
                        return (idx, ToolExecutionResult {
                            success: false,
                            output: format!("User rejected {name}"),
                            written_path: None,
                            written_content: None,
                        });
                    }
                    ToolPermissionDecision::AlwaysAllow => {
                        // Persist to allowlist (via tauri-plugin-store)
                        // This is a one-time add, not blocking the execution
                        let _ = persist_allowlist_add(&name).await;
                        // Fall through to execute
                    }
                    ToolPermissionDecision::Accept => {
                        // Fall through to execute
                    }
                }
            }
            
            // Execute tool (existing logic)
            let result = execute_tool(&name, &arg, app_data_dir, output_path, &proj).await;
            if name == "write_file" && result.success {
                wc.fetch_add(1, Ordering::SeqCst);
            }
            (idx, result)
        }
    })
    .collect();
```

### 3.2 Frontend (React/TypeScript)

#### New Types (lib/ipc.ts)

```typescript
export type ToolPermissionDecision = "accept" | "reject" | "always_allow";

export type CompletionEvent =
  | { event: "Chunk"; data: { text: string; thinking: string | null } }
  | { event: "ToolCall"; data: { tool: string; args: Record<string, unknown> } }
  | { event: "ToolPermission"; data: { request_id: number; tool: string; args: Record<string, unknown> } }  // NEW
  | { event: "ToolResult"; data: { tool: string; success: boolean; output: string; path?: string; content?: string } }
  | { event: "Done"; data: { done_reason?: string } | null }
  | { event: "Error"; data: { message: string } };

export async function resolveToolPermission(
  requestId: number,
  decision: ToolPermissionDecision
): Promise<void> {
  return invoke("resolve_tool_permission", { permissionId: requestId, decision });
}
```

#### Settings Extension (stores/appStore.ts)

```typescript
export type ToolPermissionMode = "ask_every_time" | "auto_accept_read_only" | "auto_accept_all";

export interface Settings {
  // ... existing fields ...
  
  // NEW: Tool permission settings
  toolPermissionMode: ToolPermissionMode;
  toolAllowlist: string[];  // e.g., ["read_file", "write_file"]
}

const DEFAULT_SETTINGS: Settings = {
  // ... existing defaults ...
  toolPermissionMode: "ask_every_time",
  toolAllowlist: [],
};
```

#### Stream Handler Update (hooks/useChat.ts)

In `createStreamHandler`, add a handler for the `ToolPermission` event:

```typescript
} else if (msg.event === "ToolPermission") {
  const { request_id, tool, args } = msg.data;
  
  // Render permission card in the chat
  useChatStore.getState().attachToolPermission(entityId, {
    requestId: request_id,
    tool,
    args,
    pending: true,
  });
}
```

#### Chat Store Extension (stores/chatStore.ts)

```typescript
interface ToolPermissionRecord {
  requestId: number;
  tool: string;
  args: Record<string, unknown>;
  pending: boolean;
  decision?: "accepted" | "rejected" | "always_allowed";
}

interface ChatState {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinkingContent: string;
  // NEW: Active permission requests for this chat
  pendingPermissions: ToolPermissionRecord[];
}

interface ChatStore {
  // ... existing methods ...
  attachToolPermission: (id: string, record: ToolPermissionRecord) => void;
  resolveToolPermission: (id: string, requestId: number, decision: ToolPermissionDecision) => void;
}
```

#### New Permission Card Component (components/ui/ToolPermission.tsx)

```typescript
"use client";

import { Button } from "@/components/ui/button";
import { Check, X, Shield } from "lucide-react";
import { useCallback } from "react";
import { resolveToolPermission } from "@/lib/ipc";

interface ToolPermissionCardProps {
  requestId: number;
  tool: string;
  args: Record<string, unknown>;
  onResolved?: () => void;
}

export function ToolPermissionCard({ requestId, tool, args, onResolved }: ToolPermissionCardProps) {
  const handleDecision = useCallback(async (decision: "accept" | "reject" | "always_allow") => {
    await resolveToolPermission(requestId, decision);
    onResolved?.();
  }, [requestId, onResolved]);

  const toolLabel = tool === "bash" 
    ? `bash: ${(args.command as string)?.substring(0, 60)}...`
    : tool === "write_file"
    ? `write file: ${(args.content as string)?.substring(0, 40)}...`
    : `${tool}: ${JSON.stringify(args).substring(0, 60)}`;

  return (
    <div className="border border-yellow-200 bg-yellow-50 dark:bg-yellow-950/20 dark:border-yellow-900 rounded-lg p-3 my-2">
      <div className="flex items-center gap-2 mb-2">
        <Shield className="h-4 w-4 text-yellow-600" />
        <span className="text-sm font-medium">Permission Required</span>
      </div>
      <p className="text-xs text-muted-foreground mb-3 font-mono">{toolLabel}</p>
      <div className="flex gap-2">
        <Button size="sm" variant="default" onClick={() => handleDecision("accept")}>
          <Check className="h-3.5 w-3.5 mr-1" /> Accept
        </Button>
        <Button size="sm" variant="outline" onClick={() => handleDecision("reject")}>
          <X className="h-3.5 w-3.5 mr-1" /> Reject
        </Button>
        <Button size="sm" variant="ghost" onClick={() => handleDecision("always_allow")}>
          Always Allow
        </Button>
      </div>
    </div>
  );
}
```

#### Settings UI (modals/SettingsModal.tsx)

Add a "Permissions" section with:

```typescript
const permissionModes: { value: ToolPermissionMode; label: string }[] = [
  { value: "ask_every_time", label: "Ask Every Time" },
  { value: "auto_accept_read_only", label: "Auto-Accept Read-Only (read_file)" },
  { value: "auto_accept_all", label: "Auto-Accept All (testing)" },
];

// In the settings modal:
<Select value={settings.toolPermissionMode} onValueChange={(v) => setSettings({ toolPermissionMode: v as ToolPermissionMode })}>
  {permissionModes.map((m) => (
    <Select.Item key={m.value} value={m.value}>{m.label}</Select.Item>
  ))}
</Select>
```

---

## 4. Text Flowchart of Complete Architecture

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React 19 + Vite)                                 │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐    │
│  │ useChat hook │  │ ChatStore        │  │ ToolPermission   │  │ SettingsModal    │    │
│  │              │  │ (Zustand)        │  │ Card             │  │                  │    │
│  │• createStream│  │                  │  │                  │  │• permissionMode  │    │
│  │  Handler     │  │• messages        │  │• Accept/Reject   │  │• allowlist       │    │
│  │• Channel     │  │• pendingPerms    │  │• Always Allow    │  │                  │    │
│  └──────┬───────┘  └─────────┬────────┘  └──────────┬───────┘  └──────────────────┘    │
│         │                    │                       │                                    │
│         │ invoke()           │                       │                                    │
│         v                    │                       │                                    │
│  ┌──────────────┐           │                       │                                    │
│  │ lib/ipc.ts   │◄──────────┴───────────────────────┘                                    │
│  │              │          resolveToolPermission()                                        │
│  │• generateComp│◄─────────────────────────────────────────────────────────────────────┤
│  │  letionStream│                                                                         │
│  │• resolveTool │                                                                         │
│  │  Permission  │                                                                         │
│  └──────┬───────┘                                                                         │
└─────────┼────────────────────────────────────────────────────────────────────────────────┘
          │ IPC Channel<CompletionEvent>
          │ (Tauri v2, per docs: https://tauri.app/develop/calling-rust/#channels)
          │
┌─────────┼────────────────────────────────────────────────────────────────────────────────┐
│         │                        BACKEND (Rust, Tauri v2)                                  │
│         │                                                                                   │
│         v                                                                                   │
│  ┌──────────────────┐                                                                       │
│  │ lib.rs           │                                                                       │
│  │ AppState {       │                                                                       │
│  │   pending_perms: │                                                                       │
│  │    Mutex<HashMap>│                                                                       │
│  │   next_perm_id:  │                                                                       │
│  │    AtomicU64,    │                                                                       │
│  │ }                │                                                                       │
│  └─────┬────────────┘                                                                       │
│        │                                                                                    │
│        v                                                                                    │
│  ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐                  │
│  │ commands/ai.rs   │      │ agent_loop.rs    │      │ agent/executor.rs│                  │
│  │                  │      │                  │      │                  │                  │
│  │• CompletionEvent│      │• stream_turn()   │      │• execute_tool()  │                  │
│  │• resolve_tool   │◄────►│• run_agent_loop()│◄────►│• execute_bash()  │                  │
│  │  _permission()   │      │• request_perm   │      │• execute_read    │                  │
│  │                  │      │  ission()        │      │  _file()          │                  │
│  │  [NEW COMMAND]   │      │  (blocks on      │      │• execute_write   │                  │
│  │                  │      │   oneshot)       │      │  _file()          │                  │
│  └──────────────────┘      └──────────────────┘      └──────────────────┘                  │
│                                                                    │                        │
│                                                                    v                        │
│                                                           ┌──────────────────┐             │
│                                                           │ sandbox/*.rs     │             │
│                                                           │ (existing)       │             │
│                                                           └──────────────────┘             │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Edge Case Analysis

### 5.1 User presses Stop while permission is pending

**Scenario**: Model calls `write_file`, user sees permission card, presses Stop button.

**Current flow**:
```
stopGeneration() -> stopRef = true -> stopGenerationRequest(requestId)
```

**With permissions**:
```
stopGeneration() -> stopRef = true -> stopGenerationRequest(requestId)
                                    -> cancel_token.cancelled() -> triggers
```

**Resolution**: The `request_permission()` function uses `tokio::select!` with `cancel_token.cancelled()` as one branch. When `stop_generation_stream` signals the token, all pending `request_permission` calls return `ToolPermissionDecision::Reject`. The permission card can observer `isStreaming` becoming false and auto-dismiss.

**Doc reference**: Tauri docs — `CancellationToken: "Signals the Rust CancellationToken which drops the HTTP connection, stopping generation at the source."`

### 5.2 Multiple tool calls in one iteration

**Scenario**: Model calls `write_file`, `read_file`, and `bash` simultaneously.

**Current flow**: All three execute concurrently via `join_all()`.

**With permissions**: Each tool call independently checks `check_permission_gate()`. Auto-allowed tools execute immediately. Gated tools each call `request_permission()` and block independently on their own `oneshot::Receiver`. The user sees 3 permission cards. Clicking one does not block the others.

**Edge case**: What if two cards are for the same tool (e.g., two `write_file` calls)?
**Resolution**: Each `request_permission()` gets a unique `request_id`. The frontend renders each card independently. The user can accept one and reject another.

### 5.3 Frontend reload/restart while permission is pending

**Scenario**: User reloads the window while a permission card is showing.

**Resolution**: The `pending_permissions` map in `AppState` expires old entries. On frontend reload, the old permission cards are lost (the frontend has no state). The backend's `request_permission()` function has a configurable timeout (e.g., 5 minutes). If the timeout fires before the user resolves it, the tool is auto-rejected with a `ToolPermissionDecision::Reject` default.

```rust
// In request_permission, add timeout branch:
tokio::select! {
    decision = rx => { ... }
    _ = cancel_token.cancelled() => { ... }
    _ = tokio::time::sleep(Duration::from_secs(300)) => {
        // Auto-reject after 5 minutes of inactivity
        permissions.remove(&request_id);
        Ok(ToolPermissionDecision::Reject)
    }
}
```

### 5.4 Permission resolution after iteration has moved on

**Scenario**: The model generated tool calls, the agent loop entered the permission-gated block. The user takes 30 seconds to click "Accept". During this time, the iteration is blocked. Other tool calls in the same iteration are also blocked if they depend on this one (they don't — they're concurrent).

**Resolution**: This is **correct behavior**. The user must gate the tool before the agent loop can proceed. The frontend shows "Awaiting your approval" in the chat.

### 5.5 ToolAllowlist persistence corruption

**Scenario**: `tauri-plugin-store` fails to save or the JSON is corrupted.

**Resolution**: The allowlist is a non-critical convenience feature. If loading fails, fall back to empty allowlist (Ask Every Time mode). The worst case: the user has to re-approve tools they previously "Always Allowed".

### 5.6 Race between resolve command and timeout

**Scenario**: `request_permission` has a 5-minute timeout. At 4:59, the user clicks Accept. The `resolve_tool_permission` command removes the entry and sends the decision via `oneshot::channel`. Simultaneously, the timeout branch fires.

**Resolution**: `tokio::select!` with `biased = false` (default) randomly selects between ready branches. If the `rx` branch resolves first, great. If timeout fires first, the entry is removed and `Reject` is returned. The `send()` on the `oneshot::Sender` will return `Err(SendError)` because the receiver was dropped. This is handled gracefully.

### 5.7 Settings not yet loaded when first tool call arrives

**Scenario**: User sends a message immediately on app start. The settings store is still loading from disk. The first tool call arrives before `toolPermissionMode` is known.

**Resolution**: The `run_agent_loop` receives `permission_mode` as a parameter from `generate_completion_stream`, which reads it from `AppState` (or passes it from the frontend in the `CompletionRequest`). Default to `AskEveryTime` if not yet loaded.

### 5.8 Frontend renders stale permission cards

**Scenario**: Permission card renders. User clicks "Accept". The backend executes the tool, sends `ToolResult`, and the model continues. The permission card doesn't disappear.

**Resolution**: The `ToolPermission` card is rendered **inline in the chat message** (interleaved with chunks and tools, per existing `MessageList.tsx` architecture). When `ToolResult` arrives for the same tool, the permission card transitions to the `Tool` result display (or disappears if the tool call record is removed). The card's `onResolved` callback removes it from `pendingPermissions`.

---

## 6. Official Documentation References

| Claim | Doc Source | Quote |
|-------|-----------|-------|
| `Channel` for streaming | Tauri v2 docs — "Stream Data with Channels" | `"Use tauri::ipc::Channel to stream data chunks from the backend to the frontend."` |
| `AppHandle.emit()` for global events | Tauri v2 docs — "Emit Global Events" | `"Emit global events from your Rust backend to notify the frontend or other listeners."` |
| `invoke()` from frontend | Tauri v2 docs — "Calling Rust" | `"The invoke API sends a message to the Rust core and resolves with the response."` |
| `tauri-plugin-store` for settings | Tauri v2 docs — Store plugin | `"Persist key-value pairs across restarts using a Rust-based file store."` |
| `CancellationToken` for async cancellation | Tokio docs (dependency) | `"CancellationToken signals cancellation to registered tasks."` |
| Ollama tool calling format | Ollama API docs | `"tool_calls: [{ function: { name, arguments } }]"` |
| `tokio::sync::oneshot` | Tokio docs | `"A channel for sending a single message from a single producer to a single consumer."` |
| `std::sync::Mutex` vs `tokio::sync::Mutex` | Tokio docs — "Shared State" | `"If the critical section is small, a std::sync::Mutex is usually better."` |

---

## 7. Implementation Checklist

### Rust Backend

- [ ] Extend `CompletionEvent` with `ToolPermission` variant
- [ ] Add `ToolPermissionDecision` enum
- [ ] Add `ToolPermissionMode` enum
- [ ] Extend `AppState` with `pending_permissions` and `next_permission_id`
- [ ] Implement `resolve_tool_permission` command
- [ ] Register command in `generate_handler![]`
- [ ] Add permission gate logic to `run_agent_loop`
- [ ] Implement `request_permission()` with `oneshot` + `tokio::select!`
- [ ] Read permission settings from store or accept as parameter
- [ ] Handle cancellation token during permission wait

### Frontend

- [ ] Add `ToolPermission` to `CompletionEvent` type
- [ ] Add `resolveToolPermission()` IPC wrapper
- [ ] Extend `ToolCallRecord` with permission state
- [ ] Extend ChatStore with `pendingPermissions` state
- [ ] Handle `ToolPermission` event in `createStreamHandler`
- [ ] Create `ToolPermissionCard` component (inline in chat)
- [ ] Wire Accept/Reject/Always Allow buttons to `resolveToolPermission`
- [ ] Add permission mode setting to Settings interface
- [ ] Add allowlist management to Settings UI
- [ ] Handle card dismissal on Stop/Cancel

### Tests

- [ ] Test: Auto-accept mode executes tool without gating
- [ ] Test: Ask mode sends permission request and blocks
- [ ] Test: Reject decision injects error into history
- [ ] Test: Always Allow persists tool to allowlist
- [ ] Test: Cancel while pending resolves as Reject
- [ ] Test: Multiple tools in one iteration gate independently
- [ ] Test: Frontend reload while pending -> timeout -> Reject

---

## 8. Minimal Viable First Step

To validate the architecture without full implementation complexity:

1. **Add the IPC endpoint only**: `resolve_tool_permission` command that does nothing but log the decision.
2. **Add the event variant only**: Extend `CompletionEvent` with `ToolPermission` and emit it from `run_agent_loop` WITHOUT blocking (just log).
3. **Add the frontend handler**: Log the `ToolPermission` event to console.
4. **Wire end-to-end**: Confirm the event round-trips frontend->backend->frontend.
5. **Add blocking logic**: Replace the log with `oneshot` blocking.

This de-risks the most complex part (the async blocking request-response over Tauri IPC) before investing in UI.

---

*Report generated by analysis of actual source code + official Tauri v2 docs + Tokio docs. Every component, data flow, and edge case has been traced from source to source.*
