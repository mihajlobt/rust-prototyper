import { useState, useEffect, useCallback } from "react";
import {
  Monitor, Puzzle, Palette, FileText, Wand2,
  Archive, ArchiveRestore, ChevronDown, ChevronRight, Search,
  MessageSquare,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { readDir, readFile, writeFile, isNotFoundError, getErrorMessage } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import type { ChatMessage } from "@/types/chat";

type PanelType = "wizard" | "screens" | "components" | "themes" | "plans";

interface ChatEntry {
  path: string
  panel: PanelType
  entityId: string
  displayName: string
  title: string
  preview: string
  messageCount: number
  modifiedMs: number | null
  archived: boolean
}

const PANEL_ICONS: Record<PanelType, React.ElementType> = {
  wizard:     Wand2,
  screens:    Monitor,
  components: Puzzle,
  themes:     Palette,
  plans:      FileText,
};

const PANEL_LABELS: Record<PanelType, string> = {
  wizard:     "Wizard",
  screens:    "Screens",
  components: "Components",
  themes:     "Themes",
  plans:      "Plans",
};

function kebabToTitle(s: string) {
  return s.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatTimestamp(ms: number | null): string {
  if (!ms) return "";
  const d = new Date(ms);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function extractChatMeta(messages: ChatMessage[]) {
  const userMessages = messages.filter((m) => m.role === "user");
  const lastMessage = messages[messages.length - 1];
  const title = userMessages[0]?.content
    ? truncate(userMessages[0].content.replace(/\n/g, " "), 60)
    : "Untitled";
  const preview = lastMessage?.content
    ? truncate(lastMessage.content.replace(/\n/g, " "), 80)
    : "";
  return { title, preview, messageCount: messages.length };
}

async function loadChatFile(path: string): Promise<ChatMessage[] | null> {
  try {
    const raw = await readFile(path);
    const messages = JSON.parse(raw) as ChatMessage[];
    return Array.isArray(messages) && messages.length > 0 ? messages : null;
  } catch {
    return null;
  }
}

export function SidebarChatsTab() {
  const { settings } = useAppStore();
  const { openCreate, openPlan } = useProjectSettingsStore();
  const base = `projects/${settings.project}`;
  const archivePath = `${base}/chats-archive.json`;

  const [entries, setEntries] = useState<ChatEntry[]>([]);
  const [archivedPaths, setArchivedPaths] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<PanelType>>(new Set());
  const [archivedCollapsed, setArchivedCollapsed] = useState(true);
  const [loading, setLoading] = useState(false);

  const loadArchive = useCallback(async (): Promise<Set<string>> => {
    try {
      const raw = await readFile(archivePath);
      const arr = JSON.parse(raw) as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }, [archivePath]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    try {
      const archived = await loadArchive();
      setArchivedPaths(archived);

      const results: ChatEntry[] = [];

      const tryAdd = async (path: string, panel: PanelType, entityId: string, displayName: string, modifiedMs: number | null = null) => {
        const messages = await loadChatFile(path);
        if (!messages) return;
        const { title, preview, messageCount } = extractChatMeta(messages);
        results.push({ path, panel, entityId, displayName, title, preview, messageCount, modifiedMs, archived: archived.has(path) });
      };

      // Wizard — single file; use the directory entry mtime via its parent dir scan
      await tryAdd(`${base}/wizard/chat.json`, "wizard", "wizard", "Wizard");

      // Screens
      try {
        const dirs = await readDir(`${base}/screens`);
        for (const d of dirs.filter((e) => e.is_dir)) {
          const id = d.path.split("/").pop() ?? d.name;
          // Use mtime of the chat.json file itself by reading it via its parent dir
          const chatFiles = await readDir(`${base}/screens/${id}`).catch(() => []);
          const chatFile = chatFiles.find((f) => f.name === "chat.json");
          await tryAdd(`${base}/screens/${id}/chat.json`, "screens", id, kebabToTitle(id), chatFile?.modified_ms ?? null);
        }
      } catch (e) { if (!isNotFoundError(e)) notify.error("Failed to load screen chats", getErrorMessage(e)); }

      // Components
      try {
        const dirs = await readDir(`${base}/components`);
        for (const d of dirs.filter((e) => e.is_dir)) {
          const id = d.path.split("/").pop() ?? d.name;
          const chatFiles = await readDir(`${base}/components/${id}`).catch(() => []);
          const chatFile = chatFiles.find((f) => f.name === "chat.json");
          await tryAdd(`${base}/components/${id}/chat.json`, "components", id, kebabToTitle(id), chatFile?.modified_ms ?? null);
        }
      } catch (e) { if (!isNotFoundError(e)) notify.error("Failed to load component chats", getErrorMessage(e)); }

      // Themes
      try {
        const dirs = await readDir(`${base}/themes`);
        for (const d of dirs.filter((e) => e.is_dir)) {
          const id = d.path.split("/").pop() ?? d.name;
          const chatFiles = await readDir(`${base}/themes/${id}`).catch(() => []);
          const chatFile = chatFiles.find((f) => f.name === "chat.json");
          await tryAdd(`${base}/themes/${id}/chat.json`, "themes", id, kebabToTitle(id), chatFile?.modified_ms ?? null);
        }
      } catch (e) { if (!isNotFoundError(e)) notify.error("Failed to load theme chats", getErrorMessage(e)); }

      // Plans — *.chat.json files
      try {
        const files = await readDir(`${base}/plans`);
        for (const f of files.filter((e) => !e.is_dir && e.name.endsWith(".chat.json"))) {
          const id = (f.path.split("/").pop() ?? f.name).replace(/\.chat\.json$/, "");
          await tryAdd(`${base}/plans/${id}.chat.json`, "plans", id, kebabToTitle(id), f.modified_ms ?? null);
        }
      } catch (e) { if (!isNotFoundError(e)) notify.error("Failed to load plan chats", getErrorMessage(e)); }

      // Sort each group by modifiedMs descending
      results.sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));

      setEntries(results);
    } finally {
      setLoading(false);
    }
  }, [base, loadArchive]);

  useEffect(() => { loadEntries(); }, [loadEntries]);

  const saveArchive = async (paths: Set<string>) => {
    await writeFile(archivePath, JSON.stringify([...paths], null, 2));
  };

  const handleArchive = async (entry: ChatEntry) => {
    const next = new Set(archivedPaths);
    next.add(entry.path);
    setArchivedPaths(next);
    setEntries((prev) => prev.map((e) => e.path === entry.path ? { ...e, archived: true } : e));
    await saveArchive(next);
  };

  const handleUnarchive = async (entry: ChatEntry) => {
    const next = new Set(archivedPaths);
    next.delete(entry.path);
    setArchivedPaths(next);
    setEntries((prev) => prev.map((e) => e.path === entry.path ? { ...e, archived: false } : e));
    await saveArchive(next);
  };

  const handleNavigate = (entry: ChatEntry) => {
    switch (entry.panel) {
      case "wizard":     openCreate("wizard", null); break;
      case "screens":    openCreate("screens", entry.entityId); break;
      case "components": openCreate("components", entry.entityId); break;
      case "themes":     openCreate("themes", entry.entityId); break;
      case "plans":      openPlan(entry.entityId); break;
    }
  };

  const toggleGroup = (panel: PanelType) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(panel)) next.delete(panel); else next.add(panel);
      return next;
    });
  };

  const q = search.toLowerCase();
  const filtered = entries.filter((e) =>
    !q || e.displayName.toLowerCase().includes(q) || e.title.toLowerCase().includes(q) || e.preview.toLowerCase().includes(q)
  );

  const active = filtered.filter((e) => !e.archived);
  const archived = filtered.filter((e) => e.archived);

  const panels: PanelType[] = ["wizard", "screens", "components", "themes", "plans"];

  return (
    <div className="h-full flex flex-col">
      <div className="px-2 pt-2 pb-1">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search chats…"
            className="h-7 pl-6 text-xs"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-8 text-xs text-muted-foreground">Loading…</div>
        )}

        {!loading && panels.map((panel) => {
          const group = active.filter((e) => e.panel === panel);
          if (group.length === 0) return null;
          const Icon = PANEL_ICONS[panel];
          const collapsed = collapsedGroups.has(panel);
          return (
            <div key={panel}>
              <button
                className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                onClick={() => toggleGroup(panel)}
              >
                {collapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
                <Icon size={10} />
                <span>{PANEL_LABELS[panel]}</span>
                <span className="ml-auto text-[9px] bg-muted rounded px-1">{group.length}</span>
              </button>
              {!collapsed && group.map((entry) => (
                <ChatEntryRow key={entry.path} entry={entry} onNavigate={handleNavigate} onArchive={handleArchive} />
              ))}
            </div>
          );
        })}

        {!loading && active.length === 0 && archived.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
            <MessageSquare size={20} className="opacity-30" />
            <p className="text-xs font-medium">No chats yet</p>
            <p className="text-[10px] opacity-60 text-center px-4">Chats from Wizard, Screens, Components, Themes, and Plans will appear here</p>
          </div>
        )}

        {!loading && archived.length > 0 && (
          <div className="mt-1">
            <button
              className="w-full flex items-center gap-1 px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setArchivedCollapsed((v) => !v)}
            >
              {archivedCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              <Archive size={10} />
              <span>Archived</span>
              <span className="ml-auto text-[9px] bg-muted rounded px-1">{archived.length}</span>
            </button>
            {!archivedCollapsed && archived.map((entry) => (
              <ChatEntryRow key={entry.path} entry={entry} onNavigate={handleNavigate} onUnarchive={handleUnarchive} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

interface ChatEntryRowProps {
  entry: ChatEntry
  onNavigate: (entry: ChatEntry) => void
  onArchive?: (entry: ChatEntry) => void
  onUnarchive?: (entry: ChatEntry) => void
}

function ChatEntryRow({ entry, onNavigate, onArchive, onUnarchive }: ChatEntryRowProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      className="flex items-start gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer relative"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={() => onNavigate(entry)}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="text-xs font-medium truncate">{entry.displayName}</span>
          <span className="text-[9px] text-muted-foreground shrink-0">{formatTimestamp(entry.modifiedMs)}</span>
        </div>
        <p className="text-[10px] text-foreground/80 truncate leading-snug">{entry.title}</p>
        {entry.preview && entry.preview !== entry.title && (
          <p className="text-[10px] text-muted-foreground truncate leading-snug mt-0.5">{entry.preview}</p>
        )}
      </div>
      {hovered && (
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 absolute right-2 top-2"
          onClick={(e) => { e.stopPropagation(); if (onArchive) onArchive(entry); else onUnarchive?.(entry); }}
          title={onArchive ? "Archive" : "Unarchive"}
        >
          {onArchive ? <Archive size={10} /> : <ArchiveRestore size={10} />}
        </Button>
      )}
    </div>
  );
}
