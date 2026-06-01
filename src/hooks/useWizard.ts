import { useState, useCallback, useRef, useMemo, useEffect } from "react"
import { Channel } from "@tauri-apps/api/core"
import {
  generateCompletionStream,
  stopGenerationRequest,
  getHostForProvider,
  getApiKeyForProvider,
  getErrorMessage,
  type CompletionEvent,
  type AskUserQuestionType,
  type Message,
} from "@/lib/ipc"
import type { MentionAsset } from "@/types/chat"
import { useAppStore } from "@/stores/appStore"
import { useProjectSettingsStore } from "@/stores/projectSettingsStore"
import { useDevServerStore } from "@/lib/dev-server-manager"
import { useModelCapabilities } from "@/hooks/useModelCapabilities"
import { resolveThinkParam } from "@/hooks/chat/think"
import { hasGeneratedScaffold } from "@/lib/scaffold"
import { getWizardSystemPrompt } from "@/lib/prompts/wizard"
import { designLanguageSpecSchema } from "@/lib/design/spec"
import * as z from "zod/v4"
import { notify } from "@/hooks/useToast"

export interface WizardToolCall {
  tool: string
  args: Record<string, unknown>
  result?: string
  success?: boolean
  pending: boolean
}

export interface WizardMessage {
  id: string
  role: "user" | "assistant"
  content: string
  thinking?: string
  toolCalls: WizardToolCall[]
}

export interface WizardAnnotation {
  id: string
  type: "point" | "region"
  x: number
  y: number
  w?: number
  h?: number
  text: string
  resolved: boolean
  createdAt: number
}

export interface PendingAskUser {
  requestId: number
  question: string
  questionType: AskUserQuestionType
  choices?: string[]
}

export type WizardPhase = "idle" | "running" | "awaiting_answer" | "complete" | "error"

export interface UseWizardResult {
  phase: WizardPhase
  messages: WizardMessage[]
  streamingThinking: string
  pendingAskUser: PendingAskUser | null
  annotations: WizardAnnotation[]
  devUrl: string | null
  mentions: MentionAsset[]
  systemPrompt: string
  thinkEnabled: boolean
  thinkLevel: "low" | "medium" | "high"
  isGptOssFamily: boolean
  canThink: boolean
  canVision: boolean
  canTools: boolean
  toggleThink: () => void
  setThinkLevel: (level: "low" | "medium" | "high") => void
  start: (prompt: string) => void
  sendFollowUp: (text: string) => void
  resolveAskUserResponse: () => void
  addAnnotation: (annotation: Omit<WizardAnnotation, "id" | "createdAt">) => void
  removeAnnotation: (id: string) => void
  resolveAnnotation: (id: string) => void
  addMention: (asset: MentionAsset) => void
  removeMention: (id: string) => void
  stopGeneration: () => void
  resetWizard: () => void
}

function makeId(): string {
  return Math.random().toString(36).slice(2, 10)
}

function serializeAnnotations(annotations: WizardAnnotation[]): string {
  const open = annotations.filter((a) => !a.resolved)
  if (open.length === 0) return ""
  const lines = open.map((a, i) => {
    if (a.type === "region" && a.w !== undefined && a.h !== undefined) {
      return `${i + 1}. [REGION ${a.x.toFixed(0)}%,${a.y.toFixed(0)}% → ${(a.x + a.w).toFixed(0)}%,${(a.y + a.h).toFixed(0)}%] "${a.text}"`
    }
    return `${i + 1}. [POINT ${a.x.toFixed(0)}%,${a.y.toFixed(0)}%] "${a.text}"`
  })
  return `\n\n[VISUAL ANNOTATIONS — user's feedback on the live preview]\n${lines.join("\n")}`
}

