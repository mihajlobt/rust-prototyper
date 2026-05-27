// Navigation manifest — maps screens to routes for the screen-preview router shell
// and the generated/ app router (src/router.tsx).
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
 * Write generated/src/router.tsx from current navigation + screens on disk.
 * Called from FlowsView whenever navigation changes (edges/default screen).
 * Silently skips if generated/ has not been scaffolded yet.
 */
export async function syncGeneratedRouter(projectDir: string): Promise<void> {
  const generatedDir = `${projectDir}/generated`;

  // Skip if generated/ not scaffolded yet
  try { await readFile(`${generatedDir}/package.json`); } catch { return; }

  const nav = await loadNavigation(projectDir);
  const navById = new Map(nav.screens.map((s) => [s.id, s]));

  // Discover screens from generated/src/screens/ (source of truth)
  let screenIds: string[] = [];
  try {
    const entries = await readDir(`${generatedDir}/src/screens`);
    screenIds = entries
      .filter((e) => !e.is_dir && e.name.endsWith(".tsx"))
      .map((e) => e.name.replace(/\.tsx$/, ""));
  } catch { /* no screens yet */ }

  const routerPath = `${generatedDir}/src/router.tsx`;

  if (screenIds.length === 0) {
    await writeFile(routerPath,
      `// Auto-generated from Flows panel. Edit navigation in the Flows panel, not here.\nimport { Routes, Route, Navigate } from 'react-router-dom'\n\nexport function AppRouter() {\n  return (\n    <Routes>\n      <Route path="*" element={<Navigate to="/" replace />} />\n    </Routes>\n  )\n}\n`
    );
    return;
  }

  const defaultId = nav.defaultScreen && screenIds.includes(nav.defaultScreen)
    ? nav.defaultScreen
    : screenIds[0];
  const defaultPath = navById.get(defaultId)?.path ?? `/${defaultId}`;

  const imports = screenIds
    .map((id, i) => `import Screen${i} from './screens/${id}'`)
    .join("\n");

  const routes = screenIds
    .map((id, i) => {
      const path = navById.get(id)?.path ?? `/${id}`;
      return `      <Route path="${path}" element={<Screen${i} />} />`;
    })
    .join("\n");

  await writeFile(routerPath,
    `// Auto-generated from Flows panel. Edit navigation in the Flows panel, not here.\nimport { Routes, Route, Navigate } from 'react-router-dom'\n${imports}\n\nexport function AppRouter() {\n  return (\n    <Routes>\n${routes}\n      <Route path="*" element={<Navigate to="${defaultPath}" replace />} />\n    </Routes>\n  )\n}\n`
  );
}

/**
 * Write screen-preview/src/routes.ts from current screens in navigation.json.
 * Called whenever screens are created, deleted, or renamed.
 * Uses a symlink screen-preview/src/screens → ../../../screens/ set up at scaffold time.
 */
export async function syncScreenPreviewRoutes(projectDir: string): Promise<void> {
  const screenPreviewDir = `${projectDir}/screen-preview`;

  // Discover all screens from the filesystem (source of truth)
  let screenEntries: Array<{ name: string }> = [];
  try {
    const entries = await readDir(`${projectDir}/screens`);
    screenEntries = entries.filter((e) => e.is_dir);
  } catch (e) {
    if (!isNotFoundError(e)) throw e;
  }

  const nav = await loadNavigation(projectDir);
  const navById = new Map(nav.screens.map((s) => [s.id, s]));

  // Build routes from filesystem — only include screens that have a screen.tsx on disk.
  // Directories without a screen.tsx (e.g. created by UI but not yet written by the agent)
  // would cause a Vite import error if included.
  const screenEntriesWithFile = await Promise.all(
    screenEntries.map(async (entry) => {
      try {
        await readFile(`${projectDir}/screens/${entry.name}/screen.tsx`);
        return entry;
      } catch {
        return null;
      }
    })
  );
  const validEntries = screenEntriesWithFile.filter((e): e is { name: string; is_dir: boolean } => e !== null);

  const routes = validEntries.map((entry) => {
    const navEntry = navById.get(entry.name);
    return {
      id: entry.name,
      path: navEntry?.path ?? `/${entry.name}`,
    };
  });

  const defaultPath = nav.defaultScreen
    ? (navById.get(nav.defaultScreen)?.path ?? routes[0]?.path ?? "/")
    : routes[0]?.path ?? "/";

  if (routes.length === 0) {
    await writeFile(
      `${screenPreviewDir}/src/routes.ts`,
      `// Auto-generated by Prototyper — do not edit manually.\nimport type { ComponentType } from 'react';\nexport const routes: Array<{ path: string; component: ComponentType }> = [];\nexport const defaultPath = "/";\n`
    );
    return;
  }

  const imports = routes
    .map((r, i) => `import Screen${i} from '@/screens/${r.id}/screen';`)
    .join("\n");

  const routeArray = routes
    .map((r, i) => `  { path: "${r.path}", component: Screen${i} },`)
    .join("\n");

  const content = `// Auto-generated by Prototyper — do not edit manually.\n${imports}\n\nexport const routes = [\n${routeArray}\n];\n\nexport const defaultPath = "${defaultPath}";\n`;

  await writeFile(`${screenPreviewDir}/src/routes.ts`, content);
}
