import { useState } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ChevronDown, Loader2, Search, CheckCircle } from "lucide-react"
import type { ResearchPhaseEntry } from "@/types/chat"

const PHASE_LABEL: Record<string, string> = {
  planning: "Planning approach",
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

/** Renders one phase entry's detail line — fetched URLs become clickable links. */
function PhaseDetailLine({ entry }: { entry: ResearchPhaseEntry }) {
  return (
    <div className="flex items-start gap-1.5 text-muted-foreground pl-2">
      {entry.phase === "searching" ? <Search className="h-3 w-3 mt-0.5 shrink-0" /> : <span className="shrink-0">↳</span>}
      {entry.phase === "fetching" && entry.detail ? (
        <a href={entry.detail} target="_blank" rel="noopener noreferrer" className="truncate text-blue-400 hover:underline">
          {entry.detail}
        </a>
      ) : (
        <span className="truncate">{entry.detail}</span>
      )}
    </div>
  )
}

export function ResearchProgressCard({ log, done }: { log: ResearchPhaseEntry[]; done: boolean }) {
  const [isOpen, setIsOpen] = useState(!done)
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set())
  if (log.length === 0) return null

  const last = log[log.length - 1]
  const planning = log.find((e) => e.phase === "planning")
  const rounds = groupByRound(log.filter((e) => e.phase !== "planning"))

  const toggleRound = (round: number) => {
    setExpandedRounds((prev) => {
      const next = new Set(prev)
      if (next.has(round)) next.delete(round)
      else next.add(round)
      return next
    })
  }

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
          {planning && <div className="text-muted-foreground">{PHASE_LABEL.planning}</div>}
          {rounds.map(({ round, entries }, i) => {
            const isLastRound = i === rounds.length - 1
            const sourcesThisRound = entries.filter((e) => e.phase === "fetching" && e.detail).length
            const queriesThisRound = entries.filter((e) => e.phase === "searching").length
            if (!isLastRound) {
              const isExpanded = expandedRounds.has(round)
              return (
                <div key={round} className="space-y-1">
                  <Button
                    variant="ghost"
                    onClick={() => toggleRound(round)}
                    className="h-auto w-full justify-start gap-1.5 p-0 font-normal text-muted-foreground hover:bg-transparent"
                  >
                    <ChevronDown className={cn("h-3 w-3 shrink-0", isExpanded && "rotate-180")} />
                    <span>Round {round} — {queriesThisRound} queries, {sourcesThisRound} sources</span>
                  </Button>
                  {isExpanded && entries.filter((e) => e.detail).map((e, j) => <PhaseDetailLine key={j} entry={e} />)}
                </div>
              )
            }
            return (
              <div key={round} className="space-y-1">
                <div className="text-foreground font-medium">Round {round}</div>
                {entries.filter((e) => e.detail).map((e, j) => <PhaseDetailLine key={j} entry={e} />)}
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
