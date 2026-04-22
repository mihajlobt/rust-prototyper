import { useState, useCallback, useEffect, useRef } from "react";
import { Allotment, type AllotmentHandle } from "allotment";
import { Send, Smartphone, Tablet, Monitor, Save, Download, PackagePlus, RotateCw, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateCompletionStream, getApiKey, writeFile, createDir, readDir, readFile, type CompletionEvent, type Message } from "@/lib/ipc";
import { Channel } from "@tauri-apps/api/core";
import { useSettings } from "@/hooks/useSettings";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import { AddLibraryModal } from "@/modals/AddLibraryModal";
import type { FileEntry } from "@/lib/ipc";

function buildPreviewDoc(code: string, dark: boolean): string {
  // Strip TS types and import/export lines so the code runs in-browser via Babel
  const stripped = code
    .replace(/^import\s+.*?from\s+['"].*?['"]\s*;?\s*$/gm, "")
    .replace(/^export\s+default\s+/m, "const __DefaultExport = ")
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, "")
    .replace(/:\s*[A-Z][a-zA-Z<>\[\]|&,\s]+(?=[=,)\n{])/g, "");

  return `<!DOCTYPE html>
<html class="${dark ? "dark" : ""}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script src="https://unpkg.com/react@18/umd/react.development.js"></script>
<script src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
<script src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  body { margin: 0; background: ${dark ? "#0f0f0f" : "#ffffff"}; color: ${dark ? "#f1f5f9" : "#0f172a"}; font-family: system-ui, sans-serif; }
</style>
</head>
<body>
<div id="root" style="padding:16px"></div>
<script type="text/babel">
const { useState, useEffect, useCallback, useRef, useMemo } = React;
${stripped}
const __Comp = typeof __DefaultExport !== 'undefined' ? __DefaultExport : null;
if (__Comp) {
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(__Comp));
} else {
  document.getElementById('root').innerHTML = '<p style="color:#888">No default export found</p>';
}
</script>
</body>
</html>`;
}

export function ComponentsPanel() {
  const { settings, setSettings } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [codeOpen, setCodeOpen] = useState(true);
  const [themes, setThemes] = useState<FileEntry[]>([]);
  const [selectedTheme, setSelectedTheme] = useState(settings.stylePreset || "");
  const [savedComponents, setSavedComponents] = useState<FileEntry[]>([]);
  const [selectedComponent, setSelectedComponent] = useState("");
  const [previewKey, setPreviewKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
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

  const saveCode = useCallback(async (value: string) => {
    if (!value) return;
    const genDir = `projects/${settings.project}/generated`;
    await writeFile(`${genDir}/src/components/Generated.tsx`, value);
  }, [settings.project]);

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

  // Load themes
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

  // Load saved components
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const entries = await readDir(`projects/${settings.project}/components`);
        if (!cancelled) setSavedComponents(entries.filter((e) => e.is_dir));
      } catch {
        if (!cancelled) setSavedComponents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [settings.project]);

  // Load selected component
  useEffect(() => {
    if (!selectedComponent) return;
    let cancelled = false;
    (async () => {
      try {
        const content = await readFile(`projects/${settings.project}/components/${selectedComponent}/component.tsx`);
        if (!cancelled) setCode(content);
      } catch {
        // ignore
      }
    })();
    return () => { cancelled = true; };
  }, [selectedComponent, settings.project]);

  const generate = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    try {
      const themePrompt = selectedTheme
        ? ` Use the theme named "${selectedTheme}" for styling.`
        : "";
      const defaultSystem = `You are a React component generator. Generate only the component code in TSX format. No explanations, no markdown code blocks. Just raw code. Export the component as default.${themePrompt}`;
      const systemContent = settings.prompts["components-system"] || defaultSystem;
      const msgs: Message[] = [
        { role: "system", content: systemContent },
        { role: "user", content: prompt.trim() },
      ];

      const channel = new Channel<CompletionEvent>();
      let accumulated = "";
      channel.onmessage = (msg: CompletionEvent) => {
        if (msg.event === "Chunk") {
          accumulated += msg.data.text;
          setCode(accumulated.replace(/\`\`\`[a-z]*\n?/g, "").replace(/\`\`\`$/g, ""));
        }
      };

      await generateCompletionStream(
        settings.modelId, msgs, settings.host,
        getApiKey(settings.modelId, settings.apiKeys),
        channel
      );

      const clean = accumulated.replace(/\`\`\`[a-z]*\n?/g, "").replace(/\`\`\`$/g, "").trim();
      setCode(clean);
      const genDir = `projects/${settings.project}/generated`;
      await createDir(`${genDir}/src/components`);
      await writeFile(`${genDir}/src/components/Generated.tsx`, clean);
    } catch (e) {
      setCode(`// Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, settings.modelId, settings.project, settings.host, settings.apiKeys, settings.prompts, selectedTheme]);

  const handleRefreshPreview = () => {
    setPreviewKey((k) => k + 1);
  };

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  return (
    <div className="h-full flex flex-col">
      <Allotment>
        <Allotment.Pane minSize={300}>
          <div className="h-full flex flex-col bg-card">
            <div className="border-b border-border shrink-0">
              <div className="h-10 flex items-center px-3 gap-2">
                <span className="text-sm font-medium">Prompt</span>
                <div className="flex-1" />
                <AddLibraryModal trigger={
                  <Button variant="ghost" size="sm" className="h-6 text-xs gap-1">
                    <PackagePlus size={12} />
                    Add Lib
                  </Button>
                } />
              </div>
              <div className="flex items-center gap-2 px-3 pb-2">
                <Select value={selectedComponent} onValueChange={setSelectedComponent}>
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Load component…" />
                  </SelectTrigger>
                  <SelectContent>
                    {savedComponents.map((c) => (
                      <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select value={selectedTheme} onValueChange={(v) => { setSelectedTheme(v); setSettings({ stylePreset: v }); }}>
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue placeholder="Theme…" />
                  </SelectTrigger>
                  <SelectContent>
                    {themes.map((t) => (
                      <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-3">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Describe the component you want to generate..."
                className="h-full resize-none text-sm"
              />
            </div>
            <div className="p-3 border-t border-border shrink-0 flex gap-2">
              <Button className="gap-1 text-sm" onClick={generate} disabled={loading}>
                <Send size={14} />
                {loading ? "Generating…" : "Generate"}
              </Button>
              <SaveComponentModal code={code} prompt={prompt} trigger={
                <Button variant="outline" className="gap-1 text-sm" disabled={!code}>
                  <Save size={14} />
                  Save
                </Button>
              } />
              <ComponentExportModal componentId="Generated" trigger={
                <Button variant="outline" className="gap-1 text-sm" disabled={!code}>
                  <Download size={14} />
                  Export
                </Button>
              } />
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
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefreshPreview} title="Refresh">
                    <RotateCw size={12} />
                  </Button>
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
                      <iframe
                        key={previewKey}
                        ref={iframeRef}
                        srcDoc={buildPreviewDoc(code, settings.dark)}
                        className="w-full h-full"
                        sandbox="allow-scripts"
                        title="Component preview"
                      />
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
