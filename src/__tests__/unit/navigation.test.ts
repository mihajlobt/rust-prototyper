/**
 * Unit tests for navigation.ts
 *
 * Tests the core screen routing logic: adding/removing/renaming screens,
 * managing nav links, and generating routes.ts and router.tsx file content.
 * All IPC calls are mocked — this tests the logic, not the Tauri layer.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loadNavigation,
  addScreenToNavigation,
  removeScreenFromNavigation,
  renameScreenInNavigation,
  addNavLink,
  removeNavLink,
  syncScreenPreviewRoutes,
  syncGeneratedRouter,
  type Navigation,
} from "@/lib/navigation";

// ─── IPC mock ─────────────────────────────────────────────────────────────────

vi.mock("@/lib/ipc", () => {
  const files = new Map<string, string>();
  const dirs = new Map<string, { name: string; is_dir: boolean }[]>();

  return {
    readFile: vi.fn(async (path: string) => {
      if (!files.has(path)) throw new Error(`File not found: ${path}`);
      return files.get(path)!;
    }),
    writeFile: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    readDir: vi.fn(async (path: string) => {
      return dirs.get(path) ?? [];
    }),
    isNotFoundError: vi.fn((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      return msg.includes("not found") || msg.includes("File not found");
    }),
    __files: files,
    __dirs: dirs,
  };
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROJECT = "projects/test-project";

async function getIpcMocks() {
  const mod = await import("@/lib/ipc");
  const m = mod as unknown as {
    readFile: ReturnType<typeof vi.fn>;
    writeFile: ReturnType<typeof vi.fn>;
    readDir: ReturnType<typeof vi.fn>;
    __files: Map<string, string>;
    __dirs: Map<string, { name: string; is_dir: boolean }[]>;
  };
  return m;
}

async function setNavFile(nav: Navigation) {
  const { __files } = await getIpcMocks();
  __files.set(`${PROJECT}/navigation.json`, JSON.stringify(nav));
}

async function getNavFile(): Promise<Navigation> {
  const { __files } = await getIpcMocks();
  const raw = __files.get(`${PROJECT}/navigation.json`);
  if (!raw) throw new Error("navigation.json was not written");
  return JSON.parse(raw) as Navigation;
}

beforeEach(async () => {
  vi.clearAllMocks();
  const { __files, __dirs } = await getIpcMocks();
  __files.clear();
  __dirs.clear();
});

// ─── loadNavigation ───────────────────────────────────────────────────────────

describe("loadNavigation", () => {
  it("returns empty navigation when file does not exist", async () => {
    const nav = await loadNavigation(PROJECT);
    expect(nav).toEqual({ defaultScreen: "", screens: [], links: [] });
  });

  it("parses a valid navigation.json", async () => {
    await setNavFile({
      defaultScreen: "home",
      screens: [{ id: "home", path: "/home", title: "Home" }],
      links: [],
    });
    const nav = await loadNavigation(PROJECT);
    expect(nav.defaultScreen).toBe("home");
    expect(nav.screens).toHaveLength(1);
    expect(nav.screens[0].path).toBe("/home");
  });

  it("normalizes missing links field from older files", async () => {
    const { __files } = await getIpcMocks();
    __files.set(
      `${PROJECT}/navigation.json`,
      JSON.stringify({ defaultScreen: "home", screens: [{ id: "home", path: "/", title: "Home" }] }),
    );
    const nav = await loadNavigation(PROJECT);
    expect(nav.links).toEqual([]);
  });
});

// ─── addScreenToNavigation ────────────────────────────────────────────────────

describe("addScreenToNavigation", () => {
  it("adds the first screen and sets it as default", async () => {
    await addScreenToNavigation(PROJECT, "dashboard");
    const nav = await getNavFile();
    expect(nav.screens).toHaveLength(1);
    expect(nav.screens[0]).toEqual({ id: "dashboard", path: "/dashboard", title: "Dashboard" });
    expect(nav.defaultScreen).toBe("dashboard");
  });

  it("adds a second screen without changing the default", async () => {
    await addScreenToNavigation(PROJECT, "dashboard");
    await addScreenToNavigation(PROJECT, "settings");
    const nav = await getNavFile();
    expect(nav.screens).toHaveLength(2);
    expect(nav.defaultScreen).toBe("dashboard");
  });

  it("does not add a duplicate screen", async () => {
    await addScreenToNavigation(PROJECT, "dashboard");
    await addScreenToNavigation(PROJECT, "dashboard");
    const nav = await getNavFile();
    expect(nav.screens).toHaveLength(1);
  });

  it("generates a human-readable title from kebab-case id", async () => {
    await addScreenToNavigation(PROJECT, "user-profile");
    const nav = await getNavFile();
    expect(nav.screens[0].title).toBe("User Profile");
  });
});

// ─── removeScreenFromNavigation ───────────────────────────────────────────────

describe("removeScreenFromNavigation", () => {
  it("removes the screen from the list", async () => {
    await setNavFile({
      defaultScreen: "dashboard",
      screens: [
        { id: "dashboard", path: "/dashboard", title: "Dashboard" },
        { id: "settings", path: "/settings", title: "Settings" },
      ],
      links: [],
    });
    await removeScreenFromNavigation(PROJECT, "settings");
    const nav = await getNavFile();
    expect(nav.screens).toHaveLength(1);
    expect(nav.screens[0].id).toBe("dashboard");
  });

  it("removes links that reference the deleted screen", async () => {
    await setNavFile({
      defaultScreen: "dashboard",
      screens: [
        { id: "dashboard", path: "/", title: "Dashboard" },
        { id: "settings", path: "/settings", title: "Settings" },
      ],
      links: [{ id: "dashboard->settings", from: "dashboard", to: "settings" }],
    });
    await removeScreenFromNavigation(PROJECT, "settings");
    const nav = await getNavFile();
    expect(nav.links).toHaveLength(0);
  });

  it("promotes the next screen to default when the default is removed", async () => {
    await setNavFile({
      defaultScreen: "home",
      screens: [
        { id: "home", path: "/", title: "Home" },
        { id: "about", path: "/about", title: "About" },
      ],
      links: [],
    });
    await removeScreenFromNavigation(PROJECT, "home");
    const nav = await getNavFile();
    expect(nav.defaultScreen).toBe("about");
  });

  it("sets defaultScreen to empty string when the last screen is removed", async () => {
    await setNavFile({
      defaultScreen: "home",
      screens: [{ id: "home", path: "/", title: "Home" }],
      links: [],
    });
    await removeScreenFromNavigation(PROJECT, "home");
    const nav = await getNavFile();
    expect(nav.defaultScreen).toBe("");
    expect(nav.screens).toHaveLength(0);
  });
});

// ─── renameScreenInNavigation ─────────────────────────────────────────────────

describe("renameScreenInNavigation", () => {
  it("updates id, path, and title of the renamed screen", async () => {
    await setNavFile({
      defaultScreen: "home",
      screens: [{ id: "home", path: "/home", title: "Home" }],
      links: [],
    });
    await renameScreenInNavigation(PROJECT, "home", "landing");
    const nav = await getNavFile();
    expect(nav.screens[0]).toEqual({ id: "landing", path: "/landing", title: "Landing" });
  });

  it("updates links that reference the renamed screen", async () => {
    await setNavFile({
      defaultScreen: "home",
      screens: [
        { id: "home", path: "/", title: "Home" },
        { id: "about", path: "/about", title: "About" },
      ],
      links: [{ id: "home->about", from: "home", to: "about" }],
    });
    await renameScreenInNavigation(PROJECT, "home", "landing");
    const nav = await getNavFile();
    expect(nav.links[0]).toEqual({ id: "landing->about", from: "landing", to: "about" });
  });

  it("updates defaultScreen when the default is renamed", async () => {
    await setNavFile({
      defaultScreen: "home",
      screens: [{ id: "home", path: "/", title: "Home" }],
      links: [],
    });
    await renameScreenInNavigation(PROJECT, "home", "landing");
    const nav = await getNavFile();
    expect(nav.defaultScreen).toBe("landing");
  });
});

// ─── addNavLink / removeNavLink ───────────────────────────────────────────────

describe("addNavLink", () => {
  it("adds a link between two screens", async () => {
    await setNavFile({ defaultScreen: "", screens: [], links: [] });
    await addNavLink(PROJECT, "home", "about");
    const nav = await getNavFile();
    expect(nav.links).toHaveLength(1);
    expect(nav.links[0]).toEqual({ id: "home->about", from: "home", to: "about" });
  });

  it("does not add a duplicate link", async () => {
    await setNavFile({ defaultScreen: "", screens: [], links: [] });
    await addNavLink(PROJECT, "home", "about");
    await addNavLink(PROJECT, "home", "about");
    const nav = await getNavFile();
    expect(nav.links).toHaveLength(1);
  });
});

describe("removeNavLink", () => {
  it("removes a link by id", async () => {
    await setNavFile({
      defaultScreen: "",
      screens: [],
      links: [
        { id: "home->about", from: "home", to: "about" },
        { id: "about->contact", from: "about", to: "contact" },
      ],
    });
    await removeNavLink(PROJECT, "home->about");
    const nav = await getNavFile();
    expect(nav.links).toHaveLength(1);
    expect(nav.links[0].id).toBe("about->contact");
  });
});

// ─── syncScreenPreviewRoutes ──────────────────────────────────────────────────

describe("syncScreenPreviewRoutes", () => {
  it("generates an empty routes.ts when no screens exist", async () => {
    const { __files } = await getIpcMocks();
    await setNavFile({ defaultScreen: "", screens: [], links: [] });
    await syncScreenPreviewRoutes(PROJECT);
    const routes = __files.get(`${PROJECT}/screen-preview/src/routes.ts`);
    expect(routes).toBeDefined();
    expect(routes).toContain("routes: Array");
    expect(routes).toContain('defaultPath = "/"');
  });

  it("generates correct imports and route array for discovered screens", async () => {
    const { __files, __dirs } = await getIpcMocks();
    __dirs.set(`${PROJECT}/screens`, [
      { name: "home", is_dir: true },
      { name: "about", is_dir: true },
    ]);
    __files.set(`${PROJECT}/screens/home/screen.tsx`, "export default function App() {}");
    __files.set(`${PROJECT}/screens/about/screen.tsx`, "export default function App() {}");
    await setNavFile({
      defaultScreen: "home",
      screens: [
        { id: "home", path: "/", title: "Home" },
        { id: "about", path: "/about", title: "About" },
      ],
      links: [],
    });

    await syncScreenPreviewRoutes(PROJECT);

    const routes = __files.get(`${PROJECT}/screen-preview/src/routes.ts`)!;
    expect(routes).toContain("import Screen0 from '@/screens/home/screen'");
    expect(routes).toContain("import Screen1 from '@/screens/about/screen'");
    expect(routes).toContain('path: "/"');
    expect(routes).toContain('path: "/about"');
    expect(routes).toContain('defaultPath = "/"');
  });

  it("skips screen directories that have no screen.tsx on disk", async () => {
    const { __files, __dirs } = await getIpcMocks();
    __dirs.set(`${PROJECT}/screens`, [
      { name: "home", is_dir: true },
      { name: "draft", is_dir: true }, // no screen.tsx
    ]);
    __files.set(`${PROJECT}/screens/home/screen.tsx`, "export default function App() {}");
    await setNavFile({
      defaultScreen: "home",
      screens: [
        { id: "home", path: "/", title: "Home" },
        { id: "draft", path: "/draft", title: "Draft" },
      ],
      links: [],
    });

    await syncScreenPreviewRoutes(PROJECT);

    const routes = __files.get(`${PROJECT}/screen-preview/src/routes.ts`)!;
    expect(routes).toContain("import Screen0 from '@/screens/home/screen'");
    expect(routes).not.toContain("draft");
  });
});

// ─── syncGeneratedRouter ──────────────────────────────────────────────────────

describe("syncGeneratedRouter", () => {
  it("does nothing when generated/ is not scaffolded", async () => {
    const { writeFile } = await getIpcMocks();
    await setNavFile({ defaultScreen: "", screens: [], links: [] });
    await syncGeneratedRouter(PROJECT);
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("generates an empty Routes component when no screens exist", async () => {
    const { __files } = await getIpcMocks();
    __files.set(`${PROJECT}/generated/package.json`, "{}");
    await setNavFile({ defaultScreen: "", screens: [], links: [] });
    await syncGeneratedRouter(PROJECT);
    const router = __files.get(`${PROJECT}/generated/src/router.tsx`)!;
    expect(router).toContain("AppRouter");
    expect(router).not.toContain("import Screen");
  });

  it("generates correct imports and routes for each screen", async () => {
    const { __files, __dirs } = await getIpcMocks();
    __files.set(`${PROJECT}/generated/package.json`, "{}");
    __dirs.set(`${PROJECT}/generated/src/screens`, [
      { name: "home.tsx", is_dir: false },
      { name: "about.tsx", is_dir: false },
    ]);
    await setNavFile({
      defaultScreen: "home",
      screens: [
        { id: "home", path: "/", title: "Home" },
        { id: "about", path: "/about", title: "About" },
      ],
      links: [],
    });

    await syncGeneratedRouter(PROJECT);

    const router = __files.get(`${PROJECT}/generated/src/router.tsx`)!;
    expect(router).toContain("import Screen0 from './screens/home'");
    expect(router).toContain("import Screen1 from './screens/about'");
    expect(router).toContain('path="/"');
    expect(router).toContain('path="/about"');
    expect(router).toContain('Navigate to="/"');
  });
});
