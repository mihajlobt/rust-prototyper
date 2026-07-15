// Unified Wizard-style tabbed preview pane (per plan §6). Renders a single
// PreviewChrome toolbar on top, a tab strip (one per screen from
// previewTabs + Design tab when a theme is loaded), and the active tab's
// content (an iframe for screen tabs, ThemeTokenPreview for the Design tab).
//
// DATA-FLOW SPLIT — this component is a pure reader. The mode file populates
// `previewTabs` and `activePreviewTabId` (the mode file's onToolResult
// captures the register_screen args; the mount-restore effect reads
// navigation.json). The pane only renders, plus the read-only effects it
// owns per the plan: the useThemeCss file-watcher subscription (Design tab
// availability) and the __route-change postMessage listener (live path
// label). Annotation state (drag refs + popup) lives here because it is
// 1:1 tied to the iframe/design overlay; the annotations ARRAY is owned by
// the mode file (it feeds the AnnotationTray) and bridged via props.

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useThemeCss } from "@/hooks/useProjectFiles";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useAppStore } from "@/stores/appStore";
import { writeFile, readFile } from "@/lib/ipc";
import { ThemeTokenPreview } from "@/panels/theme-preview/ThemeTokenPreview";
import { AnnotationOverlay, type Annotation, type AnnotationPopupDraft, type AnnotationTextPopup } from "@/components/ui/AnnotationOverlay";
import { PreviewChrome, type PreviewDevice, type PreviewViewMode, type PreviewThemeEntry } from "./PreviewChrome";

const DEVICE_WIDTHS: Record<PreviewDevice, number | null> = {
  desktop: null,
  tablet: 768,
  mobile: 375,
};

// Reserved portId for hover-highlight find-element-at requests (vs.
// per-annotation portIds used for commit-time resolution).
const HOVER_PORT_ID = "__hover__";

export interface PreviewTab {
  id: string;
  type: "screen";
  label: string;
  /** Static URL route (used as fallback if `previewPath` is missing). */
  urlPath?: string;
  /** Live preview path posted by the generated app. */
  previewPath?: string;
}

export type PreviewAnnotation = Annotation;

export interface CreatePreviewPaneProps {
  // Project + active style preset (drives Design tab availability)
  project: string;
  stylePreset: string | null;
  // Tab data (mode file populates)
  previewTabs: PreviewTab[];
  activePreviewTabId: string | null;
  onSelectTab: (id: string) => void;
  // Active iframe entry path (mode file computes; pane listens for __route-change
  // and updates the path label independently of this)
  activeIframePath?: string | null;
  // Annotations (mode file owns the array; pane owns drag state). Optional —
  // only Wizard wires these up; other modes omit them entirely.
  annotations?: PreviewAnnotation[];
  onAddAnnotation?: (annotation: Omit<PreviewAnnotation, "id">) => void;
  // Optional: enable annotation mode UI (Wizard passes the state and toggle)
  annotationMode?: boolean;
  // Optional: PreviewChrome options
  showZoom?: boolean;
  showViewMode?: boolean;
  showThemePicker?: boolean;
  previewThemes?: PreviewThemeEntry[];
  // Optional: the path to the runner's generated dir, used for the
  // createPreviewTheme CSS write effect (only honored when showThemePicker)
  generatedDir?: string;
  // Optional: screen tab overlay slot (Screens passes its HotspotOverlay).
  // `tab` is null when the mode doesn't populate `previewTabs` (Screens
  // shows a single implicit screen, not a tab strip).
  renderScreenOverlay?: (tab: PreviewTab | null) => ReactNode;
  // Optional: iframe refresh handler (when omitted, the refresh button is hidden)
  onRefresh?: () => void;
  // Optional: expose the preview iframe element to the mode file (Screens
  // needs it for hotspot tracking / link-mode postMessage).
  iframeRef?: React.RefObject<HTMLIFrameElement | null>;
}

const DESIGN_TAB_ID = "design";

