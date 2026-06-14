# Context Accumulation Remediation Plan

## Context

This plan addresses every issue documented in
[`thoughts/research/context-optimize-research.md`](../research/context-optimize-research.md)
("Tool Output & Cross-Turn Context Accumulation — Research"). That report establishes,
with file:line citations:

- §2: `MAX_TOOL_OUTPUT_FOR_HISTORY = 15_000` (`src-tauri/src/agent/agent_loop.rs:20`)
  only bounds a single agent-loop invocation. The frontend persists and resends the
  **full, untruncated** `ToolCallRecord.result` on every subsequent turn
  (`src/hooks/chat/messages.ts:50-59`), for Ollama.
- §2d: the Claude/OpenAI branch of `buildApiMessages` drops `toolCalls`/tool results
  entirely between turns (`src/hooks/chat/messages.ts:24-35`) — the opposite failure
  mode (information loss vs. unbounded growth).
- §3: `@mention` content is embedded verbatim into `ChatMessage.content`
  (`src/hooks/useChat.ts:172-185`) and resent every turn for **both** providers, with
  no dedup.
- §4: `m.thinking` is forwarded unconditionally for every historical message, for both
  providers (`messages.ts:31,45,64`).
- §5: no compaction/pruning exists anywhere in the stack.
- §1/§7: `bash`, `grep`, `glob`, and all `lsp` operations have **no output cap**
  (`src-tauri/src/agent/executor.rs`, `src-tauri/src/agent/executor/lsp/formatters.rs`).

## Design principles

1. **Never change what's persisted to `chat.json`.** The full-fidelity record (used by
   the UI's tool-call chips, diffs, etc.) is untouched. Only the *request payload*
   (`apiMessages` passed to `generateCompletionStream`) is truncated/deduped.
2. **One processing pipeline, applied right before every request.** Phases 1–3 are
   transforms over `ChatMessage[]`, composed in `useChat.ts` immediately before
   `buildApiMessages`, for both `sendMessage` and `regenerate`.
3. **New settings get new names; existing settings keep their existing meaning.**
   `toolOutputHistoryLimit` (default 15,000, `appStore.ts:99`) currently governs
   *within-loop* truncation (`agent_loop.rs:20` / `claude.rs:259`). Reusing it for the
   *resend* cap would silently change its effective meaning for existing users from
   "≤15,000 chars per tool call, once" to "≤15,000 chars per tool call, **every turn,
   forever**" — a much larger cumulative cost that the setting's existing description
   doesn't communicate. Phase 1 therefore introduces a second, independent setting for
   the resend cap.

## Goals

- Bound the per-turn growth of the Ollama request payload caused by resent tool
  results (§2c of the research).
- Bound the per-turn growth caused by repeated `@mention` blocks (§3).
- Bound the per-turn growth caused by accumulated `thinking` traces (§4).
- Add per-tool raw-output caps for the currently-uncapped tools (§1/§7.2).

## Non-goals (explicit, with rationale)

- **Claude/OpenAI tool-history-on-reload** (§2d, §7.4). Fixing this requires extending
  `Message` (`src/lib/ipc.ts:146-155`) with Anthropic `tool_use`/`tool_result`
  content-block pairing and corresponding changes in `src-tauri/src/agent/claude.rs`.
  This is a distinct feature with its own design questions, listed here as **Phase 5
  (future work)** so it isn't lost.
- **Ollama context-window-aware trimming / overflow recovery** (§6). Per Pi's own
  `overflow.ts` and open issue #2626, reliable overflow detection for Ollama requires
  knowing the model's actual `num_ctx`, which Ollama does not expose in a way Pi's
  authors found sufficient to solve this generally. This is **not attempted** here.
  Phases 1–3 reduce overflow *likelihood* by shrinking what's resent, but do not detect
  or recover from it. Listed as **Phase 6 (open question)**.
- **Reducing `web_fetch`'s 5MB cap** (`executor/web_fetch.rs:7`). Once Phase 1 ships,
  the resend cap bounds this tool's cross-turn cost the same as any other tool; the 5MB
  figure only affects (a) the single in-turn `ToolResult` IPC payload and (b) `chat.json`
  size on disk. Both are judged acceptable for now — see Phase 4 risk note.

