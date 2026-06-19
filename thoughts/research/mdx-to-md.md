# Markdown → MDX for the Plans Panel — Research

**Status:** Complete (four parallel web-research agents across two rounds + direct codebase verification)
**Question asked:** Should the Plans panel switch from Markdown to MDX so plan/spec documents can use rich visual components (tabs, side-lists, callouts, cards), while staying easy for a human to read in the rendered preview *and* easy for an AI model to read/write as raw source text?

**Correction to round 1:** This app generates other apps and already runs a Vite runtime — MDX *compilation* is not architecturally blocked the way round 1 of this research assumed (the CSP/`eval` analysis in §1 below is kept for reference but is **not** the deciding factor). The deciding question, per explicit follow-up direction, is narrower and purely about **AI readability**: is raw MDX source text as easy for a model to read and write as raw Markdown source text? §1a below answers this directly, with a source link for every claim.

**Bottom line up front:** Independent of the compilation question, the AI-readability evidence (§1a) still points the same direction: **do not adopt full MDX**. The strongest, most directly relevant data points are that (a) the `llms.txt` AI-readability spec explicitly standardized on plain Markdown and never considered MDX, (b) Mintlify — an MDX-native documentation company — strips its own MDX down to plain Markdown specifically before serving it to AI agents, and (c) MDX has well-documented, real syntactic landmines (unescaped `{}` expressions, mandatory tag-closing, blank-line sensitivity) that are exactly the error class token-by-token LLM generation is prone to, with no rendering step in this app's Plans workflow to catch them before the AI reads its own broken output back. This project already ran a related experiment once, in miniature: it shipped a custom bespoke syntax (`remark-directive`, commit history shows addition then removal) and walked it back to plain HTML + GFM conventions. Full MDX reintroduces a similar risk class.

**What the evidence does NOT show:** no rigorous, peer-reviewed, head-to-head benchmark exists that directly measures "LLM accuracy generating MDX" vs "LLM accuracy generating Markdown." This conclusion rests on strong adjacent/behavioral evidence (industry conventions, documented bug classes, company behavior), not a controlled study. That gap is flagged explicitly in §1a and the references table.

---

## 1. What "switching to MDX" would actually require

The current Plans preview (`src/panels/plans/PlanPreview.tsx`) is **not MDX** — it is `react-markdown` + `remark-gfm` + `remark-github-alerts` + `remark-breaks` → `rehype-raw`. `rehype-raw` parses literal HTML tags embedded in markdown (this is how the existing native `<details>` support works) but it does **not** execute named JSX components like `<Tabs>` or `<Callout>`. There is no `@mdx-js/mdx`, `@mdx-js/react`, `next-mdx-remote`, or any MDX compiler in `package.json` today.

A genuine MDX migration means swapping in an actual MDX compiler. The standard Vite path (`@mdx-js/rollup` / `vite-plugin-mdx`) compiles `.mdx` files **known at build time** — not applicable here, since Plans documents are arbitrary files loaded from disk at runtime (`projects/{id}/plans/{slug}.md`). The only fit for this architecture is **runtime compilation**:

- `@mdx-js/mdx`'s `evaluate()` / `run()` API compiles and executes MDX source in the browser. It works without Node built-ins (built on `unified`/`remark`/`rehype`, which are platform-agnostic) — confirmed via official docs (mdxjs.com) and maintainer commentary in [mdx-js/mdx discussion #2220](https://github.com/orgs/mdx-js/discussions/2220), which explicitly recommends `evaluate()` for a "live preview editor" use case matching this app.
- **It unavoidably uses `eval`-equivalent execution.** The docs state outright: *"it's called **evaluate** because it `eval`s JavaScript."* Internally this means `new Function()`-style construction of the compiled module body.
- `mdx-bundler` is **not viable**: it shells out to `esbuild`'s Go binary subprocess, which cannot run in a Tauri webview renderer process.
- `next-mdx-remote` / `next-mdx-remote-client` are explicitly Next.js-coupled (`getStaticProps`/`getServerSideProps`) and add no capability beyond the same `@mdx-js/mdx` primitives they wrap.
- No Rust MDX compiler exists. A Bun-sidecar approach (compiling MDX via `run_shell_command_capture`, which the app already uses for other shell tasks) would only move the *compile* step out of the browser — `run()`/execution of the compiled output still has to happen client-side and still requires `eval`. It solves none of the CSP problem and adds an IPC round-trip per render.

### CSP impact (verified against this repo's actual config)

This project's `tauri.conf.json` CSP has **no `script-src` directive** — it falls back to `default-src 'self'`, meaning `'unsafe-eval'` is **not currently permitted**. Enabling `@mdx-js/mdx`'s `evaluate()`/`run()` would require adding `'unsafe-eval'` to `script-src`. Tauri v2's own CSP documentation ([v2.tauri.app/security/csp/](https://v2.tauri.app/security/csp/)) describes a security model deliberately built around hashed/nonce'd scripts specifically to avoid this — granting blanket eval capability is a real, documented regression of that model, for a feature (rendering markdown text) that has no inherent need to execute arbitrary JS.

### Bundle cost

`@mdx-js/mdx` is normally a **devDependency** (build-time tool); bundling its compiler into the runtime frontend bundle is an atypical use and was measured (with moderate confidence, not independently re-verified) at roughly 96 KB min+gzip — non-trivial for a feature whose only goal is richer document rendering.

**Note on this section's relevance**: per follow-up direction, this CSP/`eval` analysis is **not** the deciding factor for this app (it generates apps and runs a Vite runtime — MDX compilation is achievable here). It's kept as background only. §1a below is the section that actually answers the question that matters: AI readability.

---

## 1a. Is MDX as readable/writable by an AI model as plain Markdown? (sourced evidence)

This section answers the specific follow-up question directly. Every claim below has a source URL — where a claim could not be verified, that is stated explicitly rather than asserted.

### The `llms.txt` standard chose Markdown, and never considered MDX

