import { useState, useCallback, useRef, useEffect } from "react";
import { Allotment } from "allotment";
import { Send, Paperclip, ImageIcon, Smartphone, Tablet, Monitor, Eye, Plus, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
import { generateCompletionStream, getApiKey, writeFile, createDir, readFile, readDir, exportProject, type CompletionEvent, type Message } from "@/lib/ipc";
import { Channel } from "@tauri-apps/api/core";
import { useSettings } from "@/hooks/useSettings";
import { PromptInspector } from "@/components/PromptInspector";
import { save } from "@tauri-apps/plugin-dialog";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

function wordCount(text: string) {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function modelSupportsVision(modelId: string) {
  const lower = modelId.toLowerCase();
  return lower.includes("vision") || lower.includes("llava") || lower.includes("gpt-4o") || lower.includes("claude-3") || lower.includes("gemini");
}

export function ScreensPanel({ initialItem }: { initialItem?: string }) {
  const { settings } = useSettings();
  const [screenId, setScreenId] = useState(initialItem || "main");
  const [screens, setScreens] = useState<string[]>(["main"]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [previewHtml, setPreviewHtml] = useState("");
  const [showInspector, setShowInspector] = useState(false);
  const [linkMode, setLinkMode] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [attachments, setAttachments] = useState<Array<{ path: string; name: string; size?: number }>>([]);
  const [updateExisting, setUpdateExisting] = useState(true);
  const [links, setLinks] = useState<Array<{ selector: string; target: string }>>([]);
  const [showNewScreenDialog, setShowNewScreenDialog] = useState(false);
  const [newScreenName, setNewScreenName] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);

  const chatPath = `projects/${settings.project}/screens/${screenId}/chat.json`;
  const screenPath = `projects/${settings.project}/screens/${screenId}/screen.tsx`;
  const screenJsonPath = `projects/${settings.project}/screens/${screenId}/screen.json`;
  const attachmentsDir = `projects/${settings.project}/screens/${screenId}/attachments`;

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
        const data = await readFile(chatPath);
        if (!cancelled) setMessages(JSON.parse(data));
      } catch {
        if (!cancelled) setMessages([]);
      }
      try {
        const data = await readFile(screenJsonPath);
        const parsed = JSON.parse(data);
        if (!cancelled && parsed.links) setLinks(parsed.links);
      } catch {
        if (!cancelled) setLinks([]);
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project, screenId, chatPath, screenJsonPath]);

  const persistChat = useCallback(async (msgs: ChatMessage[]) => {
    try {
      await createDir(chatPath.replace("/chat.json", ""));
      await writeFile(chatPath, JSON.stringify(msgs, null, 2));
    } catch {
      // ignore
    }
  }, [chatPath]);

  const persistLinks = useCallback(async (newLinks: typeof links) => {
    try {
      await createDir(screenJsonPath.replace("/screen.json", ""));
      await writeFile(screenJsonPath, JSON.stringify({ links: newLinks }, null, 2));
    } catch {
      // ignore
    }
  }, [screenJsonPath]);

  const sendMessage = useCallback(async () => {
    if (!input.trim() || loading) return;
    const userMsg: ChatMessage = { role: "user", content: input.trim() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    await persistChat(nextMessages);
    setInput("");
    setLoading(true);

    const assistantMsg: ChatMessage = { role: "assistant", content: "" };
    const streamingMessages = [...nextMessages, assistantMsg];
    setMessages(streamingMessages);

    try {
      const customSystem = settings.prompts["screens-system"];
      const msgs: Message[] = [];
      if (customSystem) {
        msgs.push({ role: "system", content: customSystem });
      }
      for (const m of nextMessages) {
        msgs.push({ role: m.role, content: m.content });
      }
      if (attachments.length > 0) {
        const attachmentContext = `\n\n[User attached ${attachments.length} file(s): ${attachments.map((a) => a.name).join(", ")}]`;
        msgs[msgs.length - 1].content += attachmentContext;
      }

      const channel = new Channel<CompletionEvent>();
      let accumulated = "";
      channel.onmessage = (msg: CompletionEvent) => {
        if (msg.event === "Chunk") {
          accumulated += msg.data.text;
          setMessages([...nextMessages, { role: "assistant", content: accumulated }]);
        }
      };

      await generateCompletionStream(
        settings.modelId, msgs, settings.host,
        getApiKey(settings.modelId, settings.apiKeys),
        channel
      );

      const assistantContent = accumulated || "No response";
      const finalMessages = [...nextMessages, { role: "assistant" as const, content: assistantContent }];
      setMessages(finalMessages);
      await persistChat(finalMessages);
      if (assistantContent.includes("<") && assistantContent.includes(">")) {
        setPreviewHtml(assistantContent);
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
  }, [input, loading, messages, settings.modelId, settings.project, settings.prompts, persistChat, attachments, screenPath]);

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
          const filename = `paste-${Date.now()}.${file.name.split('.').pop() || 'png'}`;
          await createDir(attachmentsDir);
          await writeFile(`${attachmentsDir}/${filename}`, base64.split(',')[1]);
          setAttachments((prev) => [...prev, { path: `${attachmentsDir}/${filename}`, name: filename, size: file.size }]);
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
          const filename = `drop-${Date.now()}.${file.name.split('.').pop() || 'png'}`;
          await createDir(attachmentsDir);
          await writeFile(`${attachmentsDir}/${filename}`, base64.split(',')[1]);
          setAttachments((prev) => [...prev, { path: `${attachmentsDir}/${filename}`, name: file.name, size: file.size }]);
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
          const filename = `upload-${Date.now()}.${file.name.split('.').pop() || 'png'}`;
          await createDir(attachmentsDir);
          await writeFile(`${attachmentsDir}/${filename}`, base64.split(',')[1]);
          setAttachments((prev) => [...prev, { path: `${attachmentsDir}/${filename}`, name: file.name, size: file.size }]);
        };
        reader.readAsDataURL(file);
      }
    }
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
      alert(`Export failed: ${e instanceof Error ? e.message : String(e)}`);
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
                    <Select value={screenId} onValueChange={setScreenId}>
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
                          {loading && i === messages.length - 1 && msg.role === "assistant" && msg.content === "" ? (
                            <span className="flex items-center gap-1 text-muted-foreground text-xs">
                              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                              <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                              <span className="ml-1">thinking</span>
                            </span>
                          ) : (
                            <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                          )}
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                  <div className="px-3 pb-3 pt-2 border-t border-border shrink-0 space-y-2">
                    <div className="flex items-end gap-2">
                      <div className="flex gap-1">
                        <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileSelect} multiple />
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fileInputRef.current?.click()}>
                          <Paperclip size={14} />
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
                {messages.length > 0 && (
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                    {Math.ceil(messages.filter(m => m.role === "user").length)} turns
                  </span>
                )}
                <Select value={screenId} onValueChange={setScreenId}>
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
                      {loading && i === messages.length - 1 && msg.role === "assistant" && msg.content === "" ? (
                        <span className="flex items-center gap-1 text-muted-foreground text-xs">
                          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                          <span className="thinking-dot w-1.5 h-1.5 rounded-full bg-current inline-block" />
                          <span className="ml-1">thinking</span>
                        </span>
                      ) : (
                        <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                      )}
                    </div>
                  </div>
                ))}
                <div ref={messagesEndRef} />
              </div>
              <div className="px-3 pb-3 pt-2 border-t border-border shrink-0 space-y-2">
                {attachments.length > 0 && (
                  <div className="space-y-1">
                    {attachments.map((att, i) => (
                      <div key={i} className="flex items-center gap-2 bg-muted rounded px-2 py-1.5">
                        <ImageIcon size={12} className="text-muted-foreground shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-medium truncate">{att.name}</div>
                          {att.size && <div className="text-[10px] text-muted-foreground">{(att.size / 1024).toFixed(1)} KB</div>}
                        </div>
                        <button className="text-muted-foreground hover:text-foreground" onClick={() => setAttachments((prev) => prev.filter((_, j) => j !== i))}>
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                    {!modelSupportsVision(settings.modelId) && (
                      <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded px-2 py-1">
                        <ImageIcon size={10} />
                        Images ignored — <span className="font-medium">{settings.modelId.split(":")[0]}</span> doesn't support vision
                      </div>
                    )}
                  </div>
                )}
                <div className="flex items-end gap-2">
                  <div className="flex gap-1">
                    <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleFileSelect} multiple />
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => fileInputRef.current?.click()}>
                      <Paperclip size={14} />
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
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Button size="icon" className="h-8 w-8" onClick={sendMessage} disabled={loading}>
                      <Send size={14} />
                    </Button>
                    {input.trim() && (
                      <span className="text-[10px] text-muted-foreground">{wordCount(input)}w</span>
                    )}
                  </div>
                </div>
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