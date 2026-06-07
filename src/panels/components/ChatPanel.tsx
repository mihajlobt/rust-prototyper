import { useCallback, type ReactNode } from "react";
import { Download, FolderUp, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Allotment } from "allotment";
import { confirm } from "@tauri-apps/plugin-dialog";
import { MessageList, ChatInput } from "@/components/chat";
import { useAskUserStore } from "@/stores/askUserStore";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import type { ChatMessage, ToolPermissionRecord, MentionAsset, AttachmentFile } from "@/types/chat";
import type { ToolPermissionDecision } from "@/lib/ipc";

interface ChatPanelProps {
  // Header
  selectedComponent: string | null;
  componentId: string | null;
  hasCode: boolean;
  code: string;
  messages: ChatMessage[];
  onSelectComponent: (id: string) => void;
  onSaveToRunner: () => void;
  onClearChat: () => void;

  // Messages
  isStreaming: boolean;
  thinkingContent: string;
  pendingPermissions: ToolPermissionRecord[];
  onApplyCode: (content: string) => void;
  onRegenerate: () => void;
  onDeleteFrom: (index: number) => void;
  onResolvePermission: (requestId: number, decision: ToolPermissionDecision, toolName: string) => void;

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

  /** Slot above the input — typically <ContextToolbar />. */
  contextToolbar?: ReactNode;
  /** Replaces the default Save/Export/SaveToRunner/Clear header actions.
   *  Pass when using this panel outside the Components context. */
  headerActions?: ReactNode;
}

/** Chat panel for the components workspace: header actions, message stream,
 *  context toolbar slot, and chat input. State and behavior are owned by the
 *  parent panel so this component stays presentational. */
export function ComponentsChatPanel({
  selectedComponent,
  componentId,
  hasCode,
  code,
  messages,
  onSelectComponent,
  onSaveToRunner,
  onClearChat,
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
  contextToolbar,
  headerActions,
}: ChatPanelProps) {
  const { pendingAskUser, clearAskUser, pendingAskUserForm, clearAskUserForm } = useAskUserStore()
  const { ref: chatRef, onDragEnd: chatOnDragEnd, defaultSizes: chatSizes } = useAllotmentLayout("components-chat-input", 2)
  const handleClear = useCallback(async () => {
    const ok = await confirm("Clear all chat messages?", { title: "Clear Chat", kind: "warning" });
    if (ok) onClearChat();
  }, [onClearChat]);

  return (
    <div className="h-full flex flex-col bg-card">
      <div className="panel-toolbar h-10 px-3 gap-2">
        <span className="text-sm font-medium">{selectedComponent ?? "Chat"}</span>
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {messages.filter((m) => m.role === "user").length} turns
          </span>
        )}
        <div className="flex-1" />
        {headerActions !== undefined ? headerActions : (
          <>
            <SaveComponentModal
              code={code}
              prompt={messages.find((m) => m.role === "user")?.content ?? ""}
              messages={messages}
              onSaved={(id) => {
                onSelectComponent(id);
                window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "components" } }));
              }}
              trigger={
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Save component…" disabled={!hasCode}>
                  <Save size={13} />
                </Button>
              }
            />
            <ComponentExportModal
              componentId="Generated"
              trigger={
                <Button variant="ghost" size="icon" className="h-6 w-6" title="Export component" disabled={!hasCode}>
                  <Download size={13} />
                </Button>
              }
            />
            <Button
              variant="ghost" size="icon" className="h-6 w-6"
              onClick={onSaveToRunner}
              disabled={!hasCode || !componentId}
              title="Save to Runner project"
            >
              <FolderUp size={13} />
            </Button>
            <Button
              variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={handleClear}
              disabled={messages.length === 0}
              title="Clear chat"
            >
              <Trash2 size={13} />
            </Button>
          </>
        )}
      </div>

      <Allotment vertical ref={chatRef} onDragEnd={chatOnDragEnd} defaultSizes={chatSizes}>
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
            {contextToolbar && <div className="shrink-0">{contextToolbar}</div>}
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
              onStop={onStop}
            />
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
