import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Smartphone, Tablet, Monitor, Download } from "lucide-react";
import Frame from "react-frame-component";
import { Button } from "@/components/ui/button";
import { writeFile, createDir, readFile, readDir, exportProject, getModelHost } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useProjectStore } from "@/stores/projectStore";
import { useUIStore } from "@/stores/uiStore";
import { notify } from "@/hooks/useToast";
import { PromptInspector } from "@/components/PromptInspector";
import { save } from "@tauri-apps/plugin-dialog";
import { getScreenNewPrompt } from "@/lib/prompts";
import { extractCode, createPreviewComponent, getParentCss, useIconFontCss } from "@/lib/preview";
import { useChat } from "@/hooks/useChat";
import { MessageList, ChatInput } from "@/components/chat";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";

export function ScreensPanel() {
  const { settings } = useAppStore();
  const { activeScreen: screenId, openScreen: setScreenId } = useProjectStore();
  const screensDevice = useUIStore((s) => s.screensDevice);
  const screensShowInspector = useUIStore((s) => s.screensShowInspector);
  const screensLinkMode = useUIStore((s) => s.screensLinkMode);
  const screensZoom = useUIStore((s) => s.screensZoom);
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("screens", 2);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("screens-inspector", 3);
  const [screens, setScreens] = useState<string[]>(["main"]);
  const [previewHtml, setPreviewHtml] = useState("");

  const [links, setLinks] = useState<Array<{ selector: string; target: string }>>([]);


  const [themeCss, setThemeCss] = useState("");
  const previewRef = useRef<HTMLDivElement>(null);

  const chatPath = screenId
    ? `projects/${settings.project}/screens/${screenId}/chat.json`
    : "projects/__placeholder__/chat.json";
  const screenPath = `projects/${settings.project}/screens/${screenId}/screen.tsx`;
  const screenJsonPath = `projects/${settings.project}/screens/${screenId}/screen.json`;

  const parentCss = getParentCss();
  const iconFontCss = useIconFontCss(settings.iconLibrary, settings.project);
  const Preview = useMemo(() => {
    if (!previewHtml) return null;
    return createPreviewComponent(previewHtml);
  }, [previewHtml, settings.iconLibrary]);

  const {
    messages, isStreaming, thinkingContent, input, setInput, sendMessage,
    stopGeneration, regenerate, clearChat, deleteFrom, isToolMode, attachments, addAttachment, removeAttachment,
    thinkEnabled, toggleThink, canThink, canVision,
    mentions, addMention, removeMention,
  } = useChat({
    entityId: screenId ? `screen-${screenId}` : "screen-none",
    chatPath,
    systemPrompt: settings.prompts["screens-system"] || (
      getScreenNewPrompt(settings.iconLibrary) +
      (themeCss ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties for all colors:\n\`\`\`css\n${themeCss}\n\`\`\`` : "")
    ),
    outputPath: screenId ? screenPath : undefined,
    onOutput: (content) => {
      setPreviewHtml(content);
      createDir(screenPath.replace("/screen.tsx", ""))
        .then(() => writeFile(screenPath, content))
        .catch(() => {});
    },
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await readDir(`projects/${settings.project}/screens`);
        const names = entries.filter((e) => e.is_dir).map((e) => e.name);
        if (!cancelled && names.length > 0) setScreens(names);
      } catch {
        // no screens yet
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await readFile(screenJsonPath);
        const parsed = JSON.parse(data);
        if (!cancelled && parsed.links) setLinks(parsed.links);
      } catch {
        if (!cancelled) setLinks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project, screenId, screenJsonPath]);

  useEffect(() => {
    const selectedTheme = settings.stylePreset;
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
  }, [settings.stylePreset, settings.project]);

  const persistLinks = useCallback(async (newLinks: typeof links) => {
    try {
      await createDir(screenJsonPath.replace("/screen.json", ""));
      await writeFile(screenJsonPath, JSON.stringify({ links: newLinks }, null, 2));
    } catch (e) {
      notify.error("Failed to save links", e instanceof Error ? e.message : String(e));
    }
  }, [screenJsonPath]);

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

  const handlePreviewClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

      if (!screensLinkMode) {
      for (const link of links) {
        const matchesSelector =
          (link.selector === tagName) ||
          (target.id && link.selector === target.id) ||
          (target.className && typeof target.className === "string" && link.selector === target.className) ||
          target.matches?.(link.selector);
        if (matchesSelector) {
          e.preventDefault();
          if (screens.includes(link.target)) {
            setScreenId(link.target);
          }
          return;
        }
      }
      return;
    }

    if (tagName === 'a' || tagName === 'button') {
      const selector = target.id || target.className || tagName;
      const newLink = { selector, target: target.getAttribute('href') || target.textContent || tagName };
      const nextLinks = [...links, newLink];
      setLinks(nextLinks);
      persistLinks(nextLinks);
      useUIStore.setState({ screensLinkMode: false });
    }
  };

  const chatPane = (
    <div className="flex-1 overflow-hidden flex flex-col">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        thinkingContent={thinkingContent}
        isToolMode={isToolMode}
        onApplyCode={(content) => { const c = extractCode(content); if (c) setPreviewHtml(c); }}
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
          onStop={stopGeneration}
        />

      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault}>
            <Allotment.Pane minSize={200}>
              <div className="h-full flex flex-col bg-card">
                <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
                  <span className="text-sm font-medium">Chat</span>
                  {messages.length > 0 && (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                      {Math.ceil(messages.filter(m => m.role === "user").length)} turns
                    </span>
                  )}
                  <div className="flex-1" />
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={handleExport}>
                    <Download size={12} />
                    Export
                  </Button>
                  <Button variant={screensLinkMode ? "default" : "ghost"} size="sm" className="h-6 text-xs" onClick={() => useUIStore.setState({ screensLinkMode: !screensLinkMode })}>
                    {screensLinkMode ? "Linking…" : "Link Mode"}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearChat}>
                    Clear
                  </Button>
                </div>
                {chatPane}
              </div>
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <div
                className="h-full border-b border-border flex items-center px-3 bg-card cursor-pointer select-none hover:bg-muted transition-colors"
                onClick={() => useUIStore.setState({ screensShowInspector: !screensShowInspector })}
              >
                <span className="text-xs font-medium flex-1">Inspector</span>
                {screensShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </div>
            </Allotment.Pane>
            <Allotment.Pane visible={screensShowInspector} preferredSize={240} minSize={160}>
              {screensShowInspector && (
                <PromptInspector
                  model={settings.modelId}
                  messages={messages.map((m) => ({ role: m.role, content: m.content }))}
                  host={getModelHost(settings.modelId, settings.host, settings.ollamaCloudModels)}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <div className="h-full flex flex-col">
            <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
              <span className="text-sm font-medium">Preview</span>
              <div className="flex-1" />
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-xs" onClick={() => useUIStore.setState({ screensZoom: Math.max(screensZoom - 0.1, 0.5) })}>-</Button>
                <span className="text-xs text-muted-foreground w-8 text-center">{Math.round(screensZoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-xs" onClick={() => useUIStore.setState({ screensZoom: Math.min(screensZoom + 0.1, 2) })}>+</Button>
              </div>
              <div className="flex items-center gap-1">
                <Button variant={screensDevice === "mobile" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => useUIStore.setState({ screensDevice: "mobile" })}>
                  <Smartphone size={12} />
                </Button>
                <Button variant={screensDevice === "tablet" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => useUIStore.setState({ screensDevice: "tablet" })}>
                  <Tablet size={12} />
                </Button>
                <Button variant={screensDevice === "desktop" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => useUIStore.setState({ screensDevice: "desktop" })}>
                  <Monitor size={12} />
                </Button>
              </div>
            </div>
            <div
              ref={previewRef}
              className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center"
              onDragOver={(e) => e.preventDefault()}
              onClick={handlePreviewClick}
            >
              {Preview ? (
                <div
                  className="h-full bg-background shadow-lg border border-border overflow-hidden"
                  style={{ width: deviceWidth[screensDevice], transform: `scale(${screensZoom})`, transformOrigin: "top center" }}
                >
                  <Frame
                    head={<style>{parentCss + themeCss + iconFontCss}</style>}
                    className="w-full h-full border-0"
                  >
                    <Preview />
                  </Frame>
                </div>
              ) : (
                <div className="flex items-center justify-center text-muted-foreground text-sm">
                  Generated screens will preview here
                </div>
              )}
            </div>
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
