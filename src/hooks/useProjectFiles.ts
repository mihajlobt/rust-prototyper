import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  readDir,
  readFile,
  writeFile,
  createDir,
  type FileEntry,
} from "@/lib/ipc";
import { projectKeys } from "@/lib/queryKeys";
import { useExplorerStore } from "@/stores/explorerStore";

// ─── Queries ───

/** Flat per-section listing — used by panels for dropdowns/lists and sidebar tree */
export function useFlatProjectTree(project: string, section: string) {
  // Subscribe to treeVersion to trigger refetch when refresh() is called
  const treeVersion = useExplorerStore((s) => s.treeVersion);

  return useQuery({
    queryKey: ["project-tree", project, section, treeVersion] as const,
    queryFn: async () => {
      try {
        return await readDir(`projects/${project}/${section}`);
      } catch {
        return [] as FileEntry[];
      }
    },
    enabled: !!project,
    refetchOnMount: true,
    staleTime: 0, // Immediately stale to force refetch on version change
  });
}

export function useComponentCode(project: string, name: string | null) {
  return useQuery({
    queryKey: projectKeys.componentCode(project, name || ""),
    queryFn: async () => {
      if (!name) return "";
      try {
        return await readFile(`projects/${project}/components/${name}/component.tsx`);
      } catch {
        return "";
      }
    },
    enabled: !!project && !!name,
  });
}

export function useComponentChat(project: string, name: string | null) {
  return useQuery({
    queryKey: projectKeys.componentChat(project, name || ""),
    queryFn: async () => {
      if (!name) return [] as Array<{ role: "user" | "assistant"; content: string }>;
      try {
        const data = await readFile(`projects/${project}/components/${name}/chat.json`);
        return JSON.parse(data) as Array<{ role: "user" | "assistant"; content: string }>;
      } catch {
        return [] as Array<{ role: "user" | "assistant"; content: string }>;
      }
    },
    enabled: !!project && !!name,
  });
}

export function useThemeCss(project: string, name: string | null) {
  return useQuery({
    queryKey: projectKeys.themeCss(project, name || ""),
    queryFn: async () => {
      if (!name) return "";
      try {
        return await readFile(`projects/${project}/themes/${name}/theme.css`);
      } catch {
        return "";
      }
    },
    enabled: !!project && !!name,
  });
}

export function useScreenCode(project: string, name: string | null) {
  return useQuery({
    queryKey: projectKeys.screenCode(project, name || ""),
    queryFn: async () => {
      if (!name) return "";
      try {
        return await readFile(`projects/${project}/screens/${name}/screen.tsx`);
      } catch {
        return "";
      }
    },
    enabled: !!project && !!name,
  });
}

export function useScreenChat(project: string, name: string | null) {
  return useQuery({
    queryKey: projectKeys.screenChat(project, name || ""),
    queryFn: async () => {
      if (!name) return [] as Array<{ role: "user" | "assistant"; content: string }>;
      try {
        const data = await readFile(`projects/${project}/screens/${name}/chat.json`);
        return JSON.parse(data) as Array<{ role: "user" | "assistant"; content: string }>;
      } catch {
        return [] as Array<{ role: "user" | "assistant"; content: string }>;
      }
    },
    enabled: !!project && !!name,
  });
}

// ─── Mutations ───

export function useSaveComponent() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      project,
      name,
      code,
      messages,
    }: {
      project: string;
      name: string;
      code: string;
      messages?: Array<{ role: "user" | "assistant"; content: string }>;
    }) => {
      const base = `projects/${project}/components/${name}`;
      await createDir(base);
      await writeFile(`${base}/component.tsx`, code);
      if (messages && messages.length > 0) {
        await writeFile(`${base}/chat.json`, JSON.stringify(messages, null, 2));
      }
      return { name };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.tree(variables.project, "components"),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.componentCode(variables.project, variables.name),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.componentChat(variables.project, variables.name),
      });
      // Bump treeVersion so explorer auto-refreshes
      useExplorerStore.getState().refresh();
    },
  });
}

export function useSaveTheme() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      project,
      name,
      css,
    }: {
      project: string;
      name: string;
      css: string;
    }) => {
      const base = `projects/${project}/themes/${name}`;
      await createDir(base);
      await writeFile(`${base}/theme.css`, css);
      return { name };
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: projectKeys.tree(variables.project, "themes"),
      });
      queryClient.invalidateQueries({
        queryKey: projectKeys.themeCss(variables.project, variables.name),
      });
      // Bump treeVersion so explorer auto-refreshes
      useExplorerStore.getState().refresh();
    },
  });
}
