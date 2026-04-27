# Plan: Workflows — Proper Wiring & Visual Feedback

## Context

The Workflows section has a fully-built visual node graph (React Flow) and a topological execution engine, but several gaps prevent it from being genuinely useful for generating real files or operating on the Runner project:

1. **bash/bun/fileop nodes have wrong CWD** — they run with `"."` (app data root), not the project's `generated/` directory, so shell commands can't reach build tooling
2. **AI nodes use plain streaming** — no `outputPath` passed, so no agent loop, no `write_file` tool; generated code is only visible in the node's text output but never lands on disk automatically
3. **Visual feedback is minimal** — node output is capped at 500 chars in the UI, no streaming text, no per-node log, no final result panel
4. **No explicit wiring to Runner** — there is no "save output to file in generated/" action that a workflow node can take

---

## What needs to happen

### Phase 1 — Fix bash/bun/fileop CWD
**File:** `src/workflows/WorkflowsView.tsx`

The bash and bun nodes call `runShellCommand(".", command)` and `bunDev(".", port)`. The first argument is the CWD. It should resolve to the project's `generated/` directory.

**Change:**
- Derive `generatedPath` at execution time: `projects/${settings.project}/generated`
- Pass it as CWD to all bash/bun/fileop nodes instead of `"."`
- fileop nodes: prefix relative paths with `projects/${settings.project}/generated/` when the path doesn't already start with `projects/`

**Impact:** `bun install`, `bun run build`, and shell commands will now run inside the Runner project.

---

### Phase 2 — Add "write to file" output node
**File:** `src/workflows/WorkflowsView.tsx`

Add a new node type: **`writefile`** (or repurpose `fileop` with an explicit mode).

This node:
- Takes the previous node's output as `content`
- Takes a configurable `path` (e.g. `src/screens/Home.tsx` — relative to `generated/`)
- Calls `writeFile(`projects/${project}/generated/${path}`, content)`
- Shows the written path as output

This is the explicit bridge between AI-generated content and real files in the Runner project. Users connect an AI node → writefile node to land the output on disk.

**Node config fields:**
- `path`: string (relative to `generated/`, e.g. `src/screens/Login.tsx`)
- `mode`: `"overwrite"` (default) | `"append"`

---

### Phase 3 — Visual feedback improvements
**File:** `src/workflows/WorkflowsView.tsx`

#### 3a. Streaming text in node during AI execution
Currently node output is set once per chunk update. This works but the truncation to 500 chars means long outputs are invisible.

**Change:** Remove the 500-char cap in the streaming accumulator display. The node's `output` field gets the full accumulated text; the node UI truncates at ~3 lines for display but the properties panel shows the full output.

#### 3b. Per-node execution log panel
When a node is selected and has run, show a full-height scrollable log of its output in the right properties panel (currently max-h-32 is too small).

**Change:** In the properties panel section that shows `node.data.output`, remove `max-h-32`, add `overflow-y-auto flex-1` so it fills available height.

#### 3c. Execution progress bar / run summary
After a workflow completes (all nodes done or aborted), show a summary row below the toolbar:
- Total nodes run
- How many succeeded / failed
- Total elapsed time

This is a simple `useState` tracking `{ total, done, errors, startTime }` updated during execution.

#### 3d. Error node highlighting
Nodes in "error" status currently get a red border. Add a small error message inside the node (first 80 chars of the error string) so users can see what went wrong without selecting the node.

**Node component change:** When `d.status === "error"` and `d.output` exists, render a `<div className="text-[9px] text-red-400 truncate px-3 pb-1">{d.output}</div>` below the existing output line.

---

### Phase 4 — Runner integration node (optional, add last)
**File:** `src/workflows/WorkflowsView.tsx`

Add a **`runner`** node type that triggers the Runner's dev server:
- Calls `bunDev(generatedPath, 5173)` (already exists in ipc.ts)
- Stores the returned PID in node data
- Shows "Dev server running on :5173" as output

This lets a workflow end with "build → write files → start dev server" in a single run.

---

## Files to modify

| File | Change |
|------|--------|
| `src/workflows/WorkflowsView.tsx` | CWD fix, writefile node, streaming cap removal, error display, run summary |
| `src/lib/ipc.ts` | No changes needed — all required IPC already exists |
| `src-tauri/src/lib.rs` | No changes needed |

## Files to read before implementing

- `src/workflows/WorkflowsView.tsx` lines 290-430 (execution engine)
- `src/workflows/WorkflowsView.tsx` lines 340-395 (node execution cases)
- `src/workflows/WorkflowsView.tsx` lines 104-142 (WorkflowNode component)
- `src/workflows/WorkflowsView.tsx` lines 630-780 (properties panel)

## Existing utilities to reuse

- `writeFile`, `readFile`, `runShellCommand`, `bunDev` — all in `src/lib/ipc.ts`
- `notify.success` / `notify.error` — `src/hooks/useToast.ts`
- `useProjectSettingsStore` — for `settings.project` and `ps.directories`

## Verification

1. Create a workflow: Input → architect (AI) → writefile (path: `src/screens/Test.tsx`) → bash (`cat src/screens/Test.tsx`)
2. Run it — verify `generated/src/screens/Test.tsx` appears in the Runner file explorer
3. Add a bun node (`bun install`) after writefile — verify it runs in the correct CWD
4. Trigger an error (bad bash command) — verify red border + error text appears on node
5. Check run summary shows correct counts and time
