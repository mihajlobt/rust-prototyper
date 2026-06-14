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
  modelfileNumCtx?: number
  loading: boolean
  /** Model family from Ollama API (e.g., "gptoss", "gemma4", "qwen35") */
  family?: string
}

const PROVIDER_CAPS: Record<string, Capabilities> = {
  openai: { thinking: false, vision: true, tools: true, contextLength: 128000, loading: false, family: undefined },
}

// Claude capabilities vary by model — detected in useModelCapabilities below.
function claudeCaps(modelId: string): Capabilities {
  // Extended thinking: claude-3-7-sonnet and all claude 4.x models
  const thinking = /claude-3-7|claude-(opus|sonnet|haiku)-4/.test(modelId)
  return { thinking, vision: true, tools: true, contextLength: 200000, loading: false, family: "claude" }
}

const EMPTY_CAPS: Capabilities = { thinking: false, vision: false, tools: false, loading: false, family: undefined }

function toCaps(model: OllamaModel): Capabilities {
  const c = model.capabilities
  const isGptOss = model.family === "gptoss"
  return {
    thinking: c.includes("thinking"),
    thinkLevel: isGptOss && c.includes("thinking") ? "medium" : undefined,
    vision: c.includes("vision"),
    tools: c.includes("tools"),
    contextLength: model.contextLength,
    modelfileNumCtx: model.modelfileNumCtx,
    loading: false,
    family: model.family,
  }
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

  // Non-Ollama providers — return static or model-specific capabilities
  if (!isOllama) {
    if (provider === "claude") return claudeCaps(modelId)
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

  // Model not in list
  return EMPTY_CAPS
}
