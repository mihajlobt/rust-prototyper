import { useState, useCallback, useEffect } from "react";
import { Allotment } from "allotment";
import { Send, Smartphone, Tablet, Monitor, Save, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { generateCompletion, getApiKey, writeFile, createDir, readFile, parseAiResponse } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";

const THEME_CSS_PATH = "./projects/{project}/themes/main/theme.css";
const THEME_PROMPT_PATH = "./projects/{project}/themes/main/prompt.json";

export function ThemesPanel() {
  const { settings, setSettings } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [css, setCss] = useState("");
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [framework, setFramework] = useState<"shadcn" | "daisy" | "bootstrap" | "generic">("generic");
  const [presetName, setPresetName] = useState("");

  // Load persisted theme on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cssPath = THEME_CSS_PATH.replace("{project}", settings.project);
        const saved = await readFile(cssPath);
        if (!cancelled) setCss(saved);
      } catch {
        // no saved theme
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project]);

  const persistTheme = useCallback(async (content: string, p: string) => {
    try {
      const base = THEME_CSS_PATH.replace("{project}", settings.project).replace("/theme.css", "");
      await createDir(base);
      await writeFile(THEME_CSS_PATH.replace("{project}", settings.project), content);
      await writeFile(THEME_PROMPT_PATH.replace("{project}", settings.project), JSON.stringify({ prompt: p, updated: new Date().toISOString() }, null, 2));
    } catch {
      // ignore
    }
  }, [settings.project]);

  const frameworkPrompts: Record<string, string> = {
    shadcn: "Generate CSS custom properties compatible with shadcn/ui (using oklch colors): --background, --foreground, --card, --card-foreground, --popover, --popover-foreground, --primary, --primary-foreground, --secondary, --secondary-foreground, --muted, --muted-foreground, --accent, --accent-foreground, --destructive, --destructive-foreground, --border, --input, --ring, --radius.",
    daisy: "Generate CSS custom properties compatible with DaisyUI: --primary, --primary-content, --secondary, --secondary-content, --accent, --accent-content, --neutral, --neutral-content, --base-100, --base-200, --base-300, --base-content, --info, --info-content, --success, --success-content, --warning, --warning-content, --error, --error-content.",
    bootstrap: "Generate CSS custom properties compatible with Bootstrap 5: --bs-primary, --bs-secondary, --bs-success, --bs-info, --bs-warning, --bs-danger, --bs-light, --bs-dark, --bs-body-bg, --bs-body-color, --bs-border-color.",
    generic: "Generate CSS custom properties for a generic design system: --background, --foreground, --primary, --primary-foreground, --secondary, --secondary-foreground, --accent, --accent-foreground, --muted, --muted-foreground, --border, --radius.",
  };

  const generate = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    try {
      const msgs = [
        {
          role: "system",
          content: `You are a CSS theme generator. ${frameworkPrompts[framework]} No explanations, no markdown code blocks. Just raw CSS.`,
        },
        { role: "user", content: prompt.trim() },
      ];
      const response = await generateCompletion(settings.modelId, msgs, false, settings.host, getApiKey(settings.modelId, settings.apiKeys));
      const content = parseAiResponse(response);
      const clean = content.replace(/```[a-z]*\n?/g, "").replace(/```$/g, "").trim();
      setCss(clean);
      await persistTheme(clean, prompt);
    } catch (e) {
      setCss(`/* Error: ${e instanceof Error ? e.message : String(e)} */`);
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, settings.modelId, settings.apiKeys, framework, persistTheme]);

  const handleSaveCss = async () => {
    await persistTheme(css, prompt);
    // Also save as preset
    const next = [...settings.styles, { name: `Theme ${settings.styles.length + 1}`, value: css }];
    await setSettings({ styles: next });
  };

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const previewHtml = css
    ? `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    ${css}
    body{margin:0;padding:16px;font-family:sans-serif;background:var(--background,#fff);color:var(--foreground,#000);}
  </style>
</head>
<body>
  <div class="p-4 space-y-4">
    <h1 class="text-2xl font-bold">Theme Preview</h1>
    <button class="px-4 py-2 rounded" style="background:var(--primary,#333);color:var(--primary-foreground,#fff)">Primary Button</button>
    <button class="px-4 py-2 rounded" style="background:var(--secondary,#eee);color:var(--secondary-foreground,#333)">Secondary Button</button>
    <div class="p-4 rounded border" style="background:var(--card,#fff);border-color:var(--border,#ddd)">Card content</div>
    <p style="color:var(--muted-foreground,#666)">Muted text</p>
  </div>
</body>
</html>`
    : "";

  return (
    <div className="h-full flex flex-col">
      <Allotment>
        <Allotment.Pane minSize={300}>
          <div className="h-full flex flex-col bg-card">
            <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
              <span className="text-sm font-medium">Prompt</span>
              <div className="flex-1" />
              <div className="flex gap-1">
                {(["generic", "shadcn", "daisy", "bootstrap"] as const).map((f) => (
                  <Button
                    key={f}
                    variant={framework === f ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 text-[10px] capitalize"
                    onClick={() => setFramework(f)}
                  >
                    {f}
                  </Button>
                ))}
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
              <Button variant="outline" className="gap-1 text-sm" onClick={handleSaveCss} disabled={!css}>
                <Save size={14} />
                Save
              </Button>
            </div>
            <div className="px-3 pb-3 flex gap-2">
              <Input
                placeholder="Preset name..."
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="h-7 text-xs"
              />
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={async () => {
                if (!css || !presetName.trim()) return;
                const next = [...settings.styles, { name: presetName.trim(), value: css }];
                await setSettings({ styles: next });
                setPresetName("");
              }} disabled={!css || !presetName.trim()}>
                <Plus size={12} />
                Preset
              </Button>
            </div>
          </div>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical>
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
                </div>
                <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                  {previewHtml ? (
                    <div
                      className="h-full bg-background shadow-lg border border-border overflow-hidden"
                      style={{ width: deviceWidth[device] }}
                    >
                      <iframe srcDoc={previewHtml} className="w-full h-full" sandbox="allow-scripts" />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center text-muted-foreground text-sm">
                      Generated themes will preview here
                    </div>
                  )}
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane preferredSize={300}>
              <div className="h-full flex flex-col">
                <div className="h-8 border-b border-border flex items-center px-3 bg-card shrink-0">
                  <span className="text-xs font-medium">CSS Output</span>
                </div>
                <div className="flex-1 overflow-hidden">
                  <CodeMirrorEditor value={css} onChange={setCss} mode="css" />
                </div>
              </div>
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
