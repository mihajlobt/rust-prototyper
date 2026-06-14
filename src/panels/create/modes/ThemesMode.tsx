// Port of src/panels/ThemesPanel.tsx (511 lines) + ThemeChatPanel/ThemeCodeTabs/
// ThemeFrameworkPills/ThemePreviewToolbar (~472 lines combined). theme-preview/ is
// the one kept subdirectory under panels/ — imported here AND by CreatePreviewPane.
// Drops the themesFramework pills (always "shadcn") and the themesDarkLightSupport
// toggle (dark+light variants are always requested). Drops onOutput/onToolWrite —
// generated theme.css / design.json / DESIGN.md writes are detected via useChat's
// onToolResult + a re-read of the file, mirroring ComponentsMode's pattern.

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { Allotment } from "allotment";
import {
  ChevronUp, ChevronDown, Save, FolderUp, RefreshCw, Braces, Sliders, Palette,
  Smartphone, Tablet, Monitor, Sun, Moon, Eye, Pencil, List,
} from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { CodeMirrorEditor } from "@/components/CodeMirrorEditor";
import { Markdown } from "@/components/ui/markdown";
import { DesignToc, markdownHeadingComponents } from "@/components/ui/design-toc";
import { PaneHeader } from "@/components/ui/pane-header";
import { TokenUsageBadge } from "@/components/TokenUsageBadge";
import { writeFile, readFile, createDir, getHostForProvider, getErrorMessage, type ToolPermissionDecision } from "@/lib/ipc";
import { queryClient } from "@/lib/queryClient";
import { projectKeys } from "@/lib/queryKeys";
import { saveItemMeta } from "@/lib/item-meta";
import { getGeneratedDirPath } from "@/lib/scaffold-shadcn";
import { designLanguageSpecSchema } from "@/lib/design/spec";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/appStore";
import { useChatStore } from "@/stores/chatStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { DESIGN_BRIEF_TEMPLATES, type DesignBriefTemplate } from "@/lib/prompts";
import { getThemeSystemPrompt, outputFilePathSection } from "@/lib/prompts";
import { getDesignLanguageSystemPrompt } from "@/lib/prompts/themes";
import { DESIGN_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";
import { useThemeCss } from "@/hooks/useProjectFiles";
import { notify } from "@/hooks/useToast";
import { useChat, resolveThinkParam } from "@/hooks/useChat";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { ThemeTokenPreview } from "@/panels/theme-preview/ThemeTokenPreview";
import { CreateChatPanel } from "../CreateChatPanel";
import { CreateInspector } from "../CreateInspector";
import { CreateCodePaneHeader, CreateCodePaneContent } from "../CreateCodePane";
import { useCreateMode } from "../useCreateMode";

const DEVICE_WIDTH: Record<"desktop" | "tablet" | "mobile", string | undefined> = {
  desktop: undefined,
  tablet: "768px",
  mobile: "375px",
};

export function ThemesMode() {
  const { settings } = useAppStore();
  const designToolFilter = useAppStore((s) => s.settings.panelToolFilter.themes);
  const { ps, setProjectSettings, openCreate } = useProjectSettingsStore();
  const { entityId: themeEntityId, activeItem: selectedThemeDir } = useCreateMode();
  const themeDir = selectedThemeDir || "main";

  const [css, setCss] = useState("");
  const [designJson, setDesignJson] = useState("");
  const [designMd, setDesignMd] = useState("");
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveDialogName, setSaveDialogName] = useState("");
  const [designPreviewing, setDesignPreviewing] = useState(false);
  const [showOutline, setShowOutline] = useState(false);
  const [archetypeName, setArchetypeName] = useState("");

  const generationMode = ps.createGenerationMode;
  const cssActive = generationMode === "css";
  const designActive = generationMode === "design";
  const codeTab = ps.createCodeTab2;

  const allSeeds: DesignBriefTemplate[] = [...DESIGN_BRIEF_TEMPLATES, ...settings.styles.map((s) => ({ name: s.name, description: "", palette: [] as string[], content: s.value }))];
  const selectedSeed = allSeeds.find((s) => s.name === archetypeName) ?? null;

  const generatedDir = getGeneratedDirPath(`projects/${settings.project}`);
  const themeOutputPath = `projects/${settings.project}/themes/${themeDir}/theme.css`;
  const designOutputPath = `projects/${settings.project}/themes/${themeDir}/design.json`;

  // Latest editor values mirrored into refs so the stable on-blur autosave
  // handlers persist fresh content without re-subscribing the editors.
  const cssRef = useRef(css);
  const designJsonRef = useRef(designJson);
  const designMdRef = useRef(designMd);
  cssRef.current = css;
  designJsonRef.current = designJson;
  designMdRef.current = designMd;

  const persistTheme = useCallback(async (content: string, p: string, dirOverride?: string) => {
    try {
      const dir = dirOverride || themeDir;
      const base = `projects/${settings.project}/themes/${dir}`;
      await createDir(base);
      await writeFile(`${base}/theme.css`, content);
      await writeFile(`${base}/prompt.json`, JSON.stringify({ prompt: p, updated: new Date().toISOString() }, null, 2));
      await writeFile(`${generatedDir}/src/styles/preview-theme.css`, content);
      queryClient.invalidateQueries({ queryKey: projectKeys.themeCss(settings.project, dir) });
    } catch (e) {
      notify.error("Failed to save theme", getErrorMessage(e));
    }
  }, [settings.project, themeDir, generatedDir]);

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

  // Persist a file edited in the code panel back to disk on blur. theme.css is
  // mirrored to generated/ so the preview updates.
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

  // Record the prompt that produced a generated theme/design language so Library can display/copy it.
  const recordThemeMeta = useCallback((dir: string) => {
    const msgs = useChatStore.getState().chats[themeEntityId]?.messages ?? [];
    const lastUser = [...msgs].reverse().find((m) => m.role === "user");
    const prompt = lastUser?.content ?? "";
    void saveItemMeta(`projects/${settings.project}`, "themes", dir, prompt)
      .then(() => queryClient.invalidateQueries({ queryKey: projectKeys.library(settings.project) }));
  }, [settings.project, themeEntityId]);

  const applyGeneratedCss = useCallback((content: string) => {
    setCss(content);
    persistTheme(content, "");
    setProjectSettings({ createCodeOpen: true });
    recordThemeMeta(themeDir);
  }, [persistTheme, setProjectSettings, recordThemeMeta, themeDir]);

  const handleApplyCode = useCallback((content: string) => {
    const stripped = content.replace(/<thinking[\s\S]*?<\/think>/g, "").trim();
    const cleaned = stripped.replace(/^```(?:css)?\s*/i, "").replace(/\s*```$/i, "").trim();
    if (cleaned) setCss(cleaned);
  }, []);

  const handleResolvePermission = useCallback((requestId: number, decision: ToolPermissionDecision, toolName: string) => {
    useChatStore.getState().resolveToolPermission(themeEntityId, requestId, decision);
    if (decision === "always_allowed" && toolName) {
      const current = useAppStore.getState().settings.toolAllowlist;
      if (!current.includes(toolName)) {
        useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] });
      }
    }
  }, [themeEntityId]);

  const cssSystemPrompt = useMemo(() =>
    getThemeSystemPrompt(
      "shadcn",
      settings.prompts["prompt.themes.base"] || undefined,
      settings.prompts["prompt.themes.shadcn"] || undefined,
    ) + "\n\nGenerate both :root (light) and .dark (dark mode) variants in the same CSS block." + outputFilePathSection(themeOutputPath),
  [themeOutputPath, settings.prompts]);

  const designSystemPrompt = useMemo(() => {
    const schemaJson = JSON.stringify(z.toJSONSchema(designLanguageSpecSchema), null, 2);
    return getDesignLanguageSystemPrompt("shadcn", true, schemaJson) + outputFilePathSection(designOutputPath);
  }, [designOutputPath]);

  const systemPrompt = designActive ? designSystemPrompt : cssSystemPrompt;
  const outputPath = designActive ? designOutputPath : themeOutputPath;

  const chat = useChat({
    entityId: themeEntityId,
    chatPath: `projects/${settings.project}/themes/${themeDir}/chat.json`,
    systemPrompt,
    outputPath,
    // Detect generated theme.css / design.json / DESIGN.md writes and apply
    // them — replaces the dropped onOutput/onToolWrite callbacks.
    onToolResult: (tool, success, _output, path) => {
      if (!success || !path || (tool !== "write_file" && tool !== "edit_file")) return;
      const base = `projects/${settings.project}/themes/${themeDir}`;
      if (path === `${base}/theme.css`) {
        readFile(path).then((content) => {
          if (designActive) {
            setCss(content);
            writeFile(`${generatedDir}/src/styles/preview-theme.css`, content).catch((e) =>
              notify.error("Failed to update preview CSS", getErrorMessage(e))
            );
          } else {
            applyGeneratedCss(content);
          }
        }).catch(() => {/* ignore */});
      } else if (path === `${base}/design.json`) {
        readFile(path).then((content) => {
          setDesignJson(content);
          setProjectSettings({ createCodeTab2: "tokens", createCodeOpen: true });
          window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "themes" } }));
          recordThemeMeta(themeDir);
        }).catch(() => {/* ignore */});
      } else if (path === `${base}/DESIGN.md`) {
        readFile(path).then(setDesignMd).catch(() => {/* ignore */});
      }
    },
    panelToolFilter: designToolFilter ?? DESIGN_TOOL_FILTER_DEFAULT,
    panelMaxToolCalls: settings.panelMaxToolCalls.themes,
  });

  const { ref: outerRef, onDragEnd: outerOnDragEnd, defaultSizes: outerDefault } = useAllotmentLayout("create-themes", 2);
  const { ref: codeRef, onDragEnd: codeOnDragEnd, defaultSizes: codeDefault } = useAllotmentLayout("create-themes-code", 3, [true, true, ps.createCodeOpen]);
  const { ref: inspectorRef, onDragEnd: inspectorOnDragEnd, defaultSizes: inspectorDefault } = useAllotmentLayout("create-themes-inspector", 3);

  // Load persisted theme.css via TanStack Query
  const { data: loadedCss } = useThemeCss(settings.project, selectedThemeDir);
  useEffect(() => {
    if (loadedCss !== undefined) setCss(loadedCss);
  }, [loadedCss]);

  // Load design.json and DESIGN.md from disk when the active theme changes
  useEffect(() => {
    let cancelled = false;
    const base = `projects/${settings.project}/themes/${themeDir}`;
    Promise.all([
      readFile(`${base}/design.json`).catch(() => null),
      readFile(`${base}/DESIGN.md`).catch(() => null),
    ]).then(([jsonRaw, mdRaw]) => {
      if (cancelled) return;
      setDesignJson(jsonRaw ?? "");
      setDesignMd(mdRaw ?? "");
    });
    return () => { cancelled = true; };
  }, [settings.project, themeDir]);

  const handleSaveConfirm = async () => {
    if (!saveDialogName.trim()) return;
    const slug = saveDialogName.trim().toLowerCase().replace(/\s+/g, "-");
    openCreate("themes", slug);
    await persistTheme(css, "", slug);
    setShowSaveDialog(false);
    setSaveDialogName("");
    window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "themes" } }));
  };

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerOnDragEnd} defaultSizes={outerDefault}>
        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorOnDragEnd} defaultSizes={inspectorDefault} onVisibleChange={(_i, v) => setProjectSettings({ createShowInspector: v })}>
            <Allotment.Pane minSize={200}>
              <CreateChatPanel
                label={selectedThemeDir ?? undefined}
                chatInputLayoutKey="create-themes-chat-input"
                chat={chat}
                projectPath={`projects/${settings.project}`}
                onApplyCode={handleApplyCode}
                onReset={chat.clearChat}
                headerActions={
                  <>
                    <Button
                      variant="ghost" size="icon" className="h-6 w-6"
                      onClick={async () => {
                        if (selectedThemeDir && selectedThemeDir !== "main") {
                          try {
                            await persistTheme(css, "", selectedThemeDir);
                            notify.success(`Updated "${selectedThemeDir}"`, "Theme saved");
                          } catch (e) {
                            notify.error(`Failed to update "${selectedThemeDir}"`, getErrorMessage(e));
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
                      {selectedThemeDir && selectedThemeDir !== "main" ? <RefreshCw size={13} /> : <Save size={13} />}
                    </Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleSaveToRunner} disabled={!css} title="Save to Runner project">
                      <FolderUp size={13} />
                    </Button>
                  </>
                }
                contextToolbar={
                  <div className="flex items-center gap-1.5 shrink-0">
                    {designActive && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant={selectedSeed ? "secondary" : "outline"} size="sm" className="h-7 text-[11px] gap-1 px-2 shrink-0">
                            <Palette size={11} />
                            {selectedSeed ? selectedSeed.name : "Seed"}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          <DropdownMenuRadioGroup value={archetypeName} onValueChange={setArchetypeName}>
                            <DropdownMenuRadioItem value="">None</DropdownMenuRadioItem>
                            {allSeeds.map((seed) => (
                              <DropdownMenuRadioItem key={seed.name} value={seed.name} className="text-xs">
                                {seed.name}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                    <div className="flex-1" />
                    <Button variant={cssActive ? "secondary" : "ghost"} size="sm" className="h-7 text-[11px] px-1.5" onClick={() => setProjectSettings({ createGenerationMode: "css" })} disabled={chat.isStreaming}>
                      CSS
                    </Button>
                    <Button variant={designActive ? "secondary" : "ghost"} size="sm" className="h-7 text-[11px] px-1.5" onClick={() => setProjectSettings({ createGenerationMode: "design" })} disabled={chat.isStreaming}>
                      Design
                    </Button>
                  </div>
                }
                placeholderEmpty={designActive ? "Describe a design language (structured spec + CSS will be generated)…" : "Describe the theme you want…"}
                placeholderFollowup="Ask for changes…"
                onResolvePermission={handleResolvePermission}
              />
            </Allotment.Pane>
            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setProjectSettings({ createShowInspector: !ps.createShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                <TokenUsageBadge model={settings.modelId} messages={chat.messages} entityId={themeEntityId} />
                {ps.createShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>
            <Allotment.Pane visible={ps.createShowInspector} preferredSize={240} minSize={160} snap>
              {ps.createShowInspector && (
                <CreateInspector
                  systemPrompt={systemPrompt}
                  messages={chat.messages}
                  model={settings.modelId}
                  host={getHostForProvider(settings.provider, settings.host)}
                  provider={settings.provider}
                  think={resolveThinkParam({ thinking: chat.canThink, thinkLevel: undefined }, chat.isGptOssFamily, chat.thinkEnabled, chat.thinkLevel)}
                  hasTools={chat.toolsEnabled}
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={400}>
          <Allotment vertical ref={codeRef} onDragEnd={codeOnDragEnd} defaultSizes={codeDefault}>
            <Allotment.Pane minSize={200}>
              <div className="h-full flex flex-col">
                <div className="panel-toolbar h-10 px-3 gap-2 bg-card">
                  <span className="text-sm font-medium">Preview</span>
                  <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5 ml-1">
                    <button onClick={() => setProjectSettings({ createPreviewMode: "preview" })} className={cn("px-2 py-0.5 text-[11px] rounded transition-colors", ps.createPreviewMode === "preview" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                      Tokens
                    </button>
                    <button onClick={() => setProjectSettings({ createPreviewMode: "gallery" })} className={cn("px-2 py-0.5 text-[11px] rounded transition-colors", ps.createPreviewMode === "gallery" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                      Gallery
                    </button>
                  </div>
                  <div className="flex-1" />
                  <div className="flex items-center gap-1">
                    <Button variant={ps.createDevice === "mobile" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" title="Mobile (375px)" onClick={() => setProjectSettings({ createDevice: "mobile" })}>
                      <Smartphone size={12} />
                    </Button>
                    <Button variant={ps.createDevice === "tablet" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" title="Tablet (768px)" onClick={() => setProjectSettings({ createDevice: "tablet" })}>
                      <Tablet size={12} />
                    </Button>
                    <Button variant={ps.createDevice === "desktop" ? "secondary" : "ghost"} size="icon" className="h-7 w-7" title="Desktop (full width)" onClick={() => setProjectSettings({ createDevice: "desktop" })}>
                      <Monitor size={12} />
                    </Button>
                  </div>
                  <div className="w-px h-4 bg-border mx-1" />
                  <Button variant={ps.darkPreview ? "secondary" : "ghost"} size="icon" className="h-7 w-7" onClick={() => setProjectSettings({ darkPreview: !ps.darkPreview })} title={ps.darkPreview ? "Light preview" : "Dark preview"}>
                    {ps.darkPreview ? <Moon size={12} /> : <Sun size={12} />}
                  </Button>
                </div>
                <div className="flex-1 overflow-hidden" style={{ width: DEVICE_WIDTH[ps.createDevice] }}>
                  <ThemeTokenPreview css={css} isDark={ps.darkPreview} viewMode={ps.createPreviewMode} />
                </div>
              </div>
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <CreateCodePaneHeader
                visible={ps.createCodeOpen}
                onToggle={() => setProjectSettings({ createCodeOpen: !ps.createCodeOpen })}
                tabButtons={
                  <>
                    <button className={cn("px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", codeTab === "css" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")} onClick={(e) => { e.stopPropagation(); setProjectSettings({ createCodeTab2: "css", createCodeOpen: true }); }}>
                      <Braces size={10} />CSS
                    </button>
                    <button className={cn("px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", codeTab === "tokens" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")} onClick={(e) => { e.stopPropagation(); setProjectSettings({ createCodeTab2: "tokens", createCodeOpen: true }); }}>
                      <Sliders size={10} />Tokens
                    </button>
                    <button className={cn("px-1.5 py-0.5 text-[11px] font-medium rounded transition-colors flex items-center gap-1", codeTab === "guidelines" ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50")} onClick={(e) => { e.stopPropagation(); setProjectSettings({ createCodeTab2: "guidelines", createCodeOpen: true }); }}>
                      <Palette size={10} />Design
                    </button>
                  </>
                }
              />
            </Allotment.Pane>
            <Allotment.Pane visible={ps.createCodeOpen} minSize={100} snap>
              {ps.createCodeOpen && (
              <CreateCodePaneContent>
                {codeTab === "css" && (
                  <CodeMirrorEditor value={css} onChange={setCss} onBlur={handleBlurCss} mode="css" />
                )}
                {codeTab === "tokens" && (
                  designJson ? (
                    <CodeMirrorEditor value={designJson} onChange={setDesignJson} onBlur={handleBlurJson} mode="json" />
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
                      No design tokens yet. Switch to Design mode and generate a theme to create a structured spec.
                    </div>
                  )
                )}
                {codeTab === "guidelines" && (
                  designMd ? (
                    designPreviewing ? (
                      <div className="h-full relative">
                        <div className="absolute top-2 right-2 z-10 flex items-center gap-1 rounded border border-border shadow-sm overflow-hidden bg-background/80 backdrop-blur">
                          <button
                            className={cn(
                              "flex items-center gap-1 px-2 py-1 text-[10px] font-medium transition-colors",
                              showOutline ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50",
                            )}
                            onClick={() => setShowOutline(!showOutline)}
                          >
                            <List size={11} /> Outline
                          </button>
                          <div className="w-px h-4 bg-border" />
                          <button
                            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            onClick={() => setDesignPreviewing(false)}
                          >
                            <Pencil size={11} /> Edit
                          </button>
                        </div>
                        <div className="h-full min-h-0">
                          <Allotment onVisibleChange={(index, visible) => { if (index === 0) setShowOutline(visible); }}>
                            <Allotment.Pane visible={showOutline} minSize={120} preferredSize={180} snap>
                              <DesignToc markdown={designMd} />
                            </Allotment.Pane>
                            <Allotment.Pane minSize={200}>
                              <div className="h-full overflow-auto p-4 prose prose-sm dark:prose-invert max-w-none text-sm">
                                <Markdown components={markdownHeadingComponents}>{designMd}</Markdown>
                              </div>
                            </Allotment.Pane>
                          </Allotment>
                        </div>
                      </div>
                    ) : (
                      <div className="h-full relative">
                        <button
                          className="absolute top-2 right-2 z-10 flex items-center gap-1 px-2 py-1 text-[10px] font-medium rounded bg-background/80 backdrop-blur border border-border shadow-sm text-muted-foreground hover:text-foreground transition-colors"
                          onClick={() => setDesignPreviewing(true)}
                        >
                          <Eye size={11} /> Preview
                        </button>
                        <CodeMirrorEditor value={designMd} onChange={setDesignMd} onBlur={handleBlurMd} mode="markdown" />
                      </div>
                    )
                  ) : (
                    <div className="h-full flex items-center justify-center text-xs text-muted-foreground px-4 text-center">
                      No design document yet. Switch to Design mode and generate a theme to create DESIGN.md.
                    </div>
                  )
                )}
              </CreateCodePaneContent>
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
