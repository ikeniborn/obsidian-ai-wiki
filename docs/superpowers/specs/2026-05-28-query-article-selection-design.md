# Design: Query Article Selection Pipeline Fix

**Date:** 2026-05-28
**Status:** approved
**Intent:** docs/superpowers/intents/2026-05-28-query-article-selection-intent.md

## Problem

Query phase has two bugs:

1. **Double topK**: In embedding mode, `selectRelevant()` caps seeds at `relevantPagesTopK`, then `runQuery` slices again to `seedTopK`. Seeds end up capped by the smaller of the two — inconsistent and confusing.
2. **Arbitrary context cap**: `buildContextBlock` uses `topK * 3` as `maxPages`, an arbitrary multiplier not connected to any user setting. BFS-selected pages are silently dropped. Sidebar shows `selectedIds.size` (full BFS count) but LLM gets fewer pages — counts diverge.
3. **Jaccard inconsistency**: Jaccard mode in `runQuery` uses inline `selectSeeds` with `seedTopK`, completely bypassing `similarity.selectRelevant` and `relevantPagesTopK`. Embedding and Jaccard follow different topK pipelines.

## Intended Pipeline

```
question → similarity.selectRelevant()   [both embedding and Jaccard modes]
                ↓ ≤ relevantPagesTopK seeds
           bfsExpand(seeds, graph, graphDepth)
                ↓ all selectedIds (naturally bounded)
           buildContextBlock → LLM
                ↓
           graph_stats { expanded: selectedIds.size }   ← sidebar shows this
```

`relevantPagesTopK` is the single seed cap for both modes. `graphDepth` bounds BFS reach. No additional multiplier cap.

## Changes

### `src/phases/query.ts`

**Unify seed selection:** Call `similarity.selectRelevant()` for both embedding and Jaccard modes when `similarity` is provided. Currently, only the embedding branch calls it; the Jaccard branch falls through to inline `selectSeeds` with `seedTopK`.

Before:
```typescript
if (similarity && similarity.config.mode === "embedding") {
  await similarity.loadCache(wikiVaultPath, vaultTools);
  const allAnnotatedPaths = [...indexAnnotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`);
  const selected = await similarity.selectRelevant(question, indexAnnotations, allAnnotatedPaths);
  seeds = selected.map((p) => pageId(p)).slice(0, topK);   // double-slice bug
} else {
  const syntheticPages = new Map<string, string>(...);
  seeds = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
}
```

After:
```typescript
if (similarity) {
  await similarity.loadCache(wikiVaultPath, vaultTools);
  const allAnnotatedPaths = [...indexAnnotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`);
  const selected = await similarity.selectRelevant(question, indexAnnotations, allAnnotatedPaths);
  seeds = selected.map((p) => pageId(p));   // no extra slice — selectRelevant caps at relevantPagesTopK
} else {
  // fallback: no similarity service configured
  const syntheticPages = new Map<string, string>(...);
  seeds = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
}
```

**Remove `maxPages` cap from `buildContextBlock`:**

Before:
```typescript
const contextBlock = buildContextBlock(pages, seedSet, selectedIds, topK * 3);
```

After:
```typescript
const contextBlock = buildContextBlock(pages, seedSet, selectedIds);
```

**Update `buildContextBlock` signature** — remove `maxPages` parameter and `bfsCap` slicing:

Before:
```typescript
function buildContextBlock(
  pages: Map<string, string>,
  seeds: Set<string>,
  selectedIds: Set<string>,
  maxPages: number,
): string {
  ...
  const bfsCap = Math.max(0, maxPages - seedPages.length);
  const ordered = [...seedPages, ...bfsPages.slice(0, bfsCap)];
  ...
}
```

After:
```typescript
function buildContextBlock(
  pages: Map<string, string>,
  seeds: Set<string>,
  selectedIds: Set<string>,
): string {
  ...
  const ordered = [...seedPages, ...bfsPages];
  ...
}
```

### `src/types.ts` — no changes

`graph_stats` event shape is already correct. After the fix, `expanded: selectedIds.size` equals the actual LLM context count, so no new fields needed.

### `src/view.ts` — no changes

Sidebar already displays `ev.expanded`. After fix this matches LLM context exactly.

### `src/page-similarity.ts` — no changes

`selectRelevant` already caps at `this.config.topK` (`relevantPagesTopK`) for both modes.

### `src/agent-runner.ts` — no changes

`buildSimilarity()` already sets `topK: na.relevantPagesTopK ?? 15` for both embedding and Jaccard modes.

## Role of `seedTopK` After Fix

`seedTopK` (global setting, default 5) remains used for:
- `llmSelectSeeds` fallback (when similarity returns 0 seeds) — `topK` still passed as limit
- `seedMinScore` filtering in fallback Jaccard path (no similarity service)

It no longer governs seed selection in the normal path. The de facto seed limit in normal operation is `relevantPagesTopK`.

## Invariants

- Lint and ingest phases: untouched — they already use `PageSimilarityService` correctly
- Embedding cache: not invalidated — `loadCache()` still called before `selectRelevant()`
- `relevantPagesTopK = 0` or undefined: `relevantPagesTopK ?? 15` in `buildSimilarity()` prevents zero seeds; `Math.max(1, ...)` guard in `selectJaccard` and `selectEmbedding` exists via the `topK` field
- Jaccard fallback (API error in embedding mode): handled inside `selectEmbedding` — unchanged

## Health Checks

- Lint per-article loop: no code change, must pass unchanged
- Query via chat: result quality must not degrade (trimmed to relevant context only)
- Embedding cache (`_embeddings.json`): not invalidated on this change
- Jaccard mode: now uses `relevantPagesTopK` via `similarity.selectRelevant` — same pipeline as embedding
- Sidebar article count = LLM context article count ≤ `relevantPagesTopK` seeds + BFS expansion
