// useCreateMode — resolves the current sub-mode of the merged Create panel
// into a typed bag of values the mode components consume: the entity id for
// useChat, the active item name, and a shortcut to the store's openCreate
// method for navigation between sub-modes.

import { useMemo } from "react";
import { useAppStore } from "@/stores/appStore";
import { useProjectSettingsStore } from "@/stores/projectSettingsStore";
import { CREATE_MODES_BY_ID, type CreateMode } from "./createConfig";

export interface UseCreateModeResult {
  createMode: CreateMode;
  openCreate: ReturnType<typeof useProjectSettingsStore.getState>["openCreate"];
  entityId: string;
  activeItem: string | null;
}

export function useCreateMode(): UseCreateModeResult {
  const createMode = useProjectSettingsStore((s) => s.ps.createMode);
  const activeScreen = useProjectSettingsStore((s) => s.ps.activeScreen);
  const activeComponent = useProjectSettingsStore((s) => s.ps.activeComponent);
  const activeTheme = useProjectSettingsStore((s) => s.ps.activeTheme);
  const projectId = useAppStore((s) => s.settings.project);
  const openCreate = useProjectSettingsStore((s) => s.openCreate);

  return useMemo<UseCreateModeResult>(() => {
    const config = CREATE_MODES_BY_ID[createMode];
    let activeItem: string | null = null;
    let entityId: string;

    if (createMode === "wizard") {
      // Wizard is project-level — entity id includes the project id, not
      // a per-item suffix. This matches the original WizardPanel.tsx:181
      // ("projects/{p}/wizard/chat.json") and the plan §3.5 spec.
      activeItem = null;
      entityId = `${config.entityIdPrefix}-${projectId}`;
    } else {
      if (createMode === "screens") activeItem = activeScreen;
      else if (createMode === "components") activeItem = activeComponent;
      else if (createMode === "themes") activeItem = activeTheme;
      entityId = activeItem
        ? `${config.entityIdPrefix}-${activeItem}`
        : `${config.entityIdPrefix}-${config.defaultEntityIdSuffix}`;
    }

    return { createMode, openCreate, entityId, activeItem };
  }, [createMode, activeScreen, activeComponent, activeTheme, projectId, openCreate]);
}
