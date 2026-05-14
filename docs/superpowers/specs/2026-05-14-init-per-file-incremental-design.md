# Design: Per-file incremental domain analysis in init --sources

**Date:** 2026-05-14  
**Branch:** dev  
**Status:** approved

## Problem

`runInitWithSources` Phase 1 currently samples 10 files and sends them in a single LLM call to derive `entity_types`. With large source sets (100+ files), this produces poor domain schema — 90%+ of files are ignored.

## Solution

Split `runInitWithSources` into two sequential phases with explicit `phase` tagging on events:

- **Phase 1 (analysis):** process every source file in a separate LLM call, accumulating `entity_types` incrementally after each file.
- **Phase 2 (ingest):** unchanged — sequential `runIngest` per file.

## Phase 1 — detailed flow

```
emit init_start { totalFiles: N, phase: "analysis" }

file_0 (bootstrap):
  emit file_start { file, index: 0, total: N, phase: "analysis" }
  LLM(initTemplate, file_0_content) → full DomainEntry
  emit domain_created | domain_updated
  persist domain
  emit file_done { file, phase: "analysis" }

file_1 .. file_N-1 (incremental):
  emit file_start { file, index: i, total: N, phase: "analysis" }
  LLM(initIncrementalTemplate, file_i_content, currentDomain.entity_types) → entity_types[]
  currentDomain.entity_types = mergeEntityTypes(current, incoming)
  emit domain_updated { patch: { entity_types } }
  persist domain
  emit file_done { file, phase: "analysis" }
```

Context per LLM call: 1 file (~8000 chars) + entity_types JSON (~compact, 5-20 types). Fixed ceiling regardless of source set size.

## Phase 2 — unchanged

```
emit init_start { totalFiles: N, phase: "ingest" }
for each file: runIngest(file, updatedDomain, ...)  ← existing loop, no changes
```

## Merge logic

```typescript
function mergeEntityTypes(current: EntityType[], incoming: EntityType[]): EntityType[] {
  // incoming overrides by type id (LLM had current as context, may refine)
  // new types from incoming are appended
  const map = new Map(current.map(e => [e.type, e]));
  for (const e of incoming) map.set(e.type, e);
  return [...map.values()];
}
```

## New prompt: `prompts/init-incremental.md`

Instructs LLM:
- Given: source file content + current `entity_types[]` JSON
- Return: updated `entity_types[]` JSON only — add new types, refine existing, do not change `type` id
- If no new types found: return current list unchanged
- No other fields, no prose

## RunEvent changes

Add optional `phase` field to three existing events:

```typescript
| { kind: "init_start"; totalFiles: number; phase?: "analysis" | "ingest" }
| { kind: "file_start"; file: string; index: number; total: number; phase?: "analysis" | "ingest" }
| { kind: "file_done"; file: string; phase?: "analysis" | "ingest" }
```

Optional (`?`) — backward compatible; view and tests that don't check `phase` are unaffected.

## Error handling

| Situation | Action |
|---|---|
| File unreadable during Phase 1 | Skip file, emit `assistant_text` warning, domain unchanged |
| LLM returns invalid JSON | Skip file, domain unchanged |
| LLM returns no new types | Merge is no-op, domain unchanged |
| Abort during Phase 1 | Stop immediately, persist domain at current state, skip Phase 2 |

No retry in Phase 1 (entity_types analysis is best-effort). Retry via `onFileError` remains in Phase 2 only.

## What does NOT change

- `runInit` without `--sources` — untouched
- `initTemplate` prompt — untouched, reused for `file_0` bootstrap
- `runIngest` — untouched
- Phase 2 loop in `runInitWithSources` — untouched
- `controller.ts`, `agent-runner.ts` — untouched

## Files to create / modify

| File | Change |
|---|---|
| `src/phases/init.ts` | Rewrite `runInitWithSources` Phase 1; add `mergeEntityTypes` |
| `src/types.ts` | Add `phase?` to `init_start`, `file_start`, `file_done` |
| `prompts/init-incremental.md` | New file — incremental entity_types prompt |
| `src/view.ts` | Render `phase` in progress display (analysis vs ingest) |
| `tests/phases/init.test.ts` | Tests for `mergeEntityTypes`, incremental Phase 1 flow |
