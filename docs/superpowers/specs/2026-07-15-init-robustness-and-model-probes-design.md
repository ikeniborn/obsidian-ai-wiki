---
chain:
  intent: n/a
review:
  spec_hash: 965f5bd856dfeece
  last_run: 2026-07-15
  phases:
    - name: structure
      status: passed
    - name: coverage
      status: passed
    - name: clarity
      status: passed
    - name: consistency
      status: passed
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Root causes / Design — F3"
      section_hash: 9c898e7d3f467204
      fragment: "`fetchEmbeddings` (`page-similarity.ts:778`) throws; the `catch` at line 779"
      text: >-
        The same entity is cited with divergent line numbers across sections. Root
        causes locates fetchEmbeddings at page-similarity.ts:778 with its catch at
        line 779; Design F3 locates fetchEmbeddings at page-similarity.ts:460 (and
        :449) with selectByEntitiesEmbedding's catch at line 783. One function/catch,
        inconsistent locations — may misdirect the implementer.
      fix: >-
        Reconcile to one canonical line per entity: cite fetchEmbeddings (and its
        throw-enrichment point) and the selectByEntitiesEmbedding catch once each,
        identically in Root causes and Design F3.
      verdict: fixed
      verdict_at: 2026-07-15
    - id: F-002
      phase: clarity
      severity: INFO
      section: "Testing"
      section_hash: e35950d470a8dc9e
      fragment: null
      text: >-
        The F4 requirement that a successful bootstrap returning an empty
        entity_types list is still accepted (init continues, pages route to
        entities/) has no matching acceptance test in Testing; only the
        bootstrap-failure path is verified. The allowed-empty branch is asserted
        but unverified.
      fix: >-
        Add a Testing bullet asserting a successful bootstrap that returns an empty
        entity_types list does not stop init and lets pages route to entities/.
      verdict: fixed
      verdict_at: 2026-07-15
---
# Init Robustness & Model Probes — Design

Date: 2026-07-15
Status: draft (design)
Branch: `dev-init-robustness-and-model-probes`

## Problem

Observed on domain `rtk-task` (source `Ростелеком/Задачи/`, model
`ollama-deepseek-v4-pro-cloud`, embedding `ollama-bge-m3`, endpoint
`https://homelab.ikeniborn.ru/litellm/v1`, plugin `0.1.201`):

1. Every file `init` aborts with `ingest: per-entity retrieval failed for all
   entities`. The run does **not** stop — it repeats the failure per file,
   re-spending an LLM extraction (~15 s) each time.
2. All wiki pages land in `!Wiki/rtk-task/entities/` instead of per-type
   subfolders.
3. `!Wiki/rtk-task/index.jsonl` is empty although 10 pages and a 55-line
   `metadata.jsonl` exist.
4. The settings "Check" button for embedding dimensions reports a generic
   `API error` with no cause.
5. There is no equivalent availability check for the reranker model.

## Root causes

Two independent roots, both of the shape "a structured/endpoint call fails and
the plugin swallows the cause and continues":

- **R1 — embedding call fails.** `selectByEntitiesEmbedding` calls
  `fetchEmbeddings` (`page-similarity.ts:778`; `fetchEmbeddings` is defined at
  `:436` and throws at `:460`), and the surrounding `catch` (lines 779–784)
  returns `allFailed:true` with no reason. The ingest guard (`ingest.ts:165`)
  then aborts. The endpoint and model were
  verified reachable by the user, so the failure is plugin-side. Leading
  suspect: the request always sends `dimensions:1024` (`page-similarity.ts:449`,
  seeded by the settings "Default" button) — a strict OpenAI-compatible backend
  (litellm→ollama `bge-m3`) may reject the field with a 4xx. R1 cascades into:
  - **F3** — per-file abort grind (no fail-fast, generic message).
  - **F5** — because ingest aborts before page synthesis
    (`upsertIndexAnnotation`, `ingest.ts:500`), `index.jsonl` is never written.
  - **F6** — the settings dimension check hits the same failure and shows a
    generic message.
- **R2 — bootstrap structured-output fails.** In an earlier session the
  `init.bootstrap` structured call failed json-parse on all retries
  (`tool_result ok:false "[init.bootstrap] structural validation failed after
  4…"`). `init.ts:237` catches it, warns, and `continue`s — leaving
  `entity_types:[]`. R2 causes:
  - **F4** — with no entity types, every page routes to the default
    `entities/` folder; no per-type routing ever happens.

`entity_types:[]` appears 59 times across the agent log and never becomes
non-empty — R2 has been silent since domain creation.

Base-URL wiring was audited and is **correct**: chat
(`controller.ts:677`), embedding (`agent-runner.ts:77`) and reranker
(`agent-runner.ts:108`) all use the single `nativeAgent.baseUrl`; embeddings hit
`${base}/embeddings`, rerank hits `${base}/rerank`. No separate embedding/rerank
base URL exists, and none is added (see Decisions).

