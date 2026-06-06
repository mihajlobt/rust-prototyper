import { useState, useRef, useCallback, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Smartphone, Tablet, Monitor, Sun, Moon, Pencil, X, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"
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
  devUrl: string | null
  device: "desktop" | "tablet" | "mobile"
  darkMode: boolean
  annotations: WizardAnnotation[]
  /** When set, navigate the preview iframe to this route path after HMR settles. */
  previewNavigatePath: string | null
  previewTabs: WizardPreviewTab[]
  activePreviewTabId: string | null
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
  devUrl,
  device,
  darkMode,
  annotations,
  previewNavigatePath,
  previewTabs,
  activePreviewTabId,
  onSelectTab,
  onSetDevice,
  onToggleDark,
  onAddAnnotation,
}: WizardPreviewPaneProps) {
  const [annotationMode, setAnnotationMode] = useState(false)
  const [textPopup, setTextPopup] = useState<TextPopup | null>(null)
  const [popupText, setPopupText] = useState("")
  const overlayRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [liveRect, setLiveRect] = useState<DraftAnnotation | null>(null)

  const deviceWidth = DEVICE_WIDTHS[device]
  const activeTab = previewTabs.find((t) => t.id === activePreviewTabId)
  const isThemeTabActive = activeTab?.type === "theme"

  useEffect(() => {
    if (iframeRef.current) {
      iframeRef.current.contentWindow?.postMessage({ type: "set-dark", value: darkMode }, "*")
    }
  }, [darkMode])

  // Navigate preview to the newly registered screen path when triggered by useWizard.
  // previewNavigatePath is set after router.tsx is written (HMR has had 1.5s to settle).
  useEffect(() => {
    if (!previewNavigatePath || !devUrl || !iframeRef.current) return
    const base = devUrl.replace(/\/$/, "")
    iframeRef.current.src = `${base}${previewNavigatePath}`
  }, [previewNavigatePath, devUrl])

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
      {/* Toolbar — reusing device/dark pattern from ThemePreviewToolbar */}
      <div className="panel-toolbar h-10 shrink-0 px-3 gap-2 bg-card">
        <span className="text-xs font-medium text-muted-foreground">Preview</span>
        <div className="flex-1" />

        {/* Device selector */}
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

        {/* Dark mode */}
        <Button variant={darkMode ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={onToggleDark} title={darkMode ? "Light mode" : "Dark mode"}>
          {darkMode ? <Moon size={12} /> : <Sun size={12} />}
        </Button>

        {/* Refresh */}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7"
          onClick={() => {
            if (iframeRef.current) {
              // Reassign src to force reload without touching contentWindow (cross-origin safe)
              iframeRef.current.src = iframeRef.current.src
            }
          }}
          title="Refresh preview"
        >
          <RefreshCw size={12} />
        </Button>

        <div className="w-px h-4 bg-border mx-1" />

        {/* Annotation toggle */}
        <Button
          size="sm"
          variant={annotationMode ? "default" : "outline"}
          className="h-6 gap-1 px-2 text-xs"
          disabled={isThemeTabActive}
          onClick={() => { setAnnotationMode((a) => !a); setTextPopup(null); setLiveRect(null) }}
        >
          <Pencil size={11} />
          {annotationMode ? "Done" : "Annotate"}
        </Button>
      </div>

      {previewTabs.length > 0 && (
        <Tabs value={activePreviewTabId ?? ""} onValueChange={onSelectTab} className="shrink-0">
          <TabsList variant="line" className="h-8 w-full justify-start rounded-none border-b px-2">
            {previewTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      {/* Preview area — hidden (not unmounted) while theme tab is active so iframeRef stays valid */}
      <div className={cn("relative flex-1 overflow-auto bg-muted/20 flex justify-center", isThemeTabActive && "hidden")}>
        <div
          className="relative h-full"
          style={{ width: deviceWidth ? `${deviceWidth}px` : "100%" }}
        >
          {devUrl ? (
            <iframe
              ref={iframeRef}
              src={devUrl}
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

          {/* Annotation overlay */}
          <div
            ref={overlayRef}
            className={cn(
              "absolute inset-0",
              annotationMode ? "cursor-crosshair" : "pointer-events-none",
            )}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
          >
            {/* Live drag rectangle */}
            {liveRect && liveRect.type === "region" && (
              <div
                className="absolute border-2 border-primary bg-primary/10 pointer-events-none"
                style={{
                  left: `${liveRect.x}%`,
                  top: `${liveRect.y}%`,
                  width: `${liveRect.w}%`,
                  height: `${liveRect.h}%`,
                }}
              />
            )}

            {/* Existing annotations */}
            {openAnnotations.map((annotation, index) => (
              <AnnotationMarker key={annotation.id} annotation={annotation} index={index + 1} />
            ))}

            {/* Text input popup */}
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

      {/* Theme preview — only mounts when theme tab is active */}
      {isThemeTabActive && (
        <div className="flex-1 overflow-auto">
          <ThemeTokenPreview
            css={activeTab?.themeCss ?? ""}
            isDark={darkMode}
            viewMode="preview"
          />
        </div>
      )}
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
          <div className="absolute top-5 left-0 z-20 max-w-[200px] rounded bg-popover border border-border px-2 py-1 text-xs shadow-lg">
            {annotation.text}
          </div>
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
        <div className="absolute top-6 left-1/2 z-20 -translate-x-1/2 max-w-[200px] rounded bg-popover border border-border px-2 py-1 text-xs shadow-lg whitespace-nowrap">
          {annotation.text}
        </div>
      )}
    </div>
  )
}
