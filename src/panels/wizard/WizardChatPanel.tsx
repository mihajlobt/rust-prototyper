import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageList, ChatInput } from "@/components/chat";
import { useAskUserStore } from "@/stores/askUserStore";
import type { ChatMessage, MentionAsset, AttachmentFile, ToolPermissionRecord } from "@/types/chat";
import type { ToolPermissionDecision } from "@/lib/ipc";

interface WizardChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinkingContent: string;
  pendingPermissions: ToolPermissionRecord[];

  onRegenerate: () => void;
  onDeleteFrom: (index: number) => void;
  onResolvePermission: (requestId: number, decision: ToolPermissionDecision, toolName: string) => void;
  onReset: () => void;

  // Input
  input: string;
  onChangeInput: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  attachments: AttachmentFile[];
  onAddAttachment: (a: AttachmentFile) => void;
  onRemoveAttachment: (i: number) => void;
  mentions: MentionAsset[];
  onAddMention: (m: MentionAsset) => void;
  onRemoveMention: (id: string) => void;
  projectPath: string;
  thinkEnabled: boolean;
  onToggleThink: () => void;
  thinkLevel: "low" | "medium" | "high" | undefined;
  onSetThinkLevel: (l: "low" | "medium" | "high") => void;
  isGptOssFamily: boolean;
  canThink: boolean;
  canVision: boolean;
  toolsEnabled: boolean;
  onToggleTools: () => void;
  canTools: boolean;
}

export function WizardChatPanel({
  messages,
  isStreaming,
  thinkingContent,
  pendingPermissions,
  onRegenerate,
  onDeleteFrom,
  onResolvePermission,
  onReset,
  input,
  onChangeInput,
  onSend,
  onStop,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  mentions,
  onAddMention,
  onRemoveMention,
  projectPath,
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
}: WizardChatPanelProps) {
  const { pendingAskUser, clearAskUser, pendingAskUserForm, clearAskUserForm } = useAskUserStore()
  return (
    <div className="h-full flex flex-col bg-card">
      <div className="panel-toolbar h-10 px-3 gap-2">
        <span className="text-sm font-medium">Wizard</span>
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {messages.filter((m) => m.role === "user").length} turns
          </span>
        )}
        <div className="flex-1" />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={onReset}
          disabled={messages.length === 0}
          title="Reset wizard"
        >
          <Trash2 size={13} />
        </Button>
      </div>

      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        thinkingContent={thinkingContent}
        pendingPermissions={pendingPermissions}
        onRegenerate={onRegenerate}
        onDeleteFrom={onDeleteFrom}
        onResolvePermission={onResolvePermission}
        pendingAskUser={pendingAskUser}
        onResolveAskUser={clearAskUser}
        pendingAskUserForm={pendingAskUserForm}
        onResolveAskUserForm={clearAskUserForm}
      />

      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
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
          onStop={isStreaming ? onStop : undefined}
          placeholder={
            messages.length === 0
              ? "Describe the app you want to build…"
              : "Ask for changes…"
          }
        />
      </div>
    </div>
  );
}
