import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageList, ChatInput } from "@/components/chat";
import { AskUserCard } from "@/components/ui/AskUserCard";
import type { ChatMessage, MentionAsset, AttachmentFile, ToolPermissionRecord } from "@/types/chat";
import type { ToolPermissionDecision } from "@/lib/ipc";
import type { PendingAskUser } from "./types";

interface WizardChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinkingContent: string;
  pendingPermissions: ToolPermissionRecord[];
  pendingAskUser: PendingAskUser | null;

  onRegenerate: () => void;
  onDeleteFrom: (index: number) => void;
  onResolvePermission: (requestId: number, decision: ToolPermissionDecision, toolName: string) => void;
  onResolveAskUser: () => void;
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
  pendingAskUser,
  onRegenerate,
  onDeleteFrom,
  onResolvePermission,
  onResolveAskUser,
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
          <RotateCcw size={13} />
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
      />

      {/* AskUserCard in its own shrink-0 row so the answer area is never clipped
          by sharing a container with ChatInput. MessageList flex-1 adjusts above. */}
      {pendingAskUser && (
        <div className="border-t border-border px-3 py-2.5 shrink-0">
          <AskUserCard
            requestId={pendingAskUser.requestId}
            question={pendingAskUser.question}
            questionType={pendingAskUser.questionType}
            choices={pendingAskUser.choices}
            onResolve={onResolveAskUser}
          />
        </div>
      )}

      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
        <ChatInput
          value={input}
          onChange={onChangeInput}
          onSend={onSend}
          disabled={isStreaming || pendingAskUser !== null}
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
