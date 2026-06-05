import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Allotment } from "allotment";
import type { Extension } from "@codemirror/state";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useChatStore } from "@/stores/chatStore";
import { readFile, writeFile, getErrorMessage, isNotFoundError } from "@/lib/ipc";
import { notify } from "@/hooks/useToast";
import { useFlatProjectTree } from "@/hooks/useProjectFiles";
import { useChat } from "@/hooks/useChat";
import { PLANS_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";
import { getPlansSystemPrompt } from "@/lib/prompts/plans";
import { PlanEditor, type PlanEditorHandle, type EditorAction, type SelectionInfo } from "./plans/PlanEditor";
import { SelectionToChat } from "./plans/SelectionToChat";
import { FormatToolbar } from "./plans/FormatToolbar";
import { PlanPreview } from "./plans/PlanPreview";
import { FrontmatterHeader } from "./plans/FrontmatterHeader";
import { PlanStatusBar } from "./plans/PlanStatusBar";
import { OutlineRail } from "./plans/OutlineRail";
import { PlanCommandMenu } from "./plans/PlanCommandMenu";
import { PlannerChat } from "./plans/PlannerChat";
import { plansAutocomplete } from "./plans/autocomplete";
import { PlansEmptyState, PlansToolbar, type PlanMode } from "./plans/PlansPanelParts";
import { parseFrontmatter, toggleTaskInSource } from "@/lib/markdown/frontmatter";
import { listFromEntries, MENTION_KINDS, SECTION_BY_KIND, type MentionKind, type MentionOption } from "@/lib/markdown/mentions";
import type { ToolPermissionDecision } from "@/lib/ipc";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { TooltipProvider } from "@/components/ui/tooltip";

export function PlansPanel() {
  const project = useAppStore((s) => s.settings.project);
  const activePlan = useProjectSettingsStore((s) => s.ps.activePlan);
  const setProjectSettings = useProjectSettingsStore((s) => s.setProjectSettings);
  const plansMode = useProjectSettingsStore((s) => s.ps.plansMode);
  const plansOutlineOpen = useProjectSettingsStore((s) => s.ps.plansOutlineOpen);
  const plansChatOpen = useProjectSettingsStore((s) => s.ps.plansChatOpen);

  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [currentLine, setCurrentLine] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  const [selectionInfo, setSelectionInfo] = useState<SelectionInfo | null>(null);

  const lastWrittenRef = useRef<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!activePlan || !project) return;
    setLoading(true);
    setSource("");
    lastWrittenRef.current = null;
    const planPath = `projects/${project}/plans/${activePlan}.md`;
    readFile(planPath)
      .then((content) => {
        lastWrittenRef.current = content;
        setSource(content);
      })
      .catch((err: unknown) => {
        if (!isNotFoundError(err)) {
          notify.error("Failed to open plan", getErrorMessage(err));
        }
        setSource("");
      })
      .finally(() => setLoading(false));
  }, [activePlan, project]);

  useEffect(() => {
    if (!activePlan || !project) return;
    if (loading) return;
    if (source === lastWrittenRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const planPath = `projects/${project}/plans/${activePlan}.md`;
      const toWrite = source;
      writeFile(planPath, toWrite)
        .then(() => {
          lastWrittenRef.current = toWrite;
          setSavedAt(Date.now());
          window.dispatchEvent(new CustomEvent("prototyper:tree-changed", { detail: { section: "plans" } }));
        })
        .catch((err: unknown) => {
          notify.error("Failed to save plan", getErrorMessage(err));
        });
    }, 400);
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, [source, activePlan, project, loading]);

  // Cmd+K (or Ctrl+K) opens the command palette — scoped to the Plans view.
  useEffect(() => {
    if (!activePlan) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setCommandOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [activePlan]);

  const mentionOptions = useMentionOptions(project);
  const editorHandle = useRef<PlanEditorHandle | null>(null);
  const editorDispatch = useCallback(
    (action: EditorAction) => editorHandle.current?.dispatch(action),
    [],
  );

  const handleTaskToggle = useCallback((line: number) => {
    setSource((prev) => toggleTaskInSource(prev, line));
  }, []);

  const handleJump = useCallback((action: EditorAction) => {
    editorHandle.current?.dispatch(action);
  }, []);

  const extraExtensions = useMemo(
    () => [plansAutocomplete({ dispatch: editorDispatch, options: mentionOptions })],
    [editorDispatch, mentionOptions],
  );

  // ─── Planning agent ──────────────────────────────────────────────────────
  //
  // Standard pattern (mirrors ThemesPanel): build a project-aware system
  // prompt, give useChat an `outputPath` matching the plan file, and
  // listen for `onCodeOutput` so the agent's `write_file` result lands
  // in the editor. All research, drafting, and refinement happens via
  // the agent's tool calls — the FE just passes the user input and
  // surfaces the result.

  const systemPrompt = useMemo(() => {
    if (!project || !activePlan) return "";
    const inventory = projectLayoutFromOptions(mentionOptions);
    return getPlansSystemPrompt({
      projectName: project,
      planName: activePlan,
      projectLayout: inventory,
    });
  }, [project, activePlan, mentionOptions]);

  const chatEntityId = project && activePlan ? `plan:${project}:${activePlan}` : "";
  const chatPath = project && activePlan ? `projects/${project}/plans/${activePlan}.chat.json` : "";
  const planOutputPath = project && activePlan ? `projects/${project}/plans/${activePlan}.md` : "";

  const handleAgentWrite = useCallback((content: string) => {
    lastWrittenRef.current = content;
    setSource(content);
  }, []);

  const chat = useChat({
    entityId: chatEntityId,
    chatPath,
    systemPrompt,
    outputPath: planOutputPath || undefined,
    onCodeOutput: handleAgentWrite,
    panelToolFilter: PLANS_TOOL_FILTER_DEFAULT,
  });

  const onResolvePermission = useCallback(
    (requestId: number, decision: ToolPermissionDecision, _toolName: string) => {
      useChatStore.getState().resolveToolPermission(chatEntityId, requestId, decision);
    },
    [chatEntityId],
  );

  const chatSlot = chatEntityId ? (
    <PlannerChat
      messages={chat.messages}
      isStreaming={chat.isStreaming}
      thinkingContent={chat.thinkingContent}
      pendingPermissions={chat.pendingPermissions}
      onRegenerate={chat.regenerate}
      onDeleteFrom={chat.deleteFrom}
      onResolvePermission={onResolvePermission}
      input={chat.input}
      onChangeInput={chat.setInput}
      onSend={chat.sendMessage}
      attachments={chat.attachments}
      onAddAttachment={chat.addAttachment}
      onRemoveAttachment={chat.removeAttachment}
      mentions={chat.mentions}
      onAddMention={chat.addMention}
      onRemoveMention={chat.removeMention}
      projectPath={chatPath}
      placeholder="Describe a plan to draft, or ask the planner…"
      thinkEnabled={chat.thinkEnabled}
      onToggleThink={chat.toggleThink}
      thinkLevel={chat.thinkLevel}
      onSetThinkLevel={chat.setThinkLevel}
      isGptOssFamily={chat.isGptOssFamily}
      canThink={chat.canThink}
      canVision={chat.canVision}
      toolsEnabled={chat.toolsEnabled}
      onToggleTools={chat.toggleTools}
      canTools={chat.canTools}
      onStopChat={chat.stopGeneration}
    />
  ) : null;

  if (!activePlan) {
    return <PlansEmptyState />;
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex h-full flex-col bg-background text-foreground">
        <PlansToolbar
          planName={activePlan}
          savedAt={savedAt}
          mode={plansMode}
          outlineOpen={plansOutlineOpen}
          chatOpen={plansChatOpen}
          onModeChange={(mode) => setProjectSettings({ plansMode: mode })}
          onOutlineToggle={() => setProjectSettings({ plansOutlineOpen: !plansOutlineOpen })}
          onChatToggle={() => setProjectSettings({ plansChatOpen: !plansChatOpen })}
          onCommandMenu={() => setCommandOpen(true)}
        />
        <div className="min-h-0 flex-1 overflow-hidden">
          {loading ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              Loading…
            </div>
          ) : (
            <PlanLayout
              source={source}
              onSourceChange={setSource}
              mode={plansMode}
              lineNumbers={false}
              outlineOpen={plansOutlineOpen}
              chatOpen={plansChatOpen}
              currentLine={currentLine}
              onCursorLineChange={setCurrentLine}
              onSelectionChange={setSelectionInfo}
              extraExtensions={extraExtensions}
              editorHandle={editorHandle}
              onTaskToggle={handleTaskToggle}
              onJump={handleJump}
              chatSlot={chatSlot}
            />
          )}
        </div>
        <PlanStatusBar body={parseFrontmatter(source).body} />
      </div>
      <SelectionToChat
        editorHandle={editorHandle}
        selectionInfo={selectionInfo}
        planName={activePlan}
        planPath={planOutputPath}
        onAddMention={chat.addMention}
      />
      <PlanCommandMenu
        open={commandOpen}
        onOpenChange={setCommandOpen}
        source={source}
        editorHandle={editorHandle}
        currentMode={plansMode}
        onModeChange={(mode) => setProjectSettings({ plansMode: mode })}
        activePlan={activePlan}
      />
    </TooltipProvider>
  );
}

