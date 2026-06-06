import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useChatStore } from "@/stores/chatStore";
import { readFile, writeFile, getErrorMessage, isNotFoundError, getHostForProvider } from "@/lib/ipc";
import { notify } from "@/hooks/useToast";
import { useFlatProjectTree } from "@/hooks/useProjectFiles";
import { useChat } from "@/hooks/useChat";
import { PLANS_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";
import { getPlansSystemPrompt } from "@/lib/prompts/plans";
import { type PlanEditorHandle, type EditorAction, type SelectionInfo } from "./plans/PlanEditor";
import { SelectionToChat } from "./plans/SelectionToChat";
import { PlanLayout } from "./plans/PlanLayout";
import { PlanCommandMenu } from "./plans/PlanCommandMenu";
import { PlannerChat } from "./plans/PlannerChat";
import { plansAutocomplete } from "./plans/autocomplete";
import { PlansEmptyState, PlansToolbar } from "./plans/PlansPanelParts";
import { toggleTaskInSource } from "@/lib/markdown/frontmatter";
import { listFromEntries, MENTION_KINDS, SECTION_BY_KIND, type MentionKind, type MentionOption } from "@/lib/markdown/mentions";
import type { ToolPermissionDecision } from "@/lib/ipc";
import { TooltipProvider } from "@/components/ui/tooltip";

export function PlansPanel() {
  const project = useAppStore((s) => s.settings.project);
  const settings = useAppStore((s) => s.settings);
  const planToolFilter = useAppStore((s) => s.settings.panelToolFilter.plans);
  const planMaxToolCalls = useAppStore((s) => s.settings.panelMaxToolCalls.plans);
  const activePlan = useProjectSettingsStore((s) => s.ps.activePlan);
  const setProjectSettings = useProjectSettingsStore((s) => s.setProjectSettings);
  const plansMode = useProjectSettingsStore((s) => s.ps.plansMode);
  const plansChatOpen = useProjectSettingsStore((s) => s.ps.plansChatOpen);
  const plansShowInspector = useProjectSettingsStore((s) => s.ps.plansShowInspector);

  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [currentLine, setCurrentLine] = useState(0);
  const [commandOpen, setCommandOpen] = useState(false);
  // Ref (not state) so CodeMirror selection updates don't re-render PlansPanel
  // on every mouse-drag tick. SelectionToChat reads from this ref on mouseup.
  const selectionInfoRef = useRef<SelectionInfo | null>(null);

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
    panelToolFilter: planToolFilter ?? PLANS_TOOL_FILTER_DEFAULT,
    panelMaxToolCalls: planMaxToolCalls,
  });

  const onResolvePermission = useCallback(
    (requestId: number, decision: ToolPermissionDecision, toolName: string) => {
      useChatStore.getState().resolveToolPermission(chatEntityId, requestId, decision);
      if (decision === "always_allowed" && toolName) {
        const current = useAppStore.getState().settings.toolAllowlist;
        if (!current.includes(toolName)) {
          useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] });
        }
      }
    },
    [chatEntityId],
  );

  const inspectorMessages = useMemo(() => [
    { role: "system" as const, content: systemPrompt },
    ...chat.messages.map((m) => ({
      role: m.role as "user" | "assistant" | "tool",
      content: m.content,
      ...(m.images?.length ? { images: m.images } : {}),
      ...(m.thinking ? { thinking: m.thinking } : {}),
      ...(m.toolCalls?.length ? { tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.tool, arguments: tc.arguments } })) } : {}),
    })),
  ], [systemPrompt, chat.messages]);

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
      projectPath={project ? `projects/${project}` : ""}
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
      inspectorMessages={inspectorMessages}
      model={settings.modelId}
      host={getHostForProvider(settings.provider, settings.host)}
      provider={settings.provider}
      showInspector={plansShowInspector}
      onToggleInspector={() => setProjectSettings({ plansShowInspector: !plansShowInspector })}
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
          chatOpen={plansChatOpen}
          onModeChange={(mode) => setProjectSettings({ plansMode: mode })}
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
              chatOpen={plansChatOpen}
              currentLine={currentLine}
              onCursorLineChange={setCurrentLine}
              onSelectionChange={(info) => { selectionInfoRef.current = info; }}
              extraExtensions={extraExtensions}
              editorHandle={editorHandle}
              onTaskToggle={handleTaskToggle}
              chatSlot={chatSlot}
            />
          )}
        </div>
      </div>
      <SelectionToChat
        editorHandle={editorHandle}
        selectionInfoRef={selectionInfoRef}
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
