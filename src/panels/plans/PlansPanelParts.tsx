import {
  BookOpen,
  Columns2,
  FileText,
  Focus,
  MessageSquare,
  Pencil,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

export type PlanMode = "write" | "split" | "read" | "focus";

const MODES: Array<{ id: PlanMode; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "write", label: "Write", icon: Pencil },
  { id: "split", label: "Split", icon: Columns2 },
  { id: "read",  label: "Read",  icon: BookOpen },
  { id: "focus", label: "Focus", icon: Focus },
];

interface PlansToolbarProps {
  planName: string;
  savedAt: number | null;
  mode: PlanMode;
  chatOpen: boolean;
  hasMessages: boolean;
  onModeChange: (mode: PlanMode) => void;
  onChatToggle: () => void;
  onCommandMenu: () => void;
  onClearChat: () => void;
}

export function PlansToolbar({
  planName,
  savedAt,
  mode,
  chatOpen,
  hasMessages,
  onModeChange,
  onChatToggle,
  onCommandMenu,
  onClearChat,
}: PlansToolbarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="panel-toolbar h-10 gap-2 bg-card px-3">
        <FileText size={12} className="shrink-0 text-primary" />
        <span className="truncate text-xs font-medium">{planName}</span>
        <span className="font-mono text-[10px] text-muted-foreground">.md</span>
        {savedAt ? <span className="text-[10px] text-muted-foreground">· Saved</span> : null}
        <div className="flex-1" />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Command palette (Cmd+K)"
              onClick={onCommandMenu}
            >
              <Search size={12} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Command palette ⌘K</TooltipContent>
        </Tooltip>
        {mode !== "focus" && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={chatOpen ? "Hide agent" : "Show agent"}
                onClick={onChatToggle}
              >
                <MessageSquare size={12} className={chatOpen ? "text-primary" : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{chatOpen ? "Hide agent" : "Show agent"}</TooltipContent>
          </Tooltip>
        )}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Clear chat history"
              disabled={!hasMessages}
              className="text-muted-foreground hover:text-destructive"
              onClick={onClearChat}
            >
              <Trash2 size={12} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Clear chat history</TooltipContent>
        </Tooltip>
        <div className="w-px h-4 bg-border shrink-0" />
        <ToggleGroup
          type="single"
          value={mode}
          onValueChange={(next) => next && onModeChange(next as PlanMode)}
          size="sm"
          spacing={0}
        >
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <Tooltip key={m.id}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value={m.id} aria-label={m.label}>
                    <Icon size={12} />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{m.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
      </div>
    </TooltipProvider>
  );
}

export function PlansEmptyState() {
  return (
    <EmptyStateContainer>
      <FileText size={28} className="opacity-50" />
      <EmptyStateTitle>No plan open</EmptyStateTitle>
      <EmptyStateHint>
        Create or select a plan from the sidebar to start writing. Plans are
        saved automatically as <span className="font-mono">.md</span> files in
        your project.
      </EmptyStateHint>
      <EmptyStateFooter>
        <Sparkles size={10} className="text-violet-400" />
        <span>Open the agent from the toolbar to draft or refine a plan.</span>
      </EmptyStateFooter>
    </EmptyStateContainer>
  );
}

function EmptyStateContainer({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-3 text-center text-muted-foreground">
        {children}
      </div>
    </div>
  );
}

function EmptyStateTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-sm font-medium text-foreground">{children}</div>;
}

function EmptyStateHint({ children }: { children: React.ReactNode }) {
  return <div className="max-w-xs text-xs">{children}</div>;
}

function EmptyStateFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex items-center gap-1.5 text-[10px] opacity-60">{children}</div>;
}