// ─── Layout switcher ─────────────────────────────────────────────────────────

interface PlanLayoutProps {
  source: string;
  onSourceChange: (v: string) => void;
  mode: PlanMode;
  lineNumbers: boolean;
  outlineOpen: boolean;
  chatOpen: boolean;
  currentLine: number;
  onCursorLineChange: (line: number) => void;
  onSelectionChange: (info: SelectionInfo | null) => void;
  extraExtensions: Extension[];
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
  onTaskToggle: (line: number) => void;
  onJump: (action: EditorAction) => void;
  chatSlot: React.ReactNode;
}

function PlanLayout({
  source,
  onSourceChange,
  mode,
  lineNumbers,
  outlineOpen,
  chatOpen,
  currentLine,
  onCursorLineChange,
  onSelectionChange,
  extraExtensions,
  editorHandle,
  onTaskToggle,
  onJump,
  chatSlot,
}: PlanLayoutProps) {
  const parsed = useMemo(() => parseFrontmatter(source), [source]);
  const showHeader = parsed.frontmatter !== null;
  const sidePanelVisible = outlineOpen || chatOpen;

  if (mode === "focus") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[720px] px-8 py-12">
          <PlanEditor
            ref={editorHandle}
            value={source}
            onChange={onSourceChange}
            lineNumbers={false}
            onCursorLineChange={onCursorLineChange}
            onSelectionChange={onSelectionChange}
            extraExtensions={extraExtensions}
          />
        </div>
      </div>
    );
  }

  if (mode === "read") {
    return (
      <div className="h-full overflow-y-auto">
        <div className="mx-auto max-w-[760px]">
          {showHeader ? <FrontmatterHeader frontmatter={parsed.frontmatter!} body={parsed.body} /> : null}
          <PlanPreview body={parsed.body} onTaskToggle={onTaskToggle} />
        </div>
      </div>
    );
  }

  if (mode === "write") {
    return (
      <div className="flex h-full flex-col">
        <FormatToolbar editorHandle={editorHandle} />
        <div className="min-h-0 flex-1 overflow-hidden">
          <PlanEditor
            ref={editorHandle}
            value={source}
            onChange={onSourceChange}
            lineNumbers={lineNumbers}
            onCursorLineChange={onCursorLineChange}
            onSelectionChange={onSelectionChange}
            extraExtensions={extraExtensions}
          />
        </div>
      </div>
    );
  }

  return (
    <SplitLayout
      source={source}
      onSourceChange={onSourceChange}
      lineNumbers={lineNumbers}
      sidePanelVisible={sidePanelVisible}
      chatOpen={chatOpen}
      currentLine={currentLine}
      onCursorLineChange={onCursorLineChange}
      onSelectionChange={onSelectionChange}
      extraExtensions={extraExtensions}
      editorHandle={editorHandle}
      onTaskToggle={onTaskToggle}
      onJump={onJump}
      chatSlot={chatSlot}
      parsed={parsed}
    />
  );
}

