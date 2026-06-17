# Retrieval

How AI Wiki selects which wiki pages to feed the LLM as context. Combines page similarity (embedding or Jaccard) with BFS expansion over the wiki link graph. Used by query, lint, ingest, format, init. See [[operations#Query]].

## PageSimilarityService

Reduces LLM context by pre-selecting top-K relevant wiki pages (`src/page-similarity.ts`). Built by `AgentRunner.buildSimilarity()`. Public methods: `selectRelevant`, `selectRelevantScored` (scored, for query tracing), `selectByEntities`. Only active for the native-agent backend. See [[architecture#Backends]].

Two base modes: `jaccard` (default, no API) uses token overlap via `scoreSeed`; `embedding` fetches vectors from an OpenAI-compatible endpoint (no API key required — supports Ollama), falling back to Jaccard on error. A `hybrid` mode fuses the two rankings via Reciprocal Rank Fusion (`src/rrf.ts#rrf`).

## Embedding Cache

Embedding vectors are cached per domain at `_config/_embeddings.json` as schema v2 and invalidated by annotation content hash. `loadCache()` reads the cache into memory before selection so ingest/query/lint don't re-fetch every run.

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

The vector list ranks the union by similarity descending; the graph list ranks by hop distance ascending (seed = hop 0), tie-broken by backlink `inDegree`. A separate gate `nativeAgent.seedSimilarityThreshold` (default 0 = off) drops weak embedding seeds and falls back through Jaccard → `llmSelectSeeds`; the branch is recorded in `graph_stats.seedFallback`. Both reuse the `rrfK` setting. See [[operations#Tier 2 Features]].
