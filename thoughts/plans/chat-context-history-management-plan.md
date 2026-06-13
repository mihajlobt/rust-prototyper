# Plan: Chat Context-Window-Aware History Management

## Context

Every panel that embeds an agent chat (Wizard, Screens, Components, Themes, Plans) persists its full message array to `projects/{id}/.../chat.json` via `useChat` (`src/hooks/useChat.ts:199,269,288,310`) and re-sends the **entire** message history to the model on every turn via `buildApiMessages` (`src/hooks/chat/messages.ts:8-71`, called at `useChat.ts:207-211` and `useChat.ts:315-319`).

Two unbounded-growth problems exist today:

1. **No context-window check on the frontend.** `useModelCapabilities(modelId).contextLength` is already computed per model (200000 for Claude — `useModelCapabilities.ts:29`; 128000 for OpenAI — `useModelCapabilities.ts:22`; Ollama-specific via `/api/show` — `useModelCapabilities.ts:42`) and is already used to render a usage bar in `PromptInspector.tsx:67,74,133`, but **nothing trims `apiMessages` before they are sent**. A long-running chat will eventually exceed the model's context window and the request will fail with a provider-side error.

2. **Tool outputs accumulate verbatim in the resend path.** For Ollama, `buildApiMessages` reconstructs `tool` role messages from `m.toolCalls[].result` for every assistant message that has tool calls (`messages.ts:33-44`). `ToolCallRecord.result` (`src/types/chat.ts:1-8`) is populated with the **full, untruncated** tool output — `streamHandler.ts`'s `ToolResult` handler calls `resolveToolCall(entityId, tool, output, ...)` where `output` is `res.output.clone()` (`src-tauri/src/agent/agent_loop.rs:691`), which Rust always sends in full to the frontend regardless of `tool_output_history_limit` (verified: the Rust-side truncation at `agent_loop.rs:696-702` only shortens the **ephemeral in-request `history`**, not the `ToolResult.output` sent over the channel). A single `read_file` call can return up to `MAX_BYTES = 50_000` characters (`src-tauri/src/agent/executor.rs:300`), and a single `bash` capture up to `100_000` characters (`src-tauri/src/commands/process.rs:166`). Every one of these is then re-sent on **every subsequent turn** for Ollama models, and persisted in full to `chat.json` forever.

