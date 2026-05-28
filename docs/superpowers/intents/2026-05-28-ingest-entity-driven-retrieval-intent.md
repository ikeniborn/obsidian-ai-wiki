# Intent: ingest entity-driven retrieval (no graph)

**Date:** 2026-05-28
**Status:** draft

## Objective

Current ingest sends excessive context to the LLM: `PageSimilarityService` selects seed pages from the source file, then BFS over the wiki graph expands the seed set — graph traversal pulls in pages that are structurally connected but not semantically relevant to the article being ingested. This produces false associations and inflates token usage.

Replace the single-pass `source → similarity → BFS → LLM` flow with a two-stage entity-driven retrieval: (1) LLM reads the article and emits the set of entities it contains, (2) for each entity, vector top-K lookup over `_index.md` annotations finds the matching wiki pages, (3) only the union of those top-K results is passed to the second LLM call that writes/updates/merges wiki pages.

## Desired Outcomes

- Logs show the entity extraction phase followed by per-entity top-K retrieval, with the relevant article paths listed per entity.
- Progress events visibly distinguish the two phases: "extract entities" → per-entity "retrieve top-K" → wiki write actions (create / update / merge).
- Grafana token-usage panel shows a measurable drop in ingest LLM input tokens vs. the current BFS-expanded baseline.
- End-to-end ingest wall-clock time decreases.
- Result summary distinguishes three action types: created, updated, merged.

## Health Metrics

- Recall on existing pages must not degrade — the LLM must not create duplicates because the relevant existing page was missed by per-entity retrieval. The new flow trades graph breadth for annotation-based precision; recall is the load-bearing metric.
- `entity_types_delta` continues to flow from the second LLM call and merges into domain config as today.
- `Per-page Progress Events` remain visible (Create / Update / Merge variants).

## Strategic Context

- Scope: **ingest only**. `lint`, `query`, `format`, `init` continue to use `PageSimilarityService` + `wiki-graph` BFS unchanged.
- `PageSimilarityService` ([src/page-similarity.ts](src/page-similarity.ts)) — ingest path bypasses BFS; embedding/Jaccard ranking is reused per-entity instead of per-source-file.
- `_index.md` annotations remain the indexed surface for vector embeddings.
- `_config/_embeddings.json` cache reused as-is.
- `wiki-graph.md` and BFS traversal stay in the codebase for other phases.
- Priority trade-off: **trust** (precise retrieval per entity) and **speed** (shorter LLM input).

## Constraints

### Steering (behavioral guidance)

- Per-entity retrieval invoked once per entity returned by the extraction call; entities with zero top-K matches go to the second LLM as "no existing page" signals so the LLM creates a new wiki page.
- Top-K per entity is a config parameter (analogous to current `similarityTopK`); same default as today's similarity top-K unless overridden.
- Progress logs include per-entity lines of the form `entity i/N: <name> → top-K: [paths]`.
- Merge events report the new path and the deleted old paths in the result summary.
- The second LLM call decides update vs. merge vs. create from the retrieved context — code does not impose a similarity threshold.

### Hard (architectural enforcement)

- **No graph traversal in ingest.** BFS is not invoked from the ingest phase. The wiki graph may still be read by other phases.
- Ingest performs exactly two LLM calls per source file: (1) entity extraction, (2) wiki update / create / merge.
- Vector retrieval is the default; on vector unavailability (no API key, endpoint error, missing cache) the system falls back to Jaccard scoring over annotations. Same fallback rule as today's `PageSimilarityService`.
- Merge is implemented as **create new page + delete old pages**, not as in-place path mutation. Old paths are removed via the same delete path used elsewhere.
- Output schema for the wiki call remains `WikiPagesOutputSchema` (`{path, content, annotation}[]` + optional `entity_types_delta`); merge is expressed by emitting the new page plus delete signals (mechanism to be specified in the spec).

## Autonomy Zones

- **Full autonomy (reversible, low risk):**
  - Top-K value from config.
  - Vector → Jaccard fallback on retrieval error.
  - LLM decision: update vs. merge vs. create.
  - Auto-deletion of old pages when LLM emits a merge.
  - Creating a new wiki page when an entity has zero top-K matches.
  - Emitting per-entity progress events.
- **Guarded (log + confidence threshold):** none for this feature.
- **Proposal-first (needs approval):** none — ingest is non-interactive by design.
- **No autonomy (human only):** changing the two-call structure or reintroducing BFS into ingest requires a new intent doc.

## Stop Rules

- **Halt if:** the entity extraction LLM call fails after `parseWithRetry` exhausts retries — ingest yields an error result, no wiki pages are written, no `entity_types_delta` is applied.
- **Halt if:** both vector retrieval and Jaccard fallback fail for an entity (e.g. cannot read annotations) — error surfaced; per-entity retrieval should not silently send an empty context.
- **Escalate if:** the wiki write call requests deletion of more than a reasonable number of pages in a single merge — exact threshold to be set in the spec; surfaced as a warning so the user can audit large merges.
- **Done when:**
  - Ingest finishes with a `Result Summary` covering created / updated / merged counts.
  - `entity_types_delta` (if any) is merged and `domain_updated` is emitted.
  - Per-entity progress events were emitted for every extracted entity.
  - Grafana shows the expected reduction in LLM input tokens compared to the BFS baseline.
