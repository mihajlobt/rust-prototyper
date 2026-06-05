import { Target, Calendar } from "lucide-react";
import {
  type PlanFrontmatter,
  type PlanStatus,
  parseTags,
  countTasks,
} from "@/lib/markdown/frontmatter";
import { TagChip } from "./chips";

const STATUS_META: Record<PlanStatus, { label: string; hue: StatusHue }> = {
  draft:     { label: "Draft",    hue: "amber" },
  planning:  { label: "Planning", hue: "violet" },
  in_review: { label: "In review", hue: "blue" },
  approved:  { label: "Approved", hue: "emerald" },
  done:      { label: "Done",     hue: "emerald" },
  blocked:   { label: "Blocked",  hue: "red" },
  risk:      { label: "Risk",     hue: "red" },
};

type StatusHue = "amber" | "violet" | "blue" | "emerald" | "red";

const HUE_RING: Record<StatusHue, string> = {
  amber:   "border-amber-500/30 text-amber-300 bg-amber-500/10",
  violet:  "border-violet-500/30 text-violet-300 bg-violet-500/10",
  blue:    "border-blue-500/30 text-blue-300 bg-blue-500/10",
  emerald: "border-emerald-500/30 text-emerald-300 bg-emerald-500/10",
  red:     "border-red-500/30 text-red-300 bg-red-500/10",
};

interface FrontmatterHeaderProps {
  frontmatter: PlanFrontmatter;
  body: string;
  className?: string;
}

export function FrontmatterHeader({ frontmatter, body, className }: FrontmatterHeaderProps) {
  const status = frontmatter.status ?? "draft";
  const tasks = countTasks(body);
  const tags = parseTags(frontmatter.tags);
  const progressPct = tasks.total > 0 ? Math.round((tasks.done / tasks.total) * 100) : 0;

  return (
    <header className={`not-prose border-b border-border bg-card/30 px-5 pt-5 pb-4 ${className ?? ""}`}>
      <div className="mb-2 flex items-center gap-1.5">
        <StatusPill hue={STATUS_META[status].hue} label={STATUS_META[status].label} />
        {frontmatter.area ? <AreaChip area={frontmatter.area} /> : null}
      </div>

      <h1 className="fm-title mb-3 text-[28px] font-semibold leading-[1.15] tracking-tight text-foreground">
        {frontmatter.title ?? "Untitled plan"}
      </h1>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-y border-border py-2 text-[11px] text-muted-foreground">
        {frontmatter.author ? <AuthorBadge name={frontmatter.author} /> : null}
        {frontmatter.target ? <MetaItem icon={<Target size={11} />}>{frontmatter.target}</MetaItem> : null}
        {frontmatter.updated ? <MetaItem icon={<Calendar size={11} />}>{frontmatter.updated}</MetaItem> : null}
        {tags.length > 0 ? <TagsList tags={tags} /> : null}
      </div>

      {tasks.total > 0 ? <ProgressBar done={tasks.done} total={tasks.total} percent={progressPct} /> : null}
    </header>
  );
}

function StatusPill({ hue, label }: { hue: StatusHue; label: string }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${HUE_RING[hue]}`}>
      {label}
    </span>
  );
}

function AreaChip({ area }: { area: string }) {
  return (
    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
      {area}
    </span>
  );
}

function AuthorBadge({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-flex size-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary">
        {initials}
      </span>
      {name}
    </span>
  );
}

function MetaItem({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1">
      {icon}
      {children}
    </span>
  );
}

function TagsList({ tags }: { tags: string[] }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {tags.map((tag) => (
        <TagChip key={tag} tag={tag} />
      ))}
    </span>
  );
}

function ProgressBar({ done, total, percent }: { done: number; total: number; percent: number }) {
  return (
    <div className="mt-3">
      <div className="mb-1 flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Tasks</span>
        <span className="font-mono">
          {done}/{total} · {percent}%
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary transition-[width] duration-200"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
