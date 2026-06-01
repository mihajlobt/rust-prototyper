// Navigation manifest — maps screens to routes in the generated/ app router (src/router.tsx).
// The agent can read/write navigation.json to control routing between screens.

import { readFile, writeFile, readDir, isNotFoundError } from "@/lib/ipc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NavScreen {
  id: string;
  path: string;
  title: string;
  layout?: string;
  /** Canvas position in the Flows view */
  x?: number;
  y?: number;
}

export interface Hotspot {
  id: string;
  screenId: string;
  selector: string;
  rect: { x: number; y: number; w: number; h: number };
  targetScreenId: string;
  name?: string;
  params?: Record<string, string>;
  createdAt: number;
}

export interface Navigation {
  defaultScreen: string;
  screens: NavScreen[];
  hotspots: Hotspot[];
}

// ─── Migration ────────────────────────────────────────────────────────────────

export interface MigrationReport {
  syntheticCount: number;
  droppedDataLinkCount: number;
}

type LegacyRaw = {
  defaultScreen?: string;
  screens?: Array<{
    id: string; path: string; title: string;
    layout?: string; x?: number; y?: number;
    ports?: unknown[];
  }>;
  links?: Array<{
    id: string; from: string; fromPort: string; to: string; toPort: string;
    type: "navigation" | "data";
    params?: Record<string, string>;
  }>;
  hotspots?: Array<{
    id: string; screenId: string; selector: string;
    rect: { x: number; y: number; w: number; h: number };
    targetScreenId: string;
    name?: string; params?: Record<string, string>;
    createdAt: number; portId?: string;
  }>;
};

function migrateNavigation(
  data: LegacyRaw,
  onMigration?: (report: MigrationReport) => void
): Navigation {
  const legacyHotspots = data.hotspots ?? [];
  const legacyLinks = data.links ?? [];

  const hotspotByPortId = new Map<string, Hotspot>();
  const newHotspots: Hotspot[] = [];

  for (const lh of legacyHotspots) {
    const h: Hotspot = {
      id: lh.id,
      screenId: lh.screenId,
      selector: lh.selector,
      rect: lh.rect,
      targetScreenId: lh.targetScreenId,
      name: lh.name,
      params: lh.params,
      createdAt: lh.createdAt,
    };
    if (lh.portId) hotspotByPortId.set(lh.portId, h);
    newHotspots.push(h);
  }

  let syntheticCount = 0;
  let droppedDataLinkCount = 0;

  for (const link of legacyLinks) {
    if (link.type === "data") { droppedDataLinkCount++; continue; }
    const existing = hotspotByPortId.get(link.fromPort);
    if (existing) {
      if (!existing.targetScreenId) existing.targetScreenId = link.to;
    } else {
      // Orphan manual link — preserve topology as a logical hotspot (empty selector)
      newHotspots.push({
        id: `hotspot-migrated-${Date.now()}-${syntheticCount}`,
        screenId: link.from,
        selector: "",
        rect: { x: 0, y: 0, w: 0, h: 0 },
        targetScreenId: link.to,
        name: link.fromPort,
        createdAt: Date.now(),
      });
      syntheticCount++;
    }
  }

  const newScreens: NavScreen[] = (data.screens ?? []).map((screen) => ({
    id: screen.id,
    path: screen.path,
    title: screen.title,
    layout: screen.layout,
    x: screen.x,
    y: screen.y,
  }));

  if ((syntheticCount > 0 || droppedDataLinkCount > 0) && onMigration) {
    onMigration({ syntheticCount, droppedDataLinkCount });
  }

  return { defaultScreen: data.defaultScreen ?? "", screens: newScreens, hotspots: newHotspots };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

const NAVIGATION_FILE = "navigation.json";

function defaultNav(): Navigation {
  return { defaultScreen: "", screens: [], hotspots: [] };
}

export async function loadNavigation(
  projectDir: string,
  options?: { onMigration?: (report: MigrationReport) => void }
): Promise<Navigation> {
  try {
    const raw = await readFile(`${projectDir}/${NAVIGATION_FILE}`);
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || !("screens" in parsed)) {
      throw new Error("navigation.json has unexpected shape");
    }
    const data = parsed as LegacyRaw;

    const isLegacy =
      Array.isArray(data.links) ||
      (Array.isArray(data.screens) && data.screens.some((s) => s.ports !== undefined));

    if (isLegacy) {
      const nav = migrateNavigation(data, options?.onMigration);
      await saveNavigation(projectDir, nav).catch((e) => console.warn("Migration save failed:", e));
      return nav;
    }

    return {
      defaultScreen: data.defaultScreen ?? "",
      screens: data.screens ?? [],
      hotspots: data.hotspots ?? [],
    };
  } catch (e) {
    if (isNotFoundError(e)) return defaultNav();
    throw e;
  }
}

export async function saveNavigation(projectDir: string, nav: Navigation): Promise<void> {
  await writeFile(`${projectDir}/${NAVIGATION_FILE}`, JSON.stringify(nav, null, 2));
}

// ─── Display helpers ──────────────────────────────────────────────────────────

function selectorLeaf(selector: string): string {
  return selector.split(" > ").pop()?.replace(/:nth-of-type\(\d+\)/g, "").trim() ?? "";
}

export function hotspotLabel(h: Hotspot): string {
  return (h.name ?? selectorLeaf(h.selector)) || "Element";
}

