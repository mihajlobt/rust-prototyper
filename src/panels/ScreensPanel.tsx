import { useState, useCallback, useRef, useEffect, useMemo } from "react";

import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Download, Trash2, MousePointerClick, Code2, Route } from "lucide-react";
import { Button } from "@/components/ui/button";
import { readFile, writeFile, readDir, exportProject, getHostForProvider, isNotFoundError, getErrorMessage } from "@/lib/ipc";
import type { FileEntry } from "@/lib/ipc";
import type { ToolPermissionDecision } from "@/lib/ipc";
import { useQueryClient } from "@tanstack/react-query";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { PromptInspector } from "@/components/PromptInspector";
import { save } from "@tauri-apps/plugin-dialog";
import { getScreenNewPrompt, getScreenUpdatePrompt, outputFilePathSection, extractDesignTokenNames, getDesignTokensSection, buildDesignBriefSection, buildApiContextSection, buildComponentsSection } from "@/lib/prompts";
import { useFlatProjectTree } from "@/hooks/useProjectFiles";
import { extractCode } from "@/lib/preview";
import { useChat, resolveThinkParam } from "@/hooks/useChat";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore, EMPTY_GEN_CONTEXT } from "@/stores/uiStore";
import { MessageList, ChatInput } from "@/components/chat";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { PaneHeader } from "@/components/ui/pane-header";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { hasGeneratedScaffold, scaffoldGenerated, ensureEslintPatched } from "@/lib/scaffold";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { getGeneratedDirPath } from "@/lib/scaffold-shadcn";
import { loadDesignBrief } from "@/lib/design/persist";
import { LinksEditor } from "@/panels/flows/LinksEditor";
import { FlowsView } from "@/panels/FlowsView";
import { ScreensContextToolbar } from "@/panels/screens/ScreensContextToolbar";
import { ScreensIframePreview } from "@/panels/screens/ScreensIframePreview";
import { ScreensPreviewToolbar } from "@/panels/screens/ScreensPreviewToolbar";
import { useHotspotTracking } from "@/hooks/useHotspotTracking";
import { useScreenCode } from "@/hooks/useScreenCode";

