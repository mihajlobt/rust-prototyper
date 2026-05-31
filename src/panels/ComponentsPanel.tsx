import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Allotment } from "allotment";
import { Smartphone, Tablet, Monitor, Save, Download, FolderUp, ChevronUp, ChevronDown, Sun, Moon, Trash2, Loader2, AlertCircle, Blocks, Play, Square, Plug, Palette } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { writeFile, createDir, readDir, readFile, getHostForProvider, isNotFoundError, getErrorMessage } from "@/lib/ipc";
import { saveItemMeta } from "@/lib/item-meta";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";

import { useComponentCode } from "@/hooks/useProjectFiles";
import { useQueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/lib/queryKeys";
import { notify } from "@/hooks/useToast";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { PromptInspector } from "@/components/PromptInspector";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import type { FileEntry } from "@/lib/ipc";
import { getComponentNewPrompt, getComponentUpdatePrompt, outputFilePathSection, extractDesignTokenNames, getDesignTokensSection, DESIGN_BRIEF_TEMPLATES, buildDesignBriefSection, buildApiContextSection, type DesignBriefTemplate } from "@/lib/prompts";
import { useSettings } from "@/hooks/useSettings";
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
import { useUIStore, EMPTY_GEN_CONTEXT } from "@/stores/uiStore";
import { MessageList, ChatInput } from "@/components/chat";

export function ComponentsPanel() {
  const { settings } = useAppStore();
  const { settings: globalSettings } = useSettings();
  const { ps, setPs, openComponent: setSelectedComponent } = useProjectSettingsStore();
  const queryClient = useQueryClient();

  const allBriefs: DesignBriefTemplate[] = [
    ...DESIGN_BRIEF_TEMPLATES,
    ...globalSettings.styles.map((s) => ({
      name: s.name,
      description: s.value.slice(0, 80) + (s.value.length > 80 ? "…" : ""),
      palette: [] as string[],
      content: s.value,
    })),
  ];

  // Dev server state — shared runner server
  const { runnerStatus, runnerUrl, runnerError, startRunner, stopRunner } = useDevServerStore();
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const scaffoldAttemptedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);

  const [code, setCode] = useState("");

  // Generation context state — APIs and Design Brief selectors. The loaded list
  // is local; the user's selections live in uiStore (session, keyed by project).
  interface CtxApi { id: string; name: string; method: string; url: string; proxyPath: string }
  const [ctxApis, setCtxApis] = useState<CtxApi[]>([]);
  const genContext = useUIStore((s) => s.componentsGenContext[settings.project] ?? EMPTY_GEN_CONTEXT);
  const setGenContext = useUIStore((s) => s.setComponentsGenContext);
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
    [runnerUrl, selectedComponent, componentsDarkPreview]
  );
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("components", 2);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("components-code", 3, [true, true, componentsCodeOpen]);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("components-inspector", 3, [true, true, componentsShowInspector]);

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
    onOutput: (content) => { const code = extractCode(content); if (code) applyCode(code); },
    // Tool models: write_file fires with raw code (no fences) for the primary output file only.
    onCodeOutput: (code) => applyCode(code),
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
    setPs({ componentsCodeOpen: true });
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
  }, [settings.project, selectedComponent, queryClient, generatedDir, setPs]);


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

  const chatPane = (
    <div className="h-full flex flex-col bg-card">
      <div className="panel-toolbar h-10 px-3 gap-2">
        <span className="text-sm font-medium">{selectedComponent ?? "Chat"}</span>
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {messages.filter((m) => m.role === "user").length} turns
          </span>
        )}
        <div className="flex-1" />
        <SaveComponentModal
          code={code}
          prompt={messages.find(m => m.role === "user")?.content ?? ""}
          messages={messages}
          onSaved={(id) => {
            setSelectedComponent(id);
            window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "components" } }));
          }}
          trigger={
            <Button variant="ghost" size="icon" className="h-6 w-6" title="Save component…" disabled={!code}>
              <Save size={13} />
            </Button>
          }
        />
        <ComponentExportModal componentId="Generated" trigger={
          <Button variant="ghost" size="icon" className="h-6 w-6" title="Export component" disabled={!code}>
            <Download size={13} />
          </Button>
        } />
        <Button
          variant="ghost" size="icon" className="h-6 w-6"
          onClick={handleSaveToRunner}
          disabled={!code || !componentId}
          title="Save to Runner project"
        >
          <FolderUp size={13} />
        </Button>
        <Button
          variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={async () => {
            const ok = await confirm("Clear all chat messages?", { title: "Clear Chat", kind: "warning" });
            if (ok) clearChat();
          }}
          disabled={messages.length === 0}
          title="Clear chat"
        >
          <Trash2 size={13} />
        </Button>
      </div>

      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        thinkingContent={thinkingContent}
        pendingPermissions={pendingPermissions}
        onApplyCode={(content) => { const c = extractCode(content); if (c) applyCode(c); }}
        onRegenerate={regenerate}
        onDeleteFrom={deleteFrom}
        onResolvePermission={(requestId, decision, toolName) => {
          useChatStore.getState().resolveToolPermission(
            componentId ? `component-${componentId}` : "component-none",
            requestId,
            decision
          )
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
        {(ctxApis.length > 0 || ctxSelectedBrief || themes.length > 0) && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Design language — the theme injected into generation. The preview
                theme is chosen separately in the preview toolbar. */}
            {themes.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant={selectedTheme ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
                    <Palette size={10} />
                    {selectedTheme || "Design"}
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuRadioGroup
                    value={selectedTheme}
                    onValueChange={(v) => setPs({ stylePreset: v, applyDesignBrief: true })}
                  >
                    <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
                    {themes.map((t) => (
                      <DropdownMenuRadioItem key={t.name} value={t.name} className="text-xs">{t.name}</DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {/* Design Brief — always available */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant={ctxSelectedBrief ? "secondary" : "outline"} size="sm" className="h-6 text-[11px] gap-1 px-2">
                  <Palette size={10} />
                  {ctxSelectedBrief ? ctxSelectedBrief.name : "Brief"}
                  {ctxSelectedBrief && (
                    <span
                      className="ml-0.5 text-muted-foreground hover:text-foreground"
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => { e.stopPropagation(); setGenContext(settings.project, { brief: null }); }}
                    >×</span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-72">
                <DropdownMenuRadioGroup value={ctxSelectedBrief?.name ?? ""} onValueChange={(v) => { const b = allBriefs.find((bb) => bb.name === v) ?? null; setGenContext(settings.project, { brief: b }); }}>
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
                    onCheckedChange={(c) => setGenContext(settings.project, { apiIds: c ? [...ctxSelectedApiIds, api.id] : ctxSelectedApiIds.filter((x) => x !== api.id) })}
                    className="text-xs"
                  >
                    <span className={["mr-1 text-[10px] font-bold px-1 py-0.5 rounded", api.method === "GET" ? "bg-green-500/10 text-green-600" : "bg-blue-500/10 text-blue-600"].join(" ")}>{api.method}</span>
                    {api.name}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
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

  // ─── Render preview content based on dev server status ─────────────────────

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
        <iframe
          ref={previewIframeRef}
          src={initialPreviewSrc}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      );
    }

    // idle or no URL yet
    return (
      <div className="flex items-center justify-center text-muted-foreground text-sm">
        Generated components will preview here
      </div>
    );
  };

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault} onVisibleChange={(_i, v) => setPs({ componentsShowInspector: v })}>
            <Allotment.Pane minSize={200}>
              {chatPane}
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setPs({ componentsShowInspector: !componentsShowInspector })}>
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
          <Allotment vertical ref={codeRef} onDragEnd={codeOnDragEnd} defaultSizes={codeDefault} onVisibleChange={(_i, v) => setPs({ componentsCodeOpen: v })}>
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
                   <Select value={ps.componentsPreviewTheme} onValueChange={(v) => setPs({ componentsPreviewTheme: v })}>
                    <SelectTrigger className="h-6 text-xs w-[90px]">
                      <SelectValue placeholder="Theme…" />
                    </SelectTrigger>
                    <SelectContent position="popper" side="bottom">
                      {themes.map((t) => (
                        <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <div className="w-px h-4 bg-border" />
                  <Button
                    variant={componentsDarkPreview ? "secondary" : "ghost"}
                    size="icon" className="h-7 w-7"
                    onClick={() => {
                      setPs({ componentsDarkPreview: !componentsDarkPreview });
                      // Also send postMessage to iframe for immediate dark mode toggle
                      previewIframeRef.current?.contentWindow?.postMessage(
                        { type: "set-dark", value: !componentsDarkPreview },
                        "*"
                      );
                    }}
                    title={componentsDarkPreview ? "Light preview" : "Dark preview"}
                  >
                    {componentsDarkPreview ? <Moon size={12} /> : <Sun size={12} />}
                  </Button>
                  <Button
                    variant={ps.shadcnMode ? "secondary" : "ghost"}
                    size="icon" className="h-7 w-7"
                    onClick={() => setPs({ shadcnMode: !ps.shadcnMode })}
                    title="Use shadcn/ui components"
                  >
                    <Blocks size={12} />
                  </Button>
                  <div className="w-px h-4 bg-border" />
                  <div className="flex items-center gap-1">
                    <Button
                      variant={componentsDevice === "mobile" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => setPs({ componentsDevice: "mobile" })}
                    >
                      <Smartphone size={12} />
                    </Button>
                    <Button
                      variant={componentsDevice === "tablet" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => setPs({ componentsDevice: "tablet" })}
                    >
                      <Tablet size={12} />
                    </Button>
                    <Button
                      variant={componentsDevice === "desktop" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => setPs({ componentsDevice: "desktop" })}
                    >
                      <Monitor size={12} />
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto px-0 py-4 bg-muted/30 flex justify-center">
                  <div
                    className="h-full bg-background shadow-lg border border-border overflow-hidden"
                    style={{ width: deviceWidth[componentsDevice] }}
                  >
                    {renderPreview()}
                  </div>
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setPs({ componentsCodeOpen: !componentsCodeOpen })}>
                <span className="text-xs font-medium flex-1">Code</span>
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