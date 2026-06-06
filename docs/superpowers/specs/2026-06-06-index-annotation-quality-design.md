---
review:
  spec_hash: 145818d2ad3646d0
  last_run: 2026-06-06
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Acceptance (from intent)"
      section_hash: ae2260b97f66e513
      text: "Done-when criterion 'precision did not drop AND latency/cost stayed within bounds' has no measurable threshold — qualitative verification only."
      verdict: fixed
      verdict_at: 2026-06-06
chain:
  intent: docs/superpowers/intents/2026-06-06-index-annotation-quality-intent.md
---
# Design: index-annotation-quality

**Date:** 2026-06-06
**Status:** draft
**Intent:** [2026-06-06-index-annotation-quality-intent.md](../intents/2026-06-06-index-annotation-quality-intent.md)

## Problem

The per-page annotation in `_index.md` is the *sole* text used to select seed
pages during query — for both the embedding (cosine) and Jaccard engines. Today
annotations are a single sparse sentence, produced by prompts that explicitly ask
for "одно предложение". Sparse annotations cause retrieval to miss relevant wiki
pages, producing incomplete answers.

## Acceptance (from intent)

Carried verbatim from the approved intent doc — these define "done":

- Queries that previously missed wiki data (skipped relevant pages due to sparse
  descriptions) now retrieve more relevant pages and produce complete answers.
- Seed selection (top-K) hits the correct page for queries phrased with synonyms
  / adjacent terms that do **not** appear in the page title.
- **Done when:** on a set of real queries that previously gave incomplete
  answers, top-K seed selection covers the needed pages and answers are complete,
  AND precision did not drop AND query latency/cost stayed within bounds.

**Measurable thresholds** (operationalize the qualitative criteria above for
verification):

- **Precision** — on the benchmark query set (the real queries that previously
  gave incomplete answers), every page present in the pre-change top-K remains in
  top-K, and no previously-irrelevant page displaces a relevant one
  (precision@K ≥ baseline).
- **Latency** — query seed-selection time increases ≤ 10% vs the pre-change
  baseline on the same query set.
- **Cost** — annotation length stays ≲ 500 chars (~150 embedding tokens/page);
  the format change triggers a one-time re-embed of changed pages only, not the
  whole vault.

> Coverage is **gradual** (see Scope): existing pages upgrade only when
> re-ingested/re-linted. Verifying Done-when on the current vault requires
> re-ingesting the target sources first.

## Scope

Minimum change. Because the storage format stays a single line, the parser,
embedding cache, Jaccard scorer, and zod schema are **not** touched. The change
is concentrated in the generation prompts plus one invariant guard.

**In scope:**
1. Rewrite the annotation instruction in 3 prompts.
2. One normalization guard in `upsertIndexAnnotation` (newline/whitespace →
   single space) to enforce the single-line invariant.
3. Tests for the guard + parser round-trip with rich annotations.
4. `lat.md/` documentation updates + `lat check`.

**Out of scope:**
- Multi-line annotation block format (rejected — would require rewriting parser +
  upsert + remove on the central retrieval path; higher risk).
- Programmatic length truncation (rejected by user — truncation would sever key
  terms; length is a soft prompt target only).
- Bulk re-annotation of existing pages (rejected by user — coverage is gradual).
- Changes to `parseIndexAnnotations`, `page-similarity.ts`, `wiki-seeds.ts`,
  `zod-schemas.ts`, the file format, or the embedding cache structure.

## Design decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage format | Single long line | Parser regex `(.+)$` already captures arbitrary-length text to EOL. Zero parser change, backward compatible, lowest risk. |
| Annotation structure | Structured: summary + `Затрагивает:` + `Тип:` + `Термины:` | Semantic anchors for embedding; explicit term mass for Jaccard; `Термины:` (synonyms) directly serves the synonym-recall outcome. |
| Length | ~500 chars, soft prompt target, no code truncation | Balances recall vs noise/cost. No truncation avoids cutting key terms mid-string. |
| Coverage | Gradual (new/changed pages only) | User decision. No new bulk-regeneration component. |
| Cache migration | Automatic via `annotationHash` | Changed annotation → hash mismatch → per-page re-embed on next `refreshCache`. No migration code; no data loss. |

## Architecture & data flow

No new components. The annotation already flows ingest/lint → `_index.md` →
query. Only the generated *content* gets richer and one write-time guard is added.