---

## Phase 1 — Resend-time pipeline: tool-output resend cap

### New setting: `toolOutputResendLimit`

**File: `src/stores/appStore.ts`**

Add a new setting alongside the existing `toolOutputHistoryLimit` (`appStore.ts:66,99`):

```ts
/** Max characters of a tool result kept when resending history on
 *  subsequent turns (Ollama `buildApiMessages` reconstruction). Independent
 *  of toolOutputHistoryLimit, which bounds the in-loop truncation for the
 *  turn the tool ran in (agent_loop.rs MAX_TOOL_OUTPUT_FOR_HISTORY). */
toolOutputResendLimit: number;
```

Default: **2,000** — matching OpenCode's `TOOL_OUTPUT_MAX_CHARS` and Pi's
"truncated to 2000 characters during serialization" (two independent
implementations converged on this figure; see the comparative research in
[`thoughts/research/context-optimize-research.md`](../research/context-optimize-research.md)).

Expose it in the same Settings → Agents location as `toolOutputHistoryLimit` and
`writeFileLimit` (confirm location via `grep -rn toolOutputHistoryLimit src/modals`
before wiring the UI control).

### Update `buildApiMessages`

**File: `src/hooks/chat/messages.ts`**

Add a `toolOutputResendLimit: number` parameter. In the Ollama branch's tool-result
reconstruction (currently `messages.ts:50-58`), apply the same truncation format already
used server-side for the ephemeral history at `agent_loop.rs:721-727`
(`"{}\n... (output truncated, {} characters total)"`), so a user inspecting the Rust-side
truncated history sees a consistent message shape:

