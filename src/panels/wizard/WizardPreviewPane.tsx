import { useState, useRef, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Smartphone, Tablet, Monitor, Sun, Moon, Pencil, RefreshCw, Play, Square, Loader2 } from "lucide-react"
import { useDevServerStore } from "@/lib/dev-server-manager"
import { useProjectSettingsStore } from "@/stores/projectSettingsStore"
import { ThemeTokenPreview } from "@/panels/theme-preview/ThemeTokenPreview"
import { AnnotationOverlay, type AnnotationPopupDraft, type AnnotationTextPopup } from "@/components/ui/AnnotationOverlay"
import type { WizardAnnotation, WizardPreviewTab } from "./types"

interface WizardPreviewPaneProps {
  generatedDir: string
  device: "desktop" | "tablet" | "mobile"
  annotations: WizardAnnotation[]
  previewTabs: WizardPreviewTab[]
  activePreviewTabId: string | null
  themeCss: string | null
  onSelectTab: (id: string) => void
  onSetDevice: (device: "desktop" | "tablet" | "mobile") => void
  onAddAnnotation: (annotation: Omit<WizardAnnotation, "id" | "createdAt">) => void
}

const DEVICE_WIDTHS: Record<"desktop" | "tablet" | "mobile", number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 375,
}

// Floating top-right segmented control — matches PlanPreview's Outline toggle treatment.
const FLOATING_TOGGLE_CLASS = "absolute top-2 right-2 z-10 h-7 bg-background/80 backdrop-blur shadow-sm"

export function WizardPreviewPane({
  generatedDir,
  device,
  annotations,
  previewTabs,
  activePreviewTabId,
  themeCss,
  onSelectTab,
  onSetDevice,
  onAddAnnotation,
}: WizardPreviewPaneProps) {
  const { runnerStatus, runnerUrl, startRunner, stopRunner } = useDevServerStore()
  const { ps, setProjectSettings } = useProjectSettingsStore()
  const darkPreview = ps.darkPreview
  const [annotationMode, setAnnotationMode] = useState(false)
  const [textPopup, setTextPopup] = useState<AnnotationTextPopup | null>(null)
  const [popupText, setPopupText] = useState("")
  const iframeOverlayRef = useRef<HTMLDivElement>(null)
  const designOverlayRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const dragStartRef = useRef<{ x: number; y: number } | null>(null)
  const [liveRect, setLiveRect] = useState<AnnotationPopupDraft | null>(null)
  const [designMode, setDesignMode] = useState<"preview" | "gallery">("preview")

  const deviceWidth = DEVICE_WIDTHS[device]
  const designOpen = activePreviewTabId === "design"
  const activeScreenTab = previewTabs.find((tab) => tab.id === activePreviewTabId)
  const currentPath = activeScreenTab ? (activeScreenTab.previewPath ?? activeScreenTab.urlPath) : null
  const base = runnerUrl ? runnerUrl.replace(/\/$/, "") : null
  const iframeSrc = base ? (currentPath ? `${base}${currentPath}?dark=${darkPreview}` : `${base}?dark=${darkPreview}`) : undefined

  const getRelativeCoords = useCallback((e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
    const overlay = ref.current
    if (!overlay) return { x: 0, y: 0 }
    const rect = overlay.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
    if (!annotationMode || textPopup) return
    e.preventDefault()
    const coords = getRelativeCoords(e, ref)
    dragStartRef.current = coords
    setLiveRect(null)
  }, [annotationMode, textPopup, getRelativeCoords])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
    if (!annotationMode || !dragStartRef.current) return
    const current = getRelativeCoords(e, ref)
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

  const handleMouseUp = useCallback((e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
    if (!annotationMode || !dragStartRef.current) return
    const current = getRelativeCoords(e, ref)
    const start = dragStartRef.current
    dragStartRef.current = null

    const dx = Math.abs(current.x - start.x)
    const dy = Math.abs(current.y - start.y)
    const overlay = ref.current
    if (!overlay) return
    const rect = overlay.getBoundingClientRect()

    let draft: AnnotationPopupDraft
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

        <Button variant={darkPreview ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setProjectSettings({ darkPreview: !darkPreview })} title={darkPreview ? "Light mode" : "Dark mode"}>
          {darkPreview ? <Moon size={12} /> : <Sun size={12} />}
        </Button>

        <Button size="icon" variant="ghost" className="h-7 w-7"
          onClick={() => { const el = iframeRef.current; if (el) el.src = el.src; }}
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

      {designOpen ? (
        <div className="relative flex-1 overflow-hidden">
          <Tabs value={designMode} onValueChange={(mode) => setDesignMode(mode as "preview" | "gallery")}>
            <TabsList className={FLOATING_TOGGLE_CLASS}>
              <TabsTrigger value="preview" className="text-xs">Tokens</TabsTrigger>
              <TabsTrigger value="gallery" className="text-xs">Gallery</TabsTrigger>
            </TabsList>
          </Tabs>
          <ThemeTokenPreview css={themeCss ?? ""} isDark={darkPreview} viewMode={designMode} />
          <AnnotationOverlay
            overlayRef={designOverlayRef}
            annotationMode={annotationMode}
            liveRect={liveRect}
            annotations={openAnnotations}
            textPopup={textPopup}
            popupText={popupText}
            onPopupTextChange={setPopupText}
            onMouseDown={(e) => handleMouseDown(e, designOverlayRef)}
            onMouseMove={(e) => handleMouseMove(e, designOverlayRef)}
            onMouseUp={(e) => handleMouseUp(e, designOverlayRef)}
            onCommit={commitAnnotation}
            onCancelPopup={() => { setTextPopup(null); setLiveRect(null) }}
          />
        </div>
      ) : (
        <div className="relative flex-1 overflow-auto bg-muted/20 flex justify-center">
          <div className="relative h-full" style={{ width: deviceWidth ? `${deviceWidth}px` : "100%" }}>
            {runnerUrl ? (
              <iframe
                ref={iframeRef}
                key={`wizard-${darkPreview}`}
                src={iframeSrc}
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

            <AnnotationOverlay
              overlayRef={iframeOverlayRef}
              annotationMode={annotationMode}
              liveRect={liveRect}
              annotations={openAnnotations}
              textPopup={textPopup}
              popupText={popupText}
              onPopupTextChange={setPopupText}
              onMouseDown={(e) => handleMouseDown(e, iframeOverlayRef)}
              onMouseMove={(e) => handleMouseMove(e, iframeOverlayRef)}
              onMouseUp={(e) => handleMouseUp(e, iframeOverlayRef)}
              onCommit={commitAnnotation}
              onCancelPopup={() => { setTextPopup(null); setLiveRect(null) }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
