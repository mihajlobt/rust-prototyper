# Ollama Agent Loop — Test Report 2

_Tested: 2026-04-26. Models: gemma4-26b-128k (local), minimax-m2.7 (Ollama cloud)._
_Fix applied to: `src-tauri/src/agent/agent_loop.rs`, `src-tauri/src/bin/test_agent.rs`._

---

## Root Cause of Previous Loop Failure

The original `run_agent_loop` re-offered the full tools array on every subsequent turn:

```rust
request = ChatMessageRequest::new(model, vec![]).tools(tools.clone());
```

When tools are available, models always call them. After `write_file` executes and the result is pushed to history, the model sees an open conversation with tools available and calls `write_file` again. This is correct model behavior — the loop never signaled "done."

The original Prototyper two-turn code worked because the confirmation request was sent **without** `.tools()`, forcing a text-only response. The fix restores that pattern inside the agentic loop.

## Fix

After `write_file` executes, the next request is sent without tools (closing turn). The model produces a text description — no tool calls — so the loop breaks immediately.

Non-write_file turns (read_file, bash) continue the loop with tools still available, allowing proper chaining: `read_file → write_file → closing turn → done`.

**`agent_loop.rs` logic:**
```
loop {
  stream turn WITH tools
  if no tool calls → break (model finished with text)
  execute tools, emit FileWritten for write_file calls
  if write_file was called:
    stream closing turn WITHOUT tools → model produces text → break
  else:
    next iteration WITH tools (read_file/bash chaining)
}
emit Done
```

---

## Results

### gemma4-26b-128k (local)

| Test | Result | Notes |
|------|--------|-------|
| 1 — write_file (single turn) | ✓ 4/4 | Called once, file on disk, valid React |
| 2 — read_file (single turn) | ✗ 0/2 | Called `bash ls -R` instead of `read_file` |
| 3 — bash (single turn) | ✓ 3/3 | Correct command, correct output |
| 4 — loop terminates | ✓ 4/4 | Wrote file, closing turn produced text, stopped at iteration 0 |

### minimax-m2.7 (cloud, ollama.com)

| Test | Result | Notes |
|------|--------|-------|
| 1 — write_file (single turn) | ✓ 4/4 | Called once, file on disk, valid React |
| 2 — read_file (single turn) | ✓ 2/2 | Called `read_file`, returned seeded file contents |
| 3 — bash (single turn) | ✓ 3/3 | Correct command, correct output |
| 4 — loop terminates | ✓ 4/4 | Wrote file, closing turn produced text, stopped at iteration 0 |

---

## Summary

| Capability | gemma4-26b-128k | minimax-m2.7 |
|-----------|----------------|-------------|
| write_file | ✓ | ✓ |
| read_file | ✗ (uses bash instead) | ✓ |
| bash | ✓ | ✓ |
| Loop terminates naturally | ✓ | ✓ |
| Closing turn produces text | ✓ | ✓ |

**Loop fix confirmed working on both models.** Both write the file, receive the tool result, then produce a text-only closing response with no further tool calls.

**gemma4 read_file limitation is a model-specific behavior** — gemma4-26b-128k routes file inspection tasks to bash rather than read_file. This does not affect the primary Prototyper use case (generate → write_file → done). The read_file tool remains available for models that use it (minimax, and likely larger/newer models).

**Phase 1 complete.** Infrastructure is verified on both local and cloud Ollama. Ready for Phase 2 (Channel events + frontend UI).
