# How Odysseus implements its Research agent

Source: [`github.com/pewdiepie-archdaemon/odysseus`](https://github.com/pewdiepie-archdaemon/odysseus), cloned locally to `/tmp/odysseus`, commit `39a802bea23d56c309109e9f33e6a8cdcecbb65c`. All file paths below are relative to that repo root; all line numbers and quotes were verified by direct read of the source (not from memory) and most cross-checked a second time in this session.

This is written for one purpose: deciding what (if anything) Prototyper's planned "Research" content-type for the Plans panel (see `thoughts/plans/plans-tabs-and-research-mode-plan.md`) should borrow from a working implementation. Odysseus's research feature is materially bigger and more autonomous than what Prototyper's plan proposes — Prototyper's version is "same UI, richer render, bigger tool list, different system prompt." Odysseus's version is a wholly separate background-job subsystem with its own iterative control loop. The comparison below is structured around that gap.

---

## 1. What Research is, architecturally

Research in Odysseus is **not** a system-prompt variant of the normal chat agent. It's a standalone backend subsystem with its own router, its own engine class, and its own frontend panel — completely decoupled from the chat/tool-calling agent loop.

- Router setup: `routes/research_routes.py:385` registers `/api/research/start`; the full route list (`routes/research_routes.py`):
  - `GET /api/research/active` (146)
  - `GET /api/research/status/{session_id}` (165)
  - `POST /api/research/cancel/{session_id}` (176)
  - `POST /api/research/result/{session_id}` (185)
  - `GET /api/research/report/{session_id}` (212)
  - `POST /api/research/{session_id}/hide-image` (232)
  - `POST /api/research/{session_id}/unhide-images` (244)
  - `GET /api/research/library` (255)
  - `GET /api/research/detail/{session_id}` (309)
  - `POST /api/research/{session_id}/archive` (327)
  - `POST /api/research/start` (385)
  - `GET /api/research/stream/{session_id}` (472) — SSE progress stream
  - `POST /api/research/result-peek/{session_id}` (506)
  - `POST /api/research/spinoff/{session_id}` (529) — hands a finished research report off to a *new* chat session
- The router is wired into the app at `app.py:615` via `app.include_router(setup_research_routes(research_handler, session_manager=session_manager))`.
- The engine itself lives in `src/deep_research.py`, class `DeepResearcher` (declared ~line 184). Its docstring (lines 2-7):
  > "IterResearch-style deep research engine. Implements an iterative Think→Search→Extract→Synthesize loop where the LLM drives every decision: what to search, what's relevant, what's missing, and when to stop. Inspired by Alibaba's IterResearch approach."
- It is access-gated independently of normal chat: `routes/research_routes.py:389` calls `require_privilege(request, "can_use_research")` before starting a job — a distinct permission, not just a tool being available.
- The frontend has its own dedicated panel (`static/js/research/panel.js`), opened by a separate toolbar button (`#tool-research-btn`), not a mode toggle inside the chat surface.

**Takeaway for Prototyper:** Odysseus didn't choose "same chat, different prompt/tools" — it built a second product surface (background job + job library + SSE streaming + its own results viewer). Prototyper's plan deliberately rejected that shape (per the user's explicit correction: "the layout should not be different for research mode... only the type of preview render will change"). That's a reasonable, smaller-scope choice — the rest of this report should be read as "here's the expensive version, take the pieces that transfer cheaply," not as a reason to redesign Prototyper's plan.

---

## 2. The iterative loop (the core engine logic)

`DeepResearcher.research()` (`src/deep_research.py:252` onward) runs a fixed state machine, not a tool-calling ReAct loop:

```
PLAN          → _create_plan()              (line ~399)
for round 1..max_rounds:
  THINK       → generate 3-4 search queries  (line ~461)
  SEARCH+FETCH→ run queries, fetch top URLs  (line ~507)
  EXTRACT     → per-URL LLM extraction        (concurrent, line ~507-558)
  SYNTHESIZE  → merge findings into report    (line ~671)
  DECIDE      → LLM YES/NO "is this enough?"  (line ~705)
  break if YES and round >= min_rounds
FINAL REPORT  → _final_report(), ≥1500 words  (line ~737)
```

Every phase is a **separate, hardcoded LLM call with its own prompt template** (all defined as module-level string constants in `src/deep_research.py`, lines 41-178) — there is no single system prompt the model operates under for the whole task, and no agentic tool-calling where the model decides what tool to invoke next. The control flow is entirely in Python; the LLM only ever answers the specific question put to it at each phase.

Constructor defaults (`DeepResearcher.__init__`, `src/deep_research.py:190-226`):

```python
max_rounds: int = 8
max_time: int = 300            # seconds
max_urls_per_round: int = 3
max_content_chars: int = 15000 # per-page truncation
max_report_tokens: int = 8192
extraction_timeout: int = 90
planning_timeout: int = 90
query_timeout: int = 120
extraction_concurrency: int = 3
min_rounds: int = 2            # won't stop before this even if LLM says "enough"
max_empty_rounds: int = 2      # abort if 2 consecutive rounds return nothing
synthesis_window: int = 10     # only last 10 findings are fed to the synthesis prompt
```

These are then clamped again at the API boundary in `routes/research_routes.py:373-383` (`ResearchStartRequest`):

```python
max_rounds: int = Field(default=0, ge=0, le=20)        # 0 = "Auto", model decides
max_time: int = Field(default=300, ge=60, le=1800)     # 60s–30min
extraction_timeout: Optional[int] = Field(default=None, ge=15, le=3600)
extraction_concurrency: Optional[int] = Field(default=None, ge=1, le=12)
```

Two termination paths exist independent of the LLM's own "stop" vote: wall-clock `max_time`, and `max_empty_rounds` consecutive rounds with zero new search results. The user (or the API caller) can also `cancel()` mid-run; `research()` checks `self._cancelled` at the top of every round (confirmed at `src/deep_research.py:~291`).

**Takeaway for Prototyper:** this is the one piece with no analogue in Prototyper's plan at all — Prototyper's Research content-type is single-turn (the existing chat agent loop, just with `web_search` added and a different prompt), not a multi-round, code-driven research loop with its own stop conditions. Building this would be a much bigger feature than what's currently planned (background job execution, polling/streaming infra, a job-history view). Worth flagging explicitly as **out of scope** for the current plan rather than silently absent — if "Research" is meant to feel materially more thorough than just "chat with web search," this loop is *why* Odysseus's version achieves that, and Prototyper's lighter version won't get the same depth.

---

## 3. Prompts (the actual system-prompt analogue)

There's no single "Research system prompt" string — five+ separate ones, all in `src/deep_research.py`:

**`RESEARCH_PLAN_PROMPT`** (line 41) — asks the model to decompose the question into sub-questions, key topics, success criteria, returned as JSON.

**`QUERY_GEN_PROMPT`** (line 64) — generates search queries; round 1 gets "4 broad, diverse queries," later rounds get "3 targeted follow-up queries," explicitly deduplicated against `queries_used`.

**`SYNTHESIZE_PROMPT`** (line 84), quoted in full since it's short and is the closest thing to a citation-policy statement:
```
Integrate the new findings into the existing report. Produce an updated, well-organized
report that answers the original question as completely as possible given all evidence so far.
Remove redundancy, resolve contradictions, and maintain logical flow.
Keep source URLs as inline citations where relevant.

Write only the updated report — no preamble or meta-commentary.
```

**`STOP_PROMPT`** (line 103) — forces a binary decision: "Reply with ONLY 'YES' or 'NO' followed by a brief one-sentence reason," with a bias instruction: "If rounds completed is well below the target, prefer continuing unless the report is already exhaustive."

**`FINAL_REPORT_PROMPT`** (line 127), quoted in full — this is the one with teeth, and the most directly reusable piece for Prototyper's research prompt:
```
Write a **long, detailed, comprehensive** research report answering this question:

Requirements:
- Write at MINIMUM 1500 words — this should be a thorough, magazine-quality article
- Use clear ## headings and ### subheadings to organize into logical sections
- Each section should have multiple detailed paragraphs, not just bullet points
- Synthesize and analyze the information — explain WHY things matter, draw comparisons, provide context
- Include specific data points, numbers, and statistics from the evidence
- Include source URLs as inline citations [like this](url)
- Note where sources agree and where they disagree
- Add a brief executive summary at the top
- End with a clear conclusion that directly answers the question
- Write in an engaging, informative style — not dry or robotic
```

**`CATEGORY_PROMPTS`** (line 148) — a dict keyed by `product`/`comparison`/`howto`/`factcheck`/etc., each adding category-specific formatting instructions, selected either explicitly by the caller or auto-classified by the model from the question (`_classify_category`, called at `src/deep_research.py:~283`).

A sixth prompt, in a different file — `src/goal_based_extractor.py:6-23`, `EXTRACTOR_SYSTEM` — governs the per-URL extraction step: "Extract relevant information from a webpage for a given research goal... 1. Locate the specific sections directly related to the goal 2. Identify and extract the most relevant information 3. Organize into a concise paragraph with logical flow," returning structured JSON `{rational, evidence, summary}`.

**Important nuance, confirmed by direct read:** citations are **entirely prompt-instructed, not enforced or validated by code.** Nothing parses the final report to check that `[text](url)` citations are present, accurate, or attached to real fetched URLs. The model is asked nicely, twice (once in `SYNTHESIZE_PROMPT`, once in `FINAL_REPORT_PROMPT`), and that's the entire enforcement mechanism.

**Takeaway for Prototyper:** the `FINAL_REPORT_PROMPT` block above is directly portable language for `getPlansResearchSystemPrompt()` (Task 8 of Prototyper's plan) — the word-count floor, "explain WHY things matter," "note where sources agree/disagree," and "executive summary at top + clear conclusion" instructions are all good, concrete asks that map onto a single-turn system prompt without needing the multi-phase loop. Prototyper's planned prompt already requires citations and verification language (per the plan's test: `expect(prompt.toLowerCase()).toMatch(/cite|citation|source/)`) — this confirms that's the right bar, but also confirms Prototyper should not expect code-level citation enforcement to be "normal" — Odysseus, a much larger system, doesn't have it either.

---

## 4. Tool access for Research vs. chat

Research does **not** reuse the chat agent's generic tool-calling mechanism at all. It calls two purpose-built async functions directly from Python, not via an LLM tool-call:

- `comprehensive_web_search()` (imported from `src/search`, used in `src/agent_tools/web_tools.py:8` inside `WebSearchTool.execute`, and called directly by `DeepResearcher`'s own search step)
- `fetch_webpage_content()` (imported from `src/search/content`, used in `WebFetchTool.execute`, `src/agent_tools/web_tools.py:57+`)

Note: `src/agent_tools/web_tools.py`'s `WebSearchTool`/`WebFetchTool` classes are the versions exposed to the **regular chat agent** as callable tools (confirmed: they parse a `content` string the way a tool-call argument would, and return `{"output": ..., "exit_code": 0}}`, the generic tool-result shape). `DeepResearcher` calls the underlying `comprehensive_web_search`/`fetch_webpage_content` functions directly, bypassing that tool-call wrapper — meaning **the chat agent already has its own `web_search`/`web_fetch` tools today, independent of and architecturally separate from the Research engine.** Research doesn't "unlock" a tool the chat agent lacks; it runs a different, code-driven pipeline that happens to use the same underlying search/fetch primitives.

`src/deep_research.py:~560-607` shows Research has its own provider-selection logic: a configurable `research_search_provider` setting distinct from the general chat `search_provider`, with a fallback chain (e.g., searxng → duckduckgo) tried in order until one returns results.

**Takeaway for Prototyper:** this is the most direct structural parallel to what Prototyper is doing in Task 5/10 of its plan — Prototyper's `PLANS_RESEARCH_TOOL_FILTER_DEFAULT` (Plans tools + `web_search`) is the same idea as Odysseus's chat-agent-level `WebSearchTool`, just simpler (allowlist instead of a fully separate code path). The corrected finding in Prototyper's plan — that the chat agent's tool-calling loop is the right place for `web_search`, and a fully separate execution engine is unnecessary unless multi-round autonomy is explicitly wanted — is consistent with how Odysseus itself draws the line between "chat agent with a search tool" (cheap, already exists in both projects) and "Research engine" (expensive, a different subsystem in Odysseus).

---

## 5. Output format and citation structure

The final artifact is markdown with a fixed structural template, assembled in `services/research/research_handler.py:333-416`:

```
---
## Research Summary
**Duration:** X.Xs | **Rounds:** N | **Queries:** M | **URLs Analyzed:** K
---

{full LLM-written report body}

### Sources
- [Title1](https://url1)
- [Title2](https://url2)

### Analyzed URLs
1. [Title1](https://url1)
2. [Title2](https://url2)

<details>
<summary><strong>Raw collected findings (N sources)</strong></summary>
{per-source extraction: url, title, summary, evidence, rational}
</details>
```

The `### Sources` section is then re-parsed back out of the markdown by `services/research/service.py:114-146` (`_parse_sources`), which the docstring explains carefully:
```python
"""Extract sources from the markdown ### Sources section of a report.

ResearchHandler emits one ``- [title](url)`` link per deduplicated
finding under a ``### Sources`` heading. Parse only that section so
inline links elsewhere in the body are not mistaken for sources.
"""
```
It scans line-by-line, tracks whether it's inside a heading-delimited `### Sources` block via a `stripped.lower().lstrip("#").strip() == "sources"` check, and only extracts links there — explicitly to avoid false-positives from citation links inline in the prose. Sources are deduplicated by URL via a `seen` set in the same function.

A separate quality filter, `is_low_quality()` (referenced in `src/research_handler.py`, defined in `src/research_utils.py`, test coverage in `tests/test_research_utils.py` and `tests/test_research_utils_low_quality_nonstring.py`), screens out generic/unhelpful per-page extractions before they're added to the findings list that feeds synthesis.

**Note on the `<details>` block:** Odysseus already uses the exact same "stack collapsible raw detail behind a `<details>` toggle" pattern Prototyper's tabs plan relies on — confirming it's a portable, low-risk idiom (not a Prototyper-specific invention) — though Odysseus uses a single `<details>` for "raw findings," not stacked/grouped ones for tabs.

**Takeaway for Prototyper:** the `### Sources` heading-delimited-section convention (only treat links under a specific heading as "the bibliography," ignore inline citation links elsewhere) is a clean, GFM-safe pattern Prototyper could adopt verbatim if it ever wants to programmatically extract/dedupe a plan's sources — no parser changes needed, since it's pure markdown structure, consistent with Prototyper's "GFM-only, render-layer-agnostic" Axis-1 principle from `thoughts/research/mdx-to-md.md` §6.

---

## 6. Persistence, job lifecycle, and tests

Research runs as a background `asyncio` task tracked in `ResearchHandler._active_tasks[session_id]` (in-memory dict keyed by session, confirmed via `services/research/research_handler.py`), with fields `task, researcher, query, status, progress, result, started_at, owner, sources, raw_findings`. On completion it's persisted to `DEEP_RESEARCH_DIR/{session_id}.json`. Progress is pushed to the frontend via SSE (`GET /api/research/stream/{session_id}`, `routes/research_routes.py:472`), not polling.

Test coverage (`tests/`, all file names confirmed present via `ls`):
- `test_research_service.py` — asserts the `### Sources`-only parsing behavior described above, including that inline links outside that section are ignored (lines ~79-94 per the earlier exploration pass; not re-verified line-by-line in this session but the file and its `_parse_sources`-adjacent docstring were).
- `test_deep_research_extraction_controls.py` — asserts `extraction_concurrency` is actually respected (caps concurrent fetches) and that all visited URLs land in an `analyzed_urls` audit list.
- `test_deep_research_search_error.py` — asserts that when every search provider returns empty results (no exception), the engine records a specific, actionable `_last_search_error` rather than silently producing an empty report.
- `test_research_query_fallback.py` — covers a clarification-question UX: if the user's follow-up to a research clarification is just "yes", the engine falls back to the original query rather than treating "yes" as a real refinement; substantive one-word answers like "UK" or "C++" are treated as real refinements.
- `test_research_owner_scope_routes.py` — asserts a user cannot view or act on another user's research session, and that endpoint-fallback logic never silently borrows another user's API endpoint credentials.
- `test_research_source_link_xss.py`, `test_research_session_id_validation.py`, `test_research_handler_path_confinement.py` — security-hardening tests (sanitizing source links before render, validating session IDs, confining file writes to the research data directory) — relevant if Prototyper ever lets research output render raw HTML/links without sanitization, since Plans' preview already does `rehypeRaw` + `allowDangerousHtml`.

---

## 7. Summary judgment for Prototyper

Odysseus's "Research agent" is a genuinely autonomous multi-round research **engine** (its own background-job execution model, its own state machine, its own job library UI), not a chat-mode variant. The parts of it that transfer cleanly to Prototyper's much lighter, toolbar-toggle-based plan are:

1. The `FINAL_REPORT_PROMPT` language (word-count floor, "explain why," executive-summary-plus-conclusion structure, "note agreement/disagreement between sources") — directly usable in `getPlansResearchSystemPrompt()`.
2. The `### Sources`-heading-delimited-section convention for distinguishing a bibliography from inline citation links — a safe, GFM-only pattern if Prototyper wants programmatic source extraction later.
3. Confirmation that citation correctness is realistically prompt-enforced only, in even a far more sophisticated system — Prototyper shouldn't hold its own (much simpler) Research prompt to a stricter bar than that.
4. Confirmation that "chat agent + web_search/web_fetch tool" and "autonomous multi-round research engine" are two different, independently-justifiable features in Odysseus's own architecture — supporting the plan's current scope decision to do the former only, not the latter, unless multi-round autonomy is explicitly desired as a future iteration.

What Odysseus has that Prototyper's current plan does not, and should not silently be expected to deliver at the same scope: the multi-round Plan→Search→Extract→Synthesize→Decide loop, background job execution with cancellation/SSE streaming, a job history/library, and per-session ownership/security hardening. If "Research mode" in Prototyper is ever meant to autonomously dig in over several iterations rather than respond turn-by-turn in chat, that would be a separate, larger plan — explicitly out of scope for `plans-tabs-and-research-mode-plan.md` as currently written.