export function getHotspotLinks(
  nav: Navigation
): Array<{ from: string; to: string; hotspotId: string; selector: string }> {
  return nav.hotspots
    .filter((h) => h.targetScreenId)
    .map((h) => ({ from: h.screenId, to: h.targetScreenId, hotspotId: h.id, selector: h.selector }));
}

// ─── Screen CRUD ──────────────────────────────────────────────────────────────

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
  // Clear target on hotspots pointing to deleted screen (preserves element selection for re-linking)
  for (const h of nav.hotspots) {
    if (h.targetScreenId === screenId) h.targetScreenId = "";
  }
  nav.hotspots = nav.hotspots.filter((h) => h.screenId !== screenId);
  if (nav.defaultScreen === screenId) nav.defaultScreen = nav.screens[0]?.id ?? "";
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
  for (const h of nav.hotspots) {
    if (h.screenId === oldId) h.screenId = newId;
    if (h.targetScreenId === oldId) h.targetScreenId = newId;
  }
  if (nav.defaultScreen === oldId) nav.defaultScreen = newId;
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

// ─── Hotspot CRUD ─────────────────────────────────────────────────────────────

export async function createHotspot(
  projectDir: string,
  screenId: string,
  selector: string,
  rect: { x: number; y: number; w: number; h: number },
  targetScreenId: string,
  name?: string
): Promise<Hotspot> {
  const nav = await loadNavigation(projectDir);
  if (!nav.screens.some((s) => s.id === screenId)) {
    nav.screens.push({
      id: screenId,
      path: `/${screenId}`,
      title: screenId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    });
    if (!nav.defaultScreen) nav.defaultScreen = screenId;
  }
  const hotspot: Hotspot = {
    id: `hotspot-${Date.now()}`,
    screenId,
    selector,
    rect,
    targetScreenId,
    name,
    createdAt: Date.now(),
  };
  nav.hotspots.push(hotspot);
  await saveNavigation(projectDir, nav);
  return hotspot;
}

export async function updateHotspotTarget(
  projectDir: string,
  hotspotId: string,
  targetScreenId: string
): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const hotspot = nav.hotspots.find((h) => h.id === hotspotId);
  if (!hotspot) return;
  hotspot.targetScreenId = targetScreenId;
  await saveNavigation(projectDir, nav);
}

export async function updateHotspotName(
  projectDir: string,
  hotspotId: string,
  name: string | undefined
): Promise<void> {
  const nav = await loadNavigation(projectDir);
  const hotspot = nav.hotspots.find((h) => h.id === hotspotId);
  if (!hotspot) return;
  hotspot.name = name;
  await saveNavigation(projectDir, nav);
}

export async function removeHotspot(projectDir: string, hotspotId: string): Promise<void> {
  const nav = await loadNavigation(projectDir);
  nav.hotspots = nav.hotspots.filter((h) => h.id !== hotspotId);
  await saveNavigation(projectDir, nav);
}

export async function getHotspotsForScreen(projectDir: string, screenId: string): Promise<Hotspot[]> {
  const nav = await loadNavigation(projectDir);
  return nav.hotspots.filter((h) => h.screenId === screenId);
}

// ─── Router generation ────────────────────────────────────────────────────────

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

  // Build hotspot navigation links: { selector, path }
  const hotspotLinks = nav.hotspots
    .filter((h) => h.targetScreenId && h.selector)
    .map((h) => {
      const targetPath = navById.get(h.targetScreenId)?.path ?? `/${h.targetScreenId}`;
      return `  { selector: ${JSON.stringify(h.selector)}, path: ${JSON.stringify(targetPath)} }`;
    });

  // Links array is defined INSIDE the effect so React Fast Refresh re-runs the effect
  // after HMR (since the function body changes), avoiding a stale-closure where the old
  // handler references a previous HOTSPOT_LINKS constant after a connection is deleted.
  const hotspotNavigator = hotspotLinks.length > 0 ? `
function HotspotNavigator() {
  const navigate = useNavigate()
  useEffect(() => {
    const links: Array<{ selector: string; path: string }> = [
${hotspotLinks.join(",\n")},
    ]
    function handler(e: MouseEvent) {
      const target = e.target as Element
      for (const link of links) {
        try {
          if (target.closest(link.selector)) { navigate(link.path); return }
        } catch { /* ignore invalid selectors */ }
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [navigate])
  return null
}
`.trim() : "";

  const content = `// Auto-generated — edit navigation in the Screens panel, not here.
import React, { useEffect } from 'react'
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom'
${pageImports}
${componentImports}
${themeImport}

${previewShell}
${hotspotNavigator ? "\n" + hotspotNavigator : ""}
export function AppRouter() {
  const location = useLocation()
  useEffect(() => {
    window.parent.postMessage({ type: '__route-change', path: location.pathname }, '*')
  }, [location.pathname])
  return (
    <>
      ${hotspotLinks.length > 0 ? "<HotspotNavigator />" : ""}
      <Routes>
${allRoutes}
        <Route path="/__theme-preview" element={<ThemePreview />} />
        <Route path="*" element={<Navigate to="${hasAnyRoutes ? defaultNavPath : "/__theme-preview"}" replace />} />
      </Routes>
    </>
  )
}
`;

  await writeFile(routerPath, content);
}
