// Port of src/panels/WizardPanel.tsx (349 lines) + wizard/* (3 files, 617
// lines). Owns Wizard's chat, preview tabs, and annotations. Preserves the
// simpler post-stream dev-server effect (wasStreamingRef + startRunner) —
// do NOT replace with the Screens/Components ensureServer pattern.

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Allotment } from "allotment";
import { ChevronUp, ChevronDown, Pencil } from "lucide-react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { useChat } from "@/hooks/useChat";
import { useAllotmentLayout } from "@/hooks/useAllotmentLayout";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useChatStore } from "@/stores/chatStore";
import { useAskUserStore } from "@/stores/askUserStore";
import { useDevServerStore } from "@/lib/dev-server-manager";
import { hasGeneratedScaffold } from "@/lib/scaffold";
import { getWizardSystemPrompt } from "@/lib/prompts/wizard";
import { getHostForProvider, readFile } from "@/lib/ipc";
import type { ToolPermissionDecision } from "@/lib/ipc";
import { saveItemMeta } from "@/lib/item-meta";
import { projectKeys } from "@/lib/queryKeys";
import { WIZARD_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";
import { Button } from "@/components/ui/button";
import { PaneHeader } from "@/components/ui/pane-header";
import { TokenUsageBadge } from "@/components/TokenUsageBadge";
import { CreateChatPanel } from "../CreateChatPanel";
import { CreateInspector } from "../CreateInspector";
import { CreatePreviewPane, type PreviewTab, type PreviewAnnotation } from "../CreatePreviewPane";
import { AnnotationTray } from "../AnnotationTray";
import { useCreateMode } from "../useCreateMode";

function makeId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function serializeAnnotations(annotations: PreviewAnnotation[]): string {
  const open = annotations.filter((a) => !a.resolved);
  if (open.length === 0) return "";
  const lines = open.map((a, i) => {
    if (a.type === "region" && a.w !== undefined && a.h !== undefined) {
      return `${i + 1}. [REGION ${a.x.toFixed(0)}%,${a.y.toFixed(0)}% → ${(a.x + a.w).toFixed(0)}%,${(a.y + a.h).toFixed(0)}%] "${a.text}"`;
    }
    return `${i + 1}. [POINT ${a.x.toFixed(0)}%,${a.y.toFixed(0)}%] "${a.text}"`;
  });
  return `\n\n[VISUAL ANNOTATIONS — user's feedback on the live preview]\n${lines.join("\n")}`;
}

export function WizardMode() {
  const { settings } = useAppStore();
  const wizardToolFilter = useAppStore((s) => s.settings.panelToolFilter.wizard);
  const { ps: projectSettings, setProjectSettings } = useProjectSettingsStore();
  const devServerStore = useDevServerStore();
  const queryClient = useQueryClient();
  const { entityId: wizardEntityId } = useCreateMode();

  const [annotations, setAnnotations] = useState<PreviewAnnotation[]>([]);
  const [previewTabs, setPreviewTabs] = useState<PreviewTab[]>([]);
  const [activePreviewTabId, setActivePreviewTabId] = useState<string | null>(null);
  const [annotationMode, setAnnotationMode] = useState(false);
  // Guards against readFile callbacks resolving after a wizard reset clears the tabs
  const wizardSessionRef = useRef(0);
  const pendingThemeSlugRef = useRef<string | null>(null);
  const pendingScreenRef = useRef<{ screenId: string; title: string; urlPath: string } | null>(null);

  const systemPrompt = useMemo(() => getWizardSystemPrompt(settings.project), [settings.project]);

  const handleToolCall = useCallback((tool: string, args: Record<string, unknown>) => {
    if (tool === "set_active_theme") pendingThemeSlugRef.current = (args.theme_slug as string) || "";
    if (tool === "register_screen") {
      pendingScreenRef.current = {
        screenId: (args.screen_id as string) || "",
        title: (args.title as string) || "",
        urlPath: (args.path as string) || "",
      };
    }
  }, []);

  const handleToolResult = useCallback((tool: string, success: boolean) => {
    if (tool === "set_active_theme" && success && pendingThemeSlugRef.current) {
      setProjectSettings({ stylePreset: pendingThemeSlugRef.current });
      pendingThemeSlugRef.current = null;
    }
    if (tool === "register_screen" && success && pendingScreenRef.current) {
      const { screenId, title, urlPath } = pendingScreenRef.current;
      pendingScreenRef.current = null;
      const project = useAppStore.getState().settings.project;
      const session = wizardSessionRef.current;

      saveItemMeta(`projects/${project}`, "screens", screenId, title)
        .catch((err) => console.error("Failed to create screen meta for sidebar:", err));
      queryClient.invalidateQueries({ queryKey: projectKeys.tree(project, "screens") });

      readFile(`projects/${project}/navigation.json`)
        .then((raw) => {
          if (wizardSessionRef.current !== session) return;
          const nav = JSON.parse(raw) as { screens?: Array<{ id: string; path: string; preview_path?: string }> };
          const entry = nav.screens?.find((s) => s.id === screenId);
          const previewPath = entry?.preview_path ?? urlPath;
          const tabId = `screen-${screenId}`;
          setPreviewTabs((prev) => {
            const existing = prev.find((tab) => tab.id === tabId);
            if (existing) return prev.map((tab) => tab.id === tabId ? { ...tab, label: title || tab.label, previewPath } : tab);
            return [...prev, { id: tabId, type: "screen" as const, label: title || urlPath, urlPath, previewPath }];
          });
          setActivePreviewTabId(tabId);
        })
        .catch((err) => {
          console.error("Failed to read navigation.json for preview tab:", err);
          if (wizardSessionRef.current !== session) return;
          const tabId = `screen-${screenId}`;
          setPreviewTabs((prev) => {
            if (prev.find((tab) => tab.id === tabId)) return prev;
            return [...prev, { id: tabId, type: "screen" as const, label: title || urlPath, urlPath }];
          });
          setActivePreviewTabId(tabId);
        });
    }
  }, [setProjectSettings, queryClient]);

  const handleSelectPreviewTab = useCallback((tabId: string) => {
    setActivePreviewTabId(tabId);
  }, []);

  // Restore screen tabs from navigation.json when the project is loaded or switched.
  useEffect(() => {
    const project = settings.project;
    const session = wizardSessionRef.current;

    readFile(`projects/${project}/navigation.json`)
      .then((raw) => {
        if (wizardSessionRef.current !== session) return;
        const nav = JSON.parse(raw) as { screens?: Array<{ id: string; title: string; path: string; preview_path?: string }>; defaultScreen?: string };
        const screenTabs: PreviewTab[] = (nav.screens ?? []).map((screen) => ({
          id: `screen-${screen.id}`,
          type: "screen" as const,
          label: screen.title || screen.id,
          urlPath: screen.path,
          previewPath: screen.preview_path,
        }));
        if (screenTabs.length === 0) return;
        setPreviewTabs((prev) => {
          // Don't overwrite tabs that were already populated during streaming
          if (prev.length > 0) return prev;
          return screenTabs;
        });
        setActivePreviewTabId((prev) => {
          if (prev) return prev;
          const defaultId = nav.defaultScreen ? `screen-${nav.defaultScreen}` : null;
          return defaultId ?? screenTabs[0].id;
        });
      })
      .catch((err) => {
        const msg = String(err);
        if (!msg.includes("not found") && !msg.includes("No such")) console.error("Failed to restore navigation tabs:", err);
      });
  }, [settings.project]);

  const chat = useChat({
    entityId: wizardEntityId,
    chatPath: `projects/${settings.project}/wizard/chat.json`,
    systemPrompt,
    outputPath: `projects/${settings.project}/generated/src/pages/home.tsx`,
    panelMaxToolCalls: settings.panelMaxToolCalls.wizard ?? 50,
    panelToolFilter: wizardToolFilter ?? WIZARD_TOOL_FILTER_DEFAULT,
    onToolCall: handleToolCall,
    onToolResult: handleToolResult,
  });

  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !chat.isStreaming) {
      const projectDir = `projects/${settings.project}`;
      hasGeneratedScaffold(projectDir).then((ready) => {
        if (ready) devServerStore.startRunner(`${projectDir}/generated`, projectSettings.runnerPort).catch(() => {});
      }).catch(() => {});
    }
    wasStreamingRef.current = chat.isStreaming;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.isStreaming]);

  const handleResolvePermission = useCallback((requestId: number, decision: ToolPermissionDecision, toolName: string) => {
    useChatStore.getState().resolveToolPermission(wizardEntityId, requestId, decision);
    if (decision === "always_allowed" && toolName) {
      const current = useAppStore.getState().settings.toolAllowlist;
      if (!current.includes(toolName)) {
        useAppStore.getState().setSettings({ toolAllowlist: [...current, toolName] });
      }
    }
  }, [wizardEntityId]);

  const handleSend = useCallback(() => {
    const text = chat.input.trim();
    if (!text) return;
    if (chat.messages.length === 0) {
      chat.sendMessage(text);
    } else {
      // Follow-up: append annotation context then send
      const annotationContext = serializeAnnotations(annotations);
      const fullText = [text, annotationContext].filter(Boolean).join("\n\n");
      if (annotationContext) setAnnotations((prev) => prev.map((a) => ({ ...a, resolved: true })));
      chat.sendMessage(fullText);
    }
  }, [chat, annotations]);

  const handleSendAnnotations = useCallback(() => {
    const annotationContext = serializeAnnotations(annotations);
    if (!annotationContext) return;
    setAnnotations((prev) => prev.map((a) => ({ ...a, resolved: true })));
    chat.sendMessage(`Please apply my visual annotations:${annotationContext}`);
  }, [chat, annotations]);

  const handleReset = useCallback(async () => {
    if (!(await confirm("Reset the wizard and clear all messages?", { title: "Reset Wizard", kind: "warning" }))) return;
    chat.stopGeneration();
    chat.clearChat();
    useAskUserStore.getState().clearAskUser();
    useAskUserStore.getState().clearAskUserForm();
    setAnnotations([]);
    setPreviewTabs([]);
    setActivePreviewTabId(null);
    wizardSessionRef.current++;
    pendingThemeSlugRef.current = null;
    pendingScreenRef.current = null;
  }, [chat]);

  const { ref: outerRef, onDragEnd: outerDragEnd, defaultSizes: outerSizes } = useAllotmentLayout("create-wizard", 2);
  const { ref: inspectorRef, onDragEnd: inspectorDragEnd, defaultSizes: inspectorSizes } = useAllotmentLayout("create-wizard-inspector", 3);
  const { ref: rightRef, onDragEnd: rightDragEnd, defaultSizes: rightSizes } = useAllotmentLayout("create-wizard-right", 2);

  return (
    <div className="h-full flex flex-col">
      <Allotment ref={outerRef} onDragEnd={outerDragEnd} defaultSizes={outerSizes}>

        <Allotment.Pane minSize={300}>
          <Allotment vertical ref={inspectorRef} onDragEnd={inspectorDragEnd} defaultSizes={inspectorSizes} onVisibleChange={(_i, v) => setProjectSettings({ createShowInspector: v })}>
            <Allotment.Pane minSize={200}>
              <CreateChatPanel
                chatInputLayoutKey="create-wizard-chat-input"
                chat={chat}
                projectPath={`projects/${settings.project}`}
                onReset={handleReset}
                onSend={handleSend}
                headerActions={
                  <Button
                    size="sm"
                    variant={annotationMode ? "default" : "outline"}
                    className="h-6 gap-1 px-2 text-xs"
                    onClick={() => setAnnotationMode((a) => !a)}
                  >
                    <Pencil size={11} />
                    {annotationMode ? "Done" : "Annotate"}
                  </Button>
                }
                placeholderEmpty="Describe the app you want to build…"
                placeholderFollowup="Ask for changes…"
                onResolvePermission={handleResolvePermission}
              />
            </Allotment.Pane>

            <Allotment.Pane preferredSize={28} minSize={28} maxSize={28}>
              <PaneHeader onClick={() => setProjectSettings({ createShowInspector: !projectSettings.createShowInspector })}>
                <span className="text-xs font-medium flex-1">Inspector</span>
                <TokenUsageBadge model={settings.modelId} messages={chat.messages} />
                {projectSettings.createShowInspector ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
              </PaneHeader>
            </Allotment.Pane>

            <Allotment.Pane visible={projectSettings.createShowInspector} preferredSize={240} minSize={160} snap>
              {projectSettings.createShowInspector && (
                <CreateInspector
                  systemPrompt={systemPrompt}
                  messages={chat.messages}
                  model={settings.modelId}
                  host={getHostForProvider(settings.provider, settings.host)}
                  provider={settings.provider}
                  hasTools
                />
              )}
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

        <Allotment.Pane minSize={320}>
          <Allotment vertical ref={rightRef} onDragEnd={rightDragEnd} defaultSizes={rightSizes}>
            <Allotment.Pane minSize={200}>
              <CreatePreviewPane
                project={settings.project}
                stylePreset={projectSettings.stylePreset || null}
                previewTabs={previewTabs}
                activePreviewTabId={activePreviewTabId}
                onSelectTab={handleSelectPreviewTab}
                annotations={annotations}
                onAddAnnotation={(annotation) => setAnnotations((prev) => [...prev, { ...annotation, id: makeId() }])}
                annotationMode={annotationMode}
                showViewMode
                generatedDir={`projects/${settings.project}/generated`}
              />
            </Allotment.Pane>

            <Allotment.Pane minSize={60} maxSize={280} preferredSize={180} visible={annotations.length > 0}>
              <AnnotationTray
                annotations={annotations}
                onRemove={(id) => setAnnotations((prev) => prev.filter((a) => a.id !== id))}
                onResolve={(id) => setAnnotations((prev) => prev.map((a) => (a.id === id ? { ...a, resolved: true } : a)))}
                onSendToAi={handleSendAnnotations}
                canSend={!chat.isStreaming}
              />
            </Allotment.Pane>
          </Allotment>
        </Allotment.Pane>

      </Allotment>
    </div>
  );
}
