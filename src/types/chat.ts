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
  toolCalls?: ToolCallRecord[]
  /** Thinking/text chunks grouped by tool boundaries for cursor-like display */
  streamChunks?: StreamChunk[]
}

export interface MentionAsset {
  id: string
  type: "component" | "theme" | "screen" | "api"
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
