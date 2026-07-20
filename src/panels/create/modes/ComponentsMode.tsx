// Port of src/panels/ComponentsPanel.tsx (537 lines) + components/* (4 files,
// ~611 lines). Preserves the full ensureServer scaffold flow, Save to Runner,
// Ctrl+S, SaveComponentModal/ComponentExportModal header actions, and the
// new-vs-update prompt switch. Drops onOutput/onCodeOutput/onToolWrite (per
// feedback #1) — `applyCode`'s side effects (save to runner, syncGeneratedRouter,
// saveItemMeta, library invalidate) now run from `onToolResult` re-reading the
// output file, instead of from the streaming callbacks. Drops the shadcnMode
// toggle — always generates with shadcn=true. The per-mode preview iframe is
// gone — CreatePreviewPane renders `/__preview/{id}` via `activeIframePath`.

import { useState, useCallback, useRef, useEffect } from "react";
import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Code2, Download, FolderUp, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  writeFile, createDir, readFile, getHostForProvider, isNotFoundError, getErrorMessage,
} from "@/lib/ipc";
import type { ToolPermissionDecision } from "@/lib/ipc";
import { saveItemMeta } from "@/lib/item-meta";
import { projectKeys } from "@/lib/queryKeys";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useChatStore } from "@/stores/chatStore";
import { useUIStore, EMPTY_GEN_CONTEXT } from "@/stores/uiStore";
import { useComponentCode, useThemeCss } from "@/hooks/useProjectFiles";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { hasGeneratedScaffold, scaffoldGenerated, ensureEslintPatched } from "@/lib/scaffold";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { getGeneratedDirPath } from "@/lib/scaffold-shadcn";
import { syncGeneratedRouter } from "@/lib/navigation";
import { loadDesignBrief } from "@/lib/design/persist";
import { notify } from "@/hooks/useToast";
import { useChat, resolveThinkParam } from "@/hooks/useChat";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { extractCode } from "@/lib/preview";
import {
  getComponentNewPrompt, getComponentUpdatePrompt, outputFilePathSection, extractDesignTokenNames,
  getDesignTokensSection, buildDesignBriefSection, buildApiContextSection,
} from "@/lib/prompts";
import { COMPONENTS_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";
import { Button } from "@/components/ui/button";
import { PaneHeader } from "@/components/ui/pane-header";
import { TokenUsageBadge } from "@/components/TokenUsageBadge";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import { CreateChatPanel } from "../CreateChatPanel";
import { CreateInspector } from "../CreateInspector";
import { CreatePreviewPane } from "../CreatePreviewPane";
import { CreateCodePaneHeader, CreateCodePaneContent } from "../CreateCodePane";
import { ContextToolbar } from "../ContextToolbar";
import { useFileWatcher } from "../FileWatcher";
import { useCreateMode } from "../useCreateMode";

interface CtxApi { id: string; name: string; method: string; url: string; proxyPath: string }

export function ComponentsMode() {
  const { settings } = useAppStore();
  const componentsToolFilter = useAppStore((s) => s.settings.panelToolFilter.components);
  const { ps, setProjectSettings, openCreate } = useProjectSettingsStore();
  const queryClient = useQueryClient();
  const { entityId: componentEntityId } = useCreateMode();
  const componentId = ps.activeComponent;
  const selectedComponent = componentId;

  const { runnerStatus, startRunner } = useDevServerStore();
  const scaffoldAttemptedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);

  const [code, setCode] = useState("");
  const [ctxApis, setCtxApis] = useState<CtxApi[]>([]);
  const [activeDesignBrief, setActiveDesignBrief] = useState("");

  const genContext = useUIStore((s) => s.createGenContext[settings.project] ?? EMPTY_GEN_CONTEXT);
  const ctxSelectedApiIds = genContext.apiIds;
  const ctxSelectedBrief = genContext.brief;

  const generatedDir = getGeneratedDirPath(`projects/${settings.project}`);

  const hasGeneratedCode = code.length > 0;
  const themeCssQuery = useThemeCss(settings.project, ps.stylePreset || null);
  const themeCss = themeCssQuery.data ?? "";
  const designTokensSection = getDesignTokensSection(extractDesignTokenNames(themeCss));
  const selectedApis = ctxApis.filter((a) => ctxSelectedApiIds.includes(a.id));

  const componentOutputPath = componentId
    ? `${generatedDir}/src/components/${componentId}/component.tsx`
    : undefined;

  const systemContent = (hasGeneratedCode
    ? getComponentUpdatePrompt(settings.iconLibrary, code, true, settings.prompts["prompt.components.update"] || undefined)
    : getComponentNewPrompt(settings.iconLibrary, true, settings.prompts["prompt.components.new"] || undefined)
  )
    + designTokensSection
    + buildDesignBriefSection(ctxSelectedBrief?.content ?? activeDesignBrief)
    + buildApiContextSection(selectedApis, [])
    + (componentOutputPath ? outputFilePathSection(componentOutputPath) : "");

  // Reset scaffold guards when the active project changes.
  useEffect(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
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

  const handleCodeChange = useCallback((value: string) => setCode(value), []);
  const handleCodeBlur = useCallback(() => { void saveCode(code); }, [code, saveCode]);

  // Ctrl+S to save
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        void saveCode(code);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [code, saveCode]);

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

  // Load the active design language's DESIGN.md brief when the selected design changes
  useEffect(() => {
    if (!ps.stylePreset) { setActiveDesignBrief(""); return; }
    let cancelled = false;
    loadDesignBrief(`projects/${settings.project}`, ps.stylePreset)
      .then((md) => { if (!cancelled) setActiveDesignBrief(md ?? ""); })
      .catch(() => { if (!cancelled) setActiveDesignBrief(""); });
    return () => { cancelled = true; };
  }, [ps.stylePreset, settings.project]);

  const { data: loadedCode } = useComponentCode(settings.project, selectedComponent);
  useEffect(() => {
    if (loadedCode === undefined) return;
    setCode(loadedCode);
  }, [loadedCode]);

  const chatPath = componentId
    ? `projects/${settings.project}/components/${componentId}/chat.json`
    : "projects/__placeholder__/chat.json";

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

  // Apply newly generated code: write to runner, sync routes, record item
  // metadata, and invalidate the library cache. Used by both the manual
  // "Apply code" button (non-tool models) and the write-detection effect below.
  const applyCode = useCallback(async (extracted: string) => {
    setCode(extracted);
    setProjectSettings({ createCodeOpen: true });
    if (!selectedComponent) return;
    const msgs = useChatStore.getState().chats[componentEntityId]?.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content ?? "";
    try {
      const compDir = `${generatedDir}/src/components/${selectedComponent}`;
      await createDir(compDir);
      await writeFile(`${compDir}/component.tsx`, extracted);
      await syncGeneratedRouter(`projects/${settings.project}`);
      void saveItemMeta(`projects/${settings.project}`, "components", selectedComponent, prompt)
        .then(() => queryClient.invalidateQueries({ queryKey: projectKeys.library(settings.project) }));
    } catch (e) {
      notify.error("Failed to apply generated code", getErrorMessage(e));
    }
  }, [settings.project, selectedComponent, queryClient, generatedDir, setProjectSettings, componentEntityId]);

  const handleApplyCode = useCallback((content: string) => {
    const c = extractCode(content);
    if (c) void applyCode(c);
  }, [applyCode]);

  const handleResolvePermission = useCallback((requestId: number, decision: ToolPermissionDecision, toolName: string) => {
    useChatStore.getState().resolveToolPermission(componentEntityId, requestId, decision);
    if (decision === "always_allowed" && toolName) {
      const current = useAppStore.getState().settings.toolAllowlist;
      if (!current.includes(toolName)) {
        useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] });
      }
    }
  }, [componentEntityId]);

  const chat = useChat({
    entityId: componentEntityId,
    chatPath,
    systemPrompt: systemContent,
    outputPath: componentOutputPath,
    // Re-read the output file and apply it once a write_file/edit_file tool
    // call succeeds on the component's output path — replaces the dropped
    // onCodeOutput callback.
    onToolResult: (tool, success, _output, path) => {
      const outputPath = componentOutputPath;
      if (success && outputPath && (tool === "write_file" || tool === "edit_file") && path === outputPath) {
        readFile(outputPath).then((content) => void applyCode(content)).catch(() => {/* ignore */});
      }
    },
    panelToolFilter: componentsToolFilter ?? COMPONENTS_TOOL_FILTER_DEFAULT,
    panelMaxToolCalls: settings.panelMaxToolCalls.components,
  });

  // Keep useChat's brief-name ref in sync with the selected brief
  const { setActiveBriefName, clearChat } = chat;
  useEffect(() => {
    setActiveBriefName(ctxSelectedBrief?.name ?? "");
  }, [ctxSelectedBrief, setActiveBriefName]);

  const activeIframePath = componentId ? `/__preview/${componentId}` : null;

  const { ref: outerRef, onDragEnd: outerDragEnd, defaultSizes: outerSizes } = useAllotmentLayout("create-components", 2);
  const { ref: inspectorRef, onDragEnd: inspectorDragEnd, defaultSizes: inspectorSizes } = useAllotmentLayout("create-components-inspector", 3);
  const { ref: codeRef, onDragEnd: codeDragEnd, defaultSizes: codeSizes } = useAllotmentLayout("create-components-code", 3, [true, true, ps.createCodeOpen]);

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerDragEnd} defaultSizes={outerSizes}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorDragEnd} defaultSizes={inspectorSizes} onVisibleChange={(_i, v) => setProjectSettings({ createShowInspector: v })}>
            <Allotment.Pane minSize={200}>
              <CreateChatPanel
                label={selectedComponent ?? undefined}
                chatInputLayoutKey="create-components-chat-input"
                chat={chat}
                projectPath={`projects/${settings.project}`}
                contextToolbar={<ContextToolbar projectId={settings.project} />}
                onApplyCode={handleApplyCode}
                onReset={clearChat}
                headerActions={
                  <>
                    <SaveComponentModal
                      code={code}
                      prompt={chat.messages.find((m) => m.role === "user")?.content ?? ""}
                      messages={chat.messages}
                      onSaved={(id) => {
                        openCreate("components", id);
                      }}
                      trigger={
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Save component…" disabled={!hasGeneratedCode}>
                          <Save size={13} />
                        </Button>
                      }
                    />
                    <ComponentExportModal
                      componentId="Generated"
                      trigger={
                        <Button variant="ghost" size="icon" className="h-6 w-6" title="Export component" disabled={!hasGeneratedCode}>
                          <Download size={13} />
                        </Button>
                      }
                    />
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      onClick={handleSaveToRunner}
                      disabled={!hasGeneratedCode || !componentId}
                      title="Save to Runner project"
                    >
                      <FolderUp size={13} />
                    </Button>
                  </>
                }
                placeholderEmpty="Describe the component you want to build…"
                placeholderFollowup="Ask for changes…"
                onResolvePermission={handleResolvePermission}
              />
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setProjectSettings({ createShowInspector: !ps.createShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                <TokenUsageBadge model={settings.modelId} messages={chat.messages} entityId={componentEntityId} />
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
                  hasTools={!!(componentOutputPath && chat.toolsEnabled)}
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
                activePreviewTabId={ps.activePreviewTabId}
                onSelectTab={(id) => setProjectSettings({ activePreviewTabId: id })}
                activeIframePath={activeIframePath}
                showZoom
                showThemePicker
                generatedDir={generatedDir}
              />
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <CreateCodePaneHeader
                visible={ps.createCodeOpen}
                onToggle={() => setProjectSettings({ createCodeOpen: !ps.createCodeOpen })}
                tabButtons={
                  <span className="px-1.5 py-0.5 text-[11px] font-medium rounded flex items-center gap-1 text-foreground">
                    <Code2 size={10} />Code
                  </span>
                }
              />
            </Allotment.Pane>
            <Allotment.Pane visible={ps.createCodeOpen} minSize={100} snap>
              {ps.createCodeOpen && (
                <CreateCodePaneContent>
                  <CodeMirrorEditor value={code} onChange={handleCodeChange} onBlur={handleCodeBlur} mode="tsx" />
                </CreateCodePaneContent>
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
