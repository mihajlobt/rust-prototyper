# Tool Output & Cross-Turn Context Accumulation — Research

## Scope

This extends the earlier tool-*definition* sizing research (tool schemas, ~4.8K tokens
for all 20 tools) with the other half of the picture: tool *output* — what each tool
returns after execution, how big that can get, and what happens to it across the life
of a conversation. Findings are grounded in source citations; nothing here is guessed.

## Headline finding

`MAX_TOOL_OUTPUT_FOR_HISTORY` (15,000 chars) only bounds tool-output size **within a
single agent-loop invocation** (one user message, up to `MAX_ITERATIONS = 20` internal
tool-calling iterations). It does **not** bound the cumulative size of the conversation
across multiple user turns. On every subsequent user turn, the frontend rebuilds the
*entire* message history from `chat.json`/Zustand state and resends it — using the
**full, untruncated** tool output captured at the time each tool ran, not the
backend's truncated copy. For the Ollama provider this means every `read_file`,
`bash`, `grep`, `glob`, `lsp`, or `web_fetch` result ever produced in the conversation
is retransmitted, at full size, on every turn thereafter — for the rest of the session.

---

## 1. Per-tool output catalog

All citations are `src-tauri/src/agent/...` unless noted. "Cap" = hard size limit
enforced by the tool itself, independent of the cross-turn history limit.

| Tool | Output shape | Cap on raw output | Worst case |
|---|---|---|---|
| `read_file` | `<path>...</path>\n<type>file</type>\n<content>\n{N: line}...\n(Showing X lines. Use offset=Y to continue.) \| (End of file - N lines)</content>` (`executor.rs:337-350`) | `MAX_BYTES = 50_000` bytes (`executor.rs:300`), default `limit = 2000` lines (`tools.rs:20`) | ~50KB ≈ ~12,500 tokens per call |
| `write_file` | `"Written to: {path}\nTo read this file, use read_file with path: {path}"` + optional "already existed" note (`executor.rs:186-189`) | none needed — fixed short message | ~100–250 bytes. Full content goes into `written_content`, which is **not** part of `output` (UI-only, see §2b) |
| `edit_file` | `"Edit applied successfully."` (`executor.rs:413`) | n/a | ~25 bytes. Full updated file also only in `written_content`, not `output` |
| `bash` | raw `stdout` + `stderr` concatenated, or `"(no output)"` if both empty (`executor.rs:1344-1349`) | **none** — only a 30s wall-clock timeout (`executor.rs:1342`) | Unbounded; a verbose build/test command can easily produce tens of KB |
| `run_tsc` / `run_lint` / `run_build` | raw tool stdout, optionally filtered to lines containing the requested path (tsc only) | **none** | Unbounded; full TSC/ESLint/esbuild diagnostic dump |
| `glob` | newline-separated matching paths, or `"(no files matched)"` (`executor.rs:847`); `node_modules`/`.git` excluded | **none** | A broad pattern (`**/*.tsx`) on a large project can return hundreds of paths |
| `grep` | raw `grep -rn` output, or `"(no matches found)"` (`executor.rs:905`); `node_modules`/`.git` excluded | **none** | A common identifier can match hundreds of lines across a project — tens of KB |
| `web_search` | `"Search results for: {query}\n\n[1] {title}\n    URL: {url}\n    {snippet}\n\n..."` (`executor.rs:1464-1474`) | result count clamped to 1–10, default 5 (`executor.rs:1393`) | per-result snippet length is **not** capped by Prototyper — bounded mainly by SearXNG's own response |
| `web_fetch` | `"Fetched {url} ({bytes} bytes{, content-type: TYPE}).\nExtraction goal: {prompt}\n\n{body}"`; HTML converted to Markdown via `htmd::convert()` (`executor/web_fetch.rs:163-179`) | `MAX_RESPONSE_SIZE = 5 * 1024 * 1024` (5MB) (`executor/web_fetch.rs:7`, checked at `:135` and `:154`) | up to 5MB ≈ ~1.25M tokens for one fetch — by far the largest possible single tool output |
| `lsp` / `hover` | hover text via `format_hover`, or `"No hover information available."` (`executor/lsp/formatters.rs:95-108`) | **none** | Typically small (type signature + doc), but unions/generics can be long |
| `lsp` / `definition`, `references` | `format_locations`: `"Found N location(s) across M file(s):\n{file}:\n  Line X:Y\n..."` (`executor/lsp/formatters.rs:47-74`) | **none** | A widely-used symbol (`references`) can return hundreds of locations — tens of KB |
| `lsp` / `document_symbol` | indented symbol-tree via `format_document_symbols`/`push_nested_symbol` (`executor/lsp/formatters.rs:121-161`) | **none** | Every symbol in the file, recursively — large files can produce long outlines |
| `task_list` | status-marker summary (`task_list.rs`) | bounded by task count (small, app-managed) | ~5KB for 100 tasks |
| `tool_search` | `"Loaded: ...\nAlready available: ...\nNot found: ..."` or `"Tools matching '{query}':\n- {name}: {description}\n..."` (`tool_search.rs`) | results clamped to 1–20, default 5 | ~6KB max |
| `register_screen` / `set_active_theme` | one-line confirmation (`executor.rs:1043`, `executor.rs:1106`) | n/a | ~200 bytes |
| `validate_design_json` | `"design.json is valid..."` or a newline list of validation errors (`executor.rs:1209,1216`) | bounded by schema's fixed key count (~37 possible errors) | ~2KB |
| `skill` | `"Skill '{name}': {description}\n\n{instructions}"`, `$ARGUMENTS` substituted (`skill.rs:92`) | **none** — whole `SKILL.md` body | depends on skill file size, typically a few KB |

