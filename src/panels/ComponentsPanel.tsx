import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Allotment } from "allotment";
import { Send, Smartphone, Tablet, Monitor, Save, Download, PackagePlus, ChevronUp, ChevronDown, Eye, Code2, Sun, Moon, Copy, Check } from "lucide-react";
import Frame from "react-frame-component";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateCompletionStream, getApiKey, getModelHost, writeFile, createDir, readDir, readFile, type CompletionEvent, type Message } from "@/lib/ipc";
import { Channel } from "@tauri-apps/api/core";
import { useAppStore } from "@/stores/appStore";
import { useProjectStore } from "@/stores/projectStore";
import { useComponentCode, useComponentChat } from "@/hooks/useProjectFiles";
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

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export function ComponentsPanel() {
  const { settings, setSettings } = useAppStore();
  const { activeComponent: selectedComponent, openComponent: setSelectedComponent } = useProjectStore();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [darkPreview, setDarkPreview] = useState(settings.dark ?? false);
  const [codeOpen, setCodeOpen] = useState(true);
  const [themes, setThemes] = useState<FileEntry[]>([]);
  const [selectedTheme, setSelectedTheme] = useState(settings.stylePreset || "");
  const [themeCss, setThemeCss] = useState("");
  const [copiedIndices, setCopiedIndices] = useState<Set<number>>(new Set());
  const [appliedIndices, setAppliedIndices] = useState<Set<number>>(new Set());
  const messagesEndRef = useRef<HTMLDivElement>(null);
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

  // Auto-scroll chat
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

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

  // Load selected component code + chat via TanStack Query
  const { data: loadedCode } = useComponentCode(settings.project, selectedComponent);
  const { data: loadedChat } = useComponentChat(settings.project, selectedComponent);

  useEffect(() => {
    if (loadedCode !== undefined) setCode(loadedCode);
  }, [loadedCode]);

  useEffect(() => {
    if (loadedChat !== undefined) setMessages(loadedChat);
  }, [loadedChat]);

  const persistChat = useCallback(async (msgs: ChatMessage[]) => {
    if (!selectedComponent) return;
    try {
      const base = `projects/${settings.project}/components/${selectedComponent}`;
      await createDir(base);
      await writeFile(`${base}/chat.json`, JSON.stringify(msgs, null, 2));
    } catch (e) {
      notify.error("Failed to save chat", e instanceof Error ? e.message : String(e));
    }
  }, [settings.project, selectedComponent]);

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

  const handleApplyMessage = useCallback((index: number, extracted: string) => {
    setAppliedIndices((prev) => new Set(prev).add(index));
    applyCode(extracted);
  }, [applyCode]);

  const handleCopyMessage = useCallback(async (index: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndices((prev) => new Set(prev).add(index));
      setTimeout(() => {
        setCopiedIndices((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      }, 2000);
    } catch {
      notify.error("Copy failed", "Could not copy to clipboard");
    }
  }, []);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setInput("");
    setLoading(true);

    // Add empty assistant message for streaming
    setMessages([...nextMessages, { role: "assistant", content: "" }]);

    try {
      const msgs: Message[] = [
        { role: "system", content: systemContent },
        ...nextMessages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const channel = new Channel<CompletionEvent>();
      let accumulated = "";
      channel.onmessage = (msg: CompletionEvent) => {
        if (msg.event === "Chunk") {
          accumulated += msg.data.text;
          setMessages([...nextMessages, { role: "assistant", content: accumulated }]);
        }
      };

      await generateCompletionStream(
        settings.modelId, msgs,
        getModelHost(settings.modelId, settings.host, settings.ollamaCloudModels, settings.apiKeys["ollama"]),
        getApiKey(settings.modelId, settings.apiKeys),
        channel
      );

      const assistantContent = accumulated || "No response";
      const finalMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content: assistantContent }];
      setMessages(finalMessages);
      await persistChat(finalMessages);

      // Auto-apply code if found
      const extracted = extractCode(assistantContent);
      if (extracted) {
        await applyCode(extracted);
      }
    } catch (e) {
      const errMessages: ChatMessage[] = [...nextMessages, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : String(e)}` }];
      setMessages(errMessages);
      await persistChat(errMessages);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, settings.modelId, settings.host, settings.apiKeys, systemContent, persistChat, applyCode]);

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
        <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setMessages([])}>
          Clear
        </Button>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {messages.length === 0 && (
          <div className="text-sm text-muted-foreground text-center mt-8">
            Describe the component you want to build
          </div>
        )}
        {messages.map((msg, i) => {
          const extracted = msg.role === "assistant" ? extractCode(msg.content) : null;
          const isStreaming = loading && i === messages.length - 1 && msg.role === "assistant";

          // Split assistant content into text + code blocks for display
          const parts = msg.role === "assistant"
            ? msg.content.split(/(```(?:tsx?|jsx?|javascript|typescript)?\n?[\s\S]*?```)/g)
            : null;

          return (
            <div
              key={i}
              className={["flex flex-col group", msg.role === "user" ? "items-end" : "items-start"].join(" ")}
            >
              <div
                className={[
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  msg.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground",
                ].join(" ")}
              >
                {isStreaming && msg.content === "" ? (
                  <span className="flex items-center gap-1 text-muted-foreground text-xs">
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                    <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                    <span className="ml-1">thinking…</span>
                  </span>
                ) : msg.role === "user" ? (
                  <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                ) : (
                  <div className="space-y-2">
                    {parts?.map((part, pi) => {
                      const isCodeBlock = /^```/.test(part);
                      if (isCodeBlock) {
                        const inner = part.replace(/^```(?:tsx?|jsx?|javascript|typescript)?\n?/, "").replace(/```$/, "").trim();
                        return (
                          <div key={pi} className="rounded border border-border bg-background/60 overflow-hidden">
                            <div className="flex items-center justify-between px-2 py-1 border-b border-border bg-muted/50">
                              <span className="text-[10px] text-muted-foreground font-mono">tsx</span>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-5 text-[10px] gap-1 px-1.5"
                                onClick={() => handleApplyMessage(i, inner)}
                              >
                                <Code2 size={10} />
                                Apply
                              </Button>
                            </div>
                            <pre className="text-xs font-mono p-2 overflow-x-auto whitespace-pre text-foreground/80 max-h-[200px]">{inner}</pre>
                          </div>
                        );
                      }
                      return part ? <pre key={pi} className="whitespace-pre-wrap font-sans">{part}</pre> : null;
                    })}
                  </div>
                )}
              </div>
              {/* Action bar for assistant messages */}
              {msg.role === "assistant" && !isStreaming && (
                <div className="flex items-center gap-0.5 mt-1 px-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 text-muted-foreground hover:text-foreground"
                    onClick={() => handleCopyMessage(i, msg.content)}
                    title="Copy message"
                  >
                    {copiedIndices.has(i) ? <Check size={10} className="text-emerald-500" /> : <Copy size={10} />}
                  </Button>
                  {extracted && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-foreground"
                      onClick={() => handleApplyMessage(i, extracted)}
                      title="Apply to editor and preview"
                    >
                      <Code2 size={10} />
                    </Button>
                  )}
                </div>
              )}
              {/* Show code-applied badge when user explicitly clicked Apply */}
              {appliedIndices.has(i) && (
                <span className="text-[10px] text-muted-foreground mt-0.5 px-1">
                  Code applied to editor
                </span>
              )}
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      <div className="px-3 pb-3 pt-2 border-t border-border shrink-0">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendMessage();
              }
            }}
            placeholder="Describe or refine your component…"
            className="min-h-[40px] max-h-[120px] text-sm resize-none"
            rows={1}
          />
          <Button size="icon" className="h-8 w-8 shrink-0" onClick={sendMessage} disabled={loading}>
            <Send size={14} />
          </Button>
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
