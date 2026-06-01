import type { Dispatch, RefObject, SetStateAction } from "react";
import { Allotment } from "allotment";
import { Terminal, ScrollText, Globe, ChevronDown, ChevronUp } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { XTerminal, type XTerminalHandle } from "@/components/XTerminal";
import type { ProjectSettings } from "@/stores/projectSettingsStore";

/** Shape of a single captured line in the shared log buffer.
 *  The buffer is owned by RunnerPanel (mutated from the terminal-output listener)
 *  and read here for the Logs and Network tabs. */
export interface LogLine {
  line: string;
  source: string;
}

export interface RunnerTerminalProps {
  xtermRef: RefObject<XTerminalHandle | null>;
  runnerActiveTab: ProjectSettings["runnerActiveTab"];
  runnerTerminalOpen: boolean;
  showShellInput: boolean;
  shellCommand: string;
  logLinesRef: RefObject<LogLine[]>;
  setShowShellInput: Dispatch<SetStateAction<boolean>>;
  setShellCommand: (v: string) => void;
  setProjectSettings: (patch: Partial<ProjectSettings>) => void;
  handleNewShell: () => void;
}

/** Terminal section: a fixed-size header pane (tab switcher + Shell) and a
 *  collapsible content pane (xterm / logs / network). Returns two
 *  Allotment.Pane siblings so it can be dropped into the vertical Allotment
 *  that owns the runner layout. */
export function RunnerTerminal({
  xtermRef,
  runnerActiveTab,
  runnerTerminalOpen,
  showShellInput,
  shellCommand,
  logLinesRef,
  setShowShellInput,
  setShellCommand,
  setProjectSettings,
  handleNewShell,
}: RunnerTerminalProps) {
  return (
    <>
      {/* Terminal header — fixed-height pane always visible */}
      <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
        <div className="h-full flex items-center border-b border-border bg-card px-2">
          <Tabs value={runnerActiveTab} onValueChange={(v) => setProjectSettings({ runnerActiveTab: v as ProjectSettings["runnerActiveTab"] })}>
            <TabsList variant="line" className="h-7">
              <TabsTrigger value="terminal" className="text-[11px] gap-1"><Terminal size={10} />Terminal</TabsTrigger>
              <TabsTrigger value="logs"     className="text-[11px] gap-1"><ScrollText size={10} />Logs</TabsTrigger>
              <TabsTrigger value="network"  className="text-[11px] gap-1"><Globe size={10} />Network</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="gap-1 h-6 text-[10px] px-1.5" onClick={() => { setShowShellInput((v) => !v); if (!runnerTerminalOpen) setProjectSettings({ runnerTerminalOpen: true }); }}><Terminal size={10} />Shell</Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setProjectSettings({ runnerTerminalOpen: !runnerTerminalOpen })}>{runnerTerminalOpen ? <ChevronDown size={10} /> : <ChevronUp size={10} />}</Button>
        </div>
      </Allotment.Pane>

      {/* Terminal content — collapsible pane (visible={runnerTerminalOpen}) */}
      <Allotment.Pane visible={runnerTerminalOpen} preferredSize={152} minSize={100}>
        <div className="h-full flex flex-col">
          {showShellInput && (
            <div className="flex gap-1 px-2 py-1 border-b border-border bg-card shrink-0">
              <span className="text-xs text-muted-foreground self-center">$</span>
              <Input value={shellCommand} onChange={(e) => setShellCommand(e.target.value)} placeholder="Enter shell command..." className="h-6 text-xs" onKeyDown={(e) => { if (e.key === "Enter") handleNewShell(); if (e.key === "Escape") setShowShellInput(false); }} autoFocus />
            </div>
          )}
          <div className="flex-1 overflow-hidden">
            <XTerminal ref={xtermRef} className={runnerActiveTab === "terminal" ? "" : "hidden"} />
            {runnerActiveTab === "logs" && (
              <ScrollArea className="h-full overflow-hidden bg-black font-mono text-xs"><div className="p-2 space-y-0.5">
                {logLinesRef.current.filter((item) => /error|warning|hmr|hot|build|ready/i.test(item.line)).map((item, i) => (
                  <div key={i} className={["break-all whitespace-pre-wrap", item.line.toLowerCase().includes("error") ? "text-red-400" : item.line.toLowerCase().includes("warning") ? "text-yellow-400" : "text-green-400"].join(" ")}>{item.line}</div>
                ))}
                {logLinesRef.current.filter((item) => /error|warning|hmr|hot|build|ready/i.test(item.line)).length === 0 && (
                  <div className="flex flex-col items-center justify-center py-8 gap-2 text-green-400/40">
                    <Terminal size={20} />
                    <p className="text-xs font-medium">No log events yet</p>
                  </div>
                )}
              </div></ScrollArea>
            )}
            {runnerActiveTab === "network" && (
              <ScrollArea className="h-full overflow-hidden bg-black font-mono text-xs"><div className="p-2 space-y-1">
                {(() => {
                  const requests = logLinesRef.current.map((item) => {
                    const match = item.line.match(/(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+(\d{3})/);
                    if (match) return { method: match[1], path: match[2], status: parseInt(match[3]) };
                    const hmr = item.line.match(/hmr update\s+(\S+)/i);
                    if (hmr) return { method: "HMR", path: hmr[1], status: 0 };
                    return null;
                  }).filter(Boolean) as Array<{ method: string; path: string; status: number }>;
                  if (requests.length === 0) return (
                    <div className="flex flex-col items-center justify-center py-8 gap-2 text-green-400/40">
                      <Globe size={20} />
                      <p className="text-xs font-medium">No network requests yet</p>
                    </div>
                  );
                  return requests.map((req, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className={["font-bold px-1 py-0.5 rounded", req.status >= 200 && req.status < 300 ? "bg-green-500/20 text-green-400" : req.status >= 400 ? "bg-red-500/20 text-red-400" : req.method === "HMR" ? "bg-blue-500/20 text-blue-400" : "bg-muted text-muted-foreground"].join(" ")}>{req.method}</span>
                      <span className="truncate flex-1 text-green-400">{req.path}</span>
                      {req.status > 0 && <span className="text-green-400 opacity-50">{req.status}</span>}
                    </div>
                  ));
                })()}
              </div></ScrollArea>
            )}
          </div>
        </div>
      </Allotment.Pane>
    </>
  );
}
