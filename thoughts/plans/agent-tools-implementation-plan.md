# Implementation plan: ToolSearch, Skill, TaskList, WebFetch, LSP

## Context

`thoughts/research/agent-tools-research.md` evaluated five tools used by Claude Code/OpenCode/Serena/Pi as candidates for Prototyper's agent catalog (`src-tauri/src/agent/tools.rs`, currently 15 tools). The research's own build-order ranking (§8, value÷cost) is **WebFetch → TaskList → Skill → ToolSearch → LSP**, and that order is followed here — no deviation found that overrides it. All five are added as **first-class, generically available tools**, registered in `build_tools()` and filterable per-panel via the existing `tool_filter: HashSet<String>` mechanism — exactly like the current 15. None are stubbed; LSP is scoped per the research's own §6.7 "minimal viable surface" recommendation (TypeScript-only, top operations first), which is *following* the cited source, not skipping it.

Two of the five introduce genuinely new attack surface for Prototyper (outbound network for WebFetch, long-lived child-process spawning for LSP) — the plan calls these out explicitly since `bash`'s sandbox policy currently *blocks* network access entirely (tools.rs:226-233, sandbox/policy.rs).

---

## Cross-cutting structural changes (apply once, used by all five)

### File-size budget (coding-standards.md: 500-600 line hard limit)
- `tools.rs` is 296 lines (`wc -l src-tauri/src/agent/tools.rs`; `build_tools()` at line 160, `make_schema` at 154); five more tool defs (~30-50 lines each incl. `*Args` + doc-comment description + schema wiring) would push it to ~500 — right at the edge of the 500-600 line hard limit (coding-standards.md "File size limits").
- `executor.rs` is already 1513 lines (`wc -l`) — pre-existing debt, out of scope to fix wholesale.
- **Resolution**: convert `tools.rs` → `agent/tools/mod.rs` that re-exports and composes; put each new tool's `*Args` + `ToolInfo` constructor in its own file under `agent/tools/`: `web_fetch.rs`, `task_list.rs`, `skill.rs`, `tool_search.rs`, `lsp.rs`. `build_tools()` in `mod.rs` calls each module's `tool_info()` and appends to the existing 15. Mirror this for the executor: add `agent/executor/web_fetch.rs`, `task_list.rs`, `skill.rs`, `tool_search.rs`, and `agent/executor/lsp/{mod,client,formatters}.rs`, each exposing an `execute_*` async fn that `executor.rs`'s existing dispatch `match` calls into (one new arm per tool, ~5 lines added to the match — `executor.rs` itself stays a thin dispatcher and does not grow materially). This is "extract a module" per coding-standards.md, scoped to only the new code — it does not attempt to also split the pre-existing 1513 lines.

### New Cargo dependencies (name them now so the plan review can scrutinize each)
| Crate | For | Why this one (research citation) |
|---|---|---|
| `htmd` | WebFetch HTML→Markdown | §5.6 — smallest footprint, "Turndown-inspired," matches both reference implementations |
| `lsp-types` | LSP message shapes (serde types for `Location`/`Hover`/`Diagnostic`/etc.) | §6.5 — 25.7M downloads, the only mature LSP-adjacent crate; types-only so it doesn't lock us into a client framework |

No YAML crate is added for Skill frontmatter (see §3 below — hand-rolled parsing is justified at this schema size). No LSP client framework is added — see §6.

### Exactly how tool permissions work today (verified by reading the live code, not assumed)
This is the mechanism every new tool's gating decision must slot into — read precisely before changing anything:
- `agent_loop.rs:560-578`: `ask_user`/`ask_user_form` are special-cased **before** the gate runs at all — `// ask_user / ask_user_form handled here — no permission gate, no execute_tool call`. They go straight to `request_ask_user`/`request_ask_user_form` and return. This is the precedent for "internal, no-side-effect tools never enter the gate" — directly applicable to `task_list`, `skill`, `tool_search` (none of which touch anything outside their own bookkeeping/read paths).
- `agent_loop.rs:582`: for every other tool, `let should_gate = check_permission_gate(&name, permission_mode, &allowlist);` — a **boolean**, true = "this call must be confirmed by the user."
- `check_permission_gate` (`agent_loop.rs:213-226`) computes `should_gate` per `ToolPermissionMode` (`commands/ai.rs:63-69`): `AutoAcceptAll` → never gate; `AutoAcceptReadOnly` → never gate `read_file` specifically (`if tool == "read_file" { false }`), gate everything else unless allowlisted; `AskEveryTime` → gate everything unless allowlisted.
- `agent_loop.rs:584-597`: if `should_gate`, call `request_permission` (`agent_loop.rs:229-279` — registers a oneshot in `state.pending_permissions`, emits `CompletionEvent::ToolPermission`, the frontend resolves via `resolve_tool_permission` → `commands/ai.rs`). `Rejected` short-circuits with a failure result; `Accepted`/`AlwaysAllowed` proceed to `execute_tool`.

