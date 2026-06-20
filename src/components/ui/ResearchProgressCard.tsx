import { useState } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ChevronDown, Loader2, Search, CheckCircle } from "lucide-react"
import type { ResearchPhaseEntry } from "@/types/chat"

const PHASE_LABEL: Record<string, string> = {
  round_start: "Starting round",
  searching: "Searching",
  fetching: "Reading",
  synthesizing: "Synthesizing",
  deciding: "Deciding",
  final_report: "Writing report",
}

/** Groups a flat ResearchPhase log into per-round buckets, preserving arrival order. */
function groupByRound(log: ResearchPhaseEntry[]): { round: number; entries: ResearchPhaseEntry[] }[] {
  const rounds: { round: number; entries: ResearchPhaseEntry[] }[] = []
  for (const entry of log) {
    const bucket = rounds.at(-1)
    if (bucket?.round === entry.round) bucket.entries.push(entry)
    else rounds.push({ round: entry.round, entries: [entry] })
  }
  return rounds
}

export function ResearchProgressCard({ log, done }: { log: ResearchPhaseEntry[]; done: boolean }) {
  const [isOpen, setIsOpen] = useState(!done)
  if (log.length === 0) return null

  const last = log[log.length - 1]
  const rounds = groupByRound(log)

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen} className="border-border overflow-hidden rounded-lg border">
      <CollapsibleTrigger asChild>
        <Button variant="ghost" className="bg-background h-auto w-full justify-between rounded-b-none px-3 py-2 font-normal">
          <div className="flex items-center gap-2 min-w-0">
            {done ? <CheckCircle className="h-4 w-4 text-green-500" /> : <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
            <span className="font-mono text-sm font-medium shrink-0">Research</span>
            <span className="text-xs text-muted-foreground shrink-0">Round {last.round}/{last.maxRounds}</span>
            <span className="text-xs text-muted-foreground truncate">{PHASE_LABEL[last.phase] ?? last.phase}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-muted-foreground">{last.sources} source{last.sources === 1 ? "" : "s"}</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0", isOpen && "rotate-180")} />
          </div>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border border-t data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down overflow-hidden">
        <div className="bg-background p-3 space-y-2 text-xs">
          {rounds.map(({ round, entries }, i) => {
            const isLastRound = i === rounds.length - 1
            const sourcesThisRound = entries.filter((e) => e.phase === "fetching" && e.detail).length
            if (!isLastRound) {
              return (
                <div key={round} className="text-muted-foreground">
                  Round {round} — {entries.filter((e) => e.phase === "searching").length} queries, {sourcesThisRound} sources
                </div>
              )
            }
            return (
              <div key={round} className="space-y-1">
                <div className="text-foreground font-medium">Round {round}</div>
                {entries.filter((e) => e.detail).map((e, j) => (
                  <div key={j} className="flex items-start gap-1.5 text-muted-foreground pl-2">
                    {e.phase === "searching" ? <Search className="h-3 w-3 mt-0.5 shrink-0" /> : <span className="shrink-0">↳</span>}
                    <span className="truncate">{e.detail}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
