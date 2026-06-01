// rAF-batched node status updater.
// Coalesces many streaming-chunk updates per frame into a single setNodes call,
// preventing React re-renders on every token. Stops emitting once the run is
// aborted so we never apply stale patches after a stopWorkflow().

import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { WorkflowNodeData, WorkflowNodeType } from "@/workflows/nodeTypes";

export interface BatchedStatus {
  /** Queue a status patch for `id`; the next animation frame applies it. */
  updateStatus: (id: string, patch: Partial<WorkflowNodeData>) => void;
  /** Apply all queued patches synchronously (used before reads that depend on state). */
  flushNow: () => void;
}

export interface BatchedStatusOptions {
  setNodes: Dispatch<SetStateAction<WorkflowNodeType[]>>;
  abortRef: MutableRefObject<boolean>;
  rafIdRef: MutableRefObject<number>;
}

export function createBatchedStatus({ setNodes, abortRef, rafIdRef }: BatchedStatusOptions): BatchedStatus {
  const pendingPatches = new Map<string, Partial<WorkflowNodeData>>();

  const flushPatches = () => {
    if (pendingPatches.size === 0) return;
    // Don't apply stale patches after stop/abort — stopWorkflow resets nodes directly
    if (abortRef.current) {
      pendingPatches.clear();
      return;
    }
    const patches = new Map(pendingPatches);
    pendingPatches.clear();
    setNodes((prev) => prev.map((n) => {
      const patch = patches.get(n.id);
      return patch ? { ...n, data: { ...n.data, ...patch } } : n;
    }));
  };

  const scheduleFlush = () => {
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = requestAnimationFrame(flushPatches);
  };

  const updateStatus = (id: string, patch: Partial<WorkflowNodeData>) => {
    const existing = pendingPatches.get(id);
    pendingPatches.set(id, existing ? { ...existing, ...patch } : patch);
    scheduleFlush();
  };

  const flushNow = () => {
    cancelAnimationFrame(rafIdRef.current);
    flushPatches();
  };

  return { updateStatus, flushNow };
}
