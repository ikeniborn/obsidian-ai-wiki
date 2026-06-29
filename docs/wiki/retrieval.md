# Retrieval

## Overview

How AI Wiki selects which wiki pages to feed the LLM as context: page similarity (embedding or Jaccard), BFS expansion over the wiki link graph, optional RRF fusion of the two signals, and a cross-domain mode that fans out over every domain. Used by query, lint, ingest, format, init. See [[operations#Query]].

## PageSimilarityService

Reduces LLM context by pre-selecting top-K relevant wiki pages (`src/page-similarity.ts`). Built by `AgentRunner.buildSimilarity()`. Only active for the native-agent backend. See [[architecture#Backends]].

Public methods: `selectRelevant`, `selectRelevantScored` (scored, for query tracing), `selectRelevantScoredDiag` (returns `{results, denseMax, embedFailed}` for the seed gate), `selectByEntities`.

Two base modes: `jaccard` (default, no API) uses token overlap via `scoreSeed`; `embedding` fetches vectors from an OpenAI-compatible endpoint (no API key required — supports Ollama), falling back to Jaccard on error. A `hybrid` mode fuses the two rankings via Reciprocal Rank Fusion (`src/rrf.ts#rrf`).

## Embedding Cache

Embedding vectors are cached per domain at `_config/_embeddings.json` as schema v2 and invalidated by annotation content hash. `loadCache()` reads the cache into memory before selection so ingest/query/lint don't re-fetch every run.

Because the cache embeds the `_index.md` annotation (the `summary` chunk), a page absent from the index gets no vector and is invisible to every retrieval path. Ingest and lint therefore guarantee coverage: every page is indexed — with a deterministic `deriveFallbackAnnotation` when the LLM emits none — and `reconcileIndex` keeps `_index.md` in sync with disk both ways. See [[operations#Link & Index Hygiene]].

Each page entry holds a `chunks` array: one `summary` vector (the one-line annotation) plus one `section` vector per body section window. `splitSections` builds the windows (strip frontmatter + H1, fold H3+ into H2 units, merge short, window long with overlap, cap at `chunkMaxCount`). `buildChunkInputs` prepends the annotation and H2 heading to each window and hashes the embed text per chunk. Page score is the **max** cosine across the page's chunk vectors, so one matching body section surfaces the page.

`refreshCache` reuses cached vectors whose hash matches and embeds only new chunks (one changed section re-embeds one vector); it returns `{ updated }` = newly embedded chunk count, and persists for hybrid too. When `embeddingDimensions` is set, it is sent as the `dimensions` field on every `/embeddings` request (OpenAI Matryoshka truncation); `probeEmbeddingDimensions` detects the model's native vector length. `encodeVector`/`decodeVector` serialize Float32Array to base64 via `btoa`/`atob` — must not use `Buffer` (unavailable on Obsidian mobile).

## Dedup helpers

Beyond selection, the service powers ingest and lint deduplication. `maxSimilarityToExisting()` scores a candidate text against all cached pages for the ingest dedup gate; `pairwiseNearDuplicates()` compares all page pairs for the lint near-duplicate report. See [[operations#Tier 1 Features]].

## Wiki Graph

The wiki graph represents `[[WikiLink]]` connections between pages (`src/wiki-graph.ts`). An adjacency map `Map<pageId, Set<pageId>>` built by scanning `[[...]]` patterns in page content. Page IDs are bare file stems. Used for BFS context expansion in query and structural health checks in lint.

## Query Graph Traversal

BFS from seed pages up to `graphDepth` hops. The graph is treated as **undirected**: `A → [[B]]` allows traversal B→A — backlinks are symmetric in the user's mental model.

`bfsExpand` returns all reachable IDs; `bfsExpandRanked` wraps it with similarity/Jaccard ranking and a `bfsTopK` cap (default 10) — only the top-K non-seed BFS pages reach the LLM, seeds always included. Forward traversal guards against phantom nodes: `[[links]]` with no corresponding page are never added. Files under any `_config/` subdirectory are excluded. On similarity failure, falls back to full BFS.

## Graph Cache

`GraphCache` caches the built graph per domain ID keyed by a content hash (`src/wiki-graph-cache.ts`), avoiding rebuilds when pages haven't changed. Invalidated on any wiki-mutating operation (ingest, lint, lint-chat, init).

## Structural Health Check

`checkGraphStructure` reports isolated nodes (no in/out links) and non-reciprocated links; results appear in the lint report. Hub-node detection was removed — use `bfsTopK` to control context size instead.

## Fusion

Opt-in query refinement (`nativeAgent.bfsFusion`, default off) ordering the final context by an RRF fusion of the vector and graph signals over the `seeds ∪ BFS-expanded` union, instead of seeds-first concat (`src/fusion.ts#fuseVectorGraph`).

The vector list ranks the union by similarity descending; the graph list ranks by hop distance ascending (seed = hop 0), tie-broken by backlink `inDegree`. Both reuse the `rrfK` setting. See [[operations#Tier 2 Features]].

A separate gate `nativeAgent.seedSimilarityThreshold` (default 0 = off) compares the threshold against the **dense cosine confidence** (`denseMax`, the max raw cosine), not the RRF-fused score — fixing a bug where the fused score (max ≈ 2/(k+1) ≈ 0.033) never cleared a cosine-scaled threshold, so vector/hybrid seeds were always wrongly dropped to Jaccard. It applies in both embedding and hybrid modes via [[retrieval#PageSimilarityService]]'s `selectRelevantScoredDiag` (returns `denseMax`/`embedFailed`), and falls back through Jaccard → `llmSelectSeeds`. The branch is recorded in `graph_stats` as `retrievalMode`/`denseMax`/`seedFallbackReason`, plus a progress retrieval tag (`vector` / `jaccard (low …)` / `jaccard (embed failed)` / `llm seeds`) via `src/retrieval-diag.ts#retrievalTag`.

## Cross-Domain Query

Ask Wiki searches every domain at once by routing the `"*"` domain sentinel from `src/agent-runner.ts` into `runCrossDomainQuery` (`src/phases/query-cross-domain.ts`). The sidebar exposes this as an explicit **Ask Wiki** button behind a confirmation modal; **Ask Domain** routes directly to the selected concrete domain. Two stages cover all domains while keeping the LLM context bounded. See [[operations#Query]].

The retrieval half of single-domain `runQuery` is extracted into `retrieveDomainCandidates` (`src/phases/query.ts`): read index → seed-select (vector gate → Jaccard → optional `llmSelectSeeds`) → glob → `bfsExpandRanked`, returning a `DomainCandidates` set (seeds ∪ `bfsTopK` expansion) without an LLM call. Each candidate set also records `pagesScanned` as the total domain page count. Both single-domain `runQuery` and the cross-domain orchestrator consume it; the shared answer half (stream + WikiLink validation) is `answerFromContext` (`src/phases/query-answer.ts`).

**Stage 1** runs `retrieveDomainCandidates` over every domain sequentially — one domain's pages held in memory at a time, non-candidate content freed. An empty domain returns `null` and is skipped; if all domains are empty the run errors. The orchestrator omits the `llmSeedFallback` argument, so a weak domain is skipped rather than costing one LLM call each.

**Stage 2** `mergeCandidates` unions the per-domain pools — wiki stems are globally unique (`wiki_<domain>_<slug>`, see [[domain-model#Wiki Stem Mask]]), so graphs and score maps merge collision-free — then RRF-fuses vector + graph over the union via [[retrieval#Fusion]]'s `fuseVectorGraph`, capping to the top-`seedTopK` `finalIds`. No new pages enter stage 2; it only re-ranks the stage-1 pool. `seedTopK` drives both stages (top-N per domain and top-N final), and the final context is exactly `seedTopK` pages, not the single-domain `topK*3`.

Before the answer LLM call, both query paths emit `query_stats`: Ask Domain reports the selected domain, pages scanned, and pages selected; Ask Wiki reports domains studied vs configured, contributing domain names, summed pages scanned across candidate domains, and `finalIds.length` as pages selected. The sidebar renders this block above the answer and fills its token count from `llm_call_stats`.

One `answerFromContext` call then answers over `finalIds`. The cross-domain prompt sets `domain_name` to "All domains (N)", lists `finalIds` as the only valid WikiLink targets, unions the `entity_types` and `language_notes` of the contributing domains, and builds the index block from the `finalIds` annotations only. `eval_meta.retrievalConfig` carries `crossDomain: true` and `domainsSearched`. Verified out-of-vault by `eval/cross-domain/run.ts`, including `query_stats` emission and abort-after-stats behavior.
