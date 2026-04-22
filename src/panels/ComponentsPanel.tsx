import { useState, useCallback, useEffect, useRef } from "react";
import { Allotment } from "allotment";
import { Send, Smartphone, Tablet, Monitor, Save, Download, PackagePlus, Play, Square, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { generateCompletion, getApiKey, writeFile, createDir, readDir, readFile, parseAiResponse, bunDev, killProcess } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import { AddLibraryModal } from "@/modals/AddLibraryModal";
import type { FileEntry } from "@/lib/ipc";

const PREVIEW_PORT = 5173;

const PREVIEW_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Preview</title></head>
<body><div id="root"></div><script type="module" src="/src/preview.tsx"></script></body>
</html>`;

const PREVIEW_TSX = `import React from 'react';
import ReactDOM from 'react-dom/client';
import Component from './components/Generated';
const root = ReactDOM.createRoot(document.getElementById('root')!);
root.render(<Component />);
`;

export function ComponentsPanel() {
  const { settings } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [showCode, setShowCode] = useState(false);
  const [running, setRunning] = useState(false);
  const [themes, setThemes] = useState<FileEntry[]>([]);
  const [selectedTheme, setSelectedTheme] = useState("");
  const [savedComponents, setSavedComponents] = useState<FileEntry[]>([]);
  const [selectedComponent, setSelectedComponent] = useState("");
  const pidRef = useRef<number | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
      const msgs = [
        {
          role: "system",
          content: `You are a React component generator. Generate only the component code in TSX format. No explanations, no markdown code blocks. Just raw code. Export the component as default.${themePrompt}`,
        },
        { role: "user", content: prompt.trim() },
      ];
      const response = await generateCompletion(settings.modelId, msgs, settings.host, getApiKey(settings.modelId, settings.apiKeys));
      const content = parseAiResponse(response);
      const clean = content.replace(/\`\`\`[a-z]*\n?/g, "").replace(/\`\`\`$/g, "").trim();
      setCode(clean);
      // Auto-save to generated directory
      const genDir = `projects/${settings.project}/generated`;
      await createDir(`${genDir}/src/components`);
      await writeFile(`${genDir}/src/components/Generated.tsx`, clean);
      // Write preview files
      await writeFile(`${genDir}/preview.html`, PREVIEW_HTML);
      await writeFile(`${genDir}/src/preview.tsx`, PREVIEW_TSX);
    } catch (e) {
      setCode(`// Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, settings.modelId, settings.project, settings.host, settings.apiKeys, selectedTheme]);

  const handleRunPreview = async () => {
    if (running && pidRef.current) {
      await killProcess(pidRef.current);
      pidRef.current = null;
      setRunning(false);
      return;
    }
    // Kill previous process before starting new one
    if (pidRef.current) {
      await killProcess(pidRef.current);
      pidRef.current = null;
    }
    setRunning(true);
    const pid = await bunDev(`projects/${settings.project}/generated`, PREVIEW_PORT);
    pidRef.current = pid;
  };

  const handleRefreshPreview = () => {
    if (iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
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
            <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
              <span className="text-sm font-medium">Prompt</span>
              <div className="flex-1" />
              <Select value={selectedComponent} onValueChange={setSelectedComponent}>
                <SelectTrigger className="h-7 text-xs w-[140px]">
                  <SelectValue placeholder="Load component…" />
                </SelectTrigger>
                <SelectContent>
                  {savedComponents.map((c) => (
                    <SelectItem key={c.name} value={c.name}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selectedTheme} onValueChange={setSelectedTheme}>
                <SelectTrigger className="h-7 text-xs w-[140px]">
                  <SelectValue placeholder="Theme…" />
                </SelectTrigger>
                <SelectContent>
                  {themes.map((t) => (
                    <SelectItem key={t.name} value={t.name}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <AddLibraryModal trigger={
                <Button variant="ghost" size="sm" className="h-6 text-xs gap-1">
                  <PackagePlus size={12} />
                  Add Lib
                </Button>
              } />
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
              <Button variant="outline" className="gap-1 text-sm" onClick={() => setShowCode(!showCode)}>
                {showCode ? "Hide" : "Show"} Code
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
          <Allotment vertical>
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0 bg-card">
                  <span className="text-sm font-medium">Preview</span>
                  <div className="flex-1" />
                  <Button
                    variant={running ? "destructive" : "default"}
                    size="sm"
                    className="gap-1 h-7 text-xs"
                    onClick={handleRunPreview}
                  >
                    {running ? <Square size={12} /> : <Play size={12} />}
                    {running ? "Stop" : "Run"}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={handleRefreshPreview}>
                    <RotateCw size={12} />
                  </Button>
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
                  {running ? (
                    <div
                      className="h-full bg-background shadow-lg border border-border overflow-hidden"
                      style={{ width: deviceWidth[device] }}
                    >
                      <iframe
                        ref={iframeRef}
                        src={`http://localhost:${PREVIEW_PORT}/preview.html`}
                        className="w-full h-full"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center justify-center text-muted-foreground text-sm">
                      {code ? (
                        <div className="text-center">
                          <Play size={32} className="mx-auto mb-3 opacity-30" />
                          <p>Click Run to preview the component</p>
                          <p className="text-xs opacity-50 mt-1">Preview renders via localhost:5173</p>
                        </div>
                      ) : (
                        "Generated components will preview here"
                      )}
                    </div>
                  )}
                </div>
              </div>
            </Allotment.Pane>

            {showCode && (
              <Allotment.Pane preferredSize={300}>
                <div className="h-full flex flex-col">
                  <div className="h-8 border-b border-border flex items-center px-3 bg-card shrink-0">
                    <span className="text-xs font-medium">Code</span>
                  </div>
                  <div className="flex-1 overflow-hidden">
                    <CodeMirrorEditor value={code} onChange={handleCodeChange} onBlur={handleCodeBlur} mode="tsx" />
                  </div>
                </div>
              </Allotment.Pane>
            )}
          </Allotment>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
