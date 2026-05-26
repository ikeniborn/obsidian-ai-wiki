# Design: Lint vector read/write progress events

**Date:** 2026-05-26
**Status:** approved
**Intent:** [2026-05-26-lint-vector-progress-intent.md](../intents/2026-05-26-lint-vector-progress-intent.md)

## Problem

Lint calls `similarity.refreshCache` at the end of each domain pass but emits no progress events for vector operations. User has no visibility into whether vectors were read or written during lint. Additionally, lint does not call `loadCache` before `refreshCache`, unlike ingest.

## Approach

**Option A — `refreshCache` returns a counter.**

`PageSimilarityService.refreshCache` changes return type from `Promise<void>` to `Promise<{ updated: number }>`. The count equals `toEmbed.length` (number of stale entries that were re-embedded). Zero means all entries were fresh — cache not written.

Lint explicitly calls `loadCache` before `refreshCache` (parity with ingest) and wraps both calls in conditional `info_text` events gated on `similarity.config.mode === "embedding"`.

Ingest is unaffected — its existing call site ignores the return value.

## Architecture

### `src/page-similarity.ts` — `refreshCache`

Change return type:
```ts
async refreshCache(
  domainRoot: string,
  vaultTools: VaultTools,
  indexAnnotations: Map<string, string>,
): Promise<{ updated: number }>
```

Early-return path: `return { updated: 0 }` (when `toEmbed.length === 0`).  
Write path: after `vaultTools.write(...)`, `return { updated: toEmbed.length }`.

### `src/phases/lint.ts` — vector block

Replace the existing `if (similarity)` block at the end of the domain loop with:

```ts
if (similarity) {
  const indexRaw = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
  const annotations = parseIndexAnnotations(indexRaw);

  if (similarity.config.mode === "embedding") {
    yield { kind: "info_text", icon: "📥", summary: "загрузка кэша векторов..." };
    await similarity.loadCache(wikiVaultPath, vaultTools);
  }

  const { updated } = await similarity.refreshCache(wikiVaultPath, vaultTools, annotations);

  if (similarity.config.mode === "embedding" && updated > 0) {
    yield { kind: "info_text", icon: "📤", summary: `обновлено векторов: ${updated}` };
  }
}
```

## Data flow

```
lint domain pass
  └─ similarity present?
       ├─ embedding mode → info_text "📥 загрузка кэша векторов..."
       │                → loadCache (reads _embeddings.json into this.cache)
       ├─ any mode      → refreshCache → { updated: N }
       └─ embedding mode, N > 0 → info_text "📤 обновлено векторов: N"
```

## Constraints

- Events suppressed in jaccard mode and when similarity is undefined
- No new summary line in lint result text — only progress events
- `PageSimilarityService` does not import `RunEvent` — caller emits events

## Files changed

| File | Change |
|------|--------|
| `src/page-similarity.ts` | `refreshCache` return type `void` → `{ updated: number }` |
| `src/phases/lint.ts` | Add `loadCache` + two conditional `info_text` events |

## Testing

- Embedding mode active: progress shows "📥 загрузка кэша векторов..." + "📤 обновлено векторов: N" when stale entries exist
- Embedding mode active, cache fresh: only "📥" event, no "📤" event
- Jaccard mode: no vector events emitted
- Ingest unchanged: existing `refreshCache` call site compiles and runs correctly (ignores return value)
