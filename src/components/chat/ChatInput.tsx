import { useRef, useState, type DragEvent, type ClipboardEvent, type KeyboardEvent } from "react"
import { Send, Square, ImageIcon, Brain, Wrench } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { readFile } from "@/lib/ipc"
import { MentionPicker, type PickerItem } from "./MentionPicker"
import { AttachmentChip } from "./AttachmentChip"
import { MentionChip } from "./MentionChip"
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
  /** Reasoning effort level for gpt-oss family (low/medium/high) */
  thinkLevel?: "low" | "medium" | "high"
  /** Set reasoning effort level for gpt-oss family */
  onSetThinkLevel?: (level: "low" | "medium" | "high") => void
  /** Whether current model is gpt-oss family (shows level selector instead of on/off toggle) */
  isGptOssFamily?: boolean
  canThink?: boolean
  canVision?: boolean
  toolsEnabled?: boolean
  onToggleTools?: () => void
  canTools?: boolean
  onStop?: () => void
}

export function ChatInput({
  value, onChange, onSend, disabled,
  attachments, onAddAttachment, onRemoveAttachment,
  mentions, onAddMention, onRemoveMention,
  thinkEnabled, onToggleThink, thinkLevel, onSetThinkLevel, isGptOssFamily,
  canThink, canVision, toolsEnabled, onToggleTools, canTools, onStop,
  projectPath, placeholder = "Ask anything… type @ to reference assets",
}: ChatInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [isDragOver, setIsDragOver] = useState(false)

  function handleChange(text: string) {
    onChange(text)
    // Auto-resize
    const el = textareaRef.current
    if (el) {
      el.style.height = "auto"
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`
    }
    // Mention detection
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

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Escape") { setMentionQuery(null); return }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      if (!disabled && value.trim()) onSend()
    }
  }

  function handleMentionSelect(item: PickerItem) {
    const lastAt = value.lastIndexOf("@")
    onChange(value.slice(0, lastAt))
    setMentionQuery(null)
    if (item.preCode !== undefined) {
      // API (or other eagerly-loaded) asset — code is already available
      const { preCode, ...rest } = item
      onAddMention({ ...rest, code: preCode })
    } else {
      readFile(item.path)
        .then((code) => onAddMention({ ...item, code }))
        .catch(() => onAddMention({ ...item, code: "" }))
    }
  }

  async function processImageFile(file: File) {
    const base64 = await fileToBase64(file)
    const previewUrl = URL.createObjectURL(file)
    onAddAttachment({ name: file.name, size: file.size, mimeType: file.type, base64, previewUrl })
  }

  function handlePaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    const imageItem = Array.from(e.clipboardData.items).find((i) => i.type.startsWith("image/"))
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
    const projectData = e.dataTransfer.getData("application/prototyper-asset")
    if (projectData) {
      try {
        const { filePath, assetType, assetName } = JSON.parse(projectData) as {
          filePath: string; assetType: MentionAsset["type"]; assetName: string
        }
        readFile(filePath)
          .then((code) => onAddMention({ id: assetName, type: assetType, name: assetName, path: filePath, code }))
          .catch(() => onAddMention({ id: assetName, type: assetType, name: assetName, path: filePath, code: "" }))
      } catch { /* invalid drop */ }
      return
    }
    Array.from(e.dataTransfer.files).forEach((f) => { if (f.type.startsWith("image/")) processImageFile(f) })
  }

  const hasChips = attachments.length > 0 || mentions.length > 0

  return (
    <div className="relative">
      {mentionQuery !== null && (
        <MentionPicker
          query={mentionQuery}
          projectPath={projectPath}
          onSelect={(item) => handleMentionSelect(item)}
          onClose={() => setMentionQuery(null)}
        />
      )}

      <div
        className={`rounded-lg border transition-colors ${isDragOver ? "border-accent bg-accent/5" : "border-border bg-background"}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={handleDrop}
      >
        {/* Chips row */}
        {hasChips && (
          <div className="flex flex-wrap gap-1 border-b border-border px-2 pt-2 pb-1.5">
            {mentions.map((m) => (
              <MentionChip key={m.id} asset={m} onRemove={() => onRemoveMention(m.id)} />
            ))}
            {attachments.map((a, i) => (
              <AttachmentChip key={i} file={a} onRemove={() => onRemoveAttachment(i)} />
            ))}
          </div>
        )}

        {/* Textarea */}
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={placeholder}
          disabled={disabled}
          rows={1}
          className="chat-textarea"
          style={{ minHeight: 36, maxHeight: 160 }}
        />

        {/* Actions row */}
        <div className="flex items-center justify-between px-2 pb-2">
          <div className="flex items-center gap-1">
            <TooltipProvider>
              {isGptOssFamily ? (
                /* Reasoning effort selector for gpt-oss family */
                <Tooltip>
                  <TooltipTrigger asChild>
                    <ToggleGroup
                      type="single"
                      value={thinkLevel ?? "medium"}
                      onValueChange={(v) => v && onSetThinkLevel?.(v as "low" | "medium" | "high")}
                      className="h-6 gap-0"
                    >
                      <ToggleGroupItem
                        value="low"
                        className="h-6 px-1.5 text-xs data-[state=off]:text-muted-foreground data-[state=on]:text-violet-400 data-[state=on]:bg-violet-500/10"
                      >
                        L
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="medium"
                        className="h-6 px-1.5 text-xs data-[state=off]:text-muted-foreground data-[state=on]:text-violet-400 data-[state=on]:bg-violet-500/10"
                      >
                        M
                      </ToggleGroupItem>
                      <ToggleGroupItem
                        value="high"
                        className="h-6 px-1.5 text-xs data-[state=off]:text-muted-foreground data-[state=on]:text-violet-400 data-[state=on]:bg-violet-500/10"
                      >
                        H
                      </ToggleGroupItem>
                    </ToggleGroup>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    Reasoning effort level (gpt-oss always thinks)
                  </TooltipContent>
                </Tooltip>
              ) : (
                /* Regular on/off toggle for non-gpt-oss models */
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={canThink ? onToggleThink : undefined}
                      className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
                        canThink
                          ? thinkEnabled
                            ? "text-violet-400 bg-violet-500/10 hover:bg-violet-500/20"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted"
                          : "text-muted-foreground/30 cursor-not-allowed"
                      }`}
                    >
                      <Brain size={13} />
                      {thinkEnabled && canThink && <span>Thinking</span>}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {canThink
                      ? thinkEnabled ? "Thinking on — click to disable" : "Thinking off — click to enable"
                      : "Model does not support thinking"}
                  </TooltipContent>
                </Tooltip>
              )}
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    onClick={canTools ? onToggleTools : undefined}
                    className={`flex items-center gap-1 rounded px-1.5 py-1 text-xs transition-colors ${
                      canTools
                        ? toolsEnabled
                          ? "text-amber-400 bg-amber-500/10 hover:bg-amber-500/20"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted"
                        : "text-muted-foreground/30 cursor-not-allowed"
                    }`}
                  >
                    <Wrench size={13} />
                    {toolsEnabled && canTools && <span>Tools</span>}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {canTools
                    ? toolsEnabled ? "Tools on — click to disable" : "Tools off — click to enable"
                    : "Model does not support tool calling"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>

            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  {canVision ? (
                    <FileUpload onFilesAdded={(files) => files.forEach((f) => { if (f.type.startsWith("image/")) processImageFile(f) })} accept="image/*" multiple>
                      <FileUploadTrigger asChild>
                        <button
                          type="button"
                          className="rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                        >
                          <ImageIcon size={13} />
                        </button>
                      </FileUploadTrigger>
                    </FileUpload>
                  ) : (
                    <button
                      type="button"
                      disabled
                      className="rounded p-1 text-muted-foreground/30 cursor-not-allowed"
                    >
                      <ImageIcon size={13} />
                    </button>
                  )}
                </TooltipTrigger>
                <TooltipContent side="top">
                  {canVision ? "Attach image" : "Model does not support vision"}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {disabled && onStop ? (
            <Button type="button" size="sm" variant="destructive" onClick={onStop} className="px-2.5 py-1 h-auto">
              <Square size={12} />
            </Button>
          ) : (
            <Button type="button" size="sm" onClick={onSend} disabled={disabled || !value.trim()} className="px-2.5 py-1 h-auto">
              <Send size={12} />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve((reader.result as string).split(",")[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