interface SplitLayoutProps {
  source: string;
  onSourceChange: (v: string) => void;
  lineNumbers: boolean;
  sidePanelVisible: boolean;
  chatOpen: boolean;
  currentLine: number;
  onCursorLineChange: (line: number) => void;
  onSelectionChange: (info: SelectionInfo | null) => void;
  extraExtensions: Extension[];
  editorHandle: React.MutableRefObject<PlanEditorHandle | null>;
  onTaskToggle: (line: number) => void;
  onJump: (action: EditorAction) => void;
  chatSlot: React.ReactNode;
  parsed: ReturnType<typeof parseFrontmatter>;
}

function SplitLayout({
  source,
  onSourceChange,
  lineNumbers,
  sidePanelVisible,
  chatOpen,
  currentLine,
  onCursorLineChange,
  onSelectionChange,
  extraExtensions,
  editorHandle,
  onTaskToggle,
  onJump,
  chatSlot,
  parsed,
}: SplitLayoutProps) {
  const { ref, onDragEnd, defaultSizes } = useAllotmentLayout(
    "plans",
    3,
    [true, true, sidePanelVisible],
  );
  const showHeader = parsed.frontmatter !== null;

  return (
    <Allotment ref={ref} onDragEnd={onDragEnd} defaultSizes={defaultSizes}>
      <Allotment.Pane>
        <div className="flex h-full flex-col">
          <FormatToolbar editorHandle={editorHandle} />
          <div className="min-h-0 flex-1 overflow-hidden">
            <PlanEditor
              ref={editorHandle}
              value={source}
              onChange={onSourceChange}
              lineNumbers={lineNumbers}
              onCursorLineChange={onCursorLineChange}
              onSelectionChange={onSelectionChange}
              extraExtensions={extraExtensions}
            />
          </div>
        </div>
      </Allotment.Pane>
      <Allotment.Pane>
        <div className="h-full overflow-y-auto">
          {showHeader ? <FrontmatterHeader frontmatter={parsed.frontmatter!} body={parsed.body} /> : null}
          <PlanPreview body={parsed.body} onTaskToggle={onTaskToggle} />
        </div>
      </Allotment.Pane>
      <Allotment.Pane visible={sidePanelVisible} minSize={200} maxSize={400} preferredSize={280}>
        {chatOpen ? chatSlot : <OutlineRail source={source} currentLine={currentLine} onJump={onJump} />}
      </Allotment.Pane>
    </Allotment>
  );
}

