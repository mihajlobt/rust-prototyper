import type { Dispatch, RefObject, SetStateAction } from "react";
import { Terminal, ScrollText, Globe, ChevronDown, ChevronUp } from "lucide-react";
import { PaneHeader } from "@/components/ui/pane-header";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { XTerminal, type XTerminalHandle } from "@/components/XTerminal";
import type { ProjectSettings } from "@/stores/projectSettingsStore";

export interface LogLine {
  line: string;
  source: string;
}

interface TerminalSharedProps {
  runnerActiveTab: ProjectSettings["runnerActiveTab"];
  runnerTerminalOpen: boolean;
  setProjectSettings: (patch: Partial<ProjectSettings>) => void;
}

// ─── Header ───────────────────────────────────────────────────────────────────

interface RunnerTerminalHeaderProps extends TerminalSharedProps {
  setShowShellInput: Dispatch<SetStateAction<boolean>>;
}

const tabClass = (active: boolean) =>
  [
    "px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1",
    active
      ? "bg-secondary text-secondary-foreground"
      : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
  ].join(" ");

/** Header strip that goes inside the 28px locked Allotment.Pane in RunnerPanel. */
export function RunnerTerminalHeader({
  runnerActiveTab,
  runnerTerminalOpen,
  setShowShellInput,
  setProjectSettings,
}: RunnerTerminalHeaderProps) {
  function selectTab(tab: ProjectSettings["runnerActiveTab"]) {
    setProjectSettings({ runnerActiveTab: tab });
    if (!runnerTerminalOpen) setProjectSettings({ runnerTerminalOpen: true });
  }

  function toggleShell() {
    setShowShellInput((v) => !v);
    if (!runnerTerminalOpen) setProjectSettings({ runnerTerminalOpen: true });
  }

  return (
    <PaneHeader onClick={() => setProjectSettings({ runnerTerminalOpen: !runnerTerminalOpen })}>
      <button className={tabClass(runnerActiveTab === "terminal")} onClick={(e) => { e.stopPropagation(); selectTab("terminal"); }}>
        <Terminal size={10} />Terminal
      </button>
      <button className={tabClass(runnerActiveTab === "logs")} onClick={(e) => { e.stopPropagation(); selectTab("logs"); }}>
        <ScrollText size={10} />Logs
      </button>
      <button className={tabClass(runnerActiveTab === "network")} onClick={(e) => { e.stopPropagation(); selectTab("network"); }}>
        <Globe size={10} />Network
      </button>
      <div className="flex-1" />
      <button
        className="px-1.5 py-0.5 text-[11px] rounded transition-colors flex items-center gap-1 text-muted-foreground hover:text-foreground hover:bg-muted/50 mr-1"
        onClick={(e) => { e.stopPropagation(); toggleShell(); }}
      >
        <Terminal size={10} />Shell
      </button>
      {runnerTerminalOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
    </PaneHeader>
  );
}

// ─── Content ──────────────────────────────────────────────────────────────────

interface RunnerTerminalContentProps {
  xtermRef: RefObject<XTerminalHandle | null>;
  runnerActiveTab: ProjectSettings["runnerActiveTab"];
  showShellInput: boolean;
  shellCommand: string;
  logLinesRef: RefObject<LogLine[]>;
  setShowShellInput: Dispatch<SetStateAction<boolean>>;
  setShellCommand: (v: string) => void;
  handleNewShell: () => void;
}

/** Content area that goes inside the collapsible Allotment.Pane in RunnerPanel. */
export function RunnerTerminalContent({
  xtermRef,
  runnerActiveTab,
  showShellInput,
  shellCommand,
  logLinesRef,
  setShowShellInput,
  setShellCommand,
  handleNewShell,
}: RunnerTerminalContentProps) {
  return (
    <div className="h-full flex flex-col min-h-0">
      {showShellInput && (
        <div className="flex gap-1 px-2 py-1 border-b border-border bg-card shrink-0">
          <span className="text-xs text-muted-foreground self-center">$</span>
          <Input
            value={shellCommand}
            onChange={(e) => setShellCommand(e.target.value)}
            placeholder="Enter shell command…"
            className="h-6 text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleNewShell();
              if (e.key === "Escape") setShowShellInput(false);
            }}
            autoFocus
          />
        </div>
      )}
      <div className="flex-1 min-h-0 overflow-hidden">
        <XTerminal ref={xtermRef} className={runnerActiveTab === "terminal" ? "h-full" : "hidden"} />
        {runnerActiveTab === "logs" && <LogsTab logLinesRef={logLinesRef} />}
        {runnerActiveTab === "network" && <NetworkTab logLinesRef={logLinesRef} />}
      </div>
    </div>
  );
}

// ─── Logs / Network sub-views ─────────────────────────────────────────────────

function LogsTab({ logLinesRef }: { logLinesRef: RefObject<LogLine[]> }) {
  const filtered = logLinesRef.current.filter((item) =>
    /error|warning|hmr|hot|build|ready/i.test(item.line),
  );
  return (
    <ScrollArea className="h-full bg-black font-mono text-xs">
      <div className="p-2 space-y-0.5">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-green-400/40">
            <ScrollText size={20} />
            <p className="text-xs font-medium">No log events yet</p>
          </div>
        ) : (
          filtered.map((item, i) => (
            <div
              key={i}
              className={[
                "break-all whitespace-pre-wrap",
                item.line.toLowerCase().includes("error") ? "text-red-400"
                  : item.line.toLowerCase().includes("warning") ? "text-yellow-400"
                  : "text-green-400",
              ].join(" ")}
            >
              {item.line}
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  );
}

function NetworkTab({ logLinesRef }: { logLinesRef: RefObject<LogLine[]> }) {
  const requests = logLinesRef.current
    .map((item) => {
      const match = item.line.match(/(GET|POST|PUT|PATCH|DELETE)\s+(\S+)\s+(\d{3})/);
      if (match) return { method: match[1], path: match[2], status: parseInt(match[3]) };
      const hmr = item.line.match(/hmr update\s+(\S+)/i);
      if (hmr) return { method: "HMR", path: hmr[1], status: 0 };
      return null;
    })
    .filter(Boolean) as Array<{ method: string; path: string; status: number }>;

  return (
    <ScrollArea className="h-full bg-black font-mono text-xs">
      <div className="p-2 space-y-1">
        {requests.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2 text-green-400/40">
            <Globe size={20} />
            <p className="text-xs font-medium">No network requests yet</p>
          </div>
        ) : (
          requests.map((req, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className={[
                "font-bold px-1 py-0.5 rounded text-[10px]",
                req.status >= 200 && req.status < 300 ? "bg-green-500/20 text-green-400"
                  : req.status >= 400 ? "bg-red-500/20 text-red-400"
                  : req.method === "HMR" ? "bg-blue-500/20 text-blue-400"
                  : "bg-muted text-muted-foreground",
              ].join(" ")}>{req.method}</span>
              <span className="truncate flex-1 text-green-400">{req.path}</span>
              {req.status > 0 && <span className="text-green-400/50">{req.status}</span>}
            </div>
          ))
        )}
      </div>
    </ScrollArea>
  );
}
