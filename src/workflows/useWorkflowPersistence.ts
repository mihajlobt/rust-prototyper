import { useState, useCallback, useEffect, useRef } from "react";
import { saveWorkflow, loadWorkflow, listWorkflows, getErrorMessage, type FileEntry } from "@/lib/ipc";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useReactFlow } from "@xyflow/react";
import type { Edge } from "@xyflow/react";
import type { WorkflowNodeType } from "@/workflows/nodeTypes";
import { notify } from "@/hooks/useToast";

interface UseWorkflowPersistenceParams {
  nodes: WorkflowNodeType[];
  setNodes: React.Dispatch<React.SetStateAction<WorkflowNodeType[]>>;
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
}

export function useWorkflowPersistence({ nodes, setNodes, edges, setEdges }: UseWorkflowPersistenceParams) {
  const { settings } = useAppStore();
  const { ps: { activeWorkflow: initialWorkflow }, setProjectSettings } = useProjectSettingsStore();
  const { fitView } = useReactFlow<WorkflowNodeType, Edge>();

  const [workflowId, setWorkflowId] = useState("default");
  const [savedWorkflows, setSavedWorkflows] = useState<FileEntry[]>([]);
  const [showWorkflowsPanel, setShowWorkflowsPanel] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Keep latest state in a ref so the unmount cleanup can read it without stale closures
  const latestStateRef = useRef<{ nodes: WorkflowNodeType[]; edges: Edge[]; workflowId: string }>({ nodes: [], edges: [], workflowId: "" });
  const projectRef = useRef(settings.project);
  useEffect(() => { projectRef.current = settings.project; }, [settings.project]);

  useEffect(() => { latestStateRef.current = { nodes, edges, workflowId }; }, [nodes, edges, workflowId]);

  // Auto-save current workflow when navigating away (only if it was explicitly loaded/saved)
  const activeWorkflowRef = useRef(initialWorkflow);
  useEffect(() => { activeWorkflowRef.current = initialWorkflow; }, [initialWorkflow]);

  useEffect(() => {
    return () => {
      const { nodes: ns, edges: es, workflowId: wid } = latestStateRef.current;
      const project = projectRef.current;
      if (!project || !wid || !activeWorkflowRef.current || ns.length === 0) return;
      const cleanNodes = ns.map((n) => ({ ...n, data: { ...n.data, status: "idle" as const, output: undefined } }));
      saveWorkflow(project, wid, JSON.stringify({ nodes: cleanNodes, edges: es }, null, 2)).catch(() => {});
    };
  }, []);

  const refreshSavedWorkflows = useCallback(async () => {
    try { setSavedWorkflows(await listWorkflows(settings.project)); } catch { setSavedWorkflows([]); }
  }, [settings.project]);

  useEffect(() => { refreshSavedWorkflows(); }, [refreshSavedWorkflows]);

  const handleLoad = useCallback(async (id: string, silent = false) => {
    setSaveError(null);
    const cleanId = id.replace(".json", "");
    try {
      const data = await loadWorkflow(settings.project, cleanId);
      const parsed = JSON.parse(data);
      const loadedNodes: WorkflowNodeType[] = (parsed.nodes ?? []).map((n: WorkflowNodeType) => ({
        ...n, data: { ...n.data, status: "idle" as const, output: undefined },
      }));
      setNodes(loadedNodes);
      setEdges(parsed.edges ?? []);
      setWorkflowId(cleanId);
      setShowWorkflowsPanel(false);
      setProjectSettings({ activeWorkflow: cleanId });
      fitView({ padding: 0.1 });
    } catch (e) {
      const msg = getErrorMessage(e);
      if (!silent) {
        setSaveError(msg);
        notify.error("Failed to load workflow", msg);
      }
    }
  }, [settings.project, setNodes, setEdges, setProjectSettings, fitView]);

  const autoLoadedRef = useRef(false);
  useEffect(() => {
    if (!initialWorkflow || !settings.project || autoLoadedRef.current) return;
    autoLoadedRef.current = true;
    handleLoad(initialWorkflow, true);
  }, [initialWorkflow, settings.project, handleLoad]);

  const handleSave = async () => {
    setSaveError(null);
    try {
      const id = workflowId.trim() || "default";
      setWorkflowId(id);
      const allNodes = nodes;
      const cleanNodes = allNodes.map((n) => ({ ...n, data: { ...n.data, status: "idle" as const, output: undefined } }));
      await saveWorkflow(settings.project, id, JSON.stringify({ nodes: cleanNodes, edges }, null, 2));
      setProjectSettings({ activeWorkflow: id });
      await refreshSavedWorkflows();
    } catch (e) {
      const msg = getErrorMessage(e);
      setSaveError(msg);
      notify.error("Failed to save workflow", msg);
    }
  };

  const handleDelete = async (name: string) => {
    try {
      const { deleteFile } = await import("@/lib/ipc");
      await deleteFile(`projects/${settings.project}/workflows/${name}`);
      await refreshSavedWorkflows();
    } catch (e) {
      const msg = getErrorMessage(e);
      setSaveError(msg);
      notify.error("Failed to delete workflow", msg);
    }
    setDeleteConfirm(null);
  };

  return {
    workflowId, setWorkflowId,
    savedWorkflows, showWorkflowsPanel, setShowWorkflowsPanel,
    deleteConfirm, setDeleteConfirm, saveError,
    handleLoad, handleSave, handleDelete, refreshSavedWorkflows,
    initialWorkflow, settings, setProjectSettings,
  };
}