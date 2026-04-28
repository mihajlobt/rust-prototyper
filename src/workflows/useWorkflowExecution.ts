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
  httpRequest, runShellCommand, runShellCommandCapture,
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

    const workflowMemory = new Map<string, string>();

    setNodes((prev) => prev.map((n) => ({ ...n, data: { ...n.data, status: "idle", output: undefined } })));

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

        const streamAI = async (sysprompt: string, userMsg: string): Promise<string> => {
          const channel = new Channel<CompletionEvent>();
          let acc = "";
          let errorMsg: string | null = null;
          channel.onmessage = (msg) => {
            if (msg.event === "Chunk") { acc += msg.data.text; updateStatus(nodeId, { output: acc }); }
            if (msg.event === "Error") { errorMsg = msg.data.message; }
          };
          await generateCompletionStream(
            model,
            [{ role: "system", content: sysprompt }, { role: "user", content: userMsg }] satisfies Message[],
            host, apiKey, channel, undefined, undefined, settings.provider as Provider,
          );
          if (errorMsg) throw new Error(errorMsg);
          return acc;
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
            const badge = tscClean ? "✅ tsc: no errors" : `❌ tsc errors:\n${tscOut}`;
            if (tscClean && (prevOut || "").length > 0) {
              // tsc passed — also run AI deep review if code was passed in
              const aiReview = await ai("workflow-validate-system", WORKFLOW_VALIDATE_PROMPT_BASE, prevOut || "No code to validate");
              output = `${badge}\n\n${aiReview}`;
            } else {
              output = badge;
            }
            break;
          }

          case "bash": {
            await runShellCommand(generatedPath, d.command || "echo hello");
            output = `Ran: ${d.command}`;
            break;
          }
          case "fetch": {
            let headers: Record<string, string> = {};
            try { headers = JSON.parse(d.headers || "{}"); } catch { /* invalid JSON headers */ }
            const res = await httpRequest(d.method || "GET", d.url || "https://api.github.com", headers, d.body || undefined);
            output = `Status: ${res.status}\n${res.body.slice(0, 2000)}`;
            break;
          }
          case "fileop": {
            const filePath = d.path?.startsWith("projects/") ? d.path : `${generatedPath}/${d.path || "test.txt"}`;
            if ((d.operation || "read") === "read") output = (await readFile(filePath)).slice(0, 2000);
            else { await writeFile(filePath, d.content || ""); output = `Wrote to ${d.path}`; }
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
          case "composition": output = currentEdges.filter((e) => e.target === nodeId).map((e) => nodeOutputMap.get(e.source) ?? "").join("\n\n---\n\n") || "No inputs"; break;
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
            else { await runShellCommand(generatedPath, `bun ${d.command || "build"}`); output = `Ran bun ${d.command}`; }
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
              const eslintResult = await runShellCommandCapture(generatedPath, "bunx eslint . --ext .ts,.tsx --max-warnings=0").catch((e: unknown) => `eslint error: ${String(e)}`);
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
                // eslint-disable-next-line no-new-func
                const fn = new Function("input", `return !!(${d.expression || "true"});`);
                passed = Boolean(fn(prevOut));
              } catch (err) {
                throw new Error(`Condition expression error: ${String(err)}`);
              }
            } else {
              const judgeInput = `Condition: ${d.judgePrompt || "Is this valid?"}\nInput: ${prevOut}`;
              const verdict = await streamAI(
                resolveSystem("workflow-condition-system", WORKFLOW_CONDITION_PROMPT_BASE),
                judgeInput,
              );
              passed = verdict.trim().toUpperCase().startsWith("YES");
            }
            output = passed ? prevOut : `CONDITION_FAILED: condition evaluated to false\n\nInput was:\n${prevOut.slice(0, 500)}`;
            break;
          }

          case "loopuntil": {
            const maxIter = d.maxIterations ?? 3;
            const valCmd = d.validationCommand || "bun tsc --noEmit";
            let code = prevOut;
            let lastErrors = "";
            for (let iter = 0; iter < maxIter; iter++) {
              const valOut = await runShellCommandCapture(generatedPath, valCmd).catch((e: unknown) => String(e));
              if (valOut.trim().length === 0) {
                output = `✅ Passed after ${iter === 0 ? "first" : `${iter + 1}`} iteration(s)\n\n${code}`;
                break;
              }
              lastErrors = valOut;
              updateStatus(nodeId, { output: `Iteration ${iter + 1}/${maxIter} — fixing errors…\n\n${valOut.slice(0, 300)}` });
              const fixSys = resolveSystem("workflow-loop-fix-system", WORKFLOW_LOOP_FIX_PROMPT_BASE);
              code = await streamAI(fixSys, `ERRORS:\n${valOut}\n\nCODE:\n${code}`);
              if (iter === maxIter - 1) {
                output = `⚠️ Max iterations reached (${maxIter}). Last errors:\n\n${lastErrors.slice(0, 500)}\n\nFinal code:\n\n${code}`;
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
            output = `Stored to key: "${key}" (${prevOut.length} chars)`;
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

  const stopWorkflow = () => {
    abortRef.current = true; setRunning(false);
    setNodes((prev) => prev.map((n) => n.data.status === "running" ? { ...n, data: { ...n.data, status: "idle" } } : n));
  };

  return { running, runSummary, runWorkflow, stopWorkflow };
}
