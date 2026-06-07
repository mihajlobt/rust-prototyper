import { Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Allotment } from "allotment";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MessageList, ChatInput } from "@/components/chat";
import { useAskUserStore } from "@/stores/askUserStore";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import type { ChatMessage, ToolPermissionRecord, MentionAsset, AttachmentFile } from "@/types/chat";
import type { ToolPermissionDecision } from "@/lib/ipc";
import type { DesignBriefTemplate } from "@/lib/prompts";

interface ThemeChatPanelProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  thinkingContent: string;
  pendingPermissions: ToolPermissionRecord[];
  onApplyCode: (content: string) => void;
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

  cssActive: boolean;
  designActive: boolean;
  onToggleCss: () => void;
  onToggleDesign: () => void;

  archetypeName: string;
  onSetArchetypeName: (name: string) => void;
  allSeeds: DesignBriefTemplate[];
  selectedSeed: DesignBriefTemplate | null;
}

export function ThemeChatPanel({
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
  cssActive,
  designActive,
  onToggleCss,
  onToggleDesign,
  archetypeName,
  onSetArchetypeName,
  allSeeds,
  selectedSeed,
}: ThemeChatPanelProps) {
  const { pendingAskUser, clearAskUser, pendingAskUserForm, clearAskUserForm } = useAskUserStore()
  const { ref: chatRef, onDragEnd: chatOnDragEnd, defaultSizes: chatSizes } = useAllotmentLayout("theme-chat-input", 2)
  return (
    <div className="flex-1 overflow-hidden flex flex-col">
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
            <div className="flex items-center gap-1.5 shrink-0">
              {designActive && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant={selectedSeed ? "secondary" : "outline"} size="sm" className="h-7 text-[11px] gap-1 px-2 shrink-0">
                      <Palette size={11} />
                      {selectedSeed ? selectedSeed.name : "Seed"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-64">
                    <DropdownMenuRadioGroup value={archetypeName} onValueChange={onSetArchetypeName}>
                      <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
                      {allSeeds.map((seed) => (
                        <DropdownMenuRadioItem key={seed.name} value={seed.name} className="text-xs">
                          {seed.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              <div className="flex-1" />
              <Button
                variant={cssActive ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-[11px] px-1.5"
                onClick={onToggleCss}
                disabled={isStreaming}
              >
                CSS
              </Button>
              <Button
                variant={designActive ? "secondary" : "ghost"}
                size="sm"
                className="h-7 text-[11px] px-1.5"
                onClick={onToggleDesign}
                disabled={isStreaming}
              >
                Design
              </Button>
            </div>
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
    </div>
  );
}
