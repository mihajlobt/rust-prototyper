// Mention resolver for the Plans section.
//
// MentionOption is the data type the autocomplete + preview chips consume.
// The list is built per-kind from the project tree in PlansPanel via
// listFromEntries.

export const MENTION_KINDS = [
  "screen",
  "component",
  "asset",
  "plan",
  "theme",
] as const;

export type MentionKind = (typeof MENTION_KINDS)[number];

export interface MentionOption {
  kind: MentionKind;
  name: string;
  label: string;
}

/** Section path under a project root for a given mention kind. */
export const SECTION_BY_KIND: Record<MentionKind, string> = {
  screen: "screens",
  component: "components",
  asset: "assets",
  plan: "plans",
  theme: "themes",
};

/**
 * Project an array of `FileEntry` listings into `MentionOption[]` for a
 * single kind. Entries whose name starts with `.` (dotfiles) are filtered out.
 */
export function listFromEntries(
  kind: MentionKind,
  entries: Array<{ name: string }>,
): MentionOption[] {
  return entries
    .filter((e) => !e.name.startsWith("."))
    .map((e) => ({
      kind,
      name: e.name,
      label: `${capitalize(kind)} · ${e.name}`,
    }));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
