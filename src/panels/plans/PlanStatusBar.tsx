import { countWords, countTasks } from "@/lib/markdown/frontmatter";

export function PlanStatusBar({ body }: { body: string }) {
  const words = countWords(body);
  const readMin = Math.max(1, Math.ceil(words / 220));
  const tasks = countTasks(body);
  const blocks = countMatches(body, /^(?:#{1,6}\s|>\s|```|---$|:::[a-z-]+)/gm);
  const mentions = countMatches(body, /(?:^|\s)@[a-z]+\/[\w-]+/g);

  return (
    <footer className="shrink-0 border-t border-border bg-card font-mono text-[10px] text-muted-foreground">
      <div className="flex h-7 items-center gap-3 px-3 tabular-nums">
        <span>{words.toLocaleString()} words</span>
        <span className="text-border">·</span>
        <span>{readMin} min read</span>
        <span className="text-border">·</span>
        <span>
          {tasks.done}/{tasks.total} tasks
        </span>
        <div className="flex-1" />
        <span>Markdown</span>
        <span className="text-border">·</span>
        <span>UTF-8</span>
        <span className="text-border">·</span>
        <span>/ {blocks} blocks</span>
        <span className="text-border">·</span>
        <span>@ {mentions} mentions</span>
      </div>
    </footer>
  );
}

function countMatches(text: string, regex: RegExp): number {
  return text.match(regex)?.length ?? 0;
}

