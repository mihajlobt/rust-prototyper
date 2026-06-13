// Thin TanStack Query wrapper for re-reading a single project file after the
// model writes it via write_file (same pattern as useThemeCss / useComponentCode
// in useProjectFiles.ts). The caller invalidates/refetches once it observes a
// write to `filePath` (e.g. from onToolWrite).

import { useQuery } from "@tanstack/react-query";
import { readFile } from "@/lib/ipc";
import { projectKeys } from "@/lib/queryKeys";

export function useFileWatcher(projectId: string, filePath: string | null) {
  const query = useQuery({
    queryKey: projectKeys.file(projectId, filePath ?? ""),
    queryFn: async () => {
      if (!filePath) return null;
      try {
        return await readFile(filePath);
      } catch {
        return null;
      }
    },
    enabled: !!projectId && !!filePath,
  });

  return {
    data: query.data ?? null,
    refetch: () => { void query.refetch(); },
  };
}
