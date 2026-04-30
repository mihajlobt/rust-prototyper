import { useQuery } from "@tanstack/react-query"
import {
  listOllamaModels,
  type OllamaModel,
} from "@/lib/ipc"
import { useAppStore } from "@/stores/appStore"

type ThinkLevel = "low" | "medium" | "high"

type Capabilities = {
  thinking: boolean
  thinkLevel?: ThinkLevel
  vision: boolean
  tools: boolean
  contextLength?: number
  loading: boolean
}

const PROVIDER_CAPS: Record<string, Capabilities> = {
  openai:  { thinking: false, vision: true,  tools: true, contextLength: 128000, loading: false },
  claude:  { thinking: false, vision: true,  tools: true, contextLength: 200000, loading: false },
}

const EMPTY_CAPS: Capabilities = { thinking: false, vision: false, tools: false, loading: false }

function toCaps(model: OllamaModel): Capabilities {
  const c = model.capabilities
  const isGptOss = model.id.toLowerCase().includes("gpt-oss")
  return {
    thinking: c.includes("thinking"),
    thinkLevel: isGptOss && c.includes("thinking") ? "medium" : undefined,
    vision: c.includes("vision"),
    tools: c.includes("tools"),
    contextLength: model.contextLength,
    loading: false,
  }
}

function isKnownToolCapableModel(modelId: string): boolean {
  const n = modelId.toLowerCase()
  return n.includes("gemma4") || n.includes("gemma3") || n.includes("qwen3") ||
         n.includes("qwen2.5") || n.includes("mistral") || n.includes("llava") ||
         n.includes("command-r") || n.includes("deepseek") || n.includes("llama3") ||
         n.includes("phi4") || n.includes("gpt-oss")
}

export function useModelCapabilities(modelId: string): Capabilities {
  const settings = useAppStore((s) => s.settings)

  const provider = settings.provider
  const isOllama = provider.startsWith("ollama")

  // Always call hooks (no conditional calls), but disable when not Ollama
  const localQuery = useQuery({
    queryKey: ["ollama-models", "local", settings.host],
    queryFn: () => listOllamaModels(settings.host, ""),
    enabled: isOllama && !!settings.host,
    staleTime: 30_000,
    retry: 1,
  })

  const cloudQuery = useQuery({
    queryKey: ["ollama-models", "cloud", settings.apiKeys["ollama"] || ""],
    queryFn: () => listOllamaModels("https://ollama.com", settings.apiKeys["ollama"] || ""),
    enabled: isOllama && !!settings.apiKeys["ollama"],
    staleTime: 60_000,
    retry: 1,
  })

  // Non-Ollama providers — return static capabilities
  if (!isOllama) {
    return PROVIDER_CAPS[provider] ?? EMPTY_CAPS
  }

  // If local query has the model, use it
  if (!localQuery.isPending && !localQuery.isError && localQuery.data) {
    const localModel = localQuery.data.find((m) => m.id === modelId)
    if (localModel) return toCaps(localModel)
  }

  // If model not in local list, check cloud models (for cloud-sourced models)
  if (!cloudQuery.isPending && !cloudQuery.isError && cloudQuery.data) {
    const cloudModel = cloudQuery.data.find((m) => m.id === modelId)
    if (cloudModel) return toCaps(cloudModel)
  }

  // Model not found in either list — fall back to known capability heuristics
  // This handles cases where list_ollama_models doesn't return the expected model
  if (isKnownToolCapableModel(modelId)) {
    const isGptOss = modelId.toLowerCase().includes("gpt-oss")
    return { thinking: isGptOss, thinkLevel: isGptOss ? "medium" as ThinkLevel : undefined, vision: false, tools: true, loading: false }
  }

  return EMPTY_CAPS
}