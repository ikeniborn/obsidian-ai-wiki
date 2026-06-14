---
review:
  spec_hash: af58d6eb0fa3825e
  last_run: 2026-06-14
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Acceptance (from intent)"
      section_hash: ddf33daf8a83e5b9
      text: "Cost/latency 'reasonable bound' has no measurable threshold — qualitative only (carried from intent)."
      verdict: fixed
      verdict_at: 2026-06-14
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "Stop rules (from intent)"
      section_hash: c5ff1b00e7872c86
      text: "Done-when 'recall beats the baseline' defines no minimum margin and no benchmark-set size / pass criterion for the synthetic retrieval gate."
      verdict: wontfix
      verdict_at: 2026-06-14
    - id: F-003
      phase: clarity
      severity: INFO
      section: "Component 2 — Chunker (splitSections)"
      section_hash: 87e29f60433b0694
      text: "Term 'general description' denotes the annotation/summary chunk; use one consistent term (annotation / summary / general description)."
      verdict: fixed
      verdict_at: 2026-06-14
chain:
  intent: docs/superpowers/intents/2026-06-14-index-search-quality-intent.md
---
# Design: index-search-quality (multi-vector retrieval + section-aware annotations)

**Date:** 2026-06-14
**Status:** draft
**Intent:** [2026-06-14-index-search-quality-intent.md](../intents/2026-06-14-index-search-quality-intent.md)
**Architecture decision (HUMAN CHECKPOINT):** Hybrid — multi-vector embedding over body
sections **plus** an enriched single-line annotation for the offline Jaccard path.
Selected by the user during brainstorming over two rejected alternatives
(multi-vector only; enriched single-vector only).

## Problem

Search misses wiki content that demonstrably exists. The `_index.md` annotation is
the only text used for seed retrieval, and it is embedded as a **single averaged
vector per page** (`EmbeddingCacheFile.entries[pid] = { vector, hash }`,
[`src/page-similarity.ts`](../../../src/page-similarity.ts)). Facts that live in the
page **body** but not in the ~500-char annotation are invisible to retrieval. Low
recall makes the wiki not worth using.

The prior fix (2026-06-06) enriched the annotation into a structured single line
(summary + `Затрагивает` + `Тип` + `Термины`). That lever is largely spent: one
averaged vector dilutes as text grows, so distinct body facts still blur together.

## Acceptance (from intent)

- A query about a fact contained in a page **body** (not just title/summary) returns
  that page in the seed set via similarity convergence.
- Recall on a set of "query → expected page" pairs rises vs the current
  single-vector-over-summary baseline.
- The improvement holds on **both** retrieval paths: embedding mode and offline
  Jaccard fallback.

**Health metrics (must not regress):**
- Ingest dedup quality (`selectByEntities`) — no new duplicate pages.
- Offline Jaccard fallback works with no API key.
- Embedding incrementality — re-embed only changed content via hash, not the whole
  vault per run.
- Precision — higher recall must not flood results with noise.
- Cost/latency may grow for quality within a bounded budget: ≤ `1 + chunkMaxCount`
  vectors per page (default ≤ 13); incremental re-embed touches only changed chunks,
  never the whole vault per run; query seed-selection latency ≤ +15% vs the
  single-vector baseline on the same query set.

## Approach: Hybrid

Two levers, one per retrieval path:

| Path | Lever |
|------|-------|
| Embedding (cosine) | **Multi-vector** — one `summary` vector (the annotation) + one `section` vector per body section. Page score = **max** cosine across the page's vectors. A single matching section surfaces the page. |
| Offline (Jaccard) | **Enriched annotation** — the single `_index.md` line carries keywords from **every** body section, so `scoreSeed` term mass covers body facts without an API. |

Both stores are reused, no sidecar files, single-line `_index.md` invariant held:
- multi-vector lives in the **existing** embeddings cache (`entries[pid]` schema
  extended to hold several vectors);
- the enriched annotation stays **one line** in `_index.md`, read by the unchanged
  `parseIndexAnnotations` regex.

Rejected alternatives (intent HUMAN CHECKPOINT):
- **Multi-vector only** — does not lift the offline Jaccard path (it only sees the
  one-line annotation). Violates "both paths" requirement.
- **Enriched single-vector** — one averaged vector keeps diluting; the enrich lever
  was already pulled in 2026-06-06; low headroom; unlikely to fix "body fact
  invisible" robustly.

## Architecture & data flow

