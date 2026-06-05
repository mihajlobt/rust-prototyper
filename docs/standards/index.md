---
title: Standards
layout: default
permalink: /standards/
description: Coding rules, design language, and the context system
---

# Standards

The three rule books the project follows. They apply to all code, all UI, and all AI-assisted development.

## Pages

- **[Coding]({{ '/standards/coding/' | relative_url }})** — file size limits, naming, types, styling, Allotment patterns, error handling
- **[Design Language]({{ '/standards/design/' | relative_url }})** — *Quiet Instrument* archetype, color, typography, spacing, motion
- **[Context System]({{ '/standards/context-system/' | relative_url }})** — how the `.opencode/context/` library is organized

## Why these three

- **Coding** is the contract every PR has to meet. The 500-line file limit and the "no 1–2 letter variable names" rule are the two most-violated constraints.
- **Design** is the contract every UI change has to meet. The shell is greyscale; color is reserved for node types, run status, and the user's generated output.
- **Context System** is the contract every AI agent's working memory follows. MVI-style brevity, function-based folders, `navigation.md` at every level.

## What next

- [Coding]({{ '/standards/coding/' | relative_url }}) — the rules
- [Design]({{ '/standards/design/' | relative_url }}) — the look
- [Context System]({{ '/standards/context-system/' | relative_url }}) — the knowledge library