**Only two tools have any output cap at all**: `read_file` (50KB) and `web_fetch` (5MB).
Every other tool — most importantly `bash`, `grep`, `glob`, and all three `lsp`
operations — is **unbounded**, and there is no shared truncation helper; each
`execute_*` function formats its own string independently.

---

## 2. How tool output flows into history (the cross-turn resend mechanism)

### 2a. Within one agent-loop invocation (bounded)

For both Ollama (`agent_loop.rs`) and Claude (`claude.rs`), once a tool finishes:

```rust
// agent_loop.rs:721-727 (claude.rs:422-433 is the same pattern)
let history_output = if res.output.len() > tool_output_history_limit {
    let truncated: String = res.output.chars().take(tool_output_history_limit).collect();
    format!("{}\n... (output truncated, {} characters total)", truncated, res.output.len())
} else {
    res.output.clone()
};
history.push(tool_result_msg(name, &history_output));
```

`tool_output_history_limit` defaults to `MAX_TOOL_OUTPUT_FOR_HISTORY = 15_000`
(`agent_loop.rs:20`, resolved at `agent_loop.rs:511` / `claude.rs:259`), overridable via
`AgentLoopParams.tool_output_history_limit` (`agent_loop.rs:501`). This `history` vector
is the seed for `stream_turn`'s `"messages"` field (`agent_loop.rs:140`) and is reused
across the loop's internal iterations (up to `MAX_ITERATIONS = 20`, `agent_loop.rs:18`).
**This is the only place any cross-iteration truncation happens, and it only exists for
the lifetime of one `generate_completion_stream` call.**

### 2b. What the frontend receives and persists (unbounded)

In the same place, *before* truncation, the **full** `res.output` is sent to the UI:

```rust
// agent_loop.rs:713-719 (claude.rs:414-420 identical pattern)
let _ = channel.send(CompletionEvent::ToolResult {
    tool: name.clone(),
    success: res.success,
    output: res.output.clone(),   // <-- full, untruncated
    path: path_opt,
    content: res.written_content.clone(),
});
```

The frontend stores this verbatim:

```typescript
// src/hooks/chat/streamHandler.ts:153-156
} else if (msg.event === "ToolResult") {
  const { tool, success, output, path, content } = msg.data
  useChatStore.getState().resolveToolCall(entityId, tool, output, success, path ?? "")
```

```typescript
// src/stores/chatStore.ts:97-116 — `result` field set to the full `output`
toolCalls[i] = { ...toolCalls[i], result, success, pending: false, path }
```

```typescript
// src/types/chat.ts:3-10
export interface ToolCallRecord {
  tool: string
  path: string
  arguments: Record<string, unknown>
  result?: string   // <-- full output, no size limit
  success?: boolean
  pending?: boolean
}
```

