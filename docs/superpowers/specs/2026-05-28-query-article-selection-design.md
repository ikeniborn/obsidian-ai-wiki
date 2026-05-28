# Design: Query Article Selection Pipeline Fix

**Date:** 2026-05-28
**Status:** approved
**Intent:** docs/superpowers/intents/2026-05-28-query-article-selection-intent.md

## Problem

Three phases (query, lint, ingest) use `PageSimilarityService` for article selection.
Ingest is already correct. Query and lint have bugs:

**Query (`src/phases/query.ts`):**

1. Double topK — embedding mode: `selectRelevant()` caps seeds at `relevantPagesTopK`, then `runQuery` slices again to `seedTopK`. Seeds end up capped by the smaller of the two.
2. Jaccard inconsistency — Jaccard mode bypasses `similarity.selectRelevant`, uses inline `selectSeeds` with `seedTopK`. Embedding and Jaccard follow different topK pipelines.
3. Arbitrary context cap — `buildContextBlock` uses `topK * 3` as `maxPages`. BFS-selected pages silently dropped. Sidebar shows `selectedIds.size` (full BFS count) but LLM gets fewer pages — counts diverge.

**Lint (`src/phases/lint.ts`):**

4. `graphDepth` hardcoded — BFS call uses `bfsExpand(seeds, graph, 1)` instead of the `graphDepth` setting. `runLint` signature doesn't accept `graphDepth` at all.

**Ingest (`src/phases/ingest.ts`):** already correct — no changes needed.

## Intended Pipeline (all phases)

```text
content/question
  → similarity.selectRelevant()   [both embedding and Jaccard, both phases]
      ↓ ≤ relevantPagesTopK seeds
  → bfsExpand(seeds, graph, graphDepth)
      ↓ all selectedIds (naturally bounded)
  → LLM context
```

`relevantPagesTopK` is the single seed cap for both modes. `graphDepth` bounds BFS reach. No additional multiplier cap.

## Changes

### `src/phases/query.ts`

**Unify seed selection** — call `similarity.selectRelevant()` for both embedding and Jaccard when `similarity` is provided. Remove extra `.slice(0, topK)` (double-slice bug).

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

**Remove `maxPages` cap** from `buildContextBlock` call:

Before: `buildContextBlock(pages, seedSet, selectedIds, topK * 3)`

After: `buildContextBlock(pages, seedSet, selectedIds)`

**Update `buildContextBlock` signature** — remove `maxPages` parameter and `bfsCap` slicing. Return all pages from `selectedIds`.

### `src/phases/lint.ts`

**Add `graphDepth` parameter** to `runLint` signature (default `1` to preserve current behavior):

```typescript
export async function* runLint(
  // ... existing params ...
  similarity?: PageSimilarityService,
  graphDepth: number = 1,   // add this
): AsyncGenerator<RunEvent>
```

**Use `graphDepth` in BFS** — replace hardcoded `1`:

Before: `const expanded = bfsExpand(seeds, graph, 1);`

After: `const expanded = bfsExpand(seeds, graph, graphDepth);`

### `src/agent-runner.ts`

**Pass `graphDepth` to `runLint`**:

Before: `yield* runLint(req.args, ..., opts, similarity);`

After: `yield* runLint(req.args, ..., opts, similarity, this.settings.graphDepth);`

### `src/types.ts` — no changes

`graph_stats` event shape is already correct. After the fix, `expanded: selectedIds.size` equals the actual LLM context count.

### `src/view.ts` — no changes

Sidebar already displays `ev.expanded`. After fix this matches LLM context exactly.

### `src/page-similarity.ts` — no changes

`selectRelevant` already caps at `this.config.topK` (`relevantPagesTopK`) for both modes.

### `src/phases/ingest.ts` — no changes

Already uses `similarity.selectRelevant()` for both modes with `graphDepth` parameter.

## Role of `seedTopK` After Fix

`seedTopK` (global setting, default 5) remains used for:

- `llmSelectSeeds` fallback — when similarity returns 0 seeds
- Fallback Jaccard path — when no similarity service is configured at all

It no longer governs seed selection in the normal path. The effective seed limit in normal operation is `relevantPagesTopK`.

## Invariants

- Embedding cache: not invalidated — `loadCache()` still called before `selectRelevant()`
- `relevantPagesTopK` undefined: `buildSimilarity()` defaults to `15`
- Jaccard fallback (API error in embedding mode): handled inside `selectEmbedding` — unchanged
- Lint default `graphDepth = 1`: preserves current behavior unless caller passes a different value

## Health Checks

- Lint per-article loop: BFS now uses `graphDepth` from settings (default 1 = unchanged)
- Query via chat: result quality must not degrade (more relevant, trimmed context)
- Embedding cache (`_embeddings.json`): not invalidated on this change
- Jaccard mode in query: now uses `relevantPagesTopK` via `similarity.selectRelevant` — same pipeline as embedding
- Sidebar article count = LLM context article count ≤ `relevantPagesTopK` seeds + BFS expansion
