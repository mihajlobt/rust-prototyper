// CodeMirror autocomplete sources for the Plans editor.
//
// Two triggers:
//   1. `/` — block insert (heading, list, quote, code, table, callout, etc.)
//      Selecting an option dispatches an `EditorAction` on the parent
//      `PlanEditorHandle` rather than inserting static text, so the same
//      actions used by the format toolbar also drive the autocomplete.
//   2. `@` — mention (`@kind/name` where kind ∈ {screen, component, asset,
//      plan, theme}). Suggestions are pulled from the project tree via
//      `MentionOption[]` passed in by the caller (PlansPanel).
//
// Both are wired through `autocompletion({ override: [...] })` and wrapped
// in `Prec.highest` so they win over the markdown language's default
// completion source (which only completes word-tokens).

import {
  autocompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { MENTION_KINDS, type MentionKind, type MentionOption } from "@/lib/markdown/mentions";
import { type EditorAction } from "./PlanEditor";

// ─── Slash block-insert ─────────────────────────────────────────────────────

interface SlashBlock {
  label: string;
  detail: string;
  action: EditorAction;
}

const SLASH_BLOCKS: SlashBlock[] = [
  { label: "Heading 1",     detail: "Big section title",          action: { type: "setHeading",    level: 1 } },
  { label: "Heading 2",     detail: "Section title",               action: { type: "setHeading",    level: 2 } },
  { label: "Heading 3",     detail: "Subsection",                  action: { type: "setHeading",    level: 3 } },
  { label: "Bulleted list", detail: "- item",                      action: { type: "prefixLines",   prefix: "- " } },
  { label: "Numbered list", detail: "1. item",                     action: { type: "prefixLines",   prefix: "1. " } },
  { label: "Task list",     detail: "- [ ] todo",                  action: { type: "prefixLines",   prefix: "- [ ] " } },
  { label: "Quote",         detail: "> quoted text",               action: { type: "prefixLines",   prefix: "> " } },
  { label: "Code block",    detail: "```ts …```",                  action: { type: "insertBlock",   text: "```ts\n// code\n```" } },
  { label: "Table",         detail: "| A | B |",                   action: { type: "insertBlock",   text: "| Column A | Column B |\n| -------- | -------- |\n| Cell     | Cell     |" } },
  { label: "Callout",       detail: "> [!NOTE]\n> body",           action: { type: "insertBlock",   text: "> [!NOTE]\n> Body text" } },
  { label: "Divider",       detail: "---",                         action: { type: "insertAtCursor",text: "\n---\n" } },
  { label: "Link",          detail: "[text](url)",                 action: { type: "insertLink" } },
];

function slashCompletionSource(
  dispatch: (action: EditorAction) => void,
): (ctx: CompletionContext) => CompletionResult | null {
  return (ctx) => {
    // `\B` keeps `/` inside a URL (https://…) from triggering.
    const match = ctx.matchBefore(/\/(\w*)/);
    if (!match) return null;
    if (match.from === match.to && !ctx.explicit) return null;
    return {
      from: match.from + 1,
      options: SLASH_BLOCKS.map<Completion>((b) => ({
        label: b.label,
        detail: b.detail,
        type: "text",
        apply: () => { dispatch(b.action); },
      })),
      validFor: /^\w*$/,
    };
  };
}

// ─── Mentions ───────────────────────────────────────────────────────────────

const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  screen: "Screen",
  component: "Component",
  asset: "Asset",
  plan: "Plan",
  theme: "Theme",
};

const MENTION_RE = /@(\w*)(?:\/(\w*))?$/;

function mentionCompletionSource(
  options: MentionOption[],
): (ctx: CompletionContext) => CompletionResult | null {
  return (ctx) => {
    const before = ctx.matchBefore(MENTION_RE);
    if (!before) return null;
    if (before.from === before.to && !ctx.explicit) return null;
    const kindMatch = before.text.match(MENTION_RE);
    if (!kindMatch) return null;
    const typedKind = kindMatch[1] ?? "";
    const typedName = kindMatch[2] ?? "";

    // Stage 1 — no slash yet, suggest kinds.
    if (!before.text.includes("/")) {
      const kindOptions: Completion[] = MENTION_KINDS.filter((k) =>
        typedKind ? k.startsWith(typedKind.toLowerCase()) : true,
      ).map<Completion>((k) => ({
        label: `@${k}/`,
        detail: MENTION_KIND_LABEL[k],
        type: "class",
        apply: `@${k}/`,
      }));
      return { from: before.from, options: kindOptions, validFor: /^[\w/]*$/ };
    }

    // Stage 2 — kind is set, suggest options for that kind.
    const matchedKind = MENTION_KINDS.find((k) => k === typedKind.toLowerCase());
    if (!matchedKind) return null;
    const nameOptions: Completion[] = options
      .filter((o) => o.kind === matchedKind)
      .filter((o) => (typedName ? o.name.toLowerCase().includes(typedName.toLowerCase()) : true))
      .slice(0, 20)
      .map<Completion>((o) => ({
        label: o.name,
        detail: o.label,
        type: "reference",
        apply: `@${matchedKind}/${o.name}`,
      }));
    return { from: before.from, options: nameOptions, validFor: /^[\w/-]*$/ };
  };
}

// ─── Composed extension ─────────────────────────────────────────────────────

export interface PlansAutocompleteDeps {
  dispatch: (action: EditorAction) => void;
  options: MentionOption[];
}

/**
 * Build the autocomplete extension bundle for the plans editor. Pass in the
 * dispatch function from `PlanEditorHandle` and the current `MentionOption[]`
 * from the project tree.
 */
export function plansAutocomplete({ dispatch, options }: PlansAutocompleteDeps): Extension {
  return Prec.highest(
    autocompletion({
      override: [slashCompletionSource(dispatch), mentionCompletionSource(options)],
      activateOnTyping: true,
      closeOnBlur: true,
      maxRenderedOptions: 20,
      defaultKeymap: true,
    }),
  );
}
