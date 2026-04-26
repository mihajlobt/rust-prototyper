export interface StaticModel {
  id: string;
  name: string;
  provider: "openai" | "claude";
}

export const OPENAI_MODELS: StaticModel[] = [
  { id: "gpt-4o",       name: "GPT-4o",       provider: "openai" },
  { id: "gpt-4o-mini",  name: "GPT-4o Mini",  provider: "openai" },
  { id: "o3-mini",      name: "o3 Mini",      provider: "openai" },
  { id: "o1",           name: "o1",           provider: "openai" },
];

export const ANTHROPIC_MODELS: StaticModel[] = [
  { id: "claude-opus-4-7",           name: "Claude Opus 4.7",           provider: "claude" },
  { id: "claude-sonnet-4-6",         name: "Claude Sonnet 4.6",         provider: "claude" },
  { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5",           provider: "claude" },
];

export type Provider = "ollama-local" | "ollama-cloud" | "openai" | "claude"

export function getProviderIcon(provider: Provider): "server" | "cloud" | "openai" | "anthropic" {
  switch (provider) {
    case "ollama-local": return "server"
    case "ollama-cloud": return "cloud"
    case "openai": return "openai"
    case "claude": return "anthropic"
  }
}