No new components. Annotation content gets richer, the embeddings-cache entry schema
gains multiple vectors, scoring max-pools, and `refreshCache` reads page bodies to
build section vectors. `src/wiki-index.ts` is **unchanged** (still one line/page).

**Affected files:**
- `prompts/ingest.md`, `prompts/lint.md`, `prompts/lint-chat.md` — annotation
  instruction (cover every section + section keywords; still one line).
- `src/page-similarity.ts` — cache schema (multi-vector), `splitSections` chunker,
  `refreshCache` (reads bodies), scoring (max-pool) in `selectEmbedding`,
  `selectEmbeddingScored`, `selectByEntitiesEmbedding`; `loadCache` version guard.
- `src/types.ts` — new optional `nativeAgent.chunk*` settings + defaults.
- `src/settings.ts` — chunking controls under the "Semantic Search" heading.
- `src/agent-runner.ts` — `buildSimilarity` threads `chunking` into `SimilarityConfig`.

**Ingest / lint (build time):**
```
LLM → page.annotation (rich, one line) → upsertIndexAnnotation → _index.md
refreshCache(domainRoot, vaultTools, annotations, pageBodies):
  for each pid whose chunk hashes changed:
    chunks = [ summary(annotation) ] + splitSections(body, chunking)
    embed only changed chunks (per-chunk hash)
    entries[pid] = { chunks: [ { vector, hash, kind }, ... ] }
```

**Query / dedup (read time, vectors already cached):**
```
embedding:  score(page) = MAX over page chunks of cosine(query, chunk)
offline:    scoreSeed(query, enriched one-line annotation)
```

## Component 1 — Cache schema (multi-vector)

Bump `version` to 2 so old caches are detected and rebuilt.

```ts
interface EmbeddingChunk { vector: string; hash: string; kind: "summary" | "section"; }
interface EmbeddingCacheEntry { chunks: EmbeddingChunk[]; }
interface EmbeddingCacheFile {
  version: 2;
  model: string;
  dimensions: number;
  entries: Record<string, EmbeddingCacheEntry>;
}
```
- `kind: "summary"` — vector of the one-line annotation (whole-page signal + parity
  with the Jaccard path).
- `kind: "section"` — one vector per body section window.
- `vector` stays base64 `Float32Array` via the existing `encodeVector`/`decodeVector`.

## Component 2 — Chunker (`splitSections`)

```
splitSections(body, chunking) -> { heading: string, window: string }[]:
  strip frontmatter + the "# H1" title
  units = H2 sections (heading + body); H3+ merged into the parent H2
  merge units shorter than chunking.minChars into a neighbour
  for each unit:
    if len(text) > chunking.maxChars:
      slice into windows of maxChars with chunking.overlapChars overlap
    else:
      one window
  if total windows > chunking.maxCount:
    keep the first (maxCount - 1) windows; concatenate the remaining sections
    into one final window (truncated to maxChars); log how many were folded
    (no silent cap)
```

Per-chunk **embed text** (prepend the page annotation for whole-article grounding):
```
embedText = annotation + "\n\n" + <H2 heading> + "\n" + window
```
Grounding each section vector with the annotation gives short sections whole-article
context and improves matching. The `summary` chunk's embed text is the annotation
alone.

Per-chunk **hash** = `annotationHash(embedText)`. Because `embedText` includes the
annotation, changing the annotation re-embeds all of a page's chunks. In practice the
annotation and body change together in one ingest/lint pass, so this is acceptable;
flagged as a trade-off.

## Component 3 — Settings (chunking controls)

New optional fields on `nativeAgent`, defaulted in `buildSimilarity`, rendered under
the existing "Semantic Search" heading and only when embeddings are enabled
(`s.nativeAgent.embeddingModel !== undefined`). UI strings are hardcoded English to
match the surrounding Semantic Search block (no i18n keys there).

| Field (`nativeAgent`) | UI label | Default |
|-----------------------|----------|---------|
| `chunkMaxChars` | Chunk size (chars) | 1200 |
| `chunkOverlapChars` | Chunk overlap (chars) | 200 |
| `chunkMinChars` | Min chunk size (merge) | 200 |
| `chunkMaxCount` | Max chunks per page | 12 |

```ts
interface ChunkingConfig { maxChars: number; overlapChars: number; minChars: number; maxCount: number; }
interface SimilarityConfig { /* ...existing... */ chunking?: ChunkingConfig; }
```
`buildSimilarity` maps `na.chunk*` → `config.chunking`, applying the defaults above
when fields are absent (old `settings.json` stays valid).

