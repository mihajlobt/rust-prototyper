// Port of src/panels/ScreensPanel.tsx (545 lines) + screens/* (6 files,
// ~757 lines). Preserves the full ensureServer scaffold flow, hotspot
// tracking, and the per-screen Editor/Links/Flow code tabs — split into
// modes/screens/ sub-files to stay under the 500-line cap. Drops
// onOutput/onCodeOutput (file writes are picked up reactively by
// useScreenCode); drops the applyDesignBrief gate — DESIGN.md is always
// injected when a style preset is active. The per-mode preview iframe is
// gone — CreatePreviewPane renders it, given `activeIframePath`.

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Download } from "lucide-react";
import { save } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { readDir, readFile, exportProject, getHostForProvider, isNotFoundError, getErrorMessage } from "@/lib/ipc";
import type { ToolPermissionDecision, FileEntry } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore, EMPTY_GEN_CONTEXT } from "@/stores/uiStore";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { hasGeneratedScaffold, scaffoldGenerated, ensureEslintPatched } from "@/lib/scaffold";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { getGeneratedDirPath } from "@/lib/scaffold-shadcn";
import { loadDesignBrief } from "@/lib/design/persist";
import { notify } from "@/hooks/useToast";
import { useChat, resolveThinkParam } from "@/hooks/useChat";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { useFlatProjectTree, useThemeCss } from "@/hooks/useProjectFiles";
import { useHotspotTracking } from "@/hooks/useHotspotTracking";
import { useScreenCode } from "@/hooks/useScreenCode";
import { extractCode } from "@/lib/preview";
import {
  getScreenNewPrompt, getScreenUpdatePrompt, outputFilePathSection, extractDesignTokenNames,
  getDesignTokensSection, buildDesignBriefSection, buildApiContextSection, buildComponentsSection,
} from "@/lib/prompts";
import { SCREENS_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";
import { Button } from "@/components/ui/button";
import { PaneHeader } from "@/components/ui/pane-header";
import { TokenUsageBadge } from "@/components/TokenUsageBadge";
import { CreateChatPanel } from "../CreateChatPanel";
import { CreateInspector } from "../CreateInspector";
import { CreatePreviewPane } from "../CreatePreviewPane";
import { ContextToolbar } from "../ContextToolbar";
import { useFileWatcher } from "../FileWatcher";
import { useCreateMode } from "../useCreateMode";
import { ScreensHotspotOverlay } from "./screens/ScreensHotspotOverlay";
import { ScreensCodePaneHeader, ScreensCodePaneContent } from "./screens/ScreensCodePane";

interface CtxApi { id: string; name: string; method: string; url: string; proxyPath: string }

export function ScreensMode() {
  const { settings } = useAppStore();
  const screenToolFilter = useAppStore((s) => s.settings.panelToolFilter.screens);
  const { ps, setProjectSettings } = useProjectSettingsStore();
  const queryClient = useQueryClient();
  const { entityId: screenEntityId } = useCreateMode();
  const screenId = ps.activeScreen;

  const [themes, setThemes] = useState<FileEntry[]>([]);
  const [ctxApis, setCtxApis] = useState<CtxApi[]>([]);
  const [ctxComponentCode, setCtxComponentCode] = useState<Record<string, string>>({});
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [activeDesignBrief, setActiveDesignBrief] = useState("");
  const [activePreviewTabId, setActivePreviewTabId] = useState<string | null>(null);

  const genContext = useUIStore((s) => s.createGenContext[settings.project] ?? EMPTY_GEN_CONTEXT);
  const ctxSelectedApiIds = genContext.apiIds;
  const ctxSelectedComponentIds = genContext.componentIds;
  const ctxSelectedBrief = genContext.brief;

  const { runnerStatus, runnerUrl, startRunner } = useDevServerStore();
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  const {
    hotspots, setHotspots, computedHotspots, isSelectingElement, setIsSelectingElement,
    newHotspotId, setNewHotspotId,
  } = useHotspotTracking({
    screenId,
    projectDir: `projects/${settings.project}`,
    iframeRef: previewIframeRef,
    runnerUrl,
  });

  const scaffoldAttemptedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);

  const generatedDir = getGeneratedDirPath(`projects/${settings.project}`);
  const screenPath = screenId
    ? `projects/${settings.project}/generated/src/pages/${screenId}.tsx`
    : `projects/${settings.project}/generated/src/pages/__placeholder__.tsx`;
  const chatPath = screenId
    ? `projects/${settings.project}/screens/${screenId}/chat.json`
    : "projects/__placeholder__/chat.json";

  const { code, handleCodeChange, handleCodeBlur, applyScreenCode } = useScreenCode({
    screenId, screenPath, projectDir: `projects/${settings.project}`, queryClient, runnerUrl,
  });

  const { data: screenEntries } = useFlatProjectTree(settings.project, "screens");
  const screenIds = useMemo(() => (screenEntries ?? []).filter((e) => e.is_dir).map((e) => e.name), [screenEntries]);

  const { data: componentEntries } = useFlatProjectTree(settings.project, "components");
  const ctxComponents = useMemo(
    () => (componentEntries ?? []).filter((e) => e.is_dir)
      .map((e) => ({ id: e.name, name: e.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) })),
    [componentEntries]
  );

  const themeCssQuery = useThemeCss(settings.project, ps.stylePreset || null);
  const themeCss = themeCssQuery.data ?? "";

  // Generation context sections, built from the toolbar's selections
  const selectedApis = ctxApis.filter((a) => ctxSelectedApiIds.includes(a.id));
  const selectedComponents = ctxSelectedComponentIds
    .map((id) => {
      const comp = ctxComponents.find((c) => c.id === id);
      return comp && ctxComponentCode[id] ? { name: comp.name, code: ctxComponentCode[id] } : null;
    })
    .filter(Boolean) as Array<{ name: string; code: string }>;

  const hasGeneratedCode = code.length > 0;
  const designTokensSection = getDesignTokensSection(extractDesignTokenNames(themeCss));
  const systemContent = (hasGeneratedCode
    ? getScreenUpdatePrompt(settings.iconLibrary, code, screenIds, settings.prompts["prompt.screens.update"] || undefined)
    : getScreenNewPrompt(settings.iconLibrary, screenIds, settings.prompts["prompt.screens.new"] || undefined)
  )
    + designTokensSection
    + buildDesignBriefSection(ctxSelectedBrief?.content ?? activeDesignBrief)
    + buildApiContextSection(selectedApis, [])
    + buildComponentsSection(selectedComponents)
    + outputFilePathSection(screenPath);

  // Reset scaffold guards + component-code cache on project switch
  useEffect(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
    setCtxComponentCode({});
  }, [settings.project]);

  // ─── Ensure dev server is running ──────────────────────────────────────
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

  const chat = useChat({
    entityId: screenEntityId,
    chatPath,
    systemPrompt: systemContent,
    outputPath: screenId ? screenPath : undefined,
    panelToolFilter: screenToolFilter ?? SCREENS_TOOL_FILTER_DEFAULT,
    panelMaxToolCalls: settings.panelMaxToolCalls.screens,
  });

  // Keep useChat's brief-name ref in sync with the selected brief
  const { setActiveBriefName } = chat;
  useEffect(() => {
    setActiveBriefName(ctxSelectedBrief?.name ?? "");
  }, [ctxSelectedBrief, setActiveBriefName]);

  const handleApplyCode = useCallback((content: string) => {
    const c = extractCode(content);
    if (c) applyScreenCode(c);
  }, [applyScreenCode]);

  const handleResolvePermission = useCallback((requestId: number, decision: ToolPermissionDecision, toolName: string) => {
    useChatStore.getState().resolveToolPermission(screenEntityId, requestId, decision);
    if (decision === "always_allowed" && toolName) {
      const current = useAppStore.getState().settings.toolAllowlist;
      if (!current.includes(toolName)) {
        useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] });
      }
    }
  }, [screenEntityId]);

  // Load the active design language's DESIGN.md brief when the selected design changes
  useEffect(() => {
    if (!ps.stylePreset) { setActiveDesignBrief(""); return; }
    let cancelled = false;
    loadDesignBrief(`projects/${settings.project}`, ps.stylePreset)
      .then((md) => { if (!cancelled) setActiveDesignBrief(md ?? ""); })
      .catch(() => { if (!cancelled) setActiveDesignBrief(""); });
    return () => { cancelled = true; };
  }, [ps.stylePreset, settings.project]);

  // Load the list of available themes (design languages) for the preview theme picker
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

  // Load the API list for the generation context toolbar
  const { data: apisJson } = useFileWatcher(settings.project, `projects/${settings.project}/apis/apis.json`);
  useEffect(() => {
    if (!apisJson) { setCtxApis([]); return; }
    try {
      const apis = JSON.parse(apisJson) as Array<{ id: string; name: string; method: string; url: string; proxyPath?: string }>;
      setCtxApis(apis.map((a) => ({ id: a.id, name: a.name, method: a.method, url: a.url, proxyPath: a.proxyPath ?? "" })));
    } catch {
      setCtxApis([]);
    }
  }, [apisJson]);

  // Load code for newly selected components
  useEffect(() => {
    if (ctxSelectedComponentIds.length === 0) return;
    for (const id of ctxSelectedComponentIds) {
      if (ctxComponentCode[id]) continue;
      readFile(`projects/${settings.project}/generated/src/components/${id}/component.tsx`)
        .then((src) => setCtxComponentCode((prev) => ({ ...prev, [id]: src })))
        .catch(() => {/* silently skip */});
    }
  // ctxComponentCode is state — adding it to deps would cause infinite re-render loop
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctxSelectedComponentIds, settings.project]);

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

  const handleToggleSelectingElement = useCallback(() => {
    if (isSelectingElement) {
      setIsSelectingElement(false);
      previewIframeRef.current?.contentWindow?.postMessage({ type: "disable-link-mode" }, "*");
    } else {
      setIsSelectingElement(true);
      previewIframeRef.current?.contentWindow?.postMessage({ type: "enable-link-mode" }, "*");
    }
  }, [isSelectingElement, setIsSelectingElement]);

  const previewThemes = useMemo(() => themes.map((t) => ({ name: t.name })), [themes]);
  const activeIframePath = screenId ? `/${screenId}` : null;

  const { ref: outerRef, onDragEnd: outerDragEnd, defaultSizes: outerSizes } = useAllotmentLayout("create-screens", 2);
  const { ref: inspectorRef, onDragEnd: inspectorDragEnd, defaultSizes: inspectorSizes } = useAllotmentLayout("create-screens-inspector", 3);
  const { ref: codeRef, onDragEnd: codeDragEnd, defaultSizes: codeSizes } = useAllotmentLayout("create-screens-code", 3, [true, true, ps.createCodeOpen]);

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerDragEnd} defaultSizes={outerSizes}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorDragEnd} defaultSizes={inspectorSizes} onVisibleChange={(_i, v) => setProjectSettings({ createShowInspector: v })}>
            <Allotment.Pane minSize={200}>
              <CreateChatPanel
                chatInputLayoutKey="create-screens-chat-input"
                chat={chat}
                projectPath={`projects/${settings.project}`}
                contextToolbar={<ContextToolbar projectId={settings.project} showComponents />}
                onApplyCode={handleApplyCode}
                headerActions={
                  <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleExport} title="Export project">
                    <Download size={13} />
                  </Button>
                }
                placeholderEmpty="Describe the screen you want to build…"
                placeholderFollowup="Ask for changes…"
                onResolvePermission={handleResolvePermission}
              />
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setProjectSettings({ createShowInspector: !ps.createShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                <TokenUsageBadge model={settings.modelId} messages={chat.messages} entityId={screenEntityId} />
                {ps.createShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>

            <Allotment.Pane visible={ps.createShowInspector} preferredSize={240} minSize={160} snap>
              {ps.createShowInspector && (
                <CreateInspector
                  systemPrompt={systemContent}
                  messages={chat.messages}
                  model={settings.modelId}
                  host={getHostForProvider(settings.provider, settings.host)}
                  provider={settings.provider}
                  think={resolveThinkParam({ thinking: chat.canThink, thinkLevel: undefined }, chat.isGptOssFamily, chat.thinkEnabled, chat.thinkLevel)}
                  hasTools={!!(screenId && chat.toolsEnabled)}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical ref={codeRef} onDragEnd={codeDragEnd} defaultSizes={codeSizes}>
            <Allotment.Pane minSize={200}>
              <CreatePreviewPane
                project={settings.project}
                stylePreset={ps.stylePreset || null}
                previewTabs={[]}
                activePreviewTabId={activePreviewTabId}
                onSelectTab={setActivePreviewTabId}
                activeIframePath={activeIframePath}
                showZoom
                showThemePicker
                previewThemes={previewThemes}
                generatedDir={generatedDir}
                iframeRef={previewIframeRef}
                renderScreenOverlay={() => ps.createCodeTab === "links" && (
                  <ScreensHotspotOverlay
                    hotspots={hotspots}
                    selectedHotspotId={selectedHotspotId}
                    onSelectHotspot={setSelectedHotspotId}
                    isSelectingElement={isSelectingElement}
                    computedHotspots={computedHotspots}
                    screenIds={screenIds}
                    projectDir={`projects/${settings.project}`}
                    iframeRef={previewIframeRef}
                    onHotspotsChange={setHotspots}
                  />
                )}
              />
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <ScreensCodePaneHeader
                createCodeOpen={ps.createCodeOpen}
                createCodeTab={ps.createCodeTab}
                onToggle={() => setProjectSettings({ createCodeOpen: !ps.createCodeOpen })}
                onSelectTab={(tab) => setProjectSettings({ createCodeTab: tab })}
                isSelectingElement={isSelectingElement}
                onToggleSelectingElement={handleToggleSelectingElement}
              />
            </Allotment.Pane>
            <Allotment.Pane visible={ps.createCodeOpen} minSize={100} snap>
              {ps.createCodeOpen && (
                <ScreensCodePaneContent
                  createCodeTab={ps.createCodeTab}
                  code={code}
                  onCodeChange={handleCodeChange}
                  onCodeBlur={handleCodeBlur}
                  screenId={screenId}
                  screenIds={screenIds}
                  projectDir={`projects/${settings.project}`}
                  hotspots={hotspots}
                  onHotspotsChange={setHotspots}
                  isSelectingElement={isSelectingElement}
                  onToggleSelectingElement={handleToggleSelectingElement}
                  newHotspotId={newHotspotId}
                  onNewHotspotHandled={() => setNewHotspotId(null)}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
