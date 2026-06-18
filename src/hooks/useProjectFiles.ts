import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  readDir,
  readFile,
  writeFile,
  createDir,
  historySet,
  type FileEntry,
} from "@/lib/ipc";
import { projectKeys } from "@/lib/queryKeys";

// ─── Queries ───

/** Flat per-section listing — used by panels for dropdowns/lists and sidebar tree */
export function useFlatProjectTree(project: string, section: string) {
  return useQuery({
    queryKey: projectKeys.tree(project, section),
    queryFn: async () => {
      try {
        return await readDir(`projects/${project}/${section}`);
      } catch {
        return [] as FileEntry[];
      }
    },
    enabled: !!project,
  });
}

export function useComponentCode(project: string, name: string | null) {
  return useQuery({
    queryKey: projectKeys.componentCode(project, name || ""),
    queryFn: async () => {
      if (!name) return "";
      try {
        return await readFile(`projects/${project}/generated/src/components/${name}/component.tsx`);
      } catch {
        return "";
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
        await historySet(`${base}/chat.json`, JSON.stringify(messages, null, 2));
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
    },
  });
}
