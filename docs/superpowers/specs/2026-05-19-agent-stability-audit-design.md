---
title: Agent Stability Audit — Zod+retry everywhere + CoT+Structured split
date: 2026-05-19
status: approved
---

# Agent Stability Audit: Zod + CoT+Structured

Audit of all wiki-agent phases. Classifies deterministic vs LLM-dependent steps. Closes structural gaps via unified Zod schemas + `parseWithRetry`. Reduces LLM calls in lint. Adds UI progress in fix step.

## Problem

Two categories of instability:

1. **No schema validation on page-array outputs** — `parseJsonPages()` uses regex (`/\[[\s\S]*\]/`) with no Zod, no retry. Used in `ingest` and `lint-fix`. Silent failure: invalid or partial JSON → 0 pages written with no error.

2. **Inconsistent retry infrastructure** — `parseWithRetry` exists for structured outputs (`init`, `lint-patch`, `query-seeds`) but is not used for page-array outputs or `format`. `format` has its own hand-rolled retry that duplicates the logic.

3. **Lint: 3 LLM calls, assess and fix are separate** — assess produces free-text, fix produces a JSON array. Two independent calls for semantically coupled work. Fix step has no UI progress.

## Audit Table

| Phase | Deterministic (code) | LLM-dependent (prompt) | Current guard |
|---|---|---|---|
| **ingest** | detectDomain, path security, backlink sync, frontmatter upsert | Entity extraction, page content, annotation | `parseJsonPages()` — regex, **no Zod, no retry** |
| **lint assess** | `checkStructure` (regex), `checkGraphStructure` (hub threshold) | Quality analysis in markdown | None — free text, not needed |
| **lint fix** | path security, write loop, backlink sync | Which pages to fix and how | `parseJsonPages()` — **no Zod, no retry**, no UI progress |
| **lint actualize** | Zod merge logic | entity_types, language_notes | `parseWithRetry` ✓ |
| **query seeds (Jaccard)** | Jaccard on tokens + BFS expand | — | — |
| **query seeds (LLM fallback)** | — | Seed selection by index | `parseWithRetry` ✓ |
| **query answer** | contextBlock building | Answer text | None — free text, not needed |
| **init bootstrap** | Zod schema | DomainEntry structure | `parseWithRetry` ✓ |
| **init incremental** | Zod schema | entity_types delta | `parseWithRetry` ✓ |
| **format** | `missingTokensWithContext`, `appendMissingLines`, truncation detect | Formatting + report | Custom hand-rolled retry + `extractJsonObject()` — **not Zod, duplicates parseWithRetry** |

## Design

### 1. New Zod schemas

Add to `src/phases/zod-schemas.ts`:

```ts
export const WikiPageSchema = z.object({
  path: z.string(),
  content: z.string(),
  annotation: z.string().optional(),
});

// Wraps page-array output with CoT reasoning field
export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
});

// Lint combined assess+fix output
export const LintOutputSchema = z.object({
  reasoning: z.string(),
  report: z.string(),   // markdown shown to user
  fixes: z.array(WikiPageSchema),
});

// Format output
export const FormatOutputSchema = z.object({
  report: z.string(),
  formatted: z.string(),
});
```

### 2. Ingest: replace `parseJsonPages` with `parseWithRetry`

- Prompt updated to return `{reasoning, pages}` instead of raw array
- `pages` validated by `WikiPagesOutputSchema` via `parseWithRetry` (buffers full response)
- After parsing, `reasoning` yielded as `{ kind: "assistant_text", delta: result.reasoning, isReasoning: true }` before write loop
- `parseJsonPages()` retained only as internal fallback utility for legacy fixtures/tests

`callSite` value: `"ingest.pages"` (add to `CallSite` union in `parse-with-retry.ts`)

### 3. Lint: merge assess + fix into single CoT+Structured call

**Before:** assess (free text LLM) → fix (JSON array LLM) → actualize (parseWithRetry). 3 calls.

**After:** assess+fix (parseWithRetry with `LintOutputSchema`) → actualize (parseWithRetry). 2 calls.

- `report` field replaces the free-text assess output
- `fixes` field replaces the `buildFixMessages` second call
- `report` is yielded as `assistant_text` to user
- Before writing each page in `fixes`, yield `assistant_text` with filename (UI progress)

`callSite`: `"lint.fix"` (rename from unused to this; current `"lint.patch"` stays for actualize)

Prompt (`prompts/lint.md`) updated: return `{reasoning, report, fixes}` JSON instead of markdown-only.

### 4. Format: add Zod validation, keep custom retry flow

Format's retry is more complex than `parseWithRetry` supports: truncation is detected from `finish_reason` in the stream (post-call, pre-parse), and token-restore is a domain-specific multi-turn step. Replacing `parseWithRetry` wholesale would require exposing `finish_reason` from `streamOnce` — unnecessary complexity.

**Simpler change:** keep the `callOnce` loop, replace `extractJsonObject()` with `FormatOutputSchema.safeParse(raw)`. Add `structuralErrorCounter.record()` on failure to align with shared metrics.

**After:**
1. First `callOnce` — same as before
2. Truncation detect from `finish_reason` — same as before
3. **Replace** `extractJsonObject(fullText)` → `parseStructured(fullText)` + `FormatOutputSchema.safeParse(raw)`
4. On Zod failure: existing retry message + second `callOnce` — same as before
5. Token-integrity check post-parse — same as before
6. Token-restore multi-turn — same as before

Net: `extractJsonObject()` removed from format path, Zod added, `structuralErrorCounter` hooked in.

`callSite`: `"format.output"` (add to `CallSite` union)

### 5. UI progress for lint-fix

After `parseWithRetry` returns validated `fixes` array:

```ts
for (const page of result.fixes) {
  yield { kind: "assistant_text", delta: `  • ${page.path.split("/").pop()}...\n` };
  yield { kind: "tool_use", name: "Write", input: { path: page.path } };
  // ... write ...
}
```

User sees each filename as it's written, not a silent wait.

### 6. `CallSite` union additions

```ts
export type CallSite =
  | "init.bootstrap" | "init.delta"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds"
  | "ingest.pages"       // new
  | "format.output";     // new
```

## Impact Summary

| Change | LLM calls delta | Validation added | Retry added |
|---|---|---|---|
| ingest: parseWithRetry | 0 | WikiPagesOutputSchema | ✓ |
| lint: merge assess+fix | −1 per domain | LintOutputSchema | ✓ |
| format: parseWithRetry | 0 | FormatOutputSchema | ✓ (replaces custom) |
| lint-fix UI progress | 0 | — | — |

## Files Changed

- `src/phases/zod-schemas.ts` — add 4 schemas
- `src/phases/parse-with-retry.ts` — add 2 CallSite values
- `src/phases/ingest.ts` — replace parseJsonPages with parseWithRetry
- `src/phases/lint.ts` — merge assess+fix, add UI progress
- `src/phases/format.ts` — replace custom retry with parseWithRetry
- `prompts/ingest.md` — return `{reasoning, pages}` JSON
- `prompts/lint.md` — return `{reasoning, report, fixes}` JSON
- `prompts/format.md` — no change (already requests `{report, formatted}`)

## Out of Scope

- BM25/TF-IDF for seed selection (Jaccard is adequate, separate concern)
- `parseJsonPages()` deletion (keep for tests)
- DSPy prompt optimization (separate initiative)
