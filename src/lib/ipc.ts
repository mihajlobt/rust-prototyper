import { invoke, Channel } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { convertFileSrc } from "@tauri-apps/api/core";

// ─── Process Management ───

export async function bunDev(cwd: string, port: number): Promise<number> {
  return invoke("bun_dev", { cwd, port });
}

export async function bunBuild(cwd: string): Promise<number> {
  return invoke("bun_build", { cwd });
}

export async function bunInstall(cwd: string): Promise<number> {
  return invoke("bun_install", { cwd });
}

export async function runShellCommand(cwd: string, command: string): Promise<number> {
  return invoke("run_shell_command", { cwd, command });
}

export async function killProcess(pid: number): Promise<void> {
  return invoke("kill_process", { pid });
}

export async function killAllProcesses(): Promise<void> {
  return invoke("kill_all_processes");
}

export async function killPort(ports: number[]): Promise<void> {
  return invoke("kill_port", { ports });
}

// ─── Terminal Output Event Listener (centralized) ───

export interface TerminalOutputEvent {
  pid: number;
  line: string;
  source: "stdout" | "stderr";
}

export function onTerminalOutput(
  handler: (event: TerminalOutputEvent) => void
): Promise<UnlistenFn> {
  return listen<TerminalOutputEvent>("terminal-output", (e) => handler(e.payload));
}

// ─── File System ───

export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
}

export async function readDir(path: string): Promise<FileEntry[]> {
  return invoke("read_dir", { path });
}

export async function readFile(path: string): Promise<string> {
  return invoke("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke("write_file", { path, content });
}

export async function createDir(path: string): Promise<void> {
  return invoke("create_dir", { path });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

export async function deleteDir(path: string): Promise<void> {
  return invoke("delete_dir", { path });
}

export async function renameFile(from: string, to: string): Promise<void> {
  return invoke("rename_file", { from, to });
}

export async function revealInExplorer(path: string): Promise<void> {
  return invoke("reveal_in_explorer", { path });
}

/** Convert a Rust-side file path to a URL loadable in the webview */
export function toFileUrl(filePath: string): string {
  return convertFileSrc(filePath);
}

// ─── HTTP Client ───

export interface HttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export async function httpRequest(
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: string
): Promise<HttpResponse> {
  return invoke("http_request", { method, url, headers, body });
}

// ─── AI Generation ───

export interface Message {
  role: string;
  content: string;
  images?: string[];
}

export interface OllamaModel {
  id: string;
  name: string;
  capabilities: string[];
  family: string;
  families: string[];
  contextLength?: number;
}

export function getApiKey(modelId: string, apiKeys: Record<string, string>): string {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-")) return apiKeys["openai"] || "";
  if (modelId.startsWith("claude-")) return apiKeys["claude"] || "";
  return apiKeys["ollama"] || "";
}

/** Determine the API host for a given model ID */
export function getModelHost(modelId: string, ollamaHost: string, cloudModelIds?: ReadonlyArray<string>): string {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-")) return "https://api.openai.com";
  if (modelId.startsWith("claude-")) return "https://api.anthropic.com";
  // Only route to ollama.com when the model is explicitly in the cloud list
  if (cloudModelIds?.includes(modelId)) return "https://ollama.com";
  return ollamaHost;
}

export function isOllamaModel(modelId: string): boolean {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-")) return false;
  if (modelId.startsWith("claude-")) return false;
  return true;
}

export type CompletionEvent =
  | { event: "Chunk"; data: { text: string; thinking: string | null } }
  | { event: "Done"; data: null }
  | { event: "Error"; data: { message: string } };

/** Non-streaming completion — returns full response at once */
export async function generateCompletion(
  model: string,
  messages: Message[],
  host: string = "",
  apiKey: string = ""
): Promise<string> {
  return invoke("generate_completion", { model, messages, host, apiKey });
}

/** Streaming completion — emits Chunk/Done/Error events via Channel */
export async function generateCompletionStream(
  model: string,
  messages: Message[],
  host: string,
  apiKey: string,
  onEvent: Channel<CompletionEvent>,
  think?: boolean
): Promise<void> {
  return invoke("generate_completion_stream", { model, messages, host, apiKey, onEvent, think: think ?? null });
}

/** List all local Ollama models, including capabilities & context_length from /api/show */
export async function listOllamaModels(host: string, apiKey = ""): Promise<OllamaModel[]> {
  return invoke("list_ollama_models", { host, apiKey });
}

// ─── Workflows ───

export async function saveWorkflow(projectId: string, workflowId: string, data: string): Promise<void> {
  return invoke("save_workflow", { projectId, workflowId, data });
}

export async function loadWorkflow(projectId: string, workflowId: string): Promise<string> {
  return invoke("load_workflow", { projectId, workflowId });
}

export async function listWorkflows(projectId: string): Promise<FileEntry[]> {
  return invoke("list_workflows", { projectId });
}

// ─── Export ───

export async function exportProject(
  projectId: string,
  outputPath: string,
  format: string,
  includeApis: boolean,
  includeTheme: boolean,
  includeComponents: boolean,
  includeTests: boolean
): Promise<string> {
  return invoke("export_project", {
    projectId,
    outputPath,
    format,
    includeApis,
    includeTheme,
    includeComponents,
    includeTests,
  });
}

export async function exportComponent(
  projectId: string,
  componentId: string,
  outputPath: string,
  format: string,
  includeTypes: boolean,
  includeStorybook: boolean,
  includeTests: boolean
): Promise<string> {
  return invoke("export_component", {
    projectId,
    componentId,
    outputPath,
    format,
    includeTypes,
    includeStorybook,
    includeTests,
  });
}

// ─── Safe IPC Wrappers (with toast notifications) ───

import { safeInvoke, safeInvokeSilent } from "./notifications";
export { safeInvoke, safeInvokeSilent };