```ts
export function buildApiMessages(
  messages: ChatMessage[],
  systemPrompt: string,
  isOllama: boolean,
  toolOutputResendLimit: number,
): Message[] {
  const system: Message = { role: "system", content: systemPrompt }
  if (!isOllama) {
    // Non-Ollama providers: simple flat mapping (no tool history support yet)
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
          const content = tc.result.length > toolOutputResendLimit
            ? `${tc.result.slice(0, toolOutputResendLimit)}\n... (output truncated, ${tc.result.length} characters total)`
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

This does **not** change `ToolCallRecord.result` in the Zustand store or `chat.json` —
only the payload built for the next request is capped. The chat UI continues to show the
full tool output (`streamHandler.ts`'s `resolveToolCall` is unchanged).

### Wire into `useChat.ts`

**File: `src/hooks/useChat.ts`**

Read `toolOutputResendLimit` from the store alongside `toolOutputHistoryLimit`. Replace
the `buildApiMessages` calls in both `sendMessage` and `regenerate`:

```ts
const isOllama = (provider as Provider).startsWith("ollama")
const pipelineMessages = updatedMessages.slice(0, -1)
// Phase 3 happens first, then Phase 2; see below for the composed pipeline.
const apiMessages = buildApiMessages(
  dedupedMessages,
  systemPrompt,
  isOllama,
  toolOutputResendLimit,
)
```

Also fix `regenerate`'s `generateCompletionStream` call (currently missing `writeFileLimit`
and `toolOutputHistoryLimit` relative to `sendMessage`).

### Why 2,000 and not something between 2,000 and 15,000

Two independently-developed agent CLIs (OpenCode, Pi) arrived at the same ~2,000-char
figure for resent tool output. Both are mature, widely-used tools whose authors have
presumably tuned this against real model behavior. Picking the same figure is a
verified-by-precedent default rather than a guess. The setting remains user-configurable
for cases where a model with a large context window benefits from more resent detail.

---

## Phase 2 — `@mention` content deduplication

Per research §3, `@mention` content (full file/theme/plan/API code, fenced) is baked into
`ChatMessage.content` via `useChat.ts:172-185`, using HTML-comment markers:

```
<!-- @{name} -->
```{lang}
{code}
```
<!-- end @{name} -->
```

(`useChat.ts:181`, and the `@api` variant at `useChat.ts:178`). `ChatMessage.mentions`
(`src/types/chat.ts`) stores only `{type, name, description}` — not the code — so the
duplicated content lives entirely inside `content` as plain text.

### Design

**File: `src/hooks/chat/dedupeMentions.ts` (new)**

A pure transform `dedupeMentions(messages: ChatMessage[]): ChatMessage[]` that:

1. Scans messages **oldest to newest**.
2. For each `<!-- @{name} -->...<!-- end @{name} -->` block found in `m.content`,
   computes a hash of the block's inner content (e.g. `name + code`, via a simple
   string hash — no crypto dependency needed, this is cache-key-style dedup not
   security).
3. If a block with the same `(name, hash)` was already seen in an earlier message,
   replace the block (in the **copy** returned for the request, not the stored
   message) with:
   ```
   <!-- @{name} (content unchanged, shown earlier in this conversation) -->
   ```
4. If `(name, hash)` has not been seen, keep the block as-is and record it as seen.

Only exact content matches are deduped (hash comparison) — if the user re-mentions a
file after it changed (different `code`), the new content is kept in full and becomes
the new "seen" version for that name. This avoids the model working from stale file
content while still deduping the common case (re-mentioning the same unchanged file or
re-running with the same `@theme`/`@plan` context).

### Wiring

Applied as a step in the Phase 1 pipeline:

```ts
const noStaleThinking = dropStaleThinking(updatedMessages.slice(0, -1))
const deduped = dedupeMentions(noStaleThinking)
const apiMessages = buildApiMessages(deduped, systemPrompt, isOllama, toolOutputResendLimit)
```

Applies to **both** providers (mentions are included in `m.content` for both branches of
`buildApiMessages`, per research §3) — unlike Phase 1's tool-output cap, which is
Ollama-only.

---

## Phase 3 — Drop stale `thinking` from resent history

Per research §4, `m.thinking` is forwarded for **every** historical message by both
branches of `buildApiMessages` (`messages.ts:31,45,64`), sourced from
`assistant_msg_with_thinking` (`agent_loop.rs:48-59`, comment cites
[Ollama tool-calling docs](https://docs.ollama.com/capabilities/tool-calling) for why
`thinking` is included in history at all — i.e. it's needed for the *current* turn's
multi-iteration tool-calling loop, not for *future* turns).

### Design

In the Phase 1 pipeline, before `buildApiMessages`, strip `thinking` from every message
except the single most recent assistant message:

```ts
function dropStaleThinking(messages: ChatMessage[]): ChatMessage[] {
  const lastAssistantIdx = messages.findLastIndex((m) => m.role === "assistant")
  return messages.map((m, i) =>
    m.thinking && i !== lastAssistantIdx ? { ...m, thinking: undefined } : m
  )
}
```

This is a Prototyper-specific design choice (not sourced from OpenCode/Pi — neither
documents thinking-specific handling, per the comparative research above). Rationale: a
reasoning trace's value is to inform the *next* model call in the *same* decision — once
a turn completes and a new user message starts a new decision, the old reasoning is
context cost without corresponding benefit, and `agent_loop.rs`'s own comment frames
`thinking`-in-history as serving "Ollama multi-turn tool-calling" (i.e. within one
`generate_completion_stream` call's internal iterations), not cross-turn.

Place this as the first step in the pipeline, since it shrinks messages before the
subsequent dedup step:

```ts
const noStaleThinking = dropStaleThinking(updatedMessages.slice(0, -1))
const deduped = dedupeMentions(noStaleThinking)
const apiMessages = buildApiMessages(deduped, systemPrompt, isOllama, toolOutputResendLimit)
```

Applies to both providers, matching where `m.thinking` is forwarded today.

---

## Phase 4 — Per-tool raw output caps (backend)

Per research §1/§7.2, only `read_file` (`MAX_BYTES = 50_000`, `executor.rs:300`) and
`web_fetch` (`MAX_RESPONSE_SIZE = 5MB`, `executor/web_fetch.rs:7`) have any cap. `bash`
(`executor.rs:1306-1367`), `grep` (`executor.rs:853-909`), `glob` (output around
`executor.rs:847`), `run_tsc`/`run_lint`/`run_build`, `web_search`
(`executor.rs:1369-1483`), and all `lsp` formatters
(`executor/lsp/formatters.rs:47-161`) are unbounded.

### Design

**File: `src-tauri/src/agent/executor.rs`**

Add a shared helper, mirroring Pi's "cap by bytes or lines, whichever first" rule
(Pi: 50KB / 2000 lines) and reusing the exact truncation-message phrasing already
established by `agent_loop.rs:721-727` for consistency:

```rust
/// Caps `output` at `max_bytes` characters or `max_lines` lines, whichever is
/// hit first. Mirrors the read_file cap (executor.rs MAX_BYTES) applied to
/// tools that currently have no output limit.
pub(super) fn cap_tool_output(output: &str, max_bytes: usize, max_lines: usize) -> String {
    let mut line_count = 0;
    let mut byte_count = 0;
    for (i, line) in output.split_inclusive('\n').enumerate() {
        line_count = i + 1;
        byte_count += line.len();
        if byte_count > max_bytes || line_count > max_lines {
            let truncated: String = output.chars().take(byte_count - line.len()).collect();
            return format!(
                "{}\n... (output truncated, {} characters / {} lines total)",
                truncated, output.len(), output.lines().count()
            );
        }
    }
    output.to_string()
}
```

Apply with **`max_bytes = 50_000, max_lines = 2_000`** — matching both the existing
`read_file` byte cap (`executor.rs:300`) and `tools.rs:20`'s default `limit = 2000`
lines for `read_file`, and matching Pi's published figures. Using the *same* numbers
Prototyper already uses for `read_file` (rather than inventing a new constant) keeps the
cap self-consistent across tools.

Apply to:
- `execute_bash` (`executor.rs:1306-1367`) — wrap the combined stdout+stderr before
  returning.
- `execute_grep` (`executor.rs:853-909`) — wrap the raw `grep -rn` output.
- `execute_glob` (around `executor.rs:847`) — wrap the newline-separated path list.
- `run_tsc`/`run_lint`/`run_build` — wrap raw stdout.
- `web_search` (`executor.rs:1369-1483`) — wrap the assembled results string (in
  addition to the existing `num_results.clamp(1,10)`, which bounds result *count* but
  not total snippet size).
- `lsp` formatters (`executor/lsp/formatters.rs`) — wrap the return values of
  `format_locations`, `format_hover`, and `format_document_symbols`.

### Explicitly not adding Pi's "spill to temp file" escape hatch

Pi's design saves the untruncated output to a temp file the model can read back. This
plan does **not** add that: Prototyper's `read_file` tool already lets the model re-invoke
with `offset`/`limit` to page through a large file (`tools.rs:14-21`), and `grep`/`glob`
results pointing at file paths let the model `read_file` the specific hits. A temp-file
mechanism would be new infrastructure (temp file lifecycle, a new tool or tool argument to
read it, cleanup) for a capability that substantially overlaps with tools that already
exist. If real usage shows the 50K/2000-line cap cutting off needed `grep`/`bash` output
with no good re-query path, revisit — but that is speculative and not built pre-emptively
per the project's "no hypothetical features" guidance.

---

## Phase 5 — Claude/OpenAI tool-history-on-reload (future work, not built)

Documented for completeness per research §2d/§7.4. Would require:
- Extending `Message` (`src/lib/ipc.ts:146-155`) with `tool_use`/`tool_result`
  content-block types matching Anthropic's API shape.
- A non-Ollama branch in `buildApiMessages` that reconstructs paired
  `tool_use`/`tool_result` blocks from `ChatMessage.toolCalls`, respecting Anthropic's
  pairing rule (every `tool_use` needs a `tool_result` in the *immediately following*
  user message).
- Corresponding history-construction changes in `src-tauri/src/agent/claude.rs`.

No further design work done here — flagged as a separate plan if prioritized.

---

## Phase 6 — Ollama context-overflow detection (open question, not solved)

Per Pi's `overflow.ts` and open issue
[#2626](https://github.com/earendil-works/pi/issues/2626), reliable overflow detection
for Ollama requires knowing the model's actual `num_ctx`, which Ollama does not expose
in a way Pi's authors found sufficient to solve this generally. Phases 1–3 reduce
overflow *likelihood* by shrinking what's resent, but do not detect or recover from it.
**Open question, carried over from the research doc (§6)**: what Ollama's `/api/chat`
actually does when the tokenized prompt exceeds `num_ctx` (silent truncation vs. error)
was not resolved by documentation research and would require empirical testing against a
running Ollama instance — out of scope for this plan's implementation phases.

---

## Verification

### Phase 1
1. `bun run tsc --noEmit` clean after `messages.ts`/`useChat.ts` signatures updated.
2. Add `toolOutputResendLimit` to `appStore.ts` defaults and Settings UI; confirm it
   persists via the existing settings-store mechanism (same pattern as
   `toolOutputHistoryLimit`).
3. `bun run tauri:dev`: run an agent task with an Ollama model that calls `read_file` on
   a file >2,000 chars, then send a follow-up message. In `PromptInspector`'s JSON tab
   for the follow-up request, confirm the `tool` role message is truncated to
   `toolOutputResendLimit` chars with the `"... (output truncated, N characters
   total)"` suffix, while the chat UI's tool-call chip still shows the full content.
