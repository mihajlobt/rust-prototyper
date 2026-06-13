// CreatePanel — the shell of the merged Create panel.
// Reads the active sub-mode from projectSettingsStore and dispatches to the
// matching `modes/*` component. Each mode file owns its full layout (outer
// Allotment keyed `create-{mode}`, chat + inspector on the left,
// preview + code pane on the right) — only one mode is mounted at a time, so
// only one mode's chat subscription is active. The Wizard|Screens|Components|
// Design segmented control (CreateModeTabs) lives inside each mode's
// CreateChatPanel header, not in this shell.

import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { useCreateMode } from "./create/useCreateMode";
import { WizardMode } from "./create/modes/WizardMode";
import { ScreensMode } from "./create/modes/ScreensMode";
import { ComponentsMode } from "./create/modes/ComponentsMode";
import { ThemesMode } from "./create/modes/ThemesMode";

export function CreatePanel() {
  const activeView = useProjectSettingsStore((s) => s.ps.activeView);
  const { createMode } = useCreateMode();

  // Defensive: only render when the active view is "create". App.tsx
  // already routes by activeView, so this is a redundant safety net.
  if (activeView !== "create") return null;

  return (
    <div className="h-full w-full overflow-hidden">
      {createMode === "wizard" && <WizardMode />}
      {createMode === "screens" && <ScreensMode />}
      {createMode === "components" && <ComponentsMode />}
      {createMode === "themes" && <ThemesMode />}
    </div>
  );
}
