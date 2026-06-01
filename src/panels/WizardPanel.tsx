import { useState, useCallback, useMemo } from "react"
import { Allotment } from "allotment"
import { ChevronUp, ChevronDown } from "lucide-react"
import { useWizard } from "@/hooks/useWizard"
import type { WizardMessage, WizardToolCall } from "@/hooks/useWizard"
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout"
import { useAppStore } from "@/stores/appStore"
import { useProjectSettingsStore } from "@/stores/projectSettingsStore"
import { WizardChatPanel } from "./wizard/WizardChatPanel"
import { WizardPreviewPane } from "./wizard/WizardPreviewPane"
import { WizardAnnotations } from "./wizard/WizardAnnotations"
import { PromptInspector } from "@/components/PromptInspector"
import { PaneHeader } from "@/components/ui/pane-header"
import { getHostForProvider } from "@/lib/ipc"
import type { ChatMessage, AttachmentFile, ToolCallRecord } from "@/types/chat"

function wizardToolCallToRecord(tc: WizardToolCall): ToolCallRecord {
  return {
    tool: tc.tool,
    path: "",
    arguments: tc.args,
    result: tc.result,
    success: tc.success,
    pending: tc.pending,
  }
}

function wizardMessageToChatMessage(msg: WizardMessage): ChatMessage {
  return {
    role: msg.role,
    content: msg.content,
    ...(msg.thinking ? { thinking: msg.thinking } : {}),
    ...(msg.toolCalls.length > 0 ? { toolCalls: msg.toolCalls.map(wizardToolCallToRecord) } : {}),
    ...(msg.streamChunks?.length ? { streamChunks: msg.streamChunks } : {}),
  }
}

export function WizardPanel() {
  const wizard = useWizard()
  const { settings } = useAppStore()
  const { ps, setProjectSettings } = useProjectSettingsStore()

  const [input, setInput] = useState("")
  const emptyAttachments = useMemo<AttachmentFile[]>(() => [], [])

  const { ref: outerRef, onDragEnd: outerDragEnd, defaultSizes: outerSizes } = useAllotmentLayout("wizard-outer", 2)
  const { ref: inspectorRef, onDragEnd: inspectorDragEnd, defaultSizes: inspectorSizes } = useAllotmentLayout("wizard-inspector", 3)
  const { ref: rightRef, onDragEnd: rightDragEnd, defaultSizes: rightSizes } = useAllotmentLayout("wizard-right", 2)

  const isIdle = wizard.phase === "idle"
  const isStreaming = wizard.phase === "running"

  const chatMessages = useMemo<ChatMessage[]>(
    () => wizard.messages.map(wizardMessageToChatMessage),
    [wizard.messages],
  )

  const inspectorMessages = useMemo(
    () => [{ role: "system" as const, content: wizard.systemPrompt }],
    [wizard.systemPrompt],
  )

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text) return
    setInput("")
    if (isIdle) {
      wizard.start(text)
    } else {
      wizard.sendFollowUp(text)
    }
  }, [input, isIdle, wizard])

  const handleSendAnnotations = useCallback(() => {
    wizard.sendFollowUp("Please apply my visual annotations:")
  }, [wizard])

  const canSend = wizard.phase !== "running" && wizard.phase !== "awaiting_answer"

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerDragEnd} defaultSizes={outerSizes}>

        {/* Left: Chat + Inspector — mirrors ComponentsPanel layout */}
        <Allotment.Pane minSize={300}>
          <Allotment
            vertical
            ref={inspectorRef}
            onDragEnd={inspectorDragEnd}
            defaultSizes={inspectorSizes}
            onVisibleChange={(_i, v) => setProjectSettings({ wizardShowInspector: v })}
          >
            <Allotment.Pane minSize={200}>
              <WizardChatPanel
                phase={wizard.phase}
                messages={chatMessages}
                isStreaming={isStreaming}
                thinkingContent={wizard.streamingThinking}
                pendingPermissions={[]}
                pendingAskUser={wizard.pendingAskUser}
                onRegenerate={() => {}}
                onDeleteFrom={() => {}}
                onResolvePermission={() => {}}
                onResolveAskUser={wizard.resolveAskUserResponse}
                onReset={wizard.resetWizard}
                input={input}
                onChangeInput={setInput}
                onSend={handleSend}
                onStop={wizard.stopGeneration}
                attachments={emptyAttachments}
                onAddAttachment={() => {}}
                onRemoveAttachment={() => {}}
                mentions={wizard.mentions}
                onAddMention={wizard.addMention}
                onRemoveMention={wizard.removeMention}
                projectPath={`projects/${settings.project}`}
                thinkEnabled={wizard.thinkEnabled}
                onToggleThink={wizard.toggleThink}
                thinkLevel={wizard.thinkLevel}
                onSetThinkLevel={wizard.setThinkLevel}
                isGptOssFamily={wizard.isGptOssFamily}
                canThink={wizard.canThink}
                canVision={wizard.canVision}
                toolsEnabled
                onToggleTools={() => {}}
                canTools={wizard.canTools}
              />
            </Allotment.Pane>

            {/* Inspector toggle — 28px locked row, same as Components/Screens */}
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader
                onClick={() => setProjectSettings({ wizardShowInspector: !ps.wizardShowInspector })}
              >
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

        {/* Right: Preview + Annotations */}
        <Allotment.Pane minSize={320}>
          <Allotment ref={rightRef} onDragEnd={rightDragEnd} defaultSizes={rightSizes} vertical>
            <Allotment.Pane minSize={200}>
              <WizardPreviewPane
                devUrl={wizard.devUrl}
                device={ps.wizardDevice}
                darkMode={ps.wizardDarkPreview}
                annotations={wizard.annotations}
                previewNavigatePath={wizard.previewNavigatePath}
                onSetDevice={(device) => setProjectSettings({ wizardDevice: device })}
                onToggleDark={() => setProjectSettings({ wizardDarkPreview: !ps.wizardDarkPreview })}
                onAddAnnotation={wizard.addAnnotation}
              />
            </Allotment.Pane>

            <Allotment.Pane
              minSize={60}
              maxSize={280}
              preferredSize={180}
              visible={wizard.annotations.length > 0}
            >
              <WizardAnnotations
                annotations={wizard.annotations}
                onRemove={wizard.removeAnnotation}
                onResolve={wizard.resolveAnnotation}
                onSendToAi={handleSendAnnotations}
                canSend={canSend}
              />
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

      </Allotment>
    </div>
  )
}
