import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Allotment } from "allotment";
import { Smartphone, Tablet, Monitor, Save, Download, FolderUp, ChevronUp, ChevronDown, Sun, Moon, Trash2, Loader2, AlertCircle, Blocks, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { writeFile, createDir, readDir, readFile, getHostForProvider } from "@/lib/ipc";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useComponentCode } from "@/hooks/useProjectFiles";
import { useQueryClient } from "@tanstack/react-query";
import { projectKeys } from "@/lib/queryKeys";
import { notify } from "@/hooks/useToast";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { PromptInspector } from "@/components/PromptInspector";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import type { FileEntry } from "@/lib/ipc";
import { getComponentNewPrompt, getComponentUpdatePrompt } from "@/lib/prompts";
import { extractCode } from "@/lib/preview";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { hasComponentPreviewScaffold, scaffoldComponentPreview } from "@/lib/scaffold";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { getComponentPreviewDirPath, getAppTsx, PROJECT_PATHS } from "@/lib/scaffold-shadcn";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { PaneHeader } from "@/components/ui/pane-header";
import { useChat } from "@/hooks/useChat";
import { MessageList, ChatInput } from "@/components/chat";

export function ComponentsPanel() {
  const { settings } = useAppStore();
  const { ps, setPs, openComponent: setSelectedComponent } = useProjectSettingsStore();
  const queryClient = useQueryClient();

  // Dev server state
  const { previewStatus, previewUrl, previewError, startPreview, stopPreview } = useDevServerStore();
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const scaffoldAttemptedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);

  const [code, setCode] = useState("");
  const componentsShowInspector = ps.componentsShowInspector;
  const componentsDevice = ps.componentsDevice;
  const componentsDarkPreview = ps.componentsDarkPreview;
  const componentsCodeOpen = ps.componentsCodeOpen;
  const [themes, setThemes] = useState<FileEntry[]>([]);
  const selectedTheme = ps.stylePreset;
  const [themeCss, setThemeCss] = useState("");
  // Snapshot of dark mode at the time the preview URL first becomes available.
  // Used to set the initial state in the iframe via query param so it reads it
  // synchronously before React mounts — live changes go through postMessage.
  const darkAtUrlArrival = useRef(componentsDarkPreview);
  useEffect(() => { darkAtUrlArrival.current = componentsDarkPreview; }, [componentsDarkPreview]);
  const initialPreviewSrc = useMemo(
    () => (previewUrl ? `${previewUrl}?dark=${darkAtUrlArrival.current}` : undefined),
    [previewUrl]
  );
  const selectedComponent = ps.activeComponent;
  const componentId = selectedComponent;
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("components", 2);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("components-code", 3);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("components-inspector", 3);

  // Derived paths
  const componentPreviewDir = getComponentPreviewDirPath(`projects/${settings.project}`);

  // Switch to update prompt after first generation
  const hasGeneratedCode = code.length > 0;
  const themeCssSection = themeCss
    ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties for all colors:\n\`\`\`css\n${themeCss}\n\`\`\``
    : "";
  const defaultSystem = hasGeneratedCode
    ? getComponentUpdatePrompt(settings.iconLibrary, code, ps.shadcnMode, settings.prompts["prompt.components.update"] || undefined) + themeCssSection
    : getComponentNewPrompt(settings.iconLibrary, ps.shadcnMode, settings.prompts["prompt.components.new"] || undefined) + themeCssSection;
  const systemContent = defaultSystem;

  // Reset guards whenever the active project changes
  useEffect(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
  }, [settings.project]);

  // ─── Ensure dev server is running ──────────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function ensurePreviewServer() {
      if (cancelled) return;
      if (previewStatus === "running" || previewStatus === "starting") return;
      if (stoppedManuallyRef.current) return;

      // Check if scaffolded
      const isScaffolded = await hasComponentPreviewScaffold(`projects/${settings.project}`);
      if (cancelled) return;

      if (!isScaffolded) {
        if (scaffoldAttemptedRef.current) return;
        scaffoldAttemptedRef.current = true;

        // Stop dev server before re-scaffolding to release file locks
        useDevServerStore.getState().stopPreview();

        const ok = await confirm(
          "The component preview needs a Vite project. Create one now?",
          { title: "Scaffold Required", kind: "info" }
        );
        if (!ok) return;
        if (cancelled) return;

        try {
          await withScaffoldNotifications(
            "scaffold-component-preview",
            "Scaffolding component preview",
            (onStep) => scaffoldComponentPreview(componentPreviewDir, settings.iconLibrary, onStep)
          );
        } catch {
          return;
        }
      } else {
        // Keep App.tsx up to date (fixes dark mode for existing projects via HMR)
        writeFile(`${componentPreviewDir}/${PROJECT_PATHS.SRC.APP_TSX}`, getAppTsx()).catch(() => {});
      }

      if (cancelled) return;
      try {
        await startPreview(componentPreviewDir, ps.devServerPort);
      } catch (e) {
        notify.error("Failed to start preview server", e instanceof Error ? e.message : String(e));
      }
    }

    ensurePreviewServer();
    return () => { cancelled = true; };
  }, [settings.project, previewStatus, componentPreviewDir, startPreview, ps.devServerPort, settings.iconLibrary]);

  // ─── Write theme CSS when it changes ───────────────────────────────────────

  useEffect(() => {
    if (!themeCss || previewStatus !== "running") return;

    const themePath = `${componentPreviewDir}/src/styles/preview-theme.css`;
    writeFile(themePath, themeCss).catch((e) => {
      console.error("Failed to write theme CSS:", e);
    });
  }, [themeCss, previewStatus, componentPreviewDir]);

  // ─── Dark mode toggle → postMessage to iframe ─────────────────────────────

  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "set-dark", value: componentsDarkPreview }, "*");
  }, [componentsDarkPreview, previewUrl]);

  const saveCode = useCallback(async (value: string) => {
    if (!value) return;
    try {
      // Write to Runner's App.tsx (Runner has no Generated wrapper — App IS the component)
      const genDir = `projects/${settings.project}/generated`;
      await writeFile(`${genDir}/src/App.tsx`, value);
      // Write to component-preview/ Generated.tsx for the Vite component preview
      await writeFile(`${componentPreviewDir}/src/components/Generated.tsx`, value);
      if (selectedComponent) {
        const compDir = `projects/${settings.project}/components/${selectedComponent}`;
        await createDir(compDir);
        await writeFile(`${compDir}/component.tsx`, value);
      }
    } catch (e) {
      notify.error("Failed to save generated code", e instanceof Error ? e.message : String(e));
    }
  }, [settings.project, selectedComponent, componentPreviewDir]);

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
      } catch {
        if (!cancelled) setThemes([]);
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project]);

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
      } catch {
        if (!cancelled) setThemeCss("");
      }
    })();
    return () => { cancelled = true; };
  }, [selectedTheme, settings.project]);

  // Load selected component code via TanStack Query
  const { data: loadedCode } = useComponentCode(settings.project, selectedComponent);

  useEffect(() => {
    if (loadedCode === undefined) return;
    setCode(loadedCode);
    if (!loadedCode) return;
    // Push to preview dirs so the Vite dev server shows the opened component immediately
    writeFile(`${componentPreviewDir}/src/components/Generated.tsx`, loadedCode).catch(() => {});
    const genDir = `projects/${settings.project}/generated`;
    writeFile(`${genDir}/src/App.tsx`, loadedCode).catch(() => {});
  }, [loadedCode, componentPreviewDir, settings.project]);

  const chatPath = componentId
    ? `projects/${settings.project}/components/${componentId}/chat.json`
    : "projects/__placeholder__/chat.json";

  const componentOutputPath = componentId
    ? `projects/${settings.project}/components/${componentId}/component.tsx`
    : undefined;

  const handleSaveToRunner = useCallback(async () => {
    if (!code || !componentId) return;
    const dest = `projects/${settings.project}/generated/${ps.directories.components}/${componentId}.tsx`;
    try {
      await createDir(`projects/${settings.project}/generated/${ps.directories.components}`);
      await writeFile(dest, code);
      notify.success("Saved to Runner", dest);
    } catch (e) {
      notify.error("Save to Runner failed", e instanceof Error ? e.message : String(e));
    }
  }, [code, componentId, settings.project, ps.directories.components]);

  const {
    messages, isStreaming, thinkingContent, input, setInput, sendMessage,
    stopGeneration, regenerate, clearChat, deleteFrom, attachments, addAttachment, removeAttachment,
    thinkEnabled, toggleThink, canThink, canVision,
    toolsEnabled, toggleTools, canTools,
    mentions, addMention, removeMention,
  } = useChat({
    entityId: componentId ? `component-${componentId}` : "component-none",
    chatPath,
    systemPrompt: systemContent,
    outputPath: componentOutputPath,
    onOutput: (content) => applyCode(content),
  });

  const applyCode = useCallback(async (extracted: string) => {
    setCode(extracted);
    setPs({ componentsCodeOpen: true });
    try {
      // Write to Runner's App.tsx (Runner has no Generated wrapper — App IS the component)
      const genDir = `projects/${settings.project}/generated`;
      await writeFile(`${genDir}/src/App.tsx`, extracted);

      // Write to component-preview/ for the Vite dev server (HMR will pick it up)
      const previewDir = componentPreviewDir;
      await createDir(`${previewDir}/src/components`);
      await writeFile(`${previewDir}/src/components/Generated.tsx`, extracted);

      useUIStore.setState((s) => ({ runnerFileTreeNonce: s.runnerFileTreeNonce + 1 }));

      if (selectedComponent) {
        const compDir = `projects/${settings.project}/components/${selectedComponent}`;
        await createDir(compDir);
        await writeFile(`${compDir}/component.tsx`, extracted);
        queryClient.invalidateQueries({ queryKey: projectKeys.componentCode(settings.project, selectedComponent) });
      }
    } catch (e) {
      notify.error("Failed to apply generated code", e instanceof Error ? e.message : String(e));
    }
  }, [settings.project, selectedComponent, queryClient, componentPreviewDir, setPs]);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const handleRetryPreview = useCallback(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
    useDevServerStore.getState().stopPreview();
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
        onApplyCode={(content) => { const c = extractCode(content); if (c) applyCode(c); }}
        onRegenerate={regenerate}
        onDeleteFrom={deleteFrom}
      />
      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0 space-y-2">
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
    if (previewStatus === "error") {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4 h-full text-center">
          <AlertCircle size={24} className="text-destructive" />
          <p className="text-xs font-medium text-destructive">Preview Error</p>
          <p className="text-[10px] text-muted-foreground max-w-full line-clamp-3">
            {previewError || "Failed to start dev server"}
          </p>
          <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={handleRetryPreview}>
            Retry
          </Button>
        </div>
      );
    }

    if (previewStatus === "starting") {
      return (
        <div className="flex flex-col items-center justify-center gap-2 h-full">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Starting preview…</p>
        </div>
      );
    }

    if (previewStatus === "running" && previewUrl) {
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
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault}>
            <Allotment.Pane minSize={200}>
              {chatPane}
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setPs({ componentsShowInspector: !componentsShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                {componentsShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>
            <Allotment.Pane visible={componentsShowInspector} preferredSize={240} minSize={160}>
              {componentsShowInspector && (
                <PromptInspector
                  model={settings.modelId}
                  messages={[
                    { role: "system", content: systemContent },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                  ]}
                  host={getHostForProvider(settings.provider, settings.host)}
                  provider={settings.provider}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical ref={codeRef} onDragEnd={codeOnDragEnd} defaultSizes={codeDefault}>
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
                  <span className="text-sm font-medium">Preview</span>
                  {previewStatus === "running" ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { stoppedManuallyRef.current = true; stopPreview(); }} title="Stop preview server">
                      <Square size={12} />
                    </Button>
                  ) : previewStatus === "starting" ? (
                    <Button variant="ghost" size="icon" className="h-7 w-7" disabled title="Starting preview…">
                      <Loader2 size={12} className="animate-spin" />
                    </Button>
                  ) : (
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { stoppedManuallyRef.current = false; startPreview(componentPreviewDir, ps.devServerPort); }} title="Start preview server">
                      <Play size={12} />
                    </Button>
                  )}
                  <div className="flex-1" />
                  <Select value={selectedTheme} onValueChange={(v) => setPs({ stylePreset: v })}>
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
                <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
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
            <Allotment.Pane visible={componentsCodeOpen} preferredSize={252} minSize={100}>
              <div className="h-full overflow-hidden">
                <CodeMirrorEditor value={code} onChange={handleCodeChange} onBlur={handleCodeBlur} mode="tsx" />
              </div>
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}