import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Loader } from "@/components/ui/loader";
import { Message, MessageContent } from "@/components/ui/message";
import {
  ChatContainerRoot,
  ChatContainerContent,
  ChatContainerScrollAnchor,
} from "@/components/ui/chat-container";
import { ScrollButton } from "@/components/ui/scroll-button";
import type { WorkflowNodeData } from "@/workflows/nodeTypes";

export interface OutputChatPanelProps {
  label: string;
  color: string;
  status: WorkflowNodeData["status"];
  output?: string;
  onClose: () => void;
}

function StatusBadge({ status }: { status: WorkflowNodeData["status"] }) {
  const map: Record<
    WorkflowNodeData["status"],
    { label: string; cls: string }
  > = {
    idle: { label: "Ready", cls: "bg-muted text-muted-foreground" },
    running: {
      label: "Generating",
      cls: "bg-status-running/15 text-status-running",
    },
    done: { label: "Complete", cls: "bg-status-done/15 text-status-done" },
    error: { label: "Error", cls: "bg-destructive/15 text-destructive" },
  };
  const { label, cls } = map[status];
  return (
    <span
      className={[
        "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase tracking-wider",
        cls,
      ].join(" ")}
    >
      {label}
    </span>
  );
}

export function OutputChatPanel({
  label,
  color,
  status,
  output,
  onClose,
}: OutputChatPanelProps) {
  const isRunning = status === "running";
  const isError = status === "error";

  return (
    <div className="h-full flex flex-col bg-card border-l border-border">
      <div className="panel-toolbar h-10 px-3 gap-2 shrink-0">
        <span
          className="w-2 h-2 rounded-full shrink-0"
          style={{ background: color }}
        />
        <span className="text-sm font-medium flex-1 truncate">{label}</span>
        <StatusBadge status={status} />
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={onClose}
          title="Close"
        >
          <X size={12} />
        </Button>
      </div>

      <div className="flex-1 min-h-0 relative">
        {isRunning && !output && (
          <div className="flex items-center justify-center h-full">
            <Loader variant="loading-dots" text="Generating" size="md" />
          </div>
        )}

        {output && (
          <ChatContainerRoot className="h-full">
            <ChatContainerContent className="p-4 space-y-4">
              <Message className="justify-start">
                <MessageContent
                  markdown
                  isStreaming={isRunning}
                  className={[
                    isError
                      ? "bg-destructive/10 text-destructive border border-destructive/30"
                      : "bg-secondary text-foreground",
                    "text-sm prose-headings:text-foreground",
                  ].join(" ")}
                >
                  {output}
                </MessageContent>
              </Message>
              <ChatContainerScrollAnchor />
            </ChatContainerContent>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
              <ScrollButton />
            </div>
          </ChatContainerRoot>
        )}

        {!output && !isRunning && (
          <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
            No output yet. Run the workflow to see results.
          </div>
        )}
      </div>

      {isRunning && output && (
        <div className="px-3 py-2 border-t border-border flex items-center gap-2">
          <Loader variant="dots" size="sm" />
          <span className="text-xs text-muted-foreground">
            Generating…
          </span>
        </div>
      )}
    </div>
  );
}