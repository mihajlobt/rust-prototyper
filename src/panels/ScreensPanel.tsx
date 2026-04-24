import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Allotment } from "allotment";
import { Eye, Smartphone, Tablet, Monitor, Plus, Download } from "lucide-react";
import Frame from "react-frame-component";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { writeFile, createDir, readFile, readDir, exportProject, getModelHost } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useProjectStore } from "@/stores/projectStore";
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
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("screens", 2);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("screens-inspector", 2);
  const [screens, setScreens] = useState<string[]>(["main"]);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [previewHtml, setPreviewHtml] = useState("");
  const [showInspector, setShowInspector] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [links, setLinks] = useState<Array<{ selector: string; target: string }>>([]);
  const [showNewScreenDialog, setShowNewScreenDialog] = useState(false);
  const [newScreenName, setNewScreenName] = useState("");
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
    return createPreviewComponent(previewHtml, settings.iconLibrary);
  }, [previewHtml, settings.iconLibrary]);

  const {
    messages, isStreaming, input, setInput, sendMessage,
    clearChat, attachments, addAttachment, removeAttachment,
    mentions, addMention, removeMention,
  } = useChat({
    entityId: screenId ? `screen-${screenId}` : "screen-none",
    chatPath,
    systemPrompt: settings.prompts["screens-system"] || (
      getScreenNewPrompt(settings.iconLibrary) +
      (themeCss ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties for all colors:\n\`\`\`css\n${themeCss}\n\`\`\`` : "")
    ),
    onOutput: (content) => {
      const extracted = extractCode(content);
      if (extracted) {
        setPreviewHtml(extracted);
        createDir(screenPath.replace("/screen.tsx", ""))
          .then(() => writeFile(screenPath, extracted))
          .catch(() => {});
      }
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

  const handleCreateScreen = async () => {
    if (!newScreenName.trim()) return;
    const id = newScreenName.toLowerCase().replace(/\s+/g, "-");
    const dir = `projects/${settings.project}/screens/${id}`;
    await createDir(dir);
    await writeFile(`${dir}/chat.json`, "[]");
    await writeFile(`${dir}/screen.tsx`, `// ${newScreenName}\nexport default function ${id.replace(/-/g, "_")}() {\n  return <div>${newScreenName}</div>;\n}\n`);
    setScreens((prev) => [...prev, id]);
    setScreenId(id);
    setShowNewScreenDialog(false);
    setNewScreenName("");
  };

  const handlePreviewClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();

    if (!linkMode) {
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
      setLinkMode(false);
    }
  };

  const chatPane = (
    <div className="flex-1 overflow-hidden flex flex-col">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        onApplyCode={(content) => { const c = extractCode(content); if (c) setPreviewHtml(c); }}
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
        />
        <div className="flex items-center gap-1.5">
          <input
            type="checkbox"
            id="update-existing"
            checked={updateExisting}
            onChange={(e) => setUpdateExisting(e.target.checked)}
            className="h-3 w-3 rounded"
          />
          <label htmlFor="update-existing" className="text-[11px] text-muted-foreground cursor-pointer select-none">
            Update existing
          </label>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          {showInspector ? (
            <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault}>
              <Allotment.Pane minSize={200}>
                <div className="h-full flex flex-col bg-card">
                  <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
                    <span className="text-sm font-medium">Chat</span>
                    <Select value={screenId ?? undefined} onValueChange={setScreenId}>
                      <SelectTrigger className="h-7 text-xs w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {screens.map((s) => (
                          <SelectItem key={s} value={s}>{s}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <div className="flex-1" />
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowInspector(false)}>
                      <Eye size={12} />
                      Hide Inspector
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearChat}>
                      Clear
                    </Button>
                  </div>
                  {chatPane}
                </div>
              </Allotment.Pane>
              <Allotment.Pane preferredSize={240} minSize={160}>
                <PromptInspector
                  model={settings.modelId}
                  messages={messages.map((m) => ({ role: m.role, content: m.content }))}
                  host={getModelHost(settings.modelId, settings.host, settings.ollamaCloudModels, settings.apiKeys["ollama"])}
                />
              </Allotment.Pane>
            </Allotment>
          ) : (
            <div className="h-full flex flex-col bg-card">
              <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
                <span className="text-sm font-medium">Chat</span>
                {messages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                    {Math.ceil(messages.filter(m => m.role === "user").length)} turns
                  </span>
                )}
                <Select value={screenId ?? undefined} onValueChange={setScreenId}>
                  <SelectTrigger className="h-7 text-xs w-[120px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {screens.map((s) => (
                      <SelectItem key={s} value={s}>{s}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setShowNewScreenDialog(true)}>
                  <Plus size={12} />
                </Button>
                <div className="flex-1" />
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={handleExport}>
                  <Download size={12} />
                  Export
                </Button>
                <Button variant={linkMode ? "default" : "ghost"} size="sm" className="h-6 text-xs" onClick={() => setLinkMode(!linkMode)}>
                  {linkMode ? "Linking…" : "Link Mode"}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowInspector(true)}>
                  <Eye size={12} />
                  Inspector
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearChat}>
                  Clear
                </Button>
              </div>
              {chatPane}
            </div>
          )}
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <div className="h-full flex flex-col">
            <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
              <span className="text-sm font-medium">Preview</span>
              <div className="flex-1" />
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon" className="h-7 w-7 text-xs" onClick={() => setZoom((z) => Math.max(z - 0.1, 0.5))}>-</Button>
                <span className="text-xs text-muted-foreground w-8 text-center">{Math.round(zoom * 100)}%</span>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-xs" onClick={() => setZoom((z) => Math.min(z + 0.1, 2))}>+</Button>
              </div>
              <div className="flex items-center gap-1">
                <Button variant={device === "mobile" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setDevice("mobile")}>
                  <Smartphone size={12} />
                </Button>
                <Button variant={device === "tablet" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setDevice("tablet")}>
                  <Tablet size={12} />
                </Button>
                <Button variant={device === "desktop" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setDevice("desktop")}>
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
                  style={{ width: deviceWidth[device], transform: `scale(${zoom})`, transformOrigin: "top center" }}
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

      <Dialog open={showNewScreenDialog} onOpenChange={setShowNewScreenDialog}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>New Screen</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              value={newScreenName}
              onChange={(e) => setNewScreenName(e.target.value)}
              placeholder="Screen name..."
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateScreen();
              }}
              autoFocus
            />
            <Button className="w-full" onClick={handleCreateScreen} disabled={!newScreenName.trim()}>
              Create
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
