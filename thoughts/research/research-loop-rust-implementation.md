# Implementing a multi-round autonomous research loop, Rust side

Companion to [research-agent-prototyper.md](research-agent-prototyper.md) — that doc found Odysseus's depth comes from a hardcoded `Plan → (Search → Extract → Synthesize → Decide)×N → Final Report` state machine (`src/deep_research.py:252`), not from giving the model more tools. This doc designs the Prototyper-native equivalent: where it plugs into the existing Rust agent loop, what's reused unchanged, and what's new. All file:line references verified against the current source.

## What you already have (reuse, don't rebuild)

Prototyper's Rust backend **already runs a tool-calling loop**, not a single completion — `run_agent_loop()` in `src-tauri/src/agent/agent_loop.rs:504-735` loops `stream_turn()` → execute tool calls (parallel, via `join_all`) → feed results back → repeat, until the model stops calling tools or `max_iterations` is hit (`agent_loop.rs:509`, default `MAX_ITERATIONS`, overridable per-request via `CompletionRequest.max_tool_calls`, `commands/ai.rs:169`). This is one full "round" in Odysseus's vocabulary, minus the explicit Plan/Synthesize/Decide phase prompts.

Everything else Odysseus needed custom code for, you already have:

| Need | Already exists at |
|---|---|
| Background execution, doesn't block the IPC call | `generate_completion_stream` spawns `tokio::spawn`, returns a `request_id` immediately — `commands/ai.rs:521-592` |
| Progress streaming to frontend | `Channel<CompletionEvent>`, not polling — same pattern as Odysseus's SSE, just Tauri's IPC primitive instead |
| Cancellation | `CancellationToken`, checked at loop-top and after `stream_turn` (`agent_loop.rs:548, 565`); cancel command pattern already proven in `bonsai_cancel_generation` (`commands/bonsai/assets.rs:217-223`) |
| Pause-and-wait-for-input mid-loop | `request_ask_user()` (`agent_loop.rs:326-409`) — registers a `tokio::sync::oneshot::Sender` in `AppState.pending_ask_user` (`lib.rs:23`), emits `CompletionEvent::AskUser`, `tokio::select!`s on the receiver with a 180s timeout |
| Tool dispatch | Flat `match` in `execute_tool()`, `agent/executor.rs:97-133` — adding a new tool, if you need one, is one match arm, no trait machinery |
| `web_search` | Already calls SearXNG, `agent/executor.rs:1425-1519` |
| `web_fetch` | Already SSRF-hardened, HTML→Markdown via `htmd`, `agent/executor/web_fetch.rs:73-183` |
| Per-feature config storage | `Mutex<T>` field on `AppState`, get/set commands — pattern in `BonsaiServerConfig` (`commands/bonsai/mod.rs:42-58`, `lib.rs:30`) |

This means the research loop is **not a new execution engine** — it's a new *phase structure wrapped around* the engine you already have, plus one new config struct. That's a much smaller build than Odysseus's, and it inherits Prototyper's existing permission/cancellation/streaming guarantees for free instead of re-implementing them.

## Design: an outer phase loop around the existing inner tool loop

Add a second entry point, `run_research_loop()`, alongside `run_agent_loop()` in a new file `src-tauri/src/agent/research_loop.rs`. It does NOT replace `run_agent_loop` — it calls it once per phase, the same way Odysseus's `DeepResearcher.research()` makes one LLM call per phase. Concretely:

```rust
pub struct ResearchLoopConfig {
    pub max_rounds: u8,        // odysseus default: 8
    pub max_time_secs: u64,    // odysseus default: 300
    pub min_rounds: u8,        // odysseus default: 2 — won't stop early even if model says "enough"
    pub max_empty_rounds: u8,  // odysseus default: 2 — abort if N rounds add no new sources
}

pub async fn run_research_loop(
    params: AgentLoopParams<'_>,   // reused as-is — same http_client/channel/cancel_token/tool_filter
    config: ResearchLoopConfig,
) -> Result<(), AppError> {
    let start = std::time::Instant::now();
    let mut round = 0u8;
    let mut empty_rounds = 0u8;
    let mut report = String::new();

    loop {
        if params.cancel_token.is_cancelled() { break; }
        if start.elapsed().as_secs() >= config.max_time_secs { break; }
        if round >= config.max_rounds { break; }
        round += 1;

        params.channel.send(CompletionEvent::ResearchPhase {
            phase: "round_start".into(), round, max_rounds: config.max_rounds,
        })?;

        // One phase = one normal agent-loop call with a phase-specific system
        // message appended to history and a tight max_tool_calls (e.g. 6), so this
        // round's tool-calling burst can't itself runaway.
        let phase_messages = build_round_prompt(&report, round, &config);
        let new_sources = run_one_phase(&params, phase_messages).await?;

        if new_sources == 0 {
            empty_rounds += 1;
            if empty_rounds >= config.max_empty_rounds { break; }
        } else {
            empty_rounds = 0;
        }

        report = synthesize_round(&params, &report, round).await?;

        if round >= config.min_rounds && should_stop(&params, &report).await? {
            break;
        }
    }

    let final_report = write_final_report(&params, &report).await?;
    params.channel.send(CompletionEvent::Done { done_reason: Some("research_complete".into()), usage: None })?;
    Ok(())
}
```

