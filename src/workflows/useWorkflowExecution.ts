// Workflow execution engine — extracted from WorkflowsView for file size management.

import { useState, useRef } from "react";
import type { Edge } from "@xyflow/react";
import {
  WORKFLOW_REQUIREMENTS_PROMPT_BASE,
  WORKFLOW_ARCHITECT_PROMPT_BASE,
  WORKFLOW_STRUCTURE_PROMPT_BASE,
  WORKFLOW_STYLE_PROMPT_BASE,
  WORKFLOW_INTERACTION_PROMPT_BASE,
  WORKFLOW_REFERENCE_PROMPT_BASE,
  WORKFLOW_VALIDATE_PROMPT_BASE,
  WORKFLOW_TRANSFORM_PROMPT_BASE,
} from "@/lib/prompts";
import {
  generateCompletionStream, getApiKeyForProvider, getHostForProvider, httpRequest, runShellCommand,
  readFile, writeFile, createDir, bunDev,
  type CompletionEvent, type Message, type Provider,
} from "@/lib/ipc";
import { Channel } from "@tauri-apps/api/core";
import { notify } from "@/hooks/useToast";
import type { WorkflowNodeData, WorkflowNodeType } from "@/workflows/nodeTypes";

export interface RunSummary {
  total: number;
  done: number;
  errors: number;
  elapsed: number;
}

export interface WorkflowExecutionApi {
  running: boolean;
  runSummary: RunSummary | null;
  runWorkflow: () => Promise<void>;
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
  const [runSummary, setRunSummary] = useState<RunSummary | null>(null);
  const abortRef = useRef(false);

