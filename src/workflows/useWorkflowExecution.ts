// Workflow execution orchestrator.
// Owns run/pause/resume/stop state, builds the DAG, batches status updates,
// and drives the main loop that calls runNode. The node-type dispatch and
// pure helpers live in ./execution/* so this file stays focused on flow.

import { useState, useRef } from "react";
import type { Edge } from "@xyflow/react";
import type { WorkflowNodeType } from "@/workflows/nodeTypes";
import { computeDag, findBranch } from "@/workflows/execution/dag";
import { createBatchedStatus } from "@/workflows/execution/batchStatus";
import { runNode, type RunNodeContext } from "@/workflows/execution/runNode";

export interface RunSummary {
  total: number;
  done: number;
  errors: number;
  elapsed: number;
}

export interface WorkflowExecutionApi {
  running: boolean;
  paused: boolean;
  runSummary: RunSummary | null;
  runWorkflow: () => Promise<void>;
  pauseWorkflow: () => void;
  resumeWorkflow: () => Promise<void>;
  stopWorkflow: () => void;
}

interface UseWorkflowExecutionParams {
  settings: {
    project: string;
    modelId: string;
    provider: string;
    host: string;
    apiKeys: Record<string, string>;
    prompts: Record<string, string>;
  };
  getNodes: () => WorkflowNodeType[];
  getEdges: () => Edge[];
  setNodes: React.Dispatch<React.SetStateAction<WorkflowNodeType[]>>;
}

