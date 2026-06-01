// ─── Response viewer sub-component (right pane of the request/response split) ─

import { Copy, Terminal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import type { HttpResponse } from "@/lib/ipc";
import type { ApiHistoryEntry } from "@/stores/uiStore";

export interface ResponseViewerProps {
  response: HttpResponse | null;
  history: ApiHistoryEntry[];
  schemaContent: string;
}

export function ResponseViewer({ response, history, schemaContent }: ResponseViewerProps) {
  return (
    <div className="h-full flex flex-col bg-card">
      <div className="panel-toolbar h-10 px-3 gap-2">
        <span className="text-sm font-medium">Response</span>
        {response && (
          <span className={[
            "text-xs px-1.5 py-0.5 rounded font-medium",
            response.status >= 200 && response.status < 300 ? "bg-green-500/10 text-green-600"
              : response.status >= 400 ? "bg-red-500/10 text-red-600"
              : "bg-muted text-muted-foreground",
          ].join(" ")}>{response.status}</span>
        )}
        <div className="flex-1" />
        {response && (
          <Button variant="ghost" size="sm" className="h-7 gap-1 text-xs"
            onClick={() => navigator.clipboard.writeText(response.body)}>
            <Copy size={12} />Copy
          </Button>
        )}
      </div>

      <Tabs defaultValue="body" className="flex-1 flex flex-col overflow-hidden">
        <TabsList variant="line" className="h-7">
          <TabsTrigger value="body" className="text-[11px]">Body</TabsTrigger>
          <TabsTrigger value="schema" className="text-[11px]">TypeScript</TabsTrigger>
          <TabsTrigger value="headers" className="text-[11px]">Headers</TabsTrigger>
          <TabsTrigger value="history" className="text-[11px]">History</TabsTrigger>
        </TabsList>

        <TabsContent value="body" className="flex-1 overflow-hidden mt-0">
          {response ? (
            <CodeMirrorEditor
              value={(() => { try { return JSON.stringify(JSON.parse(response.body), null, 2); } catch { return response.body; } })()}
              mode={(() => { try { JSON.parse(response.body); return "json"; } catch { return "yaml"; } })()}
              readOnly
            />
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Send a request to see the response
            </div>
          )}
        </TabsContent>

        <TabsContent value="schema" className="flex-1 overflow-hidden mt-0">
          {response ? (
            <div className="relative h-full">
              <Button
                variant="ghost" size="sm"
                className="absolute top-1 right-1 z-10 gap-1 text-xs"
                onClick={() => navigator.clipboard.writeText(schemaContent)}
              >
                <Copy size={12} />Copy
              </Button>
              <CodeMirrorEditor value={schemaContent} mode="javascript" readOnly />
            </div>
          ) : (
            <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
              Send a request to infer TypeScript types
            </div>
          )}
        </TabsContent>

        <TabsContent value="headers" className="flex-1 overflow-hidden mt-0">
          {response ? (
            <CodeMirrorEditor value={JSON.stringify(response.headers, null, 2)} mode="json" readOnly />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground">
              <Terminal size={24} className="opacity-25" />
              <p className="text-sm font-medium">No response yet</p>
              <p className="text-xs opacity-60">Send a request to see the response</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="history" className="flex-1 mt-0">
          <ScrollArea className="h-full overflow-hidden">
            <div className="p-3">
              {history.length > 0 ? (
                <div className="space-y-1">
                  {history.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors">
                      <span className={[
                        "font-bold px-1 py-0.5 rounded",
                        h.status >= 200 && h.status < 300 ? "bg-green-500/10 text-green-600"
                          : h.status >= 400 ? "bg-red-500/10 text-red-600"
                          : "bg-muted text-muted-foreground",
                      ].join(" ")}>{h.status}</span>
                      <span className="font-medium w-12">{h.method}</span>
                      <span className="flex-1 truncate text-muted-foreground">{h.url}</span>
                      <span className="text-muted-foreground shrink-0">{h.duration}ms · {new Date(h.timestamp).toLocaleTimeString()}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="flex items-center justify-center text-muted-foreground text-sm">No request history</div>
              )}
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}
