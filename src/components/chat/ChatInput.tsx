import {
  useState,
  type DragEvent, type ClipboardEvent,
} from "react"
import { Send, ImageIcon, Brain } from "lucide-react"
import { readFile } from "@/lib/ipc"
import { MentionPicker } from "./MentionPicker"
import { AttachmentChip } from "./AttachmentChip"
import { MentionChip } from "./MentionChip"
import { PromptInput, PromptInputTextarea, PromptInputActions, PromptInputAction } from "@/components/ui/prompt-input"
import { FileUpload, FileUploadTrigger } from "@/components/ui/file-upload"
import type { AttachmentFile, MentionAsset } from "@/types/chat"

interface ChatInputProps {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  disabled: boolean
  attachments: AttachmentFile[]
  onAddAttachment: (file: AttachmentFile) => void
  onRemoveAttachment: (index: number) => void
  mentions: MentionAsset[]
  onAddMention: (asset: MentionAsset) => void
  onRemoveMention: (id: string) => void
  projectPath: string
  placeholder?: string
  thinkEnabled?: boolean
  onToggleThink?: () => void
  canThink?: boolean
}

export function ChatInput({
  value, onChange, onSend, disabled,
  attachments, onAddAttachment, onRemoveAttachment,
  mentions, onAddMention, onRemoveMention,
  thinkEnabled, onToggleThink, canThink,
  projectPath, placeholder = "Ask anything… type @ to reference assets",
}: ChatInputProps) {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  function handleChange(text: string) {
    onChange(text)
    const lastAt = text.lastIndexOf("@")
    if (lastAt !== -1) {
      const before = text[lastAt - 1]
      if (lastAt === 0 || before === " " || before === "\n") {
        const afterAt = text.slice(lastAt + 1)
        if (!afterAt.includes(" ") && !afterAt.includes("\n")) {
          setMentionQuery(afterAt)
          return
        }
      }
    }
    setMentionQuery(null)
  }

  function handleMentionSelect(asset: Omit<MentionAsset, "code">) {
    const lastAt = value.lastIndexOf("@")
    onChange(value.slice(0, lastAt))
    setMentionQuery(null)
    readFile(asset.path)
      .then((code) => onAddMention({ ...asset, code }))
      .catch(() => onAddMention({ ...asset, code: "" }))
  }

  async function processImageFile(file: File) {
    const base64 = await fileToBase64(file)
    const previewUrl = URL.createObjectURL(file)
    onAddAttachment({ name: file.name, size: file.size, mimeType: file.type, base64, previewUrl })
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const items = Array.from(e.clipboardData.items)
    const imageItem = items.find((item) => item.type.startsWith("image/"))
    if (imageItem) {
      e.preventDefault()
      const file = imageItem.getAsFile()
      if (file) processImageFile(file)
    }
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(true)
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragOver(false)

    // Project file drag from RunnerPanel
    const projectData = e.dataTransfer.getData("application/prototyper-asset")
    if (projectData) {
      try {
        const { filePath, assetType, assetName } = JSON.parse(projectData) as {
          filePath: string
          assetType: MentionAsset["type"]
          assetName: string
        }
        readFile(filePath)
          .then((code) => onAddMention({ id: assetName, type: assetType, name: assetName, path: filePath, code }))
          .catch(() => onAddMention({ id: assetName, type: assetType, name: assetName, path: filePath, code: "" }))
      } catch { /* invalid drop data */ }
      return
    }

    // Image file drop
    Array.from(e.dataTransfer.files).forEach((file) => {
      if (file.type.startsWith("image/")) processImageFile(file)
    })
  }

  function handleFileAdded(files: File[]) {
    files.forEach((file) => {
      if (file.type.startsWith("image/")) processImageFile(file)
    })
  }

  const hasChips = attachments.length > 0 || mentions.length > 0

  return (
    <div className="relative">
      {mentionQuery !== null && (
        <MentionPicker
          query={mentionQuery}
          projectPath={projectPath}
          onSelect={handleMentionSelect}
          onClose={() => setMentionQuery(null)}
        />
      )}
      <div
        className={`rounded-lg border transition-colors ${
          isDragOver ? "border-accent bg-accent/5" : "border-border bg-background"
        }`}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {hasChips && (
          <div className="flex flex-wrap gap-1 border-b border-border px-2 py-1.5">
            {mentions.map((m) => (
              <MentionChip key={m.id} asset={m} onRemove={() => onRemoveMention(m.id)} />
            ))}
            {attachments.map((a, i) => (
              <AttachmentChip key={i} file={a} onRemove={() => onRemoveAttachment(i)} />
            ))}
          </div>
        )}
        <PromptInput
          value={value}
          onValueChange={handleChange}
          onSubmit={onSend}
          disabled={disabled}
          maxHeight={120}
          className="border-0 shadow-none rounded-lg"
        >
          <PromptInputTextarea
            placeholder={placeholder}
            onPaste={handlePaste}
            onKeyDown={(e) => {
              if (e.key === "Escape") setMentionQuery(null)
            }}
          />
          <PromptInputActions>
            <PromptInputAction
              tooltip={canThink
                ? thinkEnabled ? "Thinking on — click to disable" : "Thinking off — click to enable"
                : "Model does not support thinking"
              }
            >
              <button
                onClick={canThink ? onToggleThink : undefined}
                className={`p-1 rounded transition-colors ${
                  canThink
                    ? thinkEnabled
                      ? "text-violet-400 bg-violet-500/10 hover:bg-violet-500/20"
                      : "text-muted-foreground hover:text-foreground"
                    : "text-muted-foreground/30 cursor-not-allowed"
                }`}
                type="button"
              >
                <Brain size={14} />
              </button>
            </PromptInputAction>
            <PromptInputAction tooltip="Attach image">
              <FileUpload onFilesAdded={handleFileAdded} accept="image/*" multiple>
                <FileUploadTrigger asChild>
                  <button
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    type="button"
                  >
                    <ImageIcon size={14} />
                  </button>
                </FileUploadTrigger>
              </FileUpload>
            </PromptInputAction>
            <PromptInputAction tooltip="Send">
              <button
                onClick={onSend}
                disabled={disabled || !value.trim()}
                className="rounded bg-accent px-2 py-1 text-accent-foreground disabled:opacity-40 transition-opacity"
                type="button"
              >
                <Send size={12} />
              </button>
            </PromptInputAction>
          </PromptInputActions>
        </PromptInput>
      </div>
    </div>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(",")[1])
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}