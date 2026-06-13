// Sub-mode segmented control. Renders 4 buttons (Wizard | Screens | Components
// | Design). On click: updates createMode in the project settings store,
// which swaps in the matching `modes/*` component. Mounted inside each mode's
// CreateChatPanel header (replacing the static mode-name label).
//
// Implemented as a Radix ToggleGroup (the shadcn segmented control) so the
// active state is keyboard-navigable, ARIA-correct, and consistent with the
// rest of the UI. Lucide icons come from CREATE_MODES so the configuration in
// createConfig.ts is the single source of truth for the four sub-modes.

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { CREATE_MODES, type CreateMode } from "./createConfig";

export function CreateModeTabs() {
  const createMode = useProjectSettingsStore((s) => s.ps.createMode);
  const setProjectSettings = useProjectSettingsStore((s) => s.setProjectSettings);
  return (
    <ToggleGroup
      type="single"
      value={createMode}
      onValueChange={(value) => {
        if (value) setProjectSettings({ createMode: value as CreateMode });
      }}
      spacing={0}
      size="sm"
      variant="outline"
    >
      {CREATE_MODES.map((mode) => {
        const Icon = mode.icon;
        return (
          <ToggleGroupItem
            key={mode.id}
            value={mode.id}
            aria-label={mode.label}
            title={mode.label}
          >
            <Icon size={14} />
            {mode.label}
          </ToggleGroupItem>
        );
      })}
    </ToggleGroup>
  );
}
