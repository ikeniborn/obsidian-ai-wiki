---
review:
  spec_hash: a140eede451e93a0
  last_run: "2026-05-25"
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: Architecture/New module
      section_hash: d42c93eb94eeb522
      text: "pageId→path mapping implicit in selectRelevant — clarified in Jaccard mode bullet points"
      verdict: fixed
      verdict_at: "2026-05-25"
    - id: F-002
      phase: clarity
      severity: WARNING
      section: Architecture/Embedding mode
      section_hash: d42c93eb94eeb522
      text: "no batch size limit for embedding API — fixed: chunked at 100 entries per request with Jaccard fallback on failure"
      verdict: fixed
      verdict_at: "2026-05-25"
  section_hashes:
    Problem: 0ca3714d61f2805a
    Solution: 5cb0a2eb63b3c73a
    Architecture: d42c93eb94eeb522
    Configuration: 8888a53a77a638ae
    Files Changed: 70dbb43ef72b6f62
    Performance Impact: 33f53921e6d4775b
    Out of Scope: 18cfc70d6ad5260f
---

# Design: Relevant Pages Selection for Ingest

**Date:** 2026-05-25  
**Status:** approved  
**Topic:** Eliminate O(N²) context growth during init by loading only semantically relevant wiki pages per ingest call.

---

## Problem

During `runInitWithSources`, each `runIngest` call loads **all** existing wiki pages into the LLM prompt (`ingest.ts:81–82`). As the wiki grows during the init run, later files receive increasingly large prompts — O(N²) total data sent to the LLM. For 20+ sources with many files this causes multi-hour initialization times.

Two root causes:
1. `existingPages = readAll(allPaths)` — no relevance filter
2. `_index.md` re-read from disk on every ingest call inside init loop

---

## Solution

Replace `readAll(allPaths)` with `readAll(topK relevant paths)` using a `PageSimilarityService` that scores source content against `_index.md` annotations. Default mode: Jaccard token similarity (already used in Query phase). Optional mode: embedding vectors via the native backend's OpenAI-compatible API.

During init, annotations are cached in memory and updated incrementally — `_index.md` is read once, not on every file.

After Lint and Format operations, the embedding cache is refreshed for changed pages.

---

## Architecture

### New module: `src/page-similarity.ts`

```ts
export interface SimilarityConfig {
  mode: "jaccard" | "embedding";
  model?: string;        // embedding model name (embedding mode only)
  dimensions?: number;   // vector dimensions (embedding mode only)
  topK: number;          // how many pages to select (default: 15)
  baseUrl?: string;      // from nativeAgent (embedding mode only)
  apiKey?: string;       // from nativeAgent (embedding mode only)
}

export class PageSimilarityService {
  constructor(config: SimilarityConfig) {}

  async selectRelevant(
    sourceContent: string,
    indexAnnotations: Map<string, string>,  // pageId → annotation
    allPaths: string[],
  ): Promise<string[]>  // top-K vault paths

  async refreshCache(
    domainRoot: string,
    vaultTools: VaultTools,
    indexAnnotations: Map<string, string>,
  ): Promise<void>  // no-op in Jaccard mode
}
```

**Jaccard mode** (default, no config required):
- `tokenize(sourceContent)` → query tokens (reuses `wiki-seeds.ts`)
- For each path in `allPaths`: compute `pid = pageId(path)`, look up annotation in `indexAnnotations`, call `scoreSeed(queryTokens, pid, "", annotation)`
- Sort descending → slice `topK` → return the matching vault paths (not pageIds)
- Pages not present in `indexAnnotations` (no annotation yet) score 0 and are excluded unless topK is not reached

**Embedding mode** (opt-in via settings):
1. `POST baseUrl/embeddings` with `sourceContent` truncated to first 2000 chars → query vector
2. `POST baseUrl/embeddings` batch for page annotations, chunked at **100 entries per request** → page vectors (multiple requests if needed)
3. Cosine similarity → sort → top-K paths

Batch size of 100 stays within limits of common embedding APIs (OpenAI, Ollama). If a batch request fails, the affected pages fall back to Jaccard scoring for that call.

### Embedding cache: `!Wiki/<domain>/_config/_embeddings.json`

```jsonc
{
  "model": "text-embedding-3-small",
  "dimensions": 512,
  "entries": {
    "PageTitle": { "vector": "<base64 Float32Array>", "hash": "<annotation hash>" }
  }
}
```

- **Key**: `pageId` (unique per domain)
- **Hash**: short hash of the annotation string from `_index.md`
- **Invalidation**: entries whose hash doesn't match current annotation are re-embedded on next use
- **Full reset**: when `model` or `dimensions` changes (header mismatch → discard all)
- **Encoding**: Base64-encoded `Float32Array` (4× compact vs JSON number arrays, works with text-only VaultTools)
- **Path constant**: added to `wiki-path.ts` as `domainEmbeddingsPath(domainFolder)`

