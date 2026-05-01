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
  WORKFLOW_SUMMARIZE_PROMPT_BASE,
  WORKFLOW_CONDITION_PROMPT_BASE,
  WORKFLOW_LOOP_FIX_PROMPT_BASE,
} from "@/lib/prompts";
import {
  generateCompletionStream, getApiKeyForProvider, getHostForProvider,
  httpRequest, runShellCommandCapture,
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

function stripCodeFences(input: string): string {
  const match = input.match(/```(?:\w+)?\n?([\s\S]*?)```/);
  return match ? match[1].trim() : input.trim();
}

function traverseJsonPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current === "object" && !Array.isArray(current)) {
      current = (current as Record<string, unknown>)[part];
    } else if (Array.isArray(current)) {
      const index = Number(part);
      current = current[index];
    } else {
      return undefined;
    }
  }
  return current;
}

function computeDiff(before: string, after: string): string {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const result: string[] = ["--- base", "+++ output"];
  let beforeIdx = 0;
  let afterIdx = 0;

  while (beforeIdx < beforeLines.length || afterIdx < afterLines.length) {
    if (beforeIdx >= beforeLines.length) {
      result.push(`+ ${afterLines[afterIdx++]}`);
    } else if (afterIdx >= afterLines.length) {
      result.push(`- ${beforeLines[beforeIdx++]}`);
    } else if (beforeLines[beforeIdx] === afterLines[afterIdx]) {
      result.push(`  ${beforeLines[beforeIdx++]}`);
      afterIdx++;
    } else {
      result.push(`- ${beforeLines[beforeIdx++]}`);
      result.push(`+ ${afterLines[afterIdx++]}`);
    }
  }
  return result.join("\n");
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

    const adj  = new Map<string, string[]>();
    const radj = new Map<string, string[]>();
    for (const n of currentNodes) { adj.set(n.id, []); radj.set(n.id, []); }
    for (const e of currentEdges) { adj.get(e.source)!.push(e.target); radj.get(e.target)!.push(e.source); }

    const inDeg = new Map<string, number>();
    for (const n of currentNodes) inDeg.set(n.id, 0);
    for (const e of currentEdges) inDeg.set(e.target, inDeg.get(e.target)! + 1);
    const queue = [...inDeg.entries()].filter(([,deg]) => deg === 0).map(([id]) => id);
    const order: string[] = [];
    while (queue.length) {
      const id = queue.shift()!; order.push(id);
      for (const nx of adj.get(id)!) { inDeg.set(nx, inDeg.get(nx)! - 1); if (inDeg.get(nx) === 0) queue.push(nx); }
    }
    const execOrder = order.length === currentNodes.length ? order : currentNodes.map((n) => n.id);
    const compDeps = new Map<string, Set<string>>();
    for (const n of currentNodes) if (n.data.nodeType === "composition") compDeps.set(n.id, new Set(radj.get(n.id)!));

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

    const updateStatus = (id: string, patch: Partial<WorkflowNodeData>) =>
      setNodes((prev) => prev.map((n) => n.id === id ? { ...n, data: { ...n.data, ...patch } } : n));

    const execNode = async (nodeId: string) => {
      if (abortRef.current) return;
      const node = currentNodes.find((n) => n.id === nodeId);
      if (!node) return;
      const d = node.data;
      updateStatus(nodeId, { status: "running", output: undefined });
      const prevOut = d.nodeType === "composition" ? "" : getPrevOut(nodeId);

      try {
        let output = "";
        const promptBase = d.prompt || d.label;
        const model = settings.modelId;
        const host = getHostForProvider(settings.provider as Provider, settings.host);
        const apiKey = getApiKeyForProvider(settings.provider as Provider, settings.apiKeys);
        const customPrompts = settings.prompts;

        const streamAI = async (sysprompt: string, userMsg: string): Promise<string> => {
          // Since commit 906be08, generateCompletionStream returns immediately with a
          // request_id (Rust side uses tokio::spawn). We must await the "Done" Channel
          // event instead of the invoke promise to collect the full response.
          return new Promise((resolve, reject) => {
            const channel = new Channel<CompletionEvent>();
            let acc = "";
            channel.onmessage = (msg) => {
              if (msg.event === "Chunk") { acc += msg.data.text; updateStatus(nodeId, { output: acc }); }
              if (msg.event === "Done") { resolve(acc); }
              if (msg.event === "Error") { reject(new Error(msg.data.message)); }
            };
            generateCompletionStream(
              model,
              [{ role: "system", content: sysprompt }, { role: "user", content: userMsg }] satisfies Message[],
              host, apiKey, channel, undefined, undefined, settings.provider as Provider,
            ).catch(reject);
          });
        };

        const resolveSystem = (globalKey: string, base: string): string =>
          d.systemPrompt || customPrompts[globalKey] || base;

        const ai = (globalKey: string, base: string, userMsg: string) =>
          streamAI(resolveSystem(globalKey, base), userMsg);

        const isCustomType = d.nodeType === "custom" || d.nodeType.startsWith("custom_");

        if (isCustomType) {
          output = await streamAI(d.systemPrompt || d.prompt || "Process the input.", prevOut || promptBase);
        } else switch (d.nodeType) {

          case "input":    output = promptBase; break;
          case "output":   output = prevOut; break;
          case "writefile": {
            const wfPath = d.path?.startsWith("projects/") ? d.path : `${generatedPath}/${d.path || "output.txt"}`;
            const wfDir = wfPath.substring(0, wfPath.lastIndexOf("/"));
            try { await createDir(wfDir); } catch { /* dir may exist */ }
            const wfContent = d.mode === "append" ? (await readFile(wfPath).catch(() => "") + "\n" + prevOut) : prevOut;
            await writeFile(wfPath, wfContent);
            output = `Wrote to ${d.path || "output.txt"}`;
            break;
          }

          case "requirements": output = await ai("workflow-requirements-system", WORKFLOW_REQUIREMENTS_PROMPT_BASE, prevOut || promptBase); break;
          case "architect":    output = await ai("workflow-architect-system",    WORKFLOW_ARCHITECT_PROMPT_BASE,    prevOut || promptBase); break;
          case "structure":    output = await ai("workflow-structure-system",    WORKFLOW_STRUCTURE_PROMPT_BASE,    prevOut || promptBase); break;
          case "style":        output = await ai("workflow-style-system",        WORKFLOW_STYLE_PROMPT_BASE,        prevOut || promptBase); break;
          case "interaction":  output = await ai("workflow-interaction-system",  WORKFLOW_INTERACTION_PROMPT_BASE,  prevOut || promptBase); break;
          case "reference":    output = await ai("workflow-reference-system",    WORKFLOW_REFERENCE_PROMPT_BASE,    prevOut || promptBase); break;
          case "transform":    output = await ai("workflow-transform-system",    WORKFLOW_TRANSFORM_PROMPT_BASE,    `Instruction: ${promptBase}\n\nContent: ${prevOut}`); break;

          case "validate": {
            const tscOut = await runShellCommandCapture(generatedPath, "bun tsc --noEmit").catch((e: unknown) => `tsc failed: ${String(e)}`);
            const tscClean = tscOut.trim().length === 0;
            if (tscClean) {
              const aiReview = prevOut.length > 0
                ? await ai("workflow-validate-system", WORKFLOW_VALIDATE_PROMPT_BASE, prevOut)
                : "";
              // Main output includes content so old edges without sourceHandle still get the actual code.
              // Branch outputs for explicit pass/fail routing via sourceHandle-aware edges.
              output = aiReview ? `✅ tsc: no errors\n\n${aiReview}` : (prevOut || "✅ tsc: no errors");
              nodeOutputMap.set(`${nodeId}:pass`, prevOut);
              nodeOutputMap.set(`${nodeId}:fail`, "");
              updateStatus(nodeId, { passOutput: prevOut, failOutput: "" });
            } else {
              output = `❌ tsc errors:\n${tscOut}\n\nCODE:\n${prevOut}`;
              const failContent = `ERRORS:\n${tscOut}\n\nCODE:\n${prevOut}`;
              nodeOutputMap.set(`${nodeId}:pass`, "");
              nodeOutputMap.set(`${nodeId}:fail`, failContent);
              updateStatus(nodeId, { passOutput: "", failOutput: failContent });
            }
            break;
          }

          case "bash": {
            output = await runShellCommandCapture(generatedPath, d.command || "echo hello").catch((e: unknown) => `bash error: ${String(e)}`);
            if (!output.trim()) output = `(no output)`;
            break;
          }
          case "fetch": {
            let headers: Record<string, string> = {};
            try { headers = JSON.parse(d.headers || "{}"); } catch { /* invalid JSON headers */ }
            const method = d.method || "GET";
            const bodyMethods = new Set(["POST", "PUT", "PATCH"]);
            const body = d.body || (bodyMethods.has(method) ? prevOut : undefined) || undefined;
            const res = await httpRequest(method, d.url || "https://api.github.com", headers, body);
            output = res.body;
            break;
          }
          case "fileop": {
            const filePath = d.path?.startsWith("projects/") ? d.path : `${generatedPath}/${d.path || "test.txt"}`;
            if ((d.operation || "read") === "read") {
              output = await readFile(filePath);
            } else {
              const content = d.content || prevOut;
              await writeFile(filePath, content);
              output = content;
            }
            break;
          }
          case "auth": {
            const authHeaders: Record<string, string> = {};
            if (d.authScheme === "apikey") authHeaders[d.authHeaderName || "X-API-Key"] = d.authToken || "";
            else if (d.authScheme === "basic") authHeaders["Authorization"] = `Basic ${btoa(d.authToken || "")}`;
            else authHeaders["Authorization"] = `Bearer ${d.authToken || ""}`;
            output = JSON.stringify(authHeaders);
            break;
          }
          case "parallel":    output = `Forked into ${currentEdges.filter((e) => e.source === nodeId).length} branches`; break;
          case "composition": output = currentEdges.filter((e) => e.target === nodeId).map((e) => {
            if (e.sourceHandle) return nodeOutputMap.get(`${e.source}:${e.sourceHandle}`) ?? nodeOutputMap.get(e.source) ?? "";
            return nodeOutputMap.get(e.source) ?? "";
          }).filter(Boolean).join("\n\n") || "No inputs"; break;
          case "preview":     output = prevOut || "Nothing to preview"; break;
          case "designSystem": {
            try {
              const css = await readFile(`projects/${settings.project}/themes/${d.prompt || "default"}/theme.css`);
              output = `${prevOut ? prevOut + "\n\n" : ""}/* Applied theme: ${d.prompt} */\n${css}`;
            } catch { output = `Theme not found. ${prevOut || ""}`; }
            break;
          }
          case "bun": {
            if (d.command === "dev") { await bunDev(generatedPath, 5173); output = "Started bun dev"; }
            else {
              output = await runShellCommandCapture(generatedPath, `bun ${d.command || "build"}`).catch((e: unknown) => `bun error: ${String(e)}`);
              if (!output.trim()) output = `bun ${d.command || "build"} completed`;
            }
            break;
          }
          case "runner": {
            const rPort = Number(d.port) || 5173;
            await bunDev(generatedPath, rPort);
            output = `Dev server running on :${rPort}`;
            break;
          }


          case "summarize": {
            const focus = d.prompt ? ` Focus on: ${d.prompt}` : "";
            output = await streamAI(
              resolveSystem("workflow-summarize-system", WORKFLOW_SUMMARIZE_PROMPT_BASE),
              `${focus}\n\n${prevOut}`,
            );
            break;
          }

          case "codeextract": {
            output = stripCodeFences(prevOut);
            break;
          }

          case "diff": {
            const before = d.baseContent || "";
            output = computeDiff(before, prevOut);
            break;
          }

          case "jsonextract": {
            const code = stripCodeFences(prevOut);
            try {
              const parsed = JSON.parse(code) as unknown;
              const extracted = d.jsonPath ? traverseJsonPath(parsed, d.jsonPath) : parsed;
              output = typeof extracted === "string" ? extracted : JSON.stringify(extracted, null, 2);
            } catch {
              output = `⚠️ JSON parse failed. Input must be valid JSON.\n\n${prevOut.slice(0, 500)}`;
            }
            break;
          }

          case "linter": {
            const target = d.lintTarget ?? "both";
            const parts: string[] = [];
            if (target === "tsc" || target === "both") {
              const tscResult = await runShellCommandCapture(generatedPath, "bun tsc --noEmit").catch((e: unknown) => `tsc error: ${String(e)}`);
              parts.push(`## TypeScript\n${tscResult.trim() || "✅ No errors"}`);
            }
            if (target === "eslint" || target === "both") {
              const eslintResult = await runShellCommandCapture(generatedPath, "bunx eslint . --max-warnings=0").catch((e: unknown) => `eslint error: ${String(e)}`);
              parts.push(`## ESLint\n${eslintResult.trim() || "✅ No warnings"}`);
            }
            output = parts.join("\n\n");
            break;
          }

          case "condition": {
            const mode = d.conditionMode ?? "expression";
            let passed = false;
            if (mode === "expression") {
              try {
                // Safe-ish: runs in browser JS context; expression gets `input` as the previous output
                const fn = new Function("input", `return !!(${d.expression || "true"});`);
                passed = Boolean(fn(prevOut));
              } catch (err) {
                throw new Error(`Condition expression error: ${String(err)}`, { cause: err });
              }
            } else {
              const judgeInput = `Condition: ${d.judgePrompt || "Is this valid?"}\nInput: ${prevOut}`;
              const verdict = await streamAI(
                resolveSystem("workflow-condition-system", WORKFLOW_CONDITION_PROMPT_BASE),
                judgeInput,
              );
              passed = verdict.trim().toUpperCase().startsWith("YES");
            }
            output = passed ? prevOut : `❌ Condition failed\n\n${prevOut.slice(0, 500)}`;
            nodeOutputMap.set(`${nodeId}:pass`, passed ? prevOut : "");
            nodeOutputMap.set(`${nodeId}:fail`, passed ? "" : prevOut);
            updateStatus(nodeId, { passOutput: passed ? prevOut : "", failOutput: passed ? "" : prevOut });
            break;
          }

          case "loopuntil": {
            const maxIter = d.maxIterations ?? 3;
            const valCmd = d.validationCommand || "bun tsc --noEmit";
            // If input is from validate's fail branch it arrives as "ERRORS:\n...\nCODE:\n..."
            // Extract just the code section; otherwise use prevOut as-is.
            const codeMatch = prevOut.match(/^ERRORS:[\s\S]*?\nCODE:\n([\s\S]*)$/);
            let code = codeMatch ? codeMatch[1].trim() : prevOut;
            for (let iter = 0; iter < maxIter; iter++) {
              const valOut = await runShellCommandCapture(generatedPath, valCmd).catch((e: unknown) => String(e));
              if (valOut.trim().length === 0) {
                updateStatus(nodeId, { output: `✅ Passed after ${iter === 0 ? "first" : `${iter + 1}`} iteration(s)` });
                output = code;
                break;
              }
              updateStatus(nodeId, { output: `Iteration ${iter + 1}/${maxIter} — fixing errors…\n\n${valOut.slice(0, 300)}` });
              const fixSys = resolveSystem("workflow-loop-fix-system", WORKFLOW_LOOP_FIX_PROMPT_BASE);
              code = await streamAI(fixSys, `ERRORS:\n${valOut}\n\nCODE:\n${code}`);
              if (iter === maxIter - 1) {
                output = code;
              }
            }
            if (!output) output = code;
            break;
          }

          case "gitop": {
            const gitCmd = d.gitCommand || "status";
            const commitMsg = d.commitMessage?.trim() || prevOut.slice(0, 200);
            let capturedOutput = "";
            if (gitCmd === "status") {
              capturedOutput = await runShellCommandCapture(generatedPath, "git status").catch((e: unknown) => String(e));
            } else if (gitCmd === "add") {
              capturedOutput = await runShellCommandCapture(generatedPath, "git add .").catch((e: unknown) => String(e));
            } else if (gitCmd === "commit") {
              capturedOutput = await runShellCommandCapture(generatedPath, `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`).catch((e: unknown) => String(e));
            } else if (gitCmd === "add-commit") {
              const addOut = await runShellCommandCapture(generatedPath, "git add .").catch((e: unknown) => String(e));
              const commitOut = await runShellCommandCapture(generatedPath, `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`).catch((e: unknown) => String(e));
              capturedOutput = `add:\n${addOut}\n\ncommit:\n${commitOut}`;
            }
            output = capturedOutput.trim() || "Done";
            break;
          }

          case "memorystore": {
            const key = d.memoryKey || "default";
            workflowMemory.set(key, prevOut);
            output = prevOut;
            break;
          }

          case "memoryload": {
            const key = d.memoryKey || "default";
            output = workflowMemory.get(key) ?? `⚠️ No value found for key: "${key}"`;
            break;
          }

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
      const walk = (id: string) => {
        for (const nx of adj.get(id)!) {
          if (!vis.has(nx) && currentNodes.find((n) => n.id === nx)?.data?.nodeType !== "composition") {
            vis.add(nx); branch.push(nx); walk(nx);
          }
        }
      };
      walk(startId); return branch;
    };

    const done = new Set<string>();
    const checkComp = async () => {
      for (const [cid, deps] of compDeps) {
        if (!done.has(cid) && [...deps].every((dep) => done.has(dep))) {
          await execNode(cid); done.add(cid);
        }
      }
    };

    for (const nodeId of execOrder) {
      if (abortRef.current) break;
      // Resume: skip nodes that are already done from a prior run
      const existingNode = currentNodes.find((n) => n.id === nodeId);
      if (existingNode?.data.status === "done") { done.add(nodeId); continue; }
      if (pauseRef.current) {
        // Mark this node and remaining idle nodes as paused
        updateStatus(nodeId, { status: existingNode?.data.status === "running" ? "paused" : "paused" });
        for (const remainingId of execOrder) {
          if (!done.has(remainingId) && remainingId !== nodeId) {
            const remNode = currentNodes.find((n) => n.id === remainingId);
            if (remNode?.data.status === "idle" || !remNode?.data.status) {
              updateStatus(remainingId, { status: "paused" });
            }
          }
        }
        setPaused(true);
        return;
      }
      const nd = currentNodes.find((n) => n.id === nodeId);
      if (!nd || done.has(nodeId)) continue;
      const nType = nd.data.nodeType;
      if (nType === "composition") {
        const deps = radj.get(nodeId)!;
        if (!deps.every((dep) => done.has(dep))) continue;
      }
      if (nType === "parallel") {
        await execNode(nodeId); done.add(nodeId);
        await Promise.all(adj.get(nodeId)!.map(async (childId) => {
          for (const bid of findBranch(childId)) {
            if (!done.has(bid)) { await execNode(bid); done.add(bid); }
          }
        }));
        await checkComp();
      } else {
        await execNode(nodeId); done.add(nodeId); await checkComp();
      }
    }
    for (const [cid, deps] of compDeps) {
      if (!done.has(cid) && [...deps].some((dep) => done.has(dep))) {
        await execNode(cid); done.add(cid);
      }
    }

    const finalNodes = getNodes();
    const errorCount = finalNodes.filter((n) => n.data.status === "error").length;
    const doneCount = finalNodes.filter((n) => n.data.status === "done").length;
    setRunSummary({ total: currentNodes.length, done: doneCount, errors: errorCount, elapsed: Date.now() - startTime });
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
