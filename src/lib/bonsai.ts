import { invoke } from "@tauri-apps/api/core";

export interface BonsaiServerConfig {
  install_path: string;
  port: number;
  variant: string;
  auto_start: boolean;
  auto_stop_timeout_secs: number;
  max_memory_gb: number;
}

export interface BonsaiServerInfo {
  port: number;
  pid: number;
  healthy: boolean;
  kind: string;
  supported_families: string[];
  default_family: string;
}

export interface BonsaiServerStatus {
  healthy: boolean;
  kind: string;
  supported_families: string[];
  default_family: string;
}

export interface BonsaiGenerateResult {
  /** Relative path from app data dir (e.g. "projects/default/assets/bonsai_xxx.png") */
  relative_path: string;
  file_name: string;
  width: number;
  height: number;
  seed: number;
}

export interface AssetInfo {
  file_name: string;
  /** Relative path from app data dir */
  relative_path: string;
  file_size: number;
  created_at: number;
}

export async function bonsaiStartServer(): Promise<BonsaiServerInfo> {
  return invoke("bonsai_start_server");
}

export async function bonsaiStopServer(): Promise<void> {
  return invoke("bonsai_stop_server");
}

export async function bonsaiServerStatus(): Promise<BonsaiServerStatus> {
  return invoke("bonsai_server_status");
}

export async function bonsaiGenerateImage(params: {
  projectId: string;
  prompt: string;
  width?: number;
  height?: number;
  steps?: number;
  seed?: number;
  backend?: string;
}): Promise<BonsaiGenerateResult> {
  return invoke("bonsai_generate_image", {
    projectId: params.projectId,
    prompt: params.prompt,
    width: params.width ?? null,
    height: params.height ?? null,
    steps: params.steps ?? null,
    seed: params.seed ?? null,
    backend: params.backend ?? null,
  });
}

export async function bonsaiListAssets(projectId: string): Promise<AssetInfo[]> {
  return invoke("bonsai_list_assets", { projectId });
}

export async function bonsaiDeleteAsset(projectId: string, fileName: string): Promise<void> {
  return invoke("bonsai_delete_asset", { projectId, fileName });
}

export async function bonsaiGetServerConfig(): Promise<BonsaiServerConfig> {
  return invoke("bonsai_get_server_config");
}

export async function bonsaiSaveServerConfig(config: BonsaiServerConfig): Promise<void> {
  return invoke("bonsai_save_server_config", { config });
}

export async function bonsaiScheduleStop(): Promise<void> {
  return invoke("bonsai_schedule_stop");
}

export async function bonsaiCancelStop(): Promise<void> {
  return invoke("bonsai_cancel_stop");
}