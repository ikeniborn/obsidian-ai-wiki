---
review:
  spec_hash: eecc1c3aac4afa38
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-11-lexical-retrieval-quality-intent.md
---
# Lexical Retrieval Quality — Design

Date: 2026-07-11
Status: approved
Intent: `docs/superpowers/intents/2026-07-11-lexical-retrieval-quality-intent.md`

## Acceptance (from intent)

### Desired Outcomes

- HLD eval average `Overlap@5` is at least `0.65`.
- `ownership-components` improves above the current `Overlap@5 = 0.20`.
- No HLD eval query drops below its current `Overlap@5` value:
  - `data-export-s3-clickhouse`: `0.40`
  - `airflow-ha-balancing`: `1.00`
  - `integrations-consumers-marts`: `0.40`
  - `migration-gitflame`: `0.60`
  - `ownership-components`: `0.20`
- All five HLD eval queries remain `accepted`.
- Runtime Query in `jaccard` mode uses the improved lexical scorer for seed/page
  ranking and chunk ranking.
- Lexical fallback remains fully offline and does not require embeddings, LLMs, or
  network access.

### Health Metrics

- HLD eval query latency does not grow by more than 25% from the current range of
  roughly 42-55 ms/query.
- All five HLD eval queries remain `accepted`.
- No per-query `Overlap@5` regression from the current values.
- Offline/Jaccard fallback does not require embeddings, LLMs, network access,
  OpenAI, or Ollama.
- Existing focused tests, lint, and build pass.
- Embedding/hybrid retrieval paths do not regress: the lexical scorer may affect
  fallback and sparse-side ranking, but not dense vector computation.

## Decisions

1. **Use one shared pure scorer for eval and runtime.** The scorer lives outside
   Obsidian-bound modules so `node --import tsx --test` and CLI eval can use it
   directly.
2. **Fuse page and chunk evidence.** Page-level ranking uses title/path,
   description, frontmatter keywords, and body lead. Chunk ranking uses title/path,
   heading, and chunk body. Final page order can be built from page rank and chunk
   rank through existing RRF.
3. **Keep runtime generic.** Runtime Query does not receive HLD-specific synonym
   expansion. Fixed HLD query expansion stays inside the eval harness only, because
   domain-specific synonyms should not leak into general plugin behavior.
4. **Do not change storage or vector contracts.** `index.jsonl` records, vectors,
   embedding cache behavior, settings, and retrieval modes stay compatible.
5. **Make the eval comparison explicit.** The HLD report records old lexical
   baseline metrics and improved lexical metrics so a quality gain is visible.

## Architecture

Create `src/lexical-retrieval.ts` as an Obsidian-free pure module. It exports:

- `tokenizeLexical(text)` or reuse-compatible token helpers that preserve current
  tokenization behavior while allowing extra scoring features.
- `scoreLexicalPage(query, input)` returning a numeric score and optional evidence.
- `scoreLexicalChunk(query, input)` returning a numeric score and optional evidence.
- `rankLexicalPages(query, pages, limit)`.
- `rankLexicalChunks(query, chunks, limit)`.
- `fuseLexicalRanks(pageRank, chunkRank, limit, rrfK)` using existing RRF semantics
  or a small pure wrapper around `rrf`.

The scorer is weighted but transparent:

- Path/title match has the highest lexical boost because HLD filenames often carry
  the strongest domain signal.
- Heading match boosts chunks because HLD sections such as `## Сводка решения` or
  `## Архитектура` are strong context boundaries.
- Description/body overlap stays as the main broad-recall signal.
- Exact token hits and phrase-adjacent hits receive limited bonuses.
- Long chunks are length-normalized to avoid generic template sections dominating.

Weights are implementation details within the approved full-autonomy zone, but tests
must prove that title/path and heading matches can outrank generic body-only matches.

## Runtime Data Flow

### Seed/Page Ranking

Current runtime page ranking uses `scoreSeed` over page id, frontmatter keywords,
body lead, and annotation. Replace the internals with `scoreLexicalPage` while
preserving the public `scoreSeed` and `selectSeeds` API where practical. This keeps
callers stable and lets existing query code improve without broad refactors.

### Chunk Ranking

Current chunk ranking uses plain Jaccard over `section.embedText`. Replace
`rankChunksJaccard` internals with `scoreLexicalChunk`, passing page path, heading,
chunk body, source type, and article score. Sorting still keeps deterministic
tie-breakers.

### Hybrid/Fallback Behavior

Embedding mode and dense vector computation do not change. When embeddings are
unavailable or fail, existing fallback paths use the improved lexical scorer. Hybrid
mode's sparse side also benefits where it currently calls Jaccard scoring. This is
allowed because only sparse/fallback ordering changes.

## Eval Harness Data Flow

The HLD harness keeps the current isolated eval domain build. Query expansion remains
local to fixed HLD queries. For each query it records:

- current baseline order using the previous lexical behavior;
- improved page order;
- improved chunk order;
- fused JSONL retrieval top results;
- `Overlap@5` for old and improved runs;
- per-query delta and aggregate average.

The final verdict is `accepted` only when:

- average improved `Overlap@5 >= 0.65`;
- all improved query statuses are `accepted`;
- no improved per-query `Overlap@5` is below the current accepted baseline values;
- the eval domain is still built from JSONL and the source HLD vault is not mutated.

## Error Handling

- Empty query tokens return empty rankings without throwing.
- Empty or malformed descriptions behave as missing lexical evidence, not failures.
- Chunk records with absent body data are skipped in eval and ignored in runtime
  chunk ranking.
- The scorer never performs network calls and never reads files itself.
- If the eval source path is missing, the eval command fails clearly before creating
  partial output.

## Testing

Add focused tests for:

- title/path boost outranks generic body-only overlap;
- heading boost improves chunk ranking;
- length normalization prevents large template chunks from dominating;
- RRF fusion promotes a page that is strong in both page and chunk ranks;
- `## Related` and `## External links` remain excluded through existing chunk split
  behavior;
- HLD eval report includes old vs improved metrics and meets
  `avg Overlap@5 >= 0.65`.

Run verification:

- focused node tests for lexical retrieval, eval harness, JSONL storage, query/index,
  and page similarity;
- `npm run lint`;
- `npm run build`;
- HLD eval CLI against the Rostelecom HLD source;
- `wiki_lint(domain=obsidian-ai-wiki)` after docs/wiki updates.

## Documentation

Update repository docs and iwiki retrieval documentation to state that lexical
retrieval is no longer plain Jaccard. It is deterministic weighted lexical scoring
with page/chunk fusion, still fully offline and still a fallback/sparse-side path for
embedding/hybrid modes.

## Out of Scope

- Changing default retrieval mode, settings UI, or model settings.
- Changing dense embedding computation or vector storage.
- Changing `index.jsonl` schema.
- Adding domain-specific runtime synonym expansion.
- Changing ingest dedup or near-duplicate detection.
