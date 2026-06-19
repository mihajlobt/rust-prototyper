# Plan: Tabbed Preview Render + Research Content-Type Toggle for Plans

**Goal:** Add (1) a real tab UI in the Plans preview, driven by stacking `<details>` blocks (no new markdown syntax), and (2) a "Plan | Research" toggle in the Plans toolbar that swaps the preview's render richness and the chat agent's tool access/system prompt — without adding a new layout or pane structure.

**Architecture:** Both features are render-layer-only; the saved `.md` source never changes shape. Part 1 adds a hast-tree transform (`rehype-group-details.ts`) that groups adjacent `<details>` siblings into one marker `div`, and a `reportMode` flag on `PlanPreview`'s existing `components` map that decides whether that marker renders as a plain accordion stack or as `Tabs`. Part 2 adds an orthogonal `plansContentType` toggle (not a 5th `PlanMode`) that forces `reportMode` on, swaps which `panelToolFilter`/`panelMaxToolCalls` key `useChat` reads, and swaps the system prompt.

**Tech Stack:** React 19, `react-markdown` 10 + `remark-gfm`/`remark-github-alerts`/`rehype-raw`, `hast` (types via `@types/hast`, already resolvable — confirmed below), shadcn/Radix `Tabs` (already in repo, unused by Plans), Vitest + `@testing-library/react` (both already dependencies, `jsdom` environment configured) for unit tests, Zustand stores (`appStore`, `projectSettingsStore`).

---

## Corrections made during verification (read this before implementing)

The first draft of this plan (still visible in git history for this file) had four inaccuracies, found by reading the actual source instead of trusting prior assumptions. Fixed below, called out here so the "why" isn't lost:

1. **`web_fetch` is already enabled for Plans.** `PLANS_TOOL_FILTER_DEFAULT` (`src/lib/agentToolDefaults.ts:30-34`) spreads `GENERIC_AGENT_TOOLS` (`agentToolDefaults.ts:1`), which already includes `web_fetch`. Only `web_search` is actually missing from Plans' default tool list. The new Research tool-filter constant only needs to add `web_search`.
2. **`panelToolFilter` / `panelMaxToolCalls` are fixed-shape typed objects, not open maps.** `appStore.ts:47-60` declares them as `{ wizard?: ...; screens?: ...; components?: ...; themes?: ...; plans?: ... }` — adding a `plansResearch` key requires extending these type literals, plus the `PanelKey` union in `AgentsTab.tsx:28`. The original draft's file-change table omitted `appStore.ts` entirely. Fixed in Task 8 below.
3. **Icon collision in the toolbar.** The original draft suggested `FileText`/`Sparkles` for the new toggle, but `PlansPanelParts.tsx` already uses `FileText` for the saved-file badge (line 51) and `Sparkles` for the empty-state hint (line 140) — reusing them for an unrelated toggle in the same file would be visually ambiguous. Switched to `NotebookText` (Plan) / `Telescope` (Research) — both confirmed to exist in `lucide-react`'s type declarations.
4. **The `tabgroup` custom-tag-name design was not type-checkable as drafted.** `react-markdown`'s `Components` type (`node_modules/react-markdown/lib/index.d.ts:68`) is `{ [Key in keyof JSX.IntrinsicElements]?: ... }` — it only accepts known HTML tag names. Adding `tabgroup` as a `Components` key would need a global `JSX.IntrinsicElements` augmentation, and this codebase's React 19 type setup uses `React.JSX.IntrinsicElements` (confirmed via `src/components/ui/response-stream.tsx:285`), making that augmentation path uncertain. **Fixed** by using a plain `div` with a marker class (`className="md-tabgroup"`) instead of a synthetic tag name — `div` is always a valid `Components` key, so no type augmentation is needed at all.

One more pre-existing issue found, **not part of the original ask but directly in the file this plan needs to edit** — flagging per project convention before touching it:

5. **`PLAN_SYNTAX_REFERENCE` (`src/lib/prompts/plans.ts:71-77`) still documents `:::timeline` / `:::details` / `:::columns` / `:::board` / `:::kanban` / `:::callout` directive syntax.** That syntax was removed from the renderer in commit `d6250b3` ("remove directive layer (remark-directive, DirectiveBlocks, directives.ts)") — `remarkDirective` is no longer in `PlanPreview.tsx`'s `remarkPlugins` array. This means the Plans agent's system prompt is currently instructing the model to write syntax that renders as literal broken text (`:::timeline` etc.) in the live preview. Task 1 below removes this stale section and replaces it with documentation of the real, currently-supported `<details>`-stacking convention — the correct location for it anyway, and directly relevant to Part 1.

---

## Part 1 — Tabs in the preview, via stacked `<details>`

### Task 1: Fix the stale syntax reference, document the tabs convention

**Files:**
- Modify: `src/lib/prompts/plans.ts:71-77`

- [ ] **Step 1: Replace the stale DIRECTIVES section**