`build_round_prompt`, `synthesize_round`, `should_stop`, `write_final_report` are direct Rust translations of Odysseus's `QUERY_GEN_PROMPT`/`SYNTHESIZE_PROMPT`/`STOP_PROMPT`/`FINAL_REPORT_PROMPT` (`thoughts/research/research-agent-prototyper.md` §3 has the exact text to port) — each is a single non-tool-calling completion (or a `run_agent_loop` call scoped to just `web_search`+`web_fetch` for the search/extract phases). They are plain async functions, not a new abstraction layer.

`run_one_phase` is the integration seam: it calls the **existing** `run_agent_loop(params)` with `params.tool_filter` narrowed to `["web_search", "web_fetch"]` for that phase and a small `max_tool_calls` override — i.e. it's literally one call to code that already exists, just parameterized differently per phase.

## What's actually new

1. **One new `CompletionEvent` variant** — `ResearchPhase { phase: String, round: u8, max_rounds: u8 }` — added to the enum at `commands/ai.rs:54-64`, mirroring how `TodoUpdate` (line 61) was added for `task_list`: fire-and-forget, no oneshot/resolve needed, frontend just renders progress. This is the only `CompletionEvent` change required; everything else (`ToolCall`, `ToolResult`, `Chunk`, `Done`, `Error`) already fires naturally from the inner `run_agent_loop` calls each phase makes.

2. **`ResearchLoopConfig`**, stored the same way as `BonsaiServerConfig`: a `Mutex<ResearchLoopConfig>` field on `AppState` (next to `bonsai_config`, `lib.rs:30`), with `research_get_config`/`research_save_config` `#[tauri::command]`s mirroring `bonsai_get_server_config`/`bonsai_save_server_config` (`commands/bonsai/assets.rs:334-353`) — same pattern, new struct, no new persistence mechanism. Add fields to `CompletionRequest` (`commands/ai.rs:145-180`) the same way `max_tool_calls`/`tool_filter`/`searxng_url` already are (`#[serde(default)]` optionals), e.g. `pub research_mode: bool` and `pub research_config: Option<ResearchLoopConfig>` — this is what makes it "flexible/customizable like Odysseus": Odysseus exposes `max_rounds`/`max_time`/`extraction_concurrency`/`category` per-request via its `ResearchStartRequest` API model (`routes/research_routes.py:373-383`); the Rust equivalent is exposing the same knobs as optional fields on the request your frontend already sends, with the same clamping discipline Odysseus uses (`Field(ge=60, le=1800)` there → `.clamp(60, 1800)` here).

3. **Branch in `generate_completion_stream`** (`commands/ai.rs:521`): where it currently always calls `run_agent_loop`/`run_agent_loop_claude`, add `if request.research_mode { run_research_loop(params, config).await } else { run_agent_loop(params).await }`. One conditional, no duplication of the spawn/Channel/request_id plumbing above it (lines 521-535) — that code stays exactly as-is and now serves both modes.

4. **Category-specific prompt variants** (Odysseus's `CATEGORY_PROMPTS`, `src/deep_research.py:148`) — if wanted, a `match config.category.as_deref() { Some("comparison") => ..., _ => default }` inside `build_round_prompt`. Purely additive; skip it for a first version.

## What to deliberately NOT copy from Odysseus

- **Its job-persistence-to-disk + library/history UI** (`services/research/research_handler.py`, `routes/research_routes.py:255-345`). Prototyper's existing per-plan `.chat.json` history (already used by every panel via `useChat`) is sufficient persistence — a research run is just a chat session with the research system prompt and the `ResearchPhase` events rendered specially, not a separate job-tracking subsystem.
- **Its separate `/api/research/*` REST surface and SSE endpoint.** You already have one IPC mechanism (`generate_completion_stream` + `Channel`) that every panel uses; don't add a second one for this feature alone.
- **Its `can_use_research` permission gate** — Prototyper is single-user local desktop software; there's no multi-tenancy to gate.

## Net shape of the change

- 1 new file (`agent/research_loop.rs`, the phase loop + 4 prompt-building functions — all ported text, not new design)
- 1 new `CompletionEvent` variant
- 1 new config struct + 2 commands (copy-paste of the Bonsai config pattern)
- ~4 new optional fields on `CompletionRequest`
- 1 new `if` branch in `generate_completion_stream`
- Zero changes to `execute_tool`, `web_search`, `web_fetch`, the permission system, or the streaming/cancellation plumbing — all reused exactly as they exist today.
