/**
 * Unit tests for the prompt assembly functions.
 *
 * The system prompts are the core contract between the app and the AI model.
 * These tests verify that the prompt functions produce the right structure,
 * include required sections, and correctly embed dynamic content (icon library,
 * existing code, output path, navigation).
 */

import { describe, it, expect } from "vitest";
import {
  getComponentNewPrompt,
  getComponentUpdatePrompt,
  COMPONENT_NEW_PROMPT_SHADCN,
} from "@/lib/prompts/components";
import { getScreenNewPrompt, getScreenUpdatePrompt } from "@/lib/prompts/screens";
import { getThemeSystemPrompt } from "@/lib/prompts/themes";
import { getPlansResearchSystemPrompt } from "@/lib/prompts/plans";
import {
  outputFilePathSection,
  getIconLibraryPromptSection,
} from "@/lib/prompts/shared";

// ─── Icon library section ─────────────────────────────────────────────────────

describe("getIconLibraryPromptSection", () => {
  it("lucide: mentions import from lucide-react", () => {
    const section = getIconLibraryPromptSection("lucide");
    expect(section).toContain("lucide-react");
    expect(section).toContain("import");
  });

  it("tabler: uses CSS class approach, no import", () => {
    const section = getIconLibraryPromptSection("tabler");
    expect(section).toContain("ti-");
    expect(section).not.toContain("import {");
  });

  it("none: tells model not to use any icon library", () => {
    const section = getIconLibraryPromptSection("none");
    expect(section.toLowerCase()).toMatch(/no.*icon|do not use/);
  });

  it("returns a non-empty string for every supported library", () => {
    const libs = ["lucide", "tabler", "fontawesome", "bootstrap", "material", "none"] as const;
    for (const lib of libs) {
      expect(getIconLibraryPromptSection(lib).length).toBeGreaterThan(0);
    }
  });
});

// ─── outputFilePathSection ────────────────────────────────────────────────────

describe("outputFilePathSection", () => {
  it("includes the provided path verbatim", () => {
    const section = outputFilePathSection("projects/abc123/screens/dashboard/screen.tsx");
    expect(section).toContain("projects/abc123/screens/dashboard/screen.tsx");
  });
});

// ─── Component prompts ────────────────────────────────────────────────────────

describe("getComponentNewPrompt", () => {
  it("includes the lucide icon library section for lucide", () => {
    const prompt = getComponentNewPrompt("lucide");
    expect(prompt).toContain("lucide-react");
  });

  it("shadcn mode: includes shadcn component imports instruction", () => {
    const prompt = getComponentNewPrompt("lucide", true);
    expect(prompt).toContain("shadcn");
    expect(prompt).toContain("@/components/ui");
  });

  it("base mode (non-shadcn): does NOT include shadcn imports", () => {
    const prompt = getComponentNewPrompt("lucide", false);
    expect(prompt).not.toContain("@/components/ui/button");
  });

  it("explicitly forbids full-page layouts", () => {
    const prompt = getComponentNewPrompt("lucide");
    expect(prompt.toLowerCase()).toMatch(/do not generate|not a full.page/);
  });

  it("COMPONENT_NEW_PROMPT_SHADCN is returned when shadcnMode=true", () => {
    const prompt = getComponentNewPrompt("lucide", true);
    expect(prompt).toContain(COMPONENT_NEW_PROMPT_SHADCN.slice(0, 60));
  });
});

describe("getComponentUpdatePrompt", () => {
  it("includes the current code when provided", () => {
    const code = "function App() { return <div>hello</div>; }";
    const prompt = getComponentUpdatePrompt("lucide", code);
    expect(prompt).toContain(code);
  });

  it("does not include a code block when no current code given", () => {
    const prompt = getComponentUpdatePrompt("lucide");
    expect(prompt).not.toContain("CURRENT CODE");
  });

  it("instructs the model to apply only the requested changes", () => {
    const prompt = getComponentUpdatePrompt("lucide");
    expect(prompt.toLowerCase()).toContain("apply only");
  });
});

// ─── Screen prompts ───────────────────────────────────────────────────────────

describe("getScreenNewPrompt", () => {
  it("includes the lucide icon section", () => {
    const prompt = getScreenNewPrompt("lucide");
    expect(prompt).toContain("lucide-react");
  });

  it("is distinct from the component prompt (screens are full-page)", () => {
    const screenPrompt = getScreenNewPrompt("lucide");
    const componentPrompt = getComponentNewPrompt("lucide");
    // Screen prompt should NOT restrict to 400px — that's component-only
    expect(componentPrompt).toContain("400px");
    expect(screenPrompt).not.toContain("400px");
  });

  it("exports default function App as the contract", () => {
    const prompt = getScreenNewPrompt("lucide");
    expect(prompt).toContain("export default function App");
  });

  it("includes navigation section when screen IDs are provided", () => {
    const prompt = getScreenNewPrompt("lucide", ["home", "about"]);
    expect(prompt).toContain("home");
    expect(prompt).toContain("about");
  });
});

describe("getScreenUpdatePrompt", () => {
  it("includes the current code block when provided", () => {
    const existing = "export default function App() { return <div>screen</div>; }";
    const prompt = getScreenUpdatePrompt("lucide", existing);
    expect(prompt).toContain("CURRENT CODE");
    expect(prompt).toContain(existing);
  });

  it("preserves existing functionality instruction", () => {
    const prompt = getScreenUpdatePrompt("lucide");
    expect(prompt.toLowerCase()).toContain("preserve");
  });
});

// ─── Theme prompts ────────────────────────────────────────────────────────────

describe("getThemeSystemPrompt", () => {
  it("shadcn mode: mentions oklch color format", () => {
    const prompt = getThemeSystemPrompt("shadcn");
    expect(prompt.toLowerCase()).toContain("oklch");
  });

  it("requires :root or .dark CSS blocks", () => {
    const prompt = getThemeSystemPrompt("shadcn");
    expect(prompt).toMatch(/:root|\.dark/);
  });

  it("mentions shadcn CSS variable names", () => {
    const prompt = getThemeSystemPrompt("shadcn");
    expect(prompt).toContain("--background");
    expect(prompt).toContain("--primary");
  });
});

// ─── Plans prompts ───────────────────────────────────────────────────────────

describe("getPlansResearchSystemPrompt", () => {
  const params = {
    projectName: "demo",
    planName: "research-doc",
    projectLayout: { screens: [], components: [], themes: [], plans: [], assets: [] },
  };

  it("instructs the agent to search and cite sources", () => {
    const prompt = getPlansResearchSystemPrompt(params);
    expect(prompt.toLowerCase()).toContain("web_search");
    expect(prompt.toLowerCase()).toMatch(/cite|citation|source/);
  });

  it("still includes the shared syntax reference (tabs, callouts, frontmatter)", () => {
    const prompt = getPlansResearchSystemPrompt(params);
    expect(prompt).toContain("FRONTMATTER");
    expect(prompt).toContain("TABS");
  });

  it("restricts Mermaid diagram types to the GitHub-confirmed set", () => {
    const prompt = getPlansResearchSystemPrompt(params);
    expect(prompt).toMatch(/gantt/);
    expect(prompt.toLowerCase()).toContain("avoid");
  });
});