### Changes to `ingest.ts`

Two new optional parameters (backwards compatible):

```ts
export async function* runIngest(
  // ... existing params ...
  similarity?: PageSimilarityService,
  cachedAnnotations?: Map<string, string>,
): AsyncGenerator<RunEvent>
```

Replace lines 81–82:

```ts
// Before:
const existingPages = await vaultTools.readAll(existingPaths.filter(...));

// After:
const filteredPaths = similarity
  ? await similarity.selectRelevant(sourceContent, cachedAnnotations ?? indexAnnotations, existingPaths)
  : existingPaths.filter(f => !f.endsWith("_index.md"));
const existingPages = await vaultTools.readAll(filteredPaths);
```

When `similarity` is not provided, behaviour is unchanged (standalone ingest).

### Changes to `init.ts`

In `runInitWithSources`:
1. Read `_index.md` once at the start → `annotationsCache: Map<string, string>`
2. Pass `similarity` and `annotationsCache` to each `runIngest` call
3. After each file completes, re-read `_index.md` once to update `annotationsCache` (not on every event)

```ts
let annotationsCache = parseIndexAnnotations(indexContent ?? "");

for (let i = 0; i < toAnalyze.length; i++) {
  // ...
  for await (const ev of runIngest([file], ..., similarity, annotationsCache)) {
    yield ev;
  }
  // refresh cache after each file
  const fresh = await tryRead(vaultTools, domainIndexPath(wikiRootGuess));
  annotationsCache = parseIndexAnnotations(fresh);
}
```

### Changes to `lint.ts` and `format.ts`

After the phase completes, call `refreshCache` if similarity service is available:

```ts
if (similarity) {
  const annotations = parseIndexAnnotations(await tryRead(vaultTools, domainIndexPath(domainRoot)));
  await similarity.refreshCache(domainRoot, vaultTools, annotations);
}
```

`refreshCache` is a no-op in Jaccard mode — no overhead.

### Changes to `controller.ts`

Build `PageSimilarityService` once per operation run and pass it through:

```ts
const similarity = new PageSimilarityService({
  mode: localConfig.nativeAgent?.embeddingModel ? "embedding" : "jaccard",
  model: localConfig.nativeAgent?.embeddingModel,
  dimensions: localConfig.nativeAgent?.embeddingDimensions,
  topK: localConfig.nativeAgent?.relevantPagesTopK ?? 15,
  baseUrl: localConfig.nativeAgent?.baseUrl,
  apiKey: localConfig.nativeAgent?.apiKey,
});
```

Available only for `native-agent` backend. Claude Agent backend: Jaccard only (no `baseUrl`).

---

## Configuration

### `LocalConfig.nativeAgent` — new fields

```ts
nativeAgent?: {
  // existing:
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  topP: number | null;
  // new:
  embeddingModel?: string;       // empty = Jaccard mode
  embeddingDimensions?: number;  // required when embeddingModel is set
  relevantPagesTopK?: number;    // default: 15, applies to both modes
};
```

### Settings UI (native backend section)

```
[ Relevant pages (top-K) ]     ← always visible, number input, default 15

[ ] Enable semantic similarity (embeddings)
    └─ if checked:
       [ Embedding model    ]   ← text input, e.g. text-embedding-3-small
       [ Dimensions         ]   ← number input, e.g. 512
```

Embedding settings visible only when `backend === "native-agent"`.

---

## Files Changed

| File | Change |
|---|---|
| `src/page-similarity.ts` | **new** — `PageSimilarityService` |
| `src/wiki-path.ts` | add `domainEmbeddingsPath()` |
| `src/local-config.ts` | 3 new fields in `nativeAgent` |
| `src/phases/ingest.ts` | 2 optional params + relevance filter |
| `src/phases/init.ts` | annotations cache + pass similarity to runIngest |
| `src/phases/lint.ts` | call `refreshCache` after completion |
| `src/phases/format.ts` | call `refreshCache` after completion |
| `src/controller.ts` | construct and pass `PageSimilarityService` |
| UI settings component | 3 new fields under native backend |
| `docs/prompt-architecture.md` | document similarity service and embedding cache |

---

## Performance Impact

| Scenario | Before | After |
|---|---|---|
| Init, 200 files, 50 wiki pages avg | O(N²) context ≈ 2–4 hours | O(K×N), K=15 ≈ minutes |
| Standalone ingest (no similarity) | unchanged | unchanged |
| Lint/Format with embedding enabled | — | `refreshCache` batch call once |
| Jaccard mode overhead per file | — | ~1ms tokenization |

---

## Out of Scope

- Caching embedding vectors for source files (only wiki page vectors are cached)
- Vector cache persistence across model changes (handled by header invalidation)
- Parallel ingest during init (separate optimization, not in this spec)
- Binary VaultTools for more compact vector storage
