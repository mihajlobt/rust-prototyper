// Navigation manifest — maps screens to routes in the generated/ app router (src/router.tsx).
// The agent can read/write navigation.json to control routing between screens.

import { readFile, writeFile, readDir, isNotFoundError } from "@/lib/ipc";

export interface NavPort {
  id: string;
  name: string;
  direction: "input" | "output";
  type: "navigation" | "data";
  schema: string;
}

export interface NavScreen {
  id: string;
  path: string;
  title: string;
  ports: NavPort[];
  layout?: string;
}

export interface NavLink {
  id: string;
  from: string;
  fromPort: string;
  to: string;
  toPort: string;
  type: "navigation" | "data";
  payloadSchema?: string;
  params?: Record<string, string>;
}

export interface Hotspot {
  id: string;
  screenId: string;
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  targetScreenId: string;
  portId: string;
  createdAt: number;
}

export interface Navigation {
  defaultScreen: string;
  screens: NavScreen[];
  links: NavLink[];
  hotspots: Hotspot[];
}

const NAVIGATION_FILE = "navigation.json";

function defaultNav(): Navigation {
  return { defaultScreen: "", screens: [], links: [], hotspots: [] };
}

export async function loadNavigation(projectDir: string): Promise<Navigation> {
  try {
    const raw = await readFile(`${projectDir}/${NAVIGATION_FILE}`);
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("screens" in parsed)) {
      throw new Error(`navigation.json has unexpected shape`);
    }
    const nav = parsed as Partial<Navigation>;
    return {
      defaultScreen: nav.defaultScreen ?? "",
      screens: nav.screens ?? [],
      links: nav.links ?? [],
      hotspots: nav.hotspots ?? [],
    };
  } catch (e) {
    if (isNotFoundError(e)) return defaultNav();
    throw e;
  }
}

export async function saveNavigation(projectDir: string, nav: Navigation): Promise<void> {
  await writeFile(`${projectDir}/${NAVIGATION_FILE}`, JSON.stringify(nav, null, 2));
}

export function getDefaultPorts(screenId: string): NavPort[] {
  return [
    { id: `${screenId}:default-in`, name: "Default In", direction: "input", type: "navigation", schema: "{}" },
    { id: `${screenId}:default-out`, name: "Default Out", direction: "output", type: "navigation", schema: "{}" },
  ];
}

export async function addScreenToNavigation(projectDir: string, screenId: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  if (nav.screens.some((s) => s.id === screenId)) return;
  nav.screens.push({
    id: screenId,
    path: `/${screenId}`,
    title: screenId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    ports: getDefaultPorts(screenId),
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

export async function addNavLink(
  projectDir: string,
  from: string,
  fromPort: string,
  to: string,
  toPort: string,
  type: "navigation" | "data" = "navigation",
  params?: Record<string, string>
): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const id = `${from}:${fromPort}->${to}:${toPort}`;
  if (nav.links.some((l) => l.id === id)) return;
  nav.links.push({ id, from, fromPort, to, toPort, type, params });
  await saveNavigation(projectDir, nav);
}

export async function removeNavLink(projectDir: string, linkId: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  nav.links = nav.links.filter((l) => l.id !== linkId);
  await saveNavigation(projectDir, nav);
}

export async function updateNavLink(
  projectDir: string,
  linkId: string,
  updates: Partial<Pick<NavLink, "fromPort" | "toPort" | "type" | "payloadSchema" | "params">>
): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const link = nav.links.find((l) => l.id === linkId);
  if (!link) return;
  Object.assign(link, updates);
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
  for (const link of nav.links) {
    if (link.from === oldId) { link.from = newId; link.id = `${newId}:${link.fromPort}->${link.to}:${link.toPort}`; }
    if (link.to === oldId)   { link.to = newId; link.id = `${link.from}:${link.fromPort}->${newId}:${link.toPort}`; }
  }
  if (nav.defaultScreen === oldId) nav.defaultScreen = newId;
  await saveNavigation(projectDir, nav);
}

export async function updateScreenPorts(
  projectDir: string,
  screenId: string,
  ports: NavPort[]
): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const screen = nav.screens.find((s) => s.id === screenId);
  if (!screen) return;
  screen.ports = ports;
  await saveNavigation(projectDir, nav);
}

export async function updateScreenLayout(
  projectDir: string,
  screenId: string,
  layout: string | undefined
): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const screen = nav.screens.find((s) => s.id === screenId);
  if (!screen) return;
  screen.layout = layout;
  await saveNavigation(projectDir, nav);
}

export async function addHotspot(projectDir: string, hotspot: Hotspot): Promise<void> {
  const nav = await loadNavigation(projectDir);
  nav.hotspots.push(hotspot);
  await saveNavigation(projectDir, nav);
}

export async function removeHotspot(projectDir: string, hotspotId: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const hotspot = nav.hotspots.find((h) => h.id === hotspotId);
  if (hotspot) {
    const screen = nav.screens.find((s) => s.id === hotspot.screenId);
    if (screen) {
      screen.ports = (screen.ports ?? []).filter((p) => p.id !== hotspot.portId);
    }
    nav.links = nav.links.filter((l) => l.fromPort !== hotspot.portId);
  }
  nav.hotspots = nav.hotspots.filter((h) => h.id !== hotspotId);
  await saveNavigation(projectDir, nav);
}

