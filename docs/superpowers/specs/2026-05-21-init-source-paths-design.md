---
review:
  spec_hash: f2baaa5b48861fb3
  last_run: "2026-05-21"
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "### Delete / update"
      section_hash: e95ff246b83f260c
      text: "\"Delete / update\" не уточняет какие конкретно тесты удалять vs обновлять — но это INFO, решается при реализации"
      verdict: accepted
      verdict_at: "2026-05-21"
---

# Init via source_paths — Design

## Problem

`runInit` without `--sources` reads 5 random files from the entire vault to "sample" structure for LLM bootstrap. This causes:
1. Context overflow (3M+ tokens) when vault contains large files
2. Reads wrong vault — samples unrelated files instead of domain sources
3. Semantically wrong: vault structure ≠ domain structure

## Solution

Remove the vault-sampling bootstrap path. Delegate to `runInitWithSources` using the domain's configured `source_paths`.

## New `runInit` Flow

```
args → domainId, dryRun, force, sourcePaths

--force    → existing force path (unchanged)
--sources  → runInitWithSources(sourcePaths, ...) (unchanged)

// Path replacing broken bootstrap:
existing = domains.find(d => d.id === domainId)
if !existing               → error "domain not found, add in settings"
if entity_types.length > 0 → error "already initialised, use Lint"
if !source_paths.length    → error "no source_paths configured"
→ runInitWithSources(existing.source_paths, dryRun, ...)
```

## What Changes

### `src/phases/init.ts`

**Delete** (~90 lines in `runInit`):
- `listFiles("")` + `readAll(sampleFiles)` — vault sampling
- LLM `parseWithRetry` call for domainless bootstrap
- Direct `domain_created` / `domain_updated` events from that path
- `tryRead` calls for schema/index in `runInit` (still used in `runInitWithSources`)

**Add** (new "no sources" block):
```ts
const existing = domains.find((d) => d.id === domainId);
if (!existing) {
  yield { kind: "error", message: `init: domain not found: "${domainId}" — add it in settings first` };
  return;
}
if (existing.entity_types?.length) {
  yield { kind: "error", message: `Domain "${domainId}" already initialised. Use Lint to update entity_types.` };
  return;
}
const effectiveSources = existing.source_paths ?? [];
if (!effectiveSources.length) {
  yield { kind: "error", message: `init: no source_paths configured for "${domainId}" — add them in settings` };
  return;
}
yield* runInitWithSources(domainId, effectiveSources, dryRun, vaultTools, llm, model, domains, vaultName, signal, opts, onFileError);
```

**Unchanged:**
- `runInitWithSources` — no changes
- `ensureRootFiles` — called inside `runInitWithSources`
- `--force` path — no changes
- `--sources` path — no changes
- `wipeDomainFolder` — no changes

## Tests

### Delete / update
- Tests covering the vault-sampling bootstrap path in `runInit` without sources

### Add
- `runInit` with domain having no `source_paths` → error "no source_paths configured"
- `runInit` with domain having `source_paths` → delegates to `runInitWithSources` (verify `init_start` event emitted)
- `runInit` with unknown domainId → error "domain not found"
- `runInit` with already-initialised domain (has entity_types) → error "already initialised"

## Out of Scope

- Changes to `runInitWithSources`
- Changes to `controller.ts` or UI
- `--force` path
