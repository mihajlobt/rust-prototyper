---
title: Plans & Specs
layout: default
permalink: /plans/
description: Point-in-time implementation plans and design specs — historical record, not living reference docs
---

# Plans & Specs

> **These are historical working documents, not reference material.** Each one captures a proposal or design as it stood on the date it was written. Some have shipped, some haven't — check the status note at the top of each page (or the linked architecture docs) for what's actually true today.

This section is kept separate from [Architecture]({{ '/architecture/' | relative_url }}) and [Standards]({{ '/standards/' | relative_url }}) on purpose: those describe the system *as it is*; these describe decisions *as they were proposed*. Mixing the two would make it hard to tell what's current.

## Plans

Implementation plans for specific features or refactors.

- **[Native Context Menu]({{ '/plans/context-menu/' | relative_url }})** — proposal to replace the shadcn/ui `ContextMenu` with Tauri v2's native menu API in the Runner panel
- **[Shared Chat]({{ '/plans/shared-chat/' | relative_url }})** — *Implemented.* The plan that produced `useChat`, `chatStore`, and the shared chat components now used across Wizard, Screens, Components, Themes, and Plans

## Specs

Design specifications written ahead of implementation.

- **[Shared Chat Design]({{ '/specs/shared-chat-design/' | relative_url }})** — component design for the shared chat layer described in the Shared Chat plan above

## Where to look instead

- For how the system works *today*, see [Architecture]({{ '/architecture/' | relative_url }})
- For the rules current code must follow, see [Standards]({{ '/standards/' | relative_url }})
