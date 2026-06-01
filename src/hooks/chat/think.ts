/** Resolves the think parameter to send to Ollama based on model capabilities and user toggle.
 *  - gpt-oss family: always sends a level (low/medium/high), can't fully disable
 *  - Other models: sends false to disable, true/level to enable, undefined if model doesn't support */
export function resolveThinkParam(
  caps: { thinking: boolean; thinkLevel?: "low" | "medium" | "high" },
  isGptOssFamily: boolean,
  thinkEnabled: boolean,
  thinkLevel: "low" | "medium" | "high",
): boolean | "low" | "medium" | "high" | undefined {
  if (!caps.thinking) return undefined

  if (isGptOssFamily) {
    return thinkEnabled ? thinkLevel : "low"
  }

  return thinkEnabled ? (caps.thinkLevel ?? true) : undefined
}
