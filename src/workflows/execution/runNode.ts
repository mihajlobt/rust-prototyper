// Executes a single workflow node by dispatching on nodeType.
// Extracted from useWorkflowExecution.ts so the orchestrator stays focused on
// DAG traversal, batching, and state transitions. All dependencies (settings,
// updateStatus, mutable output map, etc.) are passed in via RunNodeContext
// so the function is closure-free and easy to reason about.

import type { Edge } from "@xyflow/react";
import type { RefObject } from "react";
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
  getErrorMessage,
  type CompletionEvent, type Message, type Provider,
} from "@/lib/ipc";
import { Channel } from "@tauri-apps/api/core";
import { notify } from "@/hooks/useToast";
import type { WorkflowNodeData, WorkflowNodeType } from "@/workflows/nodeTypes";
import { stripCodeFences, traverseJsonPath, computeDiff } from "@/workflows/execution/helpers";

export interface RunNodeSettings {
  project: string;
  modelId: string;
  provider: string;
  host: string;
  apiKeys: Record<string, string>;
  prompts: Record<string, string>;
}

export interface RunNodeContext {
  /** Set to true when the run is stopped; the node should exit promptly. */
  abortRef: RefObject<boolean>;
  /** Snapshot getter for the current node list (used to look up `nodeId`'s data). */
  getNodes: () => WorkflowNodeType[];
  /** Aggregate all incoming edge outputs for a node (handles sourceHandle branches). */
  getPrevOut: (nodeId: string) => string;
  settings: RunNodeSettings;
  /** `projects/{project}/generated` — base directory for file/shell ops. */
  generatedPath: string;
  /** Status setter; coalesced through an rAF queue in the orchestrator. */
  updateStatus: (id: string, patch: Partial<WorkflowNodeData>) => void;
  /** Force any queued status patches to apply immediately. */
  flushNow: () => void;
  /** Mutable map of node id (or `id:branch`) -> output text, used by downstream getPrevOut. */
  nodeOutputMap: Map<string, string>;
  /** Per-run scratchpad for memorystore/memoryload nodes. */
  workflowMemory: Map<string, string>;
  /** Edge list at execution start — used for parallel branch counts and composition join. */
  currentEdges: Edge[];
}

/**
 * Execute a single node and write its output to the shared nodeOutputMap.
 * Marks status as `running` on entry, `done` on success, `error` on exception.
 * Errors are caught and surfaced as toast notifications so one failing node
 * doesn't abort the whole workflow.
 */
