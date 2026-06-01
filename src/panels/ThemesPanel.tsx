import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Save, FolderUp, Trash2, RefreshCw, Braces, Sliders, Palette } from "lucide-react";
import { toast } from "sonner";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { writeFile, readFile, createDir, getHostForProvider, getErrorMessage, type ToolPermissionDecision } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { projectKeys } from "@/lib/queryKeys";
import { saveItemMeta } from "@/lib/item-meta";
import { getGeneratedDirPath } from "@/lib/scaffold-shadcn";
import { designLanguageSpecSchema } from "@/lib/design/spec";
import { useAppStore } from "@/stores/appStore";
import { DESIGN_BRIEF_TEMPLATES, type DesignBriefTemplate } from "@/lib/prompts";
import { getDesignLanguageSystemPrompt } from "@/lib/prompts/themes";
import { ThemeChatPanel } from "@/panels/ThemeChatPanel";
import { ThemePreviewToolbar } from "@/panels/ThemePreviewToolbar";
import { ThemeFrameworkPills } from "@/panels/ThemeFrameworkPills";
import { ThemeCodeTabs } from "@/panels/ThemeCodeTabs";
import { useChat } from "@/hooks/useChat";
import { useChatStore } from "@/stores/chatStore";

import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useThemeCss } from "@/hooks/useProjectFiles";
import { notify } from "@/hooks/useToast";
import { getThemeSystemPrompt, outputFilePathSection } from "@/lib/prompts";
import { getParentCss } from "@/lib/preview";
import { PromptInspector } from "@/components/PromptInspector";
import Frame from "react-frame-component";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { PaneHeader } from "@/components/ui/pane-header";

