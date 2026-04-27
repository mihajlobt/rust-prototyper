<!-- Context: project-intelligence/nav | Priority: high | Version: 2.0 | Updated: 2026-04-27 -->

# Project Intelligence — Prototyper

> Start here for quick project understanding. Domain-specific files for this Tauri v2 desktop app.

## Structure

```
.opencode/context/project-intelligence/
├── navigation.md              # This file - quick overview
├── domain.md                  # Architecture, directories, IPC, data model
├── processes.md               # How to run, build, test, common pitfalls
├── standards.md               # All coding standards from CLAUDE.md
├── templates.md               # Code templates: WorkflowNodeType, CSS vars, React Flow, Allotment
├── business-domain.md         # Business context and problem statement (generic template)
├── technical-domain.md        # Generic technical domain template
├── business-tech-bridge.md    # How business needs map to solutions
├── decisions-log.md           # Major decisions with rationale
└── living-notes.md            # Active issues, debt, open questions
```

## Quick Routes

| What You Need | File | Description |
|---------------|------|-------------|
| Understand the app | **`domain.md`** | Architecture, directories, IPC, Rust commands, data model |
| How to develop | **`processes.md`** | Run, build, test, common pitfalls |
| Coding rules | **`standards.md`** | ALL standards from CLAUDE.md (tailwind, types, React Flow, Allotment…) |
| Code patterns | **`templates.md`** | WorkflowNodeType, CSS vars, React Flow theming, AI streaming, Allotment |
| Understand the "why" | `business-domain.md` | Problem, users, value proposition |
| Understand the "how" | `technical-domain.md` | Stack, architecture, integrations (generic template) |
| Decision context | `decisions-log.md` | Why decisions were made |
| Current state | `living-notes.md` | Active issues and open questions |

## Usage

**New Team Member / Agent**:
1. Start with `navigation.md` (this file)
2. Read all files in order for complete understanding
3. Follow onboarding checklist in each file

**Quick Reference**:
- Business focus → `business-domain.md`
- Technical focus → `technical-domain.md`
- Decision context → `decisions-log.md`

## Integration

This folder is referenced from:
- `.opencode/context/core/standards/project-intelligence.md` (standards and patterns)
- `.opencode/context/core/system/context-guide.md` (context loading)

See `.opencode/context/core/context-system.md` for the broader context architecture.

## Maintenance

Keep this folder current:
- Update when business direction changes
- Document decisions as they're made
- Review `living-notes.md` regularly
- Archive resolved items from decisions-log.md

**Management Guide**: See `.opencode/context/core/standards/project-intelligence-management.md` for complete lifecycle management including:
- How to update, add, and remove files
- How to create new subfolders
- Version tracking and frontmatter standards
- Quality checklists and anti-patterns
- Governance and ownership

See `.opencode/context/core/standards/project-intelligence.md` for the standard itself.
