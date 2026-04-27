// Prompt barrel — re-exports from modular prompt files.
// Shared system prompts adapted from ai-ui-generator: https://github.com/ai-ui-generator

// Shared types, constants, helpers
export {
  type IconLibrary,
  ICON_LIBRARY_PACKAGES,
  ICON_LIBRARY_CSS_PATHS,
  getIconLibraryPromptSection,
} from "./prompts/shared";

// Screen prompts
export {
  SCREEN_NEW_PROMPT_BASE,
  SCREEN_UPDATE_PROMPT_BASE,
  getScreenNewPrompt,
  getScreenUpdatePrompt,
} from "./prompts/screens";

// Component prompts
export {
  COMPONENT_NEW_PROMPT_BASE,
  COMPONENT_NEW_PROMPT_SHADCN,
  COMPONENT_UPDATE_PROMPT_BASE,
  COMPONENT_UPDATE_PROMPT_SHADCN,
  getComponentNewPrompt,
  getComponentUpdatePrompt,
} from "./prompts/components";

// Theme prompts
export {
  THEME_TYPE_DOCS,
  THEME_SYSTEM_PROMPT_BASE,
  UI_THEME_SUFFIXES,
  getThemeSystemPrompt,
  getUiThemeSuffix,
} from "./prompts/themes";

// Workflow prompts
export {
  WORKFLOW_REQUIREMENTS_PROMPT_BASE,
  WORKFLOW_ARCHITECT_PROMPT_BASE,
  WORKFLOW_STRUCTURE_PROMPT_BASE,
  WORKFLOW_STYLE_PROMPT_BASE,
  WORKFLOW_INTERACTION_PROMPT_BASE,
  WORKFLOW_REFERENCE_PROMPT_BASE,
  WORKFLOW_VALIDATE_PROMPT_BASE,
  WORKFLOW_TRANSFORM_PROMPT_BASE,
} from "./prompts/workflows";

// ─── Prompt definitions — used by SettingsModal for editable prompt slots ────

import { COMPONENT_NEW_PROMPT_BASE } from "./prompts/components";
import { COMPONENT_NEW_PROMPT_SHADCN } from "./prompts/components";
import { COMPONENT_UPDATE_PROMPT_BASE } from "./prompts/components";
import { COMPONENT_UPDATE_PROMPT_SHADCN } from "./prompts/components";
import { SCREEN_NEW_PROMPT_BASE } from "./prompts/screens";
import { SCREEN_UPDATE_PROMPT_BASE } from "./prompts/screens";
import { THEME_SYSTEM_PROMPT_BASE } from "./prompts/themes";
import { THEME_TYPE_DOCS } from "./prompts/themes";
import { WORKFLOW_REQUIREMENTS_PROMPT_BASE } from "./prompts/workflows";
import { WORKFLOW_ARCHITECT_PROMPT_BASE } from "./prompts/workflows";
import { WORKFLOW_STRUCTURE_PROMPT_BASE } from "./prompts/workflows";
import { WORKFLOW_STYLE_PROMPT_BASE } from "./prompts/workflows";
import { WORKFLOW_INTERACTION_PROMPT_BASE } from "./prompts/workflows";
import { WORKFLOW_REFERENCE_PROMPT_BASE } from "./prompts/workflows";
import { WORKFLOW_VALIDATE_PROMPT_BASE } from "./prompts/workflows";
import { WORKFLOW_TRANSFORM_PROMPT_BASE } from "./prompts/workflows";

export type PromptGroup = "Components" | "Screens" | "Themes" | "Workflows";

export interface PromptDefinition {
  key: string;
  label: string;
  group: PromptGroup;
  description: string;
  getDefault: () => string;
}

