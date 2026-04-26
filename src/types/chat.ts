export interface ToolCallRecord {
  tool: string
  path: string
  arguments: Record<string, unknown>
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  thinking?: string
  images?: string[]
  toolCalls?: ToolCallRecord[]
}

export interface MentionAsset {
  id: string
  type: "component" | "theme" | "screen"
  name: string
  path: string
  code: string
}

export interface AttachmentFile {
  name: string
  size: number
  mimeType: string
  base64: string
  previewUrl: string
}