**Implication for WebFetch** — `bash`'s sandbox policy explicitly blocks network access (the tool's own description string at `tools.rs:226-233` states this; enforced in `sandbox/policy.rs`). **WebFetch is therefore the first tool with real outbound network capability** beyond the local SearXNG instance `web_search` talks to (`executor.rs:1345-1458`). The risk is concrete and specific: `check_permission_gate`'s `AutoAcceptReadOnly` arm has a **named, hardcoded exception for `read_file`** (`agent_loop.rs:221`, `if tool == "read_file" { false }`) — `web_fetch` must never be added to that line or any equivalent special-case, because doing so would silently grant network access under a permission mode whose entire premise is "only reads are silent." The correct, minimal-risk approach: do **not** touch `check_permission_gate` at all — `web_fetch` simply falls through to the `else { !allowlist.contains(tool) }` branch like every other non-`read_file` tool, which is already the gated path. No code change to the gate function is required; this is purely a "don't special-case it" discipline note for the implementer.
- LSP requires spawning a long-lived `typescript-language-server` child process. The existing sandbox path (`sandbox::execute_sandboxed`, sandbox/mod.rs:18-64) is built for one-shot, timeout-bounded commands (`bash`, `run_tsc`) — not long-lived stdio-piped servers. Two real options, and the plan picks one:
  - (a) extend the sandbox module with a long-lived-process variant (bwrap+landlock without a kill-on-timeout), or
  - (b) run the LSP server unsandboxed but constrained to the project root via its own `rootUri`/workspace-folder configuration (the LSP protocol's own scoping), gated by a one-time `ToolPermission` prompt the first time it's spawned per project, and a Settings toggle defaulting to **off**.
  - **Recommendation: (b)**. Building long-lived-process sandbox support is a much larger, separate infrastructure project; the research itself frames LSP as the highest-cost item and recommends gating it behind a Settings toggle with lazy enablement (§6.7) — that gate plus the permission prompt is an adequate, honest interim posture, and matches how `bonsai_process` (also a long-lived child process) is already handled in `AppState` without sandbox wrapping.

---

## 1. WebFetch (build first)

**Args** (`agent/tools/web_fetch.rs`): `{ url: String, prompt: String }` — the simpler, more token-economical 2-field shape (Claude Code's; research §5.7 explicitly prefers it over OpenCode's 3-field `{url, format, timeout}`).

**Description**: adapt Claude Code's verbatim text (research §5.2/§5.7): "Fetches content from a URL and uses the prompt to describe what to extract from it. HTTP URLs are automatically upgraded to HTTPS. Read-only — does not modify files. Will fail for authenticated/private URLs."

**Executor** (`agent/executor/web_fetch.rs`):
- SSRF hardening (research §5.5, source [28] — this is the load-bearing security work, not optional):
  - Resolve the host via `tokio::net::lookup_host`, validate the **resolved IP** (not hostname) against the documented CIDR blocklist — `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (incl. cloud metadata `169.254.169.254`), `127.0.0.0/8`, `100.64.0.0/10`, IPv6 `fc00::/7`, `fe80::/10`, `::1/128`, `fd00:ec2::254`.
  - Pin the connection to the validated IP (custom `reqwest::dns::Resolve` impl) to close the TOCTOU/DNS-rebinding gap — this is the one place OpenCode's reference implementation explicitly falls short (§5.5/§5.7), and Prototyper should not repeat that gap.
  - Scheme allowlist: `http`/`https` only; reject `file://`, `gopher://`.
  - Canonicalize before validating (decode percent-encoding, normalize numeric-IP forms, strip trailing dots).
- HTML→Markdown via `htmd`.
- Caps mirroring OpenCode's constants (§5.7): `MAX_RESPONSE_SIZE = 5MB` (checked via `Content-Length` + re-checked on `.bytes()` length), `DEFAULT_TIMEOUT = 30s` via `tokio::time::timeout`.
- **Skip** the small-model-distillation stage and the 15-min cache initially — research explicitly recommends deferring both (§5.7: distillation needs a second model call/added latency; OpenCode ships without either and is "perfectly serviceable").
- Reuse the existing `http_client: &reqwest::Client` passed into `execute_tool` (don't construct a new client).

**Permission**: requires no special handling — `web_fetch` simply isn't `read_file`, so it falls through to the existing gated branch of `check_permission_gate` (`agent_loop.rs:221-222`) under every mode except `AutoAcceptAll`. The only discipline required is *not* adding it to the `read_file`-style exception (see the cross-cutting permission note above for exactly why that would be dangerous here specifically).

**Per-panel registration** (`agentToolDefaults.ts`): add to `WIZARD_TOOL_FILTER_DEFAULT` and `PLANS_TOOL_FILTER_DEFAULT` — research §5.7 names these two specifically ("Wizard/Plans agents routinely need to read documentation pages, API references, design inspiration"). *(Note: `web_search` itself isn't in any panel's default filter today — this plan does not change that; it only adds `web_fetch` where the research specifically justifies it, per the "no silent additions" standard.)*

---

## 2. TaskList (build second)

**Schema choice**: the research explicitly recommends the **legacy flat `TodoWrite` shape**, not the newer `Task*` CRUD-graph family, because Prototyper's agents are single-session and panel-scoped with no multi-agent coordination story (§4.7). One tool, `task_list`, rewrites the whole array per call.

**Args** (`agent/tools/task_list.rs`):
```rust
struct TaskListArgs { todos: Vec<TodoItem> }
struct TodoItem { content: String, status: TodoStatus /* pending|in_progress|completed */, active_form: String }
```

**Description**: borrow the battle-tested rules verbatim (research §4.2/§4.7 — "empirically validated across three independent frameworks, no reason to rephrase"): exactly ONE `in_progress` at a time; mark complete IMMEDIATELY, don't batch; never mark complete if tests are failing/implementation partial/errors unresolved; plus LangChain's closing line that the tool "does not deliver the answer — marking the last todo complete is not itself an answer to the user" (§4.5, addresses a documented stalling failure mode).

**Storage**: JSON sidecar, OpenCode's "delete-and-reinsert-whole-list" simplicity (§4.7) rather than a DB layer Prototyper doesn't have: `projects/{id}/.prototyper/todos/{sessionId}.json`, cleared to `[]` on full completion (matches both Claude Code's and Anthropic's documented lifecycle, §4.2/§4.7).
- **Open question to verify before implementing**: what session identifier is already available in `AgentLoopParams`/the chat plumbing to key this file by? (Plans chat history is `{slug}.chat.json` — check whether an equivalent stable ID is threaded into `agent_loop.rs` already, or whether one needs to be generated per loop invocation.)

**New `CompletionEvent` variant — `TodoUpdate`** (research §4.7 recommendation, mirrors the `AskUser`/`AskUserForm` "section-agnostic event" pattern):
- Add to the Rust enum in `commands/ai.rs:40-49` and the TS union in `ipc.ts:213-221`.
- **This changes the documented "8 variants" to 9** — `CLAUDE.md` line 77 must be updated in the same change (the doc is checked-in and load-bearing per the system prompt).
- Wire a `useChat` `onTodoUpdate` option, section-agnostic like `onAskUser`/`onAskUserForm` (CLAUDE.md:79-81 pattern — unregistered handler = no-op, not an error).

**Permission**: none — follow the verified `ask_user`/`ask_user_form` precedent at `agent_loop.rs:560-578`, which special-cases those two tools out of the gate entirely with the comment `// ask_user / ask_user_form handled here — no permission gate, no execute_tool call`. `task_list` is the same class: it has no side effects beyond writing its own sidecar JSON, never touches user files or the network.

**Per-panel registration — corrected after verifying against the actual codebase, not the research's generic framing**: research §4.7 names "the Wizard panel ... and Workflows ... both already involve long, multi-stage agent runs" as the natural first homes. **That assumption does not hold for Prototyper's Workflows**: I verified directly —
- Only five panels wire up `useChat` + a `panelToolFilter`/`*_TOOL_FILTER_DEFAULT` constant: `ThemesPanel.tsx` (`DESIGN_TOOL_FILTER_DEFAULT`), `WizardPanel.tsx`, `PlansPanel.tsx`, `ComponentsPanel.tsx`, `ScreensPanel.tsx` (`grep -rln "useChat" src/panels/`, confirmed against the five constants in `agentToolDefaults.ts`).
- Workflows has no such constant (`grep -rn "WORKFLOW.*TOOL_FILTER" src` → no matches), and **its node-execution path (`src/workflows/execution/runNode.ts:88-109`, `streamAI`) calls `generateCompletionStream` directly with a bare two-message `[system, user]` array and no `tool_filter`/`tools` argument at all** — it only ever handles `Chunk`/`Done`/`Error` Channel events (lines 95-101), never `ToolCall`/`ToolPermission`/`AskUser`. Workflow nodes are one-shot completions, not tool-using agent sessions; there is no `tool_filter` to register `task_list` (or any tool) into.
- **Resolution**: register `task_list` only in `WIZARD_TOOL_FILTER_DEFAULT` — the one panel the research names that actually has a multi-turn, tool-using agent loop with the long-session-drift problem `TaskList` addresses (§4.6, §4.7, citing Anthropic's "Seeing like an agent" rationale in §4.4). Do not invent a Workflows registration that the panel's architecture cannot support.

---

## 3. Skill (build third)

**Args** (`agent/tools/skill.rs`): `{ skill: String, args: Option<String> }` — Claude Code's two-field shape (research §3.2), simplest of the variants surveyed.

**Description**: adapt Claude Code's verbatim framing (§3.2): "Execute a skill — a reusable, file-based instruction bundle. When the user's request matches an available skill (including '/<name>' references), invoke it with this tool before responding."

**Discovery & layout** (research §3.4/§3.6 — maps cleanly onto Prototyper's existing per-project markdown infrastructure):
- `projects/{id}/.prototyper/skills/<name>/SKILL.md`, one directory per skill.
- Required frontmatter: `name` (kebab-case, ≤64 chars, must match directory name) and `description` (≤1024 chars).

**Frontmatter parsing — deliberately hand-rolled, not a new YAML dependency**: the frontend's `frontmatter.ts` uses `js-yaml` (TS-side, not portable to Rust), and Skill frontmatter per the open standard is just 2 required + a few optional flat string fields (no nesting, no lists beyond `allowed-tools`). Adding a Rust YAML crate for this is disproportionate — `serde_yaml` is deprecated upstream, and its replacements are immature. A small line-based `key: value` parser (split on `---` fences, then `:` per line, matching the subset of YAML the spec actually requires) is the "reduce and do it with less" option coding-standards.md prefers over a heavyweight dependency for a 2-field schema. Document this reasoning inline as a comment citing the spec's frontmatter shape.

**Execution**: read `SKILL.md`, do simple `$ARGUMENTS` string substitution, return the body as the tool's `output` string (not as a special "inject as conversation message" path — that would require new agent-loop plumbing the research doesn't show is necessary; returning it as plain tool output achieves the same practical effect — the model reads the instructions in the tool result and follows them — with zero new wiring). No new Tauri command needed: the agent loop runs server-side in Rust and reads the file directly via `tokio::fs`, no IPC roundtrip.

**Permission**: none — `skill` only ever reads `SKILL.md` files inside `projects/{id}/`, the same operation class as `read_file`, which `check_permission_gate` (`agent_loop.rs:221`) treats as silent under `AutoAcceptReadOnly` and which is allowlistable under `AskEveryTime` like any other tool. It needs no special-case of its own — the existing gate logic already produces the right behavior for a read-only tool without modification.

**Per-panel registration**: `WIZARD_TOOL_FILTER_DEFAULT`, `PLANS_TOOL_FILTER_DEFAULT`, `SCREENS_TOOL_FILTER_DEFAULT` — research §3.6 frames skills as "reusable generation recipes" (e.g. "scaffold a CRUD API + screen pair"), squarely the Wizard/Screens use case, and Plans already owns the markdown/frontmatter infrastructure this reuses.

---

## 4. ToolSearch (build fourth)

**Mechanism** (research §2.5 recommendation, applied at Prototyper's actual scale):
- Add a `defer: bool` flag (or a parallel `HashSet<String>` of deferred names) alongside `ToolInfo` construction in `build_tools()`.
- **Scoping decision**: rather than deferring all ~20 tools (the research's "once the catalog crosses 25-30" framing doesn't strictly apply yet at 20), defer *only the four heaviest/least-frequently-needed new tools* — `web_fetch`, `skill`, `task_list`, `lsp` — while keeping the original 15 plus `tool_search` itself always-loaded. This directly targets the stated motivation ("let Wizard/Plans/Screens register more capability without paying for it in every system-prompt prefix," research §1) without deferring tools that are core to every turn.
- In `build_tools()`, emit full schemas for non-deferred tools and a lightweight `<available-deferred-tools>` block (name + one-line description) for the deferred set — **this requires a small change to where the system message / tool list is assembled** (agent_loop.rs, near where `tools_json` is built at lines 483-489): inject the block as an additional system-reminder-style message when the filtered tool set contains deferred entries. Call this out explicitly in the implementation — it's the one piece of new wiring beyond "just register another tool."

**Args** (`agent/tools/tool_search.rs`): `{ query: String, max_results: Option<u32> }` (research §2.2). Two query modes per the research, at Prototyper's scale a simple implementation suffices (no BM25 needed, §2.5): `select:name1,name2` for exact match, and a substring/token-overlap scorer (split on snake_case/whitespace, weight name matches over description matches) for fuzzy queries.

**Description**: adapt verbatim from the live `ToolSearch` description quoted in the research (§2.1) — it is independently confirmed byte-identical to Claude Code's production text, a strong basis to reuse its phrasing directly.

**Permission**: none — `tool_search` only inspects the in-memory deferred-tool list built at `agent_loop.rs:483-489`; it touches no files, processes, or network. Same no-gate class as `task_list`/`skill` above (`agent_loop.rs:560-578` precedent), and unlike `web_fetch`/`lsp` introduces no new attack surface to reason about.

**Per-panel registration**: every panel that has access to any deferred tool must also get `tool_search`, otherwise the deferred tools are unreachable — i.e., wherever `web_fetch`/`skill`/`task_list`/`lsp` are registered (Wizard, Plans, Screens, Components per the per-tool sections above).

---

## 5. LSP (build last — by far the highest engineering cost; scoped, not skipped)

The research is blunt that this is the most demanding of the five (§6.7: "no mature Rust LSP client crate, server-lifecycle management, response-simplification layer all need to be built from scratch"). Following its own "minimal viable surface" recommendation is the correct way to deliver a *real* LSP tool without over-building — not a way to avoid building it.

**Scope** (research §6.7, applied directly): TypeScript-only. A single `typescript-language-server` process per project root, spawned lazily and cached. This matches Prototyper's actual surface — it generates/edits `.tsx`/`.ts` exclusively (coding-standards.md), and already has `run_tsc`/`run_lint` as precedent for TS-tooling-as-a-subprocess.

**Operations — start with the top 3 + 1** (research §6.6/§6.7 explicitly recommends this subset over all 9): `definition`, `references`, `hover`, `documentSymbol`. `goToImplementation`, `workspaceSymbol`, call-hierarchy ops are deliberately deferred to a later iteration per the cited "lower-frequency nice-to-haves" framing — this is the research's own scoping advice, applied, not an invented reduction.

**Args** (`agent/tools/lsp.rs`): discriminated union over `operation` (4 literals for the MVP set), each requiring `{ filePath: String, line: u32, character: u32 }` (1-based, matching what the model sees in numbered file listings — research §6.3.1). Use `#[serde(tag = "operation")]` with `schemars` enum support, as the research notes two major frameworks converged on exactly this shape.

**Client — hand-rolled, not a framework dependency** (research §6.5): no mature off-the-shelf Rust LSP *client* crate exists (`tower-lsp`/`lsp-server` are server-side only; `async-lsp` is framed as "best candidate" at 810K downloads but the research itself validates that "a ~150-line hand-rolled client is realistic and avoids depending on an immature crate"). Build: `lsp-types` for message shapes/serde + a minimal JSON-RPC-over-stdio loop using `tokio::process::Command` + `tokio::io::{BufReader, AsyncWriteExt}` + `serde_json` (`Content-Length` header framing — the LSP wire format is simple enough to hand-roll safely). This is the more conservative choice and is explicitly endorsed as realistic by the research, not a corner cut.

**Coordinate translation + response simplification — both mandatory, not optional** (research §6.3, §6.7: "without both, the tool will be either unusable or token-expensive"):
- 1-based↔0-based translation at the boundary (`agent/executor/lsp/client.rs`).
- Port Claude Code's `formatters.ts` approach (§6.3.2) in `agent/executor/lsp/formatters.rs`: collapse `Location[]`/`Hover`/`SymbolInformation` into terse prose — "Defined in `relative/path.ts:42:5`", "Found N references across M files:\n<file>:\n  Line L:C ..." — grouped by file, `file://` URIs converted to project-relative paths, malformed entries filtered and logged rather than surfaced.

**Server lifecycle** (`agent/executor/lsp/mod.rs`, research §6.4): lazy spawn, cache by project root in a new `AppState` field `lsp_servers: Mutex<HashMap<PathBuf, LspServerHandle>>` (mirrors the existing `bonsai_process`/`active_processes` pattern in `lib.rs:14-32` — long-lived child processes already have precedent). Send `textDocument/didOpen` before every query (easy to forget, must be transparent to the tool layer per §6.4).

**Sandboxing / spawn model**: per the cross-cutting note above — run unsandboxed but workspace-scoped via the LSP protocol's own `rootUri`, gated by (a) a `ToolPermission` prompt the first time it's spawned per project and (b) a new Settings toggle (e.g. `settings.lspEnabled`, default **off**) with lazy `isLspConnected()`-style enablement (research §6.7's explicit recommendation — "should never be silently always-on" because language servers are heavyweight and slow to cold-start).

**Per-panel registration**: `SCREENS_TOOL_FILTER_DEFAULT`, `COMPONENTS_TOOL_FILTER_DEFAULT` — research §6.7 names these two specifically ("dramatically better navigation than grep/glob for 'where is this component used,' 'what does this prop type look like'").

---

## Summary of new surface area (for review focus)

| Category | New items |
|---|---|
| Cargo deps | `htmd`, `lsp-types` |
| `AppState` fields | `lsp_servers: Mutex<HashMap<PathBuf, LspServerHandle>>` |
| `CompletionEvent` variants | `TodoUpdate` (8 → 9; **CLAUDE.md must be updated**) |
| New Tauri/IPC commands | none (Skill reads files server-side; TaskList persists to a sidecar the agent loop writes directly; LSP lifecycle is internal to the agent loop) |
| New Settings fields | `lspEnabled` (bool, default off) |
| New files | `agent/tools/{mod,web_fetch,task_list,skill,tool_search,lsp}.rs`, `agent/executor/{web_fetch,task_list,skill,tool_search}.rs`, `agent/executor/lsp/{mod,client,formatters}.rs` |
| Files restructured | `tools.rs` → `agent/tools/mod.rs` (re-export + compose); `tools.rs`'s 15 existing tool defs move into a sibling module unchanged (re-exported, so no import-path breakage per coding-standards "Re-export from barrel files") |
| `agentToolDefaults.ts` changes | `web_fetch` → Wizard, Plans · `task_list` → Wizard *(only — Workflows has no tool-using chat, see §2 correction)* · `skill` → Wizard, Plans, Screens · `tool_search` → Wizard, Plans, Screens, Components · `lsp` → Screens, Components |

---

## Verification

1. `bunx tsc --noEmit` and `cargo check` (via the existing `bun_dev`/sandbox tooling) after each tool lands — type-checking catches schema/IPC mismatches early (especially the `CompletionEvent` 9th-variant change, which must compile identically on both sides).
2. Manual agent-loop smoke test per tool, in build order, using `bun run tauri:dev`:
   - **WebFetch**: ask an agent (in a panel where it's registered) to fetch a known public doc page; confirm the `ToolPermission` prompt appears, the SSRF blocklist rejects a `http://169.254.169.254/` test URL, and markdown comes back under the 5MB/30s caps.
   - **TaskList**: drive a multi-step Wizard task; confirm the sidecar JSON is written/cleared correctly and the `TodoUpdate` event renders in the UI (or is silently no-op'd where unregistered).
   - **Skill**: author a trivial `SKILL.md`, confirm discovery, frontmatter validation (including a deliberately malformed one), and `$ARGUMENTS` substitution.
   - **ToolSearch**: confirm deferred tools appear only as names in the system prompt, `select:` and keyword queries both resolve schemas, and the resolved tool is then callable.
   - **LSP**: with `lspEnabled` on, run `goToDefinition`/`findReferences`/`hover`/`documentSymbol` against a known Prototyper `.tsx` file; confirm 1-based coordinates round-trip correctly and output is prose, not raw JSON-RPC.
3. Confirm `cargo clippy`/eslint are clean (no `any`, no dead code, no disabled lint rules) per coding-standards.md.
