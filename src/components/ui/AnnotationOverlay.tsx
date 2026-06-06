import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Annotation {
  id: string
  type: "point" | "region"
  x: number
  y: number
  w?: number
  h?: number
  text: string
  resolved?: boolean
}

export interface AnnotationPopupDraft {
  x: number
  y: number
  type: "point" | "region"
  w?: number
  h?: number
}

export interface AnnotationTextPopup {
  x: number
  y: number
  draft: AnnotationPopupDraft
}

export interface AnnotationOverlayProps {
  overlayRef: React.RefObject<HTMLDivElement | null>
  annotationMode: boolean
  liveRect: AnnotationPopupDraft | null
  annotations: Annotation[]
  textPopup: AnnotationTextPopup | null
  popupText: string
  onPopupTextChange: (value: string) => void
  onMouseDown: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseMove: (e: React.MouseEvent<HTMLDivElement>) => void
  onMouseUp: (e: React.MouseEvent<HTMLDivElement>) => void
  onCommit: () => void
  onCancelPopup: () => void
}

export function AnnotationOverlay({
  overlayRef,
  annotationMode,
  liveRect,
  annotations,
  textPopup,
  popupText,
  onPopupTextChange,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  onCommit,
  onCancelPopup,
}: AnnotationOverlayProps) {
  return (
    <div
      ref={overlayRef}
      className={cn("absolute inset-0", annotationMode ? "cursor-crosshair" : "pointer-events-none")}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={onMouseUp}
    >
      {liveRect && liveRect.type === "region" && (
        <div
          className="absolute border-2 border-primary bg-primary/10 pointer-events-none"
          style={{
            left: `${liveRect.x}%`,
            top: `${liveRect.y}%`,
            width: `${liveRect.w ?? 0}%`,
            height: `${liveRect.h ?? 0}%`,
          }}
        />
      )}

      {annotations.map((annotation, index) => (
        <AnnotationMarker key={annotation.id} annotation={annotation} index={index + 1} />
      ))}

      {textPopup && (
        <div
          className="absolute z-10 flex w-52 flex-col gap-2 rounded-lg border border-border bg-popover p-2 shadow-lg"
          style={{ left: textPopup.x, top: textPopup.y }}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <Input
            value={popupText}
            onChange={(e) => onPopupTextChange(e.target.value)}
            placeholder="Describe the issue…"
            className="h-7 text-xs"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") onCommit()
              if (e.key === "Escape") onCancelPopup()
            }}
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-6 flex-1 text-xs" onClick={onCommit} disabled={!popupText.trim()}>
              Add
            </Button>
            <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onCancelPopup}>
              <X size={12} />
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

function AnnotationTooltip({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn("absolute z-20 max-w-[200px] rounded bg-popover border border-border px-2 py-1 text-xs shadow-lg", className)}>
      {children}
    </div>
  )
}

function AnnotationMarker({ annotation, index }: { annotation: Annotation; index: number }) {
  const [showTooltip, setShowTooltip] = useState(false)

  if (annotation.type === "region" && annotation.w !== undefined && annotation.h !== undefined) {
    return (
      <div
        className="absolute border-2 border-primary/70 bg-primary/5"
        style={{
          left: `${annotation.x}%`,
          top: `${annotation.y}%`,
          width: `${annotation.w}%`,
          height: `${annotation.h}%`,
        }}
      >
        <div
          className="absolute -top-3 -left-0.5 flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground shadow"
          onMouseEnter={() => setShowTooltip(true)}
          onMouseLeave={() => setShowTooltip(false)}
        >
          {index}
        </div>
        {showTooltip && (
          <AnnotationTooltip className="top-5 left-0">{annotation.text}</AnnotationTooltip>
        )}
      </div>
    )
  }

  return (
    <div
      className="absolute"
      style={{ left: `${annotation.x}%`, top: `${annotation.y}%`, transform: "translate(-50%, -50%)" }}
    >
      <div
        className="flex h-5 w-5 cursor-pointer items-center justify-center rounded-full bg-primary text-[9px] font-bold text-primary-foreground shadow ring-2 ring-background"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
      >
        {index}
      </div>
      {showTooltip && (
        <AnnotationTooltip className="top-6 left-1/2 -translate-x-1/2 whitespace-nowrap">{annotation.text}</AnnotationTooltip>
      )}
    </div>
  )
}
