---
review:
  spec_hash: e96b22c38f340ee5
  last_run: 2026-07-10
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-10-hierarchical-description-chunk-retrieval-intent.md
---
# Hierarchical Description-to-Chunk Retrieval — Design

Date: 2026-07-10
Status: approved (design)
Branch: `dev-hierarchical-description-chunk-retrieval`

## Acceptance (from intent)

### Desired Outcomes

- Article description vectors select the initial seed articles for a query.
- Wiki graph neighbours of the selected seed articles join the candidate article
  pool before detailed retrieval.
- Detailed retrieval ranks clean section chunks only within the candidate pool;
  article descriptions are not part of section chunk embedding input.
- The LLM context contains only selected chunk bodies with their article identifier
  and section heading. It does not contain complete candidate articles by default.
- When embeddings are unavailable, retrieval continues through a Jaccard fallback
  instead of failing the query.

### Done when

Retrieval evidence shows description-based seed selection, graph-based candidate
expansion, clean chunk ranking inside that pool, and final context made only from
relevant chunks with article identifiers and headings, while quality and recall
match or exceed baseline and Jaccard fallback remains operational.

## Problem

The current multi-vector retrieval flow builds a summary vector from the article
description, but it also prepends that same description to every section chunk before
embedding. Page scoring then uses the best cosine across all cached vectors. This
mixes two separate jobs: broad article discovery and precise chunk relevance.

The desired behavior is hierarchical. Article descriptions should select the article
pool. Graph links should expand that pool. Only then should clean section chunks be
ranked for final context. The LLM should receive selected chunk evidence, not full
candidate articles.

## Decision Summary

- Use article description vectors for seed article selection.
- Keep graph expansion as an article-pool expansion step.
- Add a final chunk-ranking step over clean section chunks inside the candidate pool.
- Remove article descriptions from section chunk embedding input.
- Render final context as selected chunks with article id and heading.
- Preserve Jaccard fallback at both article-seed and final-chunk stages.
- Do not add user-visible settings, external vector stores, cloud services, or extra
  LLM retrieval calls.

## Current Anchors

- `src/page-similarity.ts` defines `EmbeddingChunk`, cache entries, chunk splitting,
  `buildChunkInputs`, embedding fetch, dense scoring, hybrid scoring, and Jaccard
  fallback.
- `buildChunkInputs(annotation, body, chunking)` currently emits one summary chunk
  from `annotation`, then emits section chunks whose `embedText` is
  `annotation + heading + window`.
- `maxCosine(query, vecs)` scores a page by the best chunk vector. This is useful for
  page-level seed selection, but it is not enough to select final context chunks.
- `src/phases/query.ts` uses `collectDescriptions`, `selectRelevantScoredDiag`,
  `bfsExpandRanked`, `selectContextPages`, and `renderContextPages` to send full
  selected pages to `answerFromContext`.
- `src/phases/query-cross-domain.ts` merges per-domain article candidates and calls
  `buildContextBlock`, which also renders full pages.
- `src/wiki-graph.ts` already performs undirected BFS expansion from seed articles
  and can rank non-seed graph pages with dense similarity or Jaccard fallback.

## Architecture

The retrieval pipeline becomes a three-stage ranking flow:

1. Description seed stage: compare the user query with article description vectors
   and select seed article ids.
2. Article-pool stage: expand seeds through the wiki graph and cap/rank the resulting
   article ids with the existing graph ranking rules.
3. Chunk stage: split only candidate article bodies into clean section chunks, rank
   those chunks against the query, and render only selected chunks into final context.

The implementation keeps page discovery and chunk relevance as distinct concepts.
The seed stage decides which articles deserve detailed inspection. The graph stage
decides which linked articles deserve detailed inspection. The chunk stage decides
which text reaches the LLM.

Graph-derived articles do not enter final context just because they are linked to a
seed. They must produce at least one selected chunk.

## Data Contracts

### Embedding cache

The cache version should bump from `2` to `3` because old section vectors include
article descriptions and cannot safely support clean chunk ranking.

Cached chunk metadata:

```ts
kind: "summary" | "section";
hash: string;
vector: string;
heading?: string;
ordinal?: number;
```

`summary` chunks:

- `embedText = description`
- used for article seed selection
- not rendered as final evidence chunks

`section` chunks:

- `embedText = heading + "\n" + window`
- `heading` is required for final context
- `ordinal` preserves stable in-page ordering
- article description is not present in the embedding input

The cache stores vectors and enough metadata to map a selected section vector back to
the fresh section split. It should not become a second copy of full article bodies.

### Selected chunk

Final retrieval produces selected chunks with this shape:

```ts
articleId: string;
path: string;
heading: string;
body: string;
score: number;
source: "seed" | "graph";
articleScore?: number;
ordinal: number;
```

`articleId`, `heading`, and `body` are required context fields. `score`, `source`,
`articleScore`, and `ordinal` are diagnostic and ordering fields.

## Ranking

### Seed article ranking

Seed ranking uses description vectors only. In embedding mode, the query vector is
compared against summary vectors. In hybrid mode, description-vector ranking fuses
with existing description Jaccard ranking. In Jaccard mode, seeds continue to come
from `scoreSeed(queryTokens, pid, "", description)`.

The existing seed fallback behavior remains:

- embedding request failure falls back to Jaccard
- low dense similarity can fall back to Jaccard or existing single-domain LLM seed
  fallback
- no new LLM call is added

### Graph article pool

`bfsExpandRanked` remains the graph expansion mechanism for article ids. Its result
is treated as the candidate article pool, not as final context. Existing knobs
(`graphDepth`, `bfsTopK`, fusion, relevance floor) keep their semantics unless the
implementation needs internal diagnostics to expose article-pool decisions.

