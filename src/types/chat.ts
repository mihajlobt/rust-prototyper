export interface ToolCallRecord {
  tool: string
  path: string
}

export interface ChatMessage {
  role: "user" | "assistant"
  content: string
  images?: string[]
  blocks?: MessageBlock[]
  toolCalls?: ToolCallRecord[]
}

export type MessageBlock =
  | { type: "thinking"; content: string; collapsed: boolean }
  | { type: "text"; content: string }

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
