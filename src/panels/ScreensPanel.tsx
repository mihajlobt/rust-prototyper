import { useState, useCallback, useRef, useEffect, useMemo } from "react";

import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Smartphone, Tablet, Monitor, Download, Sun, Moon, Trash2, Loader2, AlertCircle, Play, Square, Plug, Palette, Puzzle, MousePointerClick, ArrowRight } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { writeFile, createDir, readFile, exportProject, getHostForProvider, isNotFoundError, getErrorMessage } from "@/lib/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/lib/queryKeys";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { PromptInspector } from "@/components/PromptInspector";
import { save } from "@tauri-apps/plugin-dialog";
import { getScreenNewPrompt, getScreenUpdatePrompt, outputFilePathSection, extractDesignTokenNames, getDesignTokensSection, DESIGN_BRIEF_TEMPLATES, buildDesignBriefSection, buildApiContextSection, buildComponentsSection, type DesignBriefTemplate } from "@/lib/prompts";
import { useSettings } from "@/hooks/useSettings";
import { saveItemMeta } from "@/lib/item-meta";
import { useFlatProjectTree } from "@/hooks/useProjectFiles";
import { extractCode } from "@/lib/preview";
import { useChat, resolveThinkParam } from "@/hooks/useChat";
import { useChatStore } from "@/stores/chatStore";
import { MessageList, ChatInput } from "@/components/chat";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { PaneHeader } from "@/components/ui/pane-header";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { hasGeneratedScaffold, scaffoldGenerated, ensureEslintPatched } from "@/lib/scaffold";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { getGeneratedDirPath } from "@/lib/scaffold-shadcn";
import { syncGeneratedRouter, loadNavigation, getDefaultPorts, updateScreenPorts, addHotspot, removeHotspot, createHotspotWithLink, type NavPort, type Hotspot } from "@/lib/navigation";
import { PortsEditor } from "@/panels/flows/PortsEditor";


