# Summary-Based Context Compaction — Research (Ollama local + cloud)

## Scope

This extends
[`context-optimize-research.md`](context-optimize-research.md) and its
implemented plan ([`context-optimize-plan.md`](../plans/context-optimize-plan.md),
committed `9dde866`). Phases 1–3 of that plan *reduce the rate* at which the
resend payload grows (capping resent tool output, deduping `@mention` blocks,
dropping stale `thinking`). None of them *shrink* the conversation once it has
grown — there is still no compaction anywhere in the stack (prior research §5).

This document researches what a **summary-based compaction** step would look
like — replacing the oldest portion of a long conversation with a single
generated recap — for both Ollama (local and `ollama.com` cloud) and
Claude/OpenAI. It is research only; no implementation plan is proposed here.

---

## 1. What signals are available to decide *when* to compact

Prior research (§6/§7.4 of `context-optimize-research.md`) flagged "Ollama
context-overflow detection" as an open question because Ollama doesn't expose
`num_ctx` in a generally solvable way. Two things found in this codebase
change that picture for a *practical* (not perfect) trigger:

### 1a. Real prompt-token counts are already captured per turn

`TokenUsage` (`src-tauri/src/commands/ai.rs:45-49`) carries `prompt_tokens`
and `completion_tokens` from the provider's own response — for Ollama this is
`prompt_eval_count`/`eval_count` from `/api/chat` (`ai.rs:374-380`), for
Claude it's `usage.input_tokens`/`usage.output_tokens`. This is stored on the
message as `ChatMessage.usage` (`src/types/chat.ts:43`, populated in
`src/hooks/chat/streamHandler.ts:70`).

**This is the actual size of the request payload as tokenized by the
provider for the most recent turn** — a much stronger signal than the
char-based proxy Phase 1–3 implicitly rely on, and it already exists with no
new plumbing.

### 1b. A context-window figure is already surfaced per model

`useModelCapabilities` (`src/hooks/useModelCapabilities.ts`) returns
`contextLength`:
- Ollama: `model.contextLength` sourced from `/api/show`'s `context_length`
  field (`src/lib/ipc.ts:163`, `src-tauri/src/commands/ai_ollama.rs:46`).
- Claude: hardcoded `200000` (`useModelCapabilities.ts:29`).
- OpenAI: hardcoded `128000` (`useModelCapabilities.ts:22`).

`TokenUsageBadge.tsx:15,21` already divides `usage.prompt_tokens +
usage.completion_tokens` by this `contextLength` to render a usage bar — i.e.
the UI already computes something close to "how full is the context window"
today, just for display.

### 1c. The caveat: `contextLength` ≠ the request's actual `num_ctx` for Ollama

Per Context7 (`/ollama/ollama`, `docs/faq.mdx`):

> "By default, Ollama uses a context window size of 4096 tokens. This can be
> overridden using the `OLLAMA_CONTEXT_LENGTH` environment variable for the
> server, or with the `/set parameter num_ctx` command when running `ollama
> run`, or by specifying the `num_ctx` parameter in API requests."

