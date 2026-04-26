import { useQuery } from "@tanstack/react-query"
import {
  listOllamaModels,
  type OllamaModel,
} from "@/lib/ipc"
import { useAppStore } from "@/stores/appStore"

type Capabilities = {
  thinking: boolean
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
  return {
    thinking: c.includes("thinking"),
    vision: c.includes("vision"),
    tools: c.includes("tools"),
    contextLength: model.contextLength,
    loading: false,
  }
}

export function useModelCapabilities(modelId: string): Capabilities {
  const settings = useAppStore((s) => s.settings)

  const provider = settings.provider
  const isOllama = provider === "ollama"
  const isCloud = isOllama && settings.ollamaCloudModels.includes(modelId)
  const queryHost = isCloud ? "https://ollama.com" : settings.host
  const queryApiKey = isCloud ? (settings.apiKeys["ollama"] || "") : ""

  // Per docs/api/tanstack-query.md: useQuery with enabled to control when queries run
  // Hook must always be called to satisfy React's rules of hooks
  const query = useQuery({
    queryKey: ["ollama-models", isCloud ? "cloud" : "local", isCloud ? queryApiKey : queryHost],
    queryFn: () => listOllamaModels(queryHost, queryApiKey),
    enabled: isOllama && !!queryHost,
    select: (models: OllamaModel[]): Capabilities => {
      const model = models.find((m) => m.id === modelId)
      if (!model) return EMPTY_CAPS
      return toCaps(model)
    },
    staleTime: 30_000,
    retry: 1,
  })

  // Non-Ollama providers — return static capabilities
  if (!isOllama) {
    return PROVIDER_CAPS[provider] ?? EMPTY_CAPS
  }

  // Ollama models — from query cache (shared with ModelPicker)
  if (query.isPending) return { ...EMPTY_CAPS, loading: true }
  if (query.isError || !query.data) return EMPTY_CAPS
  return query.data
}