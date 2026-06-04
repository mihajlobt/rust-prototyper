import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Code2 } from "lucide-react";
import {
  writeFile,
  createDir,
  readDir,
  readFile,
  getHostForProvider,
  isNotFoundError,
  getErrorMessage,
} from "@/lib/ipc";
import type { ToolPermissionDecision } from "@/lib/ipc";
import { saveItemMeta } from "@/lib/item-meta";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useComponentCode } from "@/hooks/useProjectFiles";
import { useQueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/lib/queryKeys";
import { notify } from "@/hooks/useToast";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { PromptInspector } from "@/components/PromptInspector";
import type { FileEntry } from "@/lib/ipc";
import {
  getComponentNewPrompt,
  getComponentUpdatePrompt,
  outputFilePathSection,
  extractDesignTokenNames,
  getDesignTokensSection,
  buildDesignBriefSection,
  buildApiContextSection,
} from "@/lib/prompts";
import { extractCode } from "@/lib/preview";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { hasGeneratedScaffold, scaffoldGenerated, ensureEslintPatched } from "@/lib/scaffold";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { getGeneratedDirPath } from "@/lib/scaffold-shadcn";
import { syncGeneratedRouter } from "@/lib/navigation";
import { loadDesignBrief } from "@/lib/design/persist";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { PaneHeader } from "@/components/ui/pane-header";
import { useChat, resolveThinkParam } from "@/hooks/useChat";
import { useChatStore } from "@/stores/chatStore";

import { COMPONENTS_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";
import { useUIStore, EMPTY_GEN_CONTEXT } from "@/stores/uiStore";
import {
  ComponentsChatPanel,
  ComponentsPreview,
  ComponentsPreviewToolbar,
  ContextToolbar,
} from "@/panels/components";

interface CtxApi {
  id: string;
  name: string;
  method: string;
  url: string;
  proxyPath: string;
}

export function ComponentsPanel() {
  const { settings } = useAppStore();
  const componentsToolFilter = useAppStore((s) => s.settings.panelToolFilter.components);
  const { ps, setProjectSettings, openComponent: setSelectedComponent } = useProjectSettingsStore();
  const queryClient = useQueryClient();

  // Dev server state — shared runner server
  // (runnerError and stopRunner are consumed in the preview sub-components.)
  const { runnerStatus, runnerUrl, startRunner } = useDevServerStore();
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const scaffoldAttemptedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);

  const [code, setCode] = useState("");

  // Generation context state — APIs and Design Brief selectors. The loaded list
  // is local; the user's selections live in uiStore (session, keyed by project).
  const [ctxApis, setCtxApis] = useState<CtxApi[]>([]);
  const genContext = useUIStore((s) => s.componentsGenContext[settings.project] ?? EMPTY_GEN_CONTEXT);
  const ctxSelectedApiIds = genContext.apiIds;
  const ctxSelectedBrief = genContext.brief;
  const [activeDesignBrief, setActiveDesignBrief] = useState<string>("");

  const componentsShowInspector = ps.componentsShowInspector;
  const componentsDevice = ps.componentsDevice;
  const componentsDarkPreview = ps.componentsDarkPreview;
  const componentsCodeOpen = ps.componentsCodeOpen;
  const [themes, setThemes] = useState<FileEntry[]>([]);
  const selectedTheme = ps.stylePreset;       // generation design language — drives DESIGN.md + design tokens
  const [themeCss, setThemeCss] = useState("");             // theme.css for the generation design language
  const [previewThemeCss, setPreviewThemeCss] = useState(""); // theme.css for the live preview only

  // ─── Dark mode toggle → postMessage to iframe ─────────────────────────────
  const selectedComponent = ps.activeComponent;
  const componentId = selectedComponent;
  const initialPreviewSrc = useMemo(
    () => {
      if (!runnerUrl || !selectedComponent) return undefined;
      const base = runnerUrl.replace(/\/$/, "");
      return `${base}/__preview/${selectedComponent}?dark=${componentsDarkPreview}`;
    },
    [runnerUrl, selectedComponent, componentsDarkPreview],
  );
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("components", 2);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("components-code", 3);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("components-inspector", 3);

  // Derived paths
  const generatedDir = getGeneratedDirPath(`projects/${settings.project}`);

  // Switch to update prompt after first generation
  const hasGeneratedCode = code.length > 0;
  const designTokensSection = getDesignTokensSection(extractDesignTokenNames(themeCss));
  const selectedApis = ctxApis.filter((a) => ctxSelectedApiIds.includes(a.id));
  const defaultSystem = hasGeneratedCode
    ? getComponentUpdatePrompt(settings.iconLibrary, code, ps.shadcnMode, settings.prompts["prompt.components.update"] || undefined) + designTokensSection
    : getComponentNewPrompt(settings.iconLibrary, ps.shadcnMode, settings.prompts["prompt.components.new"] || undefined) + designTokensSection;
  const componentPath = componentId ? `projects/${settings.project}/generated/src/components/${componentId}/component.tsx` : undefined;
  const systemContent = defaultSystem
    + buildDesignBriefSection(ctxSelectedBrief?.content ?? (ps.applyDesignBrief ? activeDesignBrief : ""))
    + buildApiContextSection(selectedApis, [])
    + (componentPath ? outputFilePathSection(componentPath) : "");

  // Reset scaffold guards when the active project changes.
  // (Context selections live in uiStore keyed by project, so they reset implicitly.)
  useEffect(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
  }, [settings.project]);

  // ─── Ensure dev server is running ──────────────────────────────────────────

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
            (onStep) => scaffoldGenerated(generatedDir, settings.iconLibrary, onStep),
          );
        } catch {
          return;
        }
      } else {
        ensureEslintPatched(`projects/${settings.project}`).catch((e) => {
          if (!isNotFoundError(e)) notify.error("Failed to patch ESLint config", getErrorMessage(e));
        });
      }

      if (cancelled) return;
      try {
        await startRunner(generatedDir, ps.runnerPort);
      } catch (e) {
        notify.error("Failed to start preview server", getErrorMessage(e));
      }
    }

    ensureServer();
    return () => { cancelled = true; };
  }, [settings.project, runnerStatus, generatedDir, startRunner, ps.runnerPort, settings.iconLibrary]);

  // ─── Write preview theme CSS to the preview project when it changes ───────
  // Uses the preview-only theme (componentsPreviewTheme), not the generation
  // design language (stylePreset).

  useEffect(() => {
    if (!previewThemeCss || runnerStatus !== "running") return;

    writeFile(`${generatedDir}/src/styles/preview-theme.css`, previewThemeCss).catch((e) => {
      notify.error("Failed to write preview theme CSS", getErrorMessage(e));
    });
  }, [previewThemeCss, runnerStatus, generatedDir]);

  // ─── Navigate iframe to component's preview route ────────────────────────────
  // ─── Dark mode toggle → postMessage to iframe ─────────────────────────────

  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "set-dark", value: componentsDarkPreview }, "*");
  }, [componentsDarkPreview, runnerUrl]);

  const saveCode = useCallback(async (value: string) => {
    if (!value || !selectedComponent) return;
    try {
      const compDir = `${generatedDir}/src/components/${selectedComponent}`;
      await createDir(compDir);
      await writeFile(`${compDir}/component.tsx`, value);
    } catch (e) {
      notify.error("Failed to save generated code", getErrorMessage(e));
    }
  }, [selectedComponent, generatedDir]);

  const handleCodeChange = useCallback((value: string) => {
    setCode(value);
  }, []);

  const handleCodeBlur = useCallback(() => {
    saveCode(code);
  }, [code, saveCode]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        saveCode(code);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [code, saveCode]);

  // Load themes list and selected theme CSS
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

  // Load preview theme CSS — drives the live preview only, independent of the
  // generation design language (stylePreset).
  useEffect(() => {
    if (!ps.componentsPreviewTheme) { setPreviewThemeCss(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const css = await readFile(`projects/${settings.project}/themes/${ps.componentsPreviewTheme}/theme.css`);
        if (!cancelled) setPreviewThemeCss(css);
      } catch (e) {
        if (!cancelled) {
          setPreviewThemeCss("");
          if (!isNotFoundError(e)) notify.error("Failed to load preview theme", getErrorMessage(e));
        }
      }
    })();
    return () => { cancelled = true; };
  }, [ps.componentsPreviewTheme, settings.project]);

  useEffect(() => {
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
  }, [selectedTheme, settings.project]);

  // Load API list for generation context toolbar
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

  // Load selected component code via TanStack Query
  const { data: loadedCode } = useComponentCode(settings.project, selectedComponent);

  useEffect(() => {
    if (loadedCode === undefined) return;
    setCode(loadedCode);
  }, [loadedCode]);

  const chatPath = componentId
    ? `projects/${settings.project}/components/${componentId}/chat.json`
    : "projects/__placeholder__/chat.json";

  const componentOutputPath = componentId
    ? `projects/${settings.project}/generated/src/components/${componentId}/component.tsx`
    : undefined;

  const handleSaveToRunner = useCallback(async () => {
    if (!code || !componentId) return;
    const compDir = `${generatedDir}/src/components/${componentId}`;
    try {
      await createDir(compDir);
      await writeFile(`${compDir}/component.tsx`, code);
      await syncGeneratedRouter(`projects/${settings.project}`);
      notify.success("Saved to Runner", `${compDir}/component.tsx`);
    } catch (e) {
      notify.error("Save to Runner failed", getErrorMessage(e));
    }
  }, [code, componentId, generatedDir, settings.project]);

  const {
    messages, isStreaming, thinkingContent, input, setInput, sendMessage,
    stopGeneration, regenerate, clearChat, deleteFrom, attachments, addAttachment, removeAttachment,
    thinkEnabled, toggleThink, thinkLevel, setThinkLevel, isGptOssFamily, canThink, canVision,
    toolsEnabled, toggleTools, canTools,
    mentions, addMention, removeMention,
    setActiveBriefName,
    pendingPermissions,
  } = useChat({
    entityId: componentId ? `component-${componentId}` : "component-none",
    chatPath,
    systemPrompt: systemContent,
    outputPath: componentOutputPath,
    // Non-tool models: final text may contain a code block in markdown fences.
    onOutput: (content) => { const c = extractCode(content); if (c) applyCode(c); },
    // Tool models: write_file fires with raw code (no fences) for the primary output file only.
    onCodeOutput: (c) => applyCode(c),
    panelToolFilter: componentsToolFilter ?? COMPONENTS_TOOL_FILTER_DEFAULT,
    panelMaxToolCalls: settings.panelMaxToolCalls.components,
  });

  // Keep useChat's brief-name ref in sync with the selected brief — covers both
  // clearing and restoration of the selection after a panel remount.
  useEffect(() => {
    setActiveBriefName(ctxSelectedBrief?.name ?? "");
  }, [ctxSelectedBrief, setActiveBriefName]);

  // Load the active design language's DESIGN.md brief when the selected design changes
  useEffect(() => {
    if (!selectedTheme) { setActiveDesignBrief(""); return; }
    let cancelled = false;
    loadDesignBrief(`projects/${settings.project}`, selectedTheme)
      .then((md) => { if (!cancelled) setActiveDesignBrief(md ?? ""); })
      .catch(() => { if (!cancelled) setActiveDesignBrief(""); });
    return () => { cancelled = true; };
  }, [selectedTheme, settings.project]);

  const applyCode = useCallback(async (extracted: string) => {
    setCode(extracted);
    setProjectSettings({ componentsCodeOpen: true });
    if (!selectedComponent) return;
    const entityId = componentId ? `component-${componentId}` : "component-none";
    const msgs = useChatStore.getState().chats[entityId]?.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content ?? "";
    try {
      const compDir = `${generatedDir}/src/components/${selectedComponent}`;
      await createDir(compDir);
      await writeFile(`${compDir}/component.tsx`, extracted);
      await syncGeneratedRouter(`projects/${settings.project}`);
      queryClient.invalidateQueries({ queryKey: projectKeys.componentCode(settings.project, selectedComponent) });
      void saveItemMeta(`projects/${settings.project}`, "components", selectedComponent, prompt)
        .then(() => queryClient.invalidateQueries({ queryKey: projectKeys.library(settings.project) }));
    } catch (e) {
      notify.error("Failed to apply generated code", getErrorMessage(e));
    }
  }, [settings.project, selectedComponent, queryClient, generatedDir, setProjectSettings]);

  const handleApplyCode = useCallback((content: string) => {
    const c = extractCode(content);
    if (c) applyCode(c);
  }, [applyCode]);

  const handleResolvePermission = useCallback((requestId: number, decision: ToolPermissionDecision, toolName: string) => {
    useChatStore.getState().resolveToolPermission(
      componentId ? `component-${componentId}` : "component-none",
      requestId,
      decision,
    );
    if (decision === "always_allowed" && toolName) {
      const current = useAppStore.getState().settings.toolAllowlist;
      if (!current.includes(toolName)) {
        useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] });
      }
    }
  }, [componentId]);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const handleRetryPreview = useCallback(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
    useDevServerStore.getState().stopRunner();
  }, []);

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment
            vertical
            ref={inspectorRef}
            onDragEnd={inspectorOnDragEnd}
            defaultSizes={inspectorDefault}
            onVisibleChange={(_i, v) => setProjectSettings({ componentsShowInspector: v })}
          >
            <Allotment.Pane minSize={200}>
              <ComponentsChatPanel
                selectedComponent={selectedComponent}
                componentId={componentId}
                hasCode={hasGeneratedCode}
                code={code}
                messages={messages}
                onSelectComponent={setSelectedComponent}
                onSaveToRunner={handleSaveToRunner}
                onClearChat={clearChat}
                isStreaming={isStreaming}
                thinkingContent={thinkingContent}
                pendingPermissions={pendingPermissions}
                onApplyCode={handleApplyCode}
                onRegenerate={regenerate}
                onDeleteFrom={deleteFrom}
                onResolvePermission={handleResolvePermission}
                input={input}
                onChangeInput={setInput}
                onSend={sendMessage}
                onStop={stopGeneration}
                attachments={attachments}
                onAddAttachment={addAttachment}
                onRemoveAttachment={removeAttachment}
                mentions={mentions}
                onAddMention={addMention}
                onRemoveMention={removeMention}
                projectPath={`projects/${settings.project}`}
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
                contextToolbar={
                  (ctxApis.length > 0 || ctxSelectedBrief || themes.length > 0) ? (
                    <ContextToolbar
                      themes={themes}
                      selectedTheme={selectedTheme}
                      ctxApis={ctxApis}
                      ctxSelectedApiIds={ctxSelectedApiIds}
                      ctxSelectedBrief={ctxSelectedBrief}
                    />
                  ) : null
                }
              />
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setProjectSettings({ componentsShowInspector: !componentsShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                {componentsShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>
            <Allotment.Pane visible={componentsShowInspector} preferredSize={240} minSize={160} snap>
              {componentsShowInspector && (
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
                  hasTools={!!(componentOutputPath && toolsEnabled)}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment
            vertical
            ref={codeRef}
            onDragEnd={codeOnDragEnd}
            defaultSizes={codeDefault}
            onVisibleChange={(_i, v) => setProjectSettings({ componentsCodeOpen: v })}
          >
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <ComponentsPreviewToolbar
                  themes={themes}
                  initialPreviewSrc={initialPreviewSrc}
                  iframeRef={previewIframeRef}
                  stoppedManuallyRef={stoppedManuallyRef}
                  generatedDir={generatedDir}
                />
                <div className="flex-1 overflow-auto px-0 py-4 bg-muted/30 flex justify-center">
                  <div
                    className="h-full bg-background shadow-lg border border-border overflow-hidden"
                    style={{ width: deviceWidth[componentsDevice] }}
                  >
                    <ComponentsPreview
                      iframeRef={previewIframeRef}
                      initialPreviewSrc={initialPreviewSrc}
                      onRetry={handleRetryPreview}
                    />
                  </div>
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setProjectSettings({ componentsCodeOpen: !componentsCodeOpen })}>
                <span className="text-xs font-medium flex-1 flex items-center gap-1"><Code2 size={11} />Code</span>
                {componentsCodeOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>
            <Allotment.Pane visible={componentsCodeOpen} preferredSize={252} minSize={100} snap>
              {componentsCodeOpen && (
                <div className="h-full overflow-hidden">
                  <CodeMirrorEditor value={code} onChange={handleCodeChange} onBlur={handleCodeBlur} mode="tsx" />
                </div>
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