### Final chunk ranking

Final chunk ranking evaluates only section chunks from candidate articles. The first
implementation should derive the chunk cap from existing context limits instead of
adding a user-visible setting. A conservative default is the old page context cap
shape: `seedTopK * 3`, but applied to chunks rather than pages.

Ordering:

1. higher chunk relevance score first
2. seed article chunks before graph article chunks when chunk scores tie
3. higher article score before lower article score when still tied
4. stable order by article id, then section ordinal

Only chunks with positive relevance enter context. If embedding chunk ranking fails,
Jaccard chunk ranking runs over `heading + "\n" + window` inside the same candidate
article pool.

## Context Rendering

The final context block renders chunk evidence, not full candidate pages:

```md
--- article: wiki_embeddings, heading: ## Cache format ---
Embedding cache stores summary vectors for page discovery and section vectors for
detailed retrieval...

--- article: wiki_graph, heading: ## BFS expansion ---
Graph expansion treats links as undirected...
```

Rendering requirements:

- include article identifier
- include section heading
- include selected chunk body
- do not include the article description as context metadata unless it is part of
  an actual selected section body
- do not render a complete article body by default

`selectedIds` passed to answer validation should be the unique article ids represented
by selected chunks. WikiLink target blocks may continue to list those final article
ids.

## Cross-Domain Behavior

Cross-domain retrieval keeps its two-level article merge, but final context still
uses selected chunks.

Per domain:

1. collect description seeds
2. expand graph candidate pool
3. return candidate pages and article scores

Across domains:

1. merge article candidates with existing fusion
2. cap final article ids
3. rank clean chunks only inside the capped cross-domain article pool
4. render selected chunk context

`found_pages` remains unique article ids from selected chunks for compatibility.
Diagnostic metadata should add `found_chunks` or an equivalent list with article id,
heading, and score.

## Observability

Extend existing events rather than adding a separate reporting surface.

`query_stats` should keep `pagesSelected` for compatibility and add:

- `chunksSelected`
- `candidatePages`
- `seedCount`
- `graphCount`

`eval_meta.retrievalConfig` should expose that hierarchical chunk retrieval was used.
`eval_meta.fields` should include final selected chunk identifiers when available.

Graph statistics remain article-level. Chunk statistics are emitted after final chunk
selection.

## Fallbacks And Errors

- No embeddings configured: article seeds use description Jaccard; final chunks use
  clean chunk Jaccard.
- Embedding API fails during seed selection: existing Jaccard seed fallback runs.
- Embedding API fails during chunk ranking: Jaccard chunk fallback runs inside the
  candidate article pool.
- No selected chunk after both embedding and Jaccard ranking: query returns the
  existing "No relevant pages found" style error instead of sending full pages.
- Missing or empty descriptions: existing description fallback remains responsible for
  seed text.
- Missing vectors after cache version bump: vectors are rebuilt through existing
  refresh/loading paths.

## Requirements

R1. Section embedding inputs must exclude article descriptions.

Acceptance: a unit or eval check proves that `buildChunkInputs("description", body)`
creates a summary input equal to `"description"` and section inputs containing only
heading plus window text.

R2. Article seed selection must use description-level vectors or description Jaccard.

Acceptance: query diagnostics identify seed articles selected from description scoring,
not section chunk scoring.

R3. Graph expansion must add candidate articles before final chunk retrieval.

Acceptance: a test fixture has a seed article linked to another article; the linked
article can contribute a selected chunk only after graph expansion.

R4. Final context must render selected chunks only.

Acceptance: final context contains article id, heading, and chunk body for each
selected chunk, and does not contain complete candidate article bodies by default.

R5. Graph-derived articles must pass chunk relevance before entering context.

Acceptance: a graph-linked article with no relevant chunk is absent from final context.

R6. Jaccard fallback must preserve the same hierarchy.

Acceptance: with embeddings unavailable, retrieval selects seeds by description
Jaccard and final chunks by clean chunk Jaccard inside the candidate pool.

R7. Cross-domain retrieval must use the same final chunk context shape.

Acceptance: cross-domain context rendering uses selected chunks from the merged article
pool and does not call the full-page context renderer.

R8. No user-visible retrieval defaults or settings change in this design.

Acceptance: implementation changes internal caps and metadata only; any new setting or
default change requires a separate user proposal.

## Out Of Scope

- New external vector database.
- New cloud service.
- Additional LLM retrieval pass.
- New user-visible retrieval setting.
- Removing Jaccard fallback.
- Adaptive graph-depth or chunk-cap expansion beyond existing knobs.

## Testing

- Unit: `buildChunkInputs` clean section inputs, summary input preserved.
- Unit: cache version `3` ignores/rebuilds version `2` cache data.
- Unit: chunk selector ranks only candidate-pool sections and preserves heading,
  ordinal, article id, and source metadata.
- Unit: graph candidate with irrelevant chunks is excluded from final context.
- Unit: Jaccard chunk fallback returns chunk context with article id and heading when
  embeddings are missing.
- Integration or eval: single-domain query context contains only selected chunks and
  includes `chunksSelected`.
- Integration or eval: cross-domain query context uses selected chunks from the merged
  article pool.
- Baseline check: focused retrieval fixtures or existing evals confirm expected pages
  and facts do not regress; latency is recorded before and after.

## Implementation Notes

- Prefer a small chunk-selection helper in `page-similarity.ts` or a focused retrieval
  module over embedding chunk ranking directly into `query.ts`.
- Keep `selectContextPages` available only for call sites that still need page context;
  new query flows should use a chunk context renderer.
- Preserve existing graph and fusion functions unless their return type needs
  additional article-score diagnostics.
- Keep cache rebuild behavior deterministic and offline-safe.