export function useWizard(): UseWizardResult {
  const { settings } = useAppStore()
  const { ps, setProjectSettings } = useProjectSettingsStore()
  const devServerStore = useDevServerStore()
  const caps = useModelCapabilities(settings.modelId)
  const isGptOssFamily = caps.family === "gptoss"

  const [thinkEnabled, setThinkEnabled] = useState(false)
  const [thinkLevel, setThinkLevel] = useState<"low" | "medium" | "high">("medium")

  // Auto-enable thinking when model supports it — same logic as useChat.ts
  useEffect(() => {
    if (caps.thinking) {
      setThinkEnabled(true)
      if (caps.thinkLevel) setThinkLevel(caps.thinkLevel)
    } else {
      setThinkEnabled(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.modelId, caps.thinking, caps.thinkLevel])

  const [phase, setPhase] = useState<WizardPhase>("idle")
  const [messages, setMessages] = useState<WizardMessage[]>([])
  const [streamingThinking, setStreamingThinking] = useState("")
  const [pendingAskUser, setPendingAskUser] = useState<PendingAskUser | null>(null)
  const [annotations, setAnnotations] = useState<WizardAnnotation[]>([])
  const [mentions, setMentions] = useState<MentionAsset[]>([])
  const devUrl = devServerStore.runnerUrl

  const activeRequestIdRef = useRef<number | null>(null)
  const stopRef = useRef(false)
  const pendingThemeSlugRef = useRef<string | null>(null)

  const cachedSystemPrompt = useMemo((): string => {
    const schemaJson = JSON.stringify(z.toJSONSchema(designLanguageSpecSchema), null, 2)
    return getWizardSystemPrompt(settings.project, schemaJson)
  }, [settings.project])

  // Stable reference for callbacks that need to read the current prompt
  const cachedSystemPromptRef = useRef(cachedSystemPrompt)
  cachedSystemPromptRef.current = cachedSystemPrompt

  const getSystemPrompt = useCallback((): string => cachedSystemPromptRef.current, [])

  const getOutputPath = useCallback((): string => {
    return `projects/${settings.project}/generated/src/pages/home.tsx`
  }, [settings.project])

  const runStream = useCallback((userMessages: WizardMessage[], systemPrompt: string) => {
    const host = getHostForProvider(settings.provider, settings.host)
    const apiKey = getApiKeyForProvider(settings.provider, settings.apiKeys)
    const outputPath = getOutputPath()

    // Build sequential Message[] — system first, then user/assistant/tool in turn order
    const apiMessages: Message[] = [{ role: "system", content: systemPrompt }]
    for (const m of userMessages) {
      if (m.role === "user") {
        apiMessages.push({ role: "user", content: m.content })
      } else if (m.role === "assistant") {
        if (m.toolCalls.length > 0) {
          apiMessages.push({
            role: "assistant",
            content: m.content,
            ...(m.thinking ? { thinking: m.thinking } : {}),
            tool_calls: m.toolCalls.map((tc) => ({
              function: { name: tc.tool, arguments: tc.args },
            })),
          })
          for (const tc of m.toolCalls) {
            if (tc.result !== undefined) {
              apiMessages.push({ role: "tool", content: tc.result, tool_name: tc.tool })
            }
          }
        } else {
          apiMessages.push({
            role: "assistant",
            content: m.content,
            ...(m.thinking ? { thinking: m.thinking } : {}),
          })
        }
      }
    }

    const channel = new Channel<CompletionEvent>()
    let contentAccumulated = ""
    let thinkingAccumulated = ""
    const assistantId = makeId()

    setMessages((prev) => [
      ...prev,
      { id: assistantId, role: "assistant", content: "", toolCalls: [] },
    ])

    channel.onmessage = (msg) => {
      if (stopRef.current) return

      if (msg.event === "Chunk") {
        if (msg.data.thinking) thinkingAccumulated += msg.data.thinking
        if (msg.data.text) contentAccumulated += msg.data.text
        setStreamingThinking(thinkingAccumulated)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, content: contentAccumulated, thinking: thinkingAccumulated || undefined }
              : m,
          ),
        )
      } else if (msg.event === "ToolCall") {
        // Track set_active_theme slug so ToolResult can apply it in-memory
        if (msg.data.tool === "set_active_theme") {
          pendingThemeSlugRef.current = String(msg.data.args.theme_slug ?? "")
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  toolCalls: [
                    ...m.toolCalls,
                    { tool: msg.data.tool, args: msg.data.args, pending: true },
                  ],
                }
              : m,
          ),
        )
      } else if (msg.event === "AskUser") {
        setPendingAskUser({
          requestId: msg.data.request_id,
          question: msg.data.question,
          questionType: msg.data.question_type,
          choices: msg.data.choices,
        })
        setPhase("awaiting_answer")
      } else if (msg.event === "ToolResult") {
        // Apply set_active_theme in-memory immediately so the active theme updates
        // without requiring a project reload (the Rust side wrote to the store file).
        if (msg.data.tool === "set_active_theme" && msg.data.success && pendingThemeSlugRef.current) {
          setProjectSettings({ stylePreset: pendingThemeSlugRef.current })
          pendingThemeSlugRef.current = null
        }
        setPendingAskUser(null)
        setPhase("running")
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantId) return m
            const toolCalls = m.toolCalls.map((tc) =>
              tc.tool === msg.data.tool && tc.pending
                ? { ...tc, result: msg.data.output, success: msg.data.success, pending: false }
                : tc,
            )
            return { ...m, toolCalls }
          }),
        )
      } else if (msg.event === "Done") {
        activeRequestIdRef.current = null
        setPhase("complete")
        setStreamingThinking("")
        const projectDir = `projects/${settings.project}`
        const generatedDir = `${projectDir}/generated`
        hasGeneratedScaffold(projectDir).then((ready) => {
          if (ready) devServerStore.startRunner(generatedDir, ps.runnerPort).catch(() => {})
        }).catch(() => {})
      } else if (msg.event === "Error") {
        activeRequestIdRef.current = null
        setPhase("error")
        setStreamingThinking("")
        notify.error("Wizard error", msg.data.message)
      }
    }

    const effectiveMaxToolCalls = settings.panelMaxToolCalls.wizard ?? 50
    const thinkParam = resolveThinkParam(caps, isGptOssFamily, thinkEnabled, thinkLevel)

    generateCompletionStream(
      settings.modelId,
      apiMessages,
      host,
      apiKey,
      channel,
      thinkParam,
      outputPath,
      settings.provider,
      undefined,
      "auto_accept_all",
      [],
      undefined,
      effectiveMaxToolCalls,
    ).then((requestId) => {
      activeRequestIdRef.current = requestId
    }).catch((err: unknown) => {
      setPhase("error")
      notify.error("Wizard failed to start", getErrorMessage(err))
    })
  }, [settings, ps.runnerPort, getOutputPath, devServerStore, caps, isGptOssFamily, thinkEnabled, thinkLevel])

  const start = useCallback((prompt: string) => {
    stopRef.current = false
    setPendingAskUser(null)

    const userMessage: WizardMessage = {
      id: makeId(),
      role: "user",
      content: prompt,
      toolCalls: [],
    }
    setMessages([userMessage])
    setPhase("running")
    runStream([userMessage], getSystemPrompt())
  }, [runStream, getSystemPrompt])

  const addMention = useCallback((asset: MentionAsset) => {
    setMentions((prev) => [...prev.filter((m) => m.id !== asset.id), asset])
  }, [])

  const removeMention = useCallback((id: string) => {
    setMentions((prev) => prev.filter((m) => m.id !== id))
  }, [])

  const sendFollowUp = useCallback((text: string) => {
    if (phase === "running" || phase === "idle") return

    const annotationContext = serializeAnnotations(annotations)
    const mentionContext = mentions
      .map((m) => {
        if (m.type === "api") {
          const slug = m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
          const hookName = "use" + m.name.replace(/[^a-zA-Z0-9]+(.)?/g, (_: string, c: string) => (c ? c.toUpperCase() : "")).replace(/^./, (c: string) => c.toUpperCase())
          return `<!-- @${m.name} -->\nAPI available: ${m.name}\n${m.code}\nService hook: import { ${hookName} } from '@/services/${slug}'\n<!-- end @${m.name} -->`
        }
        const lang = m.type === "theme" ? "css" : m.type === "file" ? "md" : "tsx"
        return `<!-- @${m.name} -->\n\`\`\`${lang}\n${m.code}\n\`\`\`\n<!-- end @${m.name} -->`
      })
      .join("\n\n")

    const fullText = [mentionContext, text, annotationContext].filter(Boolean).join("\n\n")

    // Mark annotations as resolved and clear mentions
    if (annotationContext) {
      setAnnotations((prev) => prev.map((a) => ({ ...a, resolved: true })))
    }
    setMentions([])

    const userMessage: WizardMessage = {
      id: makeId(),
      role: "user",
      content: fullText,
      toolCalls: [],
    }

    setMessages((prev) => {
      const updated = [...prev, userMessage]
      runStream(updated, getSystemPrompt())
      return updated
    })
    setPhase("running")
  }, [phase, annotations, runStream, getSystemPrompt])

  const resolveAskUserResponse = useCallback(() => {
    setPendingAskUser(null)
    setPhase("running")
  }, [])

  const stopGeneration = useCallback(() => {
    stopRef.current = true
    if (activeRequestIdRef.current !== null) {
      stopGenerationRequest(activeRequestIdRef.current).catch(() => {})
      activeRequestIdRef.current = null
    }
    setPhase("idle")
  }, [])

  const addAnnotation = useCallback((annotation: Omit<WizardAnnotation, "id" | "createdAt">) => {
    setAnnotations((prev) => [
      ...prev,
      { ...annotation, id: makeId(), createdAt: Date.now() },
    ])
  }, [])

  const removeAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id))
  }, [])

  const resolveAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)))
  }, [])

  const resetWizard = useCallback(() => {
    stopGeneration()
    setMessages([])
    setPendingAskUser(null)
    setAnnotations([])
    setMentions([])
    setStreamingThinking("")
    setPhase("idle")
  }, [stopGeneration])

  return {
    phase,
    messages,
    streamingThinking,
    pendingAskUser,
    annotations,
    devUrl,
    mentions,
    systemPrompt: cachedSystemPrompt,
    thinkEnabled,
    thinkLevel,
    isGptOssFamily,
    canThink: caps.thinking,
    canVision: caps.vision,
    canTools: caps.tools,
    toggleThink: () => setThinkEnabled((v) => !v),
    setThinkLevel,
    start,
    sendFollowUp,
    resolveAskUserResponse,
    addAnnotation,
    removeAnnotation,
    resolveAnnotation,
    addMention,
    removeMention,
    stopGeneration,
    resetWizard,
  }
}
