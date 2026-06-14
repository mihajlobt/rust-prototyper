/**
 * Shared constants and templates for scaffolding shadcn/ui projects.
 *
 * Follows the shadcn Vite installation docs exactly:
 * https://ui.shadcn.com/docs/installation/vite
 *
 * Key convention: `shadcn init -t vite --name X`
 * creates a subdirectory named X in the CWD. So we run it in the parent
 * directory (e.g. projects/{id}/) and it creates projects/{id}/X/.
 *
 * This file is a barrel that re-exports from the split modules under
 * ./scaffold-shadcn/ — consumers should keep importing from
 * "@/lib/scaffold-shadcn" so import paths stay stable.
 */

export {
  PROJECT_PATHS,
  SHADCN_ADD_COMMAND,
  SHADCN_INIT_COMMAND,
  patchEslintConfig,
  patchViteFsAllow,
  patchViteResolveDedupe,
  getGeneratedDirPath,
} from "./scaffold-shadcn/constants";

export {
  getGeneratedAppTsx,
  getRouterTsx,
  getGeneratedViteConfig,
} from "./scaffold-shadcn/templates";

export { getGeneratedMainTsx } from "./scaffold-shadcn/main-template";

export { getThemePreviewTsx } from "./scaffold-shadcn/theme-preview";

export { getJsxDevRuntimeShim, getJsxDevRuntimeShimTypes } from "./scaffold-shadcn/jsx-dev-runtime-template";