This is persisted to `projects/{id}/.../*.chat.json` via `writeFile(chatPath, ...)`
(`useChat.ts:199`).

### 2c. What gets resent on the NEXT user turn (the bug)

Every `sendMessage`/regenerate call rebuilds the **entire** API message list from the
**entire** stored conversation and sends it as the seed for a brand-new agent loop:

```typescript
// src/hooks/useChat.ts:207-211 (and identically at :314-318 for regenerate)
const apiMessages = buildApiMessages(
  updatedMessages.slice(0, -1),   // the WHOLE conversation so far
  systemPrompt,
  isOllama,
)
...
const requestId = await generateCompletionStream(modelId, apiMessages, ...)
```

```rust
// src-tauri/src/commands/ai.rs:291/463 -> agent_loop.rs:482,519
initial_messages_json: json_messages,   // becomes `history` seed, agent_loop.rs:519
```

For the Ollama provider, `buildApiMessages` reconstructs a `role: "tool"` message for
**every** prior tool call, using the **full, untruncated** `tc.result`:

```typescript
// src/hooks/chat/messages.ts:50-59
for (const tc of m.toolCalls) {
  if (tc.result !== undefined) {
    result.push({
      role: "tool",
      content: tc.result,     // <-- full size, e.g. up to 50KB for a read_file
      tool_name: tc.tool,
    })
  }
}
```

**Net effect**: `MAX_TOOL_OUTPUT_FOR_HISTORY` (15,000 chars) caps what a tool result
costs *during the turn it was produced*. It does nothing for turns 2, 3, ... N — those
resend the original, untruncated `result` (which can be up to 50KB for `read_file` or
unbounded for `bash`/`grep`/`lsp`/`web_fetch`). The 15,000-char limit is, in practice,
**dead weight for anything except the in-flight turn's own tool-calling loop**.

### 2d. Provider asymmetry: Claude drops tool history entirely

```typescript
// src/hooks/chat/messages.ts:24-35
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
```

For Claude/OpenAI, `m.toolCalls` (and therefore all `tc.result` tool outputs from prior
turns) are **dropped entirely** when reconstructing history for a new turn — only
`content`/`thinking`/`images` survive. This is the opposite failure mode from Ollama:

- **Ollama**: every tool output ever produced, at full size, resent forever (context
  *grows* unboundedly).
- **Claude**: tool outputs from completed turns vanish from context on the next turn —
  the model has no memory of file contents it read, command output it saw, etc. in
  earlier turns of the same conversation (context *loses information* silently).

Neither behavior is currently documented or configurable; the comment "no tool history
support yet" suggests the Claude branch is an intentional simplification, not a final
design — likely because Anthropic's `tool_use`/`tool_result` pairing is stricter
(every `tool_use` block requires a matching `tool_result` in the very next user
message — reconstructing this correctly from a flattened multi-turn history is more
failure-prone than Ollama's flat `role: "tool"` messages).

---

## 3. @mention injection (separate but compounding)

```typescript
// src/hooks/useChat.ts:172-185
const mentionContext = currentMentions
  .map((m) => {
    if (m.type === "api") { /* ... full service-hook code block ... */ }
    const lang = m.type === "theme" ? "css" : m.type === "file" || m.type === "plan" ? "md" : "tsx"
    return `<!-- @${m.name} -->\n\`\`\`${lang}\n${m.code}\n\`\`\`\n<!-- end @${m.name} -->`
  })
  .join("\n\n")

