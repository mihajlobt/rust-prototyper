// PlanCommandMenu — Cmd+K command palette for the Plans view.
//
// Uses the shadcn `CommandDialog` primitive directly per the canonical
// shadcn example. Four groups: Mode, Insert, Goto section, Export.
// - Mode:   switch between focus / write / split / read
// - Insert: format actions that delegate to the editor handle
// - Goto:   jump to a heading (uses `extractHeadings`)
// - Export: copy markdown / download .md / copy plain text
//
// The palette is scoped to the Plans view — there is no global Cmd+K binding.

import { useMemo } from "react";
import {
  Pencil,
  Columns2,
  BookOpen,
  Focus,
  Heading1,
  Heading2,
  Heading3,
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Link as LinkIcon,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Code2,
  Table as TableIcon,
  Megaphone,
  Minus,
  Copy,
  Download,
  FileText,
} from "lucide-react";
import { notify } from "@/hooks/useToast";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { stripMarkdown } from "@/lib/markdown/strip";
import { extractHeadingsFlat, type PlanHeading } from "@/lib/markdown/headings";
import { type EditorAction, type PlanEditorHandle } from "./PlanEditor";
import { type PlanMode } from "./PlansPanelParts";

interface PlanCommandMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: string;
  editorHandle: React.RefObject<PlanEditorHandle | null>;
  currentMode: PlanMode;
  onModeChange: (mode: PlanMode) => void;
  activePlan: string;
}

interface InsertItem {
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  action: EditorAction;
}

const INSERT_ITEMS: InsertItem[] = [
  { label: "Heading 1",     icon: Heading1,        action: { type: "setHeading",    level: 1 } },
  { label: "Heading 2",     icon: Heading2,        action: { type: "setHeading",    level: 2 } },
  { label: "Heading 3",     icon: Heading3,        action: { type: "setHeading",    level: 3 } },
  { label: "Bold",          icon: Bold,            action: { type: "wrap",         wrap: "**" } },
  { label: "Italic",        icon: Italic,          action: { type: "wrap",         wrap: "*" } },
  { label: "Strikethrough", icon: Strikethrough,   action: { type: "wrap",         wrap: "~~" } },
  { label: "Inline code",   icon: Code,            action: { type: "wrap",         wrap: "`" } },
  { label: "Highlight",     icon: Highlighter,     action: { type: "wrap",         wrap: "==" } },
  { label: "Link",          icon: LinkIcon,        action: { type: "insertLink" } },
  { label: "Bulleted list", icon: List,            action: { type: "prefixLines",  prefix: "- " } },
  { label: "Numbered list", icon: ListOrdered,     action: { type: "prefixLines",  prefix: "1. " } },
  { label: "Task list",     icon: ListTodo,        action: { type: "prefixLines",  prefix: "- [ ] " } },
  { label: "Quote",         icon: Quote,           action: { type: "prefixLines",  prefix: "> " } },
  { label: "Code block",    icon: Code2,           action: { type: "insertBlock",  text: "```ts\n// code\n```" } },
  { label: "Table",         icon: TableIcon,       action: { type: "insertBlock",  text: "| Column A | Column B |\n| -------- | -------- |\n| Cell     | Cell     |" } },
  { label: "Callout",       icon: Megaphone,       action: { type: "insertBlock",  text: "> [!NOTE]\n> Body text" } },
  { label: "Divider",       icon: Minus,           action: { type: "insertAtCursor", text: "\n---\n" } },
];

const MODES: Array<{ id: PlanMode; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "write",  label: "Write",  icon: Pencil },
  { id: "split",  label: "Split",  icon: Columns2 },
  { id: "read",   label: "Read",   icon: BookOpen },
  { id: "focus",  label: "Focus",  icon: Focus },
];

export function PlanCommandMenu({
  open,
  onOpenChange,
  source,
  editorHandle,
  currentMode,
  onModeChange,
  activePlan,
}: PlanCommandMenuProps) {
  const headings = useMemo(() => extractHeadingsFlat(source), [source]);

  const dispatch = (action: EditorAction) => {
    editorHandle.current?.dispatch(action);
    onOpenChange(false);
  };

  const gotoHeading = (h: PlanHeading) => {
    // h.line is 0-indexed; goToLine / CodeMirror doc.line() expects 1-indexed
    editorHandle.current?.dispatch({ type: "goToLine", line: h.line + 1 });
    onOpenChange(false);
  };

  const setMode = (mode: PlanMode) => {
    onModeChange(mode);
    onOpenChange(false);
  };

  const copyMarkdown = async () => {
    try {
      await navigator.clipboard.writeText(source);
      notify.success("Copied markdown to clipboard");
    } catch (err) {
      notify.error("Copy failed", err instanceof Error ? err.message : String(err));
    }
    onOpenChange(false);
  };

  const copyPlainText = async () => {
    try {
      const plain = await stripMarkdown(source);
      await navigator.clipboard.writeText(plain);
      notify.success("Copied plain text to clipboard");
    } catch (err) {
      notify.error("Copy failed", err instanceof Error ? err.message : String(err));
    }
    onOpenChange(false);
  };

  const downloadMarkdown = () => {
    const blob = new Blob([source], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${activePlan}.md`;
    a.click();
    URL.revokeObjectURL(url);
    onOpenChange(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Type a command or search…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        <CommandGroup heading="Mode">
          {MODES.map((m) => {
            const Icon = m.icon;
            return (
              <CommandItem
                key={m.id}
                value={`mode ${m.label.toLowerCase()}`}
                onSelect={() => setMode(m.id)}
              >
                <Icon size={14} />
                <span>{m.label}</span>
                {m.id === currentMode ? <CommandShortcut>active</CommandShortcut> : null}
              </CommandItem>
            );
          })}
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Insert">
          {INSERT_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <CommandItem
                key={item.label}
                value={`insert ${item.label.toLowerCase()}`}
                onSelect={() => dispatch(item.action)}
              >
                <Icon size={14} />
                <span>{item.label}</span>
              </CommandItem>
            );
          })}
        </CommandGroup>

        {headings.length > 0 ? (
          <>
            <CommandSeparator />
            <CommandGroup heading={`Goto section (${headings.length})`}>
              {headings.slice(0, 12).map((h) => (
                <CommandItem
                  key={`${h.line}-${h.text}`}
                  value={`goto h${h.level} ${h.text.toLowerCase()}`}
                  onSelect={() => gotoHeading(h)}
                >
                  <span className="font-mono text-[10px] text-muted-foreground">
                    H{h.level}
                  </span>
                  <span className="truncate">{h.text}</span>
                  <CommandShortcut>L{h.line + 1}</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        ) : null}

        <CommandSeparator />

        <CommandGroup heading="Export">
          <CommandItem value="export copy markdown" onSelect={copyMarkdown}>
            <Copy size={14} />
            <span>Copy as markdown</span>
          </CommandItem>
          <CommandItem value="export copy plain text" onSelect={copyPlainText}>
            <FileText size={14} />
            <span>Copy as plain text</span>
          </CommandItem>
          <CommandItem value="export download markdown file" onSelect={downloadMarkdown}>
            <Download size={14} />
            <span>Download .md</span>
            <CommandShortcut>{activePlan}.md</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
