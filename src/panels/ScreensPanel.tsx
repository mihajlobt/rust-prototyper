import { useState, useCallback, useRef, useEffect } from "react";
import { Allotment } from "allotment";
import { Send, Paperclip, Image, Smartphone, Tablet, Monitor, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { generateCompletion, getApiKey, writeFile, createDir, readFile } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";
import { PromptInspector } from "@/components/PromptInspector";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const CHAT_PATH = "./projects/{project}/screens/main/chat.json";
const SCREEN_PATH = "./projects/{project}/screens/main/screen.tsx";

export function ScreensPanel() {
  const { settings } = useSettings();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [previewHtml, setPreviewHtml] = useState("");
  const [showInspector, setShowInspector] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [attachments, setAttachments] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  // Load persisted chat on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const chatPath = CHAT_PATH.replace("{project}", settings.project);
        const data = await readFile(chatPath);
        if (!cancelled) setMessages(JSON.parse(data));
      } catch {
        // no saved chat yet
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project]);

  // Persist chat on change
  const persistChat = useCallback(async (msgs: ChatMessage[]) => {
    try {
      const chatPath = CHAT_PATH.replace("{project}", settings.project);
      await createDir(chatPath.replace("/chat.json", ""));
      await writeFile(chatPath, JSON.stringify(msgs, null, 2));
    } catch {
      // ignore
    }
  }, [settings.project]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    await persistChat(nextMessages);
    setInput("");
    setLoading(true);

    try {
      const msgs = nextMessages.map((m) => ({
        role: m.role,
        content: m.content,
      }));
      const response = await generateCompletion(settings.modelId, msgs, false, settings.host, getApiKey(settings.modelId, settings.apiKeys));
      const data = JSON.parse(response);
      const assistantContent = data.message?.content || data.response || response;
      const finalMessages = [...nextMessages, { role: "assistant" as const, content: assistantContent }];
      setMessages(finalMessages);
      await persistChat(finalMessages);
      if (assistantContent.includes("<") && assistantContent.includes(">")) {
        setPreviewHtml(assistantContent);
        // Save screen.tsx
        const screenPath = SCREEN_PATH.replace("{project}", settings.project);
        await createDir(screenPath.replace("/screen.tsx", ""));
        await writeFile(screenPath, assistantContent);
      }
    } catch (e) {
      const errMessages = [...nextMessages, { role: "assistant" as const, content: `Error: ${e instanceof Error ? e.message : String(e)}` }];
      setMessages(errMessages);
      await persistChat(errMessages);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, settings.modelId, settings.project, persistChat]);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          const project = settings.project;
          const dir = `./projects/${project}/screens/main/attachments`;
          const filename = `paste-${Date.now()}.${file.name.split('.').pop() || 'png'}`;
          await createDir(dir);
          await writeFile(`${dir}/${filename}`, base64.split(',')[1]);
          setAttachments((prev) => [...prev, `${dir}/${filename}`]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          const project = settings.project;
          const dir = `./projects/${project}/screens/main/attachments`;
          const filename = `drop-${Date.now()}.${file.name.split('.').pop() || 'png'}`;
          await createDir(dir);
          await writeFile(`${dir}/${filename}`, base64.split(',')[1]);
          setAttachments((prev) => [...prev, `${dir}/${filename}`]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    for (const file of files) {
      if (file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = async () => {
          const base64 = reader.result as string;
          const project = settings.project;
          const dir = `./projects/${project}/screens/main/attachments`;
          const filename = `upload-${Date.now()}.${file.name.split('.').pop() || 'png'}`;
          await createDir(dir);
          await writeFile(`${dir}/${filename}`, base64.split(',')[1]);
          setAttachments((prev) => [...prev, `${dir}/${filename}`]);
        };
        reader.readAsDataURL(file);
      }
    }
  };

  const handlePreviewClick = (e: React.MouseEvent) => {
    if (!linkMode) return;
    const target = e.target as HTMLElement;
    const tagName = target.tagName.toLowerCase();
    if (tagName === 'a' || tagName === 'button') {
      alert(`Linked: ${target.textContent || target.id || tagName}`);
      setLinkMode(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <Allotment>
        <Allotment.Pane minSize={300}>
          {showInspector ? (
            <Allotment vertical>
              <Allotment.Pane minSize={200}>
                <div className="h-full flex flex-col bg-card">
                  <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
                    <span className="text-sm font-medium">Chat</span>
                    <div className="flex-1" />
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowInspector(false)}>
                      <Eye size={12} />
                      Hide Inspector
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setMessages([]); persistChat([]); }}>
                      Clear
                    </Button>
                  </div>
                  <div className="flex-1 overflow-auto p-3 space-y-3">
                    {messages.length === 0 && (
                      <div className="text-sm text-muted-foreground text-center mt-8">
                        Describe the screen you want to build
                      </div>
                    )}
                    {messages.map((msg, i) => (
                      <div
                        key={i}
                        className={[
                          "flex",
                          msg.role === "user" ? "justify-end" : "justify-start",
                        ].join(" ")}
                      >
                        <div
                          className={[
                            "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                            msg.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted text-foreground",
                          ].join(" ")}
                        >
                          <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                        </div>
                      </div>
                    ))}
                    {loading && (
                      <div className="flex justify-start">
                        <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                          <span className="animate-pulse">Generating…</span>
                        </div>
                      </div>
                    )}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="p-3 border-t border-border shrink-0">
                    <div className="flex items-end gap-2">
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Paperclip size={14} />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <Image size={14} />
                        </Button>
                      </div>
                      <Textarea
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.shiftKey) {
                            e.preventDefault();
                            sendMessage();
                          }
                        }}
                        placeholder="Describe your screen..."
                        className="min-h-[40px] max-h-[120px] text-sm resize-none"
                        rows={1}
                      />
                      <Button size="icon" className="h-8 w-8 shrink-0" onClick={sendMessage} disabled={loading}>
                        <Send size={14} />
                      </Button>
                    </div>
                  </div>
                </div>
              </Allotment.Pane>
              <Allotment.Pane preferredSize={240} minSize={160}>
                <PromptInspector
                  model={settings.modelId}
                  messages={messages.map((m) => ({ role: m.role, content: m.content }))}
                  host={settings.host}
                />
              </Allotment.Pane>
            </Allotment>
          ) : (
            <div className="h-full flex flex-col bg-card">
              <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
                <span className="text-sm font-medium">Chat</span>
                <div className="flex-1" />
                <Button variant={linkMode ? "default" : "ghost"} size="sm" className="h-6 text-xs" onClick={() => setLinkMode(!linkMode)}>
                  {linkMode ? "Linking…" : "Link Mode"}
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1" onClick={() => setShowInspector(true)}>
                  <Eye size={12} />
                  Inspector
                </Button>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => { setMessages([]); persistChat([]); }}>
                  Clear
                </Button>
              </div>
              <div className="flex-1 overflow-auto p-3 space-y-3">
                {messages.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center mt-8">
                    Describe the screen you want to build
                  </div>
                )}
                {messages.map((msg, i) => (
                  <div
                    key={i}
                    className={[
                      "flex",
                      msg.role === "user" ? "justify-end" : "justify-start",
                    ].join(" ")}
                  >
                    <div
                      className={[
                        "max-w-[80%] rounded-lg px-3 py-2 text-sm",
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-foreground",
                      ].join(" ")}
                    >
                      <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                    </div>
                  </div>
                ))}
                {loading && (
                  <div className="flex justify-start">
                    <div className="bg-muted rounded-lg px-3 py-2 text-sm">
                      <span className="animate-pulse">Generating…</span>
                    </div>
                  </div>
                )}
                <div ref={messagesEndRef} />
              </div>
              <div className="p-3 border-t border-border shrink-0">
                {attachments.length > 0 && (
                  <div className="flex gap-1 mb-2 flex-wrap">
                    {attachments.map((att, i) => (
                      <span key={i} className="text-[10px] bg-muted px-1.5 py-0.5 rounded">{att.split("/").pop()}</span>
                    ))}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex gap-1">
                    <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileSelect} multiple />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fileInputRef.current?.click()}>
                      <Paperclip size={14} />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fileInputRef.current?.click()}>
                      <Image size={14} />
                    </Button>
                  </div>
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        sendMessage();
                      }
                    }}
                    onPaste={handlePaste}
                    placeholder="Describe your screen..."
                    className="min-h-[40px] max-h-[120px] text-sm resize-none"
                    rows={1}
                  />
                  <Button size="icon" className="h-8 w-8 shrink-0" onClick={sendMessage} disabled={loading}>
                    <Send size={14} />
                  </Button>
                </div>
              </div>
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
                <Button
                  variant={device === "mobile" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setDevice("mobile")}
                >
                  <Smartphone size={12} />
                </Button>
                <Button
                  variant={device === "tablet" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setDevice("tablet")}
                >
                  <Tablet size={12} />
                </Button>
                <Button
                  variant={device === "desktop" ? "secondary" : "ghost"}
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => setDevice("desktop")}
                >
                  <Monitor size={12} />
                </Button>
              </div>
            </div>
            <div
              ref={previewRef}
              className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center"
              onDrop={handleDrop}
              onDragOver={(e) => e.preventDefault()}
              onClick={handlePreviewClick}
            >
              {previewHtml ? (
                <div
                  className="h-full bg-background shadow-lg border border-border overflow-hidden"
                  style={{ width: deviceWidth[device], transform: `scale(${zoom})`, transformOrigin: "top center" }}
                >
                  <iframe
                    srcDoc={previewHtml}
                    className="w-full h-full"
                    sandbox="allow-scripts"
                  />
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
