import { Hash } from "lucide-react";
import { cva } from "class-variance-authority";

const chipStyles = cva(
  "inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px]",
  {
    variants: {
      tone: {
        mention: "border-violet-500/30 bg-violet-500/10 text-violet-300",
        tag: "border-border bg-muted text-muted-foreground",
        kbd: "border-border bg-muted text-foreground",
      },
    },
    defaultVariants: { tone: "tag" },
  },
);

export function MentionChip({ kind, name }: { kind: string; name: string }) {
  return (
    <span className={chipStyles({ tone: "mention" })}>
      <Hash size={9} />
      {kind}/{name}
    </span>
  );
}

export function TagChip({ tag }: { tag: string }) {
  return (
    <span className={chipStyles({ tone: "tag" })}>
      <Hash size={9} />
      {tag}
    </span>
  );
}

export function KbdChip({ label }: { label: string }) {
  return <kbd className={chipStyles({ tone: "kbd" })}>{label}</kbd>;
}
