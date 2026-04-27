#!/usr/bin/env bun
/**
 * Workflow Prompt Test Runner v2
 *
 * Tests all 8 workflow system prompts against specified models.
 * Uses structured assertions: section parsing, schema validation, code checks.
 * Runs sequentially with pauses between tests.
 *
 * Usage:
 *   bun run scripts/test-workflow-prompts.ts [model1] [model2] ...
 *   bun run scripts/test-workflow-prompts.ts gemma4-26b-128k:latest
 *   OLLAMA_CLOUD_KEY=xxx bun run scripts/test-workflow-prompts.ts cloud:minimax-m2.7 cloud:kimi2.6
 *
 * Default model: gemma4-26b-128k:latest
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST || "http://localhost:11434";
const PAUSE_MS = 4500;
const NUM_PREDICT = 4096;

// ─── Assertion helpers ─────────────────────────────────────────────────────

interface AssertResult {
  pass: boolean;
  label: string;
  detail: string;
}

function assertContains(output: string, substr: string, label?: string): AssertResult {
  const found = output.includes(substr);
  return { pass: found, label: label ?? `Contains "${substr}"`, detail: found ? "" : `Expected "${substr}" in output` };
}

function assertMatches(output: string, pattern: RegExp, label: string): AssertResult {
  const found = pattern.test(output);
  return { pass: found, label, detail: found ? "" : `Expected pattern ${pattern} in output` };
}

function assertSectionExists(output: string, sectionName: string): AssertResult {
  // Match ## Section or ## Section — or just section header on its line
  const pattern = new RegExp(`^##\\s+${escapeRegex(sectionName)}`, "m");
  const found = pattern.test(output);
  return { pass: found, label: `Section "## ${sectionName}" exists`, detail: found ? "" : `Missing section header "## ${sectionName}"` };
}

function assertMinCount(output: string, pattern: RegExp, minCount: number, label: string): AssertResult {
  const matches = output.match(pattern);
  const count = matches ? matches.length : 0;
  return { pass: count >= minCount, label, detail: `Found ${count}, expected at least ${minCount}` };
}

function assertMinLength(output: string, minChars: number, label?: string): AssertResult {
  return { pass: output.length >= minChars, label: label ?? `Output >= ${minChars} chars`, detail: `Output is ${output.length} chars, expected at least ${minChars}` };
}

function assertNoHardcodedColors(output: string): AssertResult {
  // Check for hex colors like #fff, #ffffff, rgb(), but allow in comments
  const hexPattern = /(?<!\/\/.*)#[0-9a-fA-F]{3,8}\b/g;
  const rgbPattern = /rgb\(/g;
  const hexMatches = output.match(hexPattern);
  const rgbMatches = output.match(rgbPattern);
  const hasHex = hexMatches && hexMatches.length > 0;
  const hasRgb = rgbMatches && rgbMatches.length > 0;
  return {
    pass: !hasHex && !hasRgb,
    label: "No hardcoded hex/rgb colors",
    detail: hasHex ? `Found hex colors: ${hexMatches?.join(", ")}` : hasRgb ? `Found rgb() calls` : "",
  };
}

function assertCodeCompilable(output: string): AssertResult {
  const issues: string[] = [];
  // Check balanced braces
  const openBraces = (output.match(/\{/g) || []).length;
  const closeBraces = (output.match(/\}/g) || []).length;
  if (Math.abs(openBraces - closeBraces) > 2) issues.push(`Unbalanced braces: ${openBraces} open, ${closeBraces} close`);
  // Check balanced parens
  const openParens = (output.match(/\(/g) || []).length;
  const closeParens = (output.match(/\)/g) || []).length;
  if (Math.abs(openParens - closeParens) > 2) issues.push(`Unbalanced parens: ${openParens} open, ${closeParens} close`);
  // Check for JSX closing tags without opening
  const closingTags = output.match(/<\/[A-Z][a-zA-Z]*/g) || [];
  const openingTags = output.match(/<[A-Z][a-zA-Z]*[\s/>]/g) || [];
  // This is a rough heuristic — not a full parser
  return {
    pass: issues.length === 0,
    label: "Code structure checks (braces/parens balanced)",
    detail: issues.length ? issues.join("; ") : "",
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Prompt definitions ───────────────────────────────────────────────────

const WORKFLOW_REQUIREMENTS_PROMPT = `You are a senior requirements analyst specializing in software product specification. Your task is to take unstructured, informal, or conversational input and distill it into a rigorous, structured requirements document.

ROLE:
- You think like a product manager who writes acceptance criteria for engineering teams.
- You never assume intent — you surface ambiguities and resolve them with sensible defaults.
- You think in terms of WHAT the system must do, not HOW it should be built.

INPUT:
The user message contains a free-form description of a feature, product, or component. It may be vague, overly detailed, contradictory, or incomplete. Your job is to extract the substance and represent it precisely.

OUTPUT FORMAT — produce a structured requirements document with these sections:

## Overview
One-paragraph summary of what is being built, who it is for, and what problem it solves.

## Functional Requirements
Numbered list. Each requirement must be:
- Atomic: one capability per requirement
- Testable: a human can verify pass/fail
- Unambiguous: no "etc.", "and so on", or weasel words
Format: **FR-N**: [Capability] — [Brief description]. Example: **FR-1**: Authentication — Users can log in with email and password.

## Non-Functional Requirements
Numbered list covering performance, accessibility, responsiveness, and compatibility.
Format: **NFR-N**: [Category] — [Description]. Example: **NFR-1**: Responsiveness — Layout adapts to 375px, 768px, and 1280px viewports.

## UX Requirements
Numbered list covering interaction patterns, feedback states, and user flows.
Format: **UX-N**: [Pattern] — [Description]. Example: **UX-1**: Form validation — Show inline error messages below invalid fields on blur.

## Data Requirements
Numbered list covering data models, state shape, and API contracts if applicable.
Format: **DATA-N**: [Model] — [Description]. Example: **DATA-1**: User model — { id: string, email: string, name: string, avatar?: string }.

## Edge Cases
Numbered list of boundary conditions and error scenarios.
Format: **EDGE-N**: [Scenario] — [Expected behavior]. Example: **EDGE-1**: Empty state — Display a friendly message when no data is available.

RULES:
- Do NOT write code. Do NOT mention specific technologies unless the user explicitly names them.
- Do NOT skip sections — if a section has no items, write "None identified."
- Do NOT add requirements the user didn't request — stay faithful to their intent.
- If the input is ambiguous, make the most reasonable interpretation and note it with a ⚠️ marker.
- Be thorough but concise. Aim for 5-15 functional requirements for a typical feature.`;

const WORKFLOW_ARCHITECT_PROMPT = `You are a senior software architect specializing in React/TypeScript front-end applications. Your task is to take structured requirements and produce a detailed component architecture plan.

ROLE:
- You think in component hierarchies, data flow direction, and state boundaries.
- You design for composability, testability, and maintainability.
- You specify exact component names, props interfaces, and state shapes.

INPUT:
The user message contains requirements (possibly from a previous Requirements node). Use them as the specification for your architecture.

OUTPUT FORMAT — produce a structured architecture document:

## Component Tree
Indent to show nesting. Each component gets a one-line description.
Example:
\`\`\`
App
├── Sidebar — Navigation and user profile
│   ├── NavItem — Single navigation link with icon
│   └── UserAvatar — Profile picture and name
├── MainContent — Route-dependent content area
│   ├── Dashboard — Overview with stats cards
│   │   └── StatCard — Single metric display
│   └── UserList — Searchable user table
└── NotificationToast — Success/error toast messages
\`\`\`

## Component Specifications
For each component in the tree, specify:
- **Props interface** — exact TypeScript interface with types (no \`any\`)
- **State** — local state variables with types and initial values
- **Responsibilities** — what this component owns and renders
- **Events** — what user interactions it handles (onClick, onSubmit, etc.)

## State Design
Group state by owner component. Show the shape of complex state objects.

## Data Flow
Describe how data moves through the component tree. Use arrows to show prop-passing and callback patterns.

## API Endpoints (if applicable)
For each endpoint: method, path, request body, response shape, error cases.

## File Structure
Proposed file organization matching the component tree.

RULES:
- Do NOT write implementation code — only interfaces, types, and structure.
- Every component name must be a valid PascalCase React component name.
- Every prop must have a TypeScript type. Never use \`any\`.
- Prefer composition over deep prop drilling.
- Consider responsive design — note which components have mobile-specific layouts.`;

const WORKFLOW_STRUCTURE_PROMPT = `You are an expert React/TypeScript developer who generates complete, production-quality component code. Your task is to take a component architecture plan and produce working React code.

ROLE:
- You write clean, type-safe React code with proper hooks and modern patterns.
- You never use \`any\` — every variable, prop, and state has an explicit type.
- You produce code that runs as-is in a Vite + React + TypeScript project.

INPUT:
The user message contains an architecture plan or requirements description. Generate the React component(s) described.

CODE RULES:
- Output a COMPLETE React component file with all necessary imports at the top.
- Use TypeScript throughout — all props interfaces, state types, event handlers must be typed.
- Never use \`any\`. Use \`unknown\` if the type is genuinely unknown, or define a proper type.
- Import React hooks explicitly: \`import { useState, useEffect, useCallback } from 'react'\`
- Import icons from lucide-react: \`import { Home, User, Settings } from 'lucide-react'\`
- The component MUST be the default export: \`export default function ComponentName() { ... }\`
- Style with Tailwind CSS classes and CSS custom properties.
  Available CSS variables: var(--background), var(--foreground), var(--card), var(--card-foreground), var(--primary), var(--primary-foreground), var(--secondary), var(--muted), var(--muted-foreground), var(--accent), var(--accent-foreground), var(--border), var(--input), var(--ring), var(--radius).
- Do NOT hardcode hex or rgb colors — use CSS variables so the theme applies correctly.
- Design for all screen sizes: responsive at 375px, 768px, 1280px. Mobile-first Tailwind.
- Generate realistic content — real names, real prices, real data.
- Do NOT wrap in HTML, DOCTYPE, html, head, or body tags.
- DARK MODE: never manage dark mode yourself. Do NOT add isDark state or className="dark".
- Handle loading states, error states, and empty states gracefully.
- Include accessible markup: proper aria-labels, semantic HTML, keyboard-navigable interactive elements.

OUTPUT:
Output ONLY the complete React component code. No explanations, no commentary, no markdown fences around the code.`;

const WORKFLOW_STYLE_PROMPT = `You are a CSS and Tailwind specialist who transforms unstyled or partially-styled React components into polished, responsive, accessible UI. Your task is to take working React code and apply comprehensive visual styling.

ROLE:
- You are a design engineer who thinks in spacing systems, responsive breakpoints, and accessible contrast.
- You know Tailwind v4 utility classes deeply, including the latest additions.
- You prioritize visual polish, consistency, and accessibility over decorative excess.

INPUT:
The user message contains a React component with minimal or no styling. Apply Tailwind CSS classes and CSS variable references to make it production-ready.

STYLING RULES:
- Use CSS custom properties for all colors: var(--primary), var(--foreground), var(--card), var(--border), etc.
- Do NOT hardcode hex or rgb colors.
- Mobile-first responsive: default 375px, sm: 640px, md: 768px, lg: 1024px+.
- Spacing hierarchy: p-2/p-4/p-6, gap-1/gap-2/gap-4/gap-6.
- Border radius: rounded-md for inputs/buttons, rounded-lg for cards, rounded-full for avatars.
- Interactive states: hover:, focus-visible:ring-2, transition-colors, active:scale-[0.98].
- Typography: text-xs(12px), text-sm(14px), text-base(16px), text-lg(18px), text-xl(20px).
- Dark mode: never add className="dark" or isDark state — .dark is on <html> already.
- Empty/loading states: show friendly message or spinner.

OUTPUT:
Output ONLY the complete, fully-styled React component code. No explanations. Preserve all existing logic, hooks, and state exactly — only modify JSX structure and class names to add styling.`;

const WORKFLOW_INTERACTION_PROMPT = `You are a React interactivity specialist who adds state management, event handling, and dynamic behavior to static or partially-interactive React components. Your task is to take a styled but non-interactive component and make it fully functional.

ROLE:
- You think in state machines, side effects, and user interaction patterns.
- You know every React hook and when to use each one.
- You write type-safe, accessible interactive code.

INPUT:
The user message contains a React component with visual styling but missing or incomplete interactivity. Add all necessary state, event handlers, side effects, and form logic.

INTERACTION RULES:
- State management: useState for simple state, useReducer for complex, useRef for DOM refs, useMemo for expensive computations, useCallback for handlers passed as props.
- Event handling: All interactive elements need proper handlers. Form submissions MUST use onSubmit with e.preventDefault().
- Form validation: Validate on blur, show errors inline below fields, disable submit until valid.
- Loading/error states: Every async action needs idle → loading → success | error. Show spinner during loading, clear errors on failure.
- Accessibility: All buttons must be <button> elements. Interactive elements need aria-labels or visible text. Focus management for modals and errors.
- TypeScript: Never use \`any\`. Use React.ChangeEvent<HTMLInputElement>, React.FormEvent<HTMLFormElement>, etc.

PRESERVATION RULES:
- Keep ALL existing component structure, JSX, and styling intact.
- Only ADD state declarations, hooks, handlers, and conditional rendering.
- Do NOT remove any existing props, classes, or elements.

OUTPUT:
Output ONLY the complete React component code with all interactivity added. No explanations. Preserve all existing styling and layout exactly.`;

const WORKFLOW_REFERENCE_PROMPT = `You are a software documentation specialist who analyzes components, libraries, and APIs and produces structured reference documentation that other AI nodes can consume. Your task is to examine code, APIs, or component descriptions and extract their capabilities into a precise reference.

ROLE:
- You think like a technical writer creating API documentation for developers.
- You focus on WHAT a thing does, WHAT inputs it accepts, and WHAT outputs it produces.
- You produce structured, machine-consumable documentation — not prose.

INPUT:
The user message contains code, an API response, a library description, or component reference material. Analyze it and produce a structured reference.

OUTPUT FORMAT — produce a reference document with these sections:

## Entity Overview
Name, type (component/library/API), and one-sentence description.

## Interface / Props
For each prop or parameter: Name, Type, Required/Optional, Default, Description.

## Events / Callbacks
For each event: Name, trigger condition, payload type.

## Key Behaviors
Numbered list of important runtime behaviors.

## Dependencies
External packages or components this entity requires.

## Constraints / Edge Cases
Known limitations or caveats.

## Usage Pattern
Concise example showing how to use this entity in context.

RULES:
- Be exhaustive — document every prop, event, behavior.
- Use TypeScript types, not vague descriptions like "an object" or "some function".
- If ambiguous, document what you observe and mark assumptions with ⚠️.
- Never invent props, events, or behaviors not in the input material.`;

const WORKFLOW_VALIDATE_PROMPT = `You are a strict code quality reviewer specializing in React/TypeScript front-end code. Your task is to perform a thorough review of the provided code and produce a structured validation report.

ROLE:
- You are a senior engineer performing a code review before merge.
- You catch bugs, type errors, accessibility violations, and performance anti-patterns.
- You are meticulous — you check imports, types, hooks, accessibility, and runtime correctness.

INPUT:
The user message contains React/TypeScript code to validate. Review it thoroughly.

VALIDATION CHECKLIST — check every item:

1. **TypeScript Errors** — missing types, incorrect types, type assertions that bypass safety
2. **Import Errors** — unused imports, missing imports, wrong paths, named/default mismatches
3. **React Errors** — missing keys, stale closures, incorrect hook deps, setState during render, missing cleanup
4. **Accessibility** — missing keyboard support, missing aria-labels, missing form labels, no focus management
5. **Performance** — inline objects/functions in render, missing memoization, large components
6. **Security** — dangerouslySetInnerHTML, unsanitized input, open redirects
7. **Code Quality** — dead code, console.log, hardcoded values, missing error handling

OUTPUT FORMAT:

## Status
One of: ✅ **Valid**, ⚠️ **Warnings**, ❌ **Errors**

## Issues
For each issue: [SEVERITY] [CATEGORY] Line N: Description — Suggested fix

## Summary
Total counts and one-line overall assessment.

RULES:
- If valid with no issues, output ONLY: "✅ Valid — no issues found."
- Never say valid if you find ❌-level issues.
- Be specific — cite line numbers and variable names.
- Suggest concrete fixes.`;

const WORKFLOW_TRANSFORM_PROMPT = `You are a content transformation specialist. Your task is to transform the provided content according to the transformation instruction. You must produce only the transformed output — no explanations, no commentary, no metadata.

ROLE:
- You are a precise data transformer who follows instructions exactly.
- You preserve the substance of the input while changing only the format, style, or structure as instructed.
- You never add information that wasn't in the input, and never omit information that was.

INPUT:
The instruction tells you WHAT transformation to apply. The content is the input to transform.

COMMON TRANSFORMATIONS:
- Format conversion: JSON → Markdown, CSV → structured object, HTML → plain text, etc.
- Code refactoring: Rename variables, extract functions, modernize syntax, improve type safety.
- Summarization: Condense to key points, extract headlines, reduce to N sentences.
- Translation: Convert between human languages.
- Data extraction: Pull specific fields from unstructured text, extract tables from prose.
- Template application: Fit content into a specific template or schema.
- Code generation: Transform a specification into runnable code.
- Cleaning: Remove markdown formatting, strip boilerplate, normalize whitespace.

OUTPUT RULES:
- Output ONLY the transformed content. No preamble or explanation.
- If impossible, output: "⚠️ Transformation failed: [reason]"
- All code transformations must produce valid, runnable code.
- All format conversions must produce valid output for the target format.`;

// ─── Test definitions with structured assertions ──────────────────────────

interface TestCase {
  name: string;
  system: string;
  user: string;
  assert: (output: string) => AssertResult[];
}

const TEST_CASES: TestCase[] = [
  {
    name: "Requirements",
    system: WORKFLOW_REQUIREMENTS_PROMPT,
    user: "Build a modern login form with email and password fields, a Remember Me checkbox, a Forgot Password link, and a Submit button. Include social login options for Google and GitHub.",
    assert: (output) => [
      // Section structure assertions
      assertSectionExists(output, "Overview"),
      assertSectionExists(output, "Functional Requirements"),
      assertSectionExists(output, "Non-Functional Requirements"),
      assertSectionExists(output, "UX Requirements"),
      assertSectionExists(output, "Data Requirements"),
      assertSectionExists(output, "Edge Cases"),
      // Schema format assertions
      assertMinCount(output, /\*\*FR-\d+\*\*/g, 3, "At least 3 FR-N formatted requirements"),
      assertMinCount(output, /\*\*NFR-\d+\*\*/g, 1, "At least 1 NFR-N formatted requirement"),
      // Content relevance assertions
      assertMatches(output, /login|sign.?in|email|password/i, "Output mentions login/email/password"),
      // No-code assertion (requirements should NOT contain code fence blocks)
      { pass: !/```(?:tsx|jsx|typescript|javascript)/.test(output), label: "No code fence blocks in requirements output", detail: /```(?:tsx|jsx|typescript|javascript)/.test(output) ? "Found code fence blocks in requirements output" : "" },
      // Minimum length
      assertMinLength(output, 400, "Output >= 400 chars"),
    ],
  },
  {
    name: "Architect",
    system: WORKFLOW_ARCHITECT_PROMPT,
    user: "Requirements for a login form:\n- FR-1: Email/password authentication\n- FR-2: Remember Me checkbox\n- FR-3: Forgot Password link\n- UX-1: Form validation on blur\n- UX-2: Loading state on submit",
    assert: (output) => [
      // Section structure
      assertSectionExists(output, "Component Tree"),
      assertSectionExists(output, "Component Specifications"),
      assertSectionExists(output, "State Design"),
      assertSectionExists(output, "Data Flow"),
      assertSectionExists(output, "File Structure"),
      // Component naming (PascalCase)
      assertMinCount(output, /[A-Z][a-zA-Z]+(?:Form|Login|Button|Input|Field|Page|Card|Auth)/g, 2, "At least 2 PascalCase component names"),
      // No implementation code
      { pass: !/export default function/.test(output) && !/(?:const|let|var)\s+\w+\s*=\s*(?:\(|{)/.test(output), label: "No implementation code (const/let/var assignments)", detail: "Found implementation code — architect should only produce structure" },
      // TypeScript interfaces
      assertMatches(output, /interface|Props|State|type\s+\w+/i, "Contains TypeScript interface/type definitions"),
      assertMinLength(output, 300, "Output >= 300 chars"),
    ],
  },
  {
    name: "Structure",
    system: WORKFLOW_STRUCTURE_PROMPT,
    user: "Create a LoginForm component with email and password inputs, Remember Me checkbox, Forgot Password link, Submit button, and Google/GitHub social login buttons. Use Tailwind classes and CSS variables.",
    assert: (output) => [
      // Must be valid React code
      assertContains(output, "import", "Contains import statement"),
      assertMatches(output, /export\s+default\s+function\s+\w+/i, "Has default export function"),
      // TypeScript types (not any)
      assertMatches(output, /interface\s+\w+Props|type\s+\w+Props|:\s*(string|number|boolean|void)/i, "Contains TypeScript types/interfaces"),
      // React hooks usage
      assertMatches(output, /useState/i, "Uses useState"),
      // CSS variables (no hardcoded colors)
      assertNoHardcodedColors(output),
      assertMinCount(output, /var\(--/g, 2, "Uses at least 2 CSS variable references"),
      // Tailwind classes
      assertMatches(output, /className/i, "Contains className (Tailwind)"),
      // Accessible markup
      assertMatches(output, /aria-|label|htmlFor|role/i, "Contains accessible markup (aria/label/role)"),
      // Code structure checks
      assertCodeCompilable(output),
      // No HTML wrapper
      { pass: !/<html|<!DOCTYPE|<head/i.test(output), label: "No HTML/DOCTYPE wrapper", detail: "Found HTML/DOCTYPE wrapper" },
      assertMinLength(output, 500, "Output >= 500 chars"),
    ],
  },
  {
    name: "Style",
    system: WORKFLOW_STYLE_PROMPT,
    user: `function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  return (
    <div>
      <h2>Sign In</h2>
      <input value={email} onChange={e => setEmail(e.target.value)} />
      <input type="password" value={password} onChange={e => setPassword(e.target.value)} />
      <button>Submit</button>
    </div>
  );
}`,
    assert: (output) => [
      // Must preserve original logic
      assertContains(output, "useState", "Preserves useState"),
      assertContains(output, "email", "Preserves email variable"),
      assertContains(output, "password", "Preserves password variable"),
      // Must add styling
      assertMinCount(output, /var\(--/g, 2, "Uses CSS variable references"),
      assertMinCount(output, /(?:rounded|border|bg-|text-|p-|gap-|flex|grid)/g, 3, "Uses Tailwind utility classes (>=3)"),
      // No hardcoded colors
      assertNoHardcodedColors(output),
      // Interactive states
      assertMatches(output, /hover:|focus-visible:|active:|transition/i, "Has interactive states (hover/focus/active/transition)"),
      // Responsive
      assertMatches(output, /sm:|md:|lg:/i, "Has responsive breakpoints"),
      // Preserves form elements
      assertContains(output, "input", "Preserves input element"),
      assertContains(output, "button", "Preserves button element"),
      assertMinLength(output, 400, "Output >= 400 chars"),
    ],
  },
  {
    name: "Interaction",
    system: WORKFLOW_INTERACTION_PROMPT,
    user: `export default function LoginForm() {
  return (
    <div className="max-w-md mx-auto p-6 bg-card rounded-lg border border-border">
      <h2 className="text-xl font-semibold text-foreground mb-4">Sign In</h2>
      <div className="space-y-4">
        <div><label className="text-sm text-muted-foreground">Email</label><input className="w-full h-9 px-3 rounded-md border border-input bg-background text-foreground" /></div>
        <div><label className="text-sm text-muted-foreground">Password</label><input type="password" className="w-full h-9 px-3 rounded-md border border-input bg-background text-foreground" /></div>
        <button className="w-full h-9 bg-primary text-primary-foreground rounded-md">Submit</button>
      </div>
    </div>
  );
}`,
    assert: (output) => [
      // Must add state management
      assertMinCount(output, /useState/g, 2, "At least 2 useState calls"),
      // Must add event handlers
      assertMatches(output, /onSubmit|e\.preventDefault/i, "Uses onSubmit with preventDefault"),
      assertMatches(output, /onChange|onBlur/i, "Uses onChange or onBlur handlers"),
      // Form validation
      assertMatches(output, /error|valid|disabled/i, "Has validation (error/valid/disabled)"),
      // TypeScript events
      assertMatches(output, /React\.FormEvent|React\.ChangeEvent|HTMLFormElement|HTMLInputElement/i, "Uses proper React event types"),
      // Preserves original structure and styling
      assertContains(output, "bg-card", "Preserves bg-card class"),
      assertContains(output, "text-foreground", "Preserves text-foreground class"),
      assertContains(output, "border-border", "Preserves border-border class"),
      // No any types
      { pass: !/\bany\b/.test(output), label: "No `any` type usage", detail: "Found `any` type in output" },
      assertMinLength(output, 500, "Output >= 500 chars"),
    ],
  },
  {
    name: "Reference",
    system: WORKFLOW_REFERENCE_PROMPT,
    user: `import { useState, useEffect } from "react";

interface ToastProps {
  title: string;
  description?: string;
  variant?: "default" | "success" | "error" | "warning";
  duration?: number;
  onDismiss?: () => void;
}

export function Toast({ title, description, variant = "default", duration = 5000, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => { setVisible(false); onDismiss?.(); }, duration);
    return () => clearTimeout(timer);
  }, [duration, onDismiss]);
  if (!visible) return null;
  return (
    <div role="alert" className={\`toast toast-\${variant}\`}>
      <strong>{title}</strong>
      {description && <p>{description}</p>}
      <button onClick={() => { setVisible(false); onDismiss?.(); }}>✕</button>
    </div>
  );
}`,
    assert: (output) => [
      // Required sections
      assertSectionExists(output, "Entity Overview"),
      assertMatches(output, /Interface|Props| Props /i, "Documents Props/Interface"),
      assertMatches(output, /Event|Callback|onClick|onDismiss/i, "Documents Events/Callbacks"),
      assertMatches(output, /Behaviors?|Behavior/i, "Documents Key Behaviors"),
      assertMatches(output, /Dependencies?|Dependency/i, "Documents Dependencies"),
      // Must document the actual props
      assertMatches(output, /title|description|variant|duration|onDismiss/i, "Documents actual ToastProps members"),
      // Must mention TypeScript types
      assertMatches(output, /string|number|boolean|ToastProps/i, "Uses TypeScript types in documentation"),
      assertMinLength(output, 300, "Output >= 300 chars"),
    ],
  },
  {
    name: "Validate",
    system: WORKFLOW_VALIDATE_PROMPT,
    user: `import { useState, useEffect } from "react";

export default function UserList({ users }) {
  const [search, setSearch] = useState("");
  const filtered = users.filter(u => u.name.includes(search));
  return (
    <div>
      <input value={search} onChange={e => setSearch(e.target.value)} />
      {filtered.map(u => <div>{u.name} - {u.email}</div>)}
      <button onclick={() => fetch("/api/export")}>Export</button>
    </div>
  );
}`,
    assert: (output) => [
      // Must identify problems (this code has many)
      assertMatches(output, /❌|error|Error/i, "Identifies errors (❌ or Error) — input code has issues"),
      // Must catch TypeScript issues (users: any implicit)
      assertMatches(output, /TypeScript|type|any|implicit/i, "Catches TypeScript issues"),
      // Must catch missing keys in .map()
      assertMatches(output, /key|keys|missing.*key/i, "Catches missing key prop in .map()"),
      // Must catch accessibility issues (input has no label/aria-label)
      assertMatches(output, /accessib|aria|label|keyboard/i, "Catches accessibility issues"),
      // Must catch the onclick vs onClick case sensitivity issue
      assertMatches(output, /onclick|onClick|case.?sensitive/i, "Catches onclick (lowercase) issue"),
      // Structured output
      assertMatches(output, /Status|Issues|Summary/i, "Has Status/Issues/Summary headings"),
      assertMinLength(output, 200, "Output >= 200 chars"),
    ],
  },
  {
    name: "Transform",
    system: WORKFLOW_TRANSFORM_PROMPT,
    user: `Instruction: Convert the following JSON user data into a Markdown table with columns Name, Email, and Role.

Content:
[
  {"name": "Alice Chen", "email": "alice@example.com", "role": "admin"},
  {"name": "Bob Smith", "email": "bob@example.com", "role": "editor"},
  {"name": "Carol Davis", "email": "carol@example.com", "role": "viewer"}
]`,
    assert: (output) => [
      // Must be a markdown table
      assertMinCount(output, /\|/g, 3, "Markdown table with at least 3 pipes"),
      // Must have table separator
      assertMatches(output, /\|[\s-]*\|[\s-]*\|/, "Has table separator row (---)"),
      // Must contain the data
      assertMatches(output, /Alice/i, "Contains Alice"),
      assertMatches(output, /Bob/i, "Contains Bob"),
      assertMatches(output, /Carol/i, "Contains Carol"),
      // Must have column headers
      assertMatches(output, /Name/i, "Has Name column"),
      assertMatches(output, /Email/i, "Has Email column"),
      assertMatches(output, /Role/i, "Has Role column"),
      // Should NOT contain preamble/explanation
      { pass: !/^Here['']?s|^Sure|^I['']?ll|^The converted/i.test(output.trim()), label: "No preamble/explanation", detail: "Output starts with explanatory text instead of direct transformed content" },
      assertMinLength(output, 100, "Output >= 100 chars"),
    ],
  },
];

// ─── Ollama API ───────────────────────────────────────────────────────────

const CLOUD_HOST = "https://ollama.com";
const CLOUD_API_KEY = process.env.OLLAMA_CLOUD_KEY || "";

function resolveModelHost(model: string): { host: string; apiKey: string } {
  // Cloud models list — these go through ollama.com
  const CLOUD_MODELS = new Set([
    "minimax-m2.7", "minimax-m2.5", "minimax-m2.1", "minimax-m2",
    "kimi-k2.6", "kimi-k2.5", "kimi-k2:1t", "kimi-k2-thinking",
    "deepseek-v4-flash", "deepseek-v3.2", "deepseek-v3.1:671b",
    "glm-5.1", "glm-5", "glm-4.7", "glm-4.6",
    "gemma4:31b", "gemma3:27b", "gemma3:12b", "gemma3:4b",
    "qwen3.5:397b", "qwen3-coder:480b", "qwen3-next:80b", "qwen3-vl:235b-instruct", "qwen3-vl:235b",
    "cogito-2.1:671b", "mistral-large-3:675b", "devstral-2:123b", "devstral-small-2:24b",
    "nemotron-3-super", "nemotron-3-nano:30b", "rnj-1:8b",
    "ministral-3:14b", "ministral-3:8b", "ministral-3:3b",
    "gpt-oss:120b", "gpt-oss:20b",
    "gemini-3-flash-preview",
  ]);

  // Strip tag for matching (e.g. "kimi-k2.6:latest" → "kimi-k2.6")
  const baseModel = model.replace(/:latest$/, "");
  if (CLOUD_MODELS.has(baseModel) || CLOUD_MODELS.has(model)) {
    return { host: CLOUD_HOST, apiKey: CLOUD_API_KEY };
  }
  return { host: OLLAMA_HOST, apiKey: "" };
}

async function queryOllama(model: string, system: string, user: string, host: string, apiKey?: string): Promise<string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    headers["Authorization"] = `Bearer ${apiKey}`;
  }

  const response = await fetch(`${host}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      stream: false,
      options: { num_predict: NUM_PREDICT },
    }),
  });

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.message?.content ?? "";
}

// ─── Test runner ───────────────────────────────────────────────────────────

interface TestResult {
  name: string;
  model: string;
  totalAssertions: number;
  passedAssertions: number;
  failedAssertions: Array<{ label: string; detail: string }>;
  outputLength: number;
  latencyMs: number;
  error?: string;
}

async function runTests(model: string, host: string, apiKey: string): Promise<TestResult[]> {
  const results: TestResult[] = [];

  for (const testCase of TEST_CASES) {
    console.log(`  🔄 Testing ${testCase.name}...`);
    const start = Date.now();
    try {
      const output = await queryOllama(model, testCase.system, testCase.user, host, apiKey);
      const latencyMs = Date.now() - start;

      const assertions = testCase.assert(output);
      const passed = assertions.filter((a) => a.pass);
      const failed = assertions.filter((a) => !a.pass);

      results.push({
        name: testCase.name,
        model,
        totalAssertions: assertions.length,
        passedAssertions: passed.length,
        failedAssertions: failed.map((a) => ({ label: a.label, detail: a.detail })),
        outputLength: output.length,
        latencyMs,
      });

      const icon = failed.length === 0 ? "✅" : failed.length <= 2 ? "⚠️" : "❌";
      console.log(`    ${icon} ${testCase.name}: ${passed.length}/${assertions.length} assertions passed, ${output.length} chars, ${latencyMs}ms`);
      for (const f of failed) {
        console.log(`       ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
      }
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      results.push({
        name: testCase.name,
        model,
        totalAssertions: 0,
        passedAssertions: 0,
        failedAssertions: [{ label: "API call failed", detail: error }],
        outputLength: 0,
        latencyMs: Date.now() - start,
        error,
      });
      console.log(`    ❌ ${testCase.name}: ${error}`);
    }

    console.log(`    ⏳ Waiting ${PAUSE_MS / 1000}s...`);
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  return results;
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main() {
  const models = process.argv.slice(2);
  if (models.length === 0) {
    models.push("gemma4-26b-128k:latest");
  }

  const totalAssertionCount = TEST_CASES.reduce((sum, tc) => sum + tc.assert("").length, 0);

  console.log("════════════════════════════════════════════════════");
  console.log("  Workflow Prompt Test Runner v2");
  console.log(`  Models: ${models.join(", ")}`);
  console.log(`  Host: ${OLLAMA_HOST}`);
  console.log(`  Cloud: ${CLOUD_HOST} (key ${CLOUD_API_KEY ? "✓ set" : "✗ not set"})`);
  console.log(`  Pause between tests: ${PAUSE_MS / 1000}s`);
  console.log(`  Test cases: ${TEST_CASES.length} (${totalAssertionCount} total assertions)`);
  console.log("════════════════════════════════════════════════════\n");

  const allResults: TestResult[] = [];

  for (const model of models) {
    const { host, apiKey } = resolveModelHost(model);
    console.log(`\n━━━ Model: ${model} (${host === CLOUD_HOST ? "cloud" : "local"}) ━━━`);
    const results = await runTests(model, host, apiKey);
    allResults.push(...results);

    if (model !== models[models.length - 1]) {
      console.log("\n⏳ Brief pause before next model...");
      await new Promise((r) => setTimeout(r, PAUSE_MS));
    }
  }

  // ── Report ──
  console.log("\n\n════════════════════════════════════════════════════");
  console.log("  TEST REPORT");
  console.log("════════════════════════════════════════════════════\n");

  let totalPassed = 0;
  let totalAssertCount = 0;

  for (const model of models) {
    const modelResults = allResults.filter((r) => r.model === model);
    const modelPassed = modelResults.reduce((s, r) => s + r.passedAssertions, 0);
    const modelTotal = modelResults.reduce((s, r) => s + r.totalAssertions, 0);
    const perfectTests = modelResults.filter((r) => r.passedAssertions === r.totalAssertions && !r.error).length;
    totalPassed += modelPassed;
    totalAssertCount += modelTotal;

    console.log(`\n${model}: ${modelPassed}/${modelTotal} assertions passed, ${perfectTests}/${modelResults.length} perfect tests`);

    for (const r of modelResults) {
      const icon = r.error ? "💥" : r.passedAssertions === r.totalAssertions ? "✅" : r.passedAssertions >= r.totalAssertions * 0.7 ? "⚠️" : "❌";
      console.log(`  ${icon} ${r.name} — ${r.passedAssertions}/${r.totalAssertions} assertions, ${r.outputLength} chars, ${r.latencyMs}ms`);
      if (r.error) {
        console.log(`       Error: ${r.error}`);
      }
      for (const f of r.failedAssertions) {
        console.log(`       ✗ ${f.label}${f.detail ? ` — ${f.detail}` : ""}`);
      }
    }
  }

  console.log(`\n════════════════════════════════════════════════════`);
  console.log(`  TOTAL: ${totalPassed}/${totalAssertCount} assertions passed`);
  console.log("════════════════════════════════════════════════════\n");

  // ── Save markdown report ──
  const reportLines: string[] = [
    "# Workflow Prompt Test Report",
    "",
    `**Date**: ${new Date().toISOString()}`,
    `**Models**: ${models.join(", ")}`,
    `**Host**: ${OLLAMA_HOST} (local), ${CLOUD_HOST} (cloud)`,
    `**Total assertions**: ${totalAssertCount}`,
    "",
  ];

  for (const model of models) {
    const modelResults = allResults.filter((r) => r.model === model);
    const modelPassed = modelResults.reduce((s, r) => s + r.passedAssertions, 0);
    const modelTotal = modelResults.reduce((s, r) => s + r.totalAssertions, 0);
    reportLines.push(`## ${model}`, "");
    reportLines.push(`**Result**: ${modelPassed}/${modelTotal} assertions passed`, "");

    for (const r of modelResults) {
      const icon = r.error ? "💥" : r.passedAssertions === r.totalAssertions ? "✅" : "⚠️";
      reportLines.push(
        `### ${icon} ${r.name}`,
        "",
        `- **Assertions**: ${r.passedAssertions}/${r.totalAssertions}`,
        `- **Output length**: ${r.outputLength} chars`,
        `- **Latency**: ${r.latencyMs}ms`,
      );
      if (r.failedAssertions.length > 0) {
        reportLines.push("", "**Failed assertions**:", ...r.failedAssertions.map((f) => `- ❌ ${f.label}${f.detail ? ` — ${f.detail}` : ""}`));
      }
      if (r.error) {
        reportLines.push("", `**Error**: ${r.error}`);
      }
      reportLines.push("");
    }
  }

  const reportPath = `workflow-prompt-test-${Date.now()}.md`;
  const fs = await import("node:fs/promises");
  await fs.writeFile(reportPath, reportLines.join("\n"));
  console.log(`📄 Report saved to: ${reportPath}`);

  // Exit with failure if more than half assertions fail
  const exitCode = totalPassed >= totalAssertCount * 0.5 ? 0 : 1;
  process.exit(exitCode);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});