import {
  BookOpen,
  Columns2,
  FileText,
  Focus,
  MessageSquare,
  PanelRight,
  PanelRightClose,
  Pencil,
  Search,
  Sparkles,
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
  outlineOpen: boolean;
  chatOpen: boolean;
  onModeChange: (mode: PlanMode) => void;
  onOutlineToggle: () => void;
  onChatToggle: () => void;
  onCommandMenu: () => void;
}

export function PlansToolbar({
  planName,
  savedAt,
  mode,
  outlineOpen,
  chatOpen,
  onModeChange,
  onOutlineToggle,
  onChatToggle,
  onCommandMenu,
}: PlansToolbarProps) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="panel-toolbar h-10 gap-3 bg-card px-3">
        <FileText size={12} className="shrink-0 text-violet-400" />
        <span className="truncate text-xs font-medium">{planName}</span>
        <span className="font-mono text-[10px] text-muted-foreground">.md</span>
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={chatOpen ? "Hide agent" : "Show agent"}
              onClick={onChatToggle}
            >
              <MessageSquare size={12} className={chatOpen ? "text-violet-300" : undefined} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{chatOpen ? "Hide agent" : "Show agent"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={outlineOpen ? "Hide outline" : "Show outline"}
              onClick={onOutlineToggle}
            >
              {outlineOpen ? <PanelRightClose size={12} /> : <PanelRight size={12} />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{outlineOpen ? "Hide outline" : "Show outline"}</TooltipContent>
        </Tooltip>
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
              <ToggleGroupItem key={m.id} value={m.id} aria-label={m.label}>
                <span className="inline-flex items-center gap-1.5">
                  <Icon size={10} />
                  {m.label}
                </span>
              </ToggleGroupItem>
            );
          })}
        </ToggleGroup>
        <div className="flex-1" />
        <span className="text-[10px] text-muted-foreground">
          {savedAt ? "Saved" : ""}
        </span>
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
