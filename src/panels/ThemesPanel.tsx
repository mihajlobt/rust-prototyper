import { useState, useCallback, useEffect } from "react";
import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Smartphone, Tablet, Monitor, Save, FileCode, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { writeFile, createDir, getHostForProvider } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useChat } from "@/hooks/useChat";
import { MessageList, ChatInput } from "@/components/chat";
import { useProjectStore } from "@/stores/projectStore";
import { useUIStore } from "@/stores/uiStore";
import { useThemeCss } from "@/hooks/useProjectFiles";
import { notify } from "@/hooks/useToast";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { getThemeSystemPrompt } from "@/lib/prompts";
import { getParentCss } from "@/lib/preview";
import { PromptInspector } from "@/components/PromptInspector";
import Frame from "react-frame-component";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";

export function ThemesPanel() {
  const { settings } = useAppStore();
  const { activeTheme: selectedThemeDir, openTheme: setSelectedThemeDir } = useProjectStore();
  const [css, setCss] = useState("");
  const themesDevice = useUIStore((s) => s.themesDevice);
  const themesFramework = useUIStore((s) => s.themesFramework);
  const themesDarkLightSupport = useUIStore((s) => s.themesDarkLightSupport);
  const themesDarkPreview = useUIStore((s) => s.themesDarkPreview);
  const themesCodeOpen = useUIStore((s) => s.themesCodeOpen);
  const themesShowInspector = useUIStore((s) => s.themesShowInspector);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState("");
  const chatPath = selectedThemeDir
    ? `projects/${settings.project}/themes/${selectedThemeDir}/chat.json`
    : "projects/__placeholder__/chat.json";

  const themeOutputPath = selectedThemeDir
    ? `projects/${settings.project}/themes/${selectedThemeDir}/theme.css`
    : undefined;

  const persistTheme = useCallback(async (content: string, p: string, dirOverride?: string) => {
    try {
      const themeDir = dirOverride || selectedThemeDir || "main";
      const base = `projects/${settings.project}/themes/${themeDir}`;
      await createDir(base);
      await writeFile(`${base}/theme.css`, content);
      await writeFile(`${base}/prompt.json`, JSON.stringify({ prompt: p, updated: new Date().toISOString() }, null, 2));
    } catch (e) {
      notify.error("Failed to save theme", e instanceof Error ? e.message : String(e));
    }
  }, [settings.project, selectedThemeDir]);

  const {
    messages, isStreaming, thinkingContent, input, setInput, sendMessage,
    stopGeneration, regenerate, deleteFrom, attachments, addAttachment, removeAttachment,
    mentions, addMention, removeMention,
    thinkEnabled, toggleThink, canThink, canVision,
    toolsEnabled, toggleTools, canTools,
  } = useChat({
    entityId: selectedThemeDir ? `theme-${selectedThemeDir}` : "theme-none",
    chatPath,
    systemPrompt: settings.prompts["themes-system"] || (
      getThemeSystemPrompt(themesFramework) +
      (themesDarkLightSupport
        ? "\n\nGenerate both :root (light) and .dark (dark mode) variants in the same CSS block."
        : "")
    ),
    outputPath: themeOutputPath,
    onOutput: (content) => {
      // Same extraction as the Apply button: strip fences, keep only the CSS block
      const cleaned = content
        .replace(/^```(?:css)?\s*/i, "")
        .replace(/\s*```[\s\S]*$/i, "")  // strip closing fence + anything after it (summaries)
        .trim();
      const css = cleaned || content.trim();
      setCss(css);
      persistTheme(css, "").catch(() => {});
      useUIStore.setState({ themesCodeOpen: true });
    },
  });

  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("themes", 2);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("themes-code", 3);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("themes-inspector", 3);

  // Load persisted theme via TanStack Query
  const { data: loadedCss } = useThemeCss(settings.project, selectedThemeDir);

  useEffect(() => {
    if (loadedCss !== undefined) setCss(loadedCss);
  }, [loadedCss]);

  const handleSaveConfirm = async () => {
    if (!saveDialogName.trim()) return;
    const slug = saveDialogName.trim().toLowerCase().replace(/\s+/g, "-");
    setSelectedThemeDir(slug);
    await persistTheme(css, "", slug);
    setShowSaveDialog(false);
    setSaveDialogName("");
    window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "themes" } }));
  };

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const parentCss = getParentCss();

  const chatPane = (
    <div className="flex-1 overflow-hidden flex flex-col">
      <MessageList
        messages={messages}
        isStreaming={isStreaming}
        thinkingContent={thinkingContent}
        onApplyCode={(content) => {
          const stripped = content.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
          const cleaned = stripped.replace(/^```(?:css)?\s*/i, "").replace(/\s*```$/i, "").trim();
          if (cleaned) setCss(cleaned);
        }}
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
          placeholder="Describe the theme you want…"
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

  const frameworkPills = (
    <>
      {(["generic", "shadcn", "daisy", "bootstrap"] as const).map((f) => (
        <button
          key={f}
          onClick={() => useUIStore.setState({ themesFramework: f })}
          className={[
            "px-1.5 py-0.5 rounded text-[10px] border transition-colors",
            themesFramework === f
              ? "bg-primary text-primary-foreground border-primary"
              : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
          ].join(" ")}
        >
          {f === "bootstrap" ? "BS" : f === "generic" ? "Gen" : f === "shadcn" ? "shadcn" : "Daisy"}
        </button>
      ))}
      <div className="w-px h-3.5 bg-border mx-0.5" />
      <button
        onClick={() => useUIStore.setState({ themesDarkLightSupport: !themesDarkLightSupport })}
        className={[
          "flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] border transition-colors",
          themesDarkLightSupport
            ? "bg-primary text-primary-foreground border-primary"
            : "border-border hover:bg-muted text-muted-foreground hover:text-foreground",
        ].join(" ")}
        title="Generate dark + light mode variants"
      >
        <Sun size={9} /><Moon size={9} />
      </button>
    </>
  );

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault}>
            <Allotment.Pane minSize={200}>
              <div className="h-full flex flex-col bg-card">
                <div className="h-10 border-b border-border flex items-center px-3 gap-2 shrink-0">
                  {frameworkPills}
                  <div className="flex-1" />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => { setSaveDialogName(selectedThemeDir && selectedThemeDir !== "main" ? selectedThemeDir : ""); setShowSaveDialog(true); }}
                    disabled={!css}
                    title="Save as…"
                  >
                    <Save size={12} />
                  </Button>
                </div>
                {chatPane}
              </div>
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <div
                className="h-full border-b border-border flex items-center px-3 bg-card cursor-pointer select-none hover:bg-muted transition-colors"
                onClick={() => useUIStore.setState({ themesShowInspector: !themesShowInspector })}
              >
                <span className="text-xs font-medium flex-1">Inspector</span>
                {themesShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </div>
            </Allotment.Pane>
            <Allotment.Pane visible={themesShowInspector} preferredSize={240} minSize={160}>
              {themesShowInspector && (
                <PromptInspector
                  model={settings.modelId}
                  messages={messages.map((m) => ({ role: m.role, content: m.content }))}
                  host={getHostForProvider(settings.provider, settings.host)}
                  provider={settings.provider}
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
                  <div className="flex items-center gap-1">
                    <Button
                      variant={themesDevice === "mobile" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => useUIStore.setState({ themesDevice: "mobile" })}
                    >
                      <Smartphone size={12} />
                    </Button>
                    <Button
                      variant={themesDevice === "tablet" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => useUIStore.setState({ themesDevice: "tablet" })}
                    >
                      <Tablet size={12} />
                    </Button>
                    <Button
                      variant={themesDevice === "desktop" ? "secondary" : "ghost"}
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => useUIStore.setState({ themesDevice: "desktop" })}
                    >
                      <Monitor size={12} />
                    </Button>
                  </div>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button
                    variant={themesDarkPreview ? "secondary" : "ghost"}
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => useUIStore.setState({ themesDarkPreview: !themesDarkPreview })}
                    title={themesDarkPreview ? "Light preview" : "Dark preview"}
                  >
                    {themesDarkPreview ? <Moon size={12} /> : <Sun size={12} />}
                  </Button>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                  {css ? (
                    <div
                      className="h-full bg-background shadow-lg border border-border overflow-hidden"
                      style={{ width: deviceWidth[themesDevice] }}
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
                          className={themesDarkPreview ? "dark" : ""}
                          style={{
                            minHeight: "100%",
                            padding: 16,
                            background: "var(--background, #fff)",
                            color: "var(--foreground, #000)",
                          }}
                        >
                          <div className="p-4 space-y-4 max-w-lg">
                          <h1 className="text-2xl font-bold" style={{ color: 'var(--foreground, #000)' }}>Theme Preview</h1>
                          <p className="text-sm" style={{ color: 'var(--muted-foreground, #666)' }}>{"A visual overview of your theme\u2019s tokens."}</p>

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

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <div
                className="h-full border-b border-border flex items-center px-3 bg-card cursor-pointer select-none hover:bg-muted transition-colors"
                onClick={() => useUIStore.setState({ themesCodeOpen: !themesCodeOpen })}
              >
                <FileCode size={12} className="mr-1.5" />
                <span className="text-xs font-medium">CSS Output</span>
                <div className="flex-1" />
                {themesCodeOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              </div>
            </Allotment.Pane>
            <Allotment.Pane visible={themesCodeOpen} preferredSize={252} minSize={100}>
              <div className="h-full overflow-hidden">
                <CodeMirrorEditor value={css} onChange={setCss} mode="css" />
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
