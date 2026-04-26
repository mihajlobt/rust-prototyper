import { useState, useCallback, useEffect, useMemo } from "react";
import { Allotment } from "allotment";
import { Smartphone, Tablet, Monitor, Save, Download, ChevronUp, ChevronDown, Sun, Moon, Trash2 } from "lucide-react";
import Frame from "react-frame-component";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { writeFile, createDir, readDir, readFile, getModelHost } from "@/lib/ipc";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useAppStore } from "@/stores/appStore";
import { useProjectStore } from "@/stores/projectStore";
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
import { extractCode, createPreviewComponent, getParentCss, useIconFontCss } from "@/lib/preview";
import { PreviewErrorBoundary } from "@/components/PreviewErrorBoundary";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { useChat } from "@/hooks/useChat";
import { MessageList, ChatInput } from "@/components/chat";

export function ComponentsPanel() {
  const { settings, setSettings } = useAppStore();
  const { activeComponent: selectedComponent, openComponent: setSelectedComponent } = useProjectStore();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const componentsShowInspector = useUIStore((s) => s.componentsShowInspector);
  const componentsDevice = useUIStore((s) => s.componentsDevice);
  const componentsDarkPreview = useUIStore((s) => s.componentsDarkPreview);
  const componentsCodeOpen = useUIStore((s) => s.componentsCodeOpen);
  const [themes, setThemes] = useState<FileEntry[]>([]);
  const [selectedTheme, setSelectedTheme] = useState(settings.stylePreset || "");
  const [themeCss, setThemeCss] = useState("");
  const componentId = selectedComponent;
  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("components", 2);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("components-code", 3);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("components-inspector", 3);

  // Switch to update prompt after first generation — the model needs the current
  // code context to make targeted edits instead of generating from scratch.
  const hasGeneratedCode = code.length > 0;
  const defaultSystem = hasGeneratedCode
    ? getComponentUpdatePrompt(settings.iconLibrary, code) +
      (themeCss ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties for all colors:\n\`\`\`css\n${themeCss}\n\`\`\`` : "")
    : getComponentNewPrompt(settings.iconLibrary) +
      (themeCss ? `\n\nTHEME CSS VARIABLES — Use these exact CSS custom properties for all colors:\n\`\`\`css\n${themeCss}\n\`\`\`` : "");
  const systemContent = settings.prompts["components-system"] || defaultSystem;

  const parentCss = getParentCss();
  const iconFontCss = useIconFontCss(settings.iconLibrary, settings.project);
  const Preview = useMemo(() => {
    if (!code) return null;
    return createPreviewComponent(code);
  }, [code]);

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

  const componentOutputPath = componentId
    ? `projects/${settings.project}/components/${componentId}/component.tsx`
    : undefined;

  const {
    messages, isStreaming, thinkingContent, input, setInput, sendMessage,
    stopGeneration, regenerate, clearChat, deleteFrom, isToolMode, attachments, addAttachment, removeAttachment,
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
    useUIStore.setState({ componentsCodeOpen: true });
    try {
      const genDir = `projects/${settings.project}/generated`;
      await createDir(`${genDir}/src/components`);
      await writeFile(`${genDir}/src/components/Generated.tsx`, extracted);
      if (selectedComponent) {
        const compDir = `projects/${settings.project}/components/${selectedComponent}`;
        await createDir(compDir);
        await writeFile(`${compDir}/component.tsx`, extracted);
        queryClient.invalidateQueries({ queryKey: projectKeys.componentCode(settings.project, selectedComponent) });
      }
    } catch (e) {
      notify.error("Failed to apply generated code", e instanceof Error ? e.message : String(e));
    }
  }, [settings.project, selectedComponent, queryClient]);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const chatPane = (
    <div className="h-full flex flex-col bg-card">
      <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
        <span className="text-sm font-medium">Chat</span>
        {messages.length > 0 && (
          <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
            {messages.filter((m) => m.role === "user").length} turns
          </span>
        )}
        <div className="flex-1" />
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
        isToolMode={isToolMode}
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

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault}>
            <Allotment.Pane minSize={200}>
              {chatPane}
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <div
                className="h-full border-b border-border flex items-center px-3 bg-card cursor-pointer select-none hover:bg-muted transition-colors"
                onClick={() => useUIStore.setState({ componentsShowInspector: !componentsShowInspector })}
              >
                <span className="text-xs font-medium flex-1">Inspector</span>
                {componentsShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </div>
            </Allotment.Pane>
            <Allotment.Pane visible={componentsShowInspector} preferredSize={240} minSize={160}>
              {componentsShowInspector && (
                <PromptInspector
                  model={settings.modelId}
                  messages={[
                    { role: "system", content: systemContent },
                    ...messages.map((m) => ({ role: m.role, content: m.content })),
                  ]}
                  host={getModelHost(settings.modelId, settings.host, settings.ollamaCloudModels)}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical ref={codeRef} onDragEnd={codeOnDragEnd} defaultSizes={codeDefault}>
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
                  <span className="text-sm font-medium">Preview</span>
                  <div className="flex-1" />
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
                  <div className="w-px h-4 bg-border" />
                  <Button
                    variant={componentsDarkPreview ? "secondary" : "ghost"}
                    size="icon" className="h-7 w-7"
                    onClick={() => useUIStore.setState({ componentsDarkPreview: !componentsDarkPreview })}
                    title={componentsDarkPreview ? "Light preview" : "Dark preview"}
                  >
                    {componentsDarkPreview ? <Moon size={12} /> : <Sun size={12} />}
                  </Button>
                  <div className="w-px h-4 bg-border" />
                  <div className="flex items-center gap-1">
                    <Button
                      variant={componentsDevice === "mobile" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => useUIStore.setState({ componentsDevice: "mobile" })}
                    >
                      <Smartphone size={12} />
                    </Button>
                    <Button
                      variant={componentsDevice === "tablet" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => useUIStore.setState({ componentsDevice: "tablet" })}
                    >
                      <Tablet size={12} />
                    </Button>
                    <Button
                      variant={componentsDevice === "desktop" ? "secondary" : "ghost"}
                      size="icon" className="h-7 w-7"
                      onClick={() => useUIStore.setState({ componentsDevice: "desktop" })}
                    >
                      <Monitor size={12} />
                    </Button>
                  </div>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                  {code ? (
                    <div
                      className="h-full bg-background shadow-lg border border-border overflow-hidden"
                      style={{ width: deviceWidth[componentsDevice] }}
                    >
                      <Frame
                        key={selectedTheme}
                        head={
                          <style>{`${parentCss}\n${themeCss}\n${iconFontCss}\n.dark { color-scheme: dark; }\nbody { margin: 0; }`}</style>
                        }
                        className="w-full h-full border-0"
                      >
                        <div
                          className={componentsDarkPreview ? "dark" : ""}
                          style={{
                            minHeight: "100%",
                            background: "var(--background, #fff)",
                            color: "var(--foreground, #000)",
                          }}
                        >
                          {Preview ? (
                            <PreviewErrorBoundary resetKey={code}>
                              <Preview />
                            </PreviewErrorBoundary>
                          ) : null}
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

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <div
                className="h-full border-b border-border flex items-center px-3 bg-card cursor-pointer select-none hover:bg-muted transition-colors"
                onClick={() => useUIStore.setState({ componentsCodeOpen: !componentsCodeOpen })}
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
                {componentsCodeOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </div>
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