export function CreatePreviewPane({
  project,
  stylePreset,
  previewTabs,
  activePreviewTabId,
  onSelectTab,
  activeIframePath,
  annotations = [],
  onAddAnnotation,
  annotationMode = false,
  showZoom,
  showViewMode,
  showThemePicker,
  previewThemes = [],
  generatedDir,
  renderScreenOverlay,
  onRefresh,
  iframeRef: iframeRefProp,
}: CreatePreviewPaneProps) {
  const { runnerStatus, runnerUrl } = useDevServerStore();
  const darkPreview = useProjectSettingsStore((s) => s.ps.darkPreview);
  const createDevice = useProjectSettingsStore((s) => s.ps.createDevice);
  const createZoom = useProjectSettingsStore((s) => s.ps.createZoom);
  const createPreviewMode = useProjectSettingsStore((s) => s.ps.createPreviewMode);
  const createPreviewTheme = useProjectSettingsStore((s) => s.ps.createPreviewTheme);
  const setProjectSettings = useProjectSettingsStore((s) => s.setProjectSettings);
  const projectDir = useAppStore((s) => s.settings.project);

  // Subscribe to the active style preset's theme.css on disk. When the model
  // writes a new file, the query refetches and the Design tab appears.
  // The hook returns "" when the file is missing — we treat that as "no
  // design tab" so an empty / corrupt theme.css does not enable the tab.
  const themeCssQuery = useThemeCss(project, stylePreset);
  const themeCss = useMemo(() => {
    const css = themeCssQuery.data ?? "";
    return css.trim().length > 0 ? css : null;
  }, [themeCssQuery.data]);

  const designOpen = activePreviewTabId === DESIGN_TAB_ID;
  const activeScreenTab = useMemo(
    () => previewTabs.find((tab) => tab.id === activePreviewTabId) ?? null,
    [previewTabs, activePreviewTabId]
  );

  const previewTarget = activePreviewTabId ?? activeIframePath ?? "";
  const [livePreview, setLivePreview] = useState<{ target: string; path: string } | null>(null);
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; path?: unknown } | null;
      if (data?.type !== "__route-change") return;
      if (typeof data.path === "string") setLivePreview({ target: previewTarget, path: data.path });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [previewTarget]);
  const livePreviewPath = livePreview && livePreview.target === previewTarget ? livePreview.path : null;

  // Apply the preview theme CSS to the runner's styles dir on createPreviewTheme
  // change. The runner is responsible for picking up the new file (Vite HMR).
  useEffect(() => {
    if (!createPreviewTheme || !generatedDir) return;
    let cancelled = false;
    (async () => {
      try {
        const css = await readFile(`projects/${projectDir}/themes/${createPreviewTheme}/theme.css`);
        if (cancelled) return;
        if (runnerStatus !== "running") return;
        await writeFile(`${generatedDir}/src/styles/preview-theme.css`, css);
      } catch {
        // Theme file missing or write failed — the toolbar surfaces a notification
        // elsewhere; here we just silently skip.
      }
    })();
    return () => { cancelled = true; };
  }, [createPreviewTheme, generatedDir, projectDir, runnerStatus]);

  // Annotation drag state (refs survive re-renders without re-triggering effects)
  const [textPopup, setTextPopup] = useState<AnnotationTextPopup | null>(null);
  const [popupText, setPopupText] = useState("");
  const [liveRect, setLiveRect] = useState<AnnotationPopupDraft | null>(null);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const iframeOverlayRef = useRef<HTMLDivElement>(null);
  const designOverlayRef = useRef<HTMLDivElement>(null);
  const internalIframeRef = useRef<HTMLIFrameElement>(null);
  const iframeRef = iframeRefProp ?? internalIframeRef;

  // Resolved element info for in-flight annotation drafts, keyed by portId —
  // populated by the iframe's `find-element-at` reply (see main-template.ts).
  const resolvedElementsRef = useRef<Map<string, { selector: string; elementTag?: string; elementText?: string; loc?: string }>>(new Map());
  const portIdRef = useRef(0);

  // Hover highlight while in annotation mode — shows which element a click
  // would resolve to, via the same find-element-at bridge.
  const [hoverHighlight, setHoverHighlight] = useState<{ x: number; y: number; w: number; h: number; tag?: string; text?: string } | null>(null);
  const hoverThrottleRef = useRef(0);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data as { type?: string; portId?: string; selector?: string; elementTag?: string; elementText?: string; loc?: string; rect?: { x: number; y: number; w: number; h: number } } | null;
      if (data?.type !== "hotspot-created" || !data.portId) return;
      if (data.portId === HOVER_PORT_ID) {
        const overlay = iframeOverlayRef.current;
        if (!data.rect || !overlay) return;
        const overlayRect = overlay.getBoundingClientRect();
        if (overlayRect.width === 0 || overlayRect.height === 0) return;
        setHoverHighlight({
          x: (data.rect.x / overlayRect.width) * 100,
          y: (data.rect.y / overlayRect.height) * 100,
          w: (data.rect.w / overlayRect.width) * 100,
          h: (data.rect.h / overlayRect.height) * 100,
          tag: data.elementTag,
          text: data.elementText,
        });
        return;
      }
      if (!data.selector) return;
      resolvedElementsRef.current.set(data.portId, {
        selector: data.selector,
        elementTag: data.elementTag,
        elementText: data.elementText,
        loc: data.loc,
      });
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  const getRelativeCoords = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
      const overlay = ref.current;
      if (!overlay) return { x: 0, y: 0 };
      const rect = overlay.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * 100,
        y: ((e.clientY - rect.top) / rect.height) * 100,
      };
    },
    []
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
      if (!annotationMode || textPopup) return;
      e.preventDefault();
      const coords = getRelativeCoords(e, ref);
      dragStartRef.current = coords;
      setLiveRect(null);
      setHoverHighlight(null);
    },
    [annotationMode, textPopup, getRelativeCoords]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
      if (!annotationMode) return;

      if (dragStartRef.current) {
        if (hoverHighlight) setHoverHighlight(null);
        const current = getRelativeCoords(e, ref);
        const start = dragStartRef.current;
        const dx = Math.abs(current.x - start.x);
        const dy = Math.abs(current.y - start.y);
        if (dx > 2 || dy > 2) {
          setLiveRect({
            type: "region",
            x: Math.min(start.x, current.x),
            y: Math.min(start.y, current.y),
            w: Math.abs(current.x - start.x),
            h: Math.abs(current.y - start.y),
          });
        }
        return;
      }

      // Hover highlight only applies to the iframe overlay, and is suppressed while the text popup is open.
      if (textPopup || ref !== iframeOverlayRef || !iframeRef.current?.contentWindow) return;
      const now = Date.now();
      if (now - hoverThrottleRef.current < 50) return;
      hoverThrottleRef.current = now;
      const overlay = ref.current;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();
      iframeRef.current.contentWindow.postMessage(
        { type: "find-element-at", x: e.clientX - rect.left, y: e.clientY - rect.top, portId: HOVER_PORT_ID },
        "*"
      );
    },
    [annotationMode, getRelativeCoords, hoverHighlight, textPopup, iframeOverlayRef, iframeRef]
  );

  const handleMouseLeave = useCallback(() => {
    setHoverHighlight(null);
  }, []);

  const handleMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement>, ref: React.RefObject<HTMLDivElement | null>) => {
      if (!annotationMode || !dragStartRef.current) return;
      const current = getRelativeCoords(e, ref);
      const start = dragStartRef.current;
      dragStartRef.current = null;
      const dx = Math.abs(current.x - start.x);
      const dy = Math.abs(current.y - start.y);
      const overlay = ref.current;
      if (!overlay) return;
      const rect = overlay.getBoundingClientRect();

      let draft: AnnotationPopupDraft;
      let targetPx: { x: number; y: number };
      if (dx < 2 && dy < 2) {
        targetPx = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        draft = { type: "point", x: start.x, y: start.y };
        setLiveRect(null);
        setTextPopup({
          x: Math.max(0, Math.min(targetPx.x, rect.width - 220)),
          y: Math.max(0, Math.min(targetPx.y + 10, rect.height - 80)),
          draft,
        });
      } else {
        draft = {
          type: "region",
          x: Math.min(start.x, current.x),
          y: Math.min(start.y, current.y),
          w: Math.abs(current.x - start.x),
          h: Math.abs(current.y - start.y),
        };
        setLiveRect(null);
        const centerX = ((draft.x + (draft.w ?? 0) / 2) / 100) * rect.width;
        const centerY = ((draft.y + (draft.h ?? 0) / 2) / 100) * rect.height;
        targetPx = { x: centerX, y: centerY };
        setTextPopup({
          x: Math.max(0, Math.min(centerX - 100, rect.width - 220)),
          y: Math.max(0, Math.min(centerY, rect.height - 80)),
          draft,
        });
      }
      setPopupText("");

      // Resolve the underlying element via the preview iframe's find-element-at
      // bridge (main-template.ts) so the AI gets a structural selector instead
      // of bare coordinates. Not applicable to the Design-tab token preview.
      if (ref === iframeOverlayRef && iframeRef.current?.contentWindow) {
        const portId = `annotation-${++portIdRef.current}`;
        draft.portId = portId;
        iframeRef.current.contentWindow.postMessage(
          { type: "find-element-at", x: targetPx.x, y: targetPx.y, portId },
          "*"
        );
      }
    },
    [annotationMode, getRelativeCoords, iframeOverlayRef, iframeRef]
  );

  const commitAnnotation = useCallback(() => {
    if (!textPopup || !popupText.trim() || !onAddAnnotation) return;
    const portId = textPopup.draft.portId;
    const resolved = portId ? resolvedElementsRef.current.get(portId) : undefined;
    if (portId) resolvedElementsRef.current.delete(portId);
    onAddAnnotation({
      type: textPopup.draft.type,
      x: textPopup.draft.x,
      y: textPopup.draft.y,
      w: textPopup.draft.w,
      h: textPopup.draft.h,
      text: popupText.trim(),
      resolved: false,
      selector: resolved?.selector,
      elementTag: resolved?.elementTag,
      elementText: resolved?.elementText,
      loc: resolved?.loc,
    });
    setTextPopup(null);
    setPopupText("");
  }, [textPopup, popupText, onAddAnnotation]);

  const cancelPopup = useCallback(() => {
    setTextPopup(null);
    setLiveRect(null);
  }, []);

  useEffect(() => {
    if (!annotationMode || textPopup) setHoverHighlight(null);
  }, [annotationMode, textPopup]);

  const openAnnotations = annotations.filter((a) => !a.resolved);

  // Build the iframe src. For the Wizard, activeScreenTab.previewPath is
  // the resolved route; for Screens/Components the mode file passes
  // activeIframePath explicitly. livePreviewPath (from postMessage) is the
  // most current — prefer it when the user has navigated within the iframe.
  const base = runnerUrl ? runnerUrl.replace(/\/$/, "") : null;
  const currentPath = livePreviewPath
    ?? activeIframePath
    ?? activeScreenTab?.previewPath
    ?? activeScreenTab?.urlPath
    ?? null;
  const iframeSrc = base
    ? (currentPath ? `${base}${currentPath}?dark=${darkPreview}` : `${base}?dark=${darkPreview}`)
    : undefined;

  const deviceWidth = DEVICE_WIDTHS[createDevice];

  const handleRefresh = useCallback(() => {
    if (onRefresh) {
      onRefresh();
    } else {
      const el = iframeRef.current;
      if (el) {
        const src = el.src;
        el.src = src;
      }
    }
  }, [onRefresh, iframeRef]);

  return (
    <div className="flex h-full flex-col">
      <PreviewChrome
        generatedDir={generatedDir ?? `projects/${projectDir}/generated`}
        device={createDevice}
        onSetDevice={(d) => setProjectSettings({ createDevice: d })}
        darkPreview={darkPreview}
        onToggleDarkPreview={() => setProjectSettings({ darkPreview: !darkPreview })}
        currentPath={currentPath}
        onRefresh={handleRefresh}
        showZoom={showZoom}
        zoom={createZoom}
        onZoomIn={showZoom ? () => setProjectSettings({ createZoom: Math.min(createZoom + 0.1, 2) }) : undefined}
        onZoomOut={showZoom ? () => setProjectSettings({ createZoom: Math.max(createZoom - 0.1, 0.5) }) : undefined}
        showViewMode={showViewMode}
        viewMode={createPreviewMode}
        onSetViewMode={
          showViewMode
            ? (m: PreviewViewMode) => setProjectSettings({ createPreviewMode: m })
            : undefined
        }
        showThemePicker={showThemePicker}
        previewTheme={createPreviewTheme}
        themes={previewThemes}
        onSetPreviewTheme={
          showThemePicker
            ? (name: string) => setProjectSettings({ createPreviewTheme: name })
            : undefined
        }
      />

      {(previewTabs.length > 0 || themeCss !== null) && (
        <Tabs
          value={activePreviewTabId ?? ""}
          onValueChange={onSelectTab}
          className="shrink-0"
        >
          <TabsList
            variant="line"
            className="h-8 w-full justify-start rounded-none border-b px-2"
          >
            {previewTabs.map((tab) => (
              <TabsTrigger key={tab.id} value={tab.id} className="text-xs">
                {tab.label}
              </TabsTrigger>
            ))}
            {themeCss !== null && (
              <TabsTrigger value={DESIGN_TAB_ID} className="text-xs">
                Design
              </TabsTrigger>
            )}
          </TabsList>
        </Tabs>
      )}

      {designOpen ? (
        <div className="relative flex-1 overflow-hidden">
          {showViewMode && (
            <Tabs
              value={createPreviewMode}
              onValueChange={(mode) => setProjectSettings({ createPreviewMode: mode as PreviewViewMode })}
              className="absolute top-2 right-2 z-10"
            >
              <TabsList
                variant="default"
                className="h-7 bg-background/80 backdrop-blur shadow-sm"
              >
                <TabsTrigger value="preview" className="text-xs">Tokens</TabsTrigger>
                <TabsTrigger value="gallery" className="text-xs">Gallery</TabsTrigger>
              </TabsList>
            </Tabs>
          )}
          <ThemeTokenPreview
            css={themeCss ?? ""}
            isDark={darkPreview}
            viewMode={createPreviewMode}
          />
          {annotationMode && (
            <AnnotationOverlay
              overlayRef={designOverlayRef}
              annotationMode={annotationMode}
              liveRect={liveRect}
              hoverHighlight={null}
              annotations={openAnnotations}
              textPopup={textPopup}
              popupText={popupText}
              onPopupTextChange={setPopupText}
              onMouseDown={(e) => handleMouseDown(e, designOverlayRef)}
              onMouseMove={(e) => handleMouseMove(e, designOverlayRef)}
              onMouseUp={(e) => handleMouseUp(e, designOverlayRef)}
              onCommit={commitAnnotation}
              onCancelPopup={cancelPopup}
            />
          )}
        </div>
      ) : (
        <div className="relative flex-1 overflow-auto bg-muted/20 flex justify-center">
          <div
            className="relative h-full"
            style={{ width: deviceWidth ? `${deviceWidth}px` : "100%" }}
          >
            {base ? (
              <iframe
                ref={iframeRef}
                key={`preview-${darkPreview}-${activePreviewTabId ?? "none"}`}
                src={iframeSrc}
                className="h-full w-full border-0"
                sandbox="allow-scripts allow-same-origin allow-forms"
                title="Preview"
              />
            ) : (
              <div className="flex h-full items-center justify-center">
                <p className="text-sm text-muted-foreground text-center px-4">
                  Preview will appear here once generation completes
                </p>
              </div>
            )}

            {annotationMode && (
              <AnnotationOverlay
                overlayRef={iframeOverlayRef}
                annotationMode={annotationMode}
                liveRect={liveRect}
                hoverHighlight={hoverHighlight}
                annotations={openAnnotations}
                textPopup={textPopup}
                popupText={popupText}
                onPopupTextChange={setPopupText}
                onMouseDown={(e) => handleMouseDown(e, iframeOverlayRef)}
                onMouseMove={(e) => handleMouseMove(e, iframeOverlayRef)}
                onMouseUp={(e) => handleMouseUp(e, iframeOverlayRef)}
                onMouseLeave={handleMouseLeave}
                onCommit={commitAnnotation}
                onCancelPopup={cancelPopup}
              />
            )}

            {renderScreenOverlay && (
              <div className="absolute inset-0 pointer-events-auto">
                {renderScreenOverlay(activeScreenTab)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
