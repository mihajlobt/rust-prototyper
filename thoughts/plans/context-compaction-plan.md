# Context Compaction Plan (LLM-summary)

## Context

This plan builds on
[`context-optimize-plan.md`](context-optimize-plan.md) (implemented, commit
`9dde866`), which caps resent tool output
(`src/hooks/chat/messages.ts:52-58`), dedupes `@mention` blocks
(`src/hooks/chat/dedupeMentions.ts`), and drops stale `thinking`
(`src/hooks/chat/dropStaleThinking.ts`) — all of which slow payload growth
but never shrink it.

Compaction here mirrors opencode's auto-compact design
(https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction):
when token usage crosses a threshold, the model itself summarizes the old
portion of the conversation into a structured recap, and that recap — not
the raw old messages — is sent on subsequent turns. Two differences from
opencode, both driven by what already exists in this codebase:

- opencode computes `isOverflow` from the provider's own context-limit
  metadata. Prototyper's local-Ollama case has no such metadata for the
  common case (`context-compaction-research.md` §1c) — confirmed empirically
  below: `/api/show` for a model with no Modelfile `PARAMETER num_ctx` (e.g.
  `gemma4:26b`) returns a `parameters` string with no `num_ctx` line at all,
  and neither `/api/show` nor `/api/ps`
  (https://github.com/ollama/ollama/blob/main/docs/api.md) exposes the
  server's effective default (`OLLAMA_CONTEXT_LENGTH`, else 4096,
  https://github.com/ollama/ollama/blob/main/docs/faq.mdx). For that case
  this plan falls back to the model's architecture max
  (`caps.contextLength`) as a best-effort display value, flagged as an
  **upper bound** via a tooltip — Step 1's Modelfile `num_ctx` parsing
  narrows this to an exact figure for models that declare it (e.g.
  `gemma4-26b-128k`).
- opencode prunes tool outputs incrementally and keeps the summary alongside
  full history server-side; Claude Code's auto-compact creates a summary that
  becomes the baseline for the rest of the session while the full transcript
  stays on disk (`~/.claude/projects/**/*.jsonl`, per
  https://github.com/anthropics/claude-code/issues/27242 and
  https://github.com/anthropics/claude-code/issues/26125 — full data
  preserved in `transcript.jsonl`, active context continues from the
  summary). In both cases the summarization cost is paid **once per boundary
  advance**, not once per app session. Prototyper's Design Principle 1
  (below) forbids touching `chat.json` itself, so the same "pay once, reuse
  thereafter" property is achieved with a sibling `*.compaction.json` file
  next to `chatPath` (Step 5) — `chatStore` (Step 5/6) is the in-memory
  read/write-through cache for it, applied only to the outgoing request
  payload.

### Trigger inputs (already exist, verified)

- `ChatMessage.usage` (`src/types/chat.ts:43`, type `TokenUsage` at
  `src/lib/ipc.ts:224-229`) carries real `prompt_tokens`/`completion_tokens`
  from the provider's last response.
- `useModelCapabilities` (`src/hooks/useModelCapabilities.ts`) returns
  `contextLength`; `TokenUsageBadge.tsx:15,21,35` currently divides
  `usage.prompt_tokens + usage.completion_tokens` by `caps.contextLength ??
  8192` for a usage bar. For `ollama-local`, `caps.contextLength` (from
  `model_info."<family>.context_length"`,
  `src-tauri/src/commands/ai_ollama.rs:110-133`) is the model's *trained max*
  (e.g. 262144 for `gemma4:26b`), not the request's actual window — today's
  badge is wrong for any local model without `modelOptions.numCtx` set.

### Empirical finding: Ollama Modelfiles can carry their own `num_ctx`, unread today

Checked with `ollama show <name>` and `curl /api/show -d '{"model":"<name>"}'`
against `http://localhost:11434` (the default in
`DEFAULT_SETTINGS.host`, `src/stores/appStore.ts:85`):

| Model | `model_info."gemma4.context_length"` (architecture max) | `/api/show` `parameters` |
|---|---|---|
| `gemma4:26b` | 262144 | `"temperature 1\ntop_k 64\ntop_p 0.95"` — no `num_ctx` |
| `gemma4-26b-128k:latest` | 262144 | `"num_ctx 131072\ntemperature ..."` |

`gemma4-26b-128k`'s `parameters` field follows Ollama's Modelfile-export
format
(https://github.com/ollama/ollama/blob/main/docs/modelfile.mdx, "Basic
Modelfile Example": `PARAMETER num_ctx 4096`). `parse_show_response`
(`src-tauri/src/commands/ai_ollama.rs:92-135`) does not read this field —
`context_length` is 262144 for both models above, regardless of the
Modelfile's `num_ctx`. `gemma4:26b` has **no `num_ctx` anywhere in
`/api/show`** — its effective context window is whatever the server defaults
to (`OLLAMA_CONTEXT_LENGTH`, else 4096,
https://github.com/ollama/ollama/blob/main/docs/faq.mdx), which is not
queryable. Per
https://github.com/ollama/ollama/blob/main/docs/api.md ("API Reference >
Generate Request"): *"Custom model options can be set at runtime using the
`options` parameter, overriding Modelfile settings."* — confirming priority
`options.num_ctx` (request) > Modelfile `PARAMETER num_ctx` > server default
(unknowable for `gemma4:26b`).

`ModelOptionsPopover.tsx:33` separately shows a `numCtx` field hinting `"def
2048"` — the Modelfile *parameter's own* documented default
(https://github.com/ollama/ollama/blob/main/docs/modelfile.mdx, "Modelfile >
Valid Parameters and Values": *"default of 2048"*), a different number from
the *server's* 4096 fallback. Different mechanisms, not a contradiction.

For `gemma4-26b-128k`, the correct effective window (131072) is knowable
today via `/api/show` — Prototyper just isn't reading it.

---

## Design principles

1. **Never change what's persisted to `chat.json`.** Compaction operates only
   on the copy of `ChatMessage[]` built for the request
   (`updatedMessages.slice(0, -1)`, `src/hooks/useChat.ts:210,322`), exactly
   like `dropStaleThinking`/`dedupeMentions`. The chat UI continues to show
   full, uncompacted history.
2. **One processing pipeline, applied right before every request**, for both
   `sendMessage` and `regenerate`.
3. **New settings get new names.** `compactionThreshold` is independent of
   `modelOptions.numCtx` (`appStore.ts:16`) and `caps.contextLength`
   (`useModelCapabilities.ts:15`).
4. **`KEEP_RECENT_TURNS = 4` is a module constant**, not a setting —
   precedent: `DEFAULT_TOOL_OUTPUT_MAX_BYTES`/`DEFAULT_TOOL_OUTPUT_MAX_LINES`
   (`src-tauri/src/agent/executor.rs:27,29`) are constants, not user
   settings.

---

## Step 1 — Parse Modelfile `num_ctx` from `/api/show`

**File: `src-tauri/src/commands/ai_ollama.rs`**

```rust
/// Extracts `num_ctx` from `/api/show`'s top-level `parameters` field — a
/// newline-separated `PARAMETER <key> <value>` dump (Ollama's Modelfile-export
/// format, docs/modelfile.mdx "Basic Modelfile Example"). `None` if the field
/// is absent or has no `num_ctx` line — callers fall back to
/// `ollamaLocalContextLimit`/`contextLength` (Step 3), so this degrades to
/// today's behavior rather than failing.
fn parse_modelfile_num_ctx(json: &serde_json::Value) -> Option<u64> {
    let parameters = json.get("parameters")?.as_str()?;
    parameters.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        if parts.next()? == "num_ctx" {
            parts.next()?.parse::<u64>().ok()
        } else {
            None
        }
    })
}
```

Add `modelfile_num_ctx: Option<u64>` to both structs:

```rust
// OllamaModelDetails, ai_ollama.rs:50-55
struct OllamaModelDetails {
    capabilities: Vec<String>,
    family: String,
    families: Vec<String>,
    context_length: Option<u64>,
    modelfile_num_ctx: Option<u64>,
}
```

```rust
// OllamaModel, ai_ollama.rs:38-48 (#[serde(rename_all = "camelCase")] already present)
pub struct OllamaModel {
    pub id: String,
    pub name: String,
    pub capabilities: Vec<String>,
    pub family: String,
    pub families: Vec<String>,
    pub context_length: Option<u64>,
    pub modelfile_num_ctx: Option<u64>,
    pub provider: String,
}
```

In `parse_show_response` (`ai_ollama.rs:92-135`), after the existing
`context_length` block (ends `ai_ollama.rs:133`):

```rust
let modelfile_num_ctx = parse_modelfile_num_ctx(json);
OllamaModelDetails { capabilities, family, families, context_length, modelfile_num_ctx }
```

In `list_ollama_models` (`ai_ollama.rs:196-201`), thread the field through
both match arms:

```rust
Ok(results.into_iter().map(|(name, detail_result)| {
    match detail_result {
        Ok(d) => OllamaModel { id: name.clone(), name, capabilities: d.capabilities, family: d.family, families: d.families, context_length: d.context_length, modelfile_num_ctx: d.modelfile_num_ctx, provider: provider.clone() },
        Err(_) => OllamaModel { id: name.clone(), name, capabilities: vec![], family: String::new(), families: vec![], context_length: None, modelfile_num_ctx: None, provider: provider.clone() },
    }
}).collect())
```

`#[serde(rename_all = "camelCase")]` on `OllamaModel` (`ai_ollama.rs:39`)
serializes `modelfile_num_ctx` as `modelfileNumCtx`.

---

## Step 2 — Plumb `modelfileNumCtx` into TypeScript capabilities

**File: `src/lib/ipc.ts`** — add to `OllamaModel` (`ipc.ts:157-166`, alongside
`contextLength?: number` at line 163):

```ts
export interface OllamaModel {
  id: string;
  name: string;
  capabilities: string[];
  family: string;
  families: string[];
  contextLength?: number;
  modelfileNumCtx?: number;
  provider: "ollama-local" | "ollama-cloud";
}
```

**File: `src/hooks/useModelCapabilities.ts`** — add to `Capabilities`
(`:10-19`) and `toCaps` (`:34-46`):

```ts
type Capabilities = {
  thinking: boolean
  thinkLevel?: ThinkLevel
  vision: boolean
  tools: boolean
  contextLength?: number
  modelfileNumCtx?: number
  loading: boolean
  family?: string
}
```

```ts
// inside toCaps's returned object
contextLength: model.contextLength,
modelfileNumCtx: model.modelfileNumCtx,
```

`PROVIDER_CAPS` (`:21-23`), `claudeCaps` (`:26-30`), `EMPTY_CAPS` (`:32`) are
unchanged — `modelfileNumCtx` is `undefined` for `openai`/`claude` (no
Modelfile concept).

---

## Step 3 — `getEffectiveContextWindow` + `TokenUsageBadge` tooltip

**File: `src/stores/appStore.ts`** — add to `Settings` (`:27-74`), after
`toolOutputResendLimit` (`:67-73`):

```ts
/**
 * Fraction of the effective context window (getEffectiveContextWindow,
 * src/hooks/chat/contextWindow.ts) at which old messages are summarized by
 * the model into a recap (src/hooks/chat/compactSummary.ts) before the next
 * request. 0 disables compaction — same "0 = off" convention as `searxngUrl`
 * (appStore.ts:62). Default: 0.7.
 */
compactionThreshold: number;
```

Add to `DEFAULT_SETTINGS` (`:76-108`), after `toolOutputResendLimit: 2000,`:

```ts
compactionThreshold: 0.7,
```

**File: `src/hooks/chat/contextWindow.ts` (new)**

```ts
import type { Provider } from "@/stores/appStore"

export interface ContextWindow {
  /** Token count to use as the denominator for usage display and compaction. */
  value: number
  /**
   * True when `value` is the model's architecture max (`caps.contextLength`),
   * not a figure Ollama has confirmed it will actually use. Only happens for
   * `ollama-local` when neither `modelOptions.numCtx` nor a Modelfile
   * `num_ctx` (`modelfileNumCtx`, Step 1) is set — confirmed empirically for
   * `gemma4:26b`: `/api/show`'s `parameters` field has no `num_ctx` line, and
   * Ollama's actual default (4096, overridable via `OLLAMA_CONTEXT_LENGTH`,
   * https://github.com/ollama/ollama/blob/main/docs/faq.mdx) is not queryable.
   */
  isUpperBound: boolean
}

/**
 * Best-effort context window for the current request — used to render usage
 * (TokenUsageBadge) and to gate compaction (Step 6). Priority:
 *  1. modelOptions.numCtx — explicit per-request override (ai.rs:328), exact
 *  2. modelfileNumCtx     — model's own Modelfile `PARAMETER num_ctx` (Step 1), exact
 *  3. contextLength       — architecture max; exact for ollama-cloud (cloud
 *                            models run at max context,
 *                            https://github.com/ollama/ollama/blob/main/docs/context-length.mdx)
 *                            and for claude/openai (hardcoded in
 *                            useModelCapabilities.ts:22,29); an upper bound
 *                            for ollama-local
 *  4. 8192                — fallback if `contextLength` is also unknown
 *                            (matches TokenUsageBadge's prior `?? 8192`)
 */
export function getEffectiveContextWindow(
  provider: Provider,
  numCtx: number | undefined,
  modelfileNumCtx: number | undefined,
  contextLength: number | undefined,
): ContextWindow {
  if (numCtx) return { value: numCtx, isUpperBound: false }
  if (modelfileNumCtx) return { value: modelfileNumCtx, isUpperBound: false }
  return { value: contextLength ?? 8192, isUpperBound: provider === "ollama-local" }
}
```

**File: `src/components/TokenUsageBadge.tsx`** — replace line 15 and the
returned JSX:

```tsx
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { getEffectiveContextWindow } from "@/hooks/chat/contextWindow"

// replace line 15
const { value: contextWindow, isUpperBound } = getEffectiveContextWindow(
  provider, modelOptions.numCtx, caps.modelfileNumCtx, caps.contextLength,
)
```

`provider` and `modelOptions` come from `useAppStore((s) => s.settings)`
(`appStore.ts:16` for `Provider`, `modelOptions.numCtx` per
`ai.rs:328`/`ModelOptionsPopover.tsx:33`) — add both selectors next to the
existing `caps` line (`TokenUsageBadge.tsx:14`).

Wrap the returned `<span>` (lines 34-36) when `isUpperBound`, following the
local-`TooltipProvider` pattern used in `ChatInput.tsx:180-241`:

```tsx
const usageLabel = (
  <span className="text-[10px] text-muted-foreground tabular-nums">
    {tokenCount} / {contextWindow.toLocaleString()} ({usagePercent}%)
  </span>
)

return (
  <div className="flex items-center gap-2 mr-2">
    <div className="w-[60px] h-1.5 bg-muted rounded-full overflow-hidden">
      {/* ... unchanged bar div, lines 26-32 ... */}
    </div>
    {isUpperBound ? (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>{usageLabel}</TooltipTrigger>
          <TooltipContent side="top">
            {contextWindow.toLocaleString()} is this model's max context. Ollama
            may be using a smaller window (default 4096) — set "Context Size"
            in model options to confirm.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    ) : usageLabel}
  </div>
)
```

This fixes the existing bar for `gemma4-26b-128k` (no tooltip, denominator
131072 via `modelfileNumCtx`) and leaves `gemma4:26b` showing 262144 with the
upper-bound tooltip, instead of silently treating 262144 as exact.

---

## Step 4 — Compaction summary module

**File: `src/hooks/chat/compactSummary.ts` (new)**

> **Assumption:** the summarization call is built as a single `role: "user"`
> message containing both instructions and a flattened transcript, rather
> than reusing `buildApiMessages`'s `{role: "system", ...}` + multi-message
> output. Reason: `generate_completion`'s Claude path
> (`src-tauri/src/commands/ai_providers.rs:96-98`,
> `chat_completion_claude`) forwards every message's `role` verbatim into
> Anthropic's `messages` array, which only accepts `"user"`/`"assistant"`
> (https://docs.anthropic.com/en/api/messages) — a `"system"`-role entry
> would be rejected. A single `"user"` message sidesteps this for all three
> providers (`to_ollama_messages`, `ai.rs:209-222`, maps non-`assistant`/
> `system` roles to `OllamaChatMessage::user`; `chat_completion_openai` and
> `chat_completion_claude` both accept `"user"`).

```ts
import type { ChatMessage } from "@/types/chat"
import { generateCompletion, type Provider } from "@/lib/ipc"

/** How many of the most recent user turns are kept uncompacted. */
export const KEEP_RECENT_TURNS = 4

/** Structured recap categories, mirroring opencode's SUMMARY_TEMPLATE
 *  (https://deepwiki.com/sst/opencode/2.4-context-management-and-compaction):
 *  Goal, Constraints, Progress, Key Decisions, Next Steps, Critical Context. */
const SUMMARY_INSTRUCTIONS = `Summarize the conversation below for a coding assistant that is about to continue it. Be concise but keep anything a future turn would need. Use exactly these headings:

## Goal
What the user is ultimately trying to accomplish.

## Constraints
Explicit requirements, preferences, or limits the user stated.

## Progress
What has been done so far (files read/edited, commands run, decisions implemented).

## Key Decisions
Choices made and why, especially anything non-obvious.

## Next Steps
What remains to be done, including anything explicitly deferred.

## Critical Context
File paths, identifiers, error messages, or other specifics a future turn must not lose.`

/** Flatten messages (and their tool-call results) into plain text for the
 *  summarization prompt. Tool results are capped at `toolOutputResendLimit`
 *  chars, same cap used when resending tool output normally
 *  (src/hooks/chat/messages.ts:52-58). */
function flattenTranscript(messages: ChatMessage[], toolOutputResendLimit: number): string {
  return messages.map((m) => {
    const lines = [`[${m.role.toUpperCase()}]: ${m.content}`]
    for (const tc of m.toolCalls ?? []) {
      if (tc.result === undefined) continue
      const result = tc.result.length > toolOutputResendLimit
        ? `${tc.result.slice(0, toolOutputResendLimit)}\n... (truncated, ${tc.result.length} characters total)`
        : tc.result
      lines.push(`  [TOOL ${tc.tool}${tc.path ? ` ${tc.path}` : ""}]: ${result}`)
    }
    return lines.join("\n")
  }).join("\n\n")
}

/** Summarize `messagesToSummarize` via a non-streaming completion
 *  (generateCompletion, src/lib/ipc.ts:267-275, command
 *  `generate_completion` already in generate_handler!). Returns `null` on
 *  any failure — callers must fall back to sending the uncompacted
 *  messages, never block the main turn on this. */
export async function generateCompactionSummary(
  messagesToSummarize: ChatMessage[],
  modelId: string,
  host: string,
  apiKey: string,
  provider: Provider,
  toolOutputResendLimit: number,
): Promise<string | null> {
  const transcript = flattenTranscript(messagesToSummarize, toolOutputResendLimit)
  const prompt = `${SUMMARY_INSTRUCTIONS}\n\n---\n\n${transcript}`
  try {
    const summary = await generateCompletion(modelId, [{ role: "user", content: prompt }], host, apiKey, provider)
    return summary.trim() || null
  } catch {
    return null
  }
}

/** Replace `messages[0..boundaryIndex)` with one synthetic assistant message
 *  carrying the recap; `messages[boundaryIndex..]` is returned unchanged.
 *  `boundaryIndex` must be a `role === "user"` index — see
 *  findCompactionBoundary below and context-compaction-research.md §2a. */
export function buildCompactedMessages(messages: ChatMessage[], boundaryIndex: number, summary: string): ChatMessage[] {
  const summaryMessage: ChatMessage = {
    role: "assistant",
    content: `## Earlier conversation (compacted)\n\n${summary}`,
  }
  return [summaryMessage, ...messages.slice(boundaryIndex)]
}

/** Index of the `role === "user"` message starting the `keepRecentTurns`-th
 *  most recent user turn from the end. Returns 0 (nothing to compact) if
 *  there aren't more than `keepRecentTurns` user turns. */
export function findCompactionBoundary(messages: ChatMessage[], keepRecentTurns: number): number {
  let userTurnsFromEnd = 0
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      userTurnsFromEnd++
      if (userTurnsFromEnd > keepRecentTurns) return i + 1
    }
  }
  return 0
}
```

---

## Step 5 — Durable compaction cache: sibling `*.compaction.json` + `chatStore`

`chatPath` (`useChat.ts:36`) is always a `.json` path written via
`writeFile`/`readFile` (`useChat.ts:202,317`, `useProjectFiles.ts:79`), in two
shapes seen across panels: `.../chat.json` (`WizardMode.tsx:162`,
`ScreensMode.tsx:93-94`, `ThemesMode.tsx:194`, `ComponentsMode.tsx:223-224`)
and `.../{slug}.chat.json` (`PlansPanel.tsx:137`). Both end in `.json`, so:

```ts
const compactionPath = chatPath.replace(/\.json$/, ".compaction.json")
```

produces `.../chat.compaction.json` and `.../{slug}.chat.compaction.json`
respectively — a sibling file, never written into `chat.json` itself
(Design Principle 1 intact). `read_file`/`write_file`/`delete_file` are
already registered in `generate_handler!` with `fs:default` permission
(used identically for `chatPath`) — no Rust changes needed.

**File: `src/stores/chatStore.ts`** — add to `ChatState` (`:4-11`):

```ts
interface ChatState {
  messages: ChatMessage[]
  isStreaming: boolean
  thinkingContent: string
  pendingPermissions: ToolPermissionRecord[]
  liveTokenCount: number
  /** Cached compaction recap, mirrored to `*.compaction.json` (Step 6).
   *  boundaryIndex is the role==="user" index it was computed for —
   *  recomputed when findCompactionBoundary returns a different index. */
  compaction?: { boundaryIndex: number; summary: string }
}
```

`EMPTY` (`:33`) is unchanged — `compaction` stays `undefined` there, no
change needed beyond the type since the field is optional.

Add a setter alongside `setLiveTokenCount` (`:80-83`) that also accepts
`undefined` (for invalidation in `deleteFrom`, Step 6):

```ts
setCompaction: (id, compaction) =>
  set((s) => ({
    chats: { ...s.chats, [id]: { ...(s.chats[id] ?? EMPTY), compaction } },
  })),
```

Add `setCompaction: (id: string, compaction: { boundaryIndex: number; summary: string } | undefined) => void` to the
`ChatStore` interface (`:13-31`).

`clearChat` (`:118-119`) already resets to `EMPTY`, which clears the
in-memory `compaction` along with everything else. The on-disk
`*.compaction.json` sibling still needs deleting — done in `useChat.ts`'s
`clearChat`/`deleteFrom` (Step 6), which already write to `chatPath` and have
`compactionPath` in scope.

---

## Step 6 — Pipeline wiring in `useChat.ts`

Add a selector after `toolOutputResendLimit` (`useChat.ts:74`):

```ts
const compactionThreshold = useAppStore((s) => s.settings.compactionThreshold)
```

`modelOptions` is already selected (`useChat.ts:73` or equivalent, used by
the existing Ollama request path). Add imports:

```ts
import { getEffectiveContextWindow } from "./chat/contextWindow"
import { generateCompactionSummary, buildCompactedMessages, findCompactionBoundary, KEEP_RECENT_TURNS } from "./chat/compactSummary"
```

`caps` (`useModelCapabilities(modelId)`, `useChat.ts:108`) is already a
dependency of both `sendMessage` (`:260`) and `regenerate` (`:371`)
`useCallback` arrays.

### Cold-start hydration

Compute `compactionPath` once near `chatPath` (Step 5):

```ts
const compactionPath = chatPath.replace(/\.json$/, ".compaction.json")
```

Add a second cold-start effect mirroring the existing messages-load effect
(`useChat.ts:142-162`), reusing the same `loadedRef` gate so it fires once
per `entityId` alongside it:

```ts
useEffect(() => {
  if (loadedRef.current.has(entityId)) return
  let cancelled = false
  readFile(compactionPath)
    .then((raw) => {
      if (cancelled) return
      try {
        const compaction = JSON.parse(raw) as { boundaryIndex: number; summary: string }
        if (typeof compaction.boundaryIndex === "number" && typeof compaction.summary === "string") {
          useChatStore.getState().setCompaction(entityId, compaction)
        }
      } catch { /* ignore corrupt/missing compaction file */ }
    })
    .catch(() => {})
  return () => { cancelled = true }
}, [entityId, compactionPath])
```

`boundaryIndex` validity against the current `messages.length` doesn't need
checking here — the pipeline's `compaction?.boundaryIndex !== boundaryIndex`
check (below) recomputes if `findCompactionBoundary` now returns something
different, and `deleteFrom` (below) proactively invalidates the cache when
messages are truncated past it.

In `sendMessage`, `resolvedHost`/`resolvedKey` are currently computed at
`useChat.ts:220-221`, *after* the pipeline block (`:210-218`). Move that
computation before the pipeline (compaction needs it too), then replace the
pipeline:

```ts
const isOllama = (provider as Provider).startsWith("ollama")
const resolvedHost = getHostForProvider(provider as Provider, host)
const resolvedKey = getApiKeyForProvider(provider as Provider, apiKeys)
const pipelineMessages = updatedMessages.slice(0, -1)

const { value: contextWindow } = getEffectiveContextWindow(
  provider as Provider, modelOptions.numCtx, caps.modelfileNumCtx, caps.contextLength,
)
const lastUsage = [...pipelineMessages].reverse().find((m) => m.role === "assistant" && m.usage)?.usage
const boundaryIndex = compactionThreshold > 0 && lastUsage && lastUsage.prompt_tokens / contextWindow > compactionThreshold
  ? findCompactionBoundary(pipelineMessages, KEEP_RECENT_TURNS)
  : 0

let compaction = useChatStore.getState().chats[entityId]?.compaction
if (boundaryIndex > 0 && compaction?.boundaryIndex !== boundaryIndex) {
  const summary = await generateCompactionSummary(
    pipelineMessages.slice(0, boundaryIndex), modelId, resolvedHost, resolvedKey, provider as Provider, toolOutputResendLimit,
  )
  if (summary !== null) {
    compaction = { boundaryIndex, summary }
    useChatStore.getState().setCompaction(entityId, compaction)
    writeFile(compactionPath, JSON.stringify(compaction)).catch(() => {})
  }
}

const compactedMessages = boundaryIndex > 0 && compaction?.boundaryIndex === boundaryIndex
  ? buildCompactedMessages(pipelineMessages, compaction.boundaryIndex, compaction.summary)
  : pipelineMessages

const noStaleThinking = dropStaleThinking(compactedMessages)
const dedupedMessages = dedupeMentions(noStaleThinking)
const apiMessages = buildApiMessages(dedupedMessages, systemPrompt, isOllama, toolOutputResendLimit)
```

Remove the now-duplicate `resolvedHost`/`resolvedKey` declarations at the old
`useChat.ts:220-221` (they're computed earlier above).

Compaction runs before `dropStaleThinking`/`dedupeMentions` so
`dedupeMentions`'s `seen` map (`src/hooks/chat/dedupeMentions.ts:49`) never
sees a `@mention` block that `buildCompactedMessages` already folded into the
recap — a later, un-compacted occurrence of the same `@mention` is sent in
full rather than stubbed as "(shown earlier)" (research §5, open question 4).

Mirror the identical block in `regenerate` (`useChat.ts:321-329`), using
`updatedMessages.slice(0, -1)` as `pipelineMessages` there too, and its own
existing `resolvedHost`/`resolvedKey` (`useChat.ts:331-332`) moved up the same
way.

Add `compactionThreshold` to both `useCallback` dependency arrays
(`useChat.ts:257-265` and `:368-375`); `caps`, `modelOptions`, and
`toolOutputResendLimit` are already present in both.

### Cache invalidation on `clearChat` / `deleteFrom`

`clearChat` (`useChat.ts:267-270`) resets `chatStore` to `EMPTY` (clears the
in-memory `compaction`) and writes `"[]"` to `chatPath`. Add a sibling
delete:

```ts
const clearChat = useCallback(() => {
  useChatStore.getState().clearChat(entityId)
  writeFile(chatPath, "[]").catch(() => {})
  deleteFile(compactionPath).catch(() => {})
}, [entityId, chatPath, compactionPath])
```

`deleteFrom(index)` (`useChat.ts:272-277`) truncates `messages` to
`trimmed = current.slice(0, index)`. If the cached `compaction.boundaryIndex`
now exceeds `trimmed.length`, the recap covers messages that no longer
exist — invalidate both the in-memory and on-disk cache:

```ts
const deleteFrom = useCallback((index: number) => {
  const current = useChatStore.getState().chats[entityId]?.messages ?? []
  const trimmed = current.slice(0, index)
  useChatStore.getState().setMessages(entityId, trimmed)
  writeFile(chatPath, JSON.stringify(trimmed, null, 2)).catch(() => {})
  const compaction = useChatStore.getState().chats[entityId]?.compaction
  if (compaction && compaction.boundaryIndex > trimmed.length) {
    useChatStore.getState().setCompaction(entityId, undefined)
    deleteFile(compactionPath).catch(() => {})
  }
}, [entityId, chatPath, compactionPath])
```

`deleteFile` is already imported from `@/lib/ipc` for other panels
(`ipc.ts:89-91`) — add it to `useChat.ts`'s existing `@/lib/ipc` import.

---

## Step 7 — Settings UI

**File: `src/modals/settings/AgentsTab.tsx`**

Add one row to the "Safety Limits" `CollapsibleContent`
(`AgentsTab.tsx:227-279`), after the `toolOutputResendLimit` block (ends line
275), same `Input type="number"` pattern as lines 260-275:

```tsx
<div className="flex items-center gap-3">
  <span className="text-xs text-muted-foreground w-40 shrink-0">compactionThreshold</span>
  <Input
    type="number"
    min={0}
    max={1}
    step={0.05}
    className="w-24 text-xs"
    value={settings.compactionThreshold}
    onChange={(e) => {
      const n = parseFloat(e.target.value);
      if (!isNaN(n) && n >= 0 && n <= 1) setSettings({ compactionThreshold: n });
    }}
  />
  <span className="text-xs text-muted-foreground">% of context window that triggers an LLM summary of old messages (0 = off)</span>
</div>
```

`Settings` here is the type from `@/hooks/useSettings` (`AgentsTab.tsx:13`),
which already re-exports `appStore.ts`'s `Settings` — no further change
needed for the new fields to type-check.

---

## Verification

1. `bun run tsc --noEmit` clean; `cargo build` (from `src-tauri/`) clean for
   the `ai_ollama.rs` changes.
2. **`getEffectiveContextWindow` / `TokenUsageBadge`**, against
   `http://localhost:11434`:
   - `gemma4:26b` (no Modelfile `num_ctx`, `modelOptions.numCtx` unset):
     badge shows the percentage against **262144** (`contextLength`) with the
     upper-bound tooltip ("Ollama may be using a smaller window...") visible
     on hover.
   - `gemma4-26b-128k:latest` (Modelfile `num_ctx 131072`): confirm
     `list_ollama_models` returns `modelfileNumCtx: 131072`, the badge shows
     the percentage against **131072**, and no tooltip is rendered.
   - Either model with `modelOptions.numCtx` set (e.g. 16384 via
     `ModelOptionsPopover`): badge switches to 16384, no tooltip.
3. **Compaction trigger**: using `gemma4-26b-128k` (`modelfileNumCtx:
   131072`, exact), set `compactionThreshold` low (e.g. 0.05) so a short
   conversation crosses it. Run a multi-turn conversation with tool calls
   until `usage.prompt_tokens / 131072 > 0.05`. On the next turn, confirm:
   - `generateCompletion` fires once (network tab / a temporary log) with a
     single `role: "user"` message starting with `SUMMARY_INSTRUCTIONS`.
   - `chatStore.chats[entityId].compaction` is set to `{boundaryIndex,
     summary}` with `boundaryIndex` matching `findCompactionBoundary`'s
     result for the current message list.
   - The outgoing `apiMessages` start with one `role: "assistant"` message
     beginning `## Earlier conversation (compacted)`, followed by the last
     `KEEP_RECENT_TURNS` (4) user turns unchanged.
   - `chat.json` and the chat UI still show full, uncompacted history.
4. **Cache reuse**: send another message without crossing
   `findCompactionBoundary`'s next threshold (i.e. `boundaryIndex` unchanged)
   — confirm `generateCompletionSummary` is **not** called again and the
   cached `compaction.summary` is reused.
5. **Cache invalidation**: continue the conversation until
   `findCompactionBoundary` returns a larger index — confirm a new
   summarization call fires and `compaction.boundaryIndex` advances.
6. **Compaction off**: `compactionThreshold = 0` — confirm no
   `generateCompletion` call ever fires for compaction and `apiMessages` is
   unchanged from today's pipeline output.
7. **Mention interaction**: mention `@some-file` in an old (now-compacted)
   message and again, unchanged, in a recent message — confirm the recent
   occurrence is sent in full, not stubbed as "(shown earlier)".
8. **Summary failure path**: point `host` at an unreachable Ollama instance
   while `boundaryIndex > 0` — confirm `generateCompactionSummary` returns
   `null`, `compaction` is left unset, `compactedMessages` falls back to
   `pipelineMessages`, and the main turn proceeds normally (no thrown error,
   no blocked send).
9. **Durable cache across restart**: after step 3 produces a
   `*.compaction.json` sibling (confirm via `read_file`/file inspection that
   `projects/{p}/.../chat.compaction.json` exists with the expected
   `{boundaryIndex, summary}`), restart the app. On the chat's first load,
   confirm the cold-start effect populates `chatStore.chats[entityId].compaction`
   from that file (no `generateCompletion` call), and the next turn (still
   under the next threshold) reuses it without re-summarizing.
10. **`clearChat`/`deleteFrom` invalidation**: after step 3, call `clearChat`
    — confirm `chat.compaction.json` is deleted. Reproduce step 3, then call
    `deleteFrom` with an index `< compaction.boundaryIndex` — confirm
    `chat.compaction.json` is deleted and `chatStore.chats[entityId].compaction`
    is `undefined`.

---

## Known limitations

1. **The triggering turn pays for an extra full completion.** Compaction is
   `await`ed inside `sendMessage`/`regenerate` before the main streamed
   request starts. For `ollama-local` with a large model and a large
   compacted prefix, this can add a long pause (tens of seconds) before the
   user sees any output on the turn that crosses the threshold. This matches
   how Claude Code's auto-compact and opencode's compaction agent behave — a
   one-time cost paid when the boundary advances, not on every turn.
   Step 5's sibling `*.compaction.json` makes this genuinely one-time:
   subsequent turns (including after an app restart) reuse the persisted
   summary and pay nothing extra until `findCompactionBoundary` returns a
   larger index.
2. **The summarization call doesn't carry `modelOptions.numCtx`.**
   `generate_completion`'s ollama branch (`ai.rs:501`,
   `ChatMessageRequest::new(model.clone(), to_ollama_messages(&messages))`)
   passes no `options`, so the summarization request uses whatever `num_ctx`
   the model/server defaults to (Modelfile default or server default),
   independent of what the main conversation negotiated via
   `getEffectiveContextWindow`. If the flattened transcript being summarized
   itself exceeds *that* smaller window, the summarization call inherits the
   same undocumented-overflow behavior flagged in research §1c/§6 — this
   plan does not change `generate_completion`'s signature to fix it.
