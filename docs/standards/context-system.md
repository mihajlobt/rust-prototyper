---
title: Context System
layout: default
permalink: /standards/context-system/
description: MVI, function-based folders, navigation.md at every level
---

# Context System

The 96-file / 624KB AI context library at `.opencode/context/` is the project's shared working memory. It follows three rules:

1. **MVI** — Minimum Viable Information. Core concept + 3–5 bullets + minimal example + reference.
2. **Function-based folders** — `concepts/`, `examples/`, `guides/`, `lookup/`, `errors/`.
3. **Navigation at every level** — `navigation.md` per category, with quick routes and loading strategy.

This page is the short version. **The full source is `.opencode/context/core/context-system/overview.md`** in the repo — it isn't published as a standalone site (see note below on why).

## Core principles

### 1. Minimal Viable Information (MVI)

Extract the **minimum** an AI agent needs to use a concept:

- Core concept (1–3 sentences)
- Key points (3–5 bullets)
- Minimal example (<10 lines)
- Reference link to full docs

**Goal**: scannable in <30 seconds. Reference full docs, don't duplicate them.

### 2. Concern-based structure

Organize by **what you're doing** (concern), then by **how** (approach / tech). Two patterns:

**Pattern A — Function-based** (for repository-specific context):

```
category/
├── navigation.md
├── concepts/        # What it is
├── examples/        # Working code
├── guides/          # How to do it
├── lookup/          # Quick reference
└── errors/          # Common issues
```

**Pattern B — Concern-based** (for development context, spans multiple techs):

```
category/
├── navigation.md
├── {concern}/       # Organize by what you're doing
│   ├── navigation.md
│   └── {approach}/  # Then by approach/tech
```

### 3. Token-efficient navigation

Every category and subcategory has a `navigation.md` with:

- ASCII tree for quick structure scan (~50 tokens)
- Quick routes table for common tasks (~100 tokens)
- "By concern / type" sections (~50 tokens)

Target: 200–300 tokens per navigation file. Faster loading, less cost, quicker AI decisions.

### 4. Self-describing filenames

Filenames tell you what's inside:

- `code.md` → `code-quality.md`
- `tests.md` → `test-coverage.md`
- `review.md` → `code-review.md`

No need to open a file to understand what's in it.

### 5. Knowledge harvesting

Extract valuable context from AI summaries / overviews, then delete them. The workspace stays clean, the knowledge persists.

## The current top-level layout

```
.opencode/context/
├── navigation.md                  # Top-level entry point
├── core/                          # Universal standards & workflows
├── prototyper/                    # Prototyper project context (Tauri v2 + React 19)
├── project-intelligence/          # Domain-specific project intelligence
├── development/                   # Generic development references
└── ui/                            # UI patterns (Tailwind v4, shadcn, React, animations)
```

> **Not published as a site section.** This site once tried to publish the library as a `/context/` Jekyll collection: `docs/build.sh` (the actual Cloudflare Pages build command) copies `.opencode/context/*.md` into a `_context/` collection directory before running `jekyll build`. The copy is a plain `cp` with no front matter injected, so Jekyll treats the files as static assets rather than collection documents — no pages are ever generated at `/context/...`, and Cloudflare's fallback routing serves the homepage for those URLs instead of a 404. The section has been removed from the navigation; browse `.opencode/context/` directly in the repo instead.

## File size limits

| File type | Max lines |
|-----------|-----------|
| Concept files | 100 |
| Example files | 80 |
| Guide files | 150 |
| Lookup files | 100 |
| Error files | 150 |
| README files | 100 |

**Why**: forces brevity. If you need more, split into multiple files or reference external docs.

## Validation checklist

Before creating or updating a context file:

- [ ] Core concept is 1–3 sentences?
- [ ] Key points are 3–5 bullets?
- [ ] Example is <10 lines of code?
- [ ] Reference link is included?
- [ ] File is <200 lines total?
- [ ] Can be scanned in <30 seconds?

If any answer is "no", apply more compression.

## What next

- `.opencode/context/core/context-system/overview.md` — the full source this page summarizes
- `.opencode/context/navigation.md` — the top-level entry point into the library
- [Coding Standards]({{ '/standards/coding/' | relative_url }}) — rules that apply to context files too
