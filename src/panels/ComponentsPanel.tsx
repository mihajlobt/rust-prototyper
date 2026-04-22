import { useState, useCallback } from "react";
import { Allotment } from "allotment";
import { Send, Smartphone, Tablet, Monitor, Save, Download, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { generateCompletion, getApiKey, writeFile, createDir } from "@/lib/ipc";
import { useSettings } from "@/hooks/useSettings";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { SaveComponentModal } from "@/modals/SaveComponentModal";
import { ComponentExportModal } from "@/modals/ComponentExportModal";
import { AddLibraryModal } from "@/modals/AddLibraryModal";

export function ComponentsPanel() {
  const { settings } = useSettings();
  const [prompt, setPrompt] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [device, setDevice] = useState<"desktop" | "tablet" | "mobile">("desktop");
  const [showCode, setShowCode] = useState(false);

  const generate = useCallback(async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    try {
      const msgs = [
        {
          role: "system",
          content: "You are a React component generator. Generate only the component code in TSX format. No explanations, no markdown code blocks. Just raw code.",
        },
        { role: "user", content: prompt.trim() },
      ];
      const response = await generateCompletion(settings.modelId, msgs, false, settings.host, getApiKey(settings.modelId, settings.apiKeys));
      const data = JSON.parse(response);
      const content = data.message?.content || data.response || response;
      const clean = content.replace(/```[a-z]*\n?/g, "").replace(/```$/g, "").trim();
      setCode(clean);
      // Auto-save to generated directory
      const genDir = `./projects/${settings.project}/generated/src/components`;
      await createDir(genDir);
      await writeFile(`${genDir}/Generated.tsx`, clean);
    } catch (e) {
      setCode(`// Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, [prompt, loading, settings.modelId, settings.project]);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const previewHtml = code
    ? `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body{margin:0;padding:16px;font-family:sans-serif;}</style>
</head>
<body>
  <div id="root"></div>
  <script type="module">
    import React from 'https://esm.sh/react@19';
    import ReactDOM from 'https://esm.sh/react-dom@19/client';
    ${code}
    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(React.createElement(Component));
  </script>
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
                      Generated components will preview here
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
                    <CodeMirrorEditor value={code} onChange={setCode} mode="tsx" />
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
