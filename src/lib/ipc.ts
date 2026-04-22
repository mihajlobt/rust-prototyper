import { invoke, Channel } from "@tauri-apps/api/core";

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
}

export interface ModelInfo {
  id: string;
  name: string;
}

export function getApiKey(modelId: string, apiKeys: Record<string, string>): string {
  if (modelId.includes(":")) return "";
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1-") || modelId.startsWith("o3-")) return apiKeys.openai || "";
  if (modelId.startsWith("claude-")) return apiKeys.claude || "";
  return "";
}

export type CompletionEvent =
  | { event: "Chunk"; data: { text: string } }
  | { event: "Done"; data: null }
  | { event: "Error"; data: { message: string } };

export async function generateCompletion(
  model: string,
  messages: Message[],
  stream: boolean = false,
  host: string = "",
  apiKey: string = ""
): Promise<string> {
  return invoke("generate_completion", { model, messages, stream, host, api_key: apiKey });
}

export async function generateCompletionStream(
  model: string,
  messages: Message[],
  host: string,
  apiKey: string,
  onEvent: Channel<CompletionEvent>
): Promise<void> {
  return invoke("generate_completion_stream", { model, messages, host, api_key: apiKey, onEvent });
}

export async function listOllamaModels(host: string): Promise<ModelInfo[]> {
  return invoke("list_ollama_models", { host });
}

// ─── Workflows ───

export async function saveWorkflow(projectId: string, workflowId: string, data: string): Promise<void> {
  return invoke("save_workflow", { project_id: projectId, workflow_id: workflowId, data });
}

export async function loadWorkflow(projectId: string, workflowId: string): Promise<string> {
  return invoke("load_workflow", { project_id: projectId, workflow_id: workflowId });
}

export async function listWorkflows(projectId: string): Promise<FileEntry[]> {
  return invoke("list_workflows", { project_id: projectId });
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
    project_id: projectId,
    output_path: outputPath,
    format,
    include_apis: includeApis,
    include_theme: includeTheme,
    include_components: includeComponents,
    include_tests: includeTests,
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
    project_id: projectId,
    component_id: componentId,
    output_path: outputPath,
    format,
    include_types: includeTypes,
    include_storybook: includeStorybook,
    include_tests: includeTests,
  });
}