## Component 4 — Scoring (max-pool)

`score(page) = MAX over the page's chunk vectors of cosine(query, chunk)`, applied in
`selectEmbedding`, `selectEmbeddingScored`, and `selectByEntitiesEmbedding`.

- Recall-first: one matching section surfaces the page.
- Precision guards (unchanged knobs): `seedTopK` cap + `seedMinScore` floor in query;
  dedup keeps a small `topK`.
- Fallback lever if precision degrades on the benchmark: blended pool
  `0.7·max + 0.3·mean(top-3)`. Default is plain `max`.
- Jaccard sentinel (`Float32Array` length 0) behaviour for per-page API failure is
  preserved — a page with no usable vectors falls back to `scoreSeed` on its
  annotation.

## Component 5 — Annotation prompts

`prompts/ingest.md`, `prompts/lint.md`, `prompts/lint-chat.md` already emit a
structured one-line annotation. Delta: require coverage of **all** body sections so
the offline path sees section facts.

- `summary` touches the main sections, not just the lead.
- `Термины:` harvests keywords from **every** section (synonyms, IDs, terms absent
  from the title).
- Still one line; soft target ~600–800 chars; no code truncation (the existing
  whitespace-collapse guard in `upsertIndexAnnotation` enforces the single line).
- Identical wording across all three prompts.

## Component 6 — `refreshCache` body access

`refreshCache` gains the page bodies needed to build section vectors. Both call sites
already hold the data:
- `src/phases/ingest.ts:483` — has written pages in memory.
- `src/phases/lint.ts:431` — has the `pages` map.

The chunker reads each body from a caller-supplied `pid → body` map (explicit and
testable; avoids the existing `domainRoot` vs `wikiVaultPath` path-arg inconsistency).
A pid with no body embeds only its `summary` chunk.

## Error handling & backward compatibility

- **Old cache** (`{ vector, hash }`, no `version: 2`) — `loadCache` returns null
  (treated as no cache); query falls back to Jaccard until a re-embed.
  `refreshCache` on version mismatch discards old `entries` and rebuilds. A full
  vault re-embed is the user's manual step (intent autonomy zone).
- **Embedding API failure mid-refresh** — existing per-batch `catch { continue }`
  kept; partially written chunks are valid, the rest are retried next run (per-chunk
  granularity).
- **Empty body / no sections** — only the `summary` chunk. Graceful.
- **`chunkMaxCount` overflow** — log; never a silent cap.
- **Old `settings.json`** without `chunk*` — defaults applied in `buildSimilarity`.

## Testing

Synthetic retrieval test is the primary correctness gate (intent autonomy zone).

| Test | Verifies |
|------|----------|
| `splitSections`: H2 split, H3 merge, strip frontmatter + H1 | base chunking |
| min-merge, overlap windows on a long section, `maxCount` cap + log, empty body | chunking edge cases |
| `chunk.embedText = annotation + heading + window` | prepend (request #2) |
| multi-vector cache round-trip (encode/decode N chunks, schema v2 serialize/parse) | serialization |
| incrementality: unchanged body → 0 re-embeds; one changed section → one chunk re-embedded | health metric |
| max-pool scoring: a page whose only match is a body section outranks the single-vector baseline | **recall (synthetic retrieval test)** |
| backcompat: old `{ vector, hash }` cache → `loadCache` null, no crash | compatibility |
| offline Jaccard: enriched annotation finds a section-keyword query with no API | both paths |
| dedup `selectByEntities` returns the correct existing page, no new false dup | health metric |
| `buildSimilarity` threads `chunking` defaults; UI fields persist | settings |

Prompts are not unit-tested (LLM output); verified via Outcome Verification after
re-ingesting target sources.

## Documentation (lat.md — REQUIRED post-task)

- `lat.md/operations.md#Query` — multi-vector seed selection with max-pool over
  summary + section vectors.
- `lat.md/architecture.md#PageSimilarityService` — chunker + cache schema v2.
- `lat.md/tests.md` — new spec sections with matching `// @lat:` code refs
  (`require-code-mention`).
- Run `lat check` — all wiki links and code refs must pass.

## Stop rules (from intent)

- Halt if the chosen path would break the single-line `_index.md` invariant, touch
  frontmatter, or add an external vector DB.
- Escalate if dedup quality or offline Jaccard regress, or precision degrades
  visibly.
- Done when recall on real "query → expected page" pairs beats the baseline AND
  dedup + offline-Jaccard remain intact, verified by the synthetic retrieval test
  plus a manual check after build.
