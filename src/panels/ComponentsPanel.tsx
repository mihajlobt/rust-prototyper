import { useState, useCallback, useEffect, useMemo } from "react";
import { Allotment } from "allotment";
import { Smartphone, Tablet, Monitor, Save, Download, PackagePlus, ChevronUp, ChevronDown, Eye, Sun, Moon } from "lucide-react";
import Frame from "react-frame-component";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getModelHost, writeFile, createDir, readDir, readFile } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useProjectStore } from "@/stores/projectStore";
import { useComponentCode } from "@/hooks/useProjectFiles";
import { notify } from "@/hooks/useToast";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { PromptInspector } from "@/components/PromptInspector";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import { AddLibraryModal } from "@/modals/AddLibraryModal";
import type { FileEntry } from "@/lib/ipc";
import { getComponentNewPrompt } from "@/lib/prompts";
import { extractCode, createPreviewComponent, getParentCss, useIconFontCss } from "@/lib/preview";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { useChat } from "@/hooks/useChat";
import { MessageList, ChatInput } from "@/components/chat";

export function ComponentsPanel() {
  const { settings, setSettings } = useAppStore();
  const { activeComponent: selectedComponent, openComponent: setSelectedComponent } = useProjectStore();
  const [code, setCode] = useState("");
  const [showInspector, setShowInspector] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [darkPreview, setDarkPreview] = useState(settings.dark ?? false);
  const [codeOpen, setCodeOpen] = useState(true);
  const [themes, setThemes] = useState<FileEntry[]>([]);
  const [selectedTheme, setSelectedTheme] = useState(settings.stylePreset || "");
  const [themeCss, setThemeCss] = useState("");
  const componentId = selectedComponent;
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("components", 2);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("components-code", 2);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("components-inspector", 2);
  const CODE_PANE_SIZE = 280;
  const CODE_HEADER = 28;

  const defaultSystem = getComponentNewPrompt(settings.iconLibrary) +
    (themeCss ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties for all colors:\n\`\`\`css\n${themeCss}\n\`\`\`` : "");
  const systemContent = settings.prompts["components-system"] || defaultSystem;

  const parentCss = getParentCss();
  const iconFontCss = useIconFontCss(settings.iconLibrary, settings.project);
  const Preview = useMemo(() => {
    if (!code) return null;
    return createPreviewComponent(code, settings.iconLibrary);
  }, [code, settings.iconLibrary]);

  const toggleCode = () => {
    if (codeOpen) {
      codeRef.current?.resize([9999, CODE_HEADER]);
      setCodeOpen(false);
    } else {
      codeRef.current?.resize([9999, CODE_PANE_SIZE]);
      setCodeOpen(true);
    }
  };

  const saveCode = useCallback(async (value: string) => {
    if (!value) return;
    try {
      const genDir = `projects/${settings.project}/generated`;
      await writeFile(`${genDir}/src/components/Generated.tsx`, value);
      if (selectedComponent) {
        const compDir = `projects/${settings.project}/components/${selectedComponent}`;
        await createDir(compDir);
        await writeFile(`${compDir}/component.tsx`, value);
      }
    } catch (e) {
      notify.error("Failed to save generated code", e instanceof Error ? e.message : String(e));
    }
  }, [settings.project, selectedComponent]);

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
    if (loadedCode !== undefined) setCode(loadedCode);
  }, [loadedCode]);

  const chatPath = componentId
    ? `projects/${settings.project}/components/${componentId}/chat.json`
    : "projects/__placeholder__/chat.json";

  const {
    messages, isStreaming, input, setInput, sendMessage,
    clearChat, attachments, addAttachment, removeAttachment,
    mentions, addMention, removeMention,
  } = useChat({
    entityId: componentId ? `component-${componentId}` : "component-none",
    chatPath,
    systemPrompt: systemContent,
    onOutput: (content) => {
      const extracted = extractCode(content);
      if (extracted) applyCode(extracted);
    },
  });

  const applyCode = useCallback(async (extracted: string) => {
    setCode(extracted);
    try {
      const genDir = `projects/${settings.project}/generated`;
      await createDir(`${genDir}/src/components`);
      await writeFile(`${genDir}/src/components/Generated.tsx`, extracted);
      if (selectedComponent) {
        const compDir = `projects/${settings.project}/components/${selectedComponent}`;
        await createDir(compDir);
        await writeFile(`${compDir}/component.tsx`, extracted);
      }
    } catch (e) {
      notify.error("Failed to apply generated code", e instanceof Error ? e.message : String(e));
    }
  }, [settings.project, selectedComponent]);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const chatPane = (hideInspector: boolean) => (
    <div className="h-full flex flex-col bg-card">
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
        <span className="text-sm font-medium">Chat</span>
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {messages.filter((m) => m.role === "user").length} turns
          </span>
        )}
        <div className="flex-1" />
        {hideInspector ? (
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowInspector(false)}>
            <Eye size={12} />
            Hide Inspector
          </Button>
        ) : (
          <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowInspector(true)}>
            <Eye size={12} />
            Inspector
          </Button>
        )}
        <div className="flex items-center gap-1">
          <Select value={selectedTheme} onValueChange={(v) => { setSelectedTheme(v); setSettings({ stylePreset: v }); }}>
            <SelectTrigger className="h-6 text-xs w-[90px]">
              <SelectValue placeholder="Theme…" />
            </SelectTrigger>
            <SelectContent>
              {themes.map((t) => (
                <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <AddLibraryModal trigger={
            <Button variant="ghost" size="icon" className="h-6 w-6">
              <PackagePlus size={12} />
            </Button>
          } />
        </div>
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearChat}>
          Clear
        </Button>
      </div>

      <MessageList messages={messages} isStreaming={isStreaming} />
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
      />
    </div>
  );

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          {showInspector ? (
            <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault}>
              <Allotment.Pane minSize={200}>
                {chatPane(true)}
              </Allotment.Pane>
              <Allotment.Pane preferredSize={240} minSize={160}>
                <PromptInspector
                  model={settings.modelId}
                  messages={[
                    { role: "system", content: systemContent },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                  ]}
                  host={getModelHost(settings.modelId, settings.host, settings.ollamaCloudModels, settings.apiKeys["ollama"])}
                />
              </Allotment.Pane>
            </Allotment>
          ) : (
            chatPane(false)
          )}
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical ref={codeRef} onDragEnd={codeOnDragEnd} defaultSizes={codeDefault}>
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
                  <span className="text-sm font-medium">Preview</span>
                  <div className="flex-1" />

                  <Button
                    variant={darkPreview ? "secondary" : "ghost"}
                    size="icon" className="h-7 w-7"
                    onClick={() => setDarkPreview((d) => !d)}
                    title={darkPreview ? "Light preview" : "Dark preview"}
                  >
                    {darkPreview ? <Moon size={12} /> : <Sun size={12} />}
                  </Button>
                  <div className="w-px h-4 bg-border" />
                  <div className="flex items-center gap-1">
                    <Button
                      variant={device === "mobile" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => setDevice("mobile")}
                    >
                      <Smartphone size={12} />
                    </Button>
                    <Button
                      variant={device === "tablet" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => setDevice("tablet")}
                    >
                      <Tablet size={12} />
                    </Button>
                    <Button
                      variant={device === "desktop" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => setDevice("desktop")}
                    >
                      <Monitor size={12} />
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                  {code ? (
                    <div
                      className="h-full bg-background shadow-lg border border-border overflow-hidden"
                      style={{ width: deviceWidth[device] }}
                    >
                      <Frame
                        head={<style>{parentCss + themeCss + iconFontCss}</style>}
                        className="w-full h-full border-0"
                      >
                        <div className={darkPreview ? "dark" : ""} style={{ minHeight: "100%" }}>
                          {Preview ? <Preview /> : null}
                        </div>
                      </Frame>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center text-muted-foreground text-sm">
                      Generated components will preview here
                    </div>
                  )}
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane preferredSize={CODE_PANE_SIZE} minSize={CODE_HEADER}>
              <div className="h-full flex flex-col">
                <div
                  className="h-7 border-b border-border flex items-center px-3 bg-card shrink-0 cursor-pointer select-none hover:bg-muted transition-colors"
                  onClick={toggleCode}
                >
                  <span className="text-xs font-medium flex-1">Code</span>
                  <div className="flex items-center gap-1 mr-1">
                    <SaveComponentModal
                      code={code}
                      prompt={messages.find(m => m.role === "user")?.content ?? ""}
                      messages={messages}
                      onSaved={(id) => {
                        setSelectedComponent(id);
                        window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "components" } }));
                      }}
                      trigger={
                        <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-1 px-1.5" onClick={(e) => e.stopPropagation()} disabled={!code}>
                          <Save size={10} />
                          Save
                        </Button>
                      }
                    />
                    <ComponentExportModal componentId="Generated" trigger={
                      <Button variant="ghost" size="sm" className="h-5 text-[10px] gap-1 px-1.5" onClick={(e) => e.stopPropagation()} disabled={!code}>
                        <Download size={10} />
                        Export
                      </Button>
                    } />
                  </div>
                  {codeOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                </div>
                <div className="flex-1 overflow-hidden">
                  <CodeMirrorEditor value={code} onChange={handleCodeChange} onBlur={handleCodeBlur} mode="tsx" />
                </div>
              </div>
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