3. **For `ollama-local` models with neither `modelOptions.numCtx` nor a
   Modelfile `num_ctx`** (e.g. plain `gemma4:26b`), `getEffectiveContextWindow`
   returns `caps.contextLength` (262144, the architecture max) as
   `isUpperBound: true`. Both `TokenUsageBadge`'s percentage and the
   compaction trigger ratio (Step 6) are computed against this number, which
   may be far larger than what Ollama actually serves (4096 by default,
   https://github.com/ollama/ollama/blob/main/docs/faq.mdx). In that
   configuration the usage bar under-reports and compaction triggers later
   than ideal, or never, relative to the *actual* window — exactly the
   "doesn't pretend to solve overflow" gap from research §1c/§6. The tooltip
   surfaces this to the user; Step 1's Modelfile parsing removes it entirely
   for models that declare `num_ctx` (e.g. `gemma4-26b-128k`).
4. **`parameters`-field parsing (Step 1) is not a versioned API contract** —
   observed empirically against one local Ollama install. If a future Ollama
   version changes how `parameters` is rendered, `parse_modelfile_num_ctx`
   returns `None` and `getEffectiveContextWindow` falls through to
   `contextLength` with `isUpperBound: true` (pre-Step-1 behavior, not a
   crash).
5. **One summarization pass may not be enough** if, after compaction, a
   message *within* the kept `KEEP_RECENT_TURNS` window is itself enormous
   (e.g. a huge pasted `@mention`). `boundaryIndex` can only move forward as
   more user turns accumulate, so this self-corrects over subsequent turns
   but not within the turn that first exceeds the threshold.
6. **`*.compaction.json` invalidation only covers `clearChat`/`deleteFrom`.**
   `useChat.ts` has three call sites that shrink `messages` and rewrite
   `chatPath`: `clearChat` (→ `[]`), `deleteFrom` (→ `trimmed`), and
   `regenerate`'s internal trim (`useChat.ts:310-317`, trims to
   `msgs.slice(0, lastUserIdx)` then immediately re-extends to
   `[...trimmed, userMsg, assistantPlaceholder]` before persisting).
   `regenerate` doesn't need separate handling: its final
   `updatedMessages.length` is `lastUserIdx + 2`, and `boundaryIndex` (from
   `findCompactionBoundary` with `KEEP_RECENT_TURNS >= 1`) is always `<=` the
   index of an earlier user turn than `lastUserIdx` — so
   `boundaryIndex <= updatedMessages.length` always holds and the cached
   recap remains in range. Only `clearChat`/`deleteFrom` can produce a final
   length below `boundaryIndex`, and Step 6 instruments both.
