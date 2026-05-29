// Navigation manifest — maps screens to routes in the generated/ app router (src/router.tsx).
// The agent can read/write navigation.json to control routing between screens.

import { readFile, writeFile, readDir, isNotFoundError } from "@/lib/ipc";

export interface NavScreen {
  id: string;
  path: string;
  title: string;
}

export interface NavLink {
  id: string;
  from: string;
  to: string;
}

export interface Navigation {
  defaultScreen: string;
  screens: NavScreen[];
  links: NavLink[];
}

const NAVIGATION_FILE = "navigation.json";

function defaultNav(): Navigation {
  return { defaultScreen: "", screens: [], links: [] };
}

export async function loadNavigation(projectDir: string): Promise<Navigation> {
  try {
    const raw = await readFile(`${projectDir}/${NAVIGATION_FILE}`);
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("screens" in parsed)) {
      throw new Error(`navigation.json has unexpected shape`);
    }
    const nav = parsed as Partial<Navigation>;
    // Normalize — older files may be missing links
    return {
      defaultScreen: nav.defaultScreen ?? "",
      screens: nav.screens ?? [],
      links: nav.links ?? [],
    };
  } catch (e) {
    if (isNotFoundError(e)) return defaultNav();
    throw e;
  }
}

export async function saveNavigation(projectDir: string, nav: Navigation): Promise<void> {
  await writeFile(`${projectDir}/${NAVIGATION_FILE}`, JSON.stringify(nav, null, 2));
}

export async function addScreenToNavigation(projectDir: string, screenId: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  if (nav.screens.some((s) => s.id === screenId)) return;
  nav.screens.push({
    id: screenId,
    path: `/${screenId}`,
    title: screenId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  });
  if (!nav.defaultScreen) nav.defaultScreen = screenId;
  await saveNavigation(projectDir, nav);
}

export async function removeScreenFromNavigation(projectDir: string, screenId: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  nav.screens = nav.screens.filter((s) => s.id !== screenId);
  nav.links = nav.links.filter((l) => l.from !== screenId && l.to !== screenId);
  if (nav.defaultScreen === screenId) {
    nav.defaultScreen = nav.screens[0]?.id ?? "";
  }
  await saveNavigation(projectDir, nav);
}

export async function addNavLink(projectDir: string, from: string, to: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const id = `${from}->${to}`;
  if (nav.links.some((l) => l.id === id)) return;
  nav.links.push({ id, from, to });
  await saveNavigation(projectDir, nav);
}

export async function removeNavLink(projectDir: string, linkId: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  nav.links = nav.links.filter((l) => l.id !== linkId);
  await saveNavigation(projectDir, nav);
}

export async function renameScreenInNavigation(projectDir: string, oldId: string, newId: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const screen = nav.screens.find((s) => s.id === oldId);
  if (screen) {
    screen.id = newId;
    screen.path = `/${newId}`;
    screen.title = newId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // Update any links that reference the renamed screen
  for (const link of nav.links) {
    if (link.from === oldId) { link.from = newId; link.id = `${newId}->${link.to}`; }
    if (link.to === oldId)   { link.to = newId;   link.id = `${link.from}->${newId}`; }
  }
  if (nav.defaultScreen === oldId) nav.defaultScreen = newId;
  await saveNavigation(projectDir, nav);
}

/**
 * Write generated/src/router.tsx from current navigation + pages + components on disk.
 * Called from FlowsView, ComponentsPanel, and ScreensPanel whenever content changes.
 * Silently skips if generated/ has not been scaffolded yet.
 */
export async function syncGeneratedRouter(projectDir: string): Promise<void> {
  const generatedDir = `${projectDir}/generated`;

  // Skip if generated/ not scaffolded yet
  try { await readFile(`${generatedDir}/package.json`); } catch { return; }

  const nav = await loadNavigation(projectDir);
  const navById = new Map(nav.screens.map((s) => [s.id, s]));

  // Discover pages from generated/src/pages/ (source of truth for screens)
  let pageIds: string[] = [];
  try {
    const entries = await readDir(`${generatedDir}/src/pages`);
    pageIds = entries
      .filter((e) => !e.is_dir && e.name.endsWith(".tsx"))
      .map((e) => e.name.replace(/\.tsx$/, ""));
  } catch { /* no pages yet */ }

  // Discover components from generated/src/components/ (subdirs with component.tsx)
  let componentIds: string[] = [];
  try {
    const entries = await readDir(`${generatedDir}/src/components`);
    const dirs = entries.filter((e) => e.is_dir && e.name !== "ui");
    const checks = await Promise.all(
      dirs.map(async (e) => {
        try {
          await readFile(`${generatedDir}/src/components/${e.name}/component.tsx`);
          return e.name;
        } catch { return null; }
      })
    );
    componentIds = checks.filter(Boolean) as string[];
  } catch { /* no components yet */ }

  const routerPath = `${generatedDir}/src/router.tsx`;

  const defaultId = nav.defaultScreen && pageIds.includes(nav.defaultScreen)
    ? nav.defaultScreen
    : pageIds[0] ?? null;
  const defaultNavPath = defaultId
    ? (navById.get(defaultId)?.path ?? `/${defaultId}`)
    : "/";

  const pageImports = pageIds
    .map((id, i) => `import Page${i} from './pages/${id}'`)
    .join("\n");

  const componentImports = componentIds
    .map((id, i) => `import Comp${i} from './components/${id}/component'`)
    .join("\n");

  const themeImport = `import ThemePreview from './__theme-preview'`;

  const pageRoutes = pageIds
    .map((id, i) => {
      const path = navById.get(id)?.path ?? `/${id}`;
      return `      <Route path="${path}" element={<Page${i} />} />`;
    })
    .join("\n");

  const componentRoutes = componentIds
    .map((id, i) => `      <Route path="/__preview/${id}" element={<PreviewShell><Comp${i} /></PreviewShell>} />`)
    .join("\n");

  const allRoutes = [pageRoutes, componentRoutes]
    .filter(Boolean)
    .join("\n");

  const previewShell = `
function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background p-4 flex items-start justify-center">
      <div className="w-full max-w-lg">{children}</div>
    </div>
  )
}
`.trim();

  const hasAnyRoutes = pageIds.length > 0 || componentIds.length > 0;

  const content = `// Auto-generated — edit navigation in the Flows panel, not here.
import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
${pageImports}
${componentImports}
${themeImport}

${previewShell}

export function AppRouter() {
  return (
    <Routes>
${allRoutes}
      <Route path="/__theme-preview" element={<ThemePreview />} />
      <Route path="*" element={<Navigate to="${hasAnyRoutes ? defaultNavPath : "/__theme-preview"}" replace />} />
    </Routes>
  )
}
`;

  await writeFile(routerPath, content);
}