export function ScreensPanel() {
  const { settings } = useAppStore();
  const { ps, setProjectSettings } = useProjectSettingsStore();

  const screenId = ps.activeScreen;
  const screensDevice = ps.screensDevice;
  const screensShowInspector = ps.screensShowInspector;
  const screensZoom = ps.screensZoom;
  const screensDarkPreview = ps.screensDarkPreview;
  const screensCodeOpen = ps.screensCodeOpen;
  const queryClient = useQueryClient();
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("screens", 2);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("screens-inspector", 3);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("screens-code", 3);
  const [themeCss, setThemeCss] = useState("");
  const [previewThemeCss, setPreviewThemeCss] = useState("");
  const [themes, setThemes] = useState<FileEntry[]>([]);
  const screensCodeTab = ps.screensCodeTab;
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [livePreviewPath, setLivePreviewPath] = useState<string | null>(null);

  // Generation context state — APIs, Design Brief, Components selectors.
  // The loaded lists + code cache are local/derived; the user's *selections*
  // live in uiStore (session, keyed by project) so they survive panel remounts.
  interface CtxApi { id: string; name: string; method: string; url: string; proxyPath: string }
  interface CtxComponent { id: string; name: string }
  const [ctxApis, setCtxApis] = useState<CtxApi[]>([]);
  const [ctxComponents, setCtxComponents] = useState<CtxComponent[]>([]);
  const [ctxComponentCode, setCtxComponentCode] = useState<Record<string, string>>({});

  const genContext = useUIStore((s) => s.screensGenContext[settings.project] ?? EMPTY_GEN_CONTEXT);
  const ctxSelectedApiIds = genContext.apiIds;
  const ctxSelectedComponentIds = genContext.componentIds;
  const ctxSelectedBrief = genContext.brief;
  // DESIGN.md of the active design language (auto-applied unless removed)
  const [activeDesignBrief, setActiveDesignBrief] = useState<string>("");

  const { runnerStatus, runnerUrl, runnerError, startRunner } = useDevServerStore();
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  const {
    hotspots, setHotspots,
    computedHotspots,
    isSelectingElement, setIsSelectingElement,
    newHotspotId, setNewHotspotId,
    hotspotsRef,
  } = useHotspotTracking({
    screenId,
    projectDir: `projects/${settings.project}`,
    iframeRef: previewIframeRef,
    runnerUrl,
  });

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

  const { code, handleCodeChange, handleCodeBlur, applyScreenCode } = useScreenCode({
    screenId,
    screenPath,
    projectDir: `projects/${settings.project}`,
    queryClient,
    runnerUrl,
  });

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
    + buildDesignBriefSection(ctxSelectedBrief?.content ?? (ps.applyDesignBrief ? activeDesignBrief : ""))
    + buildApiContextSection(selectedApis, [])
    + buildComponentsSection(selectedComponents)
    + outputFilePathSection(screenPath);

  // Reset scaffold guards and the component-code cache when the active project changes.
  // (Context selections live in uiStore keyed by project, so they reset implicitly.)
  useEffect(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
    setCtxComponentCode({});
  }, [settings.project]);

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

  // Track the live route inside the iframe — generated app posts __route-change on every navigation
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (event.data?.type !== "__route-change") return;
      setLivePreviewPath(event.data.path as string);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // Reset live path when the active screen or runner changes
  useEffect(() => { setLivePreviewPath(null); }, [screenId, runnerUrl]);

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

  // Keep useChat's brief-name ref in sync with the selected brief — covers both
  // clearing and restoration of the selection after a panel remount.
  useEffect(() => {
    setActiveBriefName(ctxSelectedBrief?.name ?? "");
  }, [ctxSelectedBrief, setActiveBriefName]);

  const handleApplyCode = useCallback((content: string) => {
    const c = extractCode(content);
    if (c) applyScreenCode(c);
  }, [applyScreenCode]);

  const handleResolvePermission = useCallback((requestId: number, decision: ToolPermissionDecision, toolName: string) => {
    useChatStore.getState().resolveToolPermission(
      screenId ? `screen-${screenId}` : "screen-none",
      requestId,
      decision
    );
    if (decision === "always_allowed" && toolName) {
      const current = useAppStore.getState().settings.toolAllowlist;
      if (!current.includes(toolName)) {
        useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] });
      }
    }
  }, [screenId]);

  // Load the active design language's DESIGN.md brief when the selected design changes
  useEffect(() => {
    if (!ps.stylePreset) { setActiveDesignBrief(""); return; }
    let cancelled = false;
    loadDesignBrief(`projects/${settings.project}`, ps.stylePreset)
      .then((md) => { if (!cancelled) setActiveDesignBrief(md ?? ""); })
      .catch(() => { if (!cancelled) setActiveDesignBrief(""); });
    return () => { cancelled = true; };
  }, [ps.stylePreset, settings.project]);

  // Load the list of available themes (design languages) for the picker
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await readDir(`projects/${settings.project}/themes`);
        if (!cancelled) setThemes(entries.filter((e) => e.is_dir));
      } catch (e) {
        if (!cancelled) {
          setThemes([]);
          if (!isNotFoundError(e)) notify.error("Failed to load themes", getErrorMessage(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project]);

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

  // Load the preview theme CSS — drives the live preview only, independent of the
  // generation design language (ps.stylePreset).
  useEffect(() => {
    if (!ps.screensPreviewTheme) { setPreviewThemeCss(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const css = await readFile(`projects/${settings.project}/themes/${ps.screensPreviewTheme}/theme.css`);
        if (!cancelled) setPreviewThemeCss(css);
      } catch (e) {
        if (!cancelled) {
          setPreviewThemeCss("");
          if (!isNotFoundError(e)) notify.error("Failed to load preview theme", getErrorMessage(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ps.screensPreviewTheme, settings.project]);

  // ─── Write the preview theme CSS to the preview project when it changes ──────
  useEffect(() => {
    if (!previewThemeCss || runnerStatus !== "running") return;
    writeFile(`${generatedDir}/src/styles/preview-theme.css`, previewThemeCss).catch((e) => {
      notify.error("Failed to write preview theme CSS", getErrorMessage(e));
    });
  }, [previewThemeCss, runnerStatus, generatedDir]);

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

  const chatPane = (
    <div className="flex-1 overflow-hidden flex flex-col">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        thinkingContent={thinkingContent}
        pendingPermissions={pendingPermissions}
        onApplyCode={handleApplyCode}
        onRegenerate={regenerate}
        onDeleteFrom={deleteFrom}
        onResolvePermission={handleResolvePermission}
      />
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0 space-y-2">
        <ScreensContextToolbar themes={themes} ctxApis={ctxApis} ctxComponents={ctxComponents} />

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
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault} onVisibleChange={(_paneIndex, v) => setProjectSettings({ screensShowInspector: v })}>
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
              <PaneHeader onClick={() => setProjectSettings({ screensShowInspector: !screensShowInspector })}>
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
          <Allotment vertical ref={codeRef} onDragEnd={codeOnDragEnd} defaultSizes={codeDefault} onVisibleChange={(_paneIndex, v) => setProjectSettings({ screensCodeOpen: v })}>
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <ScreensPreviewToolbar
                  themes={themes}
                  livePreviewPath={livePreviewPath}
                  initialPreviewSrc={initialPreviewSrc}
                  iframeRef={previewIframeRef}
                  stoppedManuallyRef={stoppedManuallyRef}
                  generatedDir={generatedDir}
                />
                <div className="relative flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                  <div
                    className="h-full bg-background shadow-lg border border-border overflow-hidden"
                    style={{ width: deviceWidth[screensDevice], transform: `scale(${screensZoom})`, transformOrigin: "top center" }}
                  >
                    <ScreensIframePreview
                      runnerStatus={runnerStatus}
                      runnerError={runnerError}
                      runnerUrl={runnerUrl}
                      initialPreviewSrc={initialPreviewSrc}
                      iframeRef={previewIframeRef}
                      hotspotsRef={hotspotsRef}
                      hotspots={hotspots}
                      screensCodeTab={screensCodeTab}
                      selectedHotspotId={selectedHotspotId}
                      onSelectHotspot={setSelectedHotspotId}
                      isSelectingElement={isSelectingElement}
                      computedHotspots={computedHotspots}
                      screenIds={screenIds}
                      projectDir={`projects/${settings.project}`}
                      onHotspotsChange={setHotspots}
                      onRetry={handleRetryPreview}
                    />
                  </div>
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setProjectSettings({ screensCodeOpen: !screensCodeOpen })}>

                <button className={["px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", screensCodeTab === "editor" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"].join(" ")} onClick={(e) => { e.stopPropagation(); setProjectSettings({ screensCodeTab: "editor" }); if (!screensCodeOpen) setProjectSettings({ screensCodeOpen: true }); }}><Code2 size={10} />Editor</button>
                <button className={["px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", screensCodeTab === "links" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"].join(" ")} onClick={(e) => { e.stopPropagation(); setProjectSettings({ screensCodeTab: "links" }); if (!screensCodeOpen) setProjectSettings({ screensCodeOpen: true }); }}><MousePointerClick size={10} />Links</button>
                <button className={["px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", screensCodeTab === "flow" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"].join(" ")} onClick={(e) => { e.stopPropagation(); setProjectSettings({ screensCodeTab: "flow" }); if (!screensCodeOpen) setProjectSettings({ screensCodeOpen: true }); }}><Route size={10} />Flow</button>
                <div className="flex-1" />
                {screensCodeTab === "links" && (
                  <button
                    className={["mr-1 flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded transition-colors", isSelectingElement ? "text-primary" : "text-muted-foreground hover:text-foreground"].join(" ")}
                    onClick={(e) => { e.stopPropagation(); if (isSelectingElement) { setIsSelectingElement(false); previewIframeRef.current?.contentWindow?.postMessage({ type: "disable-link-mode" }, "*"); } else { setIsSelectingElement(true); previewIframeRef.current?.contentWindow?.postMessage({ type: "enable-link-mode" }, "*"); } }}
                    title="Pick an element in the preview to link"
                  ><MousePointerClick size={10} />{isSelectingElement ? "Selecting…" : "Pick element"}</button>
                )}
                {screensCodeOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>
            <Allotment.Pane visible={screensCodeOpen} preferredSize={252} minSize={100} snap>
              {screensCodeOpen && (
                <div className="h-full overflow-hidden">
                  {screensCodeTab === "editor" ? (
                    <CodeMirrorEditor value={code} onChange={handleCodeChange} onBlur={handleCodeBlur} mode="tsx" />
                  ) : screensCodeTab === "flow" ? (
                    <FlowsView screenIds={screenIds} />
                  ) : (
                    <LinksEditor
                      screenId={screenId ?? ""}
                      projectDir={`projects/${settings.project}`}
                      hotspots={hotspots}
                      screenIds={screenIds}
                      onHotspotsChange={setHotspots}
                      isSelectingElement={isSelectingElement}
                      newHotspotId={newHotspotId}
                      onNewHotspotHandled={() => setNewHotspotId(null)}
                      onStartElementSelection={() => {
                        if (isSelectingElement) {
                          setIsSelectingElement(false);
                          previewIframeRef.current?.contentWindow?.postMessage({ type: "disable-link-mode" }, "*");
                        } else {
                          setIsSelectingElement(true);
                          previewIframeRef.current?.contentWindow?.postMessage({ type: "enable-link-mode" }, "*");
                        }
                      }}
                    />
                  )}
                </div>
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>

    </div>
  );
}
