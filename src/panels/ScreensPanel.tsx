import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Smartphone, Tablet, Monitor, Download, Sun, Moon, Trash2, Loader2, AlertCircle, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { writeFile, createDir, readFile, exportProject, getHostForProvider } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { notify } from "@/hooks/useToast";
import { PromptInspector } from "@/components/PromptInspector";
import { save } from "@tauri-apps/plugin-dialog";
import { confirm } from "@tauri-apps/plugin-dialog";
import { getScreenNewPrompt, getScreenUpdatePrompt } from "@/lib/prompts";
import { extractCode } from "@/lib/preview";
import { useChat } from "@/hooks/useChat";
import { MessageList, ChatInput } from "@/components/chat";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { PaneHeader } from "@/components/ui/pane-header";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { hasScreenPreviewScaffold, scaffoldScreenPreview } from "@/lib/scaffold";
import { withScaffoldNotifications } from "@/lib/scaffold-notifications";
import { getScreenPreviewDirPath, getScreenPreviewAppTsx, PROJECT_PATHS } from "@/lib/scaffold-shadcn";

export function ScreensPanel() {
  const { settings } = useAppStore();
  const { ps, setPs } = useProjectSettingsStore();
  const screenId = ps.activeScreen;
  const screensDevice = ps.screensDevice;
  const screensShowInspector = ps.screensShowInspector;
  const screensZoom = ps.screensZoom;
  const screensDarkPreview = ps.screensDarkPreview;
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("screens", 2);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("screens-inspector", 3, [true, true, screensShowInspector]);
  const [code, setCode] = useState("");

  const [themeCss, setThemeCss] = useState("");

  const { screensStatus, screensUrl, screensError, startScreens, stopScreens } = useDevServerStore();
  const previewIframeRef = useRef<HTMLIFrameElement>(null);
  const scaffoldAttemptedRef = useRef(false);
  const stoppedManuallyRef = useRef(false);
  const darkAtUrlArrival = useRef(screensDarkPreview);
  useEffect(() => { darkAtUrlArrival.current = screensDarkPreview; }, [screensDarkPreview]);
  const initialPreviewSrc = useMemo(
    () => (screensUrl ? `${screensUrl}?dark=${darkAtUrlArrival.current}` : undefined),
    [screensUrl]
  );

  const screenPreviewDir = getScreenPreviewDirPath(`projects/${settings.project}`);
  const generatedScreenDir = ps.directories.screens;
  const screenPath = screenId
    ? `projects/${settings.project}/generated/${generatedScreenDir}/${screenId}.tsx`
    : `projects/${settings.project}/screens/__placeholder__/screen.tsx`;

  const chatPath = screenId
    ? `projects/${settings.project}/screens/${screenId}/chat.json`
    : "projects/__placeholder__/chat.json";

  // Switch to update prompt after first generation
  const hasGeneratedCode = code.length > 0;
  const themeCssSection = themeCss
    ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties for all colors:\n\`\`\`css\n${themeCss}\n\`\`\``
    : "";
  const systemContent = hasGeneratedCode
    ? getScreenUpdatePrompt(settings.iconLibrary, code, settings.prompts["prompt.screens.update"] || undefined) + themeCssSection
    : getScreenNewPrompt(settings.iconLibrary, settings.prompts["prompt.screens.new"] || undefined) + themeCssSection;

  // Reset guards whenever the active project changes
  useEffect(() => {
    scaffoldAttemptedRef.current = false;
    stoppedManuallyRef.current = false;
  }, [settings.project]);

  // ─── Ensure screens dev server is running ────────────────────────────────────

  useEffect(() => {
    let cancelled = false;

    async function ensureScreensServer() {
      if (cancelled) return;
      if (screensStatus === "running" || screensStatus === "starting") return;
      if (stoppedManuallyRef.current) return;

      const isScaffolded = await hasScreenPreviewScaffold(`projects/${settings.project}`);
      if (cancelled) return;

      if (!isScaffolded) {
        if (scaffoldAttemptedRef.current) return;
        scaffoldAttemptedRef.current = true;

        useDevServerStore.getState().stopScreens();

        const ok = await confirm(
          "The screen preview needs a Vite project. Create one now?",
          { title: "Scaffold Required", kind: "info" }
        );
        if (!ok) return;
        if (cancelled) return;

        try {
          await withScaffoldNotifications(
            "scaffold-screen-preview",
            "Scaffolding screen preview",
            (onStep) => scaffoldScreenPreview(screenPreviewDir, settings.iconLibrary, onStep)
          );
        } catch {
          return;
        }
      } else {
        // Keep App.tsx up to date (fixes dark mode for existing projects via HMR)
        writeFile(`${screenPreviewDir}/${PROJECT_PATHS.SRC.APP_TSX}`, getScreenPreviewAppTsx()).catch(() => {});
      }

      if (cancelled) return;
      try {
        await startScreens(screenPreviewDir, ps.screensPreviewPort);
      } catch (e) {
        notify.error("Failed to start screen preview server", e instanceof Error ? e.message : String(e));
      }
    }

    ensureScreensServer();
    return () => { cancelled = true; };
  }, [settings.project, screensStatus, screenPreviewDir, startScreens, ps.screensPreviewPort, settings.iconLibrary]);

  // ─── Dark mode toggle → postMessage to iframe ─────────────────────────────

  useEffect(() => {
    const iframe = previewIframeRef.current;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage({ type: "set-dark", value: screensDarkPreview }, "*");
  }, [screensDarkPreview, screensUrl]);

  // ─── Write current screen to screen-preview when screenId or code changes ───

  const writeToScreenPreview = useCallback(async (content: string) => {
    if (!content) return;
    try {
      await createDir(`${screenPreviewDir}/${PROJECT_PATHS.SRC.COMPONENTS_DIR}`);
      await writeFile(`${screenPreviewDir}/${PROJECT_PATHS.SRC.GENERATED_TSX}`, content);
    } catch (e) {
      console.error("Failed to write to screen preview:", e);
    }
  }, [screenPreviewDir]);

  // Load existing screen code when screenId changes
  useEffect(() => {
    if (!screenId) { setCode(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const content = await readFile(screenPath);
        if (!cancelled && content) {
          setCode(content);
          await writeToScreenPreview(content);
        }
      } catch {
        if (!cancelled) setCode("");
      }
    })();
    return () => { cancelled = true; };
  }, [screenId, settings.project, screenPath, writeToScreenPreview]);

  const {
    messages, isStreaming, thinkingContent, input, setInput, sendMessage,
    stopGeneration, regenerate, clearChat, deleteFrom, attachments, addAttachment, removeAttachment,
    thinkEnabled, toggleThink, canThink, canVision,
    toolsEnabled, toggleTools, canTools,
    mentions, addMention, removeMention,
  } = useChat({
    entityId: screenId ? `screen-${screenId}` : "screen-none",
    chatPath,
    systemPrompt: systemContent,
    outputPath: screenId ? screenPath : undefined,
    onOutput: (content) => {
      setCode(content);
      const parentDir = screenPath.substring(0, screenPath.lastIndexOf("/"));
      createDir(parentDir)
        .then(() => writeFile(screenPath, content))
        .catch(() => {});
      writeToScreenPreview(content).catch(() => {});
    },
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
      } catch {
        if (!cancelled) setThemeCss("");
      }
    })();
    return () => { cancelled = true; };
  }, [ps.stylePreset, settings.project]);

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
      notify.error("Export failed", e instanceof Error ? e.message : String(e));
    }
  };

  const handleRetryPreview = () => {
    stoppedManuallyRef.current = false;
    scaffoldAttemptedRef.current = false;
    startScreens(screenPreviewDir, ps.screensPreviewPort).catch(() => {});
  };

  const renderPreview = () => {
    if (screensStatus === "error") {
      return (
        <div className="flex flex-col items-center justify-center gap-2 p-4 h-full text-center">
          <AlertCircle size={24} className="text-destructive" />
          <p className="text-xs font-medium text-destructive">Preview Error</p>
          <p className="text-[10px] text-muted-foreground max-w-full line-clamp-3">
            {screensError || "Failed to start dev server"}
          </p>
          <Button variant="outline" size="sm" className="h-6 text-[10px]" onClick={handleRetryPreview}>
            Retry
          </Button>
        </div>
      );
    }

    if (screensStatus === "starting") {
      return (
        <div className="flex flex-col items-center justify-center gap-2 h-full">
          <Loader2 size={20} className="animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Starting preview…</p>
        </div>
      );
    }

    if (screensStatus === "running" && screensUrl) {
      return (
        <iframe
          ref={previewIframeRef}
          src={initialPreviewSrc}
          className="w-full h-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
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
        onApplyCode={(content) => { const c = extractCode(content); if (c) { setCode(c); writeToScreenPreview(c).catch(() => {}); } }}
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
          placeholder="Describe your screen..."
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

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault} onVisibleChange={(i, v) => { if (i === 2) setPs({ screensShowInspector: v }); }}>
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
              <PromptInspector
                model={settings.modelId}
                messages={[
                  { role: "system", content: systemContent },
                  ...messages.map((m) => ({ role: m.role, content: m.content })),
                ]}
                host={getHostForProvider(settings.provider, settings.host)}
                provider={settings.provider}
              />
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <div className="h-full flex flex-col">
            <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
              <span className="text-sm font-medium">Preview</span>
              {screensStatus === "running" ? (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { stoppedManuallyRef.current = true; stopScreens(); }} title="Stop preview server">
                  <Square size={12} />
                </Button>
              ) : screensStatus === "starting" ? (
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled title="Starting preview…">
                  <Loader2 size={12} className="animate-spin" />
                </Button>
              ) : (
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => { stoppedManuallyRef.current = false; startScreens(screenPreviewDir, ps.screensPreviewPort); }} title="Start preview server">
                  <Play size={12} />
                </Button>
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
      </Allotment>
    </div>
  );
}