export function ScreensPanel() {
  const { settings } = useAppStore();
  const { settings: globalSettings } = useSettings();
  const { ps, setPs } = useProjectSettingsStore();

  const allBriefs: DesignBriefTemplate[] = [
    ...DESIGN_BRIEF_TEMPLATES,
    ...globalSettings.styles.map((s) => ({
      name: s.name,
      description: s.value.slice(0, 80) + (s.value.length > 80 ? "…" : ""),
      palette: [] as string[],
      content: s.value,
    })),
  ];
  const screenId = ps.activeScreen;
  const screensDevice = ps.screensDevice;
  const screensShowInspector = ps.screensShowInspector;
  const screensZoom = ps.screensZoom;
  const screensDarkPreview = ps.screensDarkPreview;
  const screensCodeOpen = ps.screensCodeOpen;
  const queryClient = useQueryClient();
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("screens", 2);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("screens-inspector", 3, [true, true, screensShowInspector]);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("screens-code", 3, [true, true, screensCodeOpen]);
  const [code, setCode] = useState("");
  const [themeCss, setThemeCss] = useState("");
  const [screensCodeTab, setScreensCodeTab] = useState<"editor" | "ports">("editor");
  const [selectingElementForPort, setSelectingElementForPort] = useState<{ portId: string; direction: "output" } | null>(null);
  const [hotspotPending, setHotspotPending] = useState<{ selector: string; rect: { x: number; y: number; w: number; h: number }; portId: string } | null>(null);
  const [hotspots, setHotspots] = useState<Hotspot[]>([]);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [computedHotspots, setComputedHotspots] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({});

  // Generation context state — APIs, Design Brief, Components selectors
  interface CtxApi { id: string; name: string; method: string; url: string; proxyPath: string }
  interface CtxComponent { id: string; name: string }
  const [ctxApis, setCtxApis] = useState<CtxApi[]>([]);
  const [ctxSelectedApiIds, setCtxSelectedApiIds] = useState<string[]>([]);
  const [ctxComponents, setCtxComponents] = useState<CtxComponent[]>([]);
  const [ctxSelectedComponentIds, setCtxSelectedComponentIds] = useState<string[]>([]);
  const [ctxSelectedBrief, setCtxSelectedBrief] = useState<DesignBriefTemplate | null>(null);
  const [ctxComponentCode, setCtxComponentCode] = useState<Record<string, string>>({});
  const [screenPorts, setScreenPorts] = useState<NavPort[]>([]);

  const { runnerStatus, runnerUrl, runnerError, startRunner, stopRunner } = useDevServerStore();
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const scaffoldAttemptedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);
  const darkAtUrlArrival = useRef(screensDarkPreview);
  useEffect(() => { darkAtUrlArrival.current = screensDarkPreview; }, [screensDarkPreview]);
  const initialPreviewSrc = useMemo(
    () => {
      if (!runnerUrl || !screenId) return undefined;
      const base = runnerUrl.replace(/\/$/, ""); // strip trailing slash to avoid //
      return `${base}/${screenId}?dark=${darkAtUrlArrival.current}`;
    },
    [runnerUrl, screenId]
  );

  const generatedDir = getGeneratedDirPath(`projects/${settings.project}`);
  const screenPath = screenId
    ? `projects/${settings.project}/generated/src/pages/${screenId}.tsx`
    : `projects/${settings.project}/generated/src/pages/__placeholder__.tsx`;

  const chatPath = screenId
    ? `projects/${settings.project}/screens/${screenId}/chat.json`
    : "projects/__placeholder__/chat.json";

  const { data: screenEntries } = useFlatProjectTree(settings.project, "screens");
  const screenIds = (screenEntries ?? []).filter((e) => e.is_dir).map((e) => e.name);
  const { data: componentEntries } = useFlatProjectTree(settings.project, "components");
  useEffect(() => {
    const ids = (componentEntries ?? []).filter((e) => e.is_dir).map((e) => e.name);
    setCtxComponents(ids.map((id) => ({ id, name: id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) })));
  }, [componentEntries]);

  // Build generation context sections from toolbar selections
  const selectedApis = ctxApis.filter((a) => ctxSelectedApiIds.includes(a.id));
  const selectedComponents = ctxSelectedComponentIds
    .map((id) => {
      const comp = ctxComponents.find((c) => c.id === id);
      return comp && ctxComponentCode[id] ? { name: comp.name, code: ctxComponentCode[id] } : null;
    })
    .filter(Boolean) as Array<{ name: string; code: string }>;

  // Switch to update prompt after first generation
  const hasGeneratedCode = code.length > 0;
  const designTokensSection = getDesignTokensSection(extractDesignTokenNames(themeCss));
  const systemContent = (hasGeneratedCode
    ? getScreenUpdatePrompt(settings.iconLibrary, code, screenIds, settings.prompts["prompt.screens.update"] || undefined)
    : getScreenNewPrompt(settings.iconLibrary, screenIds, settings.prompts["prompt.screens.new"] || undefined)
  )
    + designTokensSection
    + buildDesignBriefSection(ctxSelectedBrief?.content ?? "")
    + buildApiContextSection(selectedApis, [])
    + buildComponentsSection(selectedComponents)
    + outputFilePathSection(screenPath);

  // Reset guards and context selections whenever the active project changes
  useEffect(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
    setCtxSelectedApiIds([]);
    setCtxSelectedComponentIds([]);
    setCtxComponentCode({});
    setCtxSelectedBrief(null);
  }, [settings.project]);

  // Load ports and hotspots for the selected screen (and reload when navigation changes externally)
  const reloadScreenNav = useCallback(async () => {
    if (!screenId) { setScreenPorts([]); setHotspots([]); setComputedHotspots({}); return; }
    try {
      const nav = await loadNavigation(`projects/${settings.project}`);
      const screen = nav.screens.find((s) => s.id === screenId);
      setScreenPorts(screen?.ports ?? getDefaultPorts(screenId));
      setHotspots(nav.hotspots.filter((h) => h.screenId === screenId));
      setComputedHotspots({});
    } catch { /* ignore */ }
  }, [screenId, settings.project]);

  useEffect(() => {
    reloadScreenNav();
  }, [reloadScreenNav]);

  useEffect(() => {
    window.addEventListener("navigation-changed", reloadScreenNav);
    return () => window.removeEventListener("navigation-changed", reloadScreenNav);
  }, [reloadScreenNav]);

  // ─── Ensure dev server is running ────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function ensureServer() {
      if (cancelled) return;
      if (runnerStatus === "running" || runnerStatus === "starting") return;
      if (stoppedManuallyRef.current) return;

      const isScaffolded = await hasGeneratedScaffold(`projects/${settings.project}`);
      if (cancelled) return;

      if (!isScaffolded) {
        if (scaffoldAttemptedRef.current) return;
        scaffoldAttemptedRef.current = true;
        useDevServerStore.getState().stopRunner();
        try {
          await withScaffoldNotifications(
            "scaffold-generated",
            "Scaffolding project",
            (onStep) => scaffoldGenerated(generatedDir, settings.iconLibrary, onStep)
          );
        } catch {
          return;
        }
      } else {
        ensureEslintPatched(`projects/${settings.project}`).catch((e) => { if (!isNotFoundError(e)) notify.error("Failed to patch ESLint config", getErrorMessage(e)); });
      }

      if (cancelled) return;
      try {
        await startRunner(generatedDir, ps.runnerPort);
      } catch (e) {
        notify.error("Failed to start screen preview server", getErrorMessage(e));
      }
    }

    ensureServer();
    return () => { cancelled = true; };
  }, [settings.project, runnerStatus, generatedDir, startRunner, ps.runnerPort, settings.iconLibrary]);

  // ─── Dark mode toggle → postMessage to iframe ─────────────────────────────

  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "set-dark", value: screensDarkPreview }, "*");
  }, [screensDarkPreview, runnerUrl]);

  // ─── Hotspot position tracking via postMessage ────────────────────────────
  // contentDocument is cross-origin (parent:1420 vs iframe:5178+), so we use
  // postMessage exclusively. The generated project's main.tsx handles __set-hotspots
  // and sends back __hotspot-positions on scroll/resize.

  const hotspotsRef = useRef(hotspots);
  useEffect(() => { hotspotsRef.current = hotspots; }, [hotspots]);

  // Listen for position updates from the iframe
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "__hotspot-positions") return;
      const positions = event.data.positions as Record<string, { x: number; y: number; w: number; h: number }>;
      setComputedHotspots((prev) => ({ ...prev, ...positions }));
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Tell the iframe which hotspots to track whenever the list changes
  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe?.contentWindow) return;
    const payload = hotspots.map((h) => ({ portId: h.portId, selector: h.selector }));
    iframe.contentWindow.postMessage({ type: "__set-hotspots", hotspots: payload }, "*");
  }, [hotspots, runnerUrl]);

  // Listen for element-selected from iframe (hotspot creation flow)
  useEffect(() => {
    if (!selectingElementForPort) return;
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type !== "element-selected") return;
      const { selector, rect } = event.data as { selector: string; rect: { x: number; y: number; w: number; h: number } };
      setHotspotPending({ selector, rect, portId: selectingElementForPort.portId });
      setSelectingElementForPort(null);
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [selectingElementForPort]);

  const applyScreenCode = useCallback((code: string) => {
    setCode(code);
    const parentDir = screenPath.substring(0, screenPath.lastIndexOf("/"));
    const entityId = screenId ? `screen-${screenId}` : "screen-none";
    const msgs = useChatStore.getState().chats[entityId]?.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content ?? "";
    createDir(parentDir)
      .then(() => writeFile(screenPath, code))
      .then(() => syncGeneratedRouter(`projects/${settings.project}`))
      .then(() => { if (screenId) void saveItemMeta(`projects/${settings.project}`, "screens", screenId, prompt).then(() => queryClient.invalidateQueries({ queryKey: projectKeys.library(settings.project) })); })
      .catch((e) => { notify.error("Failed to save screen", getErrorMessage(e)); });
  }, [screenPath, settings.project, screenId, queryClient]);

  const saveScreenCode = useCallback(async (value: string) => {
    if (!screenId || !value) return;
    try {
      const parentDir = screenPath.substring(0, screenPath.lastIndexOf("/"));
      await createDir(parentDir);
      await writeFile(screenPath, value);
    } catch (e) {
      notify.error("Failed to save screen", getErrorMessage(e));
    }
  }, [screenId, screenPath]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  const handleCodeBlur = useCallback(() => {
    saveScreenCode(code);
  }, [code, saveScreenCode]);

  // Ctrl+S to save screen code
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveScreenCode(code);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [code, saveScreenCode]);

  // Load existing screen code when screenId changes
  useEffect(() => {
    if (!screenId) { setCode(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const content = await readFile(screenPath);
        if (!cancelled && content) {
          setCode(content);
        }
      } catch (e) {
        if (!cancelled) {
          setCode("");
          if (!isNotFoundError(e)) notify.error("Failed to load screen", getErrorMessage(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [screenId, settings.project, screenPath, runnerUrl]);

  const {
    messages, isStreaming, thinkingContent, input, setInput, sendMessage,
    stopGeneration, regenerate, clearChat, deleteFrom, attachments, addAttachment, removeAttachment,
    thinkEnabled, toggleThink, thinkLevel, setThinkLevel, isGptOssFamily, canThink, canVision,
    toolsEnabled, toggleTools, canTools,
    mentions, addMention, removeMention,
    setActiveBriefName,
    pendingPermissions,
  } = useChat({
    entityId: screenId ? `screen-${screenId}` : "screen-none",
    chatPath,
    systemPrompt: systemContent,
    outputPath: screenId ? screenPath : undefined,
    // Non-tool models: final text may contain a code block in markdown fences.
    onOutput: (content) => {
      const code = extractCode(content);
      if (!code) return;
      applyScreenCode(code);
    },
    // Tool models: write_file fires with raw code (no fences) for the primary output file only.
    onCodeOutput: (code) => applyScreenCode(code),
  });

  useEffect(() => {
    const selectedTheme = ps.stylePreset;
    if (!selectedTheme) {
      setThemeCss("");
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const css = await readFile(`projects/${settings.project}/themes/${selectedTheme}/theme.css`);
        if (!cancelled) setThemeCss(css);
      } catch (e) {
        if (!cancelled) {
          setThemeCss("");
          if (!isNotFoundError(e)) notify.error("Failed to load theme", getErrorMessage(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ps.stylePreset, settings.project]);

  // Load API list and component list for generation context toolbar
  useEffect(() => {
    let cancelled = false;
    readFile(`projects/${settings.project}/apis/apis.json`)
      .then((data) => {
        if (!cancelled) {
          const apis = JSON.parse(data) as Array<{ id: string; name: string; method: string; url: string; proxyPath?: string }>;
          setCtxApis(apis.map((a) => ({ id: a.id, name: a.name, method: a.method, url: a.url, proxyPath: a.proxyPath ?? "" })));
        }
      })
      .catch(() => { if (!cancelled) setCtxApis([]); });
    return () => { cancelled = true; };
  }, [settings.project]);

  useEffect(() => {
    if (ctxSelectedComponentIds.length === 0) return;
    // Load code for newly selected components
    for (const id of ctxSelectedComponentIds) {
      if (ctxComponentCode[id]) continue;
      readFile(`projects/${settings.project}/generated/src/components/${id}/component.tsx`)
        .then((code) => setCtxComponentCode((prev) => ({ ...prev, [id]: code })))
        .catch(() => {/* silently skip */ });
    }
    // ctxComponentCode is state — adding it to deps would cause infinite re-render loop
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxSelectedComponentIds, settings.project]);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const handleExport = async () => {
    try {
      const outputPath = await save({
        filters: [{ name: "Zip", extensions: ["zip"] }],
        defaultPath: `${settings.project}-screens.zip`,
      });
      if (!outputPath) return;
      await exportProject(settings.project, outputPath, "react", true, true, true, false);
    } catch (e) {
      notify.error("Export failed", getErrorMessage(e));
    }
  };

  const handleRetryPreview = () => {
    stoppedManuallyRef.current = false;
    scaffoldAttemptedRef.current = false;
    startRunner(generatedDir, ps.runnerPort).catch(() => {});
  };

  const renderPreview = () => {
    if (runnerStatus === "error") {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4 h-full text-center">
          <AlertCircle size={24} className="text-destructive" />
          <p className="text-xs font-medium text-destructive">Preview Error</p>
          <p className="text-[10px] text-muted-foreground max-w-full line-clamp-3">
            {runnerError || "Failed to start dev server"}
          </p>
          <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={handleRetryPreview}>
            Retry
          </Button>
        </div>
      );
    }

    if (runnerStatus === "starting") {
      return (
        <div className="flex flex-col items-center justify-center gap-2 h-full">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Starting preview…</p>
        </div>
      );
    }

    if (runnerStatus === "running" && runnerUrl) {
      return (
        <div className="relative w-full h-full overflow-hidden">
          <iframe
            ref={previewIframeRef}
            src={initialPreviewSrc}
            className="w-full h-full border-0"
            sandbox="allow-scripts allow-same-origin allow-forms"
            onLoad={() => {
              const iframe = previewIframeRef.current;
              if (!iframe?.contentWindow) return;
              const payload = hotspotsRef.current.map((h) => ({ portId: h.portId, selector: h.selector }));
              iframe.contentWindow.postMessage({ type: "__set-hotspots", hotspots: payload }, "*");
            }}
          />
          {/* Deselect hotspot on background click */}
          {selectedHotspotId && !selectingElementForPort && (
            <div className="absolute inset-0 z-10" onClick={() => setSelectedHotspotId(null)} />
          )}
          {hotspots.map((h) => {
            const isSelected = selectedHotspotId === h.id;
            const port = screenPorts.find((p) => p.id === h.portId);
            const targetName = h.targetScreenId
              ? (screenIds.find((id) => id === h.targetScreenId) ?? h.targetScreenId).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
              : null;
            const rect = computedHotspots[h.portId] ?? h.rect;
            return (
              <div
                key={h.id}
                data-portid={h.portId}
                className="absolute z-20 group"
                style={{
                  left: rect.x,
                  top: rect.y,
                  width: rect.w,
                  height: rect.h,
                }}
              >
                {/* Hotspot highlight box */}
                <div
                  className="absolute inset-0 cursor-pointer rounded-sm transition-all"
                  style={{
                    border: `2px solid ${isSelected ? "oklch(0.85 0.2 195)" : "oklch(0.7 0.18 195)"}`,
                    background: isSelected ? "oklch(0.7 0.18 195 / 0.3)" : "oklch(0.7 0.18 195 / 0.15)",
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedHotspotId(isSelected ? null : h.id);
                  }}
                />

                {/* Popover menu — shown when selected */}
                {isSelected && (
                  <div
                    className="absolute z-30 bg-card border border-border rounded-md shadow-lg p-2 flex flex-col gap-1.5 min-w-[140px] text-[10px]"
                    style={{ left: rect.w + 6, top: 0 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {/* Port name */}
                    <div className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border pb-1">
                      {port?.name ?? "Hotspot"}
                    </div>

                    {/* Target screen */}
                    {targetName && (
                      <button
                        className="flex items-center gap-1 text-foreground/80 hover:text-foreground transition-colors"
                        onClick={() => useProjectSettingsStore.getState().setPs({ activeScreen: h.targetScreenId })}
                        title="Go to target screen"
                      >
                        <ArrowRight size={9} className="text-cyan-400 shrink-0" />
                        <span className="truncate">{targetName}</span>
                      </button>
                    )}

                    {/* Selector */}
                    <div className="text-[8px] text-muted-foreground font-mono truncate" title={h.selector}>
                      {h.selector.split(" > ").pop()}
                    </div>

                    {/* Delete */}
                    <button
                      className="flex items-center gap-1 text-destructive hover:text-destructive/80 transition-colors mt-0.5 border-t border-border pt-1"
                      onClick={() => {
                        removeHotspot(`projects/${settings.project}`, h.id).then(() => {
                          setHotspots((prev) => prev.filter((hs) => hs.id !== h.id));
                          setSelectedHotspotId(null);
                          window.dispatchEvent(new Event("navigation-changed"));
                        });
                      }}
                    >
                      <Trash2 size={9} />
                      <span>Delete hotspot</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {/* No click catcher needed — enable-link-mode handles interaction inside the iframe */}
        </div>
      );
    }

    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        Generated screens will preview here
      </div>
    );
  };

  const chatPane = (
    <div className="flex-1 overflow-hidden flex flex-col">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        thinkingContent={thinkingContent}
        pendingPermissions={pendingPermissions}
        onApplyCode={(content) => { const c = extractCode(content); if (c) applyScreenCode(c); }}
        onRegenerate={regenerate}
        onDeleteFrom={deleteFrom}
        onResolvePermission={(requestId, decision, toolName) => {
          useChatStore.getState().resolveToolPermission(
            screenId ? `screen-${screenId}` : "screen-none",
            requestId,
            decision
          )
          // When Always Allow, also persist to settings allowlist
          if (decision === "always_allowed" && toolName) {
            const current = settings.toolAllowlist
            if (!current.includes(toolName)) {
              useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] })
            }
          }
        }}
      />
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0 space-y-2">
        {/* Generation context toolbar */}
        {(ctxApis.length > 0 || ctxComponents.length > 0) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Design Brief */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={ctxSelectedBrief ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
                  <Palette size={10} />
                  {ctxSelectedBrief ? ctxSelectedBrief.name : "Brief"}
                  {ctxSelectedBrief && (
                    <span
                      className="ml-0.5 cursor-pointer text-muted-foreground hover:text-foreground"
                      onClick={(e) => { e.stopPropagation(); setCtxSelectedBrief(null); setActiveBriefName(""); }}
                    >×</span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuRadioGroup value={ctxSelectedBrief?.name ?? ""} onValueChange={(v) => { const b = allBriefs.find((bb) => bb.name === v) ?? null; setCtxSelectedBrief(b); setActiveBriefName(b?.name ?? ""); }}>
                  <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Built-in</DropdownMenuLabel>
                  {DESIGN_BRIEF_TEMPLATES.map((brief) => (
                    <DropdownMenuRadioItem key={brief.name} value={brief.name} className="flex-col items-start gap-0.5 py-2">
                      <div className="flex items-center gap-2 w-full">
                        <div className="flex gap-0.5">
                          {brief.palette.map((c) => (
                            <span key={c} className="w-3 h-3 rounded-sm inline-block border border-border/30" style={{ background: c }} />
                          ))}
                        </div>
                        <span className="text-xs font-medium">{brief.name}</span>
                      </div>
                      <span className="text-[10px] text-muted-foreground pl-0.5">{brief.description}</span>
                    </DropdownMenuRadioItem>
                  ))}
                  {globalSettings.styles.length > 0 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="text-[10px] text-muted-foreground uppercase tracking-wider">Custom</DropdownMenuLabel>
                      {globalSettings.styles.map((s) => (
                        <DropdownMenuRadioItem key={s.name} value={s.name} className="flex-col items-start gap-0.5 py-1.5">
                          <span className="text-xs font-medium">{s.name}</span>
                          <span className="text-[10px] text-muted-foreground pl-0.5 line-clamp-1">{s.value.slice(0, 60)}</span>
                        </DropdownMenuRadioItem>
                      ))}
                    </>
                  )}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* APIs */}
            {ctxApis.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={ctxSelectedApiIds.length > 0 ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
                    <Plug size={10} />
                    APIs{ctxSelectedApiIds.length > 0 ? ` (${ctxSelectedApiIds.length})` : ""}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {ctxApis.map((api) => (
                    <DropdownMenuCheckboxItem
                      key={api.id}
                      checked={ctxSelectedApiIds.includes(api.id)}
                      onCheckedChange={(c) => setCtxSelectedApiIds((prev) => c ? [...prev, api.id] : prev.filter((x) => x !== api.id))}
                      className="text-xs"
                    >
                      <span className={["mr-1 text-[10px] font-bold px-1 py-0.5 rounded", api.method === "GET" ? "bg-green-500/10 text-green-600" : "bg-blue-500/10 text-blue-600"].join(" ")}>{api.method}</span>
                      {api.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* Components */}
            {ctxComponents.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={ctxSelectedComponentIds.length > 0 ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
                    <Puzzle size={10} />
                    Components{ctxSelectedComponentIds.length > 0 ? ` (${ctxSelectedComponentIds.length})` : ""}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-64">
                  {ctxComponents.map((comp) => (
                    <DropdownMenuCheckboxItem
                      key={comp.id}
                      checked={ctxSelectedComponentIds.includes(comp.id)}
                      onCheckedChange={(c) => setCtxSelectedComponentIds((prev) => c ? [...prev, comp.id] : prev.filter((x) => x !== comp.id))}
                      className="text-xs"
                    >
                      {comp.name}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}

        <ChatInput
          value={input}
          onChange={setInput}
          onSend={sendMessage}
          disabled={isStreaming}
          attachments={attachments}
          onAddAttachment={addAttachment}
          onRemoveAttachment={removeAttachment}
          mentions={mentions}
          onAddMention={addMention}
          onRemoveMention={removeMention}
          projectPath={`projects/${settings.project}`}
          placeholder="Describe your screen..."
          thinkEnabled={thinkEnabled}
          onToggleThink={toggleThink}
          thinkLevel={thinkLevel}
          onSetThinkLevel={setThinkLevel}
          isGptOssFamily={isGptOssFamily}
          canThink={canThink}
          canVision={canVision}
          toolsEnabled={toolsEnabled}
          onToggleTools={toggleTools}
          canTools={canTools}
          onStop={stopGeneration}
        />
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault} onVisibleChange={(_i, v) => setPs({ screensShowInspector: v })}>
            <Allotment.Pane minSize={200}>
              <div className="h-full flex flex-col bg-card">
                <div className="panel-toolbar h-10 px-3 gap-2">
                  <span className="text-sm font-medium">{screenId ?? "Chat"}</span>
                  {messages.length > 0 && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                      {Math.ceil(messages.filter(m => m.role === "user").length)} turns
                    </span>
                  )}
                  <div className="flex-1" />
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleExport} title="Export project">
                    <Download size={12} />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={clearChat} title="Clear chat" disabled={messages.length === 0}>
                    <Trash2 size={12} />
                  </Button>
                </div>
                {chatPane}
              </div>
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setPs({ screensShowInspector: !screensShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                {screensShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>
            <Allotment.Pane visible={screensShowInspector} preferredSize={240} minSize={160} snap>
              {screensShowInspector && (
                <PromptInspector
                  model={settings.modelId}
                  messages={[
                    { role: "system", content: systemContent },
                    ...messages.map((m) => ({
                      role: m.role,
                      content: m.content,
                      ...(m.images?.length ? { images: m.images } : {}),
                      ...(m.thinking ? { thinking: m.thinking } : {}),
                      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.tool, arguments: tc.arguments } })) } : {}),
                    })),
                  ]}
                  host={getHostForProvider(settings.provider, settings.host)}
                  provider={settings.provider}
                  think={resolveThinkParam({ thinking: canThink, thinkLevel: undefined }, isGptOssFamily, thinkEnabled, thinkLevel)}
                  hasTools={!!(screenId && toolsEnabled)}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical ref={codeRef} onDragEnd={codeOnDragEnd} defaultSizes={codeDefault} onVisibleChange={(_i, v) => setPs({ screensCodeOpen: v })}>
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
                  <span className="text-sm font-medium">Preview</span>
                  {runnerStatus === "running" ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { stoppedManuallyRef.current = true; stopRunner(); }} title="Stop preview server">
                      <Square size={12} />
                    </Button>
                  ) : runnerStatus === "starting" ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled title="Starting preview…">
                      <Loader2 size={12} className="animate-spin" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { stoppedManuallyRef.current = false; startRunner(generatedDir, ps.runnerPort); }} title="Start preview server">
                      <Play size={12} />
                    </Button>
                  )}
                  {initialPreviewSrc && (
                    <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]" title={initialPreviewSrc}>
                      {initialPreviewSrc.replace(/^http:\/\/localhost:\d+/, "")}
                    </span>
                  )}
                  <div className="flex-1" />
                  <Button
                    variant={screensDarkPreview ? "secondary" : "ghost"}
                    size="icon" className="h-7 w-7"
                    onClick={() => {
                      setPs({ screensDarkPreview: !screensDarkPreview });
                      previewIframeRef.current?.contentWindow?.postMessage(
                        { type: "set-dark", value: !screensDarkPreview },
                        "*"
                      );
                    }}
                    title={screensDarkPreview ? "Light preview" : "Dark preview"}
                  >
                    {screensDarkPreview ? <Moon size={12} /> : <Sun size={12} />}
                  </Button>
                  <div className="w-px h-4 bg-border" />
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-xs" onClick={() => setPs({ screensZoom: Math.max(screensZoom - 0.1, 0.5) })}>-</Button>
                    <span className="text-xs text-muted-foreground w-8 text-center">{Math.round(screensZoom * 100)}%</span>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-xs" onClick={() => setPs({ screensZoom: Math.min(screensZoom + 0.1, 2) })}>+</Button>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant={screensDevice === "mobile" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setPs({ screensDevice: "mobile" })}>
                      <Smartphone size={12} />
                    </Button>
                    <Button variant={screensDevice === "tablet" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setPs({ screensDevice: "tablet" })}>
                      <Tablet size={12} />
                    </Button>
                    <Button variant={screensDevice === "desktop" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setPs({ screensDevice: "desktop" })}>
                      <Monitor size={12} />
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                  <div
                    className="h-full bg-background shadow-lg border border-border overflow-hidden"
                    style={{ width: deviceWidth[screensDevice], transform: `scale(${screensZoom})`, transformOrigin: "top center" }}
                  >
                    {renderPreview()}
                  </div>
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <div className="h-full flex items-center border-b border-border bg-card px-2">
                <Tabs value={screensCodeTab} onValueChange={(v) => setScreensCodeTab(v as "editor" | "ports")}>
                  <TabsList variant="line" className="h-7">
                    <TabsTrigger value="editor" className="text-[11px] gap-1">Editor</TabsTrigger>
                    <TabsTrigger value="ports" className="text-[11px] gap-1 flex items-center gap-1">
                      <MousePointerClick size={10} />
                      Ports
                    </TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="flex-1" />
                {screensCodeTab === "ports" && (
                  <Button
                    variant={selectingElementForPort ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 text-[10px] gap-1"
                    onClick={() => {
                      if (selectingElementForPort) {
                        setSelectingElementForPort(null);
                        previewIframeRef.current?.contentWindow?.postMessage({ type: "disable-link-mode" }, "*");
                      } else {
                        const portId = `${screenId}:output-${Date.now()}`;
                        setSelectingElementForPort({ portId, direction: "output" });
                        previewIframeRef.current?.contentWindow?.postMessage({ type: "enable-link-mode", portId }, "*");
                      }
                    }}
                    title="Click an element in Preview to create an output port"
                  >
                    <MousePointerClick size={10} />
                    {selectingElementForPort ? "Selecting…" : "Select Element"}
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setPs({ screensCodeOpen: !screensCodeOpen })}>
                  {screensCodeOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                </Button>
              </div>
            </Allotment.Pane>
            <Allotment.Pane visible={screensCodeOpen} preferredSize={252} minSize={100} snap>
              {screensCodeOpen && (
                <div className="h-full overflow-hidden">
                  {screensCodeTab === "editor" ? (
                    <CodeMirrorEditor value={code} onChange={handleCodeChange} onBlur={handleCodeBlur} mode="tsx" />
                  ) : (
                    <PortsEditor
                      screenId={screenId ?? ""}
                      projectDir={`projects/${settings.project}`}
                      ports={screenPorts}
                      onPortsChange={setScreenPorts}
                    />
                  )}
                </div>
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>

      {hotspotPending && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setHotspotPending(null)}>
          <div className="bg-card border border-border rounded-lg p-4 w-72 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold mb-3">Link hotspot to screen</h3>
            <div className="flex flex-col gap-1 max-h-60 overflow-auto">
              {screenIds.filter((id) => id !== screenId).map((id) => (
                <Button
                  key={id}
                  variant="ghost"
                  size="sm"
                  className="justify-start w-full"
                  onClick={async () => {
                    if (!screenId || !hotspotPending) return;
                    const portId = `${screenId}:output-${Date.now()}`;
                    try {
                      const hotspot = await createHotspotWithLink(
                        `projects/${settings.project}`,
                        screenId,
                        portId,
                        hotspotPending.selector,
                        hotspotPending.rect,
                        id
                      );
                      setHotspots((prev) => [...prev, hotspot]);
                      await syncGeneratedRouter(`projects/${settings.project}`);
                      window.dispatchEvent(new Event("navigation-changed"));
                    } catch (err) {
                      notify.error("Failed to create hotspot", String(err));
                    }
                    setHotspotPending(null);
                  }}
                >
                  {id.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="justify-start w-full text-muted-foreground"
                onClick={async () => {
                  if (!screenId || !hotspotPending) return;
                  const portId = `${screenId}:output-${Date.now()}`;
                  const projectDir = `projects/${settings.project}`;
                  const nav = await loadNavigation(projectDir);
                  const screen = nav.screens.find((s) => s.id === screenId);
                  if (!screen) return;
                  const port: NavPort = {
                    id: portId,
                    name: hotspotPending.selector.split(" ").pop() ?? "Hotspot",
                    direction: "output",
                    type: "navigation",
                    schema: "{}",
                  };
                  if (!screen.ports.some((p) => p.id === portId)) {
                    screen.ports.push(port);
                  }
                  await updateScreenPorts(projectDir, screenId, screen.ports);
                  const hotspot: Hotspot = {
                    id: `hotspot-${Date.now()}`,
                    screenId,
                    selector: hotspotPending.selector,
                    rect: hotspotPending.rect,
                    targetScreenId: "",
                    portId,
                    createdAt: Date.now(),
                  };
                  await addHotspot(projectDir, hotspot);
                  setHotspots((prev) => [...prev, hotspot]);
                  await syncGeneratedRouter(projectDir);
                  window.dispatchEvent(new Event("navigation-changed"));
                  setHotspotPending(null);
                }}
              >
                Just a port (no link yet)
              </Button>
            </div>
            <Button variant="outline" size="sm" onClick={() => setHotspotPending(null)} className="mt-3 w-full">
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
