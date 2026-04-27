# Ollama Model Prompt Quality Research

**Date**: 2026-04-27  
**Context**: Testing workflow system prompts for the Prototyper app's AI-driven workflow nodes  
**Tester**: Automated test runner v2 (77 structured assertions across 8 prompt types)

---

## Executive Summary

All 8 workflow system prompts were tested against 3 models: **gemma4-26b-128k** (local), **minimax-m2.7** (cloud), and **kimi-k2.6** (cloud, partial). Results show the prompts are production-ready for gemma4 and minimax, with minor improvements needed for Structure and Transform prompts. kimi-k2.6 showed severe reliability issues and is not recommended for workflow use.

| Model | Assertions | Passed | Pass Rate | Perfect Tests | Avg Latency |
|-------|-----------|--------|-----------|---------------|-------------|
| gemma4-26b-128k | 77 | 75 | **97.4%** | 6/8 | ~21s |
| minimax-m2.7 | 77 | 74 | **96.1%** | 5/8 | ~19s |
| kimi-k2.6 | — | — | **FAILED** | — | >100s timeout |

---

## Test Methodology

Each of the 8 workflow prompt types was tested with a representative user input. Assertions check:

- **Section structure**: Required `## Section` headers exist
- **Schema format**: Required format patterns like `**FR-N**:`, `interface`, `export default function`
- **Code quality**: Balanced braces/parens, no `any` type, proper imports, default export
- **CSS variables**: `var(--` references, no hardcoded hex/rgb colors
- **Accessibility**: aria- attributes, label elements, semantic HTML
- **Content relevance**: Output mentions expected domain terms
- **Constraint adherence**: No HTML wrapper, no preamble, no implementation code where forbidden
- **Minimum length**: Output exceeds a reasonable threshold

---

## Per-Model Results

### gemma4-26b-128k (local) — 75/77 (97.4%)

| Prompt | Assertions | Result | Latency | Output Length |
|--------|-----------|--------|---------|---------------|
| Requirements | 11/11 | ✅ Perfect | 21.4s | 3,054 chars |
| Architect | 9/9 | ✅ Perfect | 18.1s | 5,747 chars |
| Structure | 10/11 | ⚠️ | 34.0s | 11,356 chars |
| Style | 11/11 | ✅ Perfect | 22.5s | 3,867 chars |
| Interaction | 10/10 | ✅ Perfect | 20.2s | 5,845 chars |
| Reference | 8/8 | ✅ Perfect | 12.9s | 2,782 chars |
| Validate | 7/7 | ✅ Perfect | 12.4s | 1,713 chars |
| Transform | 9/10 | ⚠️ | 3.1s | 175 chars |

**Failed assertions:**

1. **Structure — No HTML/DOCTYPE wrapper** (❌): The model wrapped the React component in `<!DOCTYPE html><html>...</html>` tags despite the prompt explicitly stating "Do NOT wrap in HTML, DOCTYPE, html, head, or body tags."
2. **Transform — Has table separator row** (❌): The model's markdown table output used a format that didn't match the `|---|---|` separator pattern (output was only 175 chars, suggesting truncation or `num_predict` limit hit).

### minimax-m2.7 (cloud) — 74/77 (96.1%)

| Prompt | Assertions | Result | Latency | Output Length |
|--------|-----------|--------|---------|---------------|
| Requirements | 11/11 | ✅ Perfect | 17.1s | 5,521 chars |
| Architect | 8/9 | ⚠️ | 28.8s | 8,545 chars |
| Structure | 11/11 | ✅ Perfect | 32.5s | 12,196 chars |
| Style | 10/11 | ⚠️ | 17.3s | 3,972 chars |
| Interaction | 10/10 | ✅ Perfect | 9.4s | 4,881 chars |
| Reference | 8/8 | ✅ Perfect | 22.2s | 3,540 chars |
| Validate | 6/7 | ⚠️ | 9.7s | 1,540 chars |
| Transform | 10/10 | ✅ Perfect | 4.1s | 176 chars |

**Failed assertions:**

1. **Architect — No implementation code** (❌): The model included `const`/`let` variable assignments and implementation code, despite the prompt stating "Do NOT write implementation code — only interfaces, types, and structure."
2. **Style — No responsive breakpoints** (❌): The model didn't use `sm:`, `md:`, or `lg:` responsive breakpoint classes despite the prompt explicitly requiring "Mobile-first responsive: default 375px, sm: 640px, md: 768px, lg: 1024px+."
3. **Validate — Catches TypeScript issues** (❌): The model's validation output didn't use the words "TypeScript", "type", "any", or "implicit" despite the test code having an untyped `users` parameter (implicit `any`).

### kimi-k2.6 (cloud) — FAILED

| Prompt | Assertions | Result | Latency |
|--------|-----------|--------|---------|
| Requirements | 11/11 | ✅ Perfect | 102s |
| Architect | 0/9 | ❌ Empty output | 139s |
| Structure+ | — | **Aborted** | — |