export async function getHotspotsForScreen(projectDir: string, screenId: string): Promise<Hotspot[]> {
  const nav = await loadNavigation(projectDir);
  return nav.hotspots.filter((h) => h.screenId === screenId);
}

export async function createHotspotWithLink(
  projectDir: string,
  screenId: string,
  portId: string,
  selector: string,
  rect: { x: number; y: number; w: number; h: number },
  targetScreenId: string
): Promise<Hotspot> {
  const nav = await loadNavigation(projectDir);
  const screen = nav.screens.find((s) => s.id === screenId);
  if (!screen) throw new Error(`Screen ${screenId} not found`);
  screen.ports ??= [];

  const hotspot: Hotspot = {
    id: `hotspot-${Date.now()}`,
    screenId,
    selector,
    rect,
    targetScreenId,
    portId,
    createdAt: Date.now(),
  };

  const port: NavPort = {
    id: portId,
    name: selector.split(" ").pop() ?? "Hotspot",
    direction: "output",
    type: "navigation",
    schema: "{}",
  };

  if (!screen.ports.find((p) => p.id === portId)) {
    screen.ports.push(port);
  }

  nav.hotspots.push(hotspot);

  // Add the nav link inline (avoids a second read-modify-write that would overwrite the hotspot)
  const targetPortId = `${targetScreenId}:default-in`;
  if (!nav.links.find((l) => l.fromPort === portId)) {
    nav.links.push({
      id: `link-${Date.now()}`,
      from: screenId,
      fromPort: portId,
      to: targetScreenId,
      toPort: targetPortId,
      type: "navigation",
    });
  }

  await saveNavigation(projectDir, nav);
  return hotspot;
}

function getChildPath(path: string, parentPath: string): string {
  return path.startsWith(parentPath + "/") ? path.slice(parentPath.length + 1) : path;
}

export async function syncGeneratedRouter(projectDir: string): Promise<void> {
  const generatedDir = `${projectDir}/generated`;

  try { await readFile(`${generatedDir}/package.json`); } catch { return; }

  const nav = await loadNavigation(projectDir);
  const navById = new Map(nav.screens.map((s) => [s.id, s]));

  let pageIds: string[] = [];
  try {
    const entries = await readDir(`${generatedDir}/src/pages`);
    pageIds = entries
      .filter((e) => !e.is_dir && e.name.endsWith(".tsx"))
      .map((e) => e.name.replace(/\.tsx$/, ""));
  } catch { /* no pages yet */ }

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

  const layoutGroups = new Map<string | null, string[]>();
  for (const screen of nav.screens) {
    if (!pageIds.includes(screen.id)) continue;
    const groupKey = screen.layout ?? null;
    if (!layoutGroups.has(groupKey)) layoutGroups.set(groupKey, []);
    layoutGroups.get(groupKey)!.push(screen.id);
  }

  function buildRoutes(screenIdsGroup: string[]): string {
    return screenIdsGroup
      .map((id) => {
        const path = navById.get(id)?.path ?? `/${id}`;
        const idx = pageIds.indexOf(id);
        return `      <Route path="${path}" element={<Page${idx} />} />`;
      })
      .join("\n");
  }

  function buildNestedRoutes(parentId: string, childIds: string[]): string {
    const parentScreen = navById.get(parentId);
    if (!parentScreen) return "";
    const parentIdx = pageIds.indexOf(parentId);
    const childrenRoutes = childIds
      .map((id) => {
        const childPath = navById.get(id)?.path ?? `/${id}`;
        const childLocalPath = getChildPath(childPath, parentScreen.path);
        const idx = pageIds.indexOf(id);
        return `        <Route path="${childLocalPath}" element={<Page${idx} />} />`;
      })
      .join("\n");
    return `      <Route path="${parentScreen.path}" element={<Page${parentIdx} />}>\n${childrenRoutes}\n      </Route>`;
  }

  const topLevelRoutes: string[] = [];
  const nestedRoutes: Array<{ parent: string; children: string[] }> = [];

  for (const [groupKey, screenIdsGroup] of layoutGroups) {
    if (groupKey === null) {
      topLevelRoutes.push(buildRoutes(screenIdsGroup));
    } else {
      const children = screenIdsGroup.filter((id) => id !== groupKey);
      if (children.length > 0 && navById.has(groupKey)) {
        nestedRoutes.push({ parent: groupKey, children });
      } else {
        topLevelRoutes.push(buildRoutes(screenIdsGroup));
      }
    }
  }

  const allPageRoutes = [
    ...topLevelRoutes,
    ...nestedRoutes.map(({ parent, children }) => buildNestedRoutes(parent, children)),
  ].join("\n");

  const componentRoutes = componentIds
    .map((id, i) => `      <Route path="/__preview/${id}" element={<PreviewShell><Comp${i} /></PreviewShell>} />`)
    .join("\n");

  const allRoutes = [allPageRoutes, componentRoutes]
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