Prototyper only sends `num_ctx` if the user configured
`modelOptions.num_ctx` (`src-tauri/src/commands/ai.rs:328`,
`opts.num_ctx`). If unset, the **server's** effective context window applies
— 4096 by default, or whatever `OLLAMA_CONTEXT_LENGTH` was set to when
`ollama serve` started — which Prototyper cannot read. `caps.contextLength`
(the model's *trained max*, e.g. 32K/128K) can therefore be **much larger**
than the window actually in effect, making `TokenUsageBadge`'s percentage
optimistic for the common case where the user hasn't set `num_ctx`.

**What happens on overflow is still not resolved by documentation** — the
same gap flagged in prior research §6 remains; Context7 surfaced only how to
*set* `num_ctx`, not what `/api/chat` does when the tokenized prompt exceeds
it (silent truncation vs. context-shift vs. error). This is unverified, not
asserted, in both documents.

### 1d. Practical trigger formula (estimate, not a guarantee)

Given 1a–1c, a workable trigger — not provably correct, but strictly better
than nothing and consistent with the "reduce likelihood, don't pretend to
solve overflow" framing of Phase 6:

```
effectiveWindow = modelOptions.num_ctx ?? OLLAMA_DEFAULT_NUM_CTX (4096) // Ollama
                 ?? caps.contextLength                                  // Claude/OpenAI (no num_ctx concept)
trigger when lastTurn.usage.prompt_tokens / effectiveWindow > threshold (e.g. 0.7)
```

For Ollama, defaulting the denominator to 4096 (Ollama's documented default)
rather than `caps.contextLength` (the model's max) is deliberately
conservative — it triggers compaction earlier for the common
"user never touched `num_ctx`" case, where 4096 is what's actually in effect
server-side. This is a per-provider constant, configurable like
`toolOutputResendLimit` (`src/stores/appStore.ts:73-79`) was for Phase 1.

A caveat shared with Phase 1–3: this trigger only fires using **last turn's**
usage — the *next* turn's payload could already be larger if Phase 2/3's
dedup/strip didn't shrink it enough, or if a large `@mention`/tool result was
just added. It's a lagging indicator, same as `TokenUsageBadge` already is.

---

## 2. What gets compacted, and the Claude tool-pairing constraint

### 2a. Today (Phase 5 not built): compaction is structurally simple

Per `src/hooks/chat/messages.ts:25-35`, the non-Ollama (Claude/OpenAI) branch
of `buildApiMessages` already drops `toolCalls` and flat-maps only
`content`/`thinking`/`images`. There is **no `tool_use`/`tool_result` pairing
to preserve today** for Claude — a compaction boundary can be drawn anywhere
between two messages without violating Anthropic's pairing rule, because no
`tool_use` blocks are sent at all yet.

For Ollama, `buildApiMessages`'s Ollama branch (`messages.ts:38-75`) emits
`role: "assistant"` messages with `tool_calls` followed by `role: "tool"`
messages. A compaction boundary must not split an assistant `tool_calls`
message from its following `tool` result messages — i.e. the boundary must
fall **after** a complete `(assistant-with-tool_calls, tool, tool, ...)`
group, or before it starts. Drawing the boundary at a `ChatMessage` index
where `messages[i].role === "user"` (a natural turn boundary) is always safe
for both branches, since tool-call groups only ever follow an `assistant`
turn that itself follows a `user` message.

### 2b. Future interaction with Phase 5

If Phase 5 (Claude `tool_use`/`tool_result` reload, documented as future work
in `context-optimize-plan.md:367-378`) ships later, the same "boundary only at
a `user`-message index" rule would keep compaction compatible — Anthropic's
pairing requires every `tool_use` to have its `tool_result` in the
*immediately following* message, so a `user`-message boundary never splits a
pair (the pair would be entirely before or entirely after the boundary,
never straddling it).

---

## 3. How the summary is produced — two approaches

### 3a. LLM-generated summary (real "compaction")

A separate, non-streaming call via the existing `generateCompletion` IPC
(`src/lib/ipc.ts:267-273`, backed by
`src-tauri/src/commands/ai.rs:486` `generate_completion`) — same model, a
prompt asking it to summarize `messages[0..boundary]` into a compact recap —
whose result replaces those messages with one synthetic message (role
`"user"` or `"assistant"`, content = the recap, no `toolCalls`/`thinking`).

- **Pros**: semantically rich; the model decides what mattered (which files
  were read/edited, decisions made, open threads).
- **Cons**: extra inference call, extra latency, extra cost (cloud) or extra
  load on the user's machine (Ollama local — competing for the same GPU/CPU
  the main conversation needs). For a small local model, an extra
  summarization call could itself take as long as a normal turn.

### 3b. Heuristic / structural compaction (no extra call)

Collapse old `ChatMessage`s programmatically — no model call:
- Old tool calls → one-line descriptions, e.g.
  `"[earlier: read src/foo.ts (142 lines), ran bash: bun test → exit 0, edited src/bar.tsx]"`,
  derived from `tc.tool`/`tc.arguments`/`tc.success` already present in
  `ToolCallRecord` (`src/types/chat.ts:3-9`) — no need to even look at
  `tc.result`.
- Old `content`/`thinking` beyond a per-message char budget → hard-truncated
  (same truncation-message format as Phase 1, `messages.ts:56-58`).
- Old `images` → dropped entirely (a stale screenshot is rarely useful many
  turns later).

- **Pros**: zero extra latency/cost, deterministic, works identically for
  local and cloud, composes naturally with Phases 1–3 (same pipeline step
  style — pure `ChatMessage[] → ChatMessage[]` transforms).
- **Cons**: loses the *prose* continuity an LLM summary would preserve (e.g.
  "the user asked me to also handle the dark-theme case, still pending" —
  a heuristic pass over tool calls alone wouldn't capture that).

### 3c. Recommendation shape (not a plan)

Given 3a's cost is asymmetric by provider (cheap on cloud, expensive-ish on
local), and 3b is provider-agnostic and already matches the
existing-pipeline style (Phase 1–3 are exactly this kind of transform):

- **3b as the default, always-on mechanism** — it's a strict continuation of
  Phase 4's "cap what's unbounded" philosophy applied to *whole messages*
  instead of *tool outputs*, and needs no new settings beyond a char/turn
  budget.
- **3a as an optional, user-toggleable enhancement** (e.g.
  `compactionMode: "heuristic" | "summary"`), off by default for
  `ollama-local`, on by default for cloud providers — mirroring how
  `toolOutputResendLimit` (Phase 1) was made a new, independent, default-safe
  setting rather than repurposing an existing one
  (`context-optimize-plan.md:34-41`).

---

## 4. Where compaction would live, and the persistence question

### 4a. Consistent with the existing pipeline and Design Principle 1

`context-optimize-plan.md:28-30` ("Never change what's persisted to
`chat.json`... Only the *request payload* is truncated/deduped") and the
Phase 1–3 pipeline shape
(`dropStaleThinking → dedupeMentions → buildApiMessages`, wired in
`src/hooks/useChat.ts:210-217` and `:322-329`) both point at the same answer:
compaction would be a **fourth pipeline step**, operating on the copy of
`ChatMessage[]` built for the request, not on the stored chat. The chat UI
and `chat.json` continue to show full history; only `apiMessages` shrinks.

### 4b. Why a *cached* boundary is needed (unlike Phases 1–3)

Phases 1–3 are O(message) pure functions — cheap to re-run on every turn.
Summary-based compaction (3a) is not: re-summarizing `messages[0..boundary]`
from scratch on every subsequent turn would mean paying for a summarization
call on *every* turn once triggered, which reintroduces a cost problem
similar to the one Phase 1 fixed for tool output.

This implies compaction needs **a cached checkpoint**: once
`messages[0..boundary]` has been summarized, the result `(boundary, summary)`
must be remembered so that on the next turn only `messages[boundary..]` (the
genuinely new part) needs the full pipeline, with the cached summary
prepended. Candidates for where that checkpoint lives:
- A sibling file next to `chat.json` (e.g. `*.compaction.json`), following
  the existing pattern of `projects/{id}/.../*.chat.json`
  (`CLAUDE.md`'s "Plans panel" section: `plans/{slug}.chat.json`).
- In-memory only (Zustand `chatStore`, like `liveTokenCount` — prior research
  didn't cover `chatStore` in depth, but `TokenUsageBadge.tsx:17` shows
  per-entity ephemeral state already lives there). In-memory means
  compaction is recomputed once per app session per chat, not once ever —
  a reasonable middle ground.

Either way, the checkpoint must be invalidated/extended once
`messages.length` grows enough past `boundary` to warrant a new (larger)
compaction pass — i.e. compaction boundary moves forward over time, it
doesn't re-trigger every turn once `usage.prompt_tokens` drops back under
threshold.

### 4c. Heuristic compaction (3b) doesn't need the cache

Because 3b is a pure, cheap, deterministic transform (like Phases 1–3), it
can simply be re-run on every turn over the full `messages[]` with no
checkpoint — same as `dropStaleThinking`/`dedupeMentions` today. The caching
problem in 4b is specific to the LLM-summary approach (3a).

---

## 5. Open questions (carried over or new)

1. **Ollama overflow behavior is still undocumented** (carried over from
   prior research §6) — what `/api/chat` does when tokens exceed the
   effective `num_ctx` (truncate/shift/error) remains unverified. Compaction
   *reduces the chance* of hitting this, same framing as Phase 6's existing
   non-goal.
2. **`effectiveWindow` for Ollama when `num_ctx` is unset** — defaulting to
   4096 (Ollama's documented default, Context7 `/ollama/ollama`
   `docs/faq.mdx`) is conservative but may trigger compaction "too early" on
   servers where the operator raised `OLLAMA_CONTEXT_LENGTH`; Prototyper has
   no way to read that server-side env var.
3. **Where the compaction boundary/summary is cached** (4b) — sibling file vs.
   in-memory store — has UX implications (sibling file survives app restarts;
   in-memory doesn't) not resolved here.
4. **Interaction with Phase 2 (`dedupeMentions`)** — if a `@mention` block's
   first occurrence falls inside the compacted (summarized-away) range, later
   "(content unchanged, shown earlier)" stubs (`src/hooks/chat/dedupeMentions.ts:67`)
   would reference content no longer in the payload at all. Compaction would
   need to run *before* Phase 2 in the pipeline, or Phase 2's `seen` map would
   need to only consider messages that survive compaction.