  const runWorkflow = async () => {
    setRunning(true);
    setRunSummary(null);
    abortRef.current = false;
    const generatedPath = `projects/${settings.project}/generated`;
    const startTime = Date.now();
    const currentNodes = getNodes();
    const currentEdges = getEdges();

    setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: "idle", output: undefined } })));

    const adj  = new Map<string, string[]>();
    const radj = new Map<string, string[]>();
    for (const n of currentNodes) { adj.set(n.id, []); radj.set(n.id, []); }
    for (const e of currentEdges) { adj.get(e.source)!.push(e.target); radj.get(e.target)!.push(e.source); }

    const inDeg = new Map<string, number>();
    for (const n of currentNodes) inDeg.set(n.id, 0);
    for (const e of currentEdges) inDeg.set(e.target, inDeg.get(e.target)! + 1);
    const queue = [...inDeg.entries()].filter(([,d]) => d === 0).map(([id]) => id);
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!; order.push(id);
      for (const nx of adj.get(id)!) { inDeg.set(nx, inDeg.get(nx)! - 1); if (inDeg.get(nx) === 0) queue.push(nx); }
    }
    const execOrder = order.length === currentNodes.length ? order : currentNodes.map((n) => n.id);
    const compDeps = new Map<string, Set<string>>();
    for (const n of currentNodes) if (n.data.nodeType === "composition") compDeps.set(n.id, new Set(radj.get(n.id)!));

    const nodeOutputMap = new Map<string, string>();

    const getPrevOut = (nodeId: string) => {
      const inc = currentEdges.filter((e) => e.target === nodeId);
      return inc.length ? (nodeOutputMap.get(inc[0].source) ?? "") : "";
    };

    const updateStatus = (id: string, patch: Partial<WorkflowNodeData>) =>
      setNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

    const execNode = async (nodeId: string) => {
      if (abortRef.current) return;
      const node = currentNodes.find((n) => n.id === nodeId);
      if (!node) return;
      const d = node.data;
      updateStatus(nodeId, { status: "running", output: undefined });
      const prevOut = getPrevOut(nodeId);

      try {
        let output = "";
        const promptBase = d.prompt || d.label;
        const model = settings.modelId;
        const host = getHostForProvider(settings.provider as Provider, settings.host);
        const apiKey = getApiKeyForProvider(settings.provider as Provider, settings.apiKeys);
        const customPrompts = settings.prompts;

        const streamAI = async (msgs: Message[]): Promise<string> => {
          const channel = new Channel<CompletionEvent>();
          let acc = "";
          let errorMsg: string | null = null;
          channel.onmessage = (msg) => {
            if (msg.event === "Chunk") { acc += msg.data.text; updateStatus(nodeId, { output: acc }); }
            if (msg.event === "Error") { errorMsg = msg.data.message; }
          };
          await generateCompletionStream(model, msgs, host, apiKey, channel, undefined, undefined, settings.provider as Provider);
          if (errorMsg) throw new Error(errorMsg);
          return acc;
        };
        const ai = (sys: string, user: string) => streamAI([{ role: "system", content: sys }, { role: "user", content: user }]);

        const isCustomType = d.nodeType === "custom" || d.nodeType.startsWith("custom_");
        if (isCustomType) {
          output = await ai(d.prompt || "Process the input.", prevOut || promptBase);
        } else switch (d.nodeType) {
          case "input":        output = promptBase; break;
          case "output":       output = prevOut; break;
          case "writefile": {
            const wfPath = d.path && d.path.startsWith("projects/") ? d.path : `${generatedPath}/${d.path || "output.txt"}`;
            const wfDir = wfPath.substring(0, wfPath.lastIndexOf("/"));
            try { await createDir(wfDir); } catch { /* dir may exist */ }
            const wfContent = d.mode === "append" ? (await readFile(wfPath).catch(() => "") + "\n" + prevOut) : prevOut;
            await writeFile(wfPath, wfContent);
            output = `Wrote to ${d.path || "output.txt"}`;
            break;
          }
          case "requirements": output = await ai(customPrompts["workflow-requirements-system"] || WORKFLOW_REQUIREMENTS_PROMPT_BASE, prevOut || promptBase); break;
          case "architect":    output = await ai(customPrompts["workflow-architect-system"]    || WORKFLOW_ARCHITECT_PROMPT_BASE, prevOut || promptBase); break;
          case "structure":    output = await ai(customPrompts["workflow-structure-system"]    || WORKFLOW_STRUCTURE_PROMPT_BASE, prevOut || promptBase); break;
          case "style":        output = await ai(customPrompts["workflow-style-system"]        || WORKFLOW_STYLE_PROMPT_BASE, prevOut || promptBase); break;
          case "interaction":  output = await ai(customPrompts["workflow-interaction-system"]  || WORKFLOW_INTERACTION_PROMPT_BASE, prevOut || promptBase); break;
          case "reference":    output = await ai(customPrompts["workflow-reference-system"]    || WORKFLOW_REFERENCE_PROMPT_BASE, prevOut || promptBase); break;
          case "transform":    output = await ai(customPrompts["workflow-transform-system"]    || WORKFLOW_TRANSFORM_PROMPT_BASE, `Instruction: ${promptBase}\n\nContent: ${prevOut}`); break;
          case "validate":     output = await ai(customPrompts["workflow-validate-system"]     || WORKFLOW_VALIDATE_PROMPT_BASE, prevOut || "No code to validate"); break;
          case "bash": { await runShellCommand(generatedPath, d.command || "echo hello"); output = `Ran: ${d.command}`; break; }
          case "fetch": {
            let headers: Record<string, string> = {}; try { headers = JSON.parse(d.headers || "{}"); } catch { /* invalid JSON headers */ }
            const res = await httpRequest(d.method || "GET", d.url || "https://api.github.com", headers, d.body || undefined);
            output = `Status: ${res.status}\n${res.body.slice(0, 2000)}`; break;
          }
          case "fileop": {
            const filePath = d.path && d.path.startsWith("projects/") ? d.path : `${generatedPath}/${d.path || "test.txt"}`;
            if ((d.operation || "read") === "read") output = (await readFile(filePath)).slice(0, 2000);
            else { await writeFile(filePath, d.content || ""); output = `Wrote to ${d.path}`; } break;
          }
          case "auth": {
            const h: Record<string, string> = {};
            if (d.authScheme === "apikey") h[d.authHeaderName || "X-API-Key"] = d.authToken || "";
            else if (d.authScheme === "basic") h["Authorization"] = `Basic ${btoa(d.authToken || "")}`;
            else h["Authorization"] = `Bearer ${d.authToken || ""}`;
            output = JSON.stringify(h); break;
          }
          case "parallel":    output = `Forked into ${currentEdges.filter((e) => e.source === nodeId).length} branches`; break;
          case "composition": output = currentEdges.filter((e) => e.target === nodeId).map((e) => nodeOutputMap.get(e.source) ?? "").join("\n\n---\n\n") || "No inputs"; break;
          case "preview":     output = prevOut || "Nothing to preview"; break;
          case "designSystem": {
            try { const css = await readFile(`projects/${settings.project}/themes/${d.prompt || "default"}/theme.css`); output = `${prevOut ? prevOut + "\n\n" : ""}/* Applied theme: ${d.prompt} */\n${css}`; }
            catch { output = `Theme not found. ${prevOut || ""}`; } break;
          }
          case "bun": { if (d.command === "dev") { await bunDev(generatedPath, 5173); output = "Started bun dev"; } else { await runShellCommand(generatedPath, `bun ${d.command || "build"}`); output = `Ran bun ${d.command}`; } break; }
          case "runner": { const rPort = Number(d.port) || 5173; await bunDev(generatedPath, rPort); output = `Dev server running on :${rPort}`; break; }
          default: output = prevOut || `${d.label} passed through`;
        }

        nodeOutputMap.set(nodeId, output);
        updateStatus(nodeId, { status: "done", output });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        updateStatus(nodeId, { status: "error", output: msg });
        notify.error(`Workflow node "${d.label}" failed`, msg);
      }
    };

    const findBranch = (startId: string): string[] => {
      const branch = [startId]; const vis = new Set([startId]);
      const walk = (id: string) => { for (const nx of adj.get(id)!) { if (!vis.has(nx) && currentNodes.find((n) => n.id === nx)?.data?.nodeType !== "composition") { vis.add(nx); branch.push(nx); walk(nx); } } };
      walk(startId); return branch;
    };

    const done = new Set<string>();
    const checkComp = async () => {
      for (const [cid, deps] of compDeps) if (!done.has(cid) && [...deps].every((d) => done.has(d))) { await execNode(cid); done.add(cid); }
    };

    for (const nodeId of execOrder) {
      if (abortRef.current) break;
      const nd = currentNodes.find((n) => n.id === nodeId);
      if (!nd || done.has(nodeId)) continue;
      const nType = nd.data.nodeType;
      if (nType === "composition") { const deps = radj.get(nodeId)!; if (!deps.every((d) => done.has(d))) continue; }
      if (nType === "parallel") {
        await execNode(nodeId); done.add(nodeId);
        await Promise.all(adj.get(nodeId)!.map(async (childId) => { for (const bid of findBranch(childId)) { if (!done.has(bid)) { await execNode(bid); done.add(bid); } } }));
        await checkComp();
      } else {
        await execNode(nodeId); done.add(nodeId); await checkComp();
      }
    }
    for (const [cid, deps] of compDeps) if (!done.has(cid) && [...deps].some((d) => done.has(d))) { await execNode(cid); done.add(cid); }
    const finalNodes = getNodes();
    const errorCount = finalNodes.filter((n) => n.data.status === "error").length;
    const doneCount = finalNodes.filter((n) => n.data.status === "done").length;
    setRunSummary({ total: currentNodes.length, done: doneCount, errors: errorCount, elapsed: Date.now() - startTime });
    setRunning(false);
  };

  const stopWorkflow = () => {
    abortRef.current = true; setRunning(false);
    setNodes((prev) => prev.map((n) => n.data.status === "running" ? { ...n, data: { ...n.data, status: "idle" } } : n));
  };

  return { running, runSummary, runWorkflow, stopWorkflow };
}