4. Confirm `regenerate` now passes `writeFileLimit`/`toolOutputHistoryLimit`.

### Phase 2
1. In one turn, mention `@some-file`; in a later turn, mention it again unchanged.
   Confirm via `PromptInspector` that the second occurrence is replaced with the
   `(content unchanged, shown earlier in this conversation)` stub.
2. Edit the file, mention it again. Confirm the new content is sent in full (hash
   differs) and becomes the new dedup baseline for subsequent turns.
3. `bun run tsc --noEmit` clean.

### Phase 3
1. Trigger a turn with `thinking` enabled, producing `m.thinking` on the assistant
   message. Send a follow-up turn. Confirm via `PromptInspector` that the first turn's
   `thinking` is absent from the second request's payload, while the second turn's own
   (in-progress) `thinking` is present once produced.

### Phase 4
1. `cargo build` clean in `src-tauri/`.
2. Run `bash` via the agent with a command producing >2,000 lines of output (e.g.
   `find / -name '*.rs'` style); confirm the tool result is capped with the truncation
   suffix and the model can recover via `grep`/`read_file` on specific paths.
3. Run `grep` for a very common token across the repo; confirm capped output.
4. Spot-check `lsp references` on a widely-used symbol; confirm capped output.

---

## Risks

1. **Phase 2's hash-based dedup could mask a file change if the hash collides** —
   using a non-cryptographic string hash (e.g. a simple FNV/djb2 over `name + code`)
   has a nonzero collision probability. Given this is a context-size optimization (not a
   correctness-critical path — worst case the model sees a stub instead of slightly
   different content it already saw once), a 32-bit hash is acceptable; do not add a
   cryptographic hash for this.
2. **Phase 1's new `toolOutputResendLimit` setting adds another number for users to
   understand**, alongside `toolOutputHistoryLimit` and `writeFileLimit`. Mitigated by
   giving it a clear default (2,000, matching two independent precedents) so most users
   never need to touch it, and by the doc-comment in `appStore.ts` explaining the
   distinction from `toolOutputHistoryLimit`.
3. **Phase 4's 50KB/2000-line cap could truncate a `bash` command's output mid-useful-
   content** (e.g. a test runner's failure summary appearing after 2,000 lines of
   passing-test noise). This is the same trade-off Pi makes with the same numbers; if it
   proves problematic in practice, the fix is model-side (ask the model to filter its own
   commands, e.g. `| tail -100`), not a larger cap — a larger cap reintroduces the
   unbounded-growth problem Phase 1 is designed to bound on the resend side.
4. **None of these phases solve Ollama overflow detection** (Phase 6). A sufficiently
   long conversation on a small-`num_ctx` Ollama model can still fail at the provider
   even with Phases 1–3 applied — they raise the message count a conversation can
   sustain before hitting that ceiling, they do not remove the ceiling.
