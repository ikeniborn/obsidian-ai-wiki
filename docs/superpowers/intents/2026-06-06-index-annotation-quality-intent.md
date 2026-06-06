# Intent: index-annotation-quality

**Date:** 2026-06-06
**Status:** approved

## Objective
The per-page annotation in `_index.md` is the *sole* text used to select seed
pages during query — for both the embedding (cosine) and Jaccard retrieval
engines. Today annotations are weak for two reasons: (a) the ingest LLM prompt
produces too little text, and (b) the storage format is a single line
(`- [[pid]] path — text`) that physically cannot hold a rich description.
Triggered by concrete bad query answers: retrieval missed relevant wiki pages
because their descriptions were sparse.

## Desired Outcomes
- Queries that previously missed wiki data (skipped relevant pages due to sparse
  descriptions) now retrieve more relevant pages and produce complete answers.
- Seed selection (top-K) hits the correct page for queries phrased with
  synonyms / adjacent terms that do **not** appear in the page title.
- Each page's annotation in `_index.md` is a richer, multi-sentence summary built
  from the page's own wiki context (entities, operation type, key terms).

## Health Metrics
- **Query latency / cost** — longer annotations mean more tokens to embed and
  longer Jaccard token sets; query latency and API spend must not grow
  noticeably.
- **Precision** — a longer annotation must not pull irrelevant seeds (bloat =
  noise that crowds out the real top-K).
- **Backward compatibility** — existing single-line `_index.md` files must still
  parse and read correctly.
- **Ingest cost** — richer annotation generation must not blow up per-page token
  cost at load time.

## Strategic Context
- Interacts with: `ingest` (writes annotation), `query` (reads via
  `parseIndexAnnotations` → embedding + Jaccard seed selection),
  `page-similarity` (embedding cache keyed on `annotationHash`),
  `wiki-seeds` (Jaccard `scoreSeed`), and `lint` (can update the index and the
  vectors).
- Priority trade-off: **trust** — selection precision matters more than speed or
  cost. When they conflict, favor correct retrieval.

## Constraints
### Steering (behavioral guidance)
- Annotation is structurally rich and multi-sentence: surface entities
  (tables / systems / Jira IDs), operation type, and synonym-bearing key terms.
- Generate the annotation by summarizing the page's own wiki context (the article
  body produced during ingest), not just restating the title.
- Keep a length ceiling — rich but bounded, to protect precision against bloat.

### Hard (architectural enforcement)
- Backward compatibility: old single-line `_index.md` files MUST still be read by
  `parseIndexAnnotations`.
- `parseIndexAnnotations` + the embedding cache (`annotationHash`) must not
  silently drop or corrupt data under the new format.
- `annotation` stays a wiki-page-only concept; it must not leak into source-file
  frontmatter (kept stripped at ingest/lint).

## Autonomy Zones
- Full autonomy (reversible, low risk): none for the core retrieval path.
- Guarded (log + confidence threshold): annotation generation prompt; annotation
  length ceiling. Iterable and reversible.
- Proposal-first (needs approval): storage format change (single long line vs
  multi-line block — affects parser + cache + backward compat); embedding-cache
  migration / invalidation strategy on format change.
- No autonomy (human only): none.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules
- Halt if: a format change would make existing single-line `_index.md` files
  unreadable, or would silently invalidate/lose embedding-cache data without a
  defined migration.
- Escalate if: precision drops or query latency/cost grows noticeably on the test
  query set after enriching annotations.
- Done when: on a set of real queries that previously gave incomplete answers,
  top-K seed selection covers the needed pages and answers are complete, AND
  precision did not drop AND query latency/cost stayed within bounds.