export function ThemesPanel() {
  const { settings } = useAppStore();
  const { ps, setPs, openTheme: setSelectedThemeDir } = useProjectSettingsStore();
  const selectedThemeDir = ps.activeTheme;
  const themesDevice = ps.themesDevice;
  const themesFramework = ps.themesFramework;
  const themesDarkLightSupport = ps.themesDarkLightSupport;
  const themesDarkPreview = ps.themesDarkPreview;
  const themesCodeOpen = ps.themesCodeOpen;
  const themesShowInspector = ps.themesShowInspector;
  const [css, setCss] = useState("");
  const [previewKey, setPreviewKey] = useState(0);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState("");
  const [designMd, setDesignMd] = useState("");
  const [designJson, setDesignJson] = useState("");

  const [codeTab, setCodeTab] = useState<"css" | "tokens" | "guidelines">("css");
  const [designPreviewing, setDesignPreviewing] = useState(false);
  const [archetypeName, setArchetypeName] = useState("");
  const chatPath = `projects/${settings.project}/themes/${selectedThemeDir || "main"}/chat.json`;
  const generationMode = ps.themesGenerationMode;

  const allSeeds: DesignBriefTemplate[] = [...DESIGN_BRIEF_TEMPLATES, ...settings.styles.map((s) => ({ name: s.name, description: "", palette: [] as string[], content: s.value }))];
  const selectedSeed = allSeeds.find((s) => s.name === archetypeName) ?? null;

  const cssActive = generationMode === "css";
  const designActive = generationMode === "design";

  const toggleCss = () => setPs({ themesGenerationMode: "css" });
  const toggleDesign = () => setPs({ themesGenerationMode: "design" });

  const themeDir = selectedThemeDir || "main";
  const themeOutputPath = `projects/${settings.project}/themes/${themeDir}/theme.css`;
  const designOutputPath = `projects/${settings.project}/themes/${themeDir}/design.json`;
  const generatedDir = getGeneratedDirPath(`projects/${settings.project}`);

  // Latest editor values mirrored into refs (latest-ref pattern) so the stable
  // on-blur autosave handlers below persist fresh content without re-subscribing
  // the CodeMirror editor on every keystroke.
  const cssRef = useRef(css);
  const designJsonRef = useRef(designJson);
  const designMdRef = useRef(designMd);
  cssRef.current = css;
  designJsonRef.current = designJson;
  designMdRef.current = designMd;

  const persistTheme = useCallback(async (content: string, p: string, dirOverride?: string) => {
    try {
      const dir = dirOverride || selectedThemeDir || "main";
      const base = `projects/${settings.project}/themes/${dir}`;
      await createDir(base);
      await writeFile(`${base}/theme.css`, content);
      await writeFile(`${base}/prompt.json`, JSON.stringify({ prompt: p, updated: new Date().toISOString() }, null, 2));
      await writeFile(`${generatedDir}/src/styles/preview-theme.css`, content);
      queryClient.invalidateQueries({ queryKey: projectKeys.themeCss(settings.project, dir) });
    } catch (e) {
      notify.error("Failed to save theme", getErrorMessage(e));
    }
  }, [settings.project, selectedThemeDir, generatedDir]);

  const handleSaveToRunner = useCallback(async () => {
    if (!css) {
      notify.error("No CSS to save");
      return;
    }
    const dirPath = `projects/${settings.project}/generated/${ps.directories.themes}`;
    const dest = `${dirPath}/${themeDir}.css`;
    try {
      await createDir(dirPath);
      await writeFile(dest, css);
      notify.success("Saved to Runner", dest);
    } catch (e) {
      notify.error("Save to Runner failed", getErrorMessage(e));
    }
  }, [css, settings.project, ps.directories.themes, themeDir]);

  // Persist a file edited directly in the Design code panel (CSS / Tokens / Design
  // tabs) back to its file when the editor loses focus. theme.css is mirrored to
  // generated/ so the preview updates; prompt.json + library meta stay owned by the
  // explicit Save action.
  const persistThemeFile = useCallback(
    async (fileName: "theme.css" | "design.json" | "DESIGN.md", content: string) => {
      try {
        const base = `projects/${settings.project}/themes/${themeDir}`;
        await createDir(base);
        await writeFile(`${base}/${fileName}`, content);
        if (fileName === "theme.css") {
          await writeFile(`${generatedDir}/src/styles/preview-theme.css`, content);
          queryClient.invalidateQueries({ queryKey: projectKeys.themeCss(settings.project, themeDir) });
        }
      } catch (e) {
        notify.error(`Failed to save ${fileName}`, getErrorMessage(e));
      }
    },
    [settings.project, themeDir, generatedDir],
  );

  const handleBlurCss = useCallback(() => persistThemeFile("theme.css", cssRef.current), [persistThemeFile]);
  const handleBlurJson = useCallback(() => persistThemeFile("design.json", designJsonRef.current), [persistThemeFile]);
  const handleBlurMd = useCallback(() => persistThemeFile("DESIGN.md", designMdRef.current), [persistThemeFile]);

  const applyGeneratedCss = useCallback((content: string) => {
    setCss(content);
    setPreviewKey((k) => k + 1);
    persistTheme(content, "");
    setPs({ themesCodeOpen: true });
    const entityId = `theme-${selectedThemeDir || "main"}`;
    const msgs = useChatStore.getState().chats[entityId]?.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content ?? "";
    void saveItemMeta(`projects/${settings.project}`, "themes", selectedThemeDir || "main", prompt)
      .then(() => queryClient.invalidateQueries({ queryKey: projectKeys.library(settings.project) }));
  }, [persistTheme, setPs, settings.project, selectedThemeDir]);

  const handleApplyCode = useCallback((content: string) => {
    const stripped = content.replace(/<thinking[\s\S]*?<\/think>/g, "").trim();
    const cleaned = stripped.replace(/^```(?:css)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (cleaned) {
      setCss(cleaned);
      setPreviewKey((k) => k + 1);
    }
  }, []);

  const handleResolvePermission = useCallback((requestId: number, decision: ToolPermissionDecision, toolName: string) => {
    useChatStore.getState().resolveToolPermission(
      `theme-${themeDir}`,
      requestId,
      decision
    );
    if (decision === "always_allowed" && toolName) {
      const current = useAppStore.getState().settings.toolAllowlist;
      if (!current.includes(toolName)) {
        useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] });
      }
    }
  }, [themeDir]);

  // ─── Dynamic chat configuration based on generation mode ───────────────────────

  const cssSystemPrompt = useMemo(() =>
    getThemeSystemPrompt(
      themesFramework,
      settings.prompts["prompt.themes.base"] || undefined,
      settings.prompts[`prompt.themes.${themesFramework}`] || undefined,
    ) + (themesDarkLightSupport ? "\n\nGenerate both :root (light) and .dark (dark mode) variants in the same CSS block." : "") + outputFilePathSection(themeOutputPath),
  [themesFramework, themesDarkLightSupport, themeOutputPath, settings.prompts]);

  const designSystemPrompt = useMemo(() => {
    const schemaJson = JSON.stringify(z.toJSONSchema(designLanguageSpecSchema), null, 2);
    return getDesignLanguageSystemPrompt(themesFramework, themesDarkLightSupport, schemaJson)
      + outputFilePathSection(designOutputPath);
  }, [themesFramework, themesDarkLightSupport, designOutputPath]);

  const systemPrompt = designActive ? designSystemPrompt : cssSystemPrompt;
  const outputPath = designActive ? designOutputPath : themeOutputPath;

  const {
    messages, isStreaming, thinkingContent, input, setInput, sendMessage,
    stopGeneration, regenerate, clearChat, deleteFrom, attachments, addAttachment, removeAttachment,
    mentions, addMention, removeMention,
    thinkEnabled, toggleThink, thinkLevel, setThinkLevel, isGptOssFamily, canThink, canVision,
    toolsEnabled, toggleTools, canTools,
    pendingPermissions,
  } = useChat({
    entityId: `theme-${themeDir}`,
    chatPath,
    systemPrompt,
    outputPath,
    onOutput: (content) => {
      if (cssActive) {
        const fenceMatch = content.match(/```(?:css)?\s*([\s\S]*?)(?:```|$)/i);
        const extracted = fenceMatch ? fenceMatch[1].trim() : content.trim();
        applyGeneratedCss(extracted);
      }
    },
    onToolWrite: (path, content) => {
      if (!designActive) {
        applyGeneratedCss(content);
        return;
      }
      const fileName = path.split("/").pop();
      if (fileName === "design.json") {
        setDesignJson(content);
        setCodeTab("tokens");
        setPreviewKey((k) => k + 1);
        window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "themes" } }));
        toast.success("Design language generated");
      } else if (fileName === "theme.css") {
        setCss(content);
        setPreviewKey((k) => k + 1);
        writeFile(`${generatedDir}/src/styles/preview-theme.css`, content).catch((e) =>
          notify.error("Failed to update preview CSS", getErrorMessage(e))
        );
      } else if (fileName === "DESIGN.md") {
        setDesignMd(content);
      }
    },
  });

  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("themes", 2);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("themes-code", 3);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("themes-inspector", 3);

  // Load persisted theme via TanStack Query
  const { data: loadedCss } = useThemeCss(settings.project, selectedThemeDir);

  useEffect(() => {
    if (loadedCss !== undefined) {
      setCss(loadedCss);
      setPreviewKey((k) => k + 1);
    }
  }, [loadedCss]);

  // Load design.json and DESIGN.md from disk when theme changes
  useEffect(() => {
    let cancelled = false;
    const base = `projects/${settings.project}/themes/${selectedThemeDir || "main"}`;
    Promise.all([
      readFile(`${base}/design.json`).catch(() => null),
      readFile(`${base}/DESIGN.md`).catch(() => null),
    ]).then(([jsonRaw, mdRaw]) => {
      if (cancelled) return;
      setDesignJson(jsonRaw ?? "");
      setDesignMd(mdRaw ?? "");
    });
    return () => { cancelled = true; };
  }, [settings.project, selectedThemeDir]);

  const handleSaveConfirm = async () => {
    if (!saveDialogName.trim()) return;
    const slug = saveDialogName.trim().toLowerCase().replace(/\s+/g, "-");
    setSelectedThemeDir(slug);
    await persistTheme(css, "", slug);
    setShowSaveDialog(false);
    setSaveDialogName("");
    window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "themes" } }));
  };

  const handleSend = useCallback(() => {
    if (!input.trim()) return;
    sendMessage();
    setInput("");
  }, [input, sendMessage, setInput]);

  const deviceWidth = {
    desktop: "100%",
    tablet: "768px",
    mobile: "375px",
  };

  const parentCss = getParentCss();

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault} onVisibleChange={(_i, v) => setPs({ themesShowInspector: v })}>
            <Allotment.Pane minSize={200}>
              <div className="h-full flex flex-col bg-card">
                <div className="panel-toolbar h-10 px-3 gap-2">
                  <span className="text-sm font-medium">{selectedThemeDir ?? "Theme"}</span>
                  <div className="flex-1" />
                  <ThemeFrameworkPills
                    themesFramework={themesFramework}
                    themesDarkLightSupport={themesDarkLightSupport}
                    onSetFramework={(f) => setPs({ themesFramework: f })}
                    onToggleDarkLight={() => setPs({ themesDarkLightSupport: !themesDarkLightSupport })}
                  />
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6"
                    onClick={async () => {
                      if (selectedThemeDir && selectedThemeDir !== "main") {
                        try {
                          await persistTheme(css, "", selectedThemeDir);
                          toast.success(
                            `Updated "${selectedThemeDir}"`,
                            { description: "Theme saved" }
                          );
                        } catch (e) {
                          toast.error(`Failed to update "${selectedThemeDir}"`, { description: getErrorMessage(e) });
                        }
                        window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "themes" } }));
                      } else {
                        setSaveDialogName("");
                        setShowSaveDialog(true);
                      }
                    }}
                    disabled={!css}
                    title={selectedThemeDir && selectedThemeDir !== "main" ? "Update theme" : "Save as new theme"}
                  >
                    {selectedThemeDir && selectedThemeDir !== "main" ? <RefreshCw size={12} /> : <Save size={12} />}
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6"
                    onClick={handleSaveToRunner}
                    disabled={!css}
                    title="Save to Runner project"
                  >
                    <FolderUp size={12} />
                  </Button>
                  <Button
                    variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive"
                    onClick={async () => {
                      const { confirm } = await import("@tauri-apps/plugin-dialog");
                      if (await confirm("Clear all chat messages?", { title: "Clear Chat", kind: "warning" })) clearChat();
                    }}
                    disabled={messages.length === 0}
                    title="Clear chat"
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
                <ThemeChatPanel
                  messages={messages}
                  isStreaming={isStreaming}
                  thinkingContent={thinkingContent}
                  pendingPermissions={pendingPermissions}
                  onApplyCode={handleApplyCode}
                  onRegenerate={regenerate}
                  onDeleteFrom={deleteFrom}
                  onResolvePermission={handleResolvePermission}
                  input={input}
                  onChangeInput={setInput}
                  onSend={handleSend}
                  attachments={attachments}
                  onAddAttachment={addAttachment}
                  onRemoveAttachment={removeAttachment}
                  mentions={mentions}
                  onAddMention={addMention}
                  onRemoveMention={removeMention}
                  projectPath={`projects/${settings.project}`}
                  placeholder={
                    designActive
                      ? "Describe a design language (structured spec + CSS will be generated)…"
                      : "Describe the theme you want…"
                  }
                  thinkEnabled={thinkEnabled}
                  onToggleThink={toggleThink}
                  thinkLevel={thinkLevel}
                  onSetThinkLevel={setThinkLevel}
                  isGptOssFamily={isGptOssFamily}
                  canThink={canThink}
                  canVision={canVision}
                  toolsEnabled={toolsEnabled}
                  onToggleTools={toggleTools}
                  canTools={canTools}
                  onStopChat={stopGeneration}
                  cssActive={cssActive}
                  designActive={designActive}
                  onToggleCss={toggleCss}
                  onToggleDesign={toggleDesign}
                  archetypeName={archetypeName}
                  onSetArchetypeName={setArchetypeName}
                  allSeeds={allSeeds}
                  selectedSeed={selectedSeed}
                />
              </div>
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setPs({ themesShowInspector: !themesShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                {themesShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>
            <Allotment.Pane visible={themesShowInspector} preferredSize={240} minSize={160} snap>
              {themesShowInspector && (
                <PromptInspector
                  model={settings.modelId}
                  messages={[
                    { role: "system", content: systemPrompt },
                    ...messages.map((m) => ({
                      role: m.role,
                      content: m.content,
                      ...(m.images?.length ? { images: m.images } : {}),
                      ...(m.thinking ? { thinking: m.thinking } : {}),
                      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.tool, arguments: tc.arguments } })) } : {}),
                    })),
                  ]}
                  host={getHostForProvider(settings.provider, settings.host)}
                  provider={settings.provider}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical ref={codeRef} onDragEnd={codeOnDragEnd} defaultSizes={codeDefault} onVisibleChange={(_i, v) => setPs({ themesCodeOpen: v })}>
            <Allotment.Pane>
              <div className="h-full flex flex-col">
                <ThemePreviewToolbar
                  themesDevice={themesDevice}
                  themesDarkPreview={themesDarkPreview}
                  onSetDevice={(d) => setPs({ themesDevice: d })}
                  onToggleDarkPreview={() => setPs({ themesDarkPreview: !themesDarkPreview })}
                />
                <div className="flex-1 overflow-auto p-4 bg-muted/30 flex justify-center">
                  {css ? (
                    <div
                      className="h-full bg-background shadow-lg border border-border overflow-hidden"
                      style={{ width: deviceWidth[themesDevice] }}
                    >
                      <Frame
                        key={`${selectedThemeDir}-${previewKey}`}
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
              <PaneHeader onClick={() => setPs({ themesCodeOpen: !themesCodeOpen })}>
                <button className={["px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", codeTab === "css" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"].join(" ")} onClick={(e) => { e.stopPropagation(); setCodeTab("css"); if (!themesCodeOpen) setPs({ themesCodeOpen: true }); }}><Braces size={10} />CSS</button>
                <button className={["px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", codeTab === "tokens" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"].join(" ")} onClick={(e) => { e.stopPropagation(); setCodeTab("tokens"); if (!themesCodeOpen) setPs({ themesCodeOpen: true }); }}><Sliders size={10} />Tokens</button>
                <button className={["px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", codeTab === "guidelines" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"].join(" ")} onClick={(e) => { e.stopPropagation(); setCodeTab("guidelines"); if (!themesCodeOpen) setPs({ themesCodeOpen: true }); }}><Palette size={10} />Design</button>
                <div className="flex-1" />
                {themesCodeOpen ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>
            <Allotment.Pane visible={themesCodeOpen} preferredSize={252} minSize={100} snap>
              {themesCodeOpen && (
                <ThemeCodeTabs
                  css={css}
                  designJson={designJson}
                  designMd={designMd}
                  activeTab={codeTab}
                  onChangeCss={setCss}
                  onChangeJson={setDesignJson}
                  onChangeMd={setDesignMd}
                  onBlurCss={handleBlurCss}
                  onBlurJson={handleBlurJson}
                  onBlurMd={handleBlurMd}
                  hasDesignJson={!!designJson}
                  designPreviewing={designPreviewing}
                  onToggleDesignPreview={() => setDesignPreviewing((p) => !p)}
                />
              )}
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
