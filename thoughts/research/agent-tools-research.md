# Agent Tools Research: ToolSearch, TaskList, WebFetch, Skill, and LSP

**Date:** 2026-06-07
**Scope:** Design research for five candidate tools to add to Prototyper's AI agent tool catalog (`src-tauri/src/agent/tools.rs` / `executor.rs`), informed by how Claude Code, OpenCode, the official Claude API, Pi, Serena, and other agent frameworks implement equivalent capabilities.
**Primary reference:** https://github.com/tanbiralam/claude-code/tree/main/src/tools (a reverse-engineered extraction of Claude Code's internal tool definitions — corroborated against independent leak repos and Anthropic's own documentation throughout)

---

## 1. Why this matters for Prototyper specifically

Prototyper's agent system (`src-tauri/src/agent/tools.rs:160-296`) currently registers 15 tools through a single `build_tools() -> Vec<ToolInfo>` function, each with a hand-written description and a `schemars`-derived JSON schema. `agent_loop.rs:477-481` then filters this global list down per-panel via a `tool_filter: HashSet<String>` (see `agentToolDefaults.ts` — Wizard gets 14 tools, Plans gets 7, etc.). This is *exactly* the architecture that the research below shows starts to strain once a tool catalog grows past roughly 30–50 entries: Anthropic's own engineering team documents that "Claude's ability to correctly pick the right tool degrades significantly once you exceed 30–50 available tools" and that a modest 5-server MCP setup can burn ~55K tokens of context on schema definitions alone before any work happens [21][22]. Every tool researched here — `ToolSearch`, `Skill`, `TaskList`/`Task*`, `WebFetch`, and `LSP` — is, in one way or another, a response to that same context-budget pressure: they either (a) let the model discover/load capabilities lazily instead of upfront (`ToolSearch`, `Skill`), (b) externalize planning state outside the rolling context window (`TaskList`), or (c) compress an otherwise-enormous payload (a web page, an LSP response) into something token-economical before it reaches the model (`WebFetch`, `LSP`).

All five are also unusually good fits for Prototyper's `tool_filter` design: because tools are already filtered per-panel from one global registry, adding a `ToolSearch`-style indirection layer would let the Wizard/Plans/Screens agents register *more* capability without paying for it in every system-prompt prefix — directly addressing the "55K tokens before any work happens" problem as the catalog grows toward APIs, Bonsai, and Workflows-aware tools.

---

## 2. ToolSearchTool

### 2.1 What it is and why it exists

The Tool Search Tool is Anthropic's mechanism for letting a model "work with hundreds or thousands of tools by dynamically discovering and loading them on-demand," instead of loading every tool definition into the context window upfront [1][21]. It is now a first-class, documented server-side feature of the Claude API (`tool_search_tool_regex_20251119` and `tool_search_tool_bm25_20251119`) [21], but — notably — Claude Code shipped an internal predecessor of it first, named simply `ToolSearch`, whose description string is:

> "Fetches full schema definitions for deferred tools so they can be called. Deferred tools appear by name in `<system-reminder>` messages. Until fetched, only the name is known — there is no parameter schema, so the tool cannot be invoked. This tool takes a query, matches it against the deferred tool list, and returns the matched tools' complete JSONSchema definitions inside a `<functions>` block... Query forms: 'select:Read,Edit,Grep' — fetch these exact tools by name; 'notebook jupyter' — keyword search, up to max_results best matches; '+slack send' — require 'slack' in the name, rank by remaining terms" [1]

(This description is independently verifiable: it is *byte-identical* to the live `ToolSearch` deferred-tool description that appeared in this very research session's system reminders — strong first-hand confirmation that the `tanbiralam/claude-code` extraction reflects Claude Code's actual, current production prompt text.)

### 2.2 Schema

Internal Claude Code version (Zod) [1]:
```ts
z.object({
  query: z.string().describe('Query to find deferred tools. Use "select:<tool_name>" for direct selection, or keywords to search.'),
  max_results: z.number().optional().default(5).describe('Maximum number of results to return (default: 5)'),
})
// output: { matches: string[], query: string, total_deferred_tools: number, pending_mcp_servers?: string[] }
```

Official API version — declarative, attached at the `tools` array level rather than invoked as a callable function with a free-form schema [21]:
```json
{"type": "tool_search_tool_regex_20251119", "name": "tool_search_tool_regex"}
{"type": "tool_search_tool_bm25_20251119", "name": "tool_search_tool_bm25"}
```
with individual tool entries marked `"defer_loading": true`.

### 2.3 How it works end to end

