export interface StaticModel {
  id: string;
  name: string;
}

export const OPENAI_MODELS: StaticModel[] = [
  { id: "gpt-4o",       name: "GPT-4o" },
  { id: "gpt-4o-mini",  name: "GPT-4o Mini" },
  { id: "o3-mini",      name: "o3 Mini" },
  { id: "o1",           name: "o1" },
];

export const ANTHROPIC_MODELS: StaticModel[] = [
  { id: "claude-opus-4-7",           name: "Claude Opus 4.7" },
  { id: "claude-sonnet-4-6",         name: "Claude Sonnet 4.6" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5" },
];

export function getProviderIcon(modelId: string): "server" | "cloud" | "openai" | "anthropic" | "unknown" {
  if (modelId.startsWith("gpt-") || modelId.startsWith("o1") || modelId.startsWith("o3")) return "openai";
  if (modelId.startsWith("claude-")) return "anthropic";
  return "unknown";
}