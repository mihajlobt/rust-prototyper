# Workflow Engine

`src/workflows/useWorkflowExecution.ts` runs nodes imperatively via topological sort. React Flow docs prescribe reactive patterns (`useNodeConnections`, `useNodesData`) for interactive flows. Our batch execution engine lives outside the render cycle, so these hooks cannot be used directly.

## Data flow rules (verified against [reactflow.dev](https://reactflow.dev) docs)

- **Edge routing**: `getPrevOut` checks `edge.sourceHandle` to route from `nodeOutputMap.get(\`${source}:${sourceHandle}\`)`. Falls back to `nodeOutputMap.get(source)` if no handle. Matches [useNodeConnections API](https://reactflow.dev/api-reference/hooks/use-node-connections).
- **Multi-input nodes**: `getPrevOut` aggregates all incoming edges via `.map().filter().join("\n\n")`, not just `inc[0]`. React Flow's `useNodeConnections` returns an array.
- **Validate/Condition dual-output**: Main output must include the actual content (not just status badge) so edges without `sourceHandle` get the data. Branch outputs (`:pass`, `:fail`) are for explicit sourceHandle routing only.
- **State updates**: `updateStatus` creates new node objects (`{ ...n, data: { ...n.data, ...patch } }`). React Flow requires new object references to detect changes ([State Management](https://reactflow.dev/learn/advanced-use/state-management)).
- **Why not React Flow hooks**: `runWorkflow` is an async callback, not a component render. Hooks only work in React components or custom hooks.
- **Why not `getIncomers()`**: Returns nodes, not edges. We need `edge.sourceHandle` for branch routing.
- **Why not `getConnectedEdges()`**: Filters edges by node presence, not by target. We need `edges.filter(e => e.target === nodeId)`.

## Common workflow bugs

- **Status strings as main output**: Validate's `"✅ tsc: no errors"` or Condition's `"✅ Condition passed"` replace content. Downstream nodes get status instead of data unless edge has `sourceHandle`.
- **Single-edge assumption**: `inc[0]` drops all other incoming connections.
- **Composition separator**: Uses `\n\n` not `\n\n---\n\n` to avoid markdown artifacts in generated code files.

## Context menu implementation

Radix UI `ContextMenu.Root` is uncontrolled only — it does NOT accept an `open` prop. For controlled right-click menus on the React Flow canvas:

1. Use `DropdownMenu.Root` with `open`/`onOpenChange`
2. Position an invisible `position: fixed` 0x0 div as the `DropdownMenuTrigger` at the cursor coordinates
3. Set `modal={false}` so the canvas remains interactive while the menu is open
4. Use `onCloseAutoFocus={(e) => e.preventDefault()}` to prevent focus theft from ReactFlow
5. Force `DropdownMenuContent` remount via `key` when repositioning, so Radix Popper re-measures the trigger