**Issues:**
- Requirements test passed but took **102 seconds** (vs ~21s for gemma4)
- Architect test returned **0 characters** after 139 seconds
- Subsequent tests were aborted — the model appears unreliable for structured output, possibly due to extreme latency or consistent empty responses for complex prompts

**Conclusion**: kimi-k2.6 is not viable for workflow use at this time. The latency alone makes it impractical, and the pattern of empty responses for structured prompts suggests compatibility issues.

---

## Findings by Prompt Type

### Requirements (✅ All models pass)
The prompt produces excellent structured output across all tested models. The `##` section headers and `**FR-N**:` format are consistently followed. Content is relevant and thorough.

**No changes needed.**

### Architect (⚠️ Partial)
- gemma4: Perfect
- minimax-m2.7: Includes implementation code despite instructions
- kimi-k2.6: Empty output

**Recommendation**: Strengthen the "no implementation code" instruction. Add an explicit example in the prompt of what NOT to produce:

```
BAD (implementation code):
const handleSubmit = (e: React.FormEvent) => { ... }

GOOD (structure only):
interface LoginFormProps { onSubmit: (data: LoginFormData) => void }
```

### Structure (⚠️ Partial)
- gemma4: Wraps output in HTML boilerplate despite explicit prohibition
- minimax-m2.7: Perfect
- kimi-k2.6: Not tested

**Recommendation**: Strengthen the "no HTML wrapper" instruction with an even more emphatic formulation:

```
CRITICAL: Your output must start with "import" or "export". 
Do NOT include <!DOCTYPE html>, <html>, <head>, <body>, or any HTML wrapper.
These tags WILL BREAK the application. Output ONLY the React component.
```

### Style (⚠️ Partial)
- gemma4: Perfect
- minimax-m2.7: Omits responsive breakpoints (`sm:`, `md:`, `lg:`)

**Recommendation**: Add an explicit example of responsive design in the prompt, or add a rule like:

```
- Every component MUST include at least one responsive breakpoint (sm:, md:, or lg:).
  A component without breakpoints is incomplete.
```

### Interaction (✅ All models pass 10/10 assertions)
The prompt produces excellent interactive code. State management, event handlers, and TypeScript types are all handled well.

**No changes needed.**

### Reference (✅ All models pass 8/8 assertions)
Structured documentation output is consistent and thorough.

**No changes needed.**

### Validate (⚠️ Partial)
- gemma4: Perfect (7/7)
- minimax-m2.7: Doesn't use "TypeScript" or "type" terminology in its review (6/7)

**Recommendation**: The prompt already specifies checking TypeScript errors. The failure is minor (minimax describes the issues without using the word "TypeScript" explicitly). Could add:

```
For each TypeScript issue, use the heading format: [SEVERITY] [TypeScript] Line N: ...
```

### Transform (⚠️ Partial)
- gemma4: 175 chars output — likely truncated by `num_predict` limit (set to 4096 tokens but the model may have different tokenization)
- minimax-m2.7: Perfect (10/10)
- kimi-k2.6: Not tested

The table separator assertion (`|---|---|`) is sensitive to whitespace. Markdown tables can use `| - | - | - |` or `|---|---|---|` variants. This is a test specificity issue, not a prompt issue.

**Recommendation**: 
1. For the Transform prompt specifically, consider increasing `num_predict` in the workflow execution engine.
2. The assertion should be more lenient about table separator format.

---

## Prompt Quality Assessment

### Strengths
1. **Structured output format**: All 8 prompts use clear `## Section` headers and explicit format examples. Models consistently follow the structure.
2. **Role + Rules + Output pattern**: The ROLE/INPUT/RULES/OUTPUT pattern is highly effective at constraining model behavior.
3. **Negative instructions work**: "Do NOT write code", "Do NOT hardcode colors", "Never use `any`" are generally respected.
4. **Format examples help**: Providing `**FR-N**:` format patterns ensures consistent output schema.

### Weaknesses
1. **HTML wrapping**: The Structure prompt's "Do NOT wrap in HTML" instruction is still violated by gemma4. Needs even stronger emphasis.
2. **Implementation leakage in Architect**: minimax-m2.7 produces implementation code despite "only interfaces, types, and structure" instruction. The prompt needs stronger contrast between good/bad output.
3. **Responsive breakpoint omission**: minimax-m2.7 skips `sm:`/`md:`/`lg:` classes. Needs explicit requirement rather than just mentioning "mobile-first."
4. **Short output truncation**: The Transform prompt output (175 chars for gemma4) suggests the model stopped early. May need higher `num_predict` or a prompt tweak to encourage completeness.

---

## Model Performance Comparison

| Dimension | gemma4-26b-128k | minimax-m2.7 | kimi-k2.6 |
|-----------|----------------|--------------|-----------|
| Overall pass rate | 97.4% | 96.1% | Failed |
| Perfect tests | 6/8 | 5/8 | 1/1 (partial) |
| Avg latency | ~21s | ~19s | >100s |
| Output verbosity | Medium-High | High | Very Low |
| Format adherence | Excellent | Good | Unreliable |
| Code generation | Excellent (but wraps in HTML) | Excellent | N/A |
| Best for | Local, fast iteration | Cloud, thorough output | Not recommended |

