---
title: init-incremental → ingest merge
date: 2026-05-24
status: draft
intent: docs/superpowers/intents/2026-05-24-init-ingest-merge-intent.md
---

# Design: init-incremental → ingest merge

## Objective

Remove redundancy between `init-incremental` and `ingest` phases. Make `ingest` the primary wiki operation that handles both entity type discovery (meta-level) and instance extraction (object-level). `init` becomes a thin wrapper: bootstrap (file 0) stays, incremental delta (files 1+) moves into `ingest`.

## Architecture

### Before

```
init --sources →
  [file 0]  init.md (LLM) → DomainEntry (entity_types, wiki_folder, …)
  [file 1+] init-incremental.md (LLM) → entity_types_delta
            runIngest(file) → wiki pages
```

### After

```
init --sources →
  [file 0]  init.md (LLM) → DomainEntry  (unchanged)
  [file 1+] runIngest(file) → wiki pages + entity_types_delta?

ingest (standalone) → wiki pages + entity_types_delta?
  if entity_types_delta → emit domain_updated
```

## Changes

### 1. `src/phases/zod-schemas.ts`

Add `entity_types_delta` to `WikiPagesOutputSchema`:

```typescript
export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
  entity_types_delta: z.array(EntityTypeSchema).optional(),
});
```

`EntityTypeSchema` is already defined in this file.

### 2. `prompts/ingest.md`

Add a section instructing the LLM to return `entity_types_delta` only when the source contains entity types not represented in the current `entity_types` list. If nothing new — omit the field. Format: same structure as `entity_types` entries.

The `entity_types_block` variable already injects current types into the prompt — the LLM can compare against it.

### 3. `src/phases/ingest.ts`

After the page-writing loop, before `result` yield:

```typescript
const delta = parseResult.value.entity_types_delta;
if (delta?.length) {
  const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
  yield { kind: "domain_updated", domainId: domain.id,
          patch: { entity_types: merged } };
}
```

Import `mergeEntityTypes` from `../domain` (see change 4 below).

No changes to function signature. `domain_updated` event is already handled by the controller — no controller changes needed.

### 4. `src/domain.ts`

Move `mergeEntityTypes` here from `init.ts`. Both `ingest.ts` and `init.ts` import it from `../domain`, avoiding a circular import (`init.ts → ingest.ts → init.ts`).

```typescript
export function mergeEntityTypes(current: EntityType[], incoming: EntityType[]): EntityType[] {
  const map = new Map(current.map(e => [e.type, e]));
  for (const e of incoming) map.set(e.type, e);
  return [...map.values()];
}
```

### 5. `src/phases/init.ts`

In `runInitWithSources`, the `else` branch (files 1+) currently does two things:
1. LLM call with `init-incremental.md` → entity_types_delta
2. Merge into `currentDomain`

**Remove step 1** (the LLM call). Keep step 2 but source the delta from `domain_updated` events emitted by `runIngest`:

```typescript
// Replace the existing ingest call loop:
for await (const ev of runIngest([file], vaultTools, llm, model,
    [currentDomain], vaultTools.vaultRoot, signal, opts)) {
  yield ev;
  // Intercept entity_types updates so next file gets fresh types
  if (ev.kind === "domain_updated" && ev.domainId === domainId) {
    currentDomain = { ...currentDomain, ...ev.patch };
  }
}
```

Update `mergeEntityTypes` import: was a local function, now imported from `../domain`. Remove `initIncrementalTemplate` import. The `else` branch collapses to just the ingest call above.

### 6. `prompts/init-incremental.md`

Delete the file.

### 7. `docs/prompt-architecture.md`

- **Routing diagram**: remove `init files 1+` → `init-incremental.md` node
- **Prompt diagram**: remove `PIN2b` and `INITINC` nodes
- **`Контекст, инжектируемый в каждый промт` table**: remove `init files 1…N` row; add `entity_types_delta?` to ingest row
- **`callSite` table**: remove `init.delta` row
- **`Сравнительная таблица промтов`**: remove `init-incremental.md` row; update `ingest.md` row — note it now also returns entity types delta
- **`Замечания` section**: update "init-incremental vs ingest" from "потенциальное слияние" to "реализовано"
- **`ingest` secondary calls section**: add entry for entity_types_delta handling

## Data Flow: domain_updated from ingest

```
runIngest(file) →
  LLM call (ingest.md) → { reasoning, pages, entity_types_delta? }
  write pages
  if entity_types_delta:
    merged = mergeEntityTypes(domain.entity_types, delta)
    yield domain_updated { domainId, patch: { entity_types: merged } }
  yield result
```

Controller already persists `domain_updated` via `DomainStore.save()` — no controller changes.

Within `runInitWithSources`, `domain_updated` from ingest is intercepted to keep `currentDomain` in sync across iterations.

## Tests

### `tests/phases/ingest.test.ts`

- **New**: LLM returns `entity_types_delta` → `domain_updated` event emitted with merged types.
- **New**: LLM returns no `entity_types_delta` → no `domain_updated` event emitted.
- Existing tests: unchanged (field is optional, existing mocks return `{ reasoning, pages }`).

### `tests/phases/init.test.ts`

- **New**: `domain_updated` event from inner `runIngest` is intercepted and `currentDomain` is updated — file N+1 receives merged entity_types.
- Existing init tests must pass unchanged.

## Health Metrics (from intent)

| Check | How verified |
|---|---|
| Domain creation works | `init --sources` bootstrap (file 0) unchanged |
| Adding new sources works | `init --sources` files 1+ via ingest delta |
| Single-file ingest works | Standalone ingest — entity_types_delta optional, backward-compat |
| Existing tests pass | `entity_types_delta` optional — no schema breakage |

## Constraints Resolved

| Constraint | Resolution |
|---|---|
| `DomainStore` not accessible from ingest | Use existing `domain_updated` event — controller persists |
| Schema change needs review | `entity_types_delta?` is optional — backward-compatible |
| Must not break `init` user command | Bootstrap (file 0) unchanged; init still routes to `runInit` |
| `WikiOperation` type unchanged | No new operation types added |