export async function runNode(nodeId: string, ctx: RunNodeContext): Promise<void> {
  if (ctx.abortRef.current) return;
  ctx.flushNow();
  const node = ctx.getNodes().find((n) => n.id === nodeId);
  if (!node) return;
  const d = node.data;
  ctx.updateStatus(nodeId, { status: "running", output: undefined });
  const prevOut = d.nodeType === "composition" ? "" : ctx.getPrevOut(nodeId);

  try {
    let output = "";
    const promptBase = d.prompt || d.label;
    const model = ctx.settings.modelId;
    const host = getHostForProvider(ctx.settings.provider as Provider, ctx.settings.host);
    const apiKey = getApiKeyForProvider(ctx.settings.provider as Provider, ctx.settings.apiKeys);
    const customPrompts = ctx.settings.prompts;

    const streamAI = async (sysprompt: string, userMsg: string): Promise<string> => {
      // Since commit 906be08, generateCompletionStream returns immediately with a
      // request_id (Rust side uses tokio::spawn). We must await the "Done" Channel
      // event instead of the invoke promise to collect the full response.
      return new Promise((resolve, reject) => {
        const channel = new Channel<CompletionEvent>();
        let acc = "";
        channel.onmessage = (msg) => {
          if (msg.event === "Chunk") {
            acc += msg.data.text;
            if (!ctx.abortRef.current) ctx.updateStatus(nodeId, { output: acc });
          }
          if (msg.event === "Done") { resolve(acc); }
          if (msg.event === "Error") { reject(new Error(msg.data.message)); }
        };
        generateCompletionStream(
          model,
          [{ role: "system", content: sysprompt }, { role: "user", content: userMsg }] satisfies Message[],
          host, apiKey, channel, undefined, undefined, ctx.settings.provider as Provider,
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
        const wfPath = d.path?.startsWith("projects/") ? d.path : `${ctx.generatedPath}/${d.path || "output.txt"}`;
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
        const tscOut = await runShellCommandCapture(ctx.generatedPath, "bun tsc --noEmit").catch((e: unknown) => `tsc failed: ${String(e)}`);
        const tscClean = tscOut.trim().length === 0;
        if (tscClean) {
          const aiReview = prevOut.length > 0
            ? await ai("workflow-validate-system", WORKFLOW_VALIDATE_PROMPT_BASE, prevOut)
            : "";
          // Main output includes content so old edges without sourceHandle still get the actual code.
          // Branch outputs for explicit pass/fail routing via sourceHandle-aware edges.
          output = aiReview ? `✅ tsc: no errors\n\n${aiReview}` : (prevOut || "✅ tsc: no errors");
          ctx.nodeOutputMap.set(`${nodeId}:pass`, prevOut);
          ctx.nodeOutputMap.set(`${nodeId}:fail`, "");
          ctx.updateStatus(nodeId, { passOutput: prevOut, failOutput: "" });
        } else {
          output = `❌ tsc errors:\n${tscOut}\n\nCODE:\n${prevOut}`;
          const failContent = `ERRORS:\n${tscOut}\n\nCODE:\n${prevOut}`;
          ctx.nodeOutputMap.set(`${nodeId}:pass`, "");
          ctx.nodeOutputMap.set(`${nodeId}:fail`, failContent);
          ctx.updateStatus(nodeId, { passOutput: "", failOutput: failContent });
        }
        break;
      }

      case "bash": {
        output = await runShellCommandCapture(ctx.generatedPath, d.command || "echo hello").catch((e: unknown) => `bash error: ${String(e)}`);
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
        const filePath = d.path?.startsWith("projects/") ? d.path : `${ctx.generatedPath}/${d.path || "test.txt"}`;
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
      case "parallel":    output = `Forked into ${ctx.currentEdges.filter((e) => e.source === nodeId).length} branches`; break;
      case "composition": output = ctx.currentEdges.filter((e) => e.target === nodeId).map((e) => {
        if (e.sourceHandle) return ctx.nodeOutputMap.get(`${e.source}:${e.sourceHandle}`) ?? ctx.nodeOutputMap.get(e.source) ?? "";
        return ctx.nodeOutputMap.get(e.source) ?? "";
      }).filter(Boolean).join("\n\n") || "No inputs"; break;
      case "preview":     output = prevOut || "Nothing to preview"; break;
      case "designSystem": {
        try {
          const css = await readFile(`projects/${ctx.settings.project}/themes/${d.prompt || "default"}/theme.css`);
          output = `${prevOut ? prevOut + "\n\n" : ""}/* Applied theme: ${d.prompt} */\n${css}`;
        } catch { output = `Theme not found. ${prevOut || ""}`; }
        break;
      }
      case "bun": {
        if (d.command === "dev") { await bunDev(ctx.generatedPath, 5173); output = "Started bun dev"; }
        else {
          output = await runShellCommandCapture(ctx.generatedPath, `bun ${d.command || "build"}`).catch((e: unknown) => `bun error: ${String(e)}`);
          if (!output.trim()) output = `bun ${d.command || "build"} completed`;
        }
        break;
      }
      case "runner": {
        const rPort = Number(d.port) || 5173;
        await bunDev(ctx.generatedPath, rPort);
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
          const tscResult = await runShellCommandCapture(ctx.generatedPath, "bun tsc --noEmit").catch((e: unknown) => `tsc error: ${String(e)}`);
          parts.push(`## TypeScript\n${tscResult.trim() || "✅ No errors"}`);
        }
        if (target === "eslint" || target === "both") {
          const eslintResult = await runShellCommandCapture(ctx.generatedPath, "bunx eslint . --max-warnings=-1").catch((e: unknown) => `eslint error: ${String(e)}`);
          const trimmed = eslintResult.trim();
          parts.push(`## ESLint\n${trimmed || "✅ No errors"}`);
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
        ctx.nodeOutputMap.set(`${nodeId}:pass`, passed ? prevOut : "");
        ctx.nodeOutputMap.set(`${nodeId}:fail`, passed ? "" : prevOut);
        ctx.updateStatus(nodeId, { passOutput: passed ? prevOut : "", failOutput: passed ? "" : prevOut });
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
          const valOut = await runShellCommandCapture(ctx.generatedPath, valCmd).catch((e: unknown) => String(e));
          if (valOut.trim().length === 0) {
            ctx.updateStatus(nodeId, { output: `✅ Passed after ${iter === 0 ? "first" : `${iter + 1}`} iteration(s)` });
            output = code;
            break;
          }
          ctx.updateStatus(nodeId, { output: `Iteration ${iter + 1}/${maxIter} — fixing errors…\n\n${valOut.slice(0, 300)}` });
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
          capturedOutput = await runShellCommandCapture(ctx.generatedPath, "git status").catch((e: unknown) => String(e));
        } else if (gitCmd === "add") {
          capturedOutput = await runShellCommandCapture(ctx.generatedPath, "git add .").catch((e: unknown) => String(e));
        } else if (gitCmd === "commit") {
          capturedOutput = await runShellCommandCapture(ctx.generatedPath, `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`).catch((e: unknown) => String(e));
        } else if (gitCmd === "add-commit") {
          const addOut = await runShellCommandCapture(ctx.generatedPath, "git add .").catch((e: unknown) => String(e));
          const commitOut = await runShellCommandCapture(ctx.generatedPath, `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`).catch((e: unknown) => String(e));
          capturedOutput = `add:\n${addOut}\n\ncommit:\n${commitOut}`;
        }
        output = capturedOutput.trim() || "Done";
        break;
      }

      case "memorystore": {
        const key = d.memoryKey || "default";
        ctx.workflowMemory.set(key, prevOut);
        output = prevOut;
        break;
      }

      case "memoryload": {
        const key = d.memoryKey || "default";
        output = ctx.workflowMemory.get(key) ?? `⚠️ No value found for key: "${key}"`;
        break;
      }

      default: output = prevOut || `${d.label} passed through`;
    }

    ctx.nodeOutputMap.set(nodeId, output);
    ctx.updateStatus(nodeId, { status: "done", output });
  } catch (e) {
    const msg = getErrorMessage(e);
    ctx.updateStatus(nodeId, { status: "error", output: msg });
    notify.error(`Workflow node "${d.label}" failed`, msg);
  }
}