1. Tools are marked deferred (`defer_loading: true` in the public API; in Claude Code internally, a tool is deferred if `tool.isMcp === true` or `tool.shouldDefer === true`, unless it opts out via `tool.alwaysLoad === true`) [1][21].
2. The model initially sees only tool *names* for deferred tools (surfaced via `<system-reminder>`/`<available-deferred-tools>` blocks), plus full schemas for non-deferred "always-on" tools.
3. The model calls the search tool with either an exact-name query (`"select:Read,Edit,Grep"`) or a fuzzy query (regex for `tool_search_tool_regex`, natural-language for `tool_search_tool_bm25`, or Claude Code's internal custom keyword scorer over name-parts/descriptions/a `searchHint` field) [1][21].
4. The API/harness returns 3–5 best matches as `tool_reference` content blocks, which are then **automatically expanded into full JSON-Schema tool definitions** before the model uses them [1][21].
5. Critically, deferred tools are *not* included in the cached system-prompt prefix — expansion happens inline in the conversation, so **prompt caching is preserved** [21].

### 2.4 Measured impact and rationale (quantified)

Anthropic's engineering blog states plainly: "That's 58 tools consuming approximately 55K tokens before the conversation even starts... At Anthropic, we've seen tool definitions consume 134K tokens before optimization" and that tool search "typically reduces this by over 85%, loading only the 3-5 tools Claude actually needs for a given request" [22]. On internal MCP evaluations, enabling Tool Search Tool improved Opus 4 from 49%→74% accuracy and Opus 4.5 from 79.5%→88.1% [21][22]. The most common failure mode without it: "wrong tool selection and incorrect parameters, especially when tools have similar names like `notification-send-user` vs. `notification-send-channel`" [22] — a problem Prototyper will face directly as `web_search`, prospective `web_fetch`, and any future API/Bonsai tools accumulate in `build_tools()`.

### 2.5 Implementation recommendation for Prototyper

Given that `build_tools()` already centralizes all tool definitions and `agent_loop.rs` already filters by name into a `HashSet<String>`, a Rust-side `ToolSearch` is a natural extension rather than a rewrite:

- Add an optional `defer: bool` flag alongside each `ToolInfo` (or a parallel `HashSet<String>` of deferred names) in `tools.rs`.
- In `build_tools()`, only emit full schemas for non-deferred tools; emit a lightweight `<available-deferred-tools>` block (name + one-line description) for the rest — this is cheap because Prototyper already constructs the system message per-turn.
- Implement `execute_tool_search` in `executor.rs` with the same two query modes Claude Code uses: `select:name1,name2` (exact match against the deferred set) and keyword scoring (split on snake_case/whitespace, weight name matches over description matches — no need for full BM25; a simple substring/token-overlap scorer is sufficient at Prototyper's scale of ~15-30 tools).
- Return matches as plain JSON listing name+description+schema (Prototyper doesn't need the `tool_reference` indirection that the Claude API uses for prompt-cache preservation — `ollama-rs`'s `ToolInfo` doesn't have an equivalent caching concern at this scale, and Prototyper already rebuilds `all_tools` fresh each turn at `agent_loop.rs:477`).
- This is most valuable once Prototyper's catalog grows past ~25-30 tools (it's at 15 now) — e.g., once `web_fetch`, `lsp`, Bonsai-asset tools, and Workflow-graph tools are all registered globally. At 15 tools it's not yet necessary, but adding the *plumbing* now (the `defer` flag and filter logic) costs little and pays off as the catalog grows.

---

## 3. SkillTool

### 3.1 What it is, and how it differs from a "tool"

A Skill is fundamentally different from a callable tool: it is a **file-based, reusable instruction/knowledge bundle** — a directory containing a `SKILL.md` (markdown procedural guidance) plus optional bundled scripts, templates, and reference files — that the model loads into its context and then *follows*, using its existing tools to do the actual work [4][5][24][25]. As Anthropic frames it: a skill is what you reach for "when you keep pasting the same instructions, checklist, or multi-step procedure into chat, or when a section of CLAUDE.md has grown into a procedure rather than a fact" [24]. Functionally, the dispatcher (`SkillTool`/`skill`) is thin — its input schema is just `{ name: string, args?: string }` — and its job is to locate the bundle, optionally fork a subagent to run it, and inject its (possibly templated/shell-preprocessed) markdown content as a conversation message [4][13].

This is governed by the **Agent Skills open standard** (https://agentskills.io [26]), originally developed by Anthropic and now adopted by ~30 agent products including Claude Code, OpenCode, Cursor, Amp, Roo Code, Goose, GitHub Copilot, OpenAI Codex, Gemini CLI, Letta, and **Pi** (`badlogic/pi-mono`) [26][27].

### 3.2 Verbatim descriptions and schemas

Claude Code's `Skill` tool [4]:
> "Execute a skill within the main conversation. When users ask you to perform tasks, check if any of the available skills match... When users reference a 'slash command' or '/<something>' (e.g., '/commit', '/review-pr'), they are referring to a skill. Use this tool to invoke it... Important: Available skills are listed in system-reminder messages... When a skill matches the user's request, this is a BLOCKING REQUIREMENT: invoke the relevant Skill tool BEFORE generating any other response about the task. NEVER mention a skill without actually calling this tool."

```ts
z.object({
  skill: z.string().describe('The skill name. E.g., "commit", "review-pr", or "pdf"'),
  args: z.string().optional().describe('Optional arguments for the skill'),
})
```

OpenCode's `skill` tool description (full text) [13]:
> "Load a specialized skill when the task at hand matches one of the skills listed in the system prompt. Use this tool to inject the skill's instructions and resources into current conversation. The output may contain detailed workflow guidance as well as references to scripts, files, etc in the same directory as the skill. The skill name must match one of the skills listed in your system prompt."

```ts
Schema.Struct({ name: Schema.String.annotate({ description: "The name of the skill from available_skills" }) })
```

### 3.3 Progressive disclosure — the core design mechanic

Both the Agent Skills standard and Anthropic's API docs describe an identical three-tier loading model [25][26]:

| Level | When loaded | Token cost | Content |
|---|---|---|---|
| 1: Metadata | Always, at startup | ~100 tokens/skill | `name` + `description` from YAML frontmatter |
| 2: Instructions | When triggered | <5K tokens | Full `SKILL.md` body |
| 3: Resources | As needed | "effectively unlimited" | Bundled scripts (executed via bash — only their *output* enters context) and reference files (read individually on demand) |

agentskills.io frames the same idea as "Discovery → Activation → Execution" [26]. Claude Code enforces this with hard budgets: skill *listings* get only "1% of the context window (in characters)" (`SKILL_BUDGET_CONTEXT_PERCENT = 0.01`), individual descriptions are truncated to 250 chars in the listing, and the combined description+`when_to_use` is capped at 1,536 chars — with the rationale spelled out in a source comment: "The listing is for discovery only — the Skill tool loads full content on invoke, so verbose whenToUse strings waste turn-1 cache_creation tokens without improving match rate" [4][24].

### 3.4 File layout and frontmatter (the part that's directly portable to Prototyper)

Per the open standard and Claude Code/OpenCode docs [4][13][24][26]:
- A skill is a directory containing a required `SKILL.md`.
- Required frontmatter: `name` (regex `[a-z0-9]+(-[a-z0-9]+)*`, ≤64 chars, must match the directory name) and `description` (≤1024 chars).
- Discovery paths follow a convention-over-configuration pattern: `.claude/skills/<name>/SKILL.md` (project), `~/.claude/skills/<name>/SKILL.md` (personal), with OpenCode additionally checking `.opencode/skills/`, `.agents/skills/`, walking up from cwd to the git worktree root [13][24].
- Optional frontmatter fields control visibility and execution: `disable-model-invocation` (user-only), `user-invocable: false` (model-only), `context: fork` (run as a subagent), `allowed-tools`/`disallowed-tools` [24].

### 3.5 Pi's implementation (the user-named reference)

The "Pi" CLI agent is `badlogic/pi-mono` (a "minimal terminal coding harness," listed as an Agent Skills adopter at agentskills.io). Its `skills.ts` faithfully implements the open standard — `MAX_NAME_LENGTH = 64`, `MAX_DESCRIPTION_LENGTH = 1024` with the comment "Max name length per spec," the same kebab-case validation, and the same `disable-model-invocation` frontmatter field [27]. It discovers skills from `~/.pi/agent/skills/`, `.pi/skills/`, and `.agents/skills/`, with the rule: "if a directory contains SKILL.md, treat it as a skill root and do not recurse further" [27]. Notably, **Pi has no `ToolSearch`-equivalent** — its tool catalog (`read`, `write`, `edit`, `bash`, `grep`, `find`, `ls`, plus extension-registered tools) loads statically [27]. This confirms Skills and tool-search are *independent* mechanisms that frameworks adopt separately based on need.

### 3.6 Implementation recommendation for Prototyper

Skills map unusually well onto Prototyper's existing concepts:

- Prototyper already has per-project markdown assets (`projects/{id}/plans/{slug}.md`) and a Plans panel built around markdown + frontmatter parsing (`lib/markdown/frontmatter.ts`, `directives.ts`). A `skill` tool would reuse that exact infrastructure: store skills at `projects/{id}/.prototyper/skills/<name>/SKILL.md` (or a global `~/.config/prototyper/skills/`), parse frontmatter with the existing `frontmatter.ts` utilities, and inject the body as a message — no new markdown pipeline needed.
- Add a Rust command `list_skills`/`load_skill` (in `read_dir`/`read_file` style) and a thin `SkillArgs { name: String, args: Option<String> }` tool whose executor reads the `SKILL.md`, does simple `$ARGUMENTS` substitution, and returns the body as `written_content`-style output for the agent loop to splice into the conversation.
- This gives users a way to encode reusable workflows — e.g., "generate a themed screen following our design system," "scaffold a CRUD API + screen pair" — as editable markdown files, *without* writing Rust code or new tool registrations. That's a meaningfully lower-friction extension point than adding new `ToolInfo` entries to `build_tools()`.
- Given Prototyper's `panelToolFilter` design, skills could be scoped per-panel the same way (a `skills/` subdirectory per panel, or a `panels` frontmatter field) — directly analogous to how Claude Code scopes skills via plugin/project/personal precedence [24].

---

## 4. TaskListTool

### 4.1 The headline finding: Anthropic has already replaced TodoWrite with Task* tools

This is the single most important finding for anyone building a "TaskList" tool today. Anthropic's official Agent SDK docs state: **"As of TypeScript Agent SDK 0.3.142 and Claude Code v2.1.142, sessions use the structured Task tools `TaskCreate`, `TaskUpdate`, `TaskGet`, and `TaskList` instead of `TodoWrite`"** [9]. The user's own framing — "TaskListTool" — names the *current*, not legacy, primitive; this report covers both because (a) `TodoWrite` is still by far the best-documented and most copied design across the ecosystem, and (b) the migration story itself is the most instructive part of the research.

### 4.2 TodoWrite — the original design (for context and because most clones still use it)

Claude Code's `TodoWrite` description (verbatim, independently corroborated byte-for-byte by a second leak repo tagged `ccVersion: 2.1.84` [10][11]):

> "Use this tool to create and manage a structured task list for your current coding session... ## When to Use This Tool: 1. Complex multi-step tasks - When a task requires 3 or more distinct steps... 6. When you start working on a task - Mark it as in_progress BEFORE beginning work. Ideally you should only have one todo as in_progress at a time... ## When NOT to Use This Tool: 1. There is only a single, straightforward task... NOTE that you should not use this tool if there is only one trivial task to do."

It embeds five fully worked `<example>` blocks with `<reasoning>` sub-blocks, and a "Task States and Management" section with hard rules: *exactly* one `in_progress` at a time, mark complete "IMMEDIATELY... don't batch completions," and — critically — never mark complete if "Tests are failing / Implementation is partial / You encountered unresolved errors" [10].

Schema [10][11]:
```ts
z.strictObject({ todos: z.array(z.object({
  content: z.string().min(1),                                    // imperative: "Run tests"
  status: z.enum(['pending', 'in_progress', 'completed']),
  activeForm: z.string().min(1),                                 // present-continuous: "Running tests"
})) })
```

Implementation notes from the reverse-engineered source: state lives in-memory keyed by session/agent ID, and **a fully-completed list is cleared to `[]`** rather than persisted — `const newTodos = allDone ? [] : todos` [10]. (Independent confirmation: Anthropic's own lifecycle description says todos are "Removed when all tasks in a group are completed" [9] — exact match.) An alternate analysis of Claude Code's reverse-engineered binary additionally found a JSON-file persistence layer at `~/.claude/todos/`, framed as the model's "short-term memory," reloaded via system-reminder injection each turn [14] — possibly a different build/version than the in-memory variant, but both agree on *purpose*.

### 4.3 The successor: TaskCreate / TaskUpdate / TaskGet / TaskList

Anthropic's official migration table (verbatim reproduction) [9]:

| With `TodoWrite` | With Task tools |
|---|---|
| One tool call rewrites the full `todos` array | `TaskCreate` adds one item, `TaskUpdate` patches one item by `taskId` |
| Item shape: `{ content, status, activeForm }` | `TaskCreate`: `{ subject, description, activeForm?, metadata? }`; `TaskUpdate`: `{ taskId, status?, subject?, description?, activeForm?, addBlocks?, addBlockedBy?, owner?, metadata? }` |
| `status` is `pending`/`in_progress`/`completed` | same three, **plus `"deleted"`** |

Quoted directly: "The assigned task ID is not in the `TaskCreate` input. It comes back in the matching `tool_result` as `{ task: { id, subject } }`" and "`TaskList` and `TaskGet` are available for the model to read back the current list" [9]. The decisive new capability is **cross-agent coordination** — `owner`, `addBlocks`/`addBlockedBy` dependency links — turning a private per-session scratchpad into a shared task graph multiple subagents can read and mutate [9].

### 4.4 Why the migration happened — the most important design-rationale source found

Anthropic's own engineering post "Seeing like an agent" explains *both* why `TodoWrite` was added and why it had to be replaced [16]:

> "we realized that the model needed a todo list to keep it on track. Todos could be written at the start and checked off as the model did work... we inserted system reminders every 5 turns that reminded Claude of its goal."

But then, as models got smarter, the same mechanism became a liability:

> "Being sent reminders of the todo list made Claude think that it had to stick to the list instead of modifying it when it realized it needed to change course... As model capabilities increase, the tools that your models once needed might now be constraining them. It's important to constantly revisit previous assumptions on what tools are needed."

This is a first-party admission that a rigid, single-call-rewrites-everything todo tool can cause *over-adherence* drift — the mirror image of the under-planning problem it was built to solve. The `Task*` family's per-item create/update/delete granularity is the direct fix.

### 4.5 How other frameworks implement the same idea (and where they diverge)

| Framework | Tool name(s) | Item fields | Status enum | Storage |
|---|---|---|---|---|
| Claude Code (legacy) | `TodoWrite` | `content`, `status`, `activeForm` | pending/in_progress/completed | in-memory, cleared on completion [10] |
| Claude Code (current ≥ v2.1.142) | `TaskCreate/Update/Get/List` | `subject`, `description`, `activeForm?`, `metadata?`, `owner`, dependency links | + `deleted` | per-item, cross-agent [9] |
| OpenCode | `todowrite` (+ separate `task` for subagent dispatch) | `content`, `status`, **`priority`** (high/med/low) | + `cancelled` | **SQL DB table** (Drizzle ORM `TodoTable`), full delete+reinsert per call, `todo.updated` event bus [12][13] |
| Cline | `task_progress` (a *parameter*, "Focus Chain") | free-text markdown checklist `- [ ]`/`- [x]` | binary checked/unchecked | **markdown file on disk**, file-watcher synced, user-editable [15] |
| LangChain/LangGraph | `write_todos` (middleware) | `content`, `status` | pending/in_progress/completed (explicitly allows **multiple** in_progress for parallel work — a notable divergence) | in-memory `PlanningState.todos` [17][18] |

Two divergences are worth calling out specifically:

1. **OpenCode persists to a real database table** rather than memory or files, broadcasting a `todo.updated` event for the UI [12] — directly analogous to how Prototyper could persist task state alongside its existing per-project file-based persistence model.
2. **Cline rejected structured JSON entirely** in favor of a markdown checklist *parameter* (`task_progress`) embedded in normal tool calls, persisted as an actual `.md` file watched via `chokidar` so users can hand-edit it [15]. This trades schema rigor for human-editability and git-diffability — an interesting alternative for a desktop app like Prototyper where users already interact with markdown plans.
3. **LangChain explicitly permits multiple `in_progress` items** ("you can have multiple tasks in_progress at a time if they are not related to each other and can be run in parallel") [17] — a deliberate relaxation of Claude Code's "exactly one" rule, and worth considering for Prototyper's Workflows panel where parallel branches are a first-class concept.

LangChain's `write_todos` also adds a closing instruction that addresses a documented failure mode (agents stopping after writing the list instead of answering): *"`write_todos` tracks your work; it does not deliver the answer... Marking the last todo complete is not itself an answer to the user"* [18] — worth incorporating verbatim into any Prototyper tool description.

### 4.6 General design rationale (why add this at all)

Beyond the Anthropic source above, a Towards Data Science analysis frames todo-tools as giving agents "persistent memory outside the context window," addressing "the challenge of retaining relevant information over extended interactions" [19]. An analysis of Claude Code's prompt-engineering notes that the `TodoWrite` reminder appears *both at the start and end* of the system prompt, "exploiting primacy and recency bias for reinforcement" [20] — and, in the same piece, that early prompt drafts which spelled out rigid 10-step workflows caused the model to "dutifully execute all 10 steps even when step 3 already answered the user's question" [20], the same over-adherence failure Anthropic later cited as the reason to retire `TodoWrite`.

### 4.7 Implementation recommendation for Prototyper

Given Prototyper already has: (a) a multi-turn `agent_loop.rs` with per-session state, (b) an `AskUser`/`AskUserForm` precedent for structured, section-agnostic UI events surfaced via the `Channel`-based streaming protocol, and (c) file-based persistence under `projects/{id}/`:

- **Schema**: start with the simple, well-trodden `{ content: string, status: enum, activeForm: string }` shape (Claude Code's legacy `TodoWrite`/LangChain's `write_todos`) rather than the full `Task*` graph — Prototyper's agents are single-session, panel-scoped, and don't yet have a multi-agent coordination story that would justify `owner`/dependency links. Add `priority` (OpenCode) only if the Workflows panel needs to signal branch ordering.
- **Storage**: persist as a small JSON sidecar next to existing per-project state (e.g., `projects/{id}/.prototyper/todos/{sessionId}.json`), mirroring OpenCode's "delete-and-reinsert-whole-list" simplicity rather than building a DB layer Prototyper doesn't otherwise have. Clear to `[]` on full completion, matching both Claude Code's and Anthropic's documented lifecycle [9][10].
- **Surfacing to the UI**: add a `CompletionEvent::TodoUpdate` variant (alongside the existing 8 in `CLAUDE.md`'s streaming protocol) so any panel can render a live progress list — this is the same "section-agnostic event, opt-in handler" pattern already used for `AskUser`/`AskUserForm`.
- **Description**: borrow directly from the well-tested verbiage — "exactly ONE in_progress at a time," "mark complete IMMEDIATELY, don't batch," "never mark complete if tests are failing / implementation partial," plus LangChain's closing reminder that the tool "does not deliver the answer." These rules are empirically validated across three independent frameworks; there's no reason to rephrase them.
- **Where to enable it**: the Wizard panel (multi-step app generation) and Workflows are the most natural first homes — both already involve long, multi-stage agent runs where drift is the dominant failure mode `TodoWrite` was built to fix [16].

---

## 5. WebFetchTool

### 5.1 What it is and how it's distinguished from web_search

`WebFetch`/`web_fetch` retrieves the full content of a *known, specific* URL (named by the user or surfacing from a prior search), as opposed to `web_search`/`WebSearch` which discovers *unknown* URLs from a query [2][3][6]. Anthropic documents that the two chain together: "Claude uses web search to locate it, then fetches the result" [6] — directly relevant since Prototyper already has `web_search` wired to a local SearXNG instance (`tools.rs:290-294`, `executor.rs:1345`); `web_fetch` is the natural complement.

### 5.2 Claude Code's WebFetch — verbatim description and pipeline

> "IMPORTANT: WebFetch WILL FAIL for authenticated or private URLs... Fetches content from a specified URL and processes it using an AI model. Takes a URL and a prompt as input. Fetches the URL content, converts HTML to markdown. Processes the content with the prompt using a small, fast model. Returns the model's response about the content... Usage notes: HTTP URLs will be automatically upgraded to HTTPS... Includes a self-cleaning 15-minute cache for faster responses when repeatedly accessing the same URL. When a URL redirects to a different host, the tool will inform you and provide the redirect URL in a special format." [2]

Schema: `{ url: string (uri format), prompt: string }`, both required [2].

The pipeline, reconstructed from the minified `cli.js` bundle [3]:
```
URL+prompt → cache hit? → return cached
           → fetch → HTML? → Turndown → Markdown
           → trusted-domain + text/markdown + <100K chars? → use directly
           → otherwise → small/fast model extracts only prompt-relevant info
           → cache result (15-min TTL, 50MB LRU) → return distilled answer to Claude
```
Concretely: a hardcoded list of ~80 trusted documentation domains (docs.python.org, developer.mozilla.org, react.dev, kubernetes.io, etc.) skip the small-model distillation step when the server returns markdown directly under a **100,000-character** threshold (`Ph2 = 1e5`); everything else — including HTML from trusted sites — goes through Turndown then a constrained "small, fast model" pass whose prompt "enforces paraphrasing, caps verbatim quotes [~125 chars], and filters injection attempts" [3][8]. This distillation step is explicitly a **prompt-injection mitigation**: "the main Claude model only sees this distilled output," never the raw page [3][8]. Same-host redirects are followed transparently; cross-host redirects are surfaced as metadata requiring a fresh tool call — a deliberate trust checkpoint [3][8].

### 5.3 OpenCode's webfetch — the most directly portable reference for a Rust port

OpenCode's `webfetch` tool description [7]:
> "Fetches content from a specified URL... Format options: 'markdown' (default), 'text', or 'html'... HTTP URLs will be automatically upgraded to HTTPS... Results may be summarized if the content is very large."

Schema (Effect/Schema) [7]:
```ts
Schema.Struct({
  url: Schema.String,
  format: Schema.Literals(["text","markdown","html"]).withDefault("markdown"),
  timeout: Schema.optional(Schema.Number),  // max 120s
})
```

Implementation specifics worth replicating directly [7]:
- Constants: `MAX_RESPONSE_SIZE = 5MB`, `DEFAULT_TIMEOUT = 30s`, `MAX_TIMEOUT = 120s`.
- **Permission gate before fetching**: `ctx.ask({ permission: "webfetch", patterns: [url], always: ["*"] })` — exactly Prototyper's existing `ToolPermission`/`resolve_tool_permission` flow.
- **Content-negotiation**: builds an `Accept` header with explicit `q=` weights per requested format (e.g., for markdown: `text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1`).
- **Cloudflare bot-detection bypass**: sends a realistic Chrome User-Agent; on `403` + `cf-mitigated: challenge`, retries with an honest `User-Agent: "opencode"` (comment: "TLS fingerprint mismatch").
- **HTML→text** via `htmlparser2`, walking the tag tree and skipping `script`/`style`/`noscript`/`iframe` via a depth counter.
- **HTML→Markdown** via `TurndownService` configured `{ headingStyle: "atx", hr: "---", bulletListMarker: "-", codeBlockStyle: "fenced" }`, with `script`/`style`/`meta`/`link` removed first.
- **No caching layer** in the tool itself (relies on the permission-gate's "always allow" memoization) and **no explicit SSRF/private-IP blocking in this file** — it leans entirely on the human-approval gate for safety [7].

### 5.4 The official Claude API web_fetch tool (server-side, declarative)

This is a fully documented, separate surface from Claude Code's client-side tool — useful as a security-model reference even though Prototyper won't be calling Anthropic's hosted version [8]:

```json
{
  "type": "web_fetch_20250910", "name": "web_fetch",
  "max_uses": 10,
  "allowed_domains": ["example.com"], "blocked_domains": ["private.example.com"],
  "citations": { "enabled": true },
  "max_content_tokens": 100000
}
```

Its security model is the strictest of any reviewed: **"the web fetch tool can only fetch URLs that have previously appeared in the conversation context... Claude is not allowed to dynamically construct URLs"** [8] — a hard anti-exfiltration constraint that goes beyond domain allowlisting. The docs also explicitly warn about **homograph attacks** ("`аmazon.com` [Cyrillic а] vs `amazon.com`... recommends ASCII-only domains, testing for Unicode-normalization differences") [8] and document a full error taxonomy (`url_too_long` >250 chars, `url_not_allowed`, `unsupported_content_type` — only text and PDF, `max_uses_exceeded`, etc.) returned as HTTP 200 with structured error bodies [8]. Token-cost guidance is concretely quantified: "Average web page (10 kB): ~2,500 tokens; Large documentation page (100 kB): ~25,000 tokens" [8].

### 5.5 SSRF and security — the part Prototyper must get right in Rust

Because Prototyper's `bash` tool is already explicitly sandboxed to block network access (`tools.rs:36`), `web_fetch` would be the *first* tool in the agent catalog with outbound network capability beyond `web_search` (which only talks to a user-configured local SearXNG). That makes its security posture the most consequential design decision here. Documented best practices [9-style source — PipeLab SSRF guide, 28]:

- **Resolve DNS yourself and pin the connection to the validated IP** — prevents TOCTOU DNS-rebinding where the validation sees one IP and the connection uses another [28].
- **Block by resolved IP, not hostname**, against documented CIDR ranges: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` (link-local **and cloud metadata** — e.g. AWS `169.254.169.254`), `127.0.0.0/8`, `100.64.0.0/10`, plus IPv6 `fc00::/7`, `fe80::/10`, `::1/128`, **and the easy-to-miss IPv6 metadata path** `fd00:ec2::254` [28].
- **Scheme allowlist**: http/https only — explicitly reject `file://`, `gopher://` [28].
- **Canonicalize before validating**: decode percent-encoding, normalize numeric-IP forms (octal/hex/decimal), strip trailing dots — "if the policy parser sees one URL and the connection parser sees another, the policy is meaningless" [28].

### 5.6 Rust implementation path — concrete crate recommendations

The most rigorous comparison found is Evan Schwartz's benchmark of 13 Rust HTML-extraction crates [29], which found several "catastrophically" bad (`html2md` produced output 100× larger than the source) and recommends two finalists:
- **`fast_html2md`** — built on Cloudflare's `lol_html` streaming rewriter, "extremely low memory usage" (5–6KB regardless of input size), the closest Rust analog to Turndown [29].
- **`dom_smoothie`** — a Readability-style content extractor, recommended "when excluding headers and extraneous elements is critical," closer to Mozilla Readability's "reader mode" [29].

The practical recommendation synthesized from the JS-ecosystem pattern (Readability for extraction + Turndown for conversion, used by both Claude Code and the popular MCP "Read Website Fast" server [11]) is to **combine the two**: `dom_smoothie`/`scraper` for main-content extraction, then `htmd` or `fast_html2md` (both explicitly "Turndown-inspired") for markdown conversion [29].

### 5.7 Implementation recommendation for Prototyper

This tool is the most immediately implementable of the five — Prototyper already has `reqwest` (with `json`/`stream` features), `tokio`, and a precedent for HTTP-based tools (`execute_web_search` at `executor.rs:1345`). Concretely:

- **New `WebFetchArgs { url: String, prompt: String }`** (Claude Code's two-field shape is simpler and more token-economical than OpenCode's three-field one, and the `prompt` field doubles as the basis for any future distillation step).
- **Reuse the existing permission-gate machinery** (`resolve_tool_permission`/`ToolPermission` event) the way OpenCode gates every fetch — this is *more* important here than for any other prospective tool, since it's the first tool with general outbound network access.
- **Implement SSRF protection at the `reqwest` layer**: resolve the host via `tokio::net::lookup_host`, validate against the documented CIDR blocklist (a `regex`/manual range-check is sufficient — no new crate needed beyond what's in `Cargo.toml`), then connect to the validated IP directly (e.g. via a custom `reqwest::dns::Resolve` implementation that pins the resolved address) — this closes the TOCTOU gap that OpenCode's implementation explicitly leaves open [7][28].
- **HTML→Markdown**: add `htmd` (smallest dependency footprint, explicitly "turndown.js inspired," matches the conversion style both reference implementations converged on) [29]. Skip the small-model-distillation stage initially (it requires routing through a second model call, adding latency/cost); OpenCode ships without it and is a perfectly serviceable reference. Revisit distillation only if prompt-injection-from-fetched-content becomes an observed problem.
- **Cap aggressively**: mirror OpenCode's `MAX_RESPONSE_SIZE = 5MB` and `DEFAULT_TIMEOUT = 30s` constants — both trivially expressible with `reqwest`'s `Content-Length` check + `.bytes()` length re-check, and `tokio::time::timeout`.
- **Skip caching initially** — OpenCode ships without it too, and Prototyper's per-turn `all_tools` rebuild pattern means a cache would need its own lifecycle management; add only if repeat-fetch latency becomes a measured problem.
- **Tool description**: borrow Claude Code's framing almost verbatim — "takes a URL and a prompt describing what to extract... HTTP upgraded to HTTPS automatically... read-only, does not modify files" — these phrasings are independently battle-tested across two major frameworks [2][7].

---

## 6. LSPTool

### 6.1 Surprising finding: a full LSPTool *does* exist in the reference repo

The research brief assumed Claude Code might lack a built-in LSP tool — but the `tanbiralam/claude-code` extraction contains a complete, fully-formed `LSPTool` at `src/tools/LSPTool/` (files: `LSPTool.ts`, `prompt.ts`, `schemas.ts`, `formatters.ts`, `symbolContext.ts`) [30-33]. (Caveat: this is a community reverse-engineering snapshot that may reflect an experimental/newer build rather than what ships broadly — treated here as "a real, working design found in this codebase," not "confirmed universally shipping.")

### 6.2 Verbatim description and schema

> "Interact with Language Server Protocol (LSP) servers to get code intelligence features. Supported operations: goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation, prepareCallHierarchy, incomingCalls, outgoingCalls. All operations require: filePath, line (1-based, as shown in editors), character (1-based, as shown in editors). Note: LSP servers must be configured for the file type. If no server is available, an error will be returned." [30]

Schema: a Zod `discriminatedUnion('operation', [...9 literals...])`, each variant requiring `filePath: string`, `line: positive int`, `character: positive int` — plus, in OpenCode's near-identical clone, an optional `query: string` for `workspaceSymbol` [31][35].

This exact description string also appears, nearly verbatim, in OpenCode's `lsp` tool [35] — strong evidence the two converged on (or share lineage of) the same minimal viable surface.

### 6.3 The hard problem: making LSP digestible for an LLM, and how three implementations solve it

Three distinct strategies emerged from the research, in increasing order of "LLM-nativeness":

**1. Coordinate translation at the boundary (Claude Code, OpenCode).** Both tools accept 1-based `line`/`character` (matching what a model would infer from a numbered file listing or what an editor displays), then convert to LSP's native 0-based coordinates internally — OpenCode's source shows this explicitly: `const position = { file, line: args.line - 1, character: args.character - 1 }` [34][35]. This shields the model from ever having to reason in LSP's coordinate system.

**2. Response simplification (Claude Code's `formatters.ts` — the single richest example found).** Rather than returning raw `Location[]`/`Hover`/`SymbolInformation` JSON-RPC objects, Claude Code collapses them into terse natural language: "Defined in `relative/path.ts:42:5`" for a single hit, "Found 40 references across 6 files:\n\n<file>:\n  Line 12:5..." for many — grouped by file, paths converted from absolute `file://` URIs to relative, positions converted back to 1-based for display, malformed entries filtered and logged rather than surfaced [33]. By contrast, **OpenCode's explicit `lsp` tool dumps raw `JSON.stringify(result, null, 2)`** [35] — a real, documented architectural divergence: one framework invests heavily in LLM-readable formatting, the other treats the tool as closer to a raw passthrough (relying on the model itself to parse JSON).

**3. Avoid positions altogether — symbol-name addressing (Serena).** Serena (`oraios/serena`, an MCP toolkit wrapping multiple language-server backends) sidesteps the coordinate problem entirely: its tools — `find_symbol`, `find_referencing_symbols`, `get_symbols_overview`, `replace_symbol_body`, `rename_symbol` — take a *symbol name/path* string (e.g. `"MyClass/my_method"`) rather than line/character coordinates [36][37]. This is arguably the most LLM-native design of the three, because models reason about code in terms of names and structure, not byte offsets — but it requires building a symbol-index layer on top of raw LSP, a meaningfully larger engineering investment.

### 6.4 Architecture: server lifecycle management

OpenCode's `lsp/` subsystem is the most complete reference architecture found, and it solves problems Prototyper will face directly [34]:
- **Auto-detection by extension**: a `LANGUAGE_EXTENSIONS` map of ~140 entries (`.rs`→`rust`, `.ts`→`typescript`, etc.) drives which server to spawn for a given file [34].
- **Root detection**: each language entry carries a `root: RootFunction` — e.g. `NearestRoot(["package-lock.json","bun.lockb",...])` walks up from the file to find the workspace root [34].
- **Lazy spawn + caching by `(root, serverID)`**, dedup of in-flight spawns via a `spawning: Map<string, Promise<...>>`, and a `broken` set to avoid respawn storms [34].
- **Auto-install fallback**: e.g. the `Vue` server entry runs `npm install @vue/language-server` on first use unless disabled via an env flag — directly analogous to a feature Prototyper could gate behind Settings [34].
- **JSON-RPC client** wraps `vscode-jsonrpc` over the spawned process's stdio, performs the `initialize` handshake (`rootUri`, `capabilities.workspace.configuration`, `workspaceFolders`), and **debounces diagnostics** at 150ms while deduping by a stringified `{code, severity, message, source, range}` key [34].
- Crucially, **`textDocument/didOpen`/`didChange` document-sync notifications must be sent before every query** — easy to forget, and the tool layer must handle it transparently (`lsp.touchFile()` is called before every operation in OpenCode's tool) [34][35].

For comparison, the minimal-surface alternative is `Tritlo/lsp-mcp`, which exposes only `get_info_on_location` (hover), `get_completions`, `get_code_actions`, `get_diagnostics`, plus lifecycle tools `start_lsp`/`open_document`/`close_document`/`restart_lsp_server` — deliberately omitting definition/references/document-symbol [38]. Its key architectural insight: it's launched generically as `npx lsp-mcp <language-id> <path-to-lsp-binary> <args>`, making it LSP-server-agnostic — turning an "M×N" integration problem (every client × every server) into "M+N" via a shared bridge [39].

### 6.5 The Rust crate landscape — a genuine gap to plan around

Verified directly via the crates.io API [40]:

| Crate | Purpose | Downloads | Fit for an LSP *client* |
|---|---|---|---|
| `lsp-types` | JSON-RPC type definitions only (`Location`, `Hover`, `Diagnostic`, etc.) | 25.7M | Yes — use for message shapes/serde, but it's types-only |
| `tower-lsp` | Framework for building LSP **servers** | 5.5M | No — server-side only |
| `lsp-server` | rust-analyzer's sync server scaffold | 11.3M | No — server-side, sync (crossbeam channels) |
| `async-lsp` | Tower-based async LSP framework | 810K | **Best candidate** — README explicitly states "can be used to build both Language Server and Language Client... logically symmetric" |
| `lsp-client-rs` / `lsp-client` | Dedicated client crates | ~1.6K each | Too immature (v0.1.0, low adoption) |

**Bottom line: there is no mature, widely-adopted, off-the-shelf LSP client crate in Rust** comparable to `tower-lsp` on the server side [40]. The realistic build path is: `lsp-types` (message shapes) + `async-lsp`'s `LspService`/duplex-channel abstraction (transport/framing) + `tokio::process` (spawning) — essentially hand-rolling what OpenCode does in TypeScript with `vscode-jsonrpc`, but in Rust with `lsp-types` providing the wire-format types for free.

### 6.6 The grep-vs-LSP trade-off and the minimal viable surface

The clearest framing found: "grep and ripgrep do text search... An LSP-based search understands the semantic meaning. It can distinguish between a function definition and a string that happens to contain the same word" [41]. LSP earns its complexity when an agent needs to: distinguish a definition from a textual coincidence, follow type-aware references (two unrelated classes' `handle()` methods), perform safe rename-across-codebase, or get compiler diagnostics without a full build [36][41].

Synthesizing what Claude Code's `LSPTool`, OpenCode's `lsp` tool, and Serena converge on, the highest-value methods in priority order are: **(1) `textDocument/definition`, (2) `textDocument/references`, (3) `textDocument/hover`, (4) `textDocument/documentSymbol`/`workspace/symbol`, (5) `textDocument/publishDiagnostics`/`textDocument/diagnostic`** [30][35][36]. Notably, #5 (diagnostics) is the one OpenCode treats as *automatic background context* rather than an explicit tool call — "the agent doesn't need to ask for errors, they should just appear after an edit" [34] — which maps directly onto Prototyper's existing `run_tsc`/`run_lint`/`run_build` pattern (`tools.rs:189-209`). Call-hierarchy and `goToImplementation` are lower-frequency "nice to haves"; `completion` is "largely irrelevant to an agent (autocomplete is an editor-UX feature)" [38][41].

### 6.7 Implementation recommendation for Prototyper

This is the most architecturally demanding of the five tools, and the one where Prototyper's existing constraints matter most:

- **Scope to TypeScript only, initially.** Prototyper generates and edits `.tsx`/`.ts` exclusively (per `coding-standards.md` and the existing `run_tsc`/`run_lint` tools); there's no need to build OpenCode's 140-language, auto-installing server matrix. A single, long-lived `typescript-language-server` (or `tsserver` directly) process per project, spawned lazily and cached by project root, covers the entire use case.
- **Reuse the sandbox model**: Prototyper already runs `bash`/`run_tsc`/etc. inside a `bwrap`+`landlock` sandbox (`tools.rs:36`, `executor.rs`). The LSP server process should be spawned through the same sandboxing path — it's just another child process that needs filesystem read access to the project tree.
- **Build path**: add `lsp-types` to `Cargo.toml` for message shapes, and either adopt `async-lsp` for the transport/framing layer or hand-roll a minimal JSON-RPC-over-stdio client with `tokio::process::Command` + `tokio::io::{BufReader, AsyncWriteExt}` + `serde_json` (the LSP wire format — `Content-Length` header + JSON body — is simple enough that a ~150-line hand-rolled client is realistic and avoids depending on an immature crate) [40].
- **Coordinate translation + response simplification are not optional** — without both, the tool will be either unusable (raw 0-based coordinates) or token-expensive (raw JSON-RPC dumps). Port Claude Code's `formatters.ts` approach: group references by file, convert `file://` URIs to project-relative paths, translate 0-based↔1-based at the boundary, and collapse multi-result responses into short prose summaries [33].
- **Schema**: copy the discriminated-union-by-`operation` shape directly — it's converged on independently by two major frameworks and is a good fit for `schemars`' `#[serde(tag = "operation")]` enum support.
- **Start with the top-3 methods** (`definition`, `references`, `hover`) plus `documentSymbol` — that alone gives the Screens/Components agents dramatically better navigation than `grep`/`glob` for "where is this component used," "what does this prop type look like," without the engineering cost of call-hierarchy or implementation-search.
- **Gate behind a Settings toggle and lazy `isLspConnected()`-style enablement** (matching Claude Code's `isEnabled: () => isLspConnected()` [31]) — language servers are heavyweight, slow to cold-start (rust-analyzer-class servers can take 10+ seconds to index [42]), and "can get out of sync, use significant memory... and slow down agent workflows" per OpenCode's own docs warning [34], so it should never be silently always-on.

---

## 7. Cross-cutting comparison table

| Tool | Core mechanism | Claude Code name | OpenCode name | Official API surface? | Schema complexity | Effort to add to Prototyper |
|---|---|---|---|---|---|---|
| **ToolSearch** | Lazy schema loading via deferred-tool indirection | `ToolSearch` [1] | *(none — static loading)* [27] | Yes — `tool_search_tool_{regex,bm25}_20251119` [21] | Low: `{query, max_results}` | Low — extends existing `build_tools()`/`tool_filter` plumbing |
| **Skill** | File-based instruction bundles, progressive 3-tier disclosure | `Skill` [4] | `skill` [13] | Yes — separate VM-based "Agent Skills" surface [25] | Trivial: `{name, args?}` | Medium — needs SKILL.md discovery + frontmatter parsing (reuses Plans' markdown utilities) |
| **TaskList** | Externalized plan/progress tracking outside context window | `TodoWrite` → `TaskCreate/Update/Get/List` [9][10] | `todowrite` (+ `task` for subagents) [12] | Yes — Agent SDK `Task*` family [9] | Low–Medium: array of `{content, status, activeForm}` (legacy) or per-item CRUD (current) | Low — fits existing `Channel`/event + per-project file persistence patterns |
| **WebFetch** | URL retrieval + HTML→MD conversion + (optional) distillation | `WebFetch` [2] | `webfetch` [7] | Yes — `web_fetch_{20250910,20260209}` [8] | Low: `{url, prompt}` or `{url, format, timeout}` | Medium — needs SSRF hardening (new for Prototyper's network surface) + HTML conversion crate |
| **LSP** | Language-server-backed semantic code navigation | `LSP` [30] | `lsp` (+ background diagnostics) [34][35] | No — not an Anthropic API surface | Medium: discriminated union over 9 ops × `{filePath, line, character}` | High — no mature Rust LSP client crate [40]; requires server lifecycle management |

---

## 8. Summary recommendation and suggested build order

Ranked by (value to Prototyper's actual generation workflows) ÷ (engineering cost), informed by everything above:

1. **WebFetch** — highest immediate value (the Wizard/Plans agents routinely need to read documentation pages, API references, design inspiration) and lowest *novel* engineering cost (Prototyper already has `reqwest`+`tokio`+a permission-gate precedent in `web_search`). The only genuinely new work is SSRF hardening, which is well-documented and bounded.
2. **TaskList** — second-lowest cost (fits existing `Channel`-event and file-persistence patterns almost exactly) and directly addresses a documented failure mode (long-session drift) that Prototyper's multi-step Wizard flow is squarely exposed to. Use the legacy `TodoWrite`-style flat schema; it's simpler and just as battle-tested as the newer `Task*` family for a single-agent context.
3. **Skill** — moderate cost, high leverage: turns "users want a reusable generation recipe" from a Rust-code change into an editable markdown file, and reuses the Plans panel's existing markdown/frontmatter infrastructure almost wholesale.
4. **ToolSearch** — cheapest to *plumb in* (a `defer` flag + a search executor over the existing `build_tools()` list) but only pays off once the catalog grows past ~25-30 tools; worth adding the scaffolding alongside the above three so it's ready when the catalog crosses that threshold.
5. **LSP** — highest engineering cost by a wide margin (no mature Rust client crate, server-lifecycle management, response-simplification layer all need to be built from scratch) and the value, while real, is more marginal given Prototyper's `grep`/`glob`/`run_tsc` already cover a meaningful fraction of the same need. Worth doing eventually — scoped tightly to TypeScript-only with the top 3 LSP methods — but reasonable to sequence last.

---

## 9. Sources

1. `tanbiralam/claude-code` — `ToolSearchTool` (https://github.com/tanbiralam/claude-code/blob/main/src/tools/ToolSearchTool/{ToolSearchTool.ts,prompt.ts,constants.ts})
2. `tanbiralam/claude-code` — `WebFetchTool` directory (https://github.com/tanbiralam/claude-code/tree/main/src/tools) and corroborating leak repos for the WebFetch description: https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/tool-description-webfetch.md, https://github.com/gregkonush/claude-system-prompts/blob/main/webfetch-tool-instructions.md
3. giuseppegurgone.com — "How Claude Code Eats the Web" (https://giuseppegurgone.com/claude-webfetch) — Turndown pipeline, 100K-char threshold, trusted-domain list, 15-min/50MB LRU cache reverse-engineered from `cli.js`
4. `tanbiralam/claude-code` — `SkillTool` (https://github.com/tanbiralam/claude-code/blob/main/src/tools/SkillTool/{SkillTool.ts,prompt.ts,constants.ts})
5. `tanbiralam/claude-code` — `AgentTool`/`TaskCreateTool`/`TodoWriteTool` directory context (https://github.com/tanbiralam/claude-code/tree/main/src/tools)
6. Anthropic — Web fetch tool docs (https://platform.claude.com/docs/en/agents-and-tools/tool-use/web-fetch-tool) — search+fetch chaining
7. OpenCode — `webfetch` tool source (https://raw.githubusercontent.com/sst/opencode/dev/packages/opencode/src/tool/{webfetch.ts,webfetch.txt})
8. Anthropic — Web fetch tool & Server tools docs (https://platform.claude.com/docs/en/agents-and-tools/tool-use/{web-fetch-tool,server-tools}) — schema, security model, error taxonomy, homograph warning, token-cost guidance
9. Anthropic — Agent SDK "Todo Lists" docs (https://platform.claude.com/docs/en/agent-sdk/todo-tracking, canonical: https://code.claude.com/docs/en/agent-sdk/todo-tracking) — TodoWrite→Task migration table, lifecycle
10. `tanbiralam/claude-code` — `TodoWriteTool` (https://raw.githubusercontent.com/tanbiralam/claude-code/main/src/tools/TodoWriteTool/{TodoWriteTool.ts,prompt.ts,constants.ts}, https://raw.githubusercontent.com/tanbiralam/claude-code/main/src/utils/todo/types.ts)
11. Piebald-AI — `claude-code-system-prompts` (https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/tool-description-todowrite.md) — independent byte-identical corroboration of TodoWrite prompt (ccVersion 2.1.84); also MCP "Read Website Fast" server (https://mcpservers.org/servers/just-every/mcp-read-website-fast) for Readability+Turndown pattern
12. OpenCode — `todo`/`session/todo` (https://raw.githubusercontent.com/sst/opencode/dev/packages/opencode/src/{tool/todo.ts,tool/todowrite.txt,session/todo.ts}) — DB-backed storage, event bus
13. OpenCode — `skill` tool & docs (https://raw.githubusercontent.com/sst/opencode/dev/packages/opencode/src/tool/{skill.ts,skill.txt}, https://opencode.ai/docs/skills/, https://github.com/anomalyco/opencode/blob/dev/packages/opencode/src/skill/{index.ts,discovery.ts})
14. Yuyz0112 — `claude-code-reverse` (https://github.com/Yuyz0112/claude-code-reverse, https://yuyz0112.github.io/claude-code-reverse/) — `~/.claude/todos/` persistence analysis, "short-term memory" framing
15. Cline — Focus Chain (`task_progress`) implementation (https://github.com/cline/cline — `apps/vscode/src/core/task/focus-chain/{prompts.ts,index.ts}`, `apps/vscode/src/shared/tools.ts`, `CHANGELOG.md`)
16. Anthropic/Claude — "Seeing like an agent" engineering blog (https://claude.com/blog/seeing-like-an-agent) — first-party TodoWrite→Task design rationale
17. LangChain — `TodoListMiddleware`/`write_todos` source (https://raw.githubusercontent.com/langchain-ai/langchain/master/libs/langchain_v1/langchain/agents/middleware/todo.py)
18. LangChain — built-in middleware docs (https://docs.langchain.com/oss/python/langchain/middleware/built-in)
19. Towards Data Science — "How Agents Plan Tasks with To-Do Lists" (https://towardsdatascience.com/how-agents-plan-tasks-with-to-do-lists/)
20. Indie Hackers — "The Complete Guide to Writing Agent System Prompts" (https://www.indiehackers.com/post/the-complete-guide-to-writing-agent-system-prompts-lessons-from-reverse-engineering-claude-code-6e18d54294)
21. Anthropic — Tool Search Tool docs (https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool) — `tool_search_tool_{regex,bm25}_20251119`, `defer_loading`, `tool_reference`, performance data
22. Anthropic engineering — "Advanced tool use" (https://www.anthropic.com/engineering/advanced-tool-use) — 55K/134K-token figures, 30-50 tool selection-accuracy cliff
23. mikhail.io — "Inside Claude Code's Web Tools: WebFetch vs WebSearch" (https://mikhail.io/2025/10/claude-code-web-tools/) — small-model distillation, redirect handling, size limits (single-sourced claims flagged in §5)
24. Anthropic/Claude Code — Skills docs (https://code.claude.com/docs/en/skills, redirected from https://docs.claude.com/en/docs/claude-code/skills) — frontmatter table, budget mechanics, file layout/precedence
25. Anthropic — Agent Skills (Claude API) overview (https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview) — Level 1/2/3 progressive disclosure table, beta headers, pre-built skills
26. Agent Skills open standard (https://agentskills.io) — Discovery→Activation→Execution framing, adopter list
27. Pi (`badlogic/pi-mono`) — skills implementation (https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/skills.ts, https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/usage.md)
28. PipeLab — "Preventing SSRF in AI Agents: Attack Vectors and Defenses" (https://pipelab.org/learn/preventing-ssrf-in-ai-agents/) — DNS pinning, CIDR blocklists, IPv6 metadata gap, canonicalization
29. Evan Schwartz — "Comparing 13 Rust Crates for Extracting Text from HTML" (https://emschwartz.me/comparing-13-rust-crates-for-extracting-text-from-html/) — `fast_html2md`/`dom_smoothie` recommendations; also `htmd` (https://lib.rs/crates/htmd)
30. `tanbiralam/claude-code` — `LSPTool` description (https://raw.githubusercontent.com/tanbiralam/claude-code/main/src/tools/LSPTool/prompt.ts)
31. `tanbiralam/claude-code` — `LSPTool` schemas/registration (https://raw.githubusercontent.com/tanbiralam/claude-code/main/src/tools/LSPTool/{schemas.ts,LSPTool.ts})
32. `tanbiralam/claude-code` — `LSPTool` directory (https://github.com/tanbiralam/claude-code/tree/main/src/tools/LSPTool)
33. `tanbiralam/claude-code` — `LSPTool` formatters/response-simplification (https://raw.githubusercontent.com/tanbiralam/claude-code/main/src/tools/LSPTool/formatters.ts)
34. OpenCode — LSP subsystem (https://github.com/sst/opencode/blob/dev/packages/opencode/src/lsp/{lsp.ts,client.ts,server.ts,language.ts}, https://opencode.ai/docs/lsp/)
35. OpenCode — explicit `lsp` tool (https://github.com/sst/opencode/blob/dev/packages/opencode/src/tool/{lsp.ts,lsp.txt})
36. Serena (`oraios/serena`) — symbol-centric MCP tools (https://github.com/oraios/serena, https://oraios.github.io/serena/01-about/035_tools.html)
37. Serena — symbol-search behavior discussions (https://github.com/oraios/serena/issues/{478,605})
38. `Tritlo/lsp-mcp` — minimal MCP↔LSP bridge (https://github.com/Tritlo/lsp-mcp)
39. skywork.ai — "lsp-mcp / MCP-LSP bridge" (https://skywork.ai/blog/lsp-mcp-mcp-lsp-bridge/) — M×N→M+N framing
40. crates.io API — `lsp-types`, `tower-lsp`, `lsp-server`, `async-lsp`, `lsp-client-rs`, `lsp-client` (https://crates.io/crates/{lsp-types,tower-lsp,lsp-server,async-lsp,lsp-client-rs,lsp-client}, https://github.com/oxalica/async-lsp)
41. MindStudio — "How to Use LSP with Claude Code for Large Codebase Navigation" (https://www.mindstudio.ai/blog/language-server-protocol-lsp-claude-code-large-codebases) — grep-vs-LSP framing (illustrative architecture, not a confirmed shipped Anthropic feature)
42. rust-analyzer manual & configuration docs (https://rust-analyzer.github.io/{manual.html,book/configuration.html}) — workspace/root detection via `Cargo.toml`/`cargo metadata`
43. Microsoft — Language Server Protocol 3.17 specification (https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/) — `initialize`, `textDocument/{definition,references,hover,documentSymbol,publishDiagnostics}`, `workspace/symbol`

---

## 10. Caveats and unverified claims (carried forward from sub-agent research)

- The `tanbiralam/claude-code` repository is an explicitly community-maintained **reverse-engineering** project, not Anthropic's source. Where independently corroborated (e.g., `ToolSearch`'s description matched this session's live tool listing byte-for-byte; `TodoWrite`'s prompt matched a second leak repo tagged with a specific `ccVersion`), confidence is high. Surrounding implementation details (feature-flag names, internal service names) are best-effort reconstructions and may not exactly match production code.
- mikhail.io's claims about the WebFetch distillation model being "Haiku 3.5" and a `domain_info` SSRF-deny-list endpoint are **single-sourced** and not independently corroborated [23].
- No beta-header requirement is currently documented for the official `web_fetch_20250910`/`_20260209` API tools, despite this being assumed likely at launch [8].
- No source connects todo-list-tool design directly to peer-reviewed "lost in the middle"/context-rot literature — the "externalized memory" framing is informal practitioner reasoning (Towards Data Science [19]), not a cited research result.
- Could not verify Aider's, Continue.dev's, or Cursor's native (non-MCP) implementations of any of these five tool types — they either don't appear to have shipped equivalents, or no usable source/schema was locatable. Not fabricated; explicitly absent from the comparison table above.
- The MindStudio LSP-bridge "architecture" [41] reads as an illustrative tutorial design, not a description of a shipped Anthropic feature — cited only for its grep-vs-LSP framing, not as evidence of an official Claude Code LSP integration.
