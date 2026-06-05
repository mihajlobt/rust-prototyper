import { type MouseEvent } from "react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Link as LinkIcon,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListTodo,
  Quote,
  Minus,
  Code2,
  Table as TableIcon,
  Megaphone,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { type PlanEditorHandle } from "./PlanEditor";

interface FormatToolbarProps {
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
}

export function FormatToolbar({ editorHandle }: FormatToolbarProps) {
  const run = (action: Parameters<PlanEditorHandle["dispatch"]>[0]) =>
    (e: MouseEvent) => {
      e.preventDefault();
      editorHandle.current?.dispatch(action);
    };

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border bg-card px-2">
      <FmtButton label="H1" onMouseDown={run({ type: "setHeading", level: 1 })}>
        <Heading1 size={12} />
      </FmtButton>
      <FmtButton label="H2" onMouseDown={run({ type: "setHeading", level: 2 })}>
        <Heading2 size={12} />
      </FmtButton>
      <FmtButton label="H3" onMouseDown={run({ type: "setHeading", level: 3 })}>
        <Heading3 size={12} />
      </FmtButton>
      <ToolbarSeparator />

      <FmtButton label="Bold" onMouseDown={run({ type: "wrap", wrap: "**" })}>
        <Bold size={12} />
      </FmtButton>
      <FmtButton label="Italic" onMouseDown={run({ type: "wrap", wrap: "*" })}>
        <Italic size={12} />
      </FmtButton>
      <FmtButton label="Strike" onMouseDown={run({ type: "wrap", wrap: "~~" })}>
        <Strikethrough size={12} />
      </FmtButton>
      <FmtButton label="Inline code" onMouseDown={run({ type: "wrap", wrap: "`" })}>
        <Code size={12} />
      </FmtButton>
      <FmtButton label="Highlight" onMouseDown={run({ type: "wrap", wrap: "==" })}>
        <Highlighter size={12} />
      </FmtButton>
      <FmtButton label="Link" onMouseDown={run({ type: "insertLink" })}>
        <LinkIcon size={12} />
      </FmtButton>
      <ToolbarSeparator />

      <FmtButton label="Bulleted list" onMouseDown={run({ type: "prefixLines", prefix: "- " })}>
        <List size={12} />
      </FmtButton>
      <FmtButton label="Numbered list" onMouseDown={run({ type: "prefixLines", prefix: "1. " })}>
        <ListOrdered size={12} />
      </FmtButton>
      <FmtButton label="Task list" onMouseDown={run({ type: "prefixLines", prefix: "- [ ] " })}>
        <ListTodo size={12} />
      </FmtButton>
      <FmtButton label="Quote" onMouseDown={run({ type: "prefixLines", prefix: "> " })}>
        <Quote size={12} />
      </FmtButton>
      <ToolbarSeparator />

      <FmtButton
        label="Code block"
        onMouseDown={run({ type: "insertBlock", text: "```ts\n// code\n```" })}
      >
        <Code2 size={12} />
      </FmtButton>
      <FmtButton
        label="Table"
        onMouseDown={run({ type: "insertBlock", text: "| Column A | Column B |\n| -------- | -------- |\n| Cell     | Cell     |" })}
      >
        <TableIcon size={12} />
      </FmtButton>
      <FmtButton
        label="Callout"
        onMouseDown={run({ type: "insertBlock", text: "> [!NOTE]\n> Body text" })}
      >
        <Megaphone size={12} />
      </FmtButton>
      <FmtButton label="Divider" onMouseDown={run({ type: "insertBlock", text: "---" })}>
        <Minus size={12} />
      </FmtButton>
      </div>
    </TooltipProvider>
  );
}

function FmtButton({
  label,
  onMouseDown,
  children,
}: {
  label: string;
  onMouseDown: (e: MouseEvent) => void;
  children: React.ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          aria-label={label}
          onMouseDown={onMouseDown}
          variant="ghost"
          size="icon-sm"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

function ToolbarSeparator() {
  return <Separator orientation="vertical" className="mx-0.5 h-4" />;
}
