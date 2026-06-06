import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { Allotment } from "allotment"
import { ChevronUp, ChevronDown } from "lucide-react"
import { useChat } from "@/hooks/useChat"
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout"
import { useAppStore } from "@/stores/appStore"
import { useProjectSettingsStore } from "@/stores/projectSettingsStore"
import { useDevServerStore } from "@/lib/dev-server-manager"
import { useChatStore } from "@/stores/chatStore"
import { hasGeneratedScaffold } from "@/lib/scaffold"
import { getWizardSystemPrompt } from "@/lib/prompts/wizard"
import { designLanguageSpecSchema } from "@/lib/design/spec"
import * as z from "zod/v4"
import { WizardChatPanel } from "./wizard/WizardChatPanel"
import { WizardPreviewPane } from "./wizard/WizardPreviewPane"
import { WizardAnnotations } from "./wizard/WizardAnnotations"
import { PromptInspector } from "@/components/PromptInspector"
import { PaneHeader } from "@/components/ui/pane-header"
import { getHostForProvider, readFile } from "@/lib/ipc"
import type { ToolPermissionDecision } from "@/lib/ipc"
import type { WizardAnnotation, WizardPreviewTab } from "./wizard/types"
import { WIZARD_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults"
import { useAskUserStore } from "@/stores/askUserStore"
import { confirm } from "@tauri-apps/plugin-dialog"

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

export function WizardPanel() {
  const { settings } = useAppStore()
  const wizardToolFilter = useAppStore((s) => s.settings.panelToolFilter.wizard)
  const { ps, setProjectSettings } = useProjectSettingsStore()
  const devServerStore = useDevServerStore()

  const [annotations, setAnnotations] = useState<WizardAnnotation[]>([])
  const [previewNavigatePath, setPreviewNavigatePath] = useState<string | null>(null)
  const [previewTabs, setPreviewTabs] = useState<WizardPreviewTab[]>([])
  const [activePreviewTabId, setActivePreviewTabId] = useState<string | null>(null)
  // Guards against readFile callbacks resolving after a wizard reset clears the tabs
  const wizardSessionRef = useRef(0)
  // Mirror refs updated synchronously during render so the isStreaming effect sees current values
  const previewTabsRef = useRef(previewTabs)
  previewTabsRef.current = previewTabs
  const activePreviewTabIdRef = useRef(activePreviewTabId)
  activePreviewTabIdRef.current = activePreviewTabId

  const pendingThemeSlugRef = useRef<string | null>(null)
  const pendingScreenRef = useRef<{ screenId: string; title: string; urlPath: string } | null>(null)

  const systemPrompt = useMemo((): string => {
    const schemaJson = JSON.stringify(z.toJSONSchema(designLanguageSpecSchema), null, 2)
    return getWizardSystemPrompt(settings.project, schemaJson)
  }, [settings.project])

  const wizardEntityId = `wizard-${settings.project}`

  const handleToolCall = useCallback((tool: string, args: Record<string, unknown>) => {
    if (tool === "set_active_theme") pendingThemeSlugRef.current = (args.theme_slug as string) || ""
    if (tool === "register_screen") {
      pendingScreenRef.current = {
        screenId: (args.screen_id as string) || "",
        title: (args.title as string) || "",
        urlPath: (args.path as string) || "",
      }
    }
  }, [])

  const handleToolResult = useCallback((tool: string, success: boolean, _output: string, path?: string) => {
    if (tool === "set_active_theme" && success && pendingThemeSlugRef.current) {
      const slug = pendingThemeSlugRef.current
      setProjectSettings({ stylePreset: slug })
      pendingThemeSlugRef.current = null
      // useAppStore.getState() avoids stale closure — same pattern as handleResolvePermission
      const project = useAppStore.getState().settings.project
      const session = wizardSessionRef.current
      readFile(`projects/${project}/themes/${slug}/theme.css`)
        .then((css) => {
          if (wizardSessionRef.current !== session) return
          const tabId = `theme-${slug}`
          setPreviewTabs((prev) => {
            const existing = prev.find((tab) => tab.id === tabId)
            if (existing) return prev.map((tab) => tab.id === tabId ? { ...tab, themeCss: css } : tab)
            return [...prev, { id: tabId, type: "theme", label: "Theme", themeSlug: slug, themeCss: css }]
          })
          setActivePreviewTabId(tabId)
        })
        .catch(() => {
          if (wizardSessionRef.current !== session) return
          const tabId = `theme-${slug}`
          setPreviewTabs((prev) => {
            if (prev.find((tab) => tab.id === tabId)) return prev
            return [...prev, { id: tabId, type: "theme", label: "Theme", themeSlug: slug }]
          })
          setActivePreviewTabId(tabId)
        })
    }
    if (tool === "write_file" && success && pendingScreenRef.current) {
      if ((path || "").endsWith("router.tsx")) {
        const { screenId, title, urlPath } = pendingScreenRef.current
        pendingScreenRef.current = null
        const tabId = `screen-${screenId}`
        setPreviewTabs((prev) => {
          const existing = prev.find((tab) => tab.id === tabId)
          if (existing) return prev.map((tab) => tab.id === tabId ? { ...tab, label: title || tab.label } : tab)
          return [...prev, { id: tabId, type: "screen", label: title || urlPath, urlPath }]
        })
        setActivePreviewTabId(tabId)
      }
    }
  }, [setProjectSettings])

  const handleSelectPreviewTab = useCallback((tabId: string) => {
    setActivePreviewTabId(tabId)
    const tab = previewTabs.find((tab) => tab.id === tabId)
    if (tab?.type === "screen" && tab.urlPath) {
      setPreviewNavigatePath(tab.urlPath)
    }
  }, [previewTabs])

  const chat = useChat({
    entityId: wizardEntityId,
    chatPath: `projects/${settings.project}/wizard/chat.json`,
    systemPrompt,
    outputPath: `projects/${settings.project}/generated/src/pages/home.tsx`,
    panelMaxToolCalls: settings.panelMaxToolCalls.wizard ?? 50,
    panelToolFilter: wizardToolFilter ?? WIZARD_TOOL_FILTER_DEFAULT,
    onToolCall: handleToolCall,
    onToolResult: handleToolResult,
  })

  // Start dev server and navigate to active screen tab when streaming ends.
  // previewTabsRef/activePreviewTabIdRef are read via refs to avoid adding them as deps
  // (which would re-trigger dev server start on every tab change).
  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !chat.isStreaming) {
      const projectDir = `projects/${settings.project}`
      hasGeneratedScaffold(projectDir).then((ready) => {
        if (ready) devServerStore.startRunner(`${projectDir}/generated`, ps.runnerPort).catch(() => {})
      }).catch(() => {})
      const activeTab = previewTabsRef.current.find((tab) => tab.id === activePreviewTabIdRef.current)
      if (activeTab?.type === "screen" && activeTab.urlPath) {
        setPreviewNavigatePath(activeTab.urlPath)
      }
    }
    wasStreamingRef.current = chat.isStreaming
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isStreaming])

  const handleResolvePermission = useCallback((requestId: number, decision: ToolPermissionDecision, toolName: string) => {
    useChatStore.getState().resolveToolPermission(wizardEntityId, requestId, decision)
    if (decision === "always_allowed" && toolName) {
      const current = useAppStore.getState().settings.toolAllowlist
      if (!current.includes(toolName)) {
        useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] })
      }
    }
  }, [wizardEntityId])

  const handleSend = useCallback(() => {
    const text = chat.input.trim()
    if (!text) return
    if (chat.messages.length === 0) {
      chat.sendMessage(text)
    } else {
      // Follow-up: append annotation context then send
      const annotationContext = serializeAnnotations(annotations)
      const fullText = [text, annotationContext].filter(Boolean).join("\n\n")
      if (annotationContext) setAnnotations((prev) => prev.map((a) => ({ ...a, resolved: true })))
      chat.sendMessage(fullText)
    }
  }, [chat.input, chat.messages.length, chat.clearChat, chat.sendMessage, annotations])

  const handleSendAnnotations = useCallback(() => {
    const annotationContext = serializeAnnotations(annotations)
    if (!annotationContext) return
    setAnnotations((prev) => prev.map((a) => ({ ...a, resolved: true })))
    chat.sendMessage(`Please apply my visual annotations:${annotationContext}`)
  }, [chat.sendMessage, annotations])

  const handleReset = useCallback(async () => {
    if (!(await confirm("Reset the wizard and clear all messages?", { title: "Reset Wizard", kind: "warning" }))) return
    chat.stopGeneration()
    chat.clearChat()
    useAskUserStore.getState().clearAskUser()
    useAskUserStore.getState().clearAskUserForm()
    setAnnotations([])
    setPreviewNavigatePath(null)
    setPreviewTabs([])
    setActivePreviewTabId(null)
    wizardSessionRef.current++
    pendingThemeSlugRef.current = null
    pendingScreenRef.current = null
  }, [chat.stopGeneration, chat.clearChat])

  const { ref: outerRef, onDragEnd: outerDragEnd, defaultSizes: outerSizes } = useAllotmentLayout("wizard-outer", 2)
  const { ref: inspectorRef, onDragEnd: inspectorDragEnd, defaultSizes: inspectorSizes } = useAllotmentLayout("wizard-inspector", 3)
  const { ref: rightRef, onDragEnd: rightDragEnd, defaultSizes: rightSizes } = useAllotmentLayout("wizard-right", 2)

  const inspectorMessages = useMemo(
    () => [{ role: "system" as const, content: systemPrompt }],
    [systemPrompt],
  )

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerDragEnd} defaultSizes={outerSizes}>

        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorDragEnd} defaultSizes={inspectorSizes} onVisibleChange={(_i, v) => setProjectSettings({ wizardShowInspector: v })}>
            <Allotment.Pane minSize={200}>
              <WizardChatPanel
                messages={chat.messages}
                isStreaming={chat.isStreaming}
                thinkingContent={chat.thinkingContent}
                pendingPermissions={chat.pendingPermissions}
                onRegenerate={chat.regenerate}
                onDeleteFrom={chat.deleteFrom}
                onResolvePermission={handleResolvePermission}
                onReset={handleReset}
                input={chat.input}
                onChangeInput={chat.setInput}
                onSend={handleSend}
                onStop={chat.stopGeneration}
                attachments={chat.attachments}
                onAddAttachment={chat.addAttachment}
                onRemoveAttachment={chat.removeAttachment}
                mentions={chat.mentions}
                onAddMention={chat.addMention}
                onRemoveMention={chat.removeMention}
                projectPath={`projects/${settings.project}`}
                thinkEnabled={chat.thinkEnabled}
                onToggleThink={chat.toggleThink}
                thinkLevel={chat.thinkLevel}
                onSetThinkLevel={chat.setThinkLevel}
                isGptOssFamily={chat.isGptOssFamily}
                canThink={chat.canThink}
                canVision={chat.canVision}
                toolsEnabled={chat.toolsEnabled}
                onToggleTools={chat.toggleTools}
                canTools={chat.canTools}
              />
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setProjectSettings({ wizardShowInspector: !ps.wizardShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                {ps.wizardShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>

            <Allotment.Pane visible={ps.wizardShowInspector} preferredSize={240} minSize={160} snap>
              {ps.wizardShowInspector && (
                <PromptInspector
                  model={settings.modelId}
                  messages={inspectorMessages}
                  host={getHostForProvider(settings.provider, settings.host)}
                  provider={settings.provider}
                  hasTools
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={320}>
          <Allotment ref={rightRef} onDragEnd={rightDragEnd} defaultSizes={rightSizes} vertical>
            <Allotment.Pane minSize={200}>
              <WizardPreviewPane
                devUrl={devServerStore.runnerUrl}
                device={ps.wizardDevice}
                darkMode={ps.wizardDarkPreview}
                annotations={annotations}
                previewNavigatePath={previewNavigatePath}
                previewTabs={previewTabs}
                activePreviewTabId={activePreviewTabId}
                onSelectTab={handleSelectPreviewTab}
                onSetDevice={(device) => setProjectSettings({ wizardDevice: device })}
                onToggleDark={() => setProjectSettings({ wizardDarkPreview: !ps.wizardDarkPreview })}
                onAddAnnotation={(annotation) => setAnnotations((prev) => [...prev, { ...annotation, id: makeId(), createdAt: Date.now() }])}
              />
            </Allotment.Pane>

            <Allotment.Pane minSize={60} maxSize={280} preferredSize={180} visible={annotations.length > 0}>
              <WizardAnnotations
                annotations={annotations}
                onRemove={(id) => setAnnotations((prev) => prev.filter((a) => a.id !== id))}
                onResolve={(id) => setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)))}
                onSendToAi={handleSendAnnotations}
                canSend={!chat.isStreaming}
              />
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

      </Allotment>
    </div>
  )
}
