# Design: Fix init/reinit allFailed false-positive on empty wiki

**Date:** 2026-05-31
**Status:** approved
**Intent:** [2026-05-31-init-reinit-allfailed-intent.md](../intents/2026-05-31-init-reinit-allfailed-intent.md)

## Problem

`allFailed` in `PageSimilarityService.selectByEntities` is `true` when `indexAnnotations.size === 0`. During `init`/`reinit --force`, the wiki folder is empty — no pages, no annotations — so `allFailed` fires as a false positive. `runIngest` treats this as a real retrieval failure and halts with an error before writing any pages.

Root cause: `anySuccess = indexAnnotations.size > 0` conflates "no pages exist" with "retrieval broke".

## Changes

### 1. `src/page-similarity.ts` — fix allFailed semantics

Two methods return `{ results, allFailed: !anySuccess }`. Change both to:

```typescript
return { results, allFailed: allPaths.length > 0 && !anySuccess };
```

**`jaccardFallbackAll` (line ~158)** and **`selectByEntitiesEmbedding` (line ~237)**.

New semantics: `allFailed = true` only when pages exist (`allPaths.length > 0`) but none could be retrieved. Empty wiki (`allPaths = []`) → `allFailed = false`.

### 2. `src/phases/ingest.ts` — defence-in-depth guard

Line ~151, add `nonMetaPaths.length > 0`:

```typescript
if (allFailed && entitiesResult.value.entities.length > 0 && nonMetaPaths.length > 0) {
```

Makes the halt condition explicit: "retrieval failed AND there were pages to retrieve from".

## Test Updates

### `tests/page-similarity.test.ts`

Test at line 204: `"allFailed=true when annotations map is empty (no candidates at all)"`.

Update: rename to `"allFailed=false when no pages exist (empty wiki)"`, change expectation to `expect(allFailed).toBe(false)`. The `allPaths=[]` scenario is no longer a failure.

### `tests/phases/ingest.test.ts`

Test at line 936: `"halts when similarity.selectByEntities reports allFailed with non-empty entities"`.

Update `list` mock to return a non-meta wiki file for the wiki path so `nonMetaPaths.length > 0` — otherwise the new ingest guard skips the halt:

```typescript
list: vi.fn().mockImplementation((path: string) =>
  path.includes("!Wiki/work")
    ? Promise.resolve({ files: ["!Wiki/work/entities/Foo.md"], folders: [] })
    : Promise.resolve({ files: [], folders: [] })
),
```

## Invariants

- `allFailed` as a real error (non-empty wiki, API down) must continue to halt ingest
- `entity_types_delta` merge path in `ingest.ts` is untouched
- No changes to `init.ts`, `AgentRunner`, or controller
