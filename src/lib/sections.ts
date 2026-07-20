/** All sections in order. Shared between ProjectExplorer, SidebarRail, and
 *  projectWatcher so the watcher can map filesystem paths → tree query keys
 *  without importing the component (which would create a cycle). */
export const SECTION_NAMES = ["screens", "components", "themes", "workflows", "apis", "plans"] as const;
export type SectionName = typeof SECTION_NAMES[number];

/** Filesystem path under projects/{id}/ where each section's files live. */
export const SECTION_TREE_PATH: Record<SectionName, string> = {
  screens: "screens",
  components: "components",
  themes: "themes",
  workflows: "workflows",
  apis: "apis",
  plans: "plans",
};