## Finding map & scope

| ID | Symptom | Root | In scope |
|----|---------|------|----------|
| F1 | empty `wiki_subfolder` → flat path rejected downstream | path policy | ✅ |
| F2 | inline `.md && !/_config/` filter vs `isWikiPagePath` | duplication | ✅ |
| F3 | embedding failure → per-file grind, generic error | R1 | ✅ |
| F4 | all pages in `entities/`, no per-type routing | R2 | ✅ |
| F5 | empty `index.jsonl` despite existing pages | R1 | ➖ resolved via R1 |
| F6 | embedding "Check" button shows generic `API error` | R1 | ✅ |
| F7 | no reranker availability check | missing feature | ✅ |

### Decisions

- **Base URL:** keep one shared `nativeAgent.baseUrl`; do not add separate
  embedding/rerank base URLs. Fix the real suspect instead (make `dimensions`
  opt-in — see F3).
- **F4:** fail loud and stop `init` when bootstrap fails; do not continue with
  empty `entity_types`. A *legitimately* empty `entity_types` (bootstrap
  succeeded, model returned no types) stays allowed — only a bootstrap
  **failure** stops the run.
- **F5:** no separate backfill. F5 is downstream of R1; fixing embeddings and
  re-running a clean init repopulates `index.jsonl`. Documented as resolved via
  R1, not a code item.

## Design

### F1 — `effectiveSubfolder` fallback

New helper in `wiki-path.ts` (imports `EntityType` from `domain.ts`):

```ts
export function effectiveSubfolder(et: EntityType): string {
  return et.wiki_subfolder || sanitizeWikiSubfolder(et.type);
}
```

Fallback is the sanitized **entity type name** — this preserves per-type folder
separation and keeps the bijective `subfolder → type` mapping used by
`ensureEntityTypeTag`, and is consistent with `entityTypeFromPath`
(`raw-frontmatter.ts:60`, which already derives the type from the first path
segment). Route these sites through the helper so a type with an empty
`wiki_subfolder` always produces a valid nested (2-segment) path:

| Site | Change |
|------|--------|
| `ingest.ts:767` `buildEntityTypesBlock` | path template always `${wikiVaultPath}/${effectiveSubfolder(et)}/<EntityName>.md`; "Wiki subfolder" line shows the effective value |
| `main.ts:140` lint-count | drop the `if (!wiki_subfolder) {0; continue}` guard; count under `effectiveSubfolder(et)` |
| `view.ts:408` lint-count | same |
| `lint.ts:243` entity-type filter | use `effectiveSubfolder(e)` instead of `e.wiki_subfolder` |
| `lint.ts:510` empty-type cleanup | count/rmdir under `effectiveSubfolder(et)` |
| `tag-registry.ts:131` `ensureEntityTypeTag` | match `effectiveSubfolder(e) === subfolder` |
| `modals.ts:533` card display | show the effective subfolder (cosmetic) |

`validateArticlePath` is **unchanged** — it keeps the strict 2-segment rule
affirmed by the storage-layout fix (commit `6c10b7a`). `init.ts:262` (which
zeros a `wiki_subfolder` echoing `domain_id`) is left as-is; the helper covers
the resulting empty value downstream.

### F2 — centralize the page filter

Replace the inline `path.endsWith(".md") && !path.includes("/_config/")` with
`isWikiPagePath(path)` (already exported from `wiki-path.ts`) at the four sites:

- `delete.ts:49`, `delete.ts:133`
- `tag-registry.ts:46`
- `migrate-jsonl-domain-storage.ts:78`

`isWikiPagePath` additionally excludes JSONL sidecars and loose `_index.md` /
`_log.md` basenames, and centralizes future meta types. Behavior is otherwise
identical.

### F3 — embedding failure: fail-fast, real error, `dimensions` opt-in

1. **Surface the cause.** `fetchEmbeddings` (`page-similarity.ts:460`) enriches
   its throw with a body excerpt:
   `Embedding API error: ${resp.status} — ${resp.text?.slice(0, 200)}`.
2. **Propagate a reason.** Add `failReason?: string` to `EntityRetrievalResult`;
   `selectByEntitiesEmbedding`'s catch (line 783) stores `(e as Error).message`
   into it; `selectByEntities` passes it through.
3. **Fail fast, once.** The ingest guard (`ingest.ts:165`) throws a named
   `EmbeddingUnavailableError(failReason)` instead of yielding a generic error
   event. The throw happens before any page is written, so no partial state.
4. **Stop the whole run.** Both per-file ingest loops — in `runInitWithSources`
   (`init.ts:341`) and `runIncrementalReinit` (`init.ts:445`) — recognize the
   error by name and, instead of routing it through `onFileError`, emit one
   clear error
   (`init stopped — embedding endpoint failed: <reason>. Fix embedding config
   and re-run.`) and `return`. The failing file is **not** marked analyzed.
   `delete.ts` rebuild already catches thrown errors → marks the source failed
   and keeps it (correct).
