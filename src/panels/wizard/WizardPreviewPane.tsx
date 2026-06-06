import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Smartphone, Tablet, Monitor, Sun, Moon, Pencil, X, RefreshCw, Play, Square, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { useDevServerStore } from "@/lib/dev-server-manager"
import { ThemeTokenPreview } from "@/panels/theme-preview/ThemeTokenPreview"
import type { WizardAnnotation, WizardPreviewTab } from "./types"

interface DraftAnnotation {
  x: number
  y: number
  w?: number
  h?: number
  type: "point" | "region"
}

interface TextPopup {
  x: number
  y: number
  draft: DraftAnnotation
}

interface WizardPreviewPaneProps {
  generatedDir: string
  device: "desktop" | "tablet" | "mobile"
  darkMode: boolean
  annotations: WizardAnnotation[]
  /** When set, navigate the preview iframe to this route path after HMR settles. */
  previewNavigatePath: string | null
  previewTabs: WizardPreviewTab[]
  activePreviewTabId: string | null
  themeCss: string | null
  onSelectTab: (id: string) => void
  onSetDevice: (device: "desktop" | "tablet" | "mobile") => void
  onToggleDark: () => void
  onAddAnnotation: (annotation: Omit<WizardAnnotation, "id" | "createdAt">) => void
}

const DEVICE_WIDTHS: Record<"desktop" | "tablet" | "mobile", number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 375,
}