export function useWorkflowExecution({
  settings,
  getNodes,
  getEdges,
  setNodes,
}: UseWorkflowExecutionParams): WorkflowExecutionApi {
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const abortRef = useRef(false);
  const pauseRef = useRef(false);
  const rafIdRef = useRef(0);

  const runWorkflow = async () => {
    setRunning(true);
    setPaused(false);
    setRunSummary(null);
    abortRef.current = false;
    pauseRef.current = false;
    const generatedPath = `projects/${settings.project}/generated`;
    const startTime = Date.now();

    // Reset paused nodes to idle, preserve done nodes (for resume)
    setNodes((prev) => prev.map((n) =>
      n.data.status === "paused"
        ? { ...n, data: { ...n.data, status: "idle" } }
        : n.data.status === "done"
          ? n
          : { ...n, data: { ...n.data, status: "idle", output: undefined } }
    ));

    const currentNodes = getNodes();
    const currentEdges = getEdges();

    const workflowMemory = new Map<string, string>();
    const { adj, radj, execOrder, compDeps } = computeDag(currentNodes, currentEdges);

    const nodeOutputMap = new Map<string, string>();
    // Rebuild output map from done/paused nodes (for resume)
    // Branch outputs (:pass/:fail) are persisted as passOutput/failOutput in node data
    // so they survive pause/resume without guessing
    for (const n of currentNodes) {
      if ((n.data.status === "done" || n.data.status === "paused") && n.data.output) {
        nodeOutputMap.set(n.id, n.data.output);
        if (n.data.passOutput !== undefined) nodeOutputMap.set(`${n.id}:pass`, n.data.passOutput);
        if (n.data.failOutput !== undefined) nodeOutputMap.set(`${n.id}:fail`, n.data.failOutput);
      }
    }

    const getPrevOut = (nodeId: string) => {
      const inc = currentEdges.filter((e) => e.target === nodeId);
      if (!inc.length) return "";
      // Aggregate all incoming edges so nodes with multiple inputs receive combined content.
      // For the common single-edge case this behaves identically to the old inc[0] approach.
      return inc.map((edge) => {
        if (edge.sourceHandle) {
          return nodeOutputMap.get(`${edge.source}:${edge.sourceHandle}`) ?? nodeOutputMap.get(edge.source) ?? "";
        }
        return nodeOutputMap.get(edge.source) ?? "";
      }).filter(Boolean).join("\n\n");
    };

    // rAF-batched status — coalesces streaming-chunk updates per frame.
    const { updateStatus, flushNow } = createBatchedStatus({ setNodes, abortRef, rafIdRef });

    const runCtx: RunNodeContext = {
      abortRef, getNodes, getPrevOut, settings, generatedPath,
      updateStatus, flushNow, nodeOutputMap, workflowMemory, currentEdges,
    };

    // Snapshot node types once — nodeType never changes during execution
    const nodeTypeMap = new Map<string, string>();
    flushNow();
    for (const n of getNodes()) nodeTypeMap.set(n.id, n.data.nodeType);

    const done = new Set<string>();
    const checkComp = async () => {
      for (const [cid, deps] of compDeps) {
        if (!done.has(cid) && [...deps].every((dep) => done.has(dep))) {
          await runNode(cid, runCtx);
          done.add(cid);
        }
      }
    };

    for (const nodeId of execOrder) {
      if (abortRef.current) break;
      // Resume: skip nodes that are already done from a prior run
      flushNow();
      const existingNode = getNodes().find((n) => n.id === nodeId);
      if (existingNode?.data.status === "done") { done.add(nodeId); continue; }
      if (pauseRef.current) {
        // Mark this node and remaining idle nodes as paused
        updateStatus(nodeId, { status: existingNode?.data.status === "running" ? "paused" : "paused" });
        for (const remainingId of execOrder) {
          if (!done.has(remainingId) && remainingId !== nodeId) {
            flushNow();
            const remNode = getNodes().find((n) => n.id === remainingId);
            if (remNode?.data.status === "idle" || !remNode?.data.status) {
              updateStatus(remainingId, { status: "paused" });
            }
          }
        }
        flushNow();
        setPaused(true);
        return;
      }
      flushNow();
      const nd = getNodes().find((n) => n.id === nodeId);
      if (!nd || done.has(nodeId)) continue;
      const nType = nd.data.nodeType;
      if (nType === "composition") {
        const deps = radj.get(nodeId)!;
        if (!deps.every((dep) => done.has(dep))) continue;
      }
      if (nType === "parallel") {
        await runNode(nodeId, runCtx);
        done.add(nodeId);
        await Promise.all(adj.get(nodeId)!.map(async (childId) => {
          for (const bid of findBranch(childId, adj, nodeTypeMap)) {
            if (!done.has(bid)) { await runNode(bid, runCtx); done.add(bid); }
          }
        }));
        await checkComp();
      } else {
        await runNode(nodeId, runCtx);
        done.add(nodeId);
        await checkComp();
      }
    }
    // Cleanup pass: run any composition that became eligible after the main loop
    // (e.g. one that all branches eventually reached).
    for (const [cid, deps] of compDeps) {
      if (!done.has(cid) && [...deps].some((dep) => done.has(dep))) {
        await runNode(cid, runCtx);
        done.add(cid);
      }
    }

    flushNow();
    const finalNodes = getNodes();
    const errorCount = finalNodes.filter((n) => n.data.status === "error").length;
    const doneCount = finalNodes.filter((n) => n.data.status === "done").length;
    setRunSummary({ total: finalNodes.length, done: doneCount, errors: errorCount, elapsed: Date.now() - startTime });
    setRunning(false);
  };

  const pauseWorkflow = () => {
    // Signal the running loop to pause after current node finishes
    pauseRef.current = true;
  };

  const resumeWorkflow = async () => {
    // Reset pause state and re-run, skipping nodes that are already done
    pauseRef.current = false;
    abortRef.current = false;
    setPaused(false);
    // Call runWorkflow which will skip done nodes
    await runWorkflow();
  };

  const stopWorkflow = () => {
    abortRef.current = true;
    pauseRef.current = false;
    cancelAnimationFrame(rafIdRef.current);
    setRunning(false);
    setPaused(false);
    setNodes((prev) => prev.map((n) =>
      n.data.status === "running" || n.data.status === "paused"
        ? { ...n, data: { ...n.data, status: "idle" } }
        : n
    ));
  };

  return { running, paused, runSummary, runWorkflow, pauseWorkflow, resumeWorkflow, stopWorkflow };
}