export const PROMPT_DEFINITIONS: PromptDefinition[] = [
  // Components
  { key: "prompt.components.new",             label: "New Component — base",          group: "Components", description: "System prompt base for generating a brand-new component.",                        getDefault: () => COMPONENT_NEW_PROMPT_BASE },
  { key: "prompt.components.update",          label: "Update Component — base",        group: "Components", description: "System prompt base for editing an existing component.",                             getDefault: () => COMPONENT_UPDATE_PROMPT_BASE },
  { key: "prompt.components.new.shadcn",     label: "New Component — shadcn base",    group: "Components", description: "System prompt base for generating a new component with shadcn/ui.",                getDefault: () => COMPONENT_NEW_PROMPT_SHADCN },
  { key: "prompt.components.update.shadcn",  label: "Update Component — shadcn base", group: "Components", description: "System prompt base for editing an existing component with shadcn/ui.",              getDefault: () => COMPONENT_UPDATE_PROMPT_SHADCN },
  // Screens
  { key: "prompt.screens.new",               label: "New Screen — base",              group: "Screens",    description: "System prompt base for generating a brand-new screen.",                             getDefault: () => SCREEN_NEW_PROMPT_BASE },
  { key: "prompt.screens.update",            label: "Update Screen — base",           group: "Screens",    description: "System prompt base for editing an existing screen.",                               getDefault: () => SCREEN_UPDATE_PROMPT_BASE },
  // Themes
  { key: "prompt.themes.base",               label: "Theme Generator — base",         group: "Themes",     description: "System prompt base shared by all theme framework types.",                          getDefault: () => THEME_SYSTEM_PROMPT_BASE },
  { key: "prompt.themes.shadcn",             label: "Theme Format — shadcn",          group: "Themes",     description: "Token format docs appended when the shadcn framework is selected.",                 getDefault: () => THEME_TYPE_DOCS.shadcn },
  { key: "prompt.themes.daisyui",            label: "Theme Format — daisyUI",         group: "Themes",     description: "Token format docs appended when the daisyUI framework is selected.",               getDefault: () => THEME_TYPE_DOCS.daisyui },
  { key: "prompt.themes.bootstrap",          label: "Theme Format — Bootstrap",       group: "Themes",     description: "Token format docs appended when the Bootstrap framework is selected.",             getDefault: () => THEME_TYPE_DOCS.bootstrap },
  { key: "prompt.themes.generic",            label: "Theme Format — Generic",          group: "Themes",     description: "Token format docs appended when the Generic framework is selected.",                getDefault: () => THEME_TYPE_DOCS.generic },
  // Workflows
  { key: "workflow-requirements-system",     label: "Requirements — system",           group: "Workflows",  description: "Parses free-form input into structured functional requirements with priorities.",     getDefault: () => WORKFLOW_REQUIREMENTS_PROMPT_BASE },
  { key: "workflow-architect-system",        label: "Architect — system",             group: "Workflows",  description: "Designs component hierarchy, data flow, state management, and API contracts.",       getDefault: () => WORKFLOW_ARCHITECT_PROMPT_BASE },
  { key: "workflow-structure-system",        label: "Structure — system",              group: "Workflows",  description: "Generates complete, production-quality React component code.",                        getDefault: () => WORKFLOW_STRUCTURE_PROMPT_BASE },
  { key: "workflow-style-system",            label: "Style — system",                  group: "Workflows",  description: "Applies responsive Tailwind CSS and CSS variable colors to components.",             getDefault: () => WORKFLOW_STYLE_PROMPT_BASE },
  { key: "workflow-interaction-system",      label: "Interaction — system",            group: "Workflows",  description: "Adds state management, event handlers, hooks, and form validation.",                getDefault: () => WORKFLOW_INTERACTION_PROMPT_BASE },
  { key: "workflow-reference-system",        label: "Reference — system",              group: "Workflows",  description: "Analyzes components and libraries, producing structured API documentation.",        getDefault: () => WORKFLOW_REFERENCE_PROMPT_BASE },
  { key: "workflow-validate-system",         label: "Validate — system",               group: "Workflows",  description: "Reviews code for TypeScript errors, missing imports, accessibility, and performance.", getDefault: () => WORKFLOW_VALIDATE_PROMPT_BASE },
  { key: "workflow-transform-system",        label: "Transform — system",              group: "Workflows",  description: "Transforms content per instruction — format conversion, refactoring, extraction.",   getDefault: () => WORKFLOW_TRANSFORM_PROMPT_BASE },
];