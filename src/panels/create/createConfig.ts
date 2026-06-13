// Per-mode static configuration for the merged Create panel.
// Each entry has the per-mode UI icon, system-prompt builder, tool filter,
// entity-id encoder, and active-item picker. Mode components consume this
// to build their chat panel without each one hand-rolling the same boilerplate.

import type { LucideIcon } from "lucide-react";
import { Wand2, LayoutGrid, Box, Palette } from "lucide-react";
import { getWizardSystemPrompt } from "@/lib/prompts/wizard";
import { getScreenNewPrompt, getScreenUpdatePrompt } from "@/lib/prompts/screens";
import { getComponentNewPrompt, getComponentUpdatePrompt } from "@/lib/prompts/components";
import { getThemeSystemPrompt, getDesignLanguageSystemPrompt } from "@/lib/prompts/themes";
import type { IconLibrary } from "@/lib/prompts/shared";
import {
  WIZARD_TOOL_FILTER_DEFAULT,
  SCREENS_TOOL_FILTER_DEFAULT,
  COMPONENTS_TOOL_FILTER_DEFAULT,
  DESIGN_TOOL_FILTER_DEFAULT,
} from "@/lib/agentToolDefaults";

export type { CreateMode } from "@/stores/projectSettingsStore";
import type { CreateMode } from "@/stores/projectSettingsStore";

export interface SystemPromptContext {
  /** Per-mode item context. */
  iconLibrary?: IconLibrary;
  /** Active design language slug (stylePreset). */
  stylePreset?: string | null;
  /** Current code for the item, used by Update prompts. */
  code?: string;
  /** Other screens' ids for navigation context. */
  screenIds?: string[];
  /** Schema JSON for design language mode. */
  schemaJson?: string;
}

export interface CreateModeConfig {
  id: CreateMode;
  label: string;
  icon: LucideIcon;
  /** Whether the mode needs the dev-server runner. Themes does not. */
  hasRunner: boolean;
  /** Default tool filter for this mode. */
  toolFilter: string[];
  /** Build the system prompt for this mode given the current context. */
  buildSystemPrompt: (projectId: string, ctx: SystemPromptContext) => string;
  /** The chat's storage key prefix (e.g. "wizard", "screen", "component", "theme"). */
  entityIdPrefix: string;
  /** Default entity id when no item is selected. */
  defaultEntityIdSuffix: string;
}

export const CREATE_MODES: readonly CreateModeConfig[] = [
  {
    id: "wizard",
    label: "Wizard",
    icon: Wand2,
    hasRunner: true,
    toolFilter: WIZARD_TOOL_FILTER_DEFAULT,
    buildSystemPrompt: (projectId) => getWizardSystemPrompt(projectId),
    entityIdPrefix: "wizard",
    // Wizard is project-level — the useCreateMode hook uses the project id
    // directly (entityId = `wizard-${projectId}`), not this suffix.
    defaultEntityIdSuffix: "default",
  },
  {
    id: "screens",
    label: "Screens",
    icon: LayoutGrid,
    hasRunner: true,
    toolFilter: SCREENS_TOOL_FILTER_DEFAULT,
    buildSystemPrompt: (_projectId, ctx) =>
      ctx.code && ctx.code.length > 0
        ? getScreenUpdatePrompt(ctx.iconLibrary ?? "lucide", ctx.code, ctx.screenIds)
        : getScreenNewPrompt(ctx.iconLibrary ?? "lucide", ctx.screenIds),
    entityIdPrefix: "screen",
    defaultEntityIdSuffix: "none",
  },
  {
    id: "components",
    label: "Components",
    icon: Box,
    hasRunner: true,
    toolFilter: COMPONENTS_TOOL_FILTER_DEFAULT,
    buildSystemPrompt: (_projectId, ctx) =>
      ctx.code && ctx.code.length > 0
        ? getComponentUpdatePrompt(ctx.iconLibrary ?? "lucide", ctx.code, true)
        : getComponentNewPrompt(ctx.iconLibrary ?? "lucide", true),
    entityIdPrefix: "component",
    defaultEntityIdSuffix: "none",
  },
  {
    id: "themes",
    label: "Design",
    icon: Palette,
    hasRunner: false,
    toolFilter: DESIGN_TOOL_FILTER_DEFAULT,
    buildSystemPrompt: (_projectId, ctx) =>
      ctx.code && ctx.code.length > 0
        ? getDesignLanguageSystemPrompt("shadcn", true, ctx.schemaJson ?? "{}")
        : getThemeSystemPrompt("shadcn"),
    entityIdPrefix: "theme",
    defaultEntityIdSuffix: "main",
  },
] as const;

export const CREATE_MODES_BY_ID: Record<CreateMode, CreateModeConfig> = CREATE_MODES.reduce(
  (acc, mode) => {
    acc[mode.id] = mode;
    return acc;
  },
  {} as Record<CreateMode, CreateModeConfig>,
);
