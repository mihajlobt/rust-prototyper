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

/** Runs a command synchronously — awaits process termination and throws if exit code is non-zero. */
export async function runShellCommandSync(cwd: string, command: string): Promise<void> {
  return invoke("run_shell_command_sync", { cwd, command });
}

/** Runs a whitelisted shell command and returns captured stdout+stderr as a string. Does not throw on non-zero exit codes. */
export async function runShellCommandCapture(cwd: string, command: string): Promise<string> {
  return invoke("run_shell_command_capture", { cwd, command });
}

/** Runs `bun install` and awaits completion. */
export async function bunInstallSync(cwd: string): Promise<void> {
  return invoke("bun_install_sync", { cwd });
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

export async function createSymlink(linkPath: string, target: string): Promise<void> {
  return invoke("create_symlink", { linkPath, target });
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
  thinking?: string;
  images?: string[];
  /** Tool calls made by the assistant (Ollama provider only) */
  tool_calls?: Array<{ function: { name: string; arguments: Record<string, unknown> } }>;
  /** Tool name for tool-role messages (Ollama provider only) */
  tool_name?: string;
}

export interface OllamaModel {
  id: string;
  name: string;
  capabilities: string[];
  family: string;
  families: string[];
  contextLength?: number;
  /** "ollama-local" or "ollama-cloud" — set by the Rust backend based on which host was queried */
  provider: "ollama-local" | "ollama-cloud";
}

export type Provider = "ollama-local" | "ollama-cloud" | "openai" | "claude"

/** The provider string sent to the Rust backend. Both Ollama variants map to "ollama". */
export function providerForIpc(provider: Provider): string {
  return provider.startsWith("ollama") ? "ollama" : provider
}

/** Resolve the API host for a provider.
 *  - ollama-local: configured host (default: http://localhost:11434)
 *  - ollama-cloud: https://ollama.com
 *  - openai: https://api.openai.com
 *  - claude: https://api.anthropic.com
 */
export function getHostForProvider(provider: Provider, ollamaHost: string): string {
  switch (provider) {
    case "ollama-local": return ollamaHost || "http://localhost:11434"
    case "ollama-cloud": return "https://ollama.com"
    case "openai": return "https://api.openai.com"
    case "claude": return "https://api.anthropic.com"
  }
}

/** Resolve the API key for a provider. */
export function getApiKeyForProvider(provider: Provider, apiKeys: Record<string, string>): string {
  switch (provider) {
    case "ollama-local": return ""
    case "ollama-cloud": return apiKeys["ollama"] || ""
    case "openai": return apiKeys["openai"] || ""
    case "claude": return apiKeys["claude"] || ""
  }
}

export type AskUserQuestionType = "text" | "choice" | "confirm";

export type FormFieldType = "text" | "choice" | "multiselect" | "confirm";

export interface FormField {
  id: string
  label: string
  field_type: FormFieldType
  choices?: string[]
  placeholder?: string
  required?: boolean
}

export type CompletionEvent =
  | { event: "Chunk"; data: { text: string; thinking: string | null } }
  | { event: "ToolCall"; data: { tool: string; args: Record<string, unknown> } }
  | { event: "ToolPermission"; data: { request_id: number; tool: string; args: Record<string, unknown> } }
  | { event: "ToolResult"; data: { tool: string; success: boolean; output: string; path?: string; content?: string } }
  | { event: "AskUser"; data: { request_id: number; question: string; question_type: AskUserQuestionType; choices?: string[] } }
  | { event: "AskUserForm"; data: { request_id: number; title: string; fields: FormField[] } }
  | { event: "Done"; data: { done_reason?: string } | null }
  | { event: "Error"; data: { message: string } };

export type ToolPermissionDecision = "accepted" | "rejected" | "always_allowed";

/** Resolve a pending tool permission request. Called by the frontend
 *  when the user clicks Accept/Reject/Always Allow. */
export async function resolveToolPermission(
  requestId: number,
  decision: ToolPermissionDecision
): Promise<void> {
  return invoke("resolve_tool_permission", { permissionId: requestId, decision });
}

/** Resolve a pending ask_user request. */
export async function resolveAskUser(requestId: number, answer: string): Promise<void> {
  return invoke("resolve_ask_user", { requestId, answer });
}

/** Resolve a pending ask_user_form request with all field answers. */
export async function resolveAskUserForm(
  requestId: number,
  answers: Record<string, string | string[]>,
): Promise<void> {
  return invoke("resolve_ask_user_form", { requestId, answers });
}

/** Non-streaming completion — returns full response at once */
export async function generateCompletion(
  model: string,
  messages: Message[],
  host: string = "",
  apiKey: string = "",
  provider: Provider = "ollama-local"
): Promise<string> {
  return invoke("generate_completion", { model, messages, host, apiKey, provider: providerForIpc(provider) });
}

export interface OllamaModelOptions {
  temperature?: number;
  topK?: number;
  topP?: number;
  numCtx?: number;
  numPredict?: number;
  repeatPenalty?: number;
  repeatLastN?: number;
  seed?: number;
  mirostat?: number;
  mirostatTau?: number;
  mirostatEta?: number;
  tfsZ?: number;
}

export type ThinkParam = boolean | "low" | "medium" | "high"

export type ToolPermissionMode = "ask_every_time" | "auto_accept_read_only" | "auto_accept_all";

/** Streaming completion — emits Chunk/Done/Error/FileWritten events via Channel.
 *  Returns a request ID that can be passed to stopGenerationRequest to cancel
 *  the stream server-side. */
export async function generateCompletionStream(
  model: string,
  messages: Message[],
  host: string,
  apiKey: string,
  onEvent: Channel<CompletionEvent>,
  think?: ThinkParam,
  outputPath?: string,
  provider: Provider = "ollama-local",
  options?: OllamaModelOptions,
  toolPermissionMode?: ToolPermissionMode,
  toolAllowlist?: string[],
  modelFamily?: string,
  maxToolCalls?: number,
  toolFilter?: string[],
  searxngUrl?: string,
): Promise<number> {
  return invoke("generate_completion_stream", {
    request: {
      model,
      messages,
      host,
      apiKey,
      provider: providerForIpc(provider),
      think: think ?? null,
      outputPath: outputPath ?? null,
      options: options ?? null,
      toolPermissionMode: toolPermissionMode ?? "ask_every_time",
      toolAllowlist: toolAllowlist ?? [],
      modelFamily: modelFamily ?? null,
      maxToolCalls: maxToolCalls ?? null,
      toolFilter: toolFilter ?? [],
      searxngUrl: searxngUrl ?? null,
    },
    onEvent,
  });
}

/** Cancel a running generation stream by its request ID.
 *  Signals the Rust backend's CancellationToken, which drops the HTTP
 *  connection and stops Ollama/OpenAI/Claude from continuing to generate. */
export async function stopGenerationRequest(requestId: number): Promise<void> {
  return invoke("stop_generation_stream", { requestId });
}

/** List all local Ollama models, including capabilities & context_length from /api/show */
export async function listOllamaModels(host: string, apiKey = ""): Promise<OllamaModel[]> {
  return invoke("list_ollama_models", { host, apiKey });
}

export interface AnthropicModel {
  id: string;
  display_name: string;
  created_at: string;
}

/** Fetch all models available for an Anthropic API key via /v1/models. */
export async function listAnthropicModels(apiKey: string): Promise<AnthropicModel[]> {
  return invoke("list_anthropic_models", { apiKey });
}

// ─── Model Presets ───

export interface ModelPreset {
  id: string;
  name: string;
  description: string;
  options: OllamaModelOptions;
}

export async function saveModelPresets(presets: ModelPreset[]): Promise<void> {
  return invoke("save_model_presets", { presets });
}

export async function loadModelPresets(): Promise<ModelPreset[]> {
  return invoke("load_model_presets");
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
    options: {
      includeApis,
      includeTheme,
      includeComponents,
      includeTests,
    },
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
    options: {
      includeTypes,
      includeStorybook,
      includeTests,
    },
  });
}

// ─── Error Classification ───

const NOT_FOUND_RE = /os error 2/;

/** Returns true if the error is a "file not found" (ENOENT) from Rust's std::io::Error.
 *  Tauri IPC errors arrive as plain strings (e.g. "IO error: No such file or directory (os error 2)"),
 *  not Error instances — so we test both. */
export function isNotFoundError(error: unknown): boolean {
  if (error instanceof Error) return NOT_FOUND_RE.test(error.message);
  if (typeof error === "string") return NOT_FOUND_RE.test(error);
  return false;
}

/** Extract a human-readable message from a thrown error.
 *  Handles both Error objects and plain strings (the format Tauri IPC uses for serialized AppError). */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return String(error);
}

// ─── Safe IPC Wrappers (with toast notifications) ───

import { safeInvoke, safeInvokeSilent } from "./notifications";
export { safeInvoke, safeInvokeSilent };
export * from "./bonsai";
