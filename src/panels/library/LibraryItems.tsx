import { Box, Palette, LayoutGrid, Globe, ChevronDown, ChevronRight, Clock } from "lucide-react";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  TYPE_COLORS, TYPE_BG, TYPE_LABELS,
  relativeTime, stripMentionBlocks,
} from "./types";
import type { LibraryItem, RowActions } from "./types";

// Icons live here (JSX can't be in a .ts file)
const TYPE_ICONS: Record<string, React.ReactNode> = {
  screen:    <LayoutGrid size={12} />,
  component: <Box size={12} />,
  theme:     <Palette size={12} />,
  api:       <Globe size={12} />,
};

// ─── Shared small components ──────────────────────────────────────────────────

export function ColorSwatches({ palette }: { palette: string[] }) {
  return (
    <div className="flex gap-0.5 shrink-0">
      {palette.map((color, i) => (
        <span
          key={i}
          className="w-3 h-3 rounded-sm border border-border/30"
          style={{ background: color }}
          title={color}
        />
      ))}
    </div>
  );
}

function DetailAction({
  onClick, variant = "default", className = "", children,
}: {
  onClick: () => void;
  variant?: "primary" | "default" | "danger";
  className?: string;
  children: React.ReactNode;
}) {
  const variants = {
    primary: "bg-accent/10 hover:bg-accent/20 text-foreground/70 hover:text-foreground",
    default: "hover:bg-accent/10 text-muted-foreground hover:text-foreground",
    danger:  "hover:bg-destructive/10 text-muted-foreground hover:text-destructive",
  };
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${variants[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

// ─── Expanded detail panel (shared between list rows) ────────────────────────

function DetailPanel({ item, onOpen, onDuplicate, onExport, onDelete }: {
  item: LibraryItem;
  onOpen: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const prompt = item.meta?.initialPrompt ? stripMentionBlocks(item.meta.initialPrompt) : "";
  return (
    <div className="mx-3 mb-2 rounded border border-border/50 bg-muted/20 text-[11px] overflow-hidden">
      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 border-b border-border/40 text-muted-foreground">
        <span className={`flex items-center gap-1 ${TYPE_COLORS[item.type]}`}>
          {TYPE_ICONS[item.type]}
          <span className="font-medium">{TYPE_LABELS[item.type]}</span>
        </span>
        {item.meta ? (
          <>
            <span>Created {relativeTime(item.meta.createdAt)}</span>
            <span>·</span>
            <span>Updated {relativeTime(item.meta.updatedAt)}</span>
            {item.meta.updates.length > 0 && (
              <><span>·</span><span>{item.meta.updates.length + 1} generations</span></>
            )}
          </>
        ) : (
          <span className="italic opacity-60">No metadata recorded yet</span>
        )}
      </div>

      {/* Initial prompt */}
      {prompt && (
        <div className="px-3 py-2 border-b border-border/40">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1">Initial prompt</p>
          <p className="text-foreground/80 leading-relaxed">{prompt}</p>
        </div>
      )}

      {/* Update history */}
      {item.meta && item.meta.updates.length > 0 && (
        <div className="px-3 py-2 border-b border-border/40">
          <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-1.5">Updates</p>
          <div className="space-y-1.5">
            {item.meta.updates.map((u, idx) => (
              <div key={idx} className="flex gap-2">
                <span className="text-muted-foreground/50 shrink-0 tabular-nums">{relativeTime(u.at)}</span>
                <span className="text-foreground/70 leading-relaxed line-clamp-2">{stripMentionBlocks(u.prompt)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions */}
      <div className="flex items-center gap-1 px-3 py-2">
        <DetailAction onClick={onOpen} variant="primary">Open in editor</DetailAction>
        <DetailAction onClick={onDuplicate}>Duplicate</DetailAction>
        <DetailAction onClick={onExport}>Export</DetailAction>
        <DetailAction onClick={onDelete} variant="danger" className="ml-auto">Delete</DetailAction>
      </div>
    </div>
  );
}

// ─── Context menu wrapper ─────────────────────────────────────────────────────

export function ItemContextMenu({ item, onOpen, onRename, onDuplicate, onCopyPrompt, onExport, onDelete, children }: {
  item: LibraryItem;
  onOpen: () => void;
  onRename: () => void;
  onDuplicate: () => void;
  onCopyPrompt: () => void;
  onExport: () => void;
  onDelete: () => void;
  children: React.ReactNode;
}) {
  const hasPrompt = !!(item.meta?.initialPrompt && stripMentionBlocks(item.meta.initialPrompt));
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-48">
        <ContextMenuItem onClick={onOpen}>Open in editor</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onRename}>Rename</ContextMenuItem>
        <ContextMenuItem onClick={onDuplicate} disabled={item.type === "api"}>Duplicate</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onCopyPrompt} disabled={!hasPrompt}>Copy initial prompt</ContextMenuItem>
        <ContextMenuItem onClick={onExport}>Export file</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ─── Rename input ─────────────────────────────────────────────────────────────

function RenameInput({ value, onChange, onCommit, onCancel }: {
  value: string;
  onChange: (v: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  return (
    <input
      autoFocus
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => { if (e.key === "Enter") onCommit(); if (e.key === "Escape") onCancel(); }}
      onBlur={onCommit}
      onClick={(e) => e.stopPropagation()}
      className="flex-1 min-w-0 text-xs bg-transparent border-b border-primary outline-none"
    />
  );
}

// ─── List row ─────────────────────────────────────────────────────────────────

export function ListRow({ item, actions }: { item: LibraryItem; actions: RowActions }) {
  const { openItem, startRename, commitRename, copyPrompt, handleDuplicate, handleExport, handleDelete,
    expandedId, setExpandedId, renamingId, renameValue, setRenameValue } = actions;
  const rowKey = `${item.type}-${item.id}`;
  const isExpanded = expandedId === rowKey;
  const isRenaming = renamingId === rowKey;

  return (
    <ItemContextMenu
      item={item}
      onOpen={() => openItem(item)}
      onRename={() => startRename(item)}
      onDuplicate={() => handleDuplicate(item)}
      onCopyPrompt={() => copyPrompt(item)}
      onExport={() => handleExport(item)}
      onDelete={() => handleDelete(item)}
    >
      <div>
        <div
          className={`group flex items-center gap-2 px-3 py-2 cursor-pointer select-none hover:bg-accent/5 transition-colors ${isExpanded ? "bg-accent/5" : ""}`}
          onClick={() => { if (!isRenaming) setExpandedId(isExpanded ? null : rowKey); }}
          onDoubleClick={() => openItem(item)}
        >
          <span className="text-muted-foreground/40 w-3 shrink-0">
            {isExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          </span>
          <span className={`shrink-0 ${TYPE_COLORS[item.type]}`}>{TYPE_ICONS[item.type]}</span>

          {isRenaming ? (
            <RenameInput
              value={renameValue}
              onChange={setRenameValue}
              onCommit={() => commitRename(item)}
              onCancel={() => setRenameValue("")}
            />
          ) : (
            <span className="flex-1 min-w-0 text-xs font-medium truncate text-foreground">{item.name}</span>
          )}

          {item.type === "theme" && item.palette && item.palette.length > 0 && (
            <ColorSwatches palette={item.palette} />
          )}

          {item.meta ? (
            <span className="shrink-0 text-[10px] text-muted-foreground/60 flex items-center gap-0.5">
              <Clock size={9} />{relativeTime(item.meta.updatedAt)}
            </span>
          ) : (
            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${TYPE_BG[item.type]} ${TYPE_COLORS[item.type]}`}>
              {TYPE_LABELS[item.type]}
            </span>
          )}
        </div>

        {isExpanded && (
          <DetailPanel
            item={item}
            onOpen={() => openItem(item)}
            onDuplicate={() => handleDuplicate(item)}
            onExport={() => handleExport(item)}
            onDelete={() => handleDelete(item)}
          />
        )}
      </div>
    </ItemContextMenu>
  );
}

// ─── Gallery card ─────────────────────────────────────────────────────────────

export function GalleryCard({ item, actions }: { item: LibraryItem; actions: RowActions }) {
  const { openItem, startRename, commitRename, copyPrompt, handleDuplicate, handleExport, handleDelete,
    renamingId, renameValue, setRenameValue } = actions;
  const rowKey = `${item.type}-${item.id}`;
  const isRenaming = renamingId === rowKey;
  const prompt = item.meta?.initialPrompt ? stripMentionBlocks(item.meta.initialPrompt) : "";

  return (
    <ItemContextMenu
      item={item}
      onOpen={() => openItem(item)}
      onRename={() => startRename(item)}
      onDuplicate={() => handleDuplicate(item)}
      onCopyPrompt={() => copyPrompt(item)}
      onExport={() => handleExport(item)}
      onDelete={() => handleDelete(item)}
    >
      <div
        className="rounded-lg border border-border bg-card hover:border-primary/40 transition-colors cursor-pointer overflow-hidden"
        onDoubleClick={() => openItem(item)}
      >
        {item.type === "theme" && item.palette && item.palette.length > 0 ? (
          <div className="h-8 flex">
            {item.palette.map((color, i) => (
              <div key={i} className="flex-1" style={{ background: color }} />
            ))}
          </div>
        ) : (
          <div className={`h-1.5 w-full ${TYPE_BG[item.type]}`} />
        )}

        <div className="p-2.5 space-y-1.5">
          <div className="flex items-center gap-1.5">
            <span className={`shrink-0 ${TYPE_COLORS[item.type]}`}>{TYPE_ICONS[item.type]}</span>
            {isRenaming ? (
              <RenameInput
                value={renameValue}
                onChange={setRenameValue}
                onCommit={() => commitRename(item)}
                onCancel={() => setRenameValue("")}
              />
            ) : (
              <span
                className="flex-1 min-w-0 text-xs font-medium truncate text-foreground"
                onDoubleClick={(e) => { e.stopPropagation(); startRename(item); }}
              >
                {item.name}
              </span>
            )}
          </div>
          {prompt && <p className="text-[10px] text-muted-foreground line-clamp-2 leading-relaxed">{prompt}</p>}
          {item.meta && (
            <div className="flex items-center gap-1 text-[10px] text-muted-foreground/60">
              <Clock size={9} />{relativeTime(item.meta.updatedAt)}
            </div>
          )}
        </div>
      </div>
    </ItemContextMenu>
  );
}
