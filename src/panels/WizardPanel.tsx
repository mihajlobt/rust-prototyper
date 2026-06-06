import { useState, useCallback, useMemo, useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
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
import { saveItemMeta } from "@/lib/item-meta"
import { projectKeys } from "@/lib/queryKeys"
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
  const { ps: projectSettings, setProjectSettings } = useProjectSettingsStore()
  const devServerStore = useDevServerStore()
  const queryClient = useQueryClient()

  const [annotations, setAnnotations] = useState<WizardAnnotation[]>([])
  const [previewNavigatePath, setPreviewNavigatePath] = useState<string | null>(null)
  const [previewTabs, setPreviewTabs] = useState<WizardPreviewTab[]>([])
  const [activePreviewTabId, setActivePreviewTabId] = useState<string | null>(null)
  const [themeCss, setThemeCss] = useState<string | null>(null)
  // Guards against readFile callbacks resolving after a wizard reset clears the tabs
  const wizardSessionRef = useRef(0)
  // Refs break the dep-cycle: the streaming-end effect reads latest tab state without
  // being coupled to tab changes that would re-trigger dev server start.
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

  const handleToolResult = useCallback((tool: string, success: boolean) => {
    if (tool === "set_active_theme" && success && pendingThemeSlugRef.current) {
      const slug = pendingThemeSlugRef.current
      setProjectSettings({ stylePreset: slug })
      pendingThemeSlugRef.current = null
      const project = useAppStore.getState().settings.project
      const session = wizardSessionRef.current
      readFile(`projects/${project}/themes/${slug}/theme.css`)
        .then((css) => {
          if (wizardSessionRef.current !== session) return
          setThemeCss(css)
        })
        .catch((err) => console.error("Failed to read theme CSS for design panel:", err))
    }
    if (tool === "register_screen" && success && pendingScreenRef.current) {
      const { screenId, title, urlPath } = pendingScreenRef.current
      pendingScreenRef.current = null
      const project = useAppStore.getState().settings.project
      const session = wizardSessionRef.current

      saveItemMeta(`projects/${project}`, "screens", screenId, title)
        .catch((err) => console.error("Failed to create screen meta for sidebar:", err))
      queryClient.invalidateQueries({ queryKey: projectKeys.tree(project, "screens") })

      readFile(`projects/${project}/navigation.json`)
        .then((raw) => {
          if (wizardSessionRef.current !== session) return
          const nav = JSON.parse(raw) as { screens?: Array<{ id: string; path: string; preview_path?: string }> }
          const entry = nav.screens?.find((s) => s.id === screenId)
          const previewPath = entry?.preview_path ?? urlPath
          const tabId = `screen-${screenId}`
          setPreviewTabs((prev) => {
            const existing = prev.find((tab) => tab.id === tabId)
            if (existing) return prev.map((tab) => tab.id === tabId ? { ...tab, label: title || tab.label, previewPath } : tab)
            return [...prev, { id: tabId, type: "screen" as const, label: title || urlPath, urlPath, previewPath }]
          })
          setActivePreviewTabId(tabId)
        })
        .catch((err) => {
          console.error("Failed to read navigation.json for preview tab:", err)
          if (wizardSessionRef.current !== session) return
          const tabId = `screen-${screenId}`
          setPreviewTabs((prev) => {
            if (prev.find((tab) => tab.id === tabId)) return prev
            return [...prev, { id: tabId, type: "screen" as const, label: title || urlPath, urlPath }]
          })
          setActivePreviewTabId(tabId)
        })
    }
  }, [setProjectSettings, queryClient])

  const handleSelectPreviewTab = useCallback((tabId: string) => {
    setActivePreviewTabId(tabId)
    if (tabId === "design") return
    const selectedTab = previewTabs.find((tab) => tab.id === tabId)
    if (selectedTab?.type === "screen") {
      const path = selectedTab.previewPath ?? selectedTab.urlPath
      if (path) setPreviewNavigatePath(path)
    }
  }, [previewTabs])

  // Restore tabs from disk when the project is loaded or switched.
  // Reads navigation.json for screen tabs and the active theme CSS for the theme tab.
  useEffect(() => {
    const project = settings.project
    const session = wizardSessionRef.current
    const stylePreset = projectSettings.stylePreset

    readFile(`projects/${project}/navigation.json`)
      .then((raw) => {
        if (wizardSessionRef.current !== session) return
        const nav = JSON.parse(raw) as { screens?: Array<{ id: string; title: string; path: string; preview_path?: string }>; defaultScreen?: string }
        const screenTabs: WizardPreviewTab[] = (nav.screens ?? []).map((screen) => ({
          id: `screen-${screen.id}`,
          type: "screen" as const,
          label: screen.title || screen.id,
          urlPath: screen.path,
          previewPath: screen.preview_path,
        }))
        if (screenTabs.length === 0) return
        setPreviewTabs((prev) => {
          // Don't overwrite tabs that were already populated during streaming
          if (prev.length > 0) return prev
          return screenTabs
        })
        setActivePreviewTabId((prev) => {
          if (prev) return prev
          const defaultId = nav.defaultScreen ? `screen-${nav.defaultScreen}` : null
          return defaultId ?? screenTabs[0].id
        })
      })
      .catch((err) => {
        const msg = String(err)
        if (!msg.includes("not found") && !msg.includes("No such")) console.error("Failed to restore navigation tabs:", err)
      })

    if (stylePreset) {
      readFile(`projects/${project}/themes/${stylePreset}/theme.css`)
        .then((css) => {
          if (wizardSessionRef.current !== session) return
          setThemeCss(css)
        })
        .catch((err) => {
          const msg = String(err)
          if (!msg.includes("not found") && !msg.includes("No such")) console.error("Failed to restore theme CSS:", err)
        })
    }
  // projectSettings.stylePreset intentionally excluded — only re-run on project switch, not on every settings change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.project])

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

  const wasStreamingRef = useRef(false)
  useEffect(() => {
    if (wasStreamingRef.current && !chat.isStreaming) {
      const projectDir = `projects/${settings.project}`
      hasGeneratedScaffold(projectDir).then((ready) => {
        if (ready) devServerStore.startRunner(`${projectDir}/generated`, projectSettings.runnerPort).catch(() => {})
      }).catch(() => {})
      const activeTab = previewTabsRef.current.find((tab) => tab.id === activePreviewTabIdRef.current)
      if (activeTab?.type === "screen") {
        const path = activeTab.previewPath ?? activeTab.urlPath
        if (path) setPreviewNavigatePath(path)
      }
    }
    wasStreamingRef.current = chat.isStreaming
  // previewTabsRef/activePreviewTabIdRef are intentionally read via refs — adding them as deps would
  // re-trigger dev server start on every tab change
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
  }, [chat.input, chat.messages.length, chat.sendMessage, annotations])

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
    setThemeCss(null)
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
              <PaneHeader onClick={() => setProjectSettings({ wizardShowInspector: !projectSettings.wizardShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                {projectSettings.wizardShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>

            <Allotment.Pane visible={projectSettings.wizardShowInspector} preferredSize={240} minSize={160} snap>
              {projectSettings.wizardShowInspector && (
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
                generatedDir={`projects/${settings.project}/generated`}
                device={projectSettings.wizardDevice}
                darkMode={projectSettings.wizardDarkPreview}
                annotations={annotations}
                previewNavigatePath={previewNavigatePath}
                previewTabs={previewTabs}
                activePreviewTabId={activePreviewTabId}
                themeCss={themeCss}
                onSelectTab={handleSelectPreviewTab}
                onSetDevice={(device) => setProjectSettings({ wizardDevice: device })}
                onToggleDark={() => setProjectSettings({ wizardDarkPreview: !projectSettings.wizardDarkPreview })}
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