const userContent = mentionContext ? `${mentionContext}\n\n${currentInput}` : currentInput
```

This is baked directly into `ChatMessage.content` (`src/types/chat.ts:30-44`), which
**both** branches of `buildApiMessages` include unconditionally
(`messages.ts:30`, `:63`). So unlike tool outputs, @mention content is resent every
turn for **both** Ollama and Claude — full file/theme/plan content, permanently, from
the turn it was mentioned onward.

---

## 4. Thinking content

```rust
// agent_loop.rs:48-59
fn assistant_msg_with_thinking(content: &str, thinking: Option<&str>, tool_calls: &[serde_json::Value]) -> serde_json::Value {
    let mut msg = serde_json::json!({"role": "assistant", "content": content});
    // Ollama multi-turn tool-calling: include thinking in history.
    // https://docs.ollama.com/capabilities/tool-calling
    if let Some(t) = thinking {
        msg["thinking"] = serde_json::Value::String(t.to_string());
    }
    ...
}
```

`m.thinking` is also forwarded unconditionally by **both** branches of
`buildApiMessages` (`messages.ts:31`, `:45`, `:64`). Reasoning-model thinking traces
(gpt-oss, qwen3, etc.) can be several KB per turn and are not truncated or excluded
from later turns — they accumulate the same way mentions do, for both providers.

---

## 5. No compaction/pruning exists anywhere in the stack

Searched `src-tauri/src/agent/` for `compact|prune|summar|trim|dedup` — the only hits
are local string `.trim()` calls inside individual tool-output formatters (not history
management) and `task_list.rs`'s `format_summary` (a task-list summary, unrelated to
conversation compaction). Searched `src/hooks/` and `src/stores/` for
`compact|prune|truncat` — no hits. **There is no mechanism anywhere — frontend or
backend — that removes, shrinks, or summarizes old tool outputs, mentions, or thinking
text as a conversation grows.**

---

## 6. Why this is acute for Ollama specifically

Ollama's context window defaults to **4096 tokens** and is only raised via
`OLLAMA_CONTEXT_LENGTH` (server env var) or per-request `options.num_ctx`
(`docs/faq.mdx`, confirmed via Context7 `/ollama/ollama`). Prototyper only sets
`num_ctx` if a user-configured model preset includes it
(`src-tauri/src/commands/ai.rs:328`) — otherwise the 4096 default applies.

Combined with §2's finding, a single conversation turn that calls `read_file` near its
50KB cap (~12,500 tokens) already exceeds a 4096-token context window *by itself*, and
that same ~12,500 tokens gets resent on every subsequent turn (§2c). Two or three such
reads — entirely plausible in a normal "read this file, then edit it" workflow — would
exceed even an 8K–16K `num_ctx` on turn 2 or 3, before counting the system prompt,
tool definitions (~3,900 tokens for the 17 non-deferred tools, per prior research), or
the user's own messages.

Ollama's own documentation for agentic/tool-calling integrations (Codex CLI) states:
"Codex CLI requires a larger context window, and it is recommended to use a context
window of at least 64k tokens when integrating with Ollama"
(`docs/integrations/codex.mdx`, via Context7 `/ollama/ollama`) — i.e. Ollama's own docs
acknowledge that tool-calling agents need far more than the 4096 default. **What
Ollama does when an `/api/chat` request's tokenized prompt exceeds `num_ctx` (silent
truncation/context-shift vs. an error) is not stated in the docs surfaced by Context7
for this query — this is an open question that would need empirical testing against a
running Ollama instance, not a documentation claim.** If Ollama silently drops/shifts
the oldest tokens, that risks corrupting the `role: "tool"` / `tool_calls` pairing in
history (a message whose matching tool-call got shifted out), which would produce
malformed conversations — but this is flagged as unverified, not asserted.

---

## 7. Risks if left unaddressed (concrete scenarios)

1. **Read-heavy sessions degrade fast on Ollama.** Any workflow of "read file → edit →
   read another file → edit" accumulates full `read_file` outputs (up to 50KB/~12.5K
   tokens each) that are never pruned. By turn 3-4 a default-`num_ctx` Ollama session
   is likely already over budget purely from `read_file` resends, independent of tool
   schemas or the system prompt.

2. **`bash`/`grep`/`lsp` have no ceiling at all.** A single `grep -rn` for a common
   token, or `lsp references` on a widely-used symbol, can return tens of KB in one
   shot — and that shot is then permanent in history for Ollama.

3. **`web_fetch` is the single largest risk** — up to 5MB (~1.25M tokens) from one
   call, resent every turn thereafter on Ollama. Even a moderate fetch (50-100KB
   converted Markdown) dwarfs a 4096-token context window by itself.

4. **Claude's opposite failure mode** — silently losing all tool-result context
   between turns may cause the model to re-read files it already read, or make
   decisions inconsistent with tool output it can no longer see, without any error or
   user-visible signal.

5. **Mentions and thinking compound both of the above** — full mentioned-file content
   and full reasoning traces are additional unbounded, permanently-resent strings on
   top of tool outputs, for both providers.
