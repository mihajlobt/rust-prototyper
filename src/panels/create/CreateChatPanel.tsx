// Shared chat shell for the four sub-modes (Wizard, Screens, Components,
// Design). Mounts MessageList + ChatInput inside a vertical Allotment, with
// slots for per-mode header actions (Save, Download, FolderUp) and the
// per-mode context toolbar (Design/Brief/APIs/Components). The mode file
// owns the useChat() call and passes the hook's return in via `chat` — this
// component does not own chat lifecycle, prompt construction, or agent
// configuration (those live in the mode file + createConfig.ts).

import type { ReactNode } from "react";
import { Allotment } from "allotment";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MessageList, ChatInput } from "@/components/chat";
import { useAskUserStore } from "@/stores/askUserStore";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import type { ToolPermissionDecision } from "@/lib/ipc";
import type { useChat } from "@/hooks/useChat";
import { CreateModeTabs } from "./CreateModeTabs";

export type UseChatReturn = ReturnType<typeof useChat>;

export interface CreateChatPanelProps {
  /** Selected-item name shown next to the mode switch (e.g. a screen, component, or theme name). Omit for Wizard/Screens or when no item is selected. */
  label?: string;
  /** Allotment key for the chat-input split. Per-mode so pane sizes persist independently. */
  chatInputLayoutKey: string;
  /** Full return of useChat() — bound to MessageList + ChatInput. */
  chat: UseChatReturn;
  /** Project root for the MentionPicker (always `projects/${project}`, never a chat.json path). */
  projectPath: string;
  /** Right-side toolbar actions (Save / Download / FolderUp, etc.). */
  headerActions?: ReactNode;
  /** Optional reset button (Wizard only). */
  onReset?: () => void;
  /** Override the default `chat.sendMessage` call (Wizard injects annotation context). */
  onSend?: () => void;
  /** Manual "Apply code" button on message code blocks (Screens/Components, non-tool models). */
  onApplyCode?: (content: string) => void;
  /** Optional context toolbar rendered above the input (Screens/Components only). */
  contextToolbar?: ReactNode;
  /** Per-mode placeholders. */
  placeholderEmpty?: string;
  placeholderFollowup?: string;
  /** Called when the user resolves a tool permission. The mode file MUST also
   *  add the tool to `settings.toolAllowlist` when `decision === "always_allowed"`. */
  onResolvePermission: (requestId: number, decision: ToolPermissionDecision, toolName: string) => void;
}

const DEFAULT_PLACEHOLDER_EMPTY = "Ask anything… type @ to reference assets";
const DEFAULT_PLACEHOLDER_FOLLOWUP = "Ask a follow-up…";

export function CreateChatPanel({
  label,
  chatInputLayoutKey,
  chat,
  projectPath,
  headerActions,
  onReset,
  contextToolbar,
  placeholderEmpty = DEFAULT_PLACEHOLDER_EMPTY,
  placeholderFollowup = DEFAULT_PLACEHOLDER_FOLLOWUP,
  onResolvePermission,
  onSend,
  onApplyCode,
}: CreateChatPanelProps) {
  const { pendingAskUser, clearAskUser, pendingAskUserForm, clearAskUserForm } = useAskUserStore();
  const { ref: chatRef, onDragEnd: chatOnDragEnd, defaultSizes: chatSizes } =
    useAllotmentLayout(chatInputLayoutKey, 2);
  const turnCount = chat.messages.filter((m) => m.role === "user").length;

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="panel-toolbar h-10 px-3 gap-2">
        <CreateModeTabs />
        {label && <span className="text-sm font-medium truncate">{label}</span>}
        {turnCount > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {turnCount} turns
          </span>
        )}
        <div className="flex-1" />
        {headerActions}
        {onReset && (
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-destructive"
            onClick={onReset}
            disabled={chat.messages.length === 0}
            title="Reset chat"
          >
            <Trash2 size={13} />
          </Button>
        )}
      </div>

      <Allotment vertical ref={chatRef} onDragEnd={chatOnDragEnd} defaultSizes={chatSizes}>
        <Allotment.Pane minSize={80}>
          <div className="h-full flex flex-col">
            <MessageList
              messages={chat.messages}
              isStreaming={chat.isStreaming}
              thinkingContent={chat.thinkingContent}
              pendingPermissions={chat.pendingPermissions}
              onRegenerate={chat.regenerate}
              onDeleteFrom={chat.deleteFrom}
              onApplyCode={onApplyCode}
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
            {contextToolbar}
            <ChatInput
              value={chat.input}
              onChange={chat.setInput}
              onSend={onSend ?? chat.sendMessage}
              disabled={chat.isStreaming}
              attachments={chat.attachments}
              onAddAttachment={chat.addAttachment}
              onRemoveAttachment={chat.removeAttachment}
              mentions={chat.mentions}
              onAddMention={chat.addMention}
              onRemoveMention={chat.removeMention}
              projectPath={projectPath}
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
              onStop={chat.isStreaming ? chat.stopGeneration : undefined}
              placeholder={chat.messages.length === 0 ? placeholderEmpty : placeholderFollowup}
            />
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
