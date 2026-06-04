<!-- Context: navigation | Priority: critical | Version: 2.0 | Updated: 2026-06-04 -->

# Context Navigation — Prototyper

**New here?** → `prototyper/navigation.md`

---

## Structure

```
.opencode/context/
├── navigation.md                  # This file
├── core/                          # Universal standards & workflows
├── prototyper/                    # Prototyper project context (Tauri v2 + React 19)
├── project-intelligence/          # Domain-specific project intelligence
├── development/                   # Generic development references
└── ui/                            # UI patterns (Tailwind v4, shadcn, React, animations)
```

---

## Quick Routes

| Task | Path |
|------|------|
| **Understand the project** | `prototyper/navigation.md` |
| **Project domain (architecture, processes, standards)** | `project-intelligence/navigation.md` |
| **Write code** | `core/standards/code-quality.md` |
| **Write tests** | `core/standards/test-coverage.md` |
| **Write docs** | `core/standards/documentation.md` |
| **Review code** | `core/workflows/code-review.md` |
| **Delegate task** | `core/workflows/task-delegation-basics.md` |
| **Break down feature** | `core/workflows/feature-breakdown.md` |
| **Manage tasks (JSON CLI)** | `core/task-management/navigation.md` |
| **Style with Tailwind v4 / shadcn** | `ui/web/ui-styling-standards.md`, `ui/web/design-systems.md` |
| **React patterns** | `ui/web/react-patterns.md` |
| **Animations** | `ui/web/animation-basics.md` |
| **Work on the Assets panel** | `prototyper/panels/assets/concepts/assets-panel.md` |
| **Work on Bonsai (mflux) integration** | `prototyper/backend/bonsai/concepts/bonsai-backend.md` |
| **AI streaming pattern** | `prototyper/navigation.md#by-task` |
| **Add a Rust command** | `core/navigation.md#related-context` + `prototyper/navigation.md#by-task` |

---

## By Category

**prototyper/** — Prototyper-specific (Tauri v2 + React 19) → `prototyper/navigation.md`
**core/** — Universal standards, workflows, patterns, context system → `core/navigation.md`
**project-intelligence/** — Domain docs (architecture, processes, standards, templates, decisions) → `project-intelligence/navigation.md`
**development/** — Generic development references (clean code, API design, principles) → `development/navigation.md`
**ui/** — Web UI patterns (Tailwind v4, shadcn, React 19, animations) → `ui/navigation.md`

---

## Loading Strategy

### For a new agent on the project
1. `prototyper/navigation.md` (project overview)
2. `project-intelligence/domain.md` (architecture, directories, IPC, data model)
3. `project-intelligence/processes.md` (how to run, build, test, common pitfalls)
4. `project-intelligence/standards.md` (coding standards from CLAUDE.md)

### For a specific task
- **Add a panel** → `prototyper/navigation.md` + relevant `panels/{name}/` context
- **Add a Rust command** → `core/standards/code-quality.md` + `prototyper/navigation.md#by-task`
- **Style a component** → `ui/web/ui-styling-standards.md` + `ui/web/design-systems.md`
- **Stream AI completions** → CLAUDE.md "AI streaming" section
- **Persist data** → `prototyper/navigation.md#by-task` (settings vs project files vs assets)

### For context system operations
See `core/context-system/overview.md` and `core/context-system/operations/`.
