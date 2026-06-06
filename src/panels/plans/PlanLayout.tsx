// PlanLayout — mode-dependent layout for the Plans view.
//
// Each mode wraps its primary surface in an Allotment that includes the
// agent chat as a toggleable side panel. Each mode uses its own
// `useAllotmentLayout` key so the user can drag the chat width
// independently per mode (write, read, split).
//
// Focus mode intentionally has no chat — distraction-free editing.

import { Allotment } from "allotment";
import type { Extension } from "@codemirror/state";
import { PlanEditor, type PlanEditorHandle, type SelectionInfo } from "./PlanEditor";
import { FormatToolbar } from "./FormatToolbar";
import { PlanPreview } from "./PlanPreview";
import { FrontmatterHeader } from "./FrontmatterHeader";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { parseFrontmatter } from "@/lib/markdown/frontmatter";

const CHAT_MIN = 280;
const CHAT_PREFERRED = 360;

interface PlanLayoutProps {
  source: string;
  onSourceChange: (v: string) => void;
  mode: "write" | "split" | "read" | "focus";
  lineNumbers: boolean;
  chatOpen: boolean;
  currentLine: number;
  onCursorLineChange: (line: number) => void;
  onSelectionChange: (info: SelectionInfo | null) => void;
  extraExtensions: Extension[];
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
  onTaskToggle: (line: number) => void;
  chatSlot: React.ReactNode;
}

export function PlanLayout({
  source,
  onSourceChange,
  mode,
  lineNumbers,
  chatOpen,
  onCursorLineChange,
  onSelectionChange,
  extraExtensions,
  editorHandle,
  onTaskToggle,
  chatSlot,
}: PlanLayoutProps) {
  if (mode === "focus") {
    return <FocusLayout source={source} onSourceChange={onSourceChange} onCursorLineChange={onCursorLineChange} onSelectionChange={onSelectionChange} extraExtensions={extraExtensions} editorHandle={editorHandle} />;
  }
  if (mode === "read") {
    return <ReadLayout source={source} onTaskToggle={onTaskToggle} chatOpen={chatOpen} chatSlot={chatSlot} />;
  }
  if (mode === "write") {
    return <WriteLayout source={source} onSourceChange={onSourceChange} lineNumbers={lineNumbers} onCursorLineChange={onCursorLineChange} onSelectionChange={onSelectionChange} extraExtensions={extraExtensions} editorHandle={editorHandle} chatOpen={chatOpen} chatSlot={chatSlot} />;
  }
  return <SplitLayout source={source} onSourceChange={onSourceChange} lineNumbers={lineNumbers} onCursorLineChange={onCursorLineChange} onSelectionChange={onSelectionChange} extraExtensions={extraExtensions} editorHandle={editorHandle} onTaskToggle={onTaskToggle} chatOpen={chatOpen} chatSlot={chatSlot} />;
}

// ─── Mode: focus (no chat) ────────────────────────────────────────────────────

function FocusLayout({ source, onSourceChange, onCursorLineChange, onSelectionChange, extraExtensions, editorHandle }: {
  source: string;
  onSourceChange: (v: string) => void;
  onCursorLineChange: (line: number) => void;
  onSelectionChange: (info: SelectionInfo | null) => void;
  extraExtensions: Extension[];
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
}) {
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-[720px] px-8 py-12">
        <PlanEditor
          ref={editorHandle}
          value={source}
          onChange={onSourceChange}
          lineNumbers={false}
          onCursorLineChange={onCursorLineChange}
          onSelectionChange={onSelectionChange}
          extraExtensions={extraExtensions}
        />
      </div>
    </div>
  );
}

// ─── Mode: write (editor + chat) ─────────────────────────────────────────────

