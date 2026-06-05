import { MessageList, ChatInput } from "@/components/chat";
import type { ChatMessage, ToolPermissionRecord, MentionAsset, AttachmentFile } from "@/types/chat";
import type { ToolPermissionDecision } from "@/lib/ipc";

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
}: PlannerChatProps) {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        thinkingContent={thinkingContent}
        pendingPermissions={pendingPermissions}
        onApplyCode={onApplyCode}
        onRegenerate={onRegenerate}
        onDeleteFrom={onDeleteFrom}
        onResolvePermission={onResolvePermission}
      />
      <div className="shrink-0 border-t border-border px-3 pb-3 pt-2">
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
    </div>
  );
}
