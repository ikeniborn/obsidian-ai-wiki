---
review:
  spec_hash: 91558911fd8da774
  last_run: 2026-07-14
  phases:
    - name: structure
      status: passed
    - name: coverage
      status: passed
    - name: clarity
      status: passed
    - name: consistency
      status: passed
  findings: []
chain:
  intent: n/a
---
# Storage-Layout Sidecar Fix — Design

Date: 2026-07-14
Status: approved (design)
Branch: `dev-fix-storage-layout-sidecar`

## Problem

Fresh domain `init` fails with `ingest: per-entity retrieval failed for all
entities`. No wiki pages are generated, yet domain metadata is written and an
empty global `!Wiki/_config` folder lingers in the vault.

Reproduced from the reported `init` of domain `os` (source `ОС/Mac/`):
entity extraction returns 13 entities, then per-entity retrieval aborts.

## Root cause

The JSONL storage migration introduced per-domain sidecar files
(`metadata.jsonl`, `index.jsonl`, `log.jsonl`) under `!Wiki/<domain>/`, but the
code that separates wiki content pages from meta files was never updated. It
still recognizes only the legacy `_index.md` / `_log.md` markers.

### Bug 1 — stale sidecar filter (primary, blocks all init)

- `src/phases/ingest.ts:123`
  `nonMetaPaths = existingPaths.filter((f) => !f.endsWith("_index.md"))`.
  `VaultTools.listFiles` recurses (`src/vault-tools.ts:154`), so the new
  `.jsonl` sidecars and any `_config/*` leak into `nonMetaPaths`.
- `src/phases/query.ts:35`, `src/phases/lint.ts:29`, `src/phases/lint-chat.ts:19`
  each define `META_FILES = ["_index.md", "_log.md"]` — same blindness. JSONL
  sidecars are treated as content pages by query and lint.

Failure chain on a fresh domain:

1. Domain registration writes `!Wiki/<domain>/metadata.jsonl`.
2. Ingest extracts entities (13) — OK.
3. `nonMetaPaths = ["!Wiki/<domain>/metadata.jsonl"]` → length 1.
4. Retrieval finds no index annotations (fresh domain) → `anySuccess = false`
   → `allFailed = allPaths.length > 0 && !anySuccess = true`
   (`src/page-similarity.ts:840`).
5. Guard `src/phases/ingest.ts:165` fires → error → abort. No pages generated.

Secondary hazard: with the guard removed but the filter unfixed, the leaked
`metadata.jsonl` reaches `src/phases/ingest.ts:197`, fails the `/resource:/`
check, and is deleted — data loss. The filter fix is mandatory.

### Bug 2 — `allFailed` guard semantics

`src/page-similarity.ts:763,840`: `allFailed = allPaths.length > 0 &&
!anySuccess`, where `anySuccess` is set only when `indexAnnotations.size > 0`.
An empty or not-yet-built index is indistinguishable from a genuine embedding
infrastructure failure. Even after Bug 1 is fixed, a domain with real pages but
an empty `index.jsonl` still aborts.

### Bug 3 — orphaned empty `_config` folders

`src/migrate-jsonl-domain-storage.ts:219-221` removes the legacy files
(`!Wiki/_config/_domain.json`, per-domain `_config/*`) but never `rmdir`s the
now-empty folders. `cleanupBundledSchemaCopies` (`src/storage-migration.ts:95`)
likewise removes files only. The empty global `!Wiki/_config` therefore remains
visible in the vault after migration.

### Minor — legacy whitelist

`src/wiki-path.ts:35-37` `validateArticlePath` still whitelists
`_config/_index.md` and `_config/_log.md` as valid article paths.

## Design

### A. Centralize meta / sidecar recognition

Add to `src/wiki-path.ts`:

- `isDomainMetaPath(path): boolean` — true for `metadata.jsonl`, `index.jsonl`,
  `log.jsonl`, any path segment under `/_config/`, and legacy `_index.md` /
  `_log.md`.
- `isWikiPagePath(path): boolean` — true when `path` ends with `.md` and is not
  a meta path.

Replace the four divergent `META_FILES` filters and `ingest.ts`'s inline
`nonMetaPaths` filter with these helpers. This removes Bug 1 everywhere and
prevents `metadata.jsonl` from ever reaching the `resource:`-based delete path.

### B. Fix guard semantics

Redefine "failure" in `src/page-similarity.ts` so `allFailed` is true only on a
genuine infrastructure failure — embeddings configured and the entity-vector
fetch failed for the whole set. An empty index yields empty per-entity results
with `allFailed = false`; ingest then treats every entity as new and proceeds to
generate pages. The `ingest.ts` guard aborts only on genuine failure.

### C. Clean orphaned `_config` folders

In `src/migrate-jsonl-domain-storage.ts`, after removing the legacy files,
`rmdir` the emptied `!Wiki/_config` (global) and each per-domain
`!Wiki/<domain>/_config` when empty, reusing the rmdir-if-empty pattern from
`src/storage-migration.ts:138`. Add a one-shot on-load cleanup that removes an
empty global `!Wiki/_config`.

### D. Minor — drop legacy whitelist

Remove the `_config/_index.md` / `_config/_log.md` whitelist in
`validateArticlePath` after confirming no remaining caller depends on it.

## Testing (TDD)

- Ingest: a fresh domain with `metadata.jsonl` present → `metadata.jsonl` is not
  in `nonMetaPaths`, no false `allFailed`, ingest proceeds to page generation.
- Page-similarity: empty index → `allFailed = false`.
- Migration: after `migrateJsonlDomainStorage`, emptied global and per-domain
  `_config` folders are removed.
- Query / lint: `.jsonl` sidecars are never treated as content pages.

## Scope

In scope: A, B, C, D as above, plus the tests. Out of scope: any change to the
JSONL schema, the embedding/reranker pipeline, or the migration data format.
Only the sidecar-recognition, guard-semantics, and folder-cleanup paths change.