export function WizardPreviewPane({
  generatedDir,
  device,
  darkMode,
  annotations,
  previewNavigatePath,
  previewTabs,
  activePreviewTabId,
  themeCss,
  onSelectTab,
  onSetDevice,
  onToggleDark,
  onAddAnnotation,
}: WizardPreviewPaneProps) {
  const { runnerStatus, runnerUrl, startRunner, stopRunner } = useDevServerStore()
  const [annotationMode, setAnnotationMode] = useState(false)
  const [textPopup, setTextPopup] = useState<TextPopup | null>(null)
  const [popupText, setPopupText] = useState("")
  const overlayRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [liveRect, setLiveRect] = useState<DraftAnnotation | null>(null)
  const [designMode, setDesignMode] = useState<"preview" | "gallery">("preview")

  const deviceWidth = DEVICE_WIDTHS[device]
  const designOpen = activePreviewTabId === "design"
  const activeScreenTab = previewTabs.find((tab) => tab.id === activePreviewTabId)
  const currentPath = activeScreenTab ? (activeScreenTab.previewPath ?? activeScreenTab.urlPath) : null

  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage({ type: "set-dark", value: darkMode }, "*")
    }
  }, [darkMode])

  useEffect(() => {
    if (!previewNavigatePath || !runnerUrl || !iframeRef.current) return
    const base = runnerUrl.replace(/\/$/, "")
    iframeRef.current.src = `${base}${previewNavigatePath}`
  }, [previewNavigatePath, runnerUrl])

  const getRelativeCoords = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const overlay = overlayRef.current
    if (!overlay) return { x: 0, y: 0 }
    const rect = overlay.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!annotationMode || textPopup) return
    e.preventDefault()
    const coords = getRelativeCoords(e)
    dragStartRef.current = coords
    setLiveRect(null)
  }, [annotationMode, textPopup, getRelativeCoords])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!annotationMode || !dragStartRef.current) return
    const current = getRelativeCoords(e)
    const start = dragStartRef.current
    const dx = Math.abs(current.x - start.x)
    const dy = Math.abs(current.y - start.y)
    if (dx > 2 || dy > 2) {
      setLiveRect({
        type: "region",
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x),
        h: Math.abs(current.y - start.y),
      })
    }
  }, [annotationMode, getRelativeCoords])

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!annotationMode || !dragStartRef.current) return
    const current = getRelativeCoords(e)
    const start = dragStartRef.current
    dragStartRef.current = null

    const dx = Math.abs(current.x - start.x)
    const dy = Math.abs(current.y - start.y)
    const overlay = overlayRef.current
    if (!overlay) return
    const rect = overlay.getBoundingClientRect()

    let draft: DraftAnnotation
    if (dx < 2 && dy < 2) {
      draft = { type: "point", x: start.x, y: start.y }
      setLiveRect(null)
      setTextPopup({
        x: Math.max(0, Math.min(e.clientX - rect.left, rect.width - 220)),
        y: Math.max(0, Math.min(e.clientY - rect.top + 10, rect.height - 80)),
        draft,
      })
    } else {
      draft = {
        type: "region",
        x: Math.min(start.x, current.x),
        y: Math.min(start.y, current.y),
        w: Math.abs(current.x - start.x),
        h: Math.abs(current.y - start.y),
      }
      setLiveRect(null)
      const centerX = ((draft.x + (draft.w ?? 0) / 2) / 100) * rect.width
      const centerY = ((draft.y + (draft.h ?? 0) / 2) / 100) * rect.height
      setTextPopup({
        x: Math.max(0, Math.min(centerX - 100, rect.width - 220)),
        y: Math.max(0, Math.min(centerY, rect.height - 80)),
        draft,
      })
    }
    setPopupText("")
  }, [annotationMode, getRelativeCoords])

  const commitAnnotation = useCallback(() => {
    if (!textPopup || !popupText.trim()) return
    onAddAnnotation({
      type: textPopup.draft.type,
      x: textPopup.draft.x,
      y: textPopup.draft.y,
      w: textPopup.draft.w,
      h: textPopup.draft.h,
      text: popupText.trim(),
      resolved: false,
    })
    setTextPopup(null)
    setPopupText("")
  }, [textPopup, popupText, onAddAnnotation])

  const openAnnotations = annotations.filter((a) => !a.resolved)

  return (
    <div className="flex h-full flex-col">
      <div className="panel-toolbar h-10 shrink-0 px-3 gap-2 bg-card">
        <span className="text-sm font-medium">Preview</span>

        {/* Dev server start/stop */}
        {runnerStatus === "running" ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={stopRunner} title="Stop preview server">
            <Square size={12} />
          </Button>
        ) : runnerStatus === "starting" ? (
          <Button variant="ghost" size="icon" className="h-7 w-7" disabled title="Starting…">
            <Loader2 size={12} className="animate-spin" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { void startRunner(generatedDir) }} title="Start preview server">
            <Play size={12} />
          </Button>
        )}

        {currentPath && runnerUrl && (
          <span className="text-xs text-muted-foreground font-mono truncate max-w-[160px]" title={currentPath}>
            {currentPath}
          </span>
        )}

        <div className="flex-1" />

        {designOpen ? (
          <>
            <Tabs value={designMode} onValueChange={(mode) => setDesignMode(mode as "preview" | "gallery")}>
              <TabsList className="h-6">
                <TabsTrigger value="preview" className="text-xs">Tokens</TabsTrigger>
                <TabsTrigger value="gallery" className="text-xs">Gallery</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="w-px h-4 bg-border mx-1" />
          </>
        ) : (
          <>
            <div className="flex items-center gap-1">
              <Button variant={device === "mobile" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => onSetDevice("mobile")} title="Mobile (375px)">
                <Smartphone size={12} />
              </Button>
              <Button variant={device === "tablet" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => onSetDevice("tablet")} title="Tablet (768px)">
                <Tablet size={12} />
              </Button>
              <Button variant={device === "desktop" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => onSetDevice("desktop")} title="Desktop (full width)">
                <Monitor size={12} />
              </Button>
            </div>
            <div className="w-px h-4 bg-border mx-1" />
          </>
        )}

        <Button variant={darkMode ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={onToggleDark} title={darkMode ? "Light mode" : "Dark mode"}>
          {darkMode ? <Moon size={12} /> : <Sun size={12} />}
        </Button>

        {!designOpen && (
          <>
            <Button size="icon" variant="ghost" className="h-7 w-7"
              onClick={() => { if (iframeRef.current) iframeRef.current.src = iframeRef.current.src }}
              title="Refresh preview"
            >
              <RefreshCw size={12} />
            </Button>
            <div className="w-px h-4 bg-border mx-1" />
            <Button
              size="sm"
              variant={annotationMode ? "default" : "outline"}
              className="h-6 gap-1 px-2 text-xs"
              onClick={() => { setAnnotationMode((a) => !a); setTextPopup(null); setLiveRect(null) }}
            >
              <Pencil size={11} />
              {annotationMode ? "Done" : "Annotate"}
            </Button>
          </>
        )}
      </div>

      {(previewTabs.length > 0 || themeCss !== null) && (
        <Tabs value={activePreviewTabId ?? ""} onValueChange={onSelectTab} className="shrink-0">
          <TabsList variant="line" className="h-8 w-full justify-start rounded-none border-b px-2">
            {previewTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
            {themeCss !== null && (
              <TabsTrigger value="design" className="text-xs">Design</TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      )}

      {/* Preview iframe — kept in DOM when design tab is active so iframeRef stays valid */}
      <div className={cn("relative flex-1 overflow-auto bg-muted/20 flex justify-center", designOpen && "hidden")}>
        <div className="relative h-full" style={{ width: deviceWidth ? `${deviceWidth}px` : "100%" }}>
          {runnerUrl ? (
            <iframe
              ref={iframeRef}
              src={runnerUrl}
              className="h-full w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-forms"
            />
          ) : (
            <div className="flex h-full items-center justify-center">
              <p className="text-sm text-muted-foreground text-center px-4">
                Preview will appear here once generation completes
              </p>
            </div>
          )}

          <div
            ref={overlayRef}
            className={cn("absolute inset-0", annotationMode ? "cursor-crosshair" : "pointer-events-none")}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {liveRect && liveRect.type === "region" && (
              <div
                className="absolute border-2 border-primary bg-primary/10 pointer-events-none"
                style={{ left: `${liveRect.x}%`, top: `${liveRect.y}%`, width: `${liveRect.w}%`, height: `${liveRect.h}%` }}
              />
            )}

            {openAnnotations.map((annotation, index) => (
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
                  onChange={(e) => setPopupText(e.target.value)}
                  placeholder="Describe the issue…"
                  className="h-7 text-xs"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitAnnotation()
                    if (e.key === "Escape") { setTextPopup(null); setLiveRect(null) }
                  }}
                />
                <div className="flex gap-1">
                  <Button size="sm" className="h-6 flex-1 text-xs" onClick={commitAnnotation} disabled={!popupText.trim()}>
                    Add
                  </Button>
                  <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={() => { setTextPopup(null); setLiveRect(null) }}>
                    <X size={12} />
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {designOpen && (
        <div className="flex-1 overflow-hidden">
          <ThemeTokenPreview css={themeCss ?? ""} isDark={darkMode} viewMode={designMode} />
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

function AnnotationMarker({ annotation, index }: { annotation: WizardAnnotation; index: number }) {
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
