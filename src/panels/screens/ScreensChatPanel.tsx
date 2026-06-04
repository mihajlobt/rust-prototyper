import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { confirm } from "@tauri-apps/plugin-dialog";
import { MessageList, ChatInput } from "@/components/chat";
import { ScreensContextToolbar } from "@/panels/screens/ScreensContextToolbar";
import type { ChatMessage, MentionAsset, AttachmentFile, ToolPermissionRecord } from "@/types/chat";
import type { ToolPermissionDecision, FileEntry } from "@/lib/ipc";

interface CtxApi { id: string; name: string; method: string; url: string; proxyPath: string }
interface CtxComponent { id: string; name: string }

interface ScreensChatPanelProps {
  screenId: string | null;
  messages: ChatMessage[];
  isStreaming: boolean;
  thinkingContent: string;
  pendingPermissions: ToolPermissionRecord[];
  onApplyCode: (content: string) => void;
  onRegenerate: () => void;
  onDeleteFrom: (index: number) => void;
  onResolvePermission: (requestId: number, decision: ToolPermissionDecision, toolName: string) => void;
  onClearChat: () => void;
  onExport: () => void;

  // Chat input state
  input: string;
  setInput: (v: string) => void;
  onSend: () => void;
  onStop: () => void;
  attachments: AttachmentFile[];
  onAddAttachment: (file: AttachmentFile) => void;
  onRemoveAttachment: (index: number) => void;
  mentions: MentionAsset[];
  onAddMention: (asset: MentionAsset) => void;
  onRemoveMention: (id: string) => void;

  // Model capability toggles
  thinkEnabled: boolean;
  onToggleThink: () => void;
  thinkLevel: "low" | "medium" | "high";
  onSetThinkLevel: (level: "low" | "medium" | "high") => void;
  isGptOssFamily: boolean;
  canThink: boolean;
  canVision: boolean;
  toolsEnabled: boolean;
  onToggleTools: () => void;
  canTools: boolean;

  // Generation context
  themes: FileEntry[];
  ctxApis: CtxApi[];
  ctxComponents: CtxComponent[];
  projectPath: string;
}

export function ScreensChatPanel({
  screenId,
  messages,
  isStreaming,
  thinkingContent,
  pendingPermissions,
  onApplyCode,
  onRegenerate,
  onDeleteFrom,
  onResolvePermission,
  onClearChat,
  onExport,
  input,
  setInput,
  onSend,
  onStop,
  attachments,
  onAddAttachment,
  onRemoveAttachment,
  mentions,
  onAddMention,
  onRemoveMention,
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
  themes,
  ctxApis,
  ctxComponents,
  projectPath,
}: ScreensChatPanelProps) {
  return (
    <div className="h-full flex flex-col bg-card">
      <div className="panel-toolbar h-10 px-3 gap-2">
        <span className="text-sm font-medium">{screenId ?? "Chat"}</span>
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {Math.ceil(messages.filter((m) => m.role === "user").length)} turns
          </span>
        )}
        <div className="flex-1" />
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onExport} title="Export project">
          <Download size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={async () => { if (await confirm("Clear all chat messages?", { title: "Clear Chat", kind: "warning" })) onClearChat(); }}
          title="Clear chat"
          disabled={messages.length === 0}
        >
          <Trash2 size={12} />
        </Button>
      </div>
      <div className="flex-1 overflow-hidden flex flex-col">
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
        <div className="px-3 pb-3 pt-2 border-t border-border shrink-0 space-y-2">
          <ScreensContextToolbar themes={themes} ctxApis={ctxApis} ctxComponents={ctxComponents} />
          <ChatInput
            value={input}
            onChange={setInput}
            onSend={onSend}
            disabled={isStreaming}
            attachments={attachments}
            onAddAttachment={onAddAttachment}
            onRemoveAttachment={onRemoveAttachment}
            mentions={mentions}
            onAddMention={onAddMention}
            onRemoveMention={onRemoveMention}
            projectPath={projectPath}
            placeholder="Describe your screen..."
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
      </div>
    </div>
  );
}