5. **`dimensions` opt-in.** Stop auto-seeding `embeddingDimensions` on model
   change (`settings.ts:723`) and treat an empty value as "omit the field".
   `fetchEmbeddings` already omits `dimensions` when unset (`page-similarity.ts:449`),
   so the default request no longer sends a field strict backends may reject.
   Truncation stays available by explicitly entering a dimension and using
   "Check"/"Default".

### F4 — bootstrap fail-loud

When the `init.bootstrap` structured call fails (`init.ts:237` catch), stop the
init run with an explicit error instead of warning and continuing:

```
init: domain bootstrap failed — could not derive entity types
(structured-output error: <msg>). Fix model/prompt and re-run.
```

`return` from `runInitWithSources`; do not create/update the domain with empty
`entity_types`. This is scoped to bootstrap **failure** only — a successful
bootstrap that returns an empty list is still accepted (all pages then legitimately
route to `entities/`).

### F6 — embedding "Check" surfaces the real error

Extract the try/catch of `probeEmbeddingDimensions` into
`probeEmbeddingDimensionsResult(...): Promise<{ probe?: DimensionProbe; error?: string }>`.
`probeEmbeddingDimensions` becomes a thin wrapper returning `.probe ?? null`
(unchanged signature for the two non-Check callers). `checkDimensions`
(`settings.ts:127`) calls the Result variant and shows the real `error`
(status + body from the F3-enriched throw) instead of `Dimension check failed:
API error`.

### F7 — reranker availability probe

Add `probeRerankerModel(baseUrl, apiKey, config): Promise<{ ok: boolean; error?: string }>`
to `reranker.ts`, reusing the `fetchRerankerScores` transport with a trivial
query + single candidate. Add a "Check" button next to the reranker model input
(`settings.ts:~798`) that calls it and shows a `Notice` (OK / real error),
mirroring the embedding "Check" UX.

## Testing

- `effectiveSubfolder`: empty → sanitized type name; non-empty → as-is; slashes
  stripped.
- `buildEntityTypesBlock`: a type with empty `wiki_subfolder` yields a nested
  (not flat) path template.
- `validateArticlePath`: unchanged — still rejects a flat 1-segment path
  (regression guard stays).
- `ensureEntityTypeTag`: a page under the derived folder gets the type tag.
- lint empty-type cleanup: a type with empty `wiki_subfolder` and pages under
  the derived folder **survives** (not removed).
- `isWikiPagePath` excludes `.jsonl` sidecars at the four F2 sites.
- `fetchEmbeddings`: on a mocked 4xx, the thrown message carries status + body.
- `selectByEntities`: embedding failure → `allFailed:true` with `failReason` set.
- `runIngest`: `allFailed` → throws `EmbeddingUnavailableError`.
- `runInitWithSources`: a fatal embedding error emits one error event and
  returns; the next file is not processed and `analyzed_sources` is not extended.
- `runInitWithSources`: bootstrap failure emits the F4 error and returns without
  creating/updating the domain.
- `runInitWithSources`: a *successful* bootstrap that returns an empty
  `entity_types` list does not stop init; the domain is created and pages route
  to `entities/`.
- `probeEmbeddingDimensionsResult`: returns `error` on failure; `checkDimensions`
  shows it.
- `probeRerankerModel`: returns `{ok:true}` on valid scores, `{ok:false,error}`
  on a mocked failure.
- `dimensions` opt-in: with `embeddingDimensions` unset, the embedding request
  body omits `dimensions`.

## Risk

- **F3** — medium: changes init control flow (throw instead of yield). Mitigated
  — all three `runIngest` callers (`delete.ts:105`, `init.ts:330`, `init.ts:433`)
  are audited and wrap in try/catch; the throw point precedes any page write.
- **F3 dimensions opt-in** — low/behavioral: users relying on truncation must
  re-enter a dimension; the default (native size) is unaffected in quality.
- **F4** — low: only converts a silent skip into an explicit stop.
- **F1, F2, F6, F7** — low.

## Out of scope / follow-ups

- **F5** repopulates once R1 is fixed and a clean init runs; no backfill code.
  If orphaned pages with an empty `index.jsonl` must be recovered without a
  reinit, a separate `reconcile`/backfill is a future item.
- Confirming the exact R1 cause (`dimensions` vs model routing vs request shape)
  is done at runtime once F3/F6 surface the real status/body.

## Verification

1. Build + unit tests green (`npm test`, lint, `tsc`).
2. Manual: trigger an embedding failure (bad model/dimension) → init stops once
   with the real status/body; no per-file grind; file not marked analyzed.
3. Manual: a type with empty `wiki_subfolder` → its pages land under
   `<TypeName>/` and are counted by lint.
4. Manual: reranker "Check" reports availability; embedding "Check" reports the
   real error on failure.