function WriteLayout({ source, onSourceChange, lineNumbers, onCursorLineChange, onSelectionChange, extraExtensions, editorHandle, chatOpen, chatSlot }: {
  source: string;
  onSourceChange: (v: string) => void;
  lineNumbers: boolean;
  onCursorLineChange: (line: number) => void;
  onSelectionChange: (info: SelectionInfo | null) => void;
  extraExtensions: Extension[];
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
  chatOpen: boolean;
  chatSlot: React.ReactNode;
}) {
  const { ref, onDragEnd, defaultSizes } = useAllotmentLayout(
    "plans-write",
    2,
    [true, chatOpen],
  );
  return (
    <Allotment ref={ref} onDragEnd={onDragEnd} defaultSizes={defaultSizes}>
      <Allotment.Pane>
        <div className="flex h-full flex-col">
          <FormatToolbar editorHandle={editorHandle} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <PlanEditor
              ref={editorHandle}
              value={source}
              onChange={onSourceChange}
              lineNumbers={lineNumbers}
              onCursorLineChange={onCursorLineChange}
              onSelectionChange={onSelectionChange}
              extraExtensions={extraExtensions}
            />
          </div>
        </div>
      </Allotment.Pane>
      <Allotment.Pane visible={chatOpen} minSize={CHAT_MIN} preferredSize={CHAT_PREFERRED}>
        {chatSlot}
      </Allotment.Pane>
    </Allotment>
  );
}

// ─── Mode: read (preview + chat) ─────────────────────────────────────────────

function ReadLayout({ source, onTaskToggle, chatOpen, chatSlot }: {
  source: string;
  onTaskToggle: (line: number) => void;
  chatOpen: boolean;
  chatSlot: React.ReactNode;
}) {
  const parsed = parseFrontmatter(source);
  const { ref, onDragEnd, defaultSizes } = useAllotmentLayout(
    "plans-read",
    2,
    [true, chatOpen],
  );
  return (
    <Allotment ref={ref} onDragEnd={onDragEnd} defaultSizes={defaultSizes}>
      <Allotment.Pane>
        <PreviewPane parsed={parsed} onTaskToggle={onTaskToggle} />
      </Allotment.Pane>
      <Allotment.Pane visible={chatOpen} minSize={CHAT_MIN} preferredSize={CHAT_PREFERRED}>
        {chatSlot}
      </Allotment.Pane>
    </Allotment>
  );
}

// ─── Mode: split (editor + preview + chat) ───────────────────────────────────

function SplitLayout({ source, onSourceChange, lineNumbers, onCursorLineChange, onSelectionChange, extraExtensions, editorHandle, onTaskToggle, chatOpen, chatSlot }: {
  source: string;
  onSourceChange: (v: string) => void;
  lineNumbers: boolean;
  onCursorLineChange: (line: number) => void;
  onSelectionChange: (info: SelectionInfo | null) => void;
  extraExtensions: Extension[];
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
  onTaskToggle: (line: number) => void;
  chatOpen: boolean;
  chatSlot: React.ReactNode;
}) {
  const parsed = parseFrontmatter(source);
  const { ref, onDragEnd, defaultSizes } = useAllotmentLayout(
    "plans-split",
    3,
    [true, true, chatOpen],
  );
  return (
    <Allotment ref={ref} onDragEnd={onDragEnd} defaultSizes={defaultSizes}>
      <Allotment.Pane>
        <div className="flex h-full flex-col">
          <FormatToolbar editorHandle={editorHandle} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <PlanEditor
              ref={editorHandle}
              value={source}
              onChange={onSourceChange}
              lineNumbers={lineNumbers}
              onCursorLineChange={onCursorLineChange}
              onSelectionChange={onSelectionChange}
              extraExtensions={extraExtensions}
            />
          </div>
        </div>
      </Allotment.Pane>
      <Allotment.Pane>
        <PreviewPane parsed={parsed} onTaskToggle={onTaskToggle} />
      </Allotment.Pane>
      <Allotment.Pane visible={chatOpen} minSize={CHAT_MIN} preferredSize={CHAT_PREFERRED}>
        {chatSlot}
      </Allotment.Pane>
    </Allotment>
  );
}

// ─── Preview pane (shared by read + split modes) ─────────────────────────────

function PreviewPane({ parsed, onTaskToggle }: {
  parsed: ReturnType<typeof parseFrontmatter>;
  onTaskToggle: (line: number) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      {parsed.frontmatter ? <FrontmatterHeader frontmatter={parsed.frontmatter} body={parsed.body} /> : null}
      <div className="min-h-0 flex-1 overflow-hidden">
        <PlanPreview body={parsed.body} onTaskToggle={onTaskToggle} />
      </div>
    </div>
  );
}