```
ingest / lint / lint-chat
  → LLM emits page.annotation (rich, structured, single logical line)
  → upsertIndexAnnotation()
       └─ [NEW] normalize: annotation.replace(/\s+/g, " ").trim()
  → write "- [[pid]] path — {annotation}" to _index.md
  → refreshCache(): annotationHash changed → re-embed that page

query
  → parseIndexAnnotations()  (regex (.+)$ — unchanged, reads rich line)
  → embedding cosine / Jaccard scoreSeed see richer text → better seed selection
```

### Component 1 — Prompt instruction (3 files)

`prompts/ingest.md`, `prompts/lint.md`, `prompts/lint-chat.md` currently say:

> "annotation": одно предложение — описание сущности для поиска по смыслу

Replace with a shared, consistent instruction (same wording across all three so
embedding/Jaccard see a uniform format):

```
- "annotation": богатое описание для семантического поиска (embedding + Jaccard).
  На ОДНОЙ строке, без переносов. Ориентир ~500 символов. Структура:
  <summary 1-2 предложения сути> Затрагивает: <сущности, таблицы, системы,
  Jira-ID через запятую>. Тип: <тип операции/изменения>. Термины: <синонимы и
  ключевые слова, которых может не быть в заголовке>.
  Опирайся на содержимое самой страницы. Конкретика, без воды и boilerplate —
  общие фразы поднимают шум в поиске.
```

Example output (single line):

```
Задача Jira DG-49: доработка Excel-шаблона для экспорта и импорта спецификаций
в S3. Затрагивает: Excel-шаблон, спецификации, S3-экспорт, маппинг колонок.
Тип: доработка шаблона выгрузки/загрузки. Термины: выгрузка, импорт, экспорт,
признак исключения из представления, спецификация.
```

The "no boilerplate" guidance protects precision: generic phrases common across
all pages inflate every page's Jaccard match and add embedding noise.

### Component 2 — Single-line guard (`src/wiki-index.ts`)

In `upsertIndexAnnotation`, normalize before building the entry line:

```ts
// collapse newlines / whitespace runs → single space; enforce single-line invariant
const oneLineAnnotation = annotation.replace(/\s+/g, " ").trim();
const entryLine = `- [[${pid}]] ${relPath} — ${oneLineAnnotation}`;
```

This is **not** truncation — all content is preserved; only whitespace collapses.
Without it, an LLM-emitted `\n` would make the parser's `(.+)$` capture only up to
the newline, silently dropping the rest (violates the "no silent data loss" hard
constraint). `removeIndexAnnotation` is unchanged (operates by pid).

## Error handling

- **Empty/missing annotation** — existing behavior preserved: `ingest.ts:361`
  gates on `if (page.annotation)`, so empty annotations are not written.
- **Embedding API failure during re-embed** — `refreshCache` already swallows
  per-batch (`catch { continue }`); the stale vector remains cached. No regression.
- **Backward compatibility** — old short single-line entries parse with the same
  unchanged regex; they read as-is.

## Testing

New `tests/wiki-index.test.ts` cases (vitest, existing `makeVt` helper):

| Test | Verifies |
|------|----------|
| upsert collapses `\n` in annotation to single line | guard enforces single-line, content preserved |
| upsert collapses whitespace runs to one space | normalization |
| round-trip: upsert rich ~500-char annotation → `parseIndexAnnotations` reads it whole | regex `(.+)$` holds rich line with `:` and `,` |
| backward compat: old short entry still parses | no regression on existing indexes |

Prompts are not unit-tested (LLM output); their effect is verified via Outcome
Verification (intent doc) after re-ingesting target sources.

## Documentation (lat.md — REQUIRED post-task)

- Update `lat.md/operations.md#Query` — annotation is now a rich structured
  string (summary + entities + type + terms), not a single sentence.
- If a guard-test spec section is added under `tests.md`, include the matching
  `// @lat:` code reference (project requires `require-code-mention`).
- Run `lat check` — all wiki links and code refs must pass.

## Risks

- **Annotation bloat** — without code truncation, a misbehaving LLM could emit
  very long annotations, raising embedding cost and Jaccard noise. Mitigation:
  soft ~500-char target in the prompt. Escalate (per intent Stop Rules) if
  annotations bloat or precision/latency degrade on the test query set.
- **Gradual coverage gap** — existing pages keep sparse annotations until
  re-ingested. This is an accepted user decision; flagged so Outcome Verification
  re-ingests target sources before measuring.
