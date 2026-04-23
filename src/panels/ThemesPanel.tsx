import { useState, useCallback, useEffect, useRef } from "react";
import { Allotment, type AllotmentHandle } from "allotment";
import { Send, Smartphone, Tablet, Monitor, Save, ChevronUp, ChevronDown, FileCode, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { generateCompletionStream, getApiKey, getModelHost, writeFile, createDir, readFile, type CompletionEvent, type Message } from "@/lib/ipc";
import { Channel } from "@tauri-apps/api/core";
import { useSettings } from "@/hooks/useSettings";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { getThemeSystemPrompt } from "@/lib/prompts";
import { getParentCss } from "@/lib/preview";
import Frame from "react-frame-component";

export function ThemesPanel({ initialItem }: { initialItem?: string }) {
  const { settings } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [css, setCss] = useState("");
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [framework, setFramework] = useState<"shadcn" | "daisy" | "bootstrap" | "generic">("generic");
  const [darkLightSupport, setDarkLightSupport] = useState(true);
  const [darkPreview, setDarkPreview] = useState(false);
  const [selectedThemeDir, setSelectedThemeDir] = useState(initialItem || "main");

  // Sync selected theme when navigating from sidebar
  useEffect(() => {
    if (initialItem && initialItem !== selectedThemeDir) {
      setSelectedThemeDir(initialItem);
    }
  }, [initialItem]);
  const [codeOpen, setCodeOpen] = useState(true);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState("");
  const verticalAllotmentRef = useRef<AllotmentHandle>(null);
  const CODE_PANE_SIZE = 280;
  const CODE_HEADER = 28;

  const toggleCode = () => {
    if (codeOpen) {
      verticalAllotmentRef.current?.resize([9999, CODE_HEADER]);
      setCodeOpen(false);
    } else {
      verticalAllotmentRef.current?.resize([9999, CODE_PANE_SIZE]);
      setCodeOpen(true);
    }
  };

  // Load persisted theme on mount or when selectedThemeDir changes
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const themeDir = selectedThemeDir || "main";
        const cssPath = `projects/${settings.project}/themes/${themeDir}/theme.css`;
        const saved = await readFile(cssPath);
        if (!cancelled) setCss(saved);
      } catch {
        // no saved theme
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project, selectedThemeDir]);

  const persistTheme = useCallback(async (content: string, p: string, dirOverride?: string) => {
    try {
      const themeDir = dirOverride || selectedThemeDir || "main";
      const base = `projects/${settings.project}/themes/${themeDir}`;
      await createDir(base);
      await writeFile(`${base}/theme.css`, content);
      await writeFile(`${base}/prompt.json`, JSON.stringify({ prompt: p, updated: new Date().toISOString() }, null, 2));
    } catch {
      // ignore
    }
  }, [settings.project, selectedThemeDir]);

  const generate = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    try {
      const defaultSystem = getThemeSystemPrompt(framework) + (darkLightSupport ? "\n\nGenerate both :root (light) and .dark (dark mode) variants in the same CSS block." : "");
      const systemContent = settings.prompts["themes-system"] || defaultSystem;
      const msgs: Message[] = [
        { role: "system", content: systemContent },
        { role: "user", content: prompt.trim() },
      ];

      const channel = new Channel<CompletionEvent>();
      let accumulated = "";
      channel.onmessage = (msg: CompletionEvent) => {
        if (msg.event === "Chunk") {
          accumulated += msg.data.text;
          setCss(accumulated.replace(/```[a-z]*\n?/g, "").replace(/```$/g, ""));
        }
      };

      await generateCompletionStream(
        settings.modelId, msgs,
        getModelHost(settings.modelId, settings.host, settings.ollamaCloudModels, settings.apiKeys["ollama"]),
        getApiKey(settings.modelId, settings.apiKeys),
        channel
      );

      const clean = accumulated.replace(/```[a-z]*\n?/g, "").replace(/```$/g, "").trim();
      setCss(clean);
      await persistTheme(clean, prompt);
    } catch (e) {
      setCss(`/* Error: ${e instanceof Error ? e.message : String(e)} */`);
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, settings.modelId, settings.apiKeys, settings.prompts, framework, darkLightSupport, persistTheme]);

  const handleSaveConfirm = async () => {
    if (!saveDialogName.trim()) return;
    const slug = saveDialogName.trim().toLowerCase().replace(/\s+/g, "-");
    setSelectedThemeDir(slug);
    await persistTheme(css, prompt, slug);
    setShowSaveDialog(false);
    setSaveDialogName("");
  };

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const parentCss = getParentCss();

  return (
    <div className="h-full flex flex-col">
      <Allotment>
        <Allotment.Pane minSize={300}>
          <div className="h-full flex flex-col bg-card">
            <div className="border-b border-border shrink-0">
              <div className="h-10 flex items-center px-3 gap-2">
                <span className="text-sm font-medium">{selectedThemeDir}</span>
                <div className="flex-1" />
              </div>
              <div className="flex items-center gap-1 px-3 pb-2">
                <span className="text-[10px] text-muted-foreground mr-1">Framework</span>
                {(["generic", "shadcn", "daisy", "bootstrap"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFramework(f)}
                    className={[
                      "px-2.5 py-0.5 rounded text-[11px] border transition-colors capitalize",
                      framework === f
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {f}
                  </button>
                ))}
                <div className="w-px h-4 bg-border mx-1" />
                <button
                  onClick={() => setDarkLightSupport(!darkLightSupport)}
                  className={[
                    "px-2.5 py-0.5 rounded text-[11px] border transition-colors",
                    darkLightSupport
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="flex items-center gap-1"><Sun size={10} /><Moon size={10} /> Dark+Light</span>
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the theme you want to generate..."
                className="h-full resize-none text-sm"
              />
            </div>
            <div className="p-3 border-t border-border shrink-0 flex gap-2">
              <Button className="gap-1 text-sm" onClick={generate} disabled={loading}>
                <Send size={14} />
                {loading ? "Generating…" : "Generate"}
              </Button>
              <Button variant="outline" className="gap-1 text-sm" onClick={() => { setSaveDialogName(selectedThemeDir !== "main" ? selectedThemeDir : ""); setShowSaveDialog(true); }} disabled={!css}>
                <Save size={14} />
                Save as…
              </Button>
            </div>
          </div>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical ref={verticalAllotmentRef}>
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
                  <span className="text-sm font-medium">Preview</span>
                  <div className="flex-1" />
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
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button
                    variant={darkPreview ? "secondary" : "ghost"}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setDarkPreview(!darkPreview)}
                    title={darkPreview ? "Light preview" : "Dark preview"}
                  >
                    {darkPreview ? <Moon size={12} /> : <Sun size={12} />}
                  </Button>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                  {css ? (
                    <div
                      className="h-full bg-background shadow-lg border border-border overflow-hidden"
                      style={{ width: deviceWidth[device] }}
                    >
                      <Frame
                        key={selectedThemeDir}
                        className="w-full h-full border-0"
                        head={
                          <style>
                            {`${parentCss}
${css}
.dark { color-scheme: dark; }
body { margin: 0; font-family: sans-serif; }
* { box-sizing: border-box; }`}
                          </style>
                        }
                      >
                        <div
                          className={darkPreview ? "dark" : ""}
                          style={{
                            minHeight: "100%",
                            padding: 16,
                            background: "var(--background, #fff)",
                            color: "var(--foreground, #000)",
                          }}
                        >
                          <div className="p-4 space-y-4 max-w-lg">
                          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground, #000)' }}>Theme Preview</h1>
                          <p className="text-sm" style={{ color: 'var(--muted-foreground, #666)' }}>A visual overview of your theme's tokens.</p>

                          <div style={{ height: 1, background: 'var(--border, #ddd)' }} />
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground, #888)' }}>Buttons</p>
                          <div className="flex flex-wrap gap-2">
                            <button className="px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--primary, #333)', color: 'var(--primary-foreground, #fff)' }}>Primary</button>
                            <button className="px-4 py-2 rounded text-sm font-medium border" style={{ background: 'var(--secondary, #eee)', color: 'var(--secondary-foreground, #333)', borderColor: 'var(--border, #ddd)' }}>Secondary</button>
                            <button className="px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--accent, #e8f4fd)', color: 'var(--accent-foreground, #333)' }}>Accent</button>
                            <button className="px-4 py-2 rounded text-sm font-medium" style={{ background: 'var(--destructive, #e53e3e)', color: 'var(--destructive-foreground, #fff)' }}>Destructive</button>
                            <button className="px-4 py-2 rounded text-sm font-medium opacity-50 cursor-not-allowed" style={{ background: 'var(--muted, #f1f1f1)', color: 'var(--muted-foreground, #888)' }} disabled>Disabled</button>
                          </div>

                          <div style={{ height: 1, background: 'var(--border, #ddd)' }} />
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground, #888)' }}>Form</p>
                          <div className="flex flex-col gap-2 max-w-xs">
                            <label className="text-sm font-medium" style={{ color: 'var(--foreground, #000)' }}>Label</label>
                            <input className="px-3 py-2 rounded border text-sm w-full" style={{ background: 'var(--input, var(--background, #fff))', borderColor: 'var(--border, #ddd)', color: 'var(--foreground, #000)', outline: 'none' }} placeholder="Input field" />
                            <input className="px-3 py-2 rounded border text-sm w-full opacity-50" style={{ background: 'var(--input, var(--background, #fff))', borderColor: 'var(--border, #ddd)', color: 'var(--muted-foreground, #888)' }} placeholder="Disabled input" disabled />
                          </div>

                          <div style={{ height: 1, background: 'var(--border, #ddd)' }} />
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground, #888)' }}>Badges</p>
                          <div className="flex flex-wrap gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--primary, #333)', color: 'var(--primary-foreground, #fff)' }}>Primary</span>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--secondary, #eee)', color: 'var(--secondary-foreground, #333)' }}>Secondary</span>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--accent, #e8f4fd)', color: 'var(--accent-foreground, #333)' }}>Accent</span>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium" style={{ background: 'var(--destructive, #e53e3e)', color: 'var(--destructive-foreground, #fff)' }}>Danger</span>
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-medium border" style={{ background: 'transparent', color: 'var(--foreground, #000)', borderColor: 'var(--border, #ddd)' }}>Outline</span>
                          </div>

                          <div style={{ height: 1, background: 'var(--border, #ddd)' }} />
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground, #888)' }}>Cards</p>
                          <div className="rounded border p-4 space-y-2" style={{ background: 'var(--card, #fff)', borderColor: 'var(--border, #ddd)' }}>
                            <p className="font-semibold text-sm" style={{ color: 'var(--card-foreground, var(--foreground, #000))' }}>Card Title</p>
                            <p className="text-sm" style={{ color: 'var(--muted-foreground, #666)' }}>Card body text with muted foreground color.</p>
                            <button className="px-3 py-1.5 rounded text-xs font-medium" style={{ background: 'var(--primary, #333)', color: 'var(--primary-foreground, #fff)' }}>Action</button>
                          </div>

                          <div style={{ height: 1, background: 'var(--border, #ddd)' }} />
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground, #888)' }}>Alert</p>
                          <div className="rounded border p-3 text-sm" style={{ background: 'var(--accent, #e8f4fd)', borderColor: 'var(--border, #ddd)', color: 'var(--accent-foreground, #333)' }}>
                            <strong>Note:</strong> This is an informational alert using accent colors.
                          </div>
                          <div className="rounded border p-3 text-sm" style={{ background: 'var(--destructive, #fee2e2)', borderColor: 'var(--destructive, #e53e3e)', color: 'var(--destructive-foreground, #7f1d1d)' }}>
                            <strong>Error:</strong> This is a destructive/error alert.
                          </div>

                          <div style={{ height: 1, background: 'var(--border, #ddd)' }} />
                          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground, #888)' }}>Typography</p>
                          <h2 className="text-xl font-bold" style={{ color: 'var(--foreground, #000)' }}>Heading 2</h2>
                          <h3 className="text-lg font-semibold" style={{ color: 'var(--foreground, #000)' }}>Heading 3</h3>
                          <p className="text-sm" style={{ color: 'var(--foreground, #000)' }}>Body text at normal size.</p>
                          <p className="text-xs" style={{ color: 'var(--muted-foreground, #666)' }}>Muted small text for captions and hints.</p>
                        </div>
                      </div>
                    </Frame>
                    </div>
                  ) : (
                    <div className="flex items-center justify-center text-muted-foreground text-sm">
                      Generated themes will preview here
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
                  <FileCode size={12} className="mr-1.5" />
                  <span className="text-xs font-medium">CSS Output</span>
                  <div className="flex-1" />
                  {codeOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                </div>
                {codeOpen && (
                  <div className="flex-1 overflow-hidden">
                    <CodeMirrorEditor value={css} onChange={setCss} mode="css" />
                  </div>
                )}
              </div>
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>

      <Dialog open={showSaveDialog} onOpenChange={(o) => { if (!o) setShowSaveDialog(false); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Save Theme</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <Input
              placeholder="Theme name (e.g. ocean, dark-corporate)"
              value={saveDialogName}
              onChange={(e) => setSaveDialogName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleSaveConfirm(); }}
              autoFocus
            />
            <Button className="w-full" onClick={handleSaveConfirm} disabled={!saveDialogName.trim()}>
              Save
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
