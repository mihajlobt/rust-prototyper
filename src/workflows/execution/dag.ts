// DAG helpers for workflow execution.
// Builds adjacency maps, computes a topological execution order, and walks
// parallel branches. Composition nodes are special-cased: they wait for all
// their predecessors and are scheduled in the cleanup pass rather than the
// initial topological pass, so a parallel fan-out can settle before the join.

import type { Edge } from "@xyflow/react";
import type { WorkflowNodeType } from "@/workflows/nodeTypes";

export interface DagInfo {
  /** Forward adjacency: parent -> children. */
  adj: Map<string, string[]>;
  /** Reverse adjacency: child -> parents. */
  radj: Map<string, string[]>;
  /** Topologically-sorted node ids; falls back to insertion order on cycles. */
  execOrder: string[];
  /** Composition node -> set of dependency node ids (its predecessors). */
  compDeps: Map<string, Set<string>>;
}

/**
 * Build adjacency maps and a topological order.
 * On a cycle (shouldn't happen in user-authored workflows), falls back to
 * the original node order so execution still terminates.
 */
export function computeDag(nodes: WorkflowNodeType[], edges: Edge[]): DagInfo {
  const adj = new Map<string, string[]>();
  const radj = new Map<string, string[]>();
  for (const n of nodes) {
    adj.set(n.id, []);
    radj.set(n.id, []);
  }
  for (const e of edges) {
    adj.get(e.source)!.push(e.target);
    radj.get(e.target)!.push(e.source);
  }

  // Kahn's algorithm. Counts edges as the in-degree, so parallel/composition
  // nodes with multiple predecessors wait for all of them.
  const inDeg = new Map<string, number>();
  for (const n of nodes) inDeg.set(n.id, 0);
  for (const e of edges) inDeg.set(e.target, inDeg.get(e.target)! + 1);
  const queue = [...inDeg.entries()].filter(([, deg]) => deg === 0).map(([id]) => id);
  const order: string[] = [];
  while (queue.length) {
    const id = queue.shift()!;
    order.push(id);
    for (const nx of adj.get(id)!) {
      inDeg.set(nx, inDeg.get(nx)! - 1);
      if (inDeg.get(nx) === 0) queue.push(nx);
    }
  }
  const execOrder = order.length === nodes.length ? order : nodes.map((n) => n.id);

  // Composition deps — used by checkComp to know when a composition is ready,
  // and by the cleanup pass to run any composition that became eligible after
  // a parallel fan-out completed.
  const compDeps = new Map<string, Set<string>>();
  for (const n of nodes) {
    if (n.data.nodeType === "composition") {
      compDeps.set(n.id, new Set(radj.get(n.id)!));
    }
  }

  return { adj, radj, execOrder, compDeps };
}

/**
 * Walk a downstream branch starting from `startId`, skipping composition nodes.
 * Used after a `parallel` node to execute every reachable non-composition
 * node on each fan-out path. Composition joins are run separately via
 * checkComp() once their predecessors all report done.
 */
export function findBranch(
  startId: string,
  adj: Map<string, string[]>,
  nodeTypeMap: Map<string, string>,
): string[] {
  const branch = [startId];
  const visited = new Set([startId]);
  const walk = (id: string) => {
    for (const nx of adj.get(id) ?? []) {
      if (!visited.has(nx) && nodeTypeMap.get(nx) !== "composition") {
        visited.add(nx);
        branch.push(nx);
        walk(nx);
      }
    }
  };
  walk(startId);
  return branch;
}