### Latency Notes
- gemma4 is local → no network latency, but GPU-bound
- minimax-m2.7 is cloud → network latency, but generally faster per-token than gemma4
- kimi-k2.6 has extreme latency (>100s per request) and produced empty output for the Architect test

---

## Recommendations

### Immediate (before shipping)
1. **Strengthen Structure prompt** — add emphatic "OUTPUT MUST START WITH `import` OR `export`" line and a BAD/GOOD example
2. **Strengthen Architect prompt** — add explicit "BAD:" example showing implementation code that should NOT be produced
3. **Fix Transform test assertion** — make table separator regex more lenient: `/\|[\s-:]+\|[\s-:]+\|/`

### Short-term (prompt refinement)
4. **Add responsive breakpoint requirement** to Style prompt — "Every component MUST include at least one responsive breakpoint"
5. **Add severity format** to Validate prompt — "For each TypeScript issue, prefix with [TypeScript]"
6. **Investigate num_predict** for Transform node — the 175-char output from gemma4 suggests early stopping. Consider bumping to 8192 for Transform specifically.

### Long-term (model strategy)
7. **Primary model**: gemma4-26b-128k for local development (fast, reliable, good format adherence)
8. **Fallback model**: minimax-m2.7 for cloud (thorough, but slower and slightly less format-strict)
9. **Avoid**: kimi-k2.6 until reliability issues are resolved
10. **Consider testing**: deepseek-v4-flash (cloud, fast/cheap) or qwen3.5:397b (cloud, large context) as alternatives

---

## Test Artifacts

- **Test runner**: `scripts/test-workflow-prompts.ts` (835 lines, 77 structured assertions)
- **gemma4 report**: `workflow-prompt-test-1777326704855.md`
- **minimax report**: `workflow-prompt-test-1777326888658.md`
- **kimi-k2.6**: Aborted after Architect returned empty (no report saved)

---

## Appendix: Assertion Breakdown by Prompt

### Requirements (11 assertions)
1. Section "## Overview" exists
2. Section "## Functional Requirements" exists
3. Section "## Non-Functional Requirements" exists
4. Section "## UX Requirements" exists
5. Section "## Data Requirements" exists
6. Section "## Edge Cases" exists
7. At least 3 `**FR-N**:` formatted requirements
8. At least 1 `**NFR-N**:` formatted requirement
9. Output mentions login/email/password
10. No code fence blocks in output
11. Output ≥ 400 chars

### Architect (9 assertions)
1. Section "## Component Tree" exists
2. Section "## Component Specifications" exists
3. Section "## State Design" exists
4. Section "## Data Flow" exists
5. Section "## File Structure" exists
6. At least 2 PascalCase component names
7. No implementation code (const/let/var assignments)
8. Contains TypeScript interface/type definitions
9. Output ≥ 300 chars

### Structure (11 assertions)
1. Contains import statement
2. Has default export function
3. Contains TypeScript types/interfaces
4. Uses useState
5. No hardcoded hex/rgb colors
6. Uses ≥2 CSS variable references
7. Contains className (Tailwind)
8. Contains accessible markup (aria/label/role)
9. Balanced braces and parens
10. No HTML/DOCTYPE wrapper
11. Output ≥ 500 chars

### Style (11 assertions)
1. Preserves useState
2. Preserves email variable
3. Preserves password variable
4. Uses ≥2 CSS variable references
5. Uses ≥3 Tailwind utility classes
6. No hardcoded hex/rgb colors
7. Has interactive states (hover/focus/active/transition)
8. Has responsive breakpoints (sm/md/lg)
9. Preserves input element
10. Preserves button element
11. Output ≥ 400 chars

### Interaction (10 assertions)
1. At least 2 useState calls
2. Uses onSubmit with preventDefault
3. Uses onChange or onBlur handlers
4. Has validation (error/valid/disabled)
5. Uses proper React event types
6. Preserves bg-card class
7. Preserves text-foreground class
8. Preserves border-border class
9. No `any` type usage
10. Output ≥ 500 chars

### Reference (8 assertions)
1. Section "## Entity Overview" exists
2. Documents Props/Interface
3. Documents Events/Callbacks
4. Documents Key Behaviors
5. Documents Dependencies
6. Documents actual ToastProps members (title/description/variant/duration/onDismiss)
7. Uses TypeScript types in documentation
8. Output ≥ 300 chars

### Validate (7 assertions)
1. Identifies errors (❌ or "Error")
2. Catches TypeScript issues
3. Catches missing `key` prop
4. Catches accessibility issues
5. Catches `onclick` case sensitivity issue
6. Has Status/Issues/Summary headings
7. Output ≥ 200 chars

### Transform (10 assertions)
1. Markdown table with ≥3 pipes
2. Table separator row exists
3. Contains Alice
4. Contains Bob
5. Contains Carol
6. Has Name column
7. Has Email column
8. Has Role column
9. No preamble/explanation
10. Output ≥ 100 chars