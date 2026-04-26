# Ollama Agent Loop — Testing Report

_Tested: 2026-04-26. Two models: gemma4-26b-128k (Ollama local), minimax-m2.7 (Ollama cloud via ollama.com)._
_Test binary: `src-tauri/src/bin/test_agent.rs`. Agent module: `src-tauri/src/agent/`._

---

## Test Matrix

4 tests per model. Tests 1–3 are single-turn (one model invocation, no loop). Test 4 uses the full multi-turn agentic loop.

| Test | What it verifies | Method |
|------|-----------------|--------|
| 1 — write_file | Model calls write_file, file lands on disk | Single turn |
| 2 — read_file | Model calls read_file, returns file contents | Single turn, pre-seeded file |
| 3 — bash | Model calls bash, command executes, output returned | Single turn |
| 4 — loop terminates | Full loop: model writes, then stops on its own | Multi-turn loop |

---

## Results

### gemma4-26b-128k (local, http://localhost:11434)

| Test | Result | Notes |
|------|--------|-------|
| 1 — write_file | ✓ PASS (4/4 assertions) | Called write_file once, file on disk, valid React code |
| 2 — read_file | ✗ FAIL (0/2) | Model called `bash ls -R` instead of `read_file` |
| 3 — bash | ✓ PASS (3/3) | Called bash, echo output correct |
| 4 — loop terminates | ✗ FAIL (2/4) | File written ✓, file on disk ✓, but loop hit MAX_ITER=8 — model never stopped calling write_file |

### minimax-m2.7 (cloud, https://ollama.com)

| Test | Result | Notes |
|------|--------|-------|
| 1 — write_file | ✓ PASS (4/4) | Called write_file once, file on disk, valid React code |
| 2 — read_file | ✓ PASS (2/2) | Called read_file, returned seeded content |
| 3 — bash | ✓ PASS (3/3) | Called bash, echo output correct |
| 4 — loop terminates | ✗ FAIL (2/4) | File written ✓, file on disk ✓, but loop hit MAX_ITER=8 — model never stopped calling write_file |

---

## Findings

### 1. write_file — both models reliable (✓)

Both gemma4 and minimax call write_file correctly in a single turn. Content is raw React/TypeScript code, never JSON-wrapped. Files land on disk. This is the primary tool for the Prototyper use case.

### 2. read_file — minimax works, gemma4 does not (mixed)

minimax-m2.7 correctly called `read_file` when asked to read a file. Content was returned in full and matched the seeded file.

gemma4-26b-128k substituted `bash ls -R` when asked to use `read_file`. This is a model-specific tool selection failure — gemma4 prefers bash for file inspection tasks even when read_file is the correct tool.

**Implication:** read_file cannot be relied upon with gemma4. If the user is on a local Ollama model, the `read_file` tool will likely not be invoked.

### 3. bash — both models reliable (✓)

Both models called bash correctly with the right command. Output was captured and returned. The 30-second timeout and sandboxed cwd work as expected.

### 4. Loop termination — neither model stops on its own (✗)

This is the most significant finding. Both models loop on write_file indefinitely when tools remain available across turns. After receiving the tool result `"Written: ClickMe.tsx"`, both models call write_file again in the next turn (with slightly different code each time), never transitioning to a text-only response.

**Root cause:** The agentic loop in `agent_loop.rs` offers the full tools array on every turn. When the model has tools available and a pending "task" (create a button), it calls tools rather than producing text — even if the file was already written successfully.

**Comparison with original Prototyper code:** The original two-turn flow in `lib.rs` worked because the confirmation turn (`ChatMessageRequest::new(model, vec![])`) did **not** include `.tools()`. With no tools offered, the model had to produce text. That text response had no tool calls, so the loop broke.

**Fix required:** After write_file executes, the subsequent turn must not offer tools. This forces the model to produce a text confirmation, which signals loop completion. The `run_agent_loop` function in `agent_loop.rs` needs a "closing turn" pattern — one tool-free turn after write_file executes.

---

## Required Fix: Closing Turn in agent_loop.rs

Current behavior (broken for single-tool tasks):
```
turn 1: offer tools → model calls write_file
turn 2: offer tools → model calls write_file again
turn 3: offer tools → model calls write_file again
... (until MAX_ITERATIONS)
```

Correct behavior (matching original Prototyper code):
```
turn 1: offer tools → model calls write_file → execute → emit FileWritten
turn 2: offer NO tools → model produces text description → loop breaks
```

The `run_agent_loop` should detect that write_file was called and run one final tool-free turn. For multi-tool chains (write → read → write), this closing turn should happen only after the last write_file in a sequence where no more tools are called.

Simplest implementation: if `tool_calls_this_turn` is non-empty and at least one was `write_file`, do the next request without `.tools()`. If that response has no tool calls (just text), stop. This matches the original behavior exactly.

---

## Summary

| Capability | gemma4-26b-128k | minimax-m2.7 |
|-----------|----------------|-------------|
| write_file (single turn) | ✓ | ✓ |
| read_file (single turn) | ✗ (uses bash instead) | ✓ |
| bash (single turn) | ✓ | ✓ |
| Multi-turn loop terminates | ✗ | ✗ |
| Multi-turn loop (MAX_ITER safety) | ✓ (safety net works) | ✓ (safety net works) |

**Infrastructure verdict:** The tool execution pipeline (schema generation, tool dispatch, executor, file writes, bash sandboxing) works correctly for all three tools. The loop itself iterates and feeds results back correctly.

**Model verdict:** Loop termination requires a tool-free closing turn. Both gemma4 and minimax loop indefinitely when tools are offered on every iteration. gemma4 additionally does not reliably use read_file.

**Next step before Phase 2:** Fix `run_agent_loop` in `agent_loop.rs` to run a closing tool-free turn after write_file executes, restoring the behavior that worked in the original Prototyper code.
