import type { TokenUsage } from "@/lib/ipc"

export interface ToolCallRecord {
  tool: string
  path: string
  arguments: Record<string, unknown>
  result?: string
  success?: boolean
  pending?: boolean
}

export interface ToolPermissionRecord {
  requestId: number
  tool: string
  args: Record<string, unknown>
  pending: boolean
  decision?: "accepted" | "rejected" | "always_allowed"
}

/** One ResearchPhase tick from a research-mode run, kept for the lifetime of the message. */
export interface ResearchPhaseEntry {
  phase: string
  round: number
  maxRounds: number
  detail: string | null
  sources: number
  outcome: string | null
}

/// Groups thinking/text that arrived between tool invocations
export interface StreamChunk {
  /** Ordered index for rendering */
  index: number
  /** Combined thinking accumulated since last tool result */
  thinking: string
  /** Text content accumulated since last tool result */
  text: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  thinking?: string
  images?: string[]
  /** Referenced assets (@mentions) stored as compact display metadata */
  mentions?: Array<{ type: MentionAsset["type"]; name: string; description?: string }>
  /** Design brief that was active when the message was sent */
  brief?: string
  toolCalls?: ToolCallRecord[]
  /** Thinking/text chunks grouped by tool boundaries for cursor-like display */
  streamChunks?: StreamChunk[]
  /** Real token usage from the most recent agent-loop turn (current context window occupancy). */
  usage?: TokenUsage
  /** Research-mode progress log for this message — persisted so the card survives reload/tab-switch. */
  researchLog?: ResearchPhaseEntry[]
}

export interface MentionAsset {
  id: string
  type: "component" | "theme" | "screen" | "api" | "file" | "plan"
  name: string
  path: string
  code: string
  description?: string
}

export interface AttachmentFile {
  name: string
  size: number
  mimeType: string
  base64: string
  previewUrl: string
}
