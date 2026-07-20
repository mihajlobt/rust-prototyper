// One OS-level filesystem watcher per active project. Maps each write to the
// matching react-query cache key (tree, themeCss, componentCode, file) and
// reloads the Zustand themesStore on themes/ writes. Replaces the
// `prototyper:tree-changed` window event — external edits (editor, git
// checkout, scaffold tools) are now detected too.

import { watch, BaseDirectory, type UnwatchFn } from "@tauri-apps/plugin-fs";
import { queryClient } from "@/lib/queryClient";
import { projectKeys } from "@/lib/queryKeys";
import { useThemesStore } from "@/stores/themesStore";
import { SECTION_NAMES, SECTION_TREE_PATH, type SectionName } from "@/lib/sections";

let currentUnwatch: UnwatchFn | null = null;

function invalidateForPath(projectId: string, fullPath: string): void {
  const normalized = fullPath.replace(/\\/g, "/");
  const prefix = `projects/${projectId}/`;
  const idx = normalized.indexOf(prefix);
  if (idx === -1) return;
  const afterPrefix = normalized.slice(idx + prefix.length);
  const segments = afterPrefix.split("/");

  // Per-file queries — match specific file paths
  if (segments[0] === "themes" && segments[2] === "theme.css") {
    queryClient.invalidateQueries({ queryKey: projectKeys.themeCss(projectId, segments[1]) });
  }
  if (segments[0] === "generated" && segments[1] === "src" && segments[2] === "components"
      && segments[4] === "component.tsx") {
    queryClient.invalidateQueries({ queryKey: projectKeys.componentCode(projectId, segments[3]) });
  }
  if (segments[0] === "apis" && segments[1] === "apis.json") {
    queryClient.invalidateQueries({ queryKey: projectKeys.file(projectId, `projects/${projectId}/apis/apis.json`) });
  }

  // Tree queries — match by section (first segment)
  const section = segments[0];
  if ((SECTION_NAMES as readonly string[]).includes(section)) {
    queryClient.invalidateQueries({ queryKey: projectKeys.tree(projectId, SECTION_TREE_PATH[section as SectionName]) });
    if (section === "themes") {
      useThemesStore.getState().loadThemes(projectId);
    }
  }
}

export async function startProjectWatcher(projectId: string): Promise<void> {
  if (currentUnwatch) { currentUnwatch(); currentUnwatch = null; }
  if (!projectId) return;
  try {
    currentUnwatch = await watch(
      `projects/${projectId}`,
      (event) => {
        for (const rawPath of event.paths) {
          invalidateForPath(projectId, rawPath);
        }
      },
      { baseDir: BaseDirectory.AppData, recursive: true, delayMs: 100 },
    );
  } catch (error) {
    console.warn("[projectWatcher] failed to start:", error);
    currentUnwatch = null;
  }
}

export function stopProjectWatcher(): void {
  if (currentUnwatch) { currentUnwatch(); currentUnwatch = null; }
}