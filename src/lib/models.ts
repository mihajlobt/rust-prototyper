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


export type Provider = "ollama-local" | "ollama-cloud" | "openai" | "claude"

export function getProviderIcon(provider: Provider): "server" | "cloud" | "openai" | "anthropic" {
  switch (provider) {
    case "ollama-local": return "server"
    case "ollama-cloud": return "cloud"
    case "openai": return "openai"
    case "claude": return "anthropic"
  }
}