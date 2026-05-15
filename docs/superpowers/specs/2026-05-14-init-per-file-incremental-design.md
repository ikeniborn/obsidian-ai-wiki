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
  emit domain_created  (if domain did not exist before)
    OR domain_updated { patch: { entity_types, language_notes, wiki_folder, analyzed_sources: [] } }  (if domain already exists)
  persist domain
  emit file_done { file, phase: "analysis" }

file_1 .. file_N-1 (incremental):
  emit file_start { file, index: i, total: N, phase: "analysis" }
  LLM(initIncrementalTemplate, file_i_content, currentDomain.entity_types) → { entity_types[], language_notes? }
  currentDomain.entity_types = mergeEntityTypes(current, incoming.entity_types)
  if incoming.language_notes: currentDomain.language_notes = incoming.language_notes
  currentDomain.analyzed_sources.push(file)
  emit domain_updated { patch: { entity_types, language_notes?, analyzed_sources } }
  persist domain
  emit file_done { file, phase: "analysis" }
```

### DomainEntry fields set by bootstrap (file_0)

`initTemplate` returns a full `DomainEntry` JSON. Fields used by bootstrap:

| Field | Source |
|---|---|
| `id` | from LLM response (must equal `domainId`) |
| `name` | from LLM response |
| `wiki_folder` | from LLM response (normalized, strip `!Wiki/` prefix) |
| `entity_types` | from LLM response |
| `language_notes` | from LLM response |
| `source_paths` | from command args (not from LLM) |
| `analyzed_sources` | set to `[]` on bootstrap; appended after each successfully analyzed file |

When domain already exists (`domain_updated`), the store applies patch via `{ ...existing, ...patch }` — so `id`, `name`, existing `source_paths` are preserved; only `entity_types`, `language_notes`, and `wiki_folder` are overwritten.

Incremental files (1..N-1) update **only** `entity_types`. All other fields are frozen at bootstrap values.

### Context per LLM call

Each call receives: 1 file content (truncated to 8 000 chars via `slice(0, 8_000)`) + `entity_types` JSON (~compact, 5–20 types). Fixed ceiling regardless of source set size.

If file content exceeds 8 000 chars, emit `assistant_text` warning before the LLM call:
```
⚠ <file>: truncated to 8 000 chars (original: <N> chars)
```

## Phase 2 — unchanged

```
emit init_start { totalFiles: N, phase: "ingest" }
for each file: runIngest(file, updatedDomain, ...)  ← existing loop, no changes
```

**View behavior on second `init_start`:** view resets file counter and progress bar, displays phase label ("Analysing files…" for `analysis`, "Ingesting files…" for `ingest`). Does not reset domain info or history.

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

Imported in code as `initIncrementalTemplate` (matches convention: `import initTemplate from "../../prompts/init.md"`).

Instructs LLM:
- Given: source file content + current `entity_types[]` JSON
- Return JSON object: `{ "entity_types": [...], "language_notes": "..." }`
  - `entity_types`: add new types, refine existing, do not change `type` id; if no changes — return current list unchanged
  - `language_notes`: update if file reveals new language conventions; omit field if nothing to add
- No other fields, no prose

## RunEvent changes

Add optional `phase` field to three existing events:

```typescript
| { kind: "init_start"; totalFiles: number; phase?: "analysis" | "ingest" }
| { kind: "file_start"; file: string; index: number; total: number; phase?: "analysis" | "ingest" }
| { kind: "file_done"; file: string; phase?: "analysis" | "ingest" }
```

Optional (`?`) — backward compatible; view and tests that don't check `phase` are unaffected.

**Why `domain_updated` does not get `phase?`:** `domain_updated` during `init --sources` only occurs in Phase 1 (bootstrap + incremental accumulation). `runIngest` in Phase 2 does not emit `domain_updated`. No ambiguity → no field needed.

## Error handling

| Situation | Action |
|---|---|
| File unreadable during Phase 1 | Skip file, emit `assistant_text` warning, domain unchanged |
| LLM returns invalid JSON | Skip file, domain unchanged |
| LLM returns no new types | Merge is no-op, domain unchanged |
| Abort during Phase 1 | Stop immediately, persist domain at current state (including current `analyzed_sources`), skip Phase 2 |
| Re-run `init --sources` after abort | Domain has `analyzed_sources` → skip those files, resume Phase 1 from first file not in `analyzed_sources`. Bootstrap (file_0) is NOT repeated — accumulated entity_types/language_notes are preserved. |
| Phase 1 completes successfully | Emit `domain_updated { patch: { analyzed_sources: undefined } }` to clear progress marker. |

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
| `src/phases/init.ts` | Rewrite `runInitWithSources` Phase 1; add `mergeEntityTypes`; add resume logic via `analyzed_sources` |
| `src/types.ts` | Add `phase?` to `init_start`, `file_start`, `file_done` |
| `src/domain.ts` | Add `analyzed_sources?: string[]` to `DomainEntry` |
| `prompts/init-incremental.md` | New file — incremental entity_types prompt |
| `src/view.ts` | On `init_start`: reset file counter + progress bar, display phase label |
| `tests/phases/init.test.ts` | See test cases below |

## Test cases — `tests/phases/init.test.ts`

### `mergeEntityTypes`
- new type in `incoming` → appended to result
- existing type in `incoming` → overrides current entry (same `type` id)
- empty `incoming` → returns current unchanged
- empty `current` → returns `incoming`

### Phase 1 bootstrap (file_0)
- new domain → emits `domain_created` with full entry incl. `source_paths` from args
- existing domain → emits `domain_updated` with patch `{ entity_types, language_notes, wiki_folder }`
- emits `init_start { phase: "analysis" }`, `file_start { index: 0, phase: "analysis" }`, `file_done { phase: "analysis" }`

### Phase 1 incremental (file_1..N-1)
- emits `domain_updated { patch: { entity_types } }` after each file
- entity_types accumulate correctly across N files (mergeEntityTypes called each step)
- emits `file_start { phase: "analysis" }` / `file_done { phase: "analysis" }` for each file

### Phase 2
- emits `init_start { phase: "ingest" }` before ingest loop
- delegates to existing `runIngest` per file (no change to ingest behavior)

### Progress tracking / resume
- after abort with N files already analyzed, re-run skips those N files and resumes from file N+1
- `analyzed_sources` cleared after successful Phase 1 completion

### Error handling
- unreadable file in Phase 1 → skip, emit `assistant_text` warning, next file proceeds
- LLM returns invalid JSON in Phase 1 → skip file, domain unchanged, next file proceeds; file NOT added to `analyzed_sources`
- abort during Phase 1 → loop stops, domain persisted at current accumulated state (with `analyzed_sources`)

### Truncation warning
- file ≤ 8 000 chars → no warning
- file > 8 000 chars → `assistant_text` warning emitted before LLM call
