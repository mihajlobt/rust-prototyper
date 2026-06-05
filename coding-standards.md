# Coding Standards

## File size limits

- **NEVER write a file that exceeds 500–600 lines of code.** This is a hard limit.
- If a file approaches this limit, split it immediately:
  1. **Extract a module** — move related functions/types to a new file in the same directory and re-export from the original.
  2. **Extract a sub-component** — move a self-contained UI section into its own component file.
  3. **Extract a custom hook** — move stateful logic into a `use*.ts` hook file.
- When splitting, prefer domain-based groupings (e.g., `prompts/screens.ts`, `prompts/workflows.ts`) over arbitrary line-count splits.
- **Re-export from barrel files** so that import paths don't change for consumers.

## Naming conventions

- **NEVER use one or two letter variable names or excessively short abbreviated names.** E.g., `Ps`, `SavePs`, `SavePb`, `BtnCb`, `DlgRef` are all forbidden.
- Every variable name must express its intent clearly: use `projectStore` not `ps`, use `savePushButton` not `SavePb`.
- The only exception is standard single-letter loop variables (`i`, `j`, `k`) in trivial `for` loops under 5 lines.

## Documentation and research

- **CONSULT Context7 OR OFFICIAL DOCS for EVERY file you edit and EVERY library/API you use.**
- Your training data may be outdated. Always verify current API signatures, patterns, and best practices before making changes.
- Every architectural decision, positioning claim, or behavioral assertion MUST cite a specific source: official docs URL, Context7 query result, MDN reference, GitHub issue, or source code line.
- Code comments explaining "why" must include the reference inline (e.g., `// React 18 event delegation dispatches to root container — see https://github.com/facebook/react/blob/xxx`).
- If you cannot find a reference, state the uncertainty explicitly instead of presenting an assumption as fact.

## Preserving functionality

- **NEVER remove, disable, or silently drop existing functionality without explicit user approval or a direct bug fix that requires it.**
- **NEVER assume a library is broken and switch to a workaround or alternative without consulting the user first.** If a library behaves unexpectedly, investigate the root cause (read docs, check source, search online).
- **NEVER USE TEMP DIRECTORIES and then move files to `generated/`.** If a CLI tool refuses to scaffold into a non-empty directory, save user data, clear the target directory, scaffold into the now-empty directory, then restore user data.
- **NEVER MANUALLY PARSE STRUCTURED API CONTENT** — no JSON envelope unwrapping, no regex extraction from model output, no content trimming hacks. Use the API's native structured output mechanisms: tool calling arguments, structured output format, or fix the prompt instead. String cleanup of markdown fences (`stripFences`) is acceptable.

## Git workflow

- **NEVER use `git checkout`, `git revert`, or any git command that discards uncommitted changes.** Build ON TOP of existing changes, never discard them.

## Types

- NEVER use `any` type in TypeScript or JSDoc. Use specific types, `unknown`, `object`, or `Record<string, unknown>` instead.
- NEVER ignore eslint rules. DO NOT add ignore lines.
- NEVER hardcode types or structures that exist in external packages. ALWAYS import and reuse types from the source package.
- **NEVER recast types if they can be inferred from usage.** Let TypeScript infer types naturally. If TypeScript infers `any`, fix the root cause.

## External libraries

- **ALWAYS search Context7 when implementing new libraries, APIs, or any code that has external documentation.** Even for well-known libraries like React, Next.js, Prisma — ALWAYS check Context7 first. NEVER assume you know the current API without checking.

## Adherence to approved plans

- **NEVER deviate from an approved plan or todo list.** Once a plan is approved, execute it exactly as specified. Do not skip steps, change scope, or substitute simpler alternatives without explicit user approval.
- **DO NOT go for the "simplest approach" or take shortcuts.** Implement what was requested properly.

## Quality standards

- **NEVER compromise on the user's request.**
- **NEVER leave or hide or skip or omit linting errors.**
- **NEVER guess or hallucinate implementations.** When working with external libraries, ALWAYS verify against official documentation or GitHub examples. Provide links to the examples/docs you followed.
- **NEVER guess CLI flags or command behavior.** ALWAYS check Context7 or official docs for the exact flags and behavior.
- **Avoid hacky solutions.** If a proper solution requires more research, do the research.
- **`react-hooks/exhaustive-deps` disable is allowed** when including a dependency would cause an infinite loop or defeat the intent of the effect, provided a comment on the line above explains exactly why. This is the one eslint-disable exception permitted.
- **NEVER use `setTimeout` or any other timing hack** to "defer" rendering or "wait for mount" in React. Use effects with proper dependencies, state-driven rendering, refs with layout effects, or library-specific declarative APIs.
- **NEVER EVER redefine types or recreate interfaces when they already exist in external packages.** ALWAYS import and reuse types from the source package.

## UI and styling

- **NEVER write more than 6–7 Tailwind utility classes on a single element.**
- If you need more, use one of these approaches:
  1. **Extract a component** — move the element into its own named React component.
  2. **`cva` (class-variance-authority)** — already used for shadcn/ui primitives.
  3. **Reduce number of classes and do it with less**
- When reducing class count, do NOT merge classes into a CSS class and then re-apply them alongside new Tailwind classes on the same element. If you extract to a CSS class, remove the equivalent Tailwind classes from the element — don't keep both.

## Allotment (split pane library)

- **Use `visible` prop on `Allotment.Pane` for declarative show/hide.** Never use imperative `resize()` for collapse/expand toggles.
- **Never use magic numbers like `9999` in `resize()` calls.**
- **`resize()` is only safe in event handlers (click, drag).** NEVER call `resize()` in `useEffect` or `requestAnimationFrame` — it crashes with `TypeError: undefined is not an object (evaluating 'pane.minimumSize')`.
- **`preferredSize` is NOT reactive.** It only affects initial mount sizing and `reset()`.
- **For collapse/expand patterns with a visible header:** Split into two `Allotment.Pane` elements — one locked-size header pane (`minSize={28} maxSize={28}`) and one content pane with `visible={isOpen}`.
- **`useAllotmentLayout` hook** persists pane sizes via `onDragEnd` and restores them via `defaultSizes`. Pass `paneVisible` (e.g., `[true, true, isOpen]`).

## Dead code

- **NEVER leave dead code, unused variables, unused imports, or code "for legacy" / "compatibility".** If it's not used, delete it.
- **NEVER prefix unused variables with underscore (`_foo`) to silence warnings.** Remove them entirely.
- **TypeScript errors are never "pre-existing".** If `tsc --noEmit` reports errors, fix them immediately.

## Error handling

- **NEVER add fallback values, backwards-compatibility shims, or safety nets when fixing a bug or error.** Fix the root cause — do not patch around it.
- If old data causes a runtime error, write a proper migration at the source (e.g., the store init), not a fallback `|| default` or `?? default` that hides the real problem.
- Defensive code masks bugs instead of fixing them. Make the code strict and fix the data.

## Assets

- **NEVER create custom SVG icon components.** Use lucide-react icons exclusively.
- If lucide doesn't have a suitable icon, pick the closest match. Do not create inline SVG, icon fonts, or icon files.
