import { Settings, Copy, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Loader } from "@/components/ui/loader";
import { MessageContent } from "@/components/ui/message";
import { ChatContainerRoot, ChatContainerContent, ChatContainerScrollAnchor } from "@/components/ui/chat-container";
import Frame from "react-frame-component";
import type { WorkflowNodeData } from "@/workflows/nodeTypes";

interface NodePropertiesPanelProps {
  nodeId: string;
  data: WorkflowNodeData;
  onUpdate: (id: string, patch: Partial<WorkflowNodeData>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onClose: () => void;
}

export function NodePropertiesPanel({ nodeId, data, onUpdate, onDuplicate, onDelete, onClose }: NodePropertiesPanelProps) {
  const set = (patch: Partial<WorkflowNodeData>) => onUpdate(nodeId, patch);
  const isRunning = data.status === "running";
  const isError = data.status === "error";

  // nowheel is React Flow's built-in class that disables canvas zoom on scroll
  // nopan prevents drag-panning when clicking inside the panel
  return (
    <div
      className="nowheel nopan w-[420px] bg-card border border-border rounded-lg flex flex-col shadow-xl"
      style={{ maxHeight: "85vh" }}
    >
      <div className="panel-toolbar h-10 px-3 gap-2 rounded-t-lg border-b border-border shrink-0">
        <Settings size={14} />
        <span className="text-sm font-medium flex-1 truncate">{data.label}</span>
        {isRunning && <Loader variant="dots" size="sm" />}
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDuplicate} title="Duplicate"><Copy size={11} /></Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onDelete} title="Delete"><Trash2 size={12} className="text-destructive" /></Button>
        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose} title="Close"><X size={12} /></Button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3 min-h-0">
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">Label</label>
          <Input value={data.label} onChange={(e) => set({ label: e.target.value })} className="h-7 text-xs" />
        </div>

        {(data.nodeType === "input" || data.nodeType === "custom" || data.nodeType.startsWith("custom_")) && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">{data.nodeType !== "input" ? "System Prompt" : "Prompt"}</label>
            <Textarea value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="text-xs min-h-[80px] resize-none" placeholder="Enter prompt…" />
          </div>
        )}

        {data.nodeType === "bash" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Command</label>
            <Input value={data.command || ""} onChange={(e) => set({ command: e.target.value })} className="h-7 text-xs" placeholder="echo hello" />
          </div>
        )}

        {data.nodeType === "writefile" && (<>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Path (relative to generated/)</label>
            <Input value={data.path || ""} onChange={(e) => set({ path: e.target.value })} className="h-7 text-xs" placeholder="src/App.tsx" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Mode</label>
            <select value={String(data.mode ?? "overwrite")} onChange={(e) => set({ mode: e.target.value })} className="h-7 text-xs w-full rounded-md border border-border bg-card px-2">
              <option value="overwrite">Overwrite</option>
              <option value="append">Append</option>
            </select>
          </div>
        </>)}

        {data.nodeType === "fetch" && (<>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">URL</label>
            <Input value={data.url || ""} onChange={(e) => set({ url: e.target.value })} className="h-7 text-xs" placeholder="https://api.example.com" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Method</label>
            <Input value={data.method || "GET"} onChange={(e) => set({ method: e.target.value })} className="h-7 text-xs" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Headers (JSON)</label>
            <Textarea value={data.headers || "{}"} onChange={(e) => set({ headers: e.target.value })} className="text-xs min-h-[60px] resize-none font-mono" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Body</label>
            <Textarea value={data.body || ""} onChange={(e) => set({ body: e.target.value })} className="text-xs min-h-[60px] resize-none" />
          </div>
        </>)}

        {data.nodeType === "fileop" && (<>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Operation</label>
            <Input value={data.operation || "read"} onChange={(e) => set({ operation: e.target.value })} className="h-7 text-xs" placeholder="read or write" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Path</label>
            <Input value={data.path || ""} onChange={(e) => set({ path: e.target.value })} className="h-7 text-xs" placeholder="./file.txt" />
          </div>
          {data.operation === "write" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Content</label>
              <Textarea value={data.content || ""} onChange={(e) => set({ content: e.target.value })} className="text-xs min-h-[60px] resize-none" />
            </div>
          )}
        </>)}

        {data.nodeType === "auth" && (<>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Scheme</label>
            <Input value={data.authScheme || "bearer"} onChange={(e) => set({ authScheme: e.target.value })} className="h-7 text-xs" placeholder="bearer / apikey / basic" />
          </div>
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Token / Key</label>
            <Input value={data.authToken || ""} onChange={(e) => set({ authToken: e.target.value })} className="h-7 text-xs" />
          </div>
          {data.authScheme === "apikey" && (
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground">Header Name</label>
              <Input value={data.authHeaderName || "X-API-Key"} onChange={(e) => set({ authHeaderName: e.target.value })} className="h-7 text-xs" />
            </div>
          )}
        </>)}

        {data.nodeType === "transform" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Transform Instruction</label>
            <Textarea value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Convert to TypeScript…" />
          </div>
        )}

        {data.nodeType === "designSystem" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Theme Name</label>
            <Input value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="h-7 text-xs" placeholder="default, dark, light…" />
          </div>
        )}

        {data.nodeType === "bun" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Bun Command</label>
            <Input value={data.command || "dev"} onChange={(e) => set({ command: e.target.value })} className="h-7 text-xs" placeholder="dev, build, install" />
          </div>
        )}

        {data.nodeType === "runner" && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Port</label>
            <Input value={String(data.port ?? "5173")} onChange={(e) => set({ port: e.target.value })} className="h-7 text-xs" placeholder="5173" />
          </div>
        )}

        {["requirements","architect","structure","style","interaction","reference","validate"].includes(data.nodeType) && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Context Override</label>
            <Textarea value={data.prompt || ""} onChange={(e) => set({ prompt: e.target.value })} className="text-xs min-h-[60px] resize-none" placeholder="Override input from previous node…" />
          </div>
        )}

        {data.nodeType === "preview" && data.output && (
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground">Preview</label>
            <div className="border border-border rounded overflow-hidden bg-white" style={{ height: 200 }}>
              <Frame className="w-full h-full border-0">
                <div dangerouslySetInnerHTML={{ __html: data.output }} />
              </Frame>
            </div>
          </div>
        )}

        {/* Status + output */}
        <div className="pt-2 border-t border-border space-y-2">
          <div className="flex items-center gap-1.5">
            <span className={[
              "w-1.5 h-1.5 rounded-full shrink-0",
              isRunning                  ? "bg-status-running animate-pulse" :
              isError                    ? "bg-status-error" :
              data.status === "done"     ? "bg-status-done" :
                                           "bg-muted-foreground",
            ].join(" ")} />
            <span className="text-[10px] text-muted-foreground uppercase tracking-wider capitalize">{data.status || "idle"}</span>
          </div>

          {isRunning && !data.output && (
            <Loader variant="dots" size="sm" text="Generating" />
          )}

          {isError && data.output && (
            <div className="text-[11px] text-destructive bg-destructive/10 p-2 rounded font-mono whitespace-pre-wrap break-all">
              {data.output}
            </div>
          )}

          {!isError && data.output && (
            <ChatContainerRoot className="max-h-64 rounded bg-muted">
              <ChatContainerContent className="p-2">
                <MessageContent
                  markdown
                  isStreaming={isRunning}
                  className="text-[11px] text-muted-foreground bg-transparent p-0 prose-headings:text-foreground"
                >
                  {data.output}
                </MessageContent>
                <ChatContainerScrollAnchor />
              </ChatContainerContent>
            </ChatContainerRoot>
          )}
        </div>
      </div>
    </div>
  );
}