Replace:
```
DIRECTIVES (fenced \`:::\` blocks — use sparingly):
- \`:::timeline\`   — vertical sequence of dated events
- \`:::details\`    — collapsed content
- \`:::columns\`    — multi-column layout
- \`:::board\`      — kanban columns
- \`:::kanban\`     — same as board
- \`:::callout\`    — generic callout (prefer the \`> [!TYPE]\` syntax above)
```
with:
```
COLLAPSIBLE SECTIONS (native HTML, already supported):
\`\`\`
<details>
<summary>Click to expand</summary>

Body content — can include lists, code blocks, anything.

</details>
\`\`\`

TABS — stack 2+ \`<details>\` blocks back-to-back (no blank prose between them) and the
preview renders them as a tab strip instead of an accordion. Use this when content is
naturally mutually-exclusive (e.g. "Option A" / "Option B" / "Option C"), not for
sequential or optional-reading content (use single \`<details>\` for that).
\`\`\`
<details>
<summary>Option A</summary>

Content for option A.

</details>
<details>
<summary>Option B</summary>

Content for option B.

</details>
\`\`\`
```

- [ ] **Step 2: Run the existing prompt test suite to confirm nothing else references the removed syntax**

Run: `bun run test src/__tests__/unit/prompts.test.ts`
Expected: PASS (this file doesn't currently assert on `PLAN_SYNTAX_REFERENCE` content, so this just confirms the file still parses/exports correctly)

- [ ] **Step 3: Commit**

```bash
git add src/lib/prompts/plans.ts
git commit -m "fix: remove stale directive syntax from Plans prompt, document details-stacking tabs convention"
```

---

### Task 2: `rehype-group-details` — the hast sibling-grouping plugin

**Files:**
- Create: `src/panels/plans/rehype-group-details.ts`
- Test: `src/__tests__/unit/rehype-group-details.test.ts`

This is a pure hast-tree transform: it walks every node's `children` array, finds runs of ≥2 adjacent `element` nodes with `tagName === "details"`, and wraps each run in one new `div` element carrying `className: ["md-tabgroup"]`. A lone `<details>` (no adjacent sibling) is left untouched. The transform never touches the markdown source string.

- [ ] **Step 1: Confirm `hast` types resolve in this project (no new dependency needed)**

Run: `find node_modules -maxdepth 2 -iname "hast" -o -path "*@types/hast*package.json"`
Expected: prints `node_modules/@types/hast/package.json` (confirms `import type { ... } from "hast"` will resolve — `@types/hast` is already present as a transitive dependency)

- [ ] **Step 2: Write the failing test**

```typescript
// src/__tests__/unit/rehype-group-details.test.ts
import { describe, it, expect } from "vitest";
import type { Root, Element } from "hast";
import rehypeGroupDetails, { groupAdjacentDetails } from "@/panels/plans/rehype-group-details";

function details(label: string): Element {
  return {
    type: "element",
    tagName: "details",
    properties: {},
    children: [
      { type: "element", tagName: "summary", properties: {}, children: [{ type: "text", value: label }] },
    ],
  };
}

function paragraph(text: string): Element {
  return {
    type: "element",
    tagName: "p",
    properties: {},
    children: [{ type: "text", value: text }],
  };
}

describe("groupAdjacentDetails", () => {
  it("wraps 2+ adjacent details elements in a div.md-tabgroup", () => {
    const result = groupAdjacentDetails([details("A"), details("B")]);
    expect(result).toHaveLength(1);
    const wrapper = result[0] as Element;
    expect(wrapper.tagName).toBe("div");
    expect(wrapper.properties?.className).toEqual(["md-tabgroup"]);
    expect(wrapper.children).toHaveLength(2);
  });

  it("leaves a lone details element untouched", () => {
    const result = groupAdjacentDetails([paragraph("before"), details("A"), paragraph("after")]);
    expect(result).toHaveLength(3);
    expect((result[1] as Element).tagName).toBe("details");
  });

  it("does not merge details runs separated by other content", () => {
    const result = groupAdjacentDetails([details("A"), paragraph("between"), details("B")]);
    expect(result).toHaveLength(3);
    expect((result[0] as Element).tagName).toBe("details");
    expect((result[2] as Element).tagName).toBe("details");
  });
});

describe("rehypeGroupDetails", () => {
  it("groups details nested inside a blockquote, not just top-level", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "blockquote",
          properties: {},
          children: [details("A"), details("B")],
        },
      ],
    };
    rehypeGroupDetails()(tree);
    const blockquote = tree.children[0] as Element;
    expect(blockquote.children).toHaveLength(1);
    expect((blockquote.children[0] as Element).properties?.className).toEqual(["md-tabgroup"]);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun run test src/__tests__/unit/rehype-group-details.test.ts`
Expected: FAIL with "Cannot find module '@/panels/plans/rehype-group-details'"

- [ ] **Step 4: Write the implementation**

```typescript
// src/panels/plans/rehype-group-details.ts
import type { Root, Element, ElementContent } from "hast";

function isDetailsElement(node: ElementContent): node is Element {
  return node.type === "element" && node.tagName === "details";
}

export function groupAdjacentDetails(children: ElementContent[]): ElementContent[] {
  const result: ElementContent[] = [];
  let run: Element[] = [];

  function flushRun() {
    if (run.length >= 2) {
      result.push({
        type: "element",
        tagName: "div",
        properties: { className: ["md-tabgroup"] },
        children: run,
      });
    } else {
      result.push(...run);
    }
    run = [];
  }

  for (const child of children) {
    if (isDetailsElement(child)) {
      run.push(child);
    } else {
      flushRun();
      result.push(child);
    }
  }
  flushRun();
  return result;
}

function walk(node: Root | Element): void {
  if (!("children" in node)) return;
  node.children = groupAdjacentDetails(node.children as ElementContent[]) as (Root["children"] & Element["children"]);
  for (const child of node.children) {
    if (child.type === "element") walk(child);
  }
}

export default function rehypeGroupDetails() {
  return (tree: Root) => {
    walk(tree);
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun run test src/__tests__/unit/rehype-group-details.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 6: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors. If `node.children = groupAdjacentDetails(...)` raises a type error on the cast, replace the cast with two separate branches (`Root`'s `children` is `RootContent[]`, `Element`'s is `ElementContent[]` — they're compatible for this plugin's purposes since we only ever push `element`/inherited content types, but tsc may want the assignment typed per-branch instead of one combined cast).

- [ ] **Step 7: Commit**

```bash
git add src/panels/plans/rehype-group-details.ts src/__tests__/unit/rehype-group-details.test.ts
git commit -m "feat: add rehype plugin to group adjacent details blocks for tab rendering"
```

---

### Task 3: Wire `reportMode` + tab rendering into `PlanPreview`

**Files:**
- Modify: `src/panels/plans/PlanPreview.tsx`
- Test: `src/__tests__/unit/plan-preview-tabs.test.tsx`

- [ ] **Step 1: Write the failing render test**

```tsx
// src/__tests__/unit/plan-preview-tabs.test.tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PlanPreview } from "@/panels/plans/PlanPreview";

const STACKED_DETAILS = `
<details>
<summary>Option A</summary>

Content A

</details>
<details>
<summary>Option B</summary>

Content B

</details>
`;

describe("PlanPreview tab rendering", () => {
  it("Standard mode (default): renders both as plain accordion details, no tabs", () => {
    render(<PlanPreview body={STACKED_DETAILS} />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getAllByText("Option A")).toHaveLength(1);
    expect(screen.getAllByText("Option B")).toHaveLength(1);
  });

  it("Report mode: renders the same two details as a tab strip", () => {
    render(<PlanPreview body={STACKED_DETAILS} reportMode />);
    expect(screen.getByRole("tablist")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Option A" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Option B" })).toBeInTheDocument();
  });

  it("Report mode: a lone details block still renders as a plain collapsible, not a 1-tab group", () => {
    render(<PlanPreview body={"<details>\n<summary>Solo</summary>\n\nBody\n\n</details>"} reportMode />);
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.getByText("Solo")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/unit/plan-preview-tabs.test.tsx`
Expected: FAIL — `reportMode` is not a known prop on `PlanPreviewProps` (tsc/test error), and no `tablist` role exists yet.

- [ ] **Step 3a: Fix the file's header comment, which has the same stale claim as Task 1**

`PlanPreview.tsx:1-13`'s top comment still lists `remark-directive` for `:::timeline` / `:::columns` / etc. as a reason this component exists, even though that plugin was removed in commit `d6250b3`. Replace line 5:
```
//   - `remark-directive` for `:::timeline` / `:::columns` / etc.
```
with:
```
//   - Stacked `<details>` blocks rendered as tabs in Report mode (rehype-group-details).
```

- [ ] **Step 3b: Edit `PlanPreview.tsx` — imports and props**

In the import block (after the existing `rehypeRaw` import at line 21):
```typescript
import rehypeRaw from "rehype-raw";
import rehypeGroupDetails from "./rehype-group-details";
```

Change the `Toggle`/icon import line (currently `import { List } from "lucide-react";`) to:
```typescript
import { Eye, EyeOff, List } from "lucide-react";
```

Add `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` to the imports (after the `DesignToc` import):
```typescript
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
```

Extend `PlanPreviewProps` (currently lines 29-34):
```typescript
interface PlanPreviewProps {
  body: string;
  /** Called when a task checkbox in the preview is toggled. Line index is
   *  relative to the body (NOT the full source), 0-indexed. */
  onTaskToggle?: (line: number) => void;
  /** Forces the richer "Report" skin on, bypassing the in-component Eye toggle.
   *  Used by Research content-type, which always wants the rich render. */
  reportMode?: boolean;
}
```

- [ ] **Step 4: Edit `PlanPreview.tsx` — component body**

Replace the component function (lines 37-77) with:
```tsx
export function PlanPreview({ body, onTaskToggle, reportMode: forcedReportMode }: PlanPreviewProps) {
  const [showOutline, setShowOutline] = useState(false);
  const [reportModeToggle, setReportModeToggle] = useState(false);
  const reportMode = forcedReportMode ?? reportModeToggle;
  const components = useMemo(() => buildComponents(onTaskToggle, reportMode), [onTaskToggle, reportMode]);

  return (
    <div className="relative h-full min-h-0">
      <div className="absolute top-2 right-2 z-10 flex gap-1.5">
        {forcedReportMode === undefined && (
          <Toggle
            pressed={reportModeToggle}
            onPressedChange={setReportModeToggle}
            variant="outline"
            size="sm"
            className="h-7 gap-1 text-[10px] bg-background/80 backdrop-blur shadow-sm"
          >
            {reportModeToggle ? <Eye size={11} /> : <EyeOff size={11} />} Report
          </Toggle>
        )}
        <Toggle
          pressed={showOutline}
          onPressedChange={setShowOutline}
          variant="outline"
          size="sm"
          className="h-7 gap-1 text-[10px] bg-background/80 backdrop-blur shadow-sm"
        >
          <List size={11} /> Outline
        </Toggle>
      </div>
      <Allotment onVisibleChange={(index, visible) => { if (index === 0) setShowOutline(visible); }}>
        <Allotment.Pane visible={showOutline} minSize={120} preferredSize={200} snap>
          <div className="h-full overflow-auto border-r border-border bg-card/30 p-3">
            <DesignToc markdown={body} />
          </div>
        </Allotment.Pane>
        <Allotment.Pane minSize={200}>
          <div className="h-full overflow-auto">
            <div className={reportMode ? "mx-auto max-w-[920px] p-4 md-render--report" : "mx-auto max-w-[760px] p-4"}>
              <div className="md-render prose prose-sm dark:prose-invert max-w-none">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm, remarkGithubAlerts, remarkBreaks]}
                  remarkRehypeOptions={{allowDangerousHtml: true}}
                  rehypePlugins={[rehypeRaw, rehypeGroupDetails]}
                  components={components}
                >
                  {body}
                </ReactMarkdown>
              </div>
            </div>
          </div>
        </Allotment.Pane>
      </Allotment>
    </div>
  );
}
```

- [ ] **Step 5: Edit `PlanPreview.tsx` — `buildComponents` signature and the new `div`/tab-group renderer**

Change the function signature (line 81):
```typescript
function buildComponents(onTaskToggle: ((line: number) => void) | undefined, reportMode: boolean): Partial<Components> {
```

Add a `div` entry to the returned map (alongside the existing `pre`/`code`/`blockquote`/etc. entries):
```tsx
    div: function DivComponent({ className, children, ...rest }) {
      const classList = typeof className === "string" ? className.split(" ") : [];
      if (!classList.includes("md-tabgroup")) {
        return <div className={className} {...rest}>{children}</div>;
      }
      if (!reportMode) {
        return <>{children}</>;
      }
      return <TabGroup>{children}</TabGroup>;
    },
```

Add the `TabGroup` helper component (in the "Inline transforms" or a new "Tab group" section, near `collectText`'s definition since it reuses it):
```tsx
function TabGroup({ children }: { children?: React.ReactNode }) {
  const items = React.Children.toArray(children)
    .filter((child): child is React.ReactElement => React.isValidElement(child) && child.type === "details")
    .map((detailsEl, index) => {
      const detailsChildren = React.Children.toArray(
        (detailsEl.props as { children?: React.ReactNode }).children
      );
      const summary = detailsChildren.find(
        (c) => React.isValidElement(c) && c.type === "summary"
      );
      const body = detailsChildren.filter((c) => c !== summary);
      let label = "";
      collectText(summary, (s) => (label += s));
      return { id: `tab-${index}`, label: label || `Tab ${index + 1}`, body };
    });

  if (items.length === 0) return null;

  return (
    <Tabs defaultValue={items[0].id} className="not-prose my-3">
      <TabsList>
        {items.map((item) => (
          <TabsTrigger key={item.id} value={item.id}>{item.label}</TabsTrigger>
        ))}
      </TabsList>
      {items.map((item) => (
        <TabsContent key={item.id} value={item.id} className="prose prose-sm dark:prose-invert max-w-none">
          {item.body}
        </TabsContent>
      ))}
    </Tabs>
  );
}
```

Note: `DetailsComponent`'s existing rendering (lines 158-170, unchanged by this task) wraps its body in `<div className="px-3.5 py-3 [&>*:last-child]:mb-0">{body}</div>` when in a plain `<details>` — that wrapper div has no `className="md-tabgroup"`, so the new `div` override's first branch (`!classList.includes("md-tabgroup")`) renders it exactly as before. No regression to existing collapsibles.

- [ ] **Step 6: Run test to verify it passes**

Run: `bun run test src/__tests__/unit/plan-preview-tabs.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 7: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors

- [ ] **Step 8: Commit**

```bash
git add src/panels/plans/PlanPreview.tsx src/__tests__/unit/plan-preview-tabs.test.tsx
git commit -m "feat: render stacked details blocks as tabs in Plans Report mode"
```

---

### Task 4: Report-mode theming

**Files:**
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add Report-mode-scoped rules**

Append to `globals.css` (reusing existing `@theme inline` tokens — check current token names for `--card`, `--border`, `--primary` etc. before pasting, since exact token names must match what's already defined in this file):
```css
.md-render--report blockquote {
  border-radius: 0.5rem;
  border: 1px solid var(--border);
  border-left-width: 3px;
  background: var(--card);
  padding: 0.75rem 1rem;
  box-shadow: 0 1px 2px oklch(0 0 0 / 0.04);
}

.md-render--report table {
  border-radius: 0.5rem;
  overflow: hidden;
  box-shadow: 0 1px 2px oklch(0 0 0 / 0.04);
}

.md-render--report thead {
  position: sticky;
  top: 0;
  background: var(--card);
}

.md-render--report tbody tr:nth-child(even) {
  background: oklch(from var(--card) l c h / 0.5);
}
```

- [ ] **Step 2: Manual check**

Run: `bun run tauri:dev`
Steps: open a plan with at least one table and one `> [!NOTE]` callout, toggle Report mode on in the preview toolbar, confirm the table/callout get the card styling and Standard mode is visually unchanged.

- [ ] **Step 3: Commit**

```bash
git add src/styles/globals.css
git commit -m "feat: add Report-mode visual styling for Plans preview"
```

---

## Part 2 — Plan | Research content-type toggle

No new `PlanMode`, no new layout, no new `Allotment` pane. This is a second, independent toggle in `PlansToolbar` that (a) forces `reportMode` on `PlanPreview`, (b) swaps which tool-filter/max-tool-calls key `useChat` reads, (c) swaps the system prompt.

### Task 5: `PLANS_RESEARCH_TOOL_FILTER_DEFAULT`

**Files:**
- Modify: `src/lib/agentToolDefaults.ts`
- Test: `src/__tests__/unit/agent-tool-defaults.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/__tests__/unit/agent-tool-defaults.test.ts
import { describe, it, expect } from "vitest";
import { PLANS_TOOL_FILTER_DEFAULT, PLANS_RESEARCH_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";

describe("PLANS_RESEARCH_TOOL_FILTER_DEFAULT", () => {
  it("includes everything Plans has, plus web_search", () => {
    for (const tool of PLANS_TOOL_FILTER_DEFAULT) {
      expect(PLANS_RESEARCH_TOOL_FILTER_DEFAULT).toContain(tool);
    }
    expect(PLANS_RESEARCH_TOOL_FILTER_DEFAULT).toContain("web_search");
  });

  it("Plans default already includes web_fetch (via GENERIC_AGENT_TOOLS)", () => {
    expect(PLANS_TOOL_FILTER_DEFAULT).toContain("web_fetch");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/unit/agent-tool-defaults.test.ts`
Expected: FAIL — `PLANS_RESEARCH_TOOL_FILTER_DEFAULT` is not exported

- [ ] **Step 3: Add the constant**

In `src/lib/agentToolDefaults.ts`, after `PLANS_TOOL_FILTER_DEFAULT`:
```typescript
export const PLANS_RESEARCH_TOOL_FILTER_DEFAULT = [
  ...PLANS_TOOL_FILTER_DEFAULT,
  "web_search",
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/__tests__/unit/agent-tool-defaults.test.ts`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/agentToolDefaults.ts src/__tests__/unit/agent-tool-defaults.test.ts
git commit -m "feat: add PLANS_RESEARCH_TOOL_FILTER_DEFAULT (Plans tools + web_search)"
```

---

### Task 6: Extend `appStore` settings shape for the `plansResearch` panel key

**Files:**
- Modify: `src/stores/appStore.ts:47-60`

- [ ] **Step 1: Extend the two type literals**

Change:
```typescript
  panelMaxToolCalls: {
    screens?: number;
    components?: number;
    themes?: number;
    wizard?: number;
    plans?: number;
  };
  panelToolFilter: {
    wizard?: string[];
    screens?: string[];
    components?: string[];
    themes?: string[];
    plans?: string[];
  };
```
to:
```typescript
  panelMaxToolCalls: {
    screens?: number;
    components?: number;
    themes?: number;
    wizard?: number;
    plans?: number;
    plansResearch?: number;
  };
  panelToolFilter: {
    wizard?: string[];
    screens?: string[];
    components?: string[];
    themes?: string[];
    plans?: string[];
    plansResearch?: string[];
  };
```

- [ ] **Step 2: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors (this is an additive optional-field change; `DEFAULT_SETTINGS` at line 104-105 already initializes both to `{}`, which remains valid)

- [ ] **Step 3: Commit**

```bash
git add src/stores/appStore.ts
git commit -m "feat: add plansResearch key to panelToolFilter/panelMaxToolCalls settings shape"
```

---

### Task 7: Wire the new panel key into `AgentsTab` settings UI

**Files:**
- Modify: `src/modals/settings/AgentsTab.tsx`

- [ ] **Step 1: Import the new constant and extend `PanelKey`**

Change line 20-21's import block to add `PLANS_RESEARCH_TOOL_FILTER_DEFAULT`:
```typescript
import {
  WIZARD_TOOL_FILTER_DEFAULT,
  SCREENS_TOOL_FILTER_DEFAULT,
  COMPONENTS_TOOL_FILTER_DEFAULT,
  DESIGN_TOOL_FILTER_DEFAULT,
  PLANS_TOOL_FILTER_DEFAULT,
  PLANS_RESEARCH_TOOL_FILTER_DEFAULT,
} from "@/lib/agentToolDefaults";
```

Change line 28:
```typescript
type PanelKey = "wizard" | "screens" | "components" | "themes" | "plans" | "plansResearch";
```

- [ ] **Step 2: Add a row to `AGENTS`, `PANEL_DEFAULTS`, and `PANEL_MAX_TOOL_CALLS_OVERRIDES`**

```typescript
const AGENTS: { label: string; panelKey: PanelKey }[] = [
  { label: "Wizard",     panelKey: "wizard" },
  { label: "Screens",    panelKey: "screens" },
  { label: "Components", panelKey: "components" },
  { label: "Design",     panelKey: "themes" },
  { label: "Plans",      panelKey: "plans" },
  { label: "Plans (Research)", panelKey: "plansResearch" },
];

const PANEL_DEFAULTS: Record<PanelKey, string[]> = {
  wizard:        WIZARD_TOOL_FILTER_DEFAULT,
  screens:       SCREENS_TOOL_FILTER_DEFAULT,
  components:    COMPONENTS_TOOL_FILTER_DEFAULT,
  themes:        DESIGN_TOOL_FILTER_DEFAULT,
  plans:         PLANS_TOOL_FILTER_DEFAULT,
  plansResearch: PLANS_RESEARCH_TOOL_FILTER_DEFAULT,
};

const PANEL_MAX_TOOL_CALLS_OVERRIDES = [
  { label: "Design",           panelKey: "themes" as const,        placeholder: "12" },
  { label: "Components",       panelKey: "components" as const,    placeholder: "20" },
  { label: "Screens",          panelKey: "screens" as const,       placeholder: "25" },
  { label: "Wizard",           panelKey: "wizard" as const,        placeholder: "60" },
  { label: "Plans",            panelKey: "plans" as const,         placeholder: "20" },
  { label: "Plans (Research)", panelKey: "plansResearch" as const, placeholder: "30" },
];
```

- [ ] **Step 3: Add `web_search` visibility note (optional but consistent)**

`TOOL_GROUPS` (line 59-67) already lists `{ label: "Search", tools: ["web_search"] }` — no change needed there; it already renders a checkbox for `web_search` per panel column, including the new `plansResearch` column once `AGENTS` includes it.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Manual check**

Run: `bun run tauri:dev`
Steps: open Settings → Agents, confirm a "Plans (Research)" column appears in the tool table with `web_search` checked by default and everything `PLANS_TOOL_FILTER_DEFAULT` has, and a "Plans (Research)" row appears in the max-tool-calls section.

- [ ] **Step 6: Commit**

```bash
git add src/modals/settings/AgentsTab.tsx
git commit -m "feat: add Plans (Research) column to AgentsTab settings"
```

---

### Task 8: Research system prompt

**Files:**
- Modify: `src/lib/prompts/plans.ts`
- Test: `src/__tests__/unit/prompts.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/__tests__/unit/prompts.test.ts`:
```typescript
import { getPlansSystemPrompt, getPlansResearchSystemPrompt } from "@/lib/prompts/plans";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/__tests__/unit/prompts.test.ts`
Expected: FAIL — `getPlansResearchSystemPrompt` is not exported

- [ ] **Step 3: Add the function**

In `src/lib/prompts/plans.ts`, after `getPlansSystemPrompt` (after line 178):
```typescript
export function getPlansResearchSystemPrompt(params: {
  projectName: string;
  planName: string;
  projectLayout: {
    screens: string[];
    components: string[];
    themes: string[];
    plans: string[];
    assets: string[];
  };
}): string {
  const { projectName, planName } = params;
  return `You are the research agent for the Prototyper project "${projectName}", drafting the research document "${planName}" as a markdown file under \`projects/${projectName}/plans/\`.

RESEARCH PROTOCOL:
1. Use \`web_search\` to find sources, then \`web_fetch\` to read the most relevant pages in full before citing them.
2. Every non-obvious claim needs an inline citation — a plain Markdown link to its source, placed right after the claim.
3. Prefer primary sources (official docs, the project repo itself via \`read_file\`/\`grep\`) over secondary summaries.
4. If you cannot verify a claim, say so explicitly instead of presenting it as fact.

${PLAN_SYNTAX_REFERENCE}

DIAGRAMS — if a Mermaid diagram would clarify a flow or timeline, use only: \`flowchart\`, \`sequenceDiagram\`, \`gantt\`, \`journey\`, \`gitGraph\`, \`pie\`. Avoid \`mindmap\`, \`quadrantChart\`, \`erDiagram\`, \`timeline\`, \`sankey\` — GitHub's bundled Mermaid version lags upstream and these have a documented history of failing to render.

${PLAN_PROMPT_BEHAVIOR}

When the document is ready, call \`write_file\` exactly once with \`path: projects/${projectName}/plans/${planName}.md\` and the full markdown (frontmatter + body) as \`content\` — no JSON wrapper, no surrounding code fences.`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/__tests__/unit/prompts.test.ts`
Expected: PASS

- [ ] **Step 5: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors

- [ ] **Step 6: Commit**

```bash
git add src/lib/prompts/plans.ts src/__tests__/unit/prompts.test.ts
git commit -m "feat: add Research content-type system prompt for Plans"
```

---

### Task 9: `plansContentType` store field + toolbar toggle

**Files:**
- Modify: `src/stores/projectSettingsStore.ts:26-28,112-114`
- Modify: `src/panels/plans/PlansPanelParts.tsx`
- Modify: `src/panels/PlansPanel.tsx`

- [ ] **Step 1: Add the field to `projectSettingsStore`**

In the type (near line 26-28):
```typescript
  plansMode: "write" | "split" | "read" | "focus";
  plansChatOpen: boolean;
  plansShowInspector: boolean;
  plansContentType: "plan" | "research";
```

In the defaults (near line 112-114):
```typescript
  plansMode: "split",
  plansChatOpen: false,
  plansShowInspector: false,
  plansContentType: "plan",
```

- [ ] **Step 2: Add the toggle UI to `PlansToolbar`**

In `PlansPanelParts.tsx`, add to the icon import (line 1-11):
```typescript
import {
  BookOpen,
  Columns2,
  FileText,
  Focus,
  MessageSquare,
  NotebookText,
  Pencil,
  Search,
  Sparkles,
  Telescope,
  Trash2,
} from "lucide-react";
```

Add a `CONTENT_TYPES` constant near `MODES` (line 18-23):
```typescript
export type PlanContentType = "plan" | "research";

const CONTENT_TYPES: Array<{ id: PlanContentType; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { id: "plan",     label: "Plan",     icon: NotebookText },
  { id: "research", label: "Research", icon: Telescope },
];
```

Add props to `PlansToolbarProps` (line 25-35):
```typescript
interface PlansToolbarProps {
  planName: string;
  savedAt: number | null;
  mode: PlanMode;
  contentType: PlanContentType;
  chatOpen: boolean;
  hasMessages: boolean;
  onModeChange: (mode: PlanMode) => void;
  onContentTypeChange: (type: PlanContentType) => void;
  onChatToggle: () => void;
  onCommandMenu: () => void;
  onClearChat: () => void;
}
```

Destructure the new props (line 37-47) and render a second `ToggleGroup` right before the existing mode `ToggleGroup` (before line 102's divider, so the toolbar reads `[command][agent][clear] | [Plan/Research] | [mode]`):
```tsx
        <ToggleGroup
          type="single"
          value={contentType}
          onValueChange={(next) => next && onContentTypeChange(next as PlanContentType)}
          size="sm"
          spacing={0}
        >
          {CONTENT_TYPES.map((c) => {
            const Icon = c.icon;
            return (
              <Tooltip key={c.id}>
                <TooltipTrigger asChild>
                  <ToggleGroupItem value={c.id} aria-label={c.label}>
                    <Icon size={12} />
                  </ToggleGroupItem>
                </TooltipTrigger>
                <TooltipContent>{c.label}</TooltipContent>
              </Tooltip>
            );
          })}
        </ToggleGroup>
        <div className="w-px h-4 bg-border shrink-0" />
```
(insert this block immediately before the existing `<div className="w-px h-4 bg-border shrink-0" />` + mode `ToggleGroup` pair at lines 102-123 — there will then be two dividers total, one on each side of the new toggle, matching the existing visual grouping style)

- [ ] **Step 3: Wire it up in `PlansPanel.tsx`**

Read the new state (near line 30 where `plansMode` is read):
```typescript
  const plansContentType = useProjectSettingsStore((s) => s.ps.plansContentType);
```

Pass props to `PlansToolbar` (near line 229-242):
```tsx
        <PlansToolbar
          planName={activePlan}
          savedAt={savedAt}
          mode={plansMode}
          contentType={plansContentType}
          chatOpen={plansChatOpen}
          hasMessages={chat.messages.length > 0}
          onModeChange={(mode) => setProjectSettings({ plansMode: mode })}
          onContentTypeChange={(type) => setProjectSettings({ plansContentType: type })}
          onChatToggle={() => setProjectSettings({ plansChatOpen: !plansChatOpen })}
          onCommandMenu={() => setCommandOpen(true)}
          onClearChat={async () => {
            const { confirm } = await import("@tauri-apps/plugin-dialog");
            if (await confirm("Clear all chat messages?", { title: "Clear Chat", kind: "warning" })) chat.clearChat();
          }}
        />
```

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Manual check**

Run: `bun run tauri:dev`
Steps: open Plans, confirm the new Plan/Research toggle appears in the toolbar between the clear-chat button and the mode switcher, and that clicking it doesn't resize/restructure any pane in Write/Split/Read/Focus.

- [ ] **Step 6: Commit**

```bash
git add src/stores/projectSettingsStore.ts src/panels/plans/PlansPanelParts.tsx src/panels/PlansPanel.tsx
git commit -m "feat: add Plan/Research content-type toggle to Plans toolbar"
```

---

### Task 10: Wire `plansContentType` into tool filter, system prompt, and `PlanPreview`

**Files:**
- Modify: `src/panels/PlansPanel.tsx`

- [ ] **Step 1: Swap the panel-key lookup**

Change lines 26-27:
```typescript
  const planToolFilter = useAppStore((s) =>
    plansContentType === "research" ? s.settings.panelToolFilter.plansResearch : s.settings.panelToolFilter.plans
  );
  const planMaxToolCalls = useAppStore((s) =>
    plansContentType === "research" ? s.settings.panelMaxToolCalls.plansResearch : s.settings.panelMaxToolCalls.plans
  );
```
Note: this requires `plansContentType` (added in Task 9, Step 3) to be read *before* this line — move the `useProjectSettingsStore((s) => s.ps.plansContentType)` read up above line 26 if it isn't already.

Change line 151's fallback default to match:
```typescript
    panelToolFilter: planToolFilter ?? (plansContentType === "research" ? PLANS_RESEARCH_TOOL_FILTER_DEFAULT : PLANS_TOOL_FILTER_DEFAULT),
```
Add `PLANS_RESEARCH_TOOL_FILTER_DEFAULT` to the import at line 9:
```typescript
import { PLANS_TOOL_FILTER_DEFAULT, PLANS_RESEARCH_TOOL_FILTER_DEFAULT } from "@/lib/agentToolDefaults";
```

- [ ] **Step 2: Swap the system prompt**

Change the `systemPrompt` memo (lines 126-134):
```typescript
  const systemPrompt = useMemo(() => {
    if (!project || !activePlan) return "";
    const inventory = projectLayoutFromOptions(mentionOptions);
    return plansContentType === "research"
      ? getPlansResearchSystemPrompt({ projectName: project, planName: activePlan, projectLayout: inventory })
      : getPlansSystemPrompt({ projectName: project, planName: activePlan, projectLayout: inventory });
  }, [project, activePlan, mentionOptions, plansContentType]);
```
Add `getPlansResearchSystemPrompt` to the import at line 10:
```typescript
import { getPlansSystemPrompt, getPlansResearchSystemPrompt } from "@/lib/prompts/plans";
```

- [ ] **Step 3: Force Report mode on `PlanPreview` when content-type is Research**

Find where `PlanPreview` is rendered (inside `PlanLayout`'s preview slot — `PlanLayout.tsx` passes preview props through; check `PlanLayout.tsx`'s `PreviewPane` helper, which wraps `PlanPreview`). Add a `reportMode` prop threaded from `PlansPanel.tsx` through `PlanLayout`'s props down to `PlanPreview`:

In `PlansPanel.tsx`, where `<PlanLayout ... />` is rendered (lines 249-260), add:
```tsx
            <PlanLayout
              source={source}
              onSourceChange={setSource}
              mode={plansMode}
              reportMode={plansContentType === "research"}
              lineNumbers={false}
              chatOpen={plansChatOpen}
              onSelectionChange={(info) => { selectionInfoRef.current = info; }}
              extraExtensions={extraExtensions}
              editorHandle={editorHandle}
              onTaskToggle={handleTaskToggle}
              chatSlot={chatSlot}
            />
```

In `PlanLayout.tsx`, add `reportMode?: boolean` to its props type, and forward it to every call site that renders `<PlanPreview ... />` (the `PreviewPane` helper, used by `ReadLayout`/`SplitLayout`) as `<PlanPreview body={source} onTaskToggle={onTaskToggle} reportMode={reportMode} />`.

- [ ] **Step 4: Type-check**

Run: `bunx tsc --noEmit`
Expected: no new errors

- [ ] **Step 5: Manual check**

Run: `bun run tauri:dev`
Steps:
1. Switch to Research content-type, open Settings → Agents → confirm the chat now has `web_search` available (ask the agent to search for something and confirm it doesn't get a "tool not allowed" response).
2. Switch back to Plan content-type, confirm `web_search` is unavailable again and the system prompt reverts (ask the agent something that would reveal which prompt is active, e.g. "what's your protocol for writing this file").
3. In Research content-type, open Split mode, confirm the preview pane shows the Report skin (cards/sticky table headers) automatically, with no Eye toggle visible (since `reportMode` is forced).
4. Write a doc with stacked `<details>` blocks via the Research agent, confirm it renders as tabs.

- [ ] **Step 6: Commit**

```bash
git add src/panels/PlansPanel.tsx src/panels/plans/PlanLayout.tsx
git commit -m "feat: wire Plan/Research content-type into tool filter, system prompt, and preview render"
```

---

## Self-review

**Spec coverage:**
- "clean tabs… reuse something" → Task 2/3, reusing the existing `Tabs` primitive and the existing `details`-stacking GitHub precedent. ✅
- "3 types of render… don't change layout, just toggle" → corrected in this rewrite: Part 2 is a toolbar toggle, no new layout. ✅
- "Plan mode = current + tabs" → Plan content-type uses the existing 4 layouts + Task 3's tabs, Eye toggle still available for Standard↔Report. ✅
- "Research mode = code editor | rich render, themed" → re-scoped per your correction: same layouts, `reportMode` forced on, no separate pane. ✅
- "launch a subagent to research against the current codebase" → done (Explore agent, findings folded into Tasks 5-10, with corrections listed at the top). ✅

**Placeholder scan:** no TBD/TODO; every step has real code or an exact command + expected output.

**Type consistency:** `reportMode` (boolean, `PlanPreviewProps`) flows unchanged through `PlanLayout` → `PlanPreview` → `buildComponents`; `PlanContentType` (`"plan" | "research"`) is the single type used across `PlansPanelParts.tsx`, `projectSettingsStore.ts`, and `PlansPanel.tsx` — no parallel/renamed variant introduced.

---

## Execution

Two execution options:

1. **Task-by-task in this session** — work through Tasks 1-10 in order, running the listed test/tsc commands at each checkpoint, with a review pause between tasks.
2. **Hand off to a fresh agent per task** — if you want a clean-context implementer for each task (useful since Task 3 and Task 10 are the riskiest/most novel pieces).

Which approach do you want?