This plan adds (a) a context-window-aware trimming step applied to `apiMessages` before every request, and (b) a resend-time cap on tool-result content reusing the existing `toolOutputHistoryLimit` setting — without changing what is persisted to disk (so the chat UI still shows full tool output) and without changing the existing Rust-side in-loop truncation (`MAX_TOOL_OUTPUT_FOR_HISTORY`, `agent_loop.rs:20`), which addresses a different problem (bounding a single agent run's internal iteration history).

A third item — `regenerate` (`useChat.ts:292-361`) omitting `writeFileLimit`/`toolOutputHistoryLimit` from its `generateCompletionStream` call (compare `useChat.ts:337-348` to `sendMessage`'s `useChat.ts:229-242`) — is fixed as part of this plan because the new trimming/truncation step in `regenerate` depends on `toolOutputHistoryLimit` being read consistently, and the existing omission is a verified inconsistency directly adjacent to the code this plan touches.

---

## Critical Files

| File | Change |
|------|--------|
| `src/lib/tokens.ts` | **New.** Extracted `countTokens(text, model)` — moved from `PromptInspector.tsx` so it can be reused by the trimming logic. |
| `src/components/PromptInspector.tsx` | Remove local `countTokens`, import from `src/lib/tokens.ts`. |
| `src/hooks/chat/historyTrim.ts` | **New.** `trimMessagesForContext(...)` — drops oldest messages until the estimated token count fits the model's context window. |
| `src/hooks/chat/messages.ts` | `buildApiMessages` gains a `toolOutputHistoryLimit` parameter; truncates `tc.result` when reconstructing Ollama `tool` role messages. |
| `src/hooks/useChat.ts` | `sendMessage` and `regenerate` call `trimMessagesForContext` before `buildApiMessages`, and pass `toolOutputHistoryLimit` into `buildApiMessages`. `regenerate`'s `generateCompletionStream` call gains the missing `writeFileLimit`/`toolOutputHistoryLimit` args. |

---

## Out of scope (explicitly)

- **Non-Ollama (Claude/OpenAI) tool-history-on-reload.** `buildApiMessages`'s non-Ollama branch (`messages.ts:15-24`) sends a flat `{role, content, thinking?, images?}` mapping with no `tool_calls`/`tool_result` blocks — this is a pre-existing, working simplification, not a disk-persistence defect. Adding multi-turn tool context for Claude/OpenAI requires extending `Message` (`lib/ipc.ts:146-155`) with provider-specific tool-result content blocks and corresponding Rust request-building changes in `src-tauri/src/agent/claude.rs`. That is a distinct feature (tool-result context for non-Ollama providers) with its own design questions (e.g., Anthropic `tool_use`/`tool_result` content-block pairing rules) and is out of scope for "saving context/history to disk."
- **Plans' `{slug}.chat.json` path convention** (`src/panels/PlansPanel.tsx:137`) vs. the `{id}/chat.json` convention used by Wizard/Screens/Components/Themes (`WizardPanel.tsx:181`, `ScreensPanel.tsx:103-105`, `ComponentsPanel.tsx:286-288`, `ThemesPanel.tsx:63`). This is an intentional difference — a Plans chat is keyed by the plan's slug, not a stable entity id — and renaming it would be a breaking migration with no benefit to context management. No change.
- **Per-image token accounting.** `m.images` (base64 strings, `ChatMessage.images` — `types/chat.ts:32`) are not included in the token estimate used by `trimMessagesForContext` (see Step 2's limitation note). Vision-capable models bill images at provider-specific fixed token costs unrelated to `js-tiktoken`'s text BPE encoding, and accurately modeling this is a separate effort. Because trimming removes the **oldest** messages first, recently-sent images (the common case) are naturally retained.

---

## Step 1 — Extract `countTokens` into `src/lib/tokens.ts`

**File: `src/lib/tokens.ts` (new)**

Move the existing implementation verbatim from `PromptInspector.tsx:25-37`. `js-tiktoken`'s `encodingForModel` throws for model names it doesn't recognize (e.g., Claude/Ollama model ids) — confirmed via Context7 docs for `/dqbd/tiktoken` (`encodingForModel`/`getEncoding` API, `js/README.md`), which is why the existing code already falls back to the `gpt-4` encoding and finally to a `length / 4` heuristic. This fallback behavior is preserved as-is.

```ts
import { encodingForModel } from "js-tiktoken"

/** Approximate token count for `text` using the encoding for `model`, falling
 *  back to the gpt-4 encoding (and finally a length/4 heuristic) for model ids
 *  js-tiktoken doesn't recognize (Claude, Ollama, etc.). */
export function countTokens(text: string, model: string): number {
  try {
    const enc = encodingForModel(model as Parameters<typeof encodingForModel>[0])
    return enc.encode(text).length
  } catch {
    try {
      const enc = encodingForModel("gpt-4")
      return enc.encode(text).length
    } catch {
      return Math.ceil(text.length / 4)
    }
  }
}
```

**File: `src/components/PromptInspector.tsx`**

- Remove the local `countTokens` function (lines 25-37) and the now-unused `encodingForModel` import (line 2).
- Add `import { countTokens } from "@/lib/tokens"`.
- No other changes — `countTokens(assembled, model)` at line 73 keeps working identically.

---

## Step 2 — Context-window-aware history trimming

**File: `src/hooks/chat/historyTrim.ts` (new)**

Reuses `countTokens` from Step 1. `RESPONSE_RESERVE_TOKENS = 4096` matches the `max_tokens: 4096` value already hardcoded for the Claude request payload shown in `PromptInspector.tsx:86` — i.e., this plan does not invent a new number, it reuses the figure the codebase already treats as "typical max response size" so the reserved budget is consistent with what `PromptInspector` already displays to the user.

`estimateMessageTokens` mirrors what `buildApiMessages` (Step 3) will actually serialize for the given provider, so the trimming decision and the actual payload size stay consistent:
- For all providers: `m.content` + `m.thinking` (both already sent — `messages.ts:18-23` for non-Ollama, `messages.ts:46-67` for Ollama).
- For Ollama only: each `toolCalls[].arguments` (sent via `tool_calls[].function.arguments`, `messages.ts:34-38`) and each `toolCalls[].result` **after** applying the same `toolOutputHistoryLimit` cap that Step 3 applies when building the real payload (`tc.result` is otherwise sent in full as a `tool` role message, `messages.ts:40-43`).

```ts
import type { ChatMessage } from "@/types/chat"
import { countTokens } from "@/lib/tokens"

/** Reserved for the model's response, matching the max_tokens value already
 *  used for Claude requests — see PromptInspector.tsx's hardcoded max_tokens: 4096. */
const RESPONSE_RESERVE_TOKENS = 4096

function estimateMessageTokens(
  message: ChatMessage,
  model: string,
  isOllama: boolean,
  toolOutputHistoryLimit: number,
): number {
  let text = message.content
  if (message.thinking) text += message.thinking
  if (isOllama && message.toolCalls?.length) {
    for (const toolCall of message.toolCalls) {
      text += JSON.stringify(toolCall.arguments)
      if (toolCall.result) {
        text += toolCall.result.length > toolOutputHistoryLimit
          ? toolCall.result.slice(0, toolOutputHistoryLimit)
          : toolCall.result
      }
    }
  }
  return countTokens(text, model)
}

/**
 * Drops the oldest messages from `messages` until the estimated token count
 * (system prompt + remaining messages) fits within `contextLength - RESPONSE_RESERVE_TOKENS`.
 * Always keeps at least the most recent message, even if it alone exceeds the budget.
 */
export function trimMessagesForContext(
  messages: ChatMessage[],
  systemPrompt: string,
  model: string,
  contextLength: number,
  isOllama: boolean,
  toolOutputHistoryLimit: number,
): ChatMessage[] {
  const budget = Math.max(contextLength - RESPONSE_RESERVE_TOKENS, 0)
  let total = countTokens(systemPrompt, model)
  const kept: ChatMessage[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    const tokens = estimateMessageTokens(messages[i], model, isOllama, toolOutputHistoryLimit)
    if (kept.length > 0 && total + tokens > budget) break
    total += tokens
    kept.unshift(messages[i])
  }
  return kept
}
```

---

## Step 3 — Truncate resent tool results in `buildApiMessages`

**File: `src/hooks/chat/messages.ts`**

Add a `toolOutputHistoryLimit: number` parameter. In the Ollama branch's tool-result reconstruction (currently `messages.ts:40-43`), apply the same truncation format already used server-side for the ephemeral history at `agent_loop.rs:696-700` (`"{}\n... (output truncated, {} characters total)"`), so a user inspecting `chat.json` or the Rust-side truncated history sees a consistent message shape:

```ts
export function buildApiMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  isOllama: boolean,
  toolOutputHistoryLimit: number,
): Message[] {
  const system: Message = { role: "system", content: systemPrompt }
  if (!isOllama) {
    return [
      system,
      ...messages.map((m) => ({
        role: m.role,
        content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        ...(m.images?.length ? { images: m.images } : {}),
      })),
    ]
  }
  const result: Message[] = [system]
  for (const m of messages) {
    if (m.role === "assistant" && m.toolCalls?.length) {
      result.push({
        role: "assistant",
        content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        tool_calls: m.toolCalls.map((tc) => ({
          function: { name: tc.tool, arguments: tc.arguments },
        })),
      })
      for (const tc of m.toolCalls) {
        if (tc.result !== undefined) {
          const content = tc.result.length > toolOutputHistoryLimit
            ? `${tc.result.slice(0, toolOutputHistoryLimit)}\n... (output truncated, ${tc.result.length} characters total)`
            : tc.result
          result.push({ role: "tool", content, tool_name: tc.tool })
        }
      }
    } else {
      result.push({
        role: m.role, content: m.content,
        ...(m.thinking ? { thinking: m.thinking } : {}),
        ...(m.images?.length ? { images: m.images } : {}),
      })
    }
  }
  return result
}
```

This does **not** change `stripFences` (unchanged, `messages.ts:1-6`), and does not touch `ToolCallRecord.result` in the Zustand store or `chat.json` — only the payload built for the next request is capped. The chat UI continues to show the full tool output (`streamHandler.ts`'s `resolveToolCall` is unchanged).

---

## Step 4 — Wire trimming + truncation into `sendMessage` and `regenerate`; fix `regenerate`'s missing args

**File: `src/hooks/useChat.ts`**

### 4a — `sendMessage`

Replace the `buildApiMessages` call at `useChat.ts:207-211`:

```ts
const isOllama = (provider as Provider).startsWith("ollama")
const trimmedMessages = trimMessagesForContext(
  updatedMessages.slice(0, -1),
  systemPrompt,
  modelId,
  caps.contextLength ?? 8192,
  isOllama,
  toolOutputHistoryLimit,
)
const apiMessages = buildApiMessages(trimmedMessages, systemPrompt, isOllama, toolOutputHistoryLimit)
```

`caps.contextLength ?? 8192` matches the existing fallback used for the usage bar at `PromptInspector.tsx:67`.

Add the import:
```ts
import { trimMessagesForContext } from "./chat/historyTrim"
```

The `sendMessage` dependency array (`useChat.ts:251-258`) already includes `caps` and `toolOutputHistoryLimit` — no change needed there.

### 4b — `regenerate`

Replace the `buildApiMessages` call at `useChat.ts:315-319`, and add the two missing arguments to `generateCompletionStream` at `useChat.ts:337-348` (currently missing relative to `sendMessage`'s call at `useChat.ts:229-242`):

```ts
const isOllamaRegen = (provider as Provider).startsWith("ollama")
const trimmedMessages = trimMessagesForContext(
  updatedMessages.slice(0, -1),
  systemPrompt,
  modelId,
  caps.contextLength ?? 8192,
  isOllamaRegen,
  toolOutputHistoryLimit,
)
const apiMessages = buildApiMessages(trimmedMessages, systemPrompt, isOllamaRegen, toolOutputHistoryLimit)
```

```ts
const requestId = await generateCompletionStream(
  modelId, apiMessages, resolvedHost, resolvedKey,
  channel, useThinking, effectiveOutputPath,
  provider as Provider,
  isOllamaRegen ? modelOptions : undefined,
  toolPermissionMode,
  toolAllowlist,
  caps.family,
  panelMaxToolCalls ?? maxToolCalls,
  panelToolFilter,
  searxngUrl || undefined,
  writeFileLimit,
  toolOutputHistoryLimit,
)
```

Add `writeFileLimit, toolOutputHistoryLimit` to `regenerate`'s dependency array (`useChat.ts:356-361`), matching `sendMessage`'s (`useChat.ts:251-258`).

---

## Verification

1. `bun run tsc --noEmit` — must be clean after each step (Step 1 changes an import in `PromptInspector.tsx`; Steps 2-4 add a new module and change two function signatures with all call sites updated).
2. `bun run tauri:dev`:
   - Open any panel's chat (e.g., Themes), confirm `PromptInspector` still renders the same token count/usage bar as before Step 1 (no behavior change, only relocated).
   - Start a long conversation (or load a pre-existing large `chat.json`) with an Ollama model that has a small `contextLength` (e.g., a model reporting 8192 via `/api/show`) — confirm `sendMessage` no longer fails with a context-length error from Ollama; oldest messages are silently dropped from the **request** while `chat.json` retains full history.
   - Run an agent task that triggers `read_file` on a large file (>15000 chars, the default `toolOutputHistoryLimit` — `appStore.ts:99`) with an Ollama model, then send a follow-up message — confirm (a) the chat UI still shows the full tool output in the tool-call chip, and (b) `PromptInspector`'s JSON tab for the follow-up request shows the `tool` role message truncated with `"... (output truncated, N characters total)"`.
   - Click "Regenerate" on an assistant response after changing `writeFileLimit`/`toolOutputHistoryLimit` in Settings → Agents — confirm the regenerated request actually uses the updated limits (previously these were silently ignored on regenerate).
3. New file `src/hooks/chat/historyTrim.ts` and `src/lib/tokens.ts` — check `wc -l` stays well under the 500-600 line limit (`coding-standards.md`).
