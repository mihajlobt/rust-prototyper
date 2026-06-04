<!-- Context: ui/web/navigation | Priority: critical | Version: 1.1 | Updated: 2026-06-04 -->

# Web UI Context

**Purpose**: Web-based UI patterns, animations, styling standards, and React component design

**Last Updated**: 2026-06-04

---

## Quick Navigation

### Core Files

| File | Description | Priority |
|------|-------------|----------|
| [animation-basics.md](animation-basics.md) | Animation fundamentals, timing, easing | high |
| [animation-components.md](animation-components.md) | Button, card, modal, dropdown animations | high |
| [animation-chat.md](animation-chat.md) | Chat UI and message animations | medium |
| [animation-loading.md](animation-loading.md) | Skeleton, spinner, progress animations | medium |
| [animation-forms.md](animation-forms.md) | Form input and validation animations | medium |
| [animation-advanced.md](animation-advanced.md) | Recipes, best practices, accessibility | medium |
| [ui-styling-standards.md](ui-styling-standards.md) | Tailwind v4 patterns, CSS variables, dark mode | high |
| [react-patterns.md](react-patterns.md) | React 19 patterns, hooks, component design | high |
| [design-systems.md](design-systems.md) | shadcn/ui, design tokens, component libraries | high |

---

## Loading Strategy

### For Prototyper component work:
1. Load `ui-styling-standards.md` (Tailwind v4 tokens, shadcn patterns)
2. Load `react-patterns.md` (React 19 component patterns)
3. Reference `design-systems.md` (shadcn/ui primitives)

### For animation work:
1. Load `animation-basics.md` (fundamentals, timing, easing)
2. Load `animation-components.md` (UI component animations)
3. Reference `animation-chat.md` for chat UI patterns
4. Reference `animation-advanced.md` for recipes and accessibility

---

## Scope

This subcategory covers:
- ✅ CSS animations and transitions
- ✅ Tailwind CSS v4 (utility-first styling, design tokens)
- ✅ React 19 patterns and hooks
- ✅ Design systems (shadcn/ui primitives)
- ✅ Component architecture

---

## File Summaries

### animation-*.md (6 files)
CSS animations, micro-interactions, and UI transitions split into focused modules.

**Key topics**: Animation micro-syntax, 60fps performance, reduced motion, chat UI animations, component patterns

### ui-styling-standards.md
Tailwind v4 patterns, CSS variables, design tokens, responsive design, dark mode.

**Key topics**: Utility-first CSS, component styling, responsive breakpoints, theme tokens

### react-patterns.md
React 19 patterns including functional components, hooks, state management, and performance optimization.

**Key topics**: Custom hooks, context API, code splitting, memoization

### design-systems.md
Design system principles, shadcn/ui component library, and maintaining consistency across applications.

**Key topics**: Design tokens, component APIs, documentation, versioning

---

## Related Categories

- `prototyper/` - Prototyper project context (Tauri v2 + React 19)
- `development/` - General development patterns (clean code, API design)
- `core/` - Universal standards and workflows

---

## Used By

**Agents**: frontend-specialist, design-specialist, ui-developer, react-developer, animation-expert

---

## Statistics
- Core files: 9
- Subcategories: 0
- **Total context files**: 9