- The `llms.txt` spec ([llmstxt.org](https://llmstxt.org/)) — the closest thing that exists to an "AI-readability spec" for documentation — states: *"At the moment the most widely and easily understood format for language models is Markdown."* It defines a strict plain-Markdown structure (H1 title, blockquote summary, H2 sections, bullet-list links) specifically because it's "a precise format allowing fixed processing methods." MDX/JSX is not mentioned anywhere in the spec.
- Origin: Jeremy Howard (Answer.AI), [Sept 3, 2024 proposal](https://www.answer.ai/posts/2024-09-03-llmstxt.html).
- Mintlify's own explainer on the convention: *"Plain Markdown files served as the perfect bridge between human-readable documentation and structured data for AI systems."* — [mintlify.com/blog/what-is-llms-txt](https://www.mintlify.com/blog/what-is-llms-txt)

### Mintlify — an MDX-native company — strips MDX before serving it to AI

- Mintlify authors documentation in MDX internally, but **auto-generates a plain-Markdown fallback for every page** (append `.md` to any docs URL) plus `/llms.txt` and `/llms-full.txt`, specifically for AI/agent consumption: [mintlify.com/docs/ai/llmstxt](https://www.mintlify.com/docs/ai/llmstxt), [mintlify.com/blog/how-to-generate-llmstxt-file-automatically](https://www.mintlify.com/blog/how-to-generate-llmstxt-file-automatically.mdx)
- This is strong **behavioral** evidence (not just stated opinion): a company whose entire product is MDX-based docs still does not serve raw MDX to AI consumers.
- The Docusaurus (also MDX-based) plugin ecosystem shows the identical pattern — plugins exist specifically to convert MDX → plain Markdown/llms.txt for AI use, explicitly to *"remove JavaScript/TypeScript import statements and other unnecessary elements"* before serving to LLMs: [github.com/din0s/docusaurus-plugin-llms-txt](https://github.com/din0s/docusaurus-plugin-llms-txt), [github.com/rachfop/docusaurus-plugin-llms](https://github.com/rachfop/docusaurus-plugin-llms), [lekoarts.de/how-to-add-llms-txt-to-docusaurus](https://www.lekoarts.de/how-to-add-llms-txt-to-docusaurus/)
- The `llms.txt` adopter ecosystem (Cloudflare, PostHog, Fern) standardizes on plain/structured Markdown for the same stated reason — MDX requires resolving imports/components the consuming agent cannot see: [developers.cloudflare.com/docs-for-agents](https://developers.cloudflare.com/docs-for-agents/), [posthog.com/docs/ai-engineering/markdown-llms-txt](https://posthog.com/docs/ai-engineering/markdown-llms-txt), [buildwithfern.com/post/optimizing-api-docs-ai-agents-llms-txt-guide](https://buildwithfern.com/post/optimizing-api-docs-ai-agents-llms-txt-guide)
- Beam.ai states the specific mechanism plainly: *"serving raw MDX files doesn't solve the problem for AI agents... MDX is for maintainers—it is full of imports and unresolved dependencies... component references are just pointers to files the agent cannot see."* — [beam.ai/agentic-insights/html-vs-markdown-which-format-actually-makes-ai-agents-more-useful](https://beam.ai/agentic-insights/html-vs-markdown-which-format-actually-makes-ai-agents-more-useful)
- **Relevance caveat for this app specifically**: this "unresolved import/component reference" failure mode applies most directly when MDX is used for *custom React components* (`<CodeBlock file="..." />` pointing at source the agent can't see). It is less directly applicable if any MDX use in the Plans panel stayed limited to a small, fixed, host-injected set of inert visual tags (no per-file imports) — but the broader pattern (companies stripping MDX down to plain Markdown specifically for AI) still stands as the dominant industry convention regardless.

### IMG.LY — direct before/after migration data

- [img.ly/blog/making-docs-machine-readable-why-we-native-compile-markdown-for-ai-agents](https://img.ly/blog/making-docs-machine-readable-why-we-native-compile-markdown-for-ai-agents/) — migrated MDX docs to plain Markdown for AI consumption. Direct quotes:
  - *"agents and LLMs can now ingest our docs 7x faster and with far higher accuracy."*
  - AI-facing Markdown payload: ~31 KB vs. ~222 KB for the equivalent human-facing HTML/MDX-rendered page (~7×).
  - On the specific failure: *"MDX is for maintainers—it is full of imports and unresolved dependencies."* and, on shortcode components like `<CodeBlock file="examples/getting-started/src/index.ts" lines="12-24" />`: *"In raw MDX, it's a pointer to the file the agent cannot see. The actual code isn't there."*
  - Their fix worked at the AST level (resolving MDX before rendering) rather than reverse-converting rendered HTML, since syntax-highlighted HTML is untrustworthy to reverse-parse: *"By working at the AST level before rendering, we avoid this entirely."*
  - **Caveat**: the "far higher accuracy" claim has no quantified percentage in the article — flagged as qualitative, not a benchmark number.

### Documented MDX syntactic fragility (the specific bug classes an LLM would trigger)

- MDX's own maintainers describe the core problem directly: *"markdown is whitespace sensitive and forgiving (what you type may not exactly work but it won't crash) whereas JavaScript is whitespace insensitive and unforgiving (it does crash on typos)"* — [mdxjs.com/docs/troubleshooting-mdx](https://mdxjs.com/docs/troubleshooting-mdx/)
- Documented failure classes on that same page: unescaped `<`/`{` characters misparsed as code; "improper interleaving" of Markdown and JSX requiring exact blank-line/nesting rules; expression errors such as *"Unexpected end of file in expression, expected a corresponding closing brace for `{`"* when blank lines are missing.
- Self-closing tags are mandatory in JSX/MDX (`<br>` is invalid, must be `<br />`) — [mdxjs.com/docs/troubleshooting-mdx](https://mdxjs.com/docs/troubleshooting-mdx/), corroborated at [kabartolo.github.io/chicago-docs-demo/docs/mdx-guide/errors](https://kabartolo.github.io/chicago-docs-demo/docs/mdx-guide/errors/)
- Blank-line/indentation sensitivity is independently documented again here: [kabartolo.github.io/chicago-docs-demo/docs/mdx-guide/writing](https://kabartolo.github.io/chicago-docs-demo/docs/mdx-guide/writing/)
- Blank-line placement silently changes the parse tree (3 elements vs. 1 for the same content, differing only by a blank line before the closing tag) — [github.com/mdx-js/mdx/issues/767](https://github.com/mdx-js/mdx/issues/767)
- Fenced code blocks inside JSX components require surrounding blank lines to be recognized as markdown rather than literal text — [github.com/mdx-js/mdx/issues/607](https://github.com/mdx-js/mdx/issues/607)
- Line breaks inside inline JSX introduce unexpected whitespace differences vs. plain React JSX — [github.com/mdx-js/mdx/issues/843](https://github.com/mdx-js/mdx/issues/843)
- "Unterminated JSX contents when using `details` element" (MDX ESLint plugin issue) — [github.com/mdx-js/eslint-mdx/issues/207](https://github.com/mdx-js/eslint-mdx/issues/207)
- "plugins not running with invalid HTML/JSX" — [github.com/mdx-js/mdx/issues/1577](https://github.com/mdx-js/mdx/issues/1577)
- Real-world concrete bug: unescaped curly braces in ordinary prose (e.g., `{API name}` in a changelog) are invalid JS due to the embedded space and throw `"Could not parse expression with acorn"` — this exact bug occurred in Fern's own MDX docs: [github.com/fern-api/docs/pull/2056](https://github.com/fern-api/docs/pull/2056), [pull/2065](https://github.com/fern-api/docs/pull/2065), [pull/2064](https://github.com/fern-api/docs/pull/2064). Note: the broken text predates the fix and authorship (human vs. AI) of the *original* broken text could not be fully verified — but the bug class itself (curly braces in ordinary prose breaking MDX) is concretely confirmed, and is exactly the kind of text a planning document written in prose ("the `{count}` items remaining") would trigger.
- ReadMe.com maintains a dedicated "Troubleshoot MDX Errors" page for invalid MDX, evidence the failure mode is common enough to need its own support documentation: [docs.readme.com/main/docs/rendering-errors-invalid-mdx](https://docs.readme.com/main/docs/rendering-errors-invalid-mdx)
- Tooling built specifically to cope with LLM-streamed MDX/JSX breaking mid-stream: an engineering writeup describes needing to *"balance the HTML tag tree and truncate incomplete tags... until the MDX parser receives valid HTML,"* linking a purpose-built `html-balancer-stream` library — [timetler.com/2025/08/19/unlocking-rich-ui-components-in-ai](https://www.timetler.com/2025/08/19/unlocking-rich-ui-components-in-ai/)
- Analogous evidence from a different but structurally similar markup format (Mermaid diagrams): *"AI generates complex Mermaid diagrams [but] the success rate is surprisingly low because the syntax is too free-form, making it easy for AI to generate invalid diagrams that look correct but won't render,"* which motivated a dedicated AI-output validator (Maid) — [github.com/probelabs/maid](https://github.com/probelabs/maid)

### Token efficiency — informal evidence only, no MDX-specific benchmark exists

- **No controlled, peer-reviewed, or even informal MDX-vs-plain-Markdown token-count benchmark was found.** This is a genuine evidence gap — flagged, not papered over.
- Adjacent (HTML-vs-Markdown, not MDX-specific) informal blog benchmarks exist, useful only as a directional proxy:
  - *"Converting to Markdown reduces token count by an average of 87.5% across 6 representative page types, compared to raw HTML"* — [runcell.dev/tool/token-counter](https://www.runcell.dev/tool/token-counter)
  - *"68% for clean content, up to 87% for real-world web pages"* (HTML→Markdown) — [beam.ai/agentic-insights/html-vs-markdown-which-format-actually-makes-ai-agents-more-useful](https://beam.ai/agentic-insights/html-vs-markdown-which-format-actually-makes-ai-agents-more-useful)
  - *"10–20% fewer tokens"* for Markdown vs. structured HTML — [medium.com/@wetrocloud/why-markdown-is-the-best-format-for-llms](https://medium.com/@wetrocloud/why-markdown-is-the-best-format-for-llms-aa0514a409a7)
  - *"~40% token reduction"* using Markdown vs. raw HTML — [releasepad.io/blog/html-vs-markdown-the-optimal-format-for-llm-content-ingestion](https://www.releasepad.io/blog/html-vs-markdown-the-optimal-format-for-llm-content-ingestion/)
  - IMG.LY's ~31KB vs ~222KB (~7×) figure (cited above) is the closest MDX-adjacent number, but it compares AI-facing Markdown to the human-facing *rendered HTML* page, not to raw MDX source byte/token count directly.
  - **All of the above are marketing-adjacent blog posts, not rigorous studies** — treat as low-confidence directional signal only, not a quantified MDX overhead figure.

### Counter-evidence (actively sought, fairly reported)

- The most substantive pro-JSX argument found: *"LLMs excel at generating static JSX tags because they share the same syntax as XML, a language they're heavily trained on."* The same source immediately qualifies this: *"When you ask an LLM to generate a tag with coupled attributes, they can fall out of sync and lead to hallucinations"* — i.e., simple flat tags are fine, multi-attribute/interdependent JSX is not, and their own practical mitigation is to have the LLM emit simple ID strings rather than complex JSX, with rendering driven by application state instead. — [timetler.com/2025/08/19/unlocking-rich-ui-components-in-ai](https://www.timetler.com/2025/08/19/unlocking-rich-ui-components-in-ai/)
- A source that superficially looks like pro-JSX-for-LLM evidence (`mdx-prompt`, a library for composing LLM prompts in JSX) on close reading argues the *opposite* of what its framing implies: its stated benefit is "easier for **humans** to reason about prompts in this format," not that LLMs comprehend JSX better — [edspencer.net/2025/2/3/mdx-prompt-composable-prompts-with-jsx](https://edspencer.net/2025/2/3/mdx-prompt-composable-prompts-with-jsx). **This should not be cited as evidence MDX helps LLM comprehension** — it doesn't claim that.
- No rigorous or even moderately authoritative source was found making the direct claim "full MDX (with custom components and imports) is as good as or better than plain Markdown for LLM read/write tasks." Every source addressing this question argues the opposite, with the sole nuance being that *simple, flat, static* JSX tags (not full MDX with imports/expressions) may be fine — which is consistent with this doc's own §4 recommendation (an inert tag, not a compiler).

### Anthropic / model-provider guidance

- Anthropic's official prompt-engineering guidance recommends **XML tags**, not MDX/JSX, for structuring content fed to Claude: *"XML tags help Claude parse complex prompts unambiguously, especially when your prompt mixes instructions, context, examples, and variable inputs."* — [platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) (XML-tag-specific page: [platform.claude.com/docs/en/build-with-claude/prompt-engineering/use-xml-tags](https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/use-xml-tags))
- The same documentation shows Anthropic explicitly supports *reducing* Markdown verbosity in Claude's output when asked (e.g., a system-prompt example instructing Claude to prefer prose over bullets/bold), noting *"the formatting style used in your prompt may influence Claude's response style... removing markdown from your prompt can reduce the volume of markdown in the output."* This indicates Anthropic's own guidance leans toward *less* markup, not more, when output quality is the priority.
- **MDX/JSX is not mentioned anywhere in Anthropic's official documentation** — could not verify any Anthropic statement specifically about MDX, in either direction.
- A third-party (non-Anthropic) blog claims *"Anthropic's own documentation shows that structured XML prompts produce 20-40% more consistent outputs than unstructured plain-text equivalents"* — [pub.towardsai.net/stop-writing-blob-prompts-anthropics-xml-tags-turn-claude-into-a-contract-machine](https://pub.towardsai.net/stop-writing-blob-prompts-anthropics-xml-tags-turn-claude-into-a-contract-machine-aa45ccc4232c) — this specific number **could not be verified against any actual Anthropic primary source** and should be treated as unverified third-party claim, not fact.

### Formal research papers

- arXiv, *"Quantifying the Impact of Structured Output Format on Large Language Models through Causal Inference"* — [arxiv.org/html/2509.21791v3](https://arxiv.org/html/2509.21791v3) — reports that forcing JSON output reduced GSM8K math-reasoning accuracy by 27.3 percentage points vs. natural-language output. Not MDX-specific, but directionally relevant: stricter/heavier structured formats can measurably degrade LLM output quality.
- arXiv, *StructEval* — [arxiv.org/pdf/2505.20139](https://arxiv.org/pdf/2505.20139) — benchmarks LLM generation across JSON/YAML/TOML/HTML-React-UI/LaTeX/Markdown. Confirmed to exist and cover HTML/React as a category, but a specific JSX-vs-Markdown accuracy number **could not be extracted/verified** from the available text.
- arXiv, *JSONSchemaBench* — [arxiv.org/pdf/2501.10868](https://arxiv.org/pdf/2501.10868) — relevant to structured-output generation broadly, not MDX/JSX-specific.
- **No paper was found that directly studies MDX or JSX-in-Markdown generation/parsing accuracy by LLMs.** This is flagged as a genuine research gap, not an oversight in this search.

### Net judgment for this question specifically

No controlled experiment proves "MDX is X% harder for an LLM than Markdown." What exists is convergent, multi-source, real-world evidence at the *behavioral* and *bug-report* level: the field's own AI-readability convention (`llms.txt`) chose plain Markdown outright; the most MDX-invested companies in the documentation-tooling space (Mintlify, Docusaurus plugin authors) strip MDX down to Markdown before AI consumption; and MDX's own maintainers document whitespace/brace-expression fragility that maps directly onto how token-by-token LLM generation fails. For Prototyper's specific scenario — the AI both writes and later re-reads raw `.md` source with **no rendering step in between to catch a malformed document** — this evidence weighs toward keeping plain Markdown, with at most a small, fixed, inert-tag extension (no JS expressions, no imports — see §4) if a specific visual need (tabs) justifies it.

---

## 2. Survey of "rich" MDX components in real frameworks

| Framework | Tabs syntax | Callout | Cards | Steps | Prop complexity | Notes |
|---|---|---|---|---|---|---|
| Fumadocs | `<Tabs items={['npm','yarn']}><Tab value="npm">…</Tab></Tabs>` | `<Callout type="warn">…</Callout>` | `<Cards><Card title="…" href="…"/></Cards>` | `<Steps><Step>### Heading…</Step></Steps>` | Mostly flat strings/arrays — lower risk | 12.2k★, active |
| Nextra | `<Tabs>`/`<Tabs.Tab>` | `<Callout type="info">…</Callout>` | `<Cards.Card icon={<X/>} …/>` — **`icon` takes a JSX expression**, not a string | Wrap plain `###` headings in `<Steps>` — **no per-item tag at all** | Card `icon` prop is JSX-valued (higher LLM error risk) | 13.8k★ |
| Docusaurus | `<Tabs><TabItem value="win" label="Windows">…</TabItem></Tabs>` — requires manual `import Tabs from '@theme/Tabs'` per file | `:::tip[Title]\n…\n:::` — **directive syntax, not JSX** | none first-party | none first-party | Tabs props flat strings | 65.3k★ — most mature, but admonitions are directives, the exact pattern this project already rejected |
| Mintlify | `<Tabs><Tab title="…">…</Tab></Tabs>` | Five dedicated tags: `<Note>`, `<Tip>`, `<Warning>`, `<Info>`, `<Check>` | `<Card title="…" icon="…" href="…">`, `<CardGroup cols={2}>` | `<Steps><Step title="…">…</Step></Steps>` | All string attributes — lowest risk surveyed | Closed-source hosted product; syntax sourced from third-party docs, moderate confidence only |
| Starlight (Astro) | `<Tabs><TabItem label="…">…</TabItem></Tabs>` | `<Aside type="tip">` **or** a markdown-native `:::tip … :::` alternative *provided specifically so it degrades better as plain text* | `<Card title="…" icon="…">`, `<CardGrid>` | none first-party | Flat strings | 8.7k★; tightly coupled to Astro |

**Universal pattern**: every framework requires either a manual per-file `import` statement or a host-injected fixed global component scope (Next.js's `mdx-components.tsx`, Docusaurus's `@theme/Tabs`). An LLM cannot be trusted to emit correct relative import paths into a plan file — any implementation here would need a fixed, pre-registered global component map, never per-file imports.

**Notable**: even Starlight, a modern, actively-developed framework, deliberately ships a *non-JSX* `:::tip` alternative for asides specifically because the JSX form degrades poorly as plain text — independent confirmation of the same lesson this project already learned with directives.

Sources: [Fumadocs Tabs](https://www.fumadocs.dev/docs/ui/components/tabs), [Fumadocs Steps](https://www.fumadocs.dev/docs/ui/components/steps), [Nextra Callout](https://nextra.site/docs/built-ins/callout), [Nextra Cards](https://nextra.site/docs/built-ins/cards), [Docusaurus admonitions](https://docusaurus.io/docs/next/markdown-features/admonitions), [Starlight components](https://starlight.astro.build/components/using-components/), [Starlight asides](https://starlight.astro.build/components/asides/).

---

## 3. AI-readability: summary (see §1a for the full sourced analysis)

§1a above is the detailed, fully-cited answer to "is MDX as readable/writable by an AI model as plain Markdown" — this section is a short pointer plus the additional stray-character gotcha not already covered there.

- LLMs are reliable at producing **simple static JSX tags** (shares syntax with XML, well represented in training data) but unreliable at **coupled/JS-expression attributes** — see the `timetler.com` finding in §1a's counter-evidence subsection.
- This maps directly onto the framework survey in §2: Nextra's JSX-valued `icon={<X/>}` prop is high-risk; Mintlify/Fumadocs' flat-string props are comparatively low-risk. **If any custom tag is ever added, every prop must be a plain string/number/boolean/array — never a JS expression.**
- **Additional gotcha not covered in §1a**: stray `<`/`>` near plain text must be escaped (`&lt;100K`) or MDX may misparse it as a tag start — directly relevant to planning prose ("< 2 weeks", "> 500 users") that an LLM would otherwise write unescaped without prompting. Source: [Mintlify MDX syntax guide](https://mcp-server-langgraph.mintlify.app/contributing/mdx-syntax-guide) (third-party-hosted Mintlify docs instance — moderate confidence).
- Mitigations exist (`eslint-plugin-mdx`, `remark-lint-mdx-jsx-*`, `mdxlint`, [docs.readme.com/main/docs/rendering-errors-invalid-mdx](https://docs.readme.com/main/docs/rendering-errors-invalid-mdx)) but they exist precisely because **humans** get this wrong in editors with live preview feedback — an LLM writing blind, in one shot, with no rendering step in this app's Plans workflow to catch it, is in a strictly worse position than the audience these tools were built for.

---

## 4. What to actually do instead

### Callouts — no change

Keep GFM alerts (`> [!NOTE]`, already implemented via `remark-github-alerts`). They already cover the five common callout types, degrade perfectly to plain blockquote text anywhere (GitHub, plain-text editors, `git diff`), and are heavily represented in LLM training data as GitHub's own convention. A JSX `<Callout type="warn">` buys nothing this doesn't already do, while reintroducing the exact "non-standard tag the model might misformat" risk the directive removal eliminated.

### TOC / outline — no change

`DesignToc` (`src/components/ui/design-toc.tsx`) already auto-generates the outline from heading tokens via `marked.lexer`. This matches the bar set by every framework surveyed (Docusaurus, Starlight, Fumadocs, Nextra all auto-derive TOC from headings; none require manual authoring). Never add a manually-authored side-list — it's pure extra authoring burden with no precedent.

### Tabs — the one component that might justify *something*, but not full MDX

There's no markdown-native equivalent for tabs. If tabs are wanted badly enough to accept new complexity, the lowest-risk path is **not** a JSX/MDX compiler — it's extending the *existing* `rehype-raw` + `react-markdown` `components`-override mechanism (the same mechanism already powering native `<details>`) with a small, fixed vocabulary of inert HTML-like tags (e.g. `<tabs>`/`<tab value="npm">`), where every "prop" is a plain HTML attribute string — never a JS expression. This:
- Requires **zero new dependencies** and **no CSP change** (no eval anywhere).
- Stays consistent with this project's established, already-validated pattern.
- Avoids the JS-expression-brace and import-statement risks documented in §2–3, since HTML attributes don't have MDX's `{}` expression grammar.
- Still inherits CommonMark's own HTML-block blank-line rules (a raw HTML block needs blank-line separation from surrounding markdown to parse as a block, similar in spirit to the MDX gotchas above but with a much smaller, well-documented rule set already in play for `<details>` today) — this should be spot-checked, not assumed risk-free.

This is explicitly **not** MDX — it's the current architecture extended by one more tag, same as `<details>` was added. If pursued, ship exactly one tab component this way and hard-code blank-line conventions into the Plans agent system prompt (`src/lib/prompts/plans.ts`).

**Real-world precedent that this exact problem is already solved without MDX**: searched for actual GitHub repos that need tab-like UI in a README (which has the identical constraint — no JS, no MDX, GFM only) and found that high-star projects converge on **stacked `<details>`/`<summary>` blocks** as the de facto "tabs" pattern — confirming `<details>` is the established, portable answer rather than a stopgap:

- [starship/starship](https://github.com/starship/starship/blob/master/README.md) (58.4k★) — separate `<details><summary>` blocks per OS (Linux/macOS/Windows/Android/BSD) and per shell (Bash/Fish/Zsh/PowerShell/etc.) for install instructions
- [ajeetdsouza/zoxide](https://github.com/ajeetdsouza/zoxide/blob/main/README.md) (37.5k★) — identical pattern for install-per-OS and shell-config-per-shell
- [motdotla/dotenv](https://github.com/motdotla/dotenv/blob/master/README.md) (20.5k★) — `<summary>` per package manager (yarn/pnpm/bun) and per FAQ entry

A weaker, secondary pattern (anchor-link nav row, not switchable content) also appears in real repos but is not true tab behavior:
- [PaddlePaddle/PaddleSpeech](https://github.com/PaddlePaddle/PaddleSpeech/blob/develop/README.md) (12.6k★), [facebookresearch/multimodal](https://github.com/facebookresearch/multimodal/blob/main/README.md) (1.7k★) — centered, bolded `<a href="#section">` jump-links styled to look like a tab bar.

No real example of `<table>`-faked tabs, and no blog post documenting a "GitHub README tabs hack" with a concrete cited example, could be found — `<details>` accordion-as-tabs is the only pattern with genuine high-adoption precedent. This strengthens the §4 recommendation: if tabs are wanted, `<details>` accordion behavior (already implemented, zero new syntax) may even be preferable to inventing a new `<tabs>` tag, since it's the exact pattern the wider ecosystem has already converged on for this constraint.

### Steps — markdown-native, no new tag

If a step sequence visual is wanted, follow Nextra's pattern: wrap plain `###` headings, not a per-step `<Step>` tag. Zero new authoring syntax, same visual payoff, no per-item tag-matching risk.

### Everything else — already solved

| Need | Already covered by |
|---|---|
| Status/decision badges | A `**Status:**` line, or extend the existing inline-chip convention (`chips.tsx`) the same way `@mention`/`[[kbd]]`/`#tag` already work |
| Comparison/decision matrices | GFM tables (already supported) |
| Collapsible task groups | Native `<details>` wrapping a GFM task list (already supported) |
| File-tree diagrams | A fenced code block (already Shiki-highlighted) — RFC/ADR tooling and GitHub itself use plain code blocks for this, not interactive components |
| Definition-of-done checklists | `## Definition of Done` heading + GFM task list (already supported) |
| Cross-references between plans | Extend the existing `@mention` chip regex to resolve `@plan/slug` |

RFC/ADR tooling precedent reinforces this bias toward minimal new syntax: [MADR](https://github.com/adr/madr) and IETF RFCs both converge on plain-text/Markdown with heading-based structure rather than rich interactive widgets for exactly this class of document.

---

## 4b. Follow-up: can MDX→MD conversion be reliable, and what's the GitHub-portable alternative?

Two follow-up questions: (a) can MDX be converted to plain Markdown losslessly, so the AI reads/writes MD while humans get a richer MDX render; and (b) what plain-Markdown feature set is available for rich-but-portable rendering that still displays correctly on GitHub?

### (a) MDX → Markdown conversion: reliable only for a closed, hand-mapped component vocabulary — not in general

**No general, lossless MDX→Markdown conversion exists, and none can exist.** MDX compiles to a JS/React component and permits arbitrary `{JS expressions}`, `import`/`export` statements, conditional rendering, loops, and non-string (object/function) component props — none of which have a general semantics-preserving plain-Markdown equivalent, since Markdown has no notion of variables, control flow, or runtime values. This boundary is discussed directly in Knut Melvær's "On the limits of MDX": [knut.fyi/blog/2020/02/on-the-limits-of-mdx](https://www.knut.fyi/blog/2020/02/on-the-limits-of-mdx/) (also mirrored at [dev.to/kmelve/on-the-limits-of-mdx-1c8k](https://dev.to/kmelve/on-the-limits-of-mdx-1c8k)).

**What IS reliable: a closed-vocabulary "component contract" pattern**, demonstrated concretely by IMG.LY ([img.ly/blog/making-docs-machine-readable-why-we-native-compile-markdown-for-ai-agents](https://img.ly/blog/making-docs-machine-readable-why-we-native-compile-markdown-for-ai-agents/)):
- Every semantic MDX component ships a **colocated, hand-written serializer**: *"Every MDX component must define how it exports to the agent view. We colocate the transform directly with the component: `Aside.astro` (Human UI) ↔ `Aside.toMarkdown.ts` (Agent logic)."*
- Rule of thumb they use: *"If a component carries meaning, it needs a Markdown equivalent. If it's just layout, unwrap it."* — purely presentational wrappers are discarded, their children kept as-is.
- Concrete example: `<Aside title="Pro Tip">Use the basePath...</Aside>` → `> **Pro Tip:** Use the basePath...` (a hand-defined blockquote template per component). Visual styling (icon/color/box) is lost; semantic content is preserved by convention.
- Components that pull in external data at build time (e.g. `<CodeBlock file="examples/.../index.ts" lines="12-24" />`) are resolved by reading the real file content at build time and inlining it as a literal fenced code block — so the agent never sees an unresolved file pointer.
- **This is explicitly not general-purpose**: it only works because the component vocabulary is closed and known in advance, with a human writing the Markdown-equivalent for each one. Arbitrary/unknown JSX, arbitrary props, or third-party components have no fallback beyond "someone writes a new `.toMarkdown.ts`."

**Tooling for this exists but confirms the same limitation**: [`mdx2md`](https://github.com/icyJoseph/mdx2md) (Rust) provides a configurable per-component template system with a `_default` catch-all for unrecognized components — but that catch-all is a simplistic, lossy fallback (e.g. render children only), not a semantics-preserving transform. `remark-mdx`/`mdast-util-mdx` ([mdxjs.com/packages/remark-mdx](https://mdxjs.com/packages/remark-mdx/), [github.com/syntax-tree/mdast-util-mdx](https://github.com/syntax-tree/mdast-util-mdx)) are low-level AST building blocks that leave the actual strip/replace/error decision entirely to whoever writes the plugin — no tool does this generically. `remark-mdx-remove-esm` ([npmjs.com/package/remark-mdx-remove-esm](https://www.npmjs.com/package/remark-mdx-remove-esm)) only strips import/export statements, not JSX elements.

**Verdict for this app**: the "MDX for humans, MD for the AI" architecture is achievable, but *only* by adopting the same constraint this doc already recommends in §4 — a small, fixed, closed vocabulary of inert tags with string-only props (no JS expressions, no imports). At that point, the conversion is trivial in both directions (it's already valid HTML-in-Markdown, which both `react-markdown`+`rehype-raw` and GitHub's renderer already understand without any MDX compiler or conversion step at all — see (b) below). **A true MDX compiler buys nothing extra here**: the moment you restrict yourself to the closed vocabulary that makes conversion reliable, you've re-derived the inert-HTML-tag approach this doc already recommends, without MDX's CSP/bundle/parsing-fragility costs.

### (b) Plain-Markdown-only feature set that's rich in-app AND portable to GitHub/GitHub Pages

GitHub's renderer supports considerably more than bare CommonMark, all of it 100% plain Markdown (no JSX, no compiler) — meaning a single `.md` file can render richly in this app's custom preview pane *and* display correctly as a GitHub README/wiki page/Pages site, with zero divergence. Verified support, each confirmed via GitHub's own docs/blog:

| Feature | Syntax | GitHub support | Source |
|---|---|---|---|
| Mermaid diagrams | ` ```mermaid ` fenced block | Native since Feb 2022 (repos, issues, discussions, gists; wikis since Aug 2022) | [github.blog/.../mermaid](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/), [docs.github.com/.../creating-diagrams](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) |
| Math/LaTeX | `$...$` inline, `$$...$$` block | Native since May 19, 2022 (MathJax) | [github.blog/.../math-expressions](https://github.blog/changelog/2022-05-19-render-mathematical-expressions-in-markdown/), [docs.github.com/.../mathematical-expressions](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions) |
| Alerts | `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` | Native since Dec 14, 2023 — exactly the 5 types this app's `remark-github-alerts` already implements | [github.blog/.../alerts](https://github.blog/changelog/2023-12-14-new-markdown-extension-alerts-provide-distinctive-styling-for-significant-content/) |
| `<details>`/`<summary>` | Raw HTML, blank line required after `</summary>` | Native, already implemented in this app | [docs.github.com/.../collapsed-sections](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections) |
| Footnotes | `text[^1]` + `[^1]: note` | Native since Sept 30, 2021 | [github.blog/.../footnotes](https://github.blog/changelog/2021-09-30-footnotes-now-supported-in-markdown-fields/) |
| Auto TOC/outline | None needed — automatic | GitHub auto-generates an interactive "Outline" UI for any `.md` with 2+ headings, since Apr 13, 2021 (UI chrome, not in-document) | [github.blog/.../table-of-contents](https://github.blog/changelog/2021-04-13-table-of-contents-support-in-markdown-files/) |
| In-document TOC (for non-GitHub renderers) | Plain bullet-list of anchor links | Not a GitHub feature — generate statically with [`gh-md-toc`](https://github.com/ekalinin/github-markdown-toc) or DocToc and commit the result as plain markdown | — |
| Badges | `![alt](https://img.shields.io/...)` | Plain CommonMark image syntax, nothing GitHub-specific | — |
| Dark/light adaptive images | `<picture>` + `prefers-color-scheme` sources, or `#gh-dark-mode-only`/`#gh-light-mode-only` URL fragments | Official GitHub-documented technique | [github.blog/.../dark-mode-images](https://github.blog/developer-skills/github/how-to-make-your-images-in-markdown-on-github-adjust-for-dark-mode-and-light-mode/) |
| GFM tables, task lists, strikethrough | Standard GFM | Already implemented (`remark-gfm`) | — |

**GitHub's HTML sanitizer** (relevant if any raw HTML, including a future inert custom tag, is embedded): GitHub uses [`html-pipeline`'s `SanitizationFilter`](https://github.com/gjtorikian/html-pipeline/blob/main/lib/html_pipeline/sanitization_filter.rb), with a confirmed allowlist including `h1–h6, br, b, i, strong, em, a, pre, code, img, div, ins, del, sup, sub, p, picture, ol, ul, table, blockquote, dl, dt, dd, kbd, hr, li, tr, td, th, s, summary, details, caption, figure, figcaption, abbr, cite, mark, small, source, span, time, wbr` plus a restricted attribute set. A non-standard custom tag (e.g. `<tabs>`) is **not** in this allowlist — standard sanitizer behavior strips the tag and keeps inner text/children, though the exact strip-vs-escape behavior could not be quoted verbatim from GitHub's own docs (flagged as inferred from standard allowlist-sanitizer semantics, not a directly confirmed GitHub statement). **Practical implication**: if this app ever adds the inert `<tabs>`/`<tab>` extension recommended in §4, it will not render as tabs on GitHub — it will most likely degrade to plain sequential text (each tab's content shown one after another, no tab switching), which is an acceptable, non-broken degradation, not a corruption of the document.

One feature initially worth checking did **not** pan out for README use: GitHub's inline hex-color-swatch preview (the small color dot next to `` `#1A6B8A` ``) — confirmed to exist, but only in Issues/PRs/comments, not in rendered README/`.md` files in a repo tree, and no official announcement post could be found (community-documented only: [github.com/Mottie/GitHub-userscripts/wiki/GitHub-code-colors](https://github.com/Mottie/GitHub-userscripts/wiki/GitHub-code-colors)). This app's own custom color-swatch rendering in `PlanPreview.tsx` is a superset of what GitHub offers for README files — not redundant.

**Bottom line for (b)**: lean fully into GFM's existing rich feature set — Mermaid, math, alerts, details, footnotes, badges, dark/light images — all already either implemented in this app or a drop-in addition (`remark-math`/`rehype-katex` for math, no new plugin needed for Mermaid since it's just a fenced code block that Shiki could special-case or pass through to a Mermaid renderer). This achieves "richer, prettier" without sacrificing GitHub portability or AI readability, since every one of these is plain text/fenced-code-block syntax with no JS-expression grammar.

---

## 5. Recommendation summary

| Approach | CSP impact | New deps | AI-authoring reliability | Verdict |
|---|---|---|---|---|
| Full MDX via `@mdx-js/mdx` `evaluate()`/`run()` | Requires `'unsafe-eval'` (currently absent) | ~96 KB compiler in runtime bundle | High risk — same class of problem as removed directives; counter-evidenced by IMG.LY's reverse migration | **Do not adopt** |
| Bun sidecar compiling MDX, `run()` client-side | Still requires `'unsafe-eval'` for execution | Adds IPC latency per render | Same risk, unsolved | **Do not adopt** |
| `markdown-to-jsx` replacing `react-markdown` | None (no eval by default) | New parser ecosystem — `remark-gfm`/`remark-github-alerts` have no drop-in equivalents, GFM alert support unverified | Static tags are fine | Possible but a large, unjustified migration cost |
| Extend `rehype-raw` + `react-markdown` `components` overrides with a fixed inert-tag vocabulary (Tabs only) | None | None | Same proven pattern as existing `<details>` | **Recommended, scoped to tabs only** |
| Keep current Markdown pipeline for everything else | — | — | — | **Recommended** |

**Net answer to "should we switch to MDX": no.** Stay on Markdown. If tabs are wanted, add them as one more inert HTML-style tag through the existing `rehype-raw`/`react-markdown` override mechanism — not by adopting an MDX compiler. Everything else the user wants (side-lists, callouts, rich structure) is either already implemented (TOC, callouts, collapsibles, tables) or achievable with prompt/convention guidance on the existing plain-Markdown pipeline, with no new rendering infrastructure at all.

---

## 6. Final architecture: separate "document syntax" from "render skin"

The decisive insight from all rounds of this research: **two independent axes were being conflated.** Splitting them resolves the original goal (a pretty, web-page-like report for humans, fully AI-readable as raw text) without MDX:

- **Axis 1 — Document syntax** (what's written to disk): must stay a small, frozen, GFM-only vocabulary. Every construct added here has a real cost — AI-generation reliability risk, GitHub-portability risk. Changes here should be rare and only the verified-safe ones below.
- **Axis 2 — Render skin** (how the *same* document is painted in this app): completely free to make as elaborate as desired. It's a presentation-layer choice over the same parsed AST/`components` map already used for `<details>`, alerts, code blocks, etc. Zero impact on the `.md` file, zero impact on AI readability, zero impact on GitHub rendering — because the file on disk never changes.

### Axis 2: a "Report" / pretty render mode (the eye-icon idea)

This is purely a UI feature, safe to build immediately, no markdown research risk:

- Add a second toggle next to the existing "Outline" toggle in `PlanPreview.tsx` (e.g. `<Eye />` from lucide-react, consistent with the existing `<Toggle>` + `<List />` "Outline" button at `PlanPreview.tsx:43-51`), switching between two visual variants of the **same parsed document**:
  - **Standard** (current): the existing GitHub-like prose rendering.
  - **Report**: a richer skin — larger hero block built from frontmatter (title/status/owner via the existing `FrontmatterHeader` data), alerts rendered as bordered/icon'd cards instead of plain blockquotes, code blocks with more chrome, tables with sticky headers/zebra striping, Mermaid diagrams centered/enlarged, a client-computed checklist progress bar (trivial: count `- [x]` vs `- [ ]` tokens already in the parsed AST — this is something GitHub itself no longer even offers for plain files, see §4b/research-round-3 note below, so it's a genuine differentiator, not a parity feature).
- Implementation shape: extend `buildComponents(onTaskToggle)` in `PlanPreview.tsx` to accept a `variant: "standard" | "report"` parameter and branch className/structure per component (blockquote, table, code, headings) — the same `Components` map, two skins. No new remark/rehype plugins, no new file format.
- This is the same principle the framework survey in §2 revealed about TOC: rendering is generated, not authored. Apply that same idea to the *whole document's* presentation, not just the outline.

### Axis 1: vetted, GitHub-safe, AI-safe document-syntax extensions (round-3 verification)

Beyond what's already implemented or recommended in §4, the following were checked specifically for GitHub-rendering reliability:

| Feature | Status on github.com | Use for Plans | Source |
|---|---|---|---|
| Mermaid `flowchart` | ✅ Explicitly confirmed | Process/decision flows | [GitHub blog](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/) |
| Mermaid `sequenceDiagram` | ✅ Explicitly confirmed | API/integration sequences | same |
| Mermaid `gantt` | ✅ Explicitly confirmed | **Plan timelines — directly relevant to this panel** | same |
| Mermaid `journey` | ✅ Explicitly confirmed | User-journey sections of a spec | same |
| Mermaid `gitGraph` | ✅ Explicitly confirmed | Branching/release-strategy plans | same |
| Mermaid `pie` | ✅ Explicitly confirmed | Allocation/breakdown visuals | [GitHub docs](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams) |
| Mermaid `classDiagram`/`stateDiagram` | ⚠️ Covered only under blog's generic "UML" mention, not individually named — likely fine, not exact-quote-confirmed | Use with awareness, not as a load-bearing feature | [GitHub blog](https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/) |
| Mermaid `erDiagram`, `timeline`, `sankey` | ❌ Could not verify GitHub support | **Avoid** | — |
| Mermaid `mindmap`, `quadrantChart` | ❌ Documented history of breaking on GitHub due to GitHub lagging behind mermaid.js releases | **Avoid** | [mermaid-js/mermaid#3963](https://github.com/mermaid-js/mermaid/issues/3963), [GitHub Community Discussion #86514](https://github.com/orgs/community/discussions/86514) |
| GitHub's mermaid.js version lags upstream releases (confirmed history: v9.1.6 → v9.3.0 → v10.0.2 over 2023) | ⚠️ Systemic risk for any newly-added diagram type | Re-verify before relying on any diagram type added to mermaid.js after ~2023 | [GitHub Community Discussion #37498](https://github.com/orgs/community/discussions/37498) |
| GFM nested task-list checkboxes | ✅ Render fine as nested lists | Sub-task checklists | inferred from generic nested-list mechanics (not separately documented by GitHub) |
| GitHub's old tasklist "X of Y" progress-bar/sync feature | ❌ **Retired April 30, 2025** | Don't depend on it — compute progress client-side in this app's own renderer instead (see Axis 2) | [GitHub Changelog, Feb 18 2025](https://github.blog/changelog/2025-02-18-github-issues-projects-february-18th-update/) |
| Definition lists (`Term` / `: Definition`) | ❌ **Not part of GFM spec — does not render on GitHub** | **Avoid entirely** | [GFM spec](https://github.github.com/gfm/) |
| `<br>` inside GFM table cells (multi-line cells) | ✅ Works in practice (general inline-HTML mechanics, not a table-specific rule; not separately documented by GitHub) | Richer comparison/decision matrices | inferred from GFM inline-HTML rules |
| `~~strikethrough~~` combined with `- [x]` task items | ✅ Both primitives independently confirmed GFM extensions; combination not separately documented but has no syntactic conflict | Distinguish "cancelled" from "done" tasks | [GFM spec §6.5](https://github.github.com/gfm/) |
| Emoji shortcodes (`:warning:`, `:white_check_mark:`, etc.) | ✅ Confirmed native GitHub support | Lightweight status icons in prose, degrades to harmless literal text (`:warning:`) anywhere that doesn't implement shortcode translation | [GitHub docs](https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax) |

**On status badges specifically**: avoid shields.io-style remote-image badges for a desktop-first app — they require a live network fetch of a remote image-generation service, which is a poor fit for an offline-capable Tauri app, and they're unverified as a GitHub-specific feature (they're just plain `![]()` images, which works, but the network dependency is the real issue here, not GitHub support). Keep using this app's own existing local inline-chip system (`chips.tsx`'s `@mention`/`[[kbd]]`/`#tag` pattern) for status indicators instead — it already degrades to plain readable text and needs no network.

### Principles for any further extension (answers "how do I keep extending without breaking GitHub or confusing the AI")

1. **Only add syntax that is a documented, explicitly-named GFM/GitHub feature** (cite a source the way this doc does) — never invent a custom tag/directive. This project already learned this lesson once (`remark-directive` removal).
2. **Prefer constructs that degrade to meaningful plain text if unrendered** (GitHub alerts → readable blockquote; emoji shortcode → literal `:word:`; strikethrough task → still-readable struck text) over constructs that become silent noise if support is missing (raw decorative HTML, ASCII-art alignment that depends on exact spacing).
3. **Don't depend on GitHub-specific *dynamic* behavior** (the retired tasklist progress bars are the cautionary example) — if a computed visual (like progress %) is wanted, compute it client-side in this app's own renderer from the same parsed markdown. That capability is on Axis 2 (free), not Axis 1 (constrained).
4. **Every new Axis-1 feature is a one-time, deliberate, research-backed decision; every new Axis-2 (skin) feature is free.** When the goal is "make it prettier," default to Axis 2 first — it's almost always sufficient, as demonstrated by the Report-mode design above using only constructs already in the document today.

---

## 7. Tabbed content in Report mode, reusing existing pieces only

Goal: a dashboard-like, themed tab UI in the "Report" render, with the saved `.md` staying plain, structurally readable text (no new syntax to teach the AI, no MDX). This is achievable by reusing three things already in the repo:

1. **The markdown convention** — stacked `<details><summary>…</summary>…</details>` blocks, back-to-back with no prose between them. This is exactly the real-world "fake tabs" pattern documented in §4 (starship/zoxide/dotenv) — already valid GFM+HTML, already renders correctly as a sequential accordion fallback on GitHub, and is trivially readable by an AI model as a sequence of self-contained labeled sections (no different from a glossary). **Nothing new is asked of the document author/AI** beyond "stack details blocks when the content is naturally tab-like" — a convention, not a syntax addition.
2. **A small rehype tree transform** (not a new npm dependency — a plain function added to the existing `rehypePlugins={[rehypeRaw]}` array in `PlanPreview.tsx:65`) that walks sibling lists and merges runs of ≥2 adjacent `details` elements into one synthetic `tabgroup` hast node, leaving isolated/single `details` elements untouched (so a lone collapsible stays a collapsible, not a one-tab "group"). This only touches the in-memory render tree — the markdown source and the GitHub-rendered output are completely unaffected.
3. **The existing shadcn/Radix `Tabs` primitive** at `src/components/ui/tabs.tsx` (`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`, already in the repo, currently unused by Plans) — add a `tabgroup` entry to `buildComponents`'s returned map:
   - **Standard mode**: render the synthetic node's children as plain `details` elements (today's exact accordion look — pure passthrough, zero visual change for existing documents).
   - **Report mode**: render via `Tabs`, mapping each child `details`' `summary` text to a `TabsTrigger` label and its body to `TabsContent`, first tab active by default.

This keeps the Axis split intact: the `.md` file never contains a `tabgroup` — that node only exists transiently in the render pipeline. An AI model reading the file back sees the same plain `<details>` stack it would have written; a human in Report mode sees a real tab strip; GitHub (and Standard mode) sees the accordion fallback that's already an established idiom. For the "dashboard-like" theming itself, scope new Report-mode visual rules (card borders, shadows, accent bars, tab strip styling) through this app's existing `@theme inline` tokens in `src/styles/globals.css` rather than introducing a parallel palette, consistent with the project's existing single-source-of-truth styling convention (per `CLAUDE.md`).

---

## References (Verified)

| Claim | Source | Status |
|---|---|---|
| Current Plans renderer is `react-markdown`, not MDX; no MDX compiler in `package.json` | Direct repo inspection: `src/panels/plans/PlanPreview.tsx`, `package.json` | ✅ Verified |
| Tauri CSP in this repo has no `script-src`, falls back to `default-src 'self'` (no `unsafe-eval`) | Direct repo inspection: `src-tauri/tauri.conf.json` | ✅ Verified |
| `@mdx-js/mdx` `evaluate()`/`run()` works without Node built-ins but requires `eval`-equivalent execution | https://mdxjs.com docs; https://github.com/orgs/mdx-js/discussions/2220 | ✅ Verified |
| `mdx-bundler` depends on esbuild's Go binary, not viable in a browser-only renderer | https://github.com/kentcdodds/mdx-bundler, https://www.npmjs.com/package/mdx-bundler | ✅ Verified |
| `next-mdx-remote`/`next-mdx-remote-client` are Next.js-coupled wrappers over `@mdx-js/mdx` | Library descriptions via Context7 resolution | ✅ Verified |
| Tauri v2 CSP model built around hashed/nonce'd scripts, avoiding `unsafe-eval` | https://v2.tauri.app/security/csp/ | ✅ Verified (general guidance; exact MDX interaction is inferred, not directly documented) |
| `@mdx-js/mdx` ≈96 KB min+gzip | Aggregated search result, not independently re-confirmed via Bundlephobia | ⚠️ Moderate confidence only |
| IMG.LY migrated MDX → Markdown for AI-agent doc consumption, 7× payload reduction | https://img.ly/blog/making-docs-machine-readable-why-we-native-compile-markdown-for-ai-agents/ | ✅ Verified |
| Blank-line placement changes MDX parse tree (3 elements vs 1) | https://github.com/mdx-js/mdx/issues/767 | ✅ Verified |
| Fenced code blocks inside JSX need surrounding blank lines | https://github.com/mdx-js/mdx/issues/607 | ✅ Verified |
| Starlight ships non-JSX `:::tip` alternative for asides, specifically for plain-text degradation | https://starlight.astro.build/components/asides/ | ✅ Verified |
| Docusaurus admonitions use `remark-directive`-style `:::` syntax, not JSX | https://docusaurus.io/docs/next/markdown-features/admonitions | ✅ Verified |
| Nextra Cards `icon` prop takes a JSX expression, not a string | https://nextra.site/docs/built-ins/cards | ✅ Verified |
| Mintlify component prop names | Third-party/community docs — Mintlify itself is closed-source | ⚠️ Moderate confidence only |
| Framework star counts (Fumadocs 12.2k, Nextra 13.8k, Docusaurus 65.3k, Starlight 8.7k) | Respective GitHub repos, June 2026 | ✅ Verified |
| This project previously added then removed `remark-directive` (`:::timeline`/`:::columns`) in favor of native `<details>` + GFM alerts | `git log`: commits `3d1dffc`, `d6250b3`; `thoughts/research/design-language-render.md` | ✅ Verified |
| `llms.txt` spec explicitly chose Markdown as "the most widely and easily understood format for language models"; never mentions MDX | https://llmstxt.org/ | ✅ Verified |
| `llms.txt` original proposal (Jeremy Howard / Answer.AI, Sept 3, 2024) | https://www.answer.ai/posts/2024-09-03-llmstxt.html | ✅ Verified |
| Mintlify explainer: "Plain Markdown files served as the perfect bridge..." for AI systems | https://www.mintlify.com/blog/what-is-llms-txt | ✅ Verified |
| Mintlify auto-generates plain-Markdown (`.md`) page fallbacks + `/llms.txt` + `/llms-full.txt` despite authoring in MDX internally | https://www.mintlify.com/docs/ai/llmstxt, https://www.mintlify.com/blog/how-to-generate-llmstxt-file-automatically.mdx | ✅ Verified |
| Docusaurus plugin ecosystem strips MDX → plain Markdown/llms.txt, removing JS/TS imports, for AI consumption | https://github.com/din0s/docusaurus-plugin-llms-txt, https://github.com/rachfop/docusaurus-plugin-llms, https://www.lekoarts.de/how-to-add-llms-txt-to-docusaurus/ | ✅ Verified |
| `llms.txt` adopters (Cloudflare, PostHog, Fern) standardize on plain/structured Markdown for AI consumption, citing unresolved MDX imports as the reason | https://developers.cloudflare.com/docs-for-agents/, https://posthog.com/docs/ai-engineering/markdown-llms-txt, https://buildwithfern.com/post/optimizing-api-docs-ai-agents-llms-txt-guide | ✅ Verified |
| Beam.ai: "serving raw MDX files doesn't solve the problem for AI agents... full of imports and unresolved dependencies" | https://beam.ai/agentic-insights/html-vs-markdown-which-format-actually-makes-ai-agents-more-useful | ✅ Verified |
| MDX maintainers: Markdown is "whitespace sensitive and forgiving," JS/JSX is "whitespace insensitive and unforgiving (it does crash on typos)" | https://mdxjs.com/docs/troubleshooting-mdx/ | ✅ Verified |
| Self-closing tags mandatory in JSX/MDX (`<br>` invalid, must be `<br />`) | https://mdxjs.com/docs/troubleshooting-mdx/, https://kabartolo.github.io/chicago-docs-demo/docs/mdx-guide/errors/ | ✅ Verified |
| MDX blank-line/indentation sensitivity documented independently | https://kabartolo.github.io/chicago-docs-demo/docs/mdx-guide/writing/ | ✅ Verified |
| Line breaks inside inline JSX create unexpected whitespace vs. plain React JSX | https://github.com/mdx-js/mdx/issues/843 | ✅ Verified |
| "Unterminated JSX contents when using `details` element" (MDX ESLint plugin) | https://github.com/mdx-js/eslint-mdx/issues/207 | ✅ Verified |
| Plugins not running with invalid HTML/JSX | https://github.com/mdx-js/mdx/issues/1577 | ✅ Verified |
| Fern's own MDX docs broke on unescaped curly braces in ordinary prose (`{API name}` → invalid JS expression, "Could not parse expression with acorn") | https://github.com/fern-api/docs/pull/2056, https://github.com/fern-api/docs/pull/2065, https://github.com/fern-api/docs/pull/2064 | ✅ Verified (bug class confirmed; original-text authorship human vs. AI not fully verifiable) |
| ReadMe.com maintains a dedicated "Troubleshoot MDX Errors" support page | https://docs.readme.com/main/docs/rendering-errors-invalid-mdx | ✅ Verified |
| Engineering writeup: LLM-streamed MDX/JSX requires tag-balancing/truncation tooling (`html-balancer-stream`) to avoid breaking mid-stream | https://www.timetler.com/2025/08/19/unlocking-rich-ui-components-in-ai/ | ✅ Verified |
| Analogous Mermaid-diagram evidence: free-form AI-generated markup has a low render-success rate, motivating a dedicated validator (Maid) | https://github.com/probelabs/maid | ✅ Verified |
| HTML→Markdown token reduction stats (87.5% avg across 6 page types; 68–87% in another source; 10–20%; ~40% in others) — informal, not MDX-specific, low confidence | https://www.runcell.dev/tool/token-counter, https://beam.ai/agentic-insights/html-vs-markdown-which-format-actually-makes-ai-agents-more-useful, https://medium.com/@wetrocloud/why-markdown-is-the-best-format-for-llms-aa0514a409a7, https://www.releasepad.io/blog/html-vs-markdown-the-optimal-format-for-llm-content-ingestion/ | ⚠️ Low confidence, marketing-adjacent blogs, not MDX-specific |
| No controlled/peer-reviewed MDX-vs-Markdown token or accuracy benchmark exists | Searched extensively across web + arXiv; none found | ❌ Confirmed gap — explicitly not claimed as fact anywhere in this doc |
| Pro-JSX argument: LLMs are heavily trained on JSX (shares syntax with XML); but coupled/multi-attribute JSX "can fall out of sync and lead to hallucinations" | https://www.timetler.com/2025/08/19/unlocking-rich-ui-components-in-ai/ | ✅ Verified |
| `mdx-prompt` argues JSX-formatted prompts are easier for **humans** to reason about — does NOT claim LLMs comprehend JSX better | https://edspencer.net/2025/2/3/mdx-prompt-composable-prompts-with-jsx | ✅ Verified (commonly mis-cited as pro-MDX-for-LLM evidence; it is not) |
| Anthropic prompt-engineering guidance recommends XML tags (not MDX/JSX) for structuring content fed to Claude | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices, https://platform.claude.com/docs/en/docs/build-with-claude/prompt-engineering/use-xml-tags | ✅ Verified |
| Anthropic guidance also supports reducing Markdown verbosity in Claude's output when requested ("removing markdown from your prompt can reduce the volume of markdown in the output") | https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices | ✅ Verified |
| Anthropic documentation does not mention MDX/JSX anywhere | Searched Anthropic's official docs directly | ❌ Confirmed absence — not evidence for or against, just unaddressed |
| Third-party claim "Anthropic's own documentation shows structured XML prompts produce 20-40% more consistent outputs" | https://pub.towardsai.net/stop-writing-blob-prompts-anthropics-xml-tags-turn-claude-into-a-contract-machine-aa45ccc4232c | ⚠️ Unverified third-party claim, not traceable to an actual Anthropic primary source |
| arXiv: forcing JSON output reduced GSM8K reasoning accuracy by 27.3 points vs. natural-language output (not MDX-specific, directionally relevant) | https://arxiv.org/html/2509.21791v3 | ✅ Verified (paper exists and contains this claim) |
| arXiv StructEval benchmarks LLM generation across JSON/YAML/TOML/HTML-React/LaTeX/Markdown — exists, scope confirmed, but no extractable JSX-vs-Markdown accuracy number | https://arxiv.org/pdf/2505.20139 | ⚠️ Existence verified; specific comparison number could not be extracted |
| arXiv JSONSchemaBench — structured-output generation benchmark, not MDX/JSX-specific | https://arxiv.org/pdf/2501.10868 | ✅ Verified (exists; tangential relevance only) |
| No paper found directly studying MDX/JSX-in-Markdown generation or parsing accuracy by LLMs | Searched arXiv + general web extensively | ❌ Confirmed gap |
| Stray `<`/`>` near plain text must be escaped or MDX may misparse as a tag start | https://mcp-server-langgraph.mintlify.app/contributing/mdx-syntax-guide | ⚠️ Moderate confidence — third-party-hosted Mintlify docs instance |
| General MDX→Markdown conversion is not lossless — JS expressions, imports, conditionals, loops, non-string props have no Markdown equivalent | https://www.knut.fyi/blog/2020/02/on-the-limits-of-mdx/, https://dev.to/kmelve/on-the-limits-of-mdx-1c8k | ✅ Verified |
| IMG.LY "component contracts": per-component colocated `.toMarkdown.ts` serializers; layout components unwrapped, semantic components require hand-written Markdown equivalents; build-time file refs resolved/inlined | https://img.ly/blog/making-docs-machine-readable-why-we-native-compile-markdown-for-ai-agents/ | ✅ Verified |
| `mdx2md` (Rust) supports per-component templates with a lossy `_default` catch-all for unrecognized components | https://github.com/icyJoseph/mdx2md | ✅ Verified |
| `remark-mdx`/`mdast-util-mdx` are low-level AST tools, not converters — unknown-JSX handling is left to the plugin author | https://mdxjs.com/packages/remark-mdx/, https://github.com/syntax-tree/mdast-util-mdx | ✅ Verified |
| `remark-mdx-remove-esm` only strips import/export statements, not JSX | https://www.npmjs.com/package/remark-mdx-remove-esm, https://github.com/ipikuka/remark-mdx-remove-esm | ✅ Verified |
| `mdx-to-md` (npm) exact behavior on unrecognized JSX | — | ❌ Could not verify (page fetch blocked) |
| GitHub Mermaid diagram support (native, Feb 2022; wikis Aug 2022) | https://github.blog/developer-skills/github/include-diagrams-markdown-files-mermaid/, https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/creating-diagrams, https://github.blog/changelog/2022-08-09-wikis-now-support-math-and-mermaid-diagrams/ | ✅ Verified |
| GitHub Math/LaTeX support (native, May 19 2022, `$...$`/`$$...$$`) | https://github.blog/changelog/2022-05-19-render-mathematical-expressions-in-markdown/, https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/writing-mathematical-expressions | ✅ Verified |
| GitHub Alerts: exact 5 types (NOTE/TIP/IMPORTANT/WARNING/CAUTION), native since Dec 14 2023 | https://github.blog/changelog/2023-12-14-new-markdown-extension-alerts-provide-distinctive-styling-for-significant-content/ | ✅ Verified |
| `<details>`/`<summary>` GitHub support, blank line required after `</summary>` | https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections | ✅ Verified |
| GitHub HTML sanitizer is `html-pipeline`'s `SanitizationFilter`; allowlist confirmed from source | https://github.com/gjtorikian/html-pipeline/blob/main/lib/html_pipeline/sanitization_filter.rb | ✅ Verified (allowlist confirmed; exact unknown-tag strip-vs-escape behavior not quoted verbatim, inferred only) |
| GitHub inline hex-color swatch preview exists but only in Issues/PRs/comments, not README files; no official announcement found | https://github.com/Mottie/GitHub-userscripts/wiki/GitHub-code-colors | ⚠️ Community-documented only, not official |
| GitHub Footnotes support (native, Sept 30 2021) | https://github.blog/changelog/2021-09-30-footnotes-now-supported-in-markdown-fields/ | ✅ Verified |
| GitHub auto-generates an interactive Outline/TOC UI for `.md` files with 2+ headings (Apr 13 2021) — UI chrome, not in-document content | https://github.blog/changelog/2021-04-13-table-of-contents-support-in-markdown-files/ | ✅ Verified |
| `gh-md-toc` tool for generating an in-document plain-markdown TOC | https://github.com/ekalinin/github-markdown-toc | ✅ Verified |
| `<picture>`/`prefers-color-scheme` and `#gh-dark-mode-only`/`#gh-light-mode-only` for adaptive README images is an official GitHub-documented technique | https://github.blog/developer-skills/github/how-to-make-your-images-in-markdown-on-github-adjust-for-dark-mode-and-light-mode/ | ✅ Verified |
| Real high-star repos use stacked `<details>`/`<summary>` blocks as the de facto "tabs" pattern in READMEs | https://github.com/starship/starship/blob/master/README.md (58.4k★), https://github.com/ajeetdsouza/zoxide/blob/main/README.md (37.5k★), https://github.com/motdotla/dotenv/blob/master/README.md (20.5k★) | ✅ Verified |
| Secondary anchor-link "fake tab bar" pattern exists but is jump-nav, not real tab-switching | https://github.com/PaddlePaddle/PaddleSpeech/blob/develop/README.md (12.6k★), https://github.com/facebookresearch/multimodal/blob/main/README.md (1.7k★) | ✅ Verified |
| No real `<table>`-faked-tabs example or "GitHub README tabs hack" blog post with a concrete cited repo could be found | Extensive GitHub code search + web search | ❌ Confirmed gap |

---

## Open questions (for implementation phase, if tabs are pursued)

1. Exact tag/attribute grammar for the inert `<tabs>`/`<tab value="...">` extension — needs a concrete spec before touching `PlanPreview.tsx`.
2. Whether CommonMark's HTML-block blank-line rules (already governing `<details>`) need explicit documentation in the Plans agent system prompt, given §4's note that this needs spot-checking.
3. Whether the `@mention`/`[[kbd]]`/`#tag` chip convention should be extended for status badges and plan cross-references, or whether a new convention is cleaner.
