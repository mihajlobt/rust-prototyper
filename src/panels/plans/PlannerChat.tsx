import { MessageList, ChatInput } from "@/components/chat";
import { useAskUserStore } from "@/stores/askUserStore";
import type { ChatMessage, ToolPermissionRecord, MentionAsset, AttachmentFile } from "@/types/chat";
import type { ToolPermissionDecision } from "@/lib/ipc";
import type { Message, Provider } from "@/lib/ipc";
import { Allotment } from "allotment";
import { ChevronDown, ChevronUp } from "lucide-react";
import { PromptInspector } from "@/components/PromptInspector";
import { PaneHeader } from "@/components/ui/pane-header";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";

interface PlannerChatProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinkingContent: string;
  pendingPermissions: ToolPermissionRecord[];
  onApplyCode?: (content: string) => void;
  onRegenerate: () => void;
  onDeleteFrom: (index: number) => void;
  onResolvePermission: (requestId: number, decision: ToolPermissionDecision, toolName: string) => void;

  input: string;
  onChangeInput: (value: string) => void;
  onSend: () => void;

  attachments: AttachmentFile[];
  onAddAttachment: (file: AttachmentFile) => void;
  onRemoveAttachment: (index: number) => void;
  mentions: MentionAsset[];
  onAddMention: (mention: MentionAsset) => void;
  onRemoveMention: (id: string) => void;

  projectPath: string;
  placeholder: string;

  thinkEnabled: boolean;
  onToggleThink: () => void;
  thinkLevel: "low" | "medium" | "high" | undefined;
  onSetThinkLevel: (level: "low" | "medium" | "high") => void;
  isGptOssFamily: boolean;
  canThink: boolean;
  canVision: boolean;
  toolsEnabled: boolean;
  onToggleTools: () => void;
  canTools: boolean;

  onStopChat: () => void;

  // Prompt Inspector
  inspectorMessages: Message[];
  model: string;
  host: string;
  provider: Provider;
  showInspector: boolean;
  onToggleInspector: () => void;
}

export function PlannerChat({
  messages,
  isStreaming,
  thinkingContent,
  pendingPermissions,
  onApplyCode,
  onRegenerate,
  onDeleteFrom,
  onResolvePermission,
  input,
  onChangeInput,
  onSend,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  mentions,
  onAddMention,
  onRemoveMention,
  projectPath,
  placeholder,
  thinkEnabled,
  onToggleThink,
  thinkLevel,
  onSetThinkLevel,
  isGptOssFamily,
  canThink,
  canVision,
  toolsEnabled,
  onToggleTools,
  canTools,
  onStopChat,
  inspectorMessages,
  model,
  host,
  provider,
  showInspector,
  onToggleInspector,
}: PlannerChatProps) {
  const { ref, onDragEnd, defaultSizes } = useAllotmentLayout("plans-inspector", 3, [true, true, showInspector])
  const { ref: chatInputRef, onDragEnd: chatInputOnDragEnd, defaultSizes: chatInputSizes } = useAllotmentLayout("plans-chat-input", 2)
  const { pendingAskUser, clearAskUser, pendingAskUserForm, clearAskUserForm } = useAskUserStore()

  return (
    <Allotment vertical ref={ref} onDragEnd={onDragEnd} defaultSizes={defaultSizes} onVisibleChange={(_i, v) => { if (!v) onToggleInspector(); }}>
      <Allotment.Pane minSize={200}>
        <Allotment vertical ref={chatInputRef} onDragEnd={chatInputOnDragEnd} defaultSizes={chatInputSizes}>
          <Allotment.Pane minSize={80}>
            <div className="h-full flex flex-col">
              <MessageList
                messages={messages}
                isStreaming={isStreaming}
                thinkingContent={thinkingContent}
                pendingPermissions={pendingPermissions}
                onApplyCode={onApplyCode}
                onRegenerate={onRegenerate}
                onDeleteFrom={onDeleteFrom}
                onResolvePermission={onResolvePermission}
                pendingAskUser={pendingAskUser}
                onResolveAskUser={clearAskUser}
                pendingAskUserForm={pendingAskUserForm}
                onResolveAskUserForm={clearAskUserForm}
              />
            </div>
          </Allotment.Pane>
          <Allotment.Pane minSize={120} maxSize={400} preferredSize={180}>
            <div className="chat-input-pane">
              <ChatInput
                value={input}
                onChange={onChangeInput}
                onSend={onSend}
                disabled={isStreaming}
                attachments={attachments}
                onAddAttachment={onAddAttachment}
                onRemoveAttachment={onRemoveAttachment}
                mentions={mentions}
                onAddMention={onAddMention}
                onRemoveMention={onRemoveMention}
                projectPath={projectPath}
                placeholder={placeholder}
                thinkEnabled={thinkEnabled}
                onToggleThink={onToggleThink}
                thinkLevel={thinkLevel}
                onSetThinkLevel={onSetThinkLevel}
                isGptOssFamily={isGptOssFamily}
                canThink={canThink}
                canVision={canVision}
                toolsEnabled={toolsEnabled}
                onToggleTools={onToggleTools}
                canTools={canTools}
                onStop={isStreaming ? onStopChat : undefined}
              />
            </div>
          </Allotment.Pane>
        </Allotment>
      </Allotment.Pane>
      <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
        <PaneHeader onClick={onToggleInspector}>
          <span className="text-xs font-medium flex-1">Inspector</span>
          {showInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
        </PaneHeader>
      </Allotment.Pane>
      <Allotment.Pane visible={showInspector} preferredSize={240} minSize={160} snap>
        {showInspector && (
          <PromptInspector
            model={model}
            messages={inspectorMessages}
            host={host}
            provider={provider}
          />
        )}
      </Allotment.Pane>
    </Allotment>
  );
}
