import type { Provider } from "@/stores/appStore"

export interface ContextWindow {
  /** Token count to use as the denominator for usage display and compaction. */
  value: number
  /** True when `value` is `caps.contextLength` (architecture max), not a confirmed Ollama window — see https://github.com/ollama/ollama/blob/main/docs/faq.mdx (default 4096, unqueryable). */
  isUpperBound: boolean
}

/** Priority: numCtx > modelfileNumCtx > contextLength (exact for cloud/claude/openai, https://github.com/ollama/ollama/blob/main/docs/context-length.mdx, else upper bound for ollama-local) > 8192. */
export function getEffectiveContextWindow(
  provider: Provider,
  numCtx: number | undefined,
  modelfileNumCtx: number | undefined,
  contextLength: number | undefined,
): ContextWindow {
  if (numCtx) return { value: numCtx, isUpperBound: false }
  if (modelfileNumCtx) return { value: modelfileNumCtx, isUpperBound: false }
  return { value: contextLength ?? 8192, isUpperBound: provider === "ollama-local" }
}