// ─── Mention options aggregator ─────────────────────────────────────────────

function useMentionOptions(project: string | undefined): MentionOption[] {
  const screens = useFlatProjectTree(project ?? "", SECTION_BY_KIND.screen);
  const components = useFlatProjectTree(project ?? "", SECTION_BY_KIND.component);
  const assets = useFlatProjectTree(project ?? "", SECTION_BY_KIND.asset);
  const plans = useFlatProjectTree(project ?? "", SECTION_BY_KIND.plan);
  const themes = useFlatProjectTree(project ?? "", SECTION_BY_KIND.theme);

  return useMemo<MentionOption[]>(() => {
    const out: MentionOption[] = [];
    for (const kind of MENTION_KINDS) {
      const query =
        kind === "screen" ? screens :
        kind === "component" ? components :
        kind === "asset" ? assets :
        kind === "plan" ? plans :
        themes;
      const entries = (query.data ?? []) as Array<{ name: string }>;
      out.push(...listFromEntries(kind, entries));
    }
    return out;
  }, [screens.data, components.data, assets.data, plans.data, themes.data]);
}

function projectLayoutFromOptions(options: MentionOption[]) {
  const buckets = { screen: [], component: [], asset: [], plan: [], theme: [] } as Record<MentionKind, string[]>;
  for (const opt of options) buckets[opt.kind].push(opt.name);
  const plans = buckets.plan.filter((n) => n.endsWith(".md")).map((n) => n.replace(/\.md$/, ""));
  return {
    screens: buckets.screen,
    components: buckets.component,
    assets: buckets.asset,
    plans,
    themes: buckets.theme,
  };
}
