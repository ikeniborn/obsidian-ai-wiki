---
review:
  spec_hash: 9d4e875fb5426139
  last_run: 2026-07-10
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-10-jsonl-domain-storage-intent.md
---
# JSONL Domain Storage — Design

Date: 2026-07-10
Status: approved (design)
Branch: `dev-jsonl-domain-storage`

## Acceptance (from intent)

### Desired Outcomes

- New domains are created without `_config` folders.
- Each domain stores its retrieval index in a domain-local `index.jsonl`.
- Each domain stores its operation history in a domain-local `log.jsonl`.
- `_embeddings.json` is removed; embedding vectors are stored in `index.jsonl`
  records with their chunk metadata.
- Settings and the sidebar can load and display domains from the new storage
  source.
- Query works against the new index format.
- The design explicitly decides whether to keep a global root `!Wiki/domain`
  registry or move to fully self-contained domain metadata.
- The design explicitly decides whether entity types remain managed domain
  metadata or become derived from domain structure/page data.
- An eval harness builds a test domain from
  `/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD`,
  runs five test queries, and reports an `accepted`, `needs_tuning`, or `rejected`
  verdict for retrieval effectiveness.

### Done when

A checked design specifies the new storage contract, domain discovery model,
entity-type decision, migration behavior, runtime read/write paths, query behavior,
and HLD eval harness; later implementation evidence shows the new format,
migration, settings/sidebar, query, and five-query HLD evaluation working without
regressions against the critical health metrics.

## Decisions

1. **Domain metadata becomes self-contained.** There is no root `!Wiki/domain`
   registry in the target format. Each domain owns `metadata.jsonl` inside its
   folder.
2. **Entity types remain managed metadata.** `entity_types` are preserved as
   explicit records because ingest prompts, extraction cues, minimum mention
   thresholds, and UI editing depend on that control.
3. **`index.jsonl` replaces both `_index.md` and `_embeddings.json`.** It stores
   `page` records for page-level retrieval metadata and `chunk` records for clean
   section chunks plus embedding vectors.
4. **`log.jsonl` replaces `_log.md`.** Operation history becomes structured JSONL
   events, with legacy markdown log blocks preserved during migration when they
   cannot be parsed into structured events.
5. **Legacy service files are deleted only after verified migration and backup.**
   The migration creates a timestamped backup snapshot first, writes and validates
   the new files, runs a query smoke read, then deletes old `_config` service files.
6. **Runtime source of truth changes after migration.** Legacy paths can be read only
   by migration/fallback code during the transition. They are not normal runtime
   sources of truth after successful migration.

## Target Layout

```text
!Wiki/
  <domain>/
    metadata.jsonl
    index.jsonl
    log.jsonl
    <type>/
      <page>.md
```

The root `!Wiki` folder contains domain folders and migration backup folders. It
does not contain a domain registry file in the target model.

## Storage Contracts

### `metadata.jsonl`

`metadata.jsonl` is the domain-local source of truth for domain settings and managed
types. The reader builds the current `DomainEntry` shape from the effective latest
records so existing UI/controller consumers can remain stable during the first
implementation.

Required record kinds:

```ts
type MetadataRecord =
  | DomainRecord
  | EntityTypeRecord
  | SourceStateRecord;
```

`DomainRecord`:

```ts
{
  kind: "domain";
  schemaVersion: 1;
  id: string;
  name: string;
  wiki_folder: string;
  source_paths: string[];
  language_notes?: string;
  max_tag_categories?: number;
  pageNameVersion?: number;
}
```

`EntityTypeRecord`:

```ts
{
  kind: "entity_type";
  type: string;
  description: string;
  extraction_cues: string[];
  min_mentions_for_page?: number;
  wiki_subfolder?: string;
}
```

`SourceStateRecord`:

```ts
{
  kind: "source_state";
  path: string;
  hash: string;
}
```

Unknown record kinds are ignored by readers. Metadata rewrites should preserve
unknown records when the implementation can do so without ambiguity.

### `index.jsonl`

`index.jsonl` is the retrieval source of truth. It contains page records and chunk
records. It does not contain markdown frontmatter dumps; it stores the normalized
fields required for retrieval, diagnostics, and stale checks.

`PageIndexRecord`:

```ts
{
  kind: "page";
  schemaVersion: 1;
  articleId: string;
  path: string;
  type: string;
  description: string;
  resource: string[];
  timestamp?: string;
  tags?: string[];
  bodyHash: string;
  descriptionHash: string;
}
```

`ChunkIndexRecord`:

```ts
{
  kind: "chunk";
  schemaVersion: 1;
  articleId: string;
  path: string;
  heading: string;
  ordinal: number;
  bodyHash: string;
  embedTextHash: string;
  vector: number[];
  vectorModel: string;
  dimensions: number;
  updatedAt: string;
}
```

Chunk records are built only from searchable body sections. `## Related` and
`## External links` are excluded from chunk embedding input and from chunk records.

### `log.jsonl`

`log.jsonl` stores operation history as structured events. Minimum fields:

```ts
{
  kind: "operation";
  ts: string;
  domainId: string;
  op: "ingest" | "lint" | "fix" | "query" | string;
  entries?: Array<{
    path: string;
    action: "CREATED" | "UPDATED" | "DELETED" | "MERGED" | string;
    statusFrom?: string;
    statusTo?: string;
  }>;
  outputTokens?: number;
  warnings?: string[];
  errors?: string[];
}
```

When `_log.md` cannot be parsed precisely, migration writes:

```ts
{
  kind: "legacy_log_block";
  ts?: string;
  domainId: string;
  text: string;
}
```

## Runtime Architecture

### Path helpers

`src/wiki-path.ts` changes service paths:

- `domainMetadataPath(domainFolder)` → `!Wiki/<domain>/metadata.jsonl`
- `domainIndexPath(domainFolder)` → `!Wiki/<domain>/index.jsonl`
- `domainLogPath(domainFolder)` → `!Wiki/<domain>/log.jsonl`
- `domainEmbeddingsPath` is removed after the migration path no longer needs it.

Legacy helpers remain private to migration code and are not imported by runtime
query, settings, sidebar, or normal domain-write paths.

### Domain store

`DomainStore` remains the storage boundary. Public callers should not learn JSONL
details.

- `load()` scans `!Wiki/*/metadata.jsonl`, reads each domain, and returns
  `DomainEntry[]`.
- `save(domains)` can remain as a compatibility wrapper during the first pass, but
  it writes each changed domain to that domain's `metadata.jsonl` rather than a
  global array file.
- Domain create/update/source edits/entity-type edits should move toward targeted
  domain writes so UI operations do not rewrite unrelated domains.
- Writes use temp files plus rename.
- Corrupt domain metadata should report the domain path and skip or block according
  to existing corruption-handling behavior; it must not silently invent metadata.

### Settings and sidebar

Settings, sidebar, and controller should continue using `DomainStore` and
`WikiController.loadDomains()`.

- Domain list comes from scanning `metadata.jsonl`.
- Edit-domain modal still edits managed `entity_types`.
- Open-index/open-log links point to `index.jsonl` and `log.jsonl`.
- Existing UI should not show `_config` paths after migration.

## Retrieval and Indexing

`index.jsonl` replaces both `_index.md` and `_embeddings.json`.

Index rebuild:

1. Scan wiki pages for a domain.
2. Read OKF frontmatter fields: `description`, `type`, `resource`, `timestamp`, and
   `tags`.
3. Split searchable body sections, excluding `## Related` and `## External links`.
4. Write one `page` record per article.
5. Write one `chunk` record per embedded section chunk.
6. Atomically replace `index.jsonl` after all records are built.

Query:

- Description seed selection reads `page.description` records.
- Final chunk ranking reads `chunk.vector` records.
- Graph expansion continues to use body markdown links or the existing graph cache.
- If vector records are missing, stale, malformed, or dimension-incompatible, query
  falls back to Jaccard rather than failing and records that fallback in diagnostics.
- Diagnostics include `indexFormat: "jsonl"` and selected page/chunk record
  identifiers.

Compatibility:

- `parseIndexAnnotations(_index.md)` becomes legacy migration/read helper only.
- The page-similarity cache version bumps because old vectors came from
  `_embeddings.json` and old section vectors may have been built under older chunk
  contracts.
- No vector is stored in markdown body or markdown frontmatter.

## Migration

Migration runs before normal domain load completes.

### Detection

Legacy state exists when any of these are present:

- `!Wiki/_config/_domain.json`
- `!Wiki/<domain>/_config/_index.md`
- `!Wiki/<domain>/_config/_log.md`
- `!Wiki/<domain>/_config/_embeddings.json`

### Backup

Before destructive work, migration creates:

```text
!Wiki/.backup/jsonl-domain-storage-YYYYMMDD-HHMMSS/
  manifest.json
  ...
```

The manifest records original paths, backup paths, sizes, hashes, and migration
version. The backup includes all legacy service files that will be deleted.

### Conversion

- `_domain.json` → one `metadata.jsonl` per domain.
- Old `entity_types` → `entity_type` records.
- Old `analyzed_sources` → `source_state` records.
- `_index.md` annotations plus page frontmatter descriptions → `page` records.
- `_embeddings.json` chunk/vector cache → `chunk` records when model/dimension/hash
  metadata matches the current model, dimensions, page hash, and chunk hash;
  otherwise index rebuild creates fresh records, and query uses Jaccard fallback
  until fresh vectors exist.
- `_log.md` → structured `operation` records where possible and
  `legacy_log_block` records where not.

### Validation

Legacy deletion is allowed only when all required validation passes:

- domain count matches;
- every migrated domain has `metadata.jsonl`;
- managed entity-type count matches;
- source paths and analyzed source states match;
- page records exist for live wiki pages;
- vector dimensions/model metadata are consistent for migrated chunk records;
- backup manifest exists and copied-file hashes match source hashes;
- query smoke can read `metadata.jsonl` and `index.jsonl`.

If validation fails, migration keeps legacy files, keeps the backup, emits a
notice/report, and runtime falls back to legacy state for that launch.

### Deletion

After validation, migration deletes legacy `_config` service folders and files.
Deletion never happens before the new files and backup are verified.

## Eval Harness

The eval harness proves that the new format does not hurt retrieval before the
change is accepted.

Corpus source:

```text
/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD
```

The harness creates an isolated test domain in a temp/test vault or dedicated eval
folder. It reads source HLD files but never modifies them.

Flow:

1. Build a legacy baseline from current branch behavior. If a baseline cannot be
   produced in the environment, record the blocker and mark the aggregate verdict
   `needs_tuning` rather than `accepted`.
2. Create or migrate the eval domain to the JSONL layout.
3. Run five fixed queries over the HLD domain.
4. Capture top pages/chunks, selected context chunks, answer/evidence text, query
   latency, index rebuild time, service-file sizes, vector counts/dimensions, and
   fallback mode.
5. Write a report under `docs/superpowers/evals/` with per-query evidence and an
   aggregate verdict.

Initial query themes:

- data export, S3, and ClickHouse;
- Airflow HA and balancing;
- integrations, consumers, and data marts;
- source-system migration or GitFlame;
- project-specific architecture ownership/components.

Aggregate verdicts:

- `accepted`: quality and recall are not worse than baseline, query latency does
  not increase, index rebuild time does not increase, service-file size does not
  increase, and manual inspection remains line-oriented JSONL with one complete
  record per line.
- `needs_tuning`: the format works, but ranking or latency needs adjustment.
- `rejected`: the storage/query contract loses critical evidence or breaks metrics.

## Error Handling

- Corrupt `metadata.jsonl`: report the specific domain path; do not invent a domain.
- Corrupt `index.jsonl`: query falls back to Jaccard and reports index read failure
  in diagnostics.
- Partial migration: legacy files remain runtime fallback only when deletion did not
  run.
- Backup failure: migration stops before writing or deleting target files.
- Validation failure: migration stops before legacy deletion.
- Unknown JSONL record kind: ignore for reads; preserve during rewrites where safe.
- HLD eval source path missing: eval reports blocked and does not mutate any domain.

## Testing

- Unit: metadata JSONL parse/serialize, unknown-kind preservation, corrupt-line
  errors, `DomainEntry` round trip, entity-type record round trip, source-state
  record round trip.
- Unit: index JSONL parse/serialize for `page` and `chunk` records, vector dimension
  validation, stale hash detection, Related/External exclusion.
- Unit: log JSONL append and legacy `_log.md` conversion.
- Unit: path helpers for `metadata.jsonl`, `index.jsonl`, `log.jsonl`, and legacy
  migration paths.
- Migration fixture: legacy `_domain.json`, `_index.md`, `_log.md`,
  `_embeddings.json` → new files, verified backup, legacy deletion after
  validation.
- Runtime smoke: settings/controller load domains from metadata; sidebar open-index
  and open-log links target JSONL files.
- Retrieval smoke: query reads `index.jsonl`, selects page/chunk records, preserves
  Jaccard fallback.
- Eval: HLD harness runs five fixed queries and writes an evidence report.

## Alternatives Considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| Self-contained `metadata.jsonl` per domain | Domain folders are portable; UI stays behind `DomainStore`; no root registry drift | Discovery scans domain folders; migration is broader | chosen |
| Root `!Wiki/domain` registry + per-domain index/log | Fast central listing; smaller migration from `_domain.json` | Domain folders are not self-contained; global registry remains another source of truth | rejected |
| Derived-only domains with no metadata file | Fewest service files | Loses source paths, analyzed hashes, managed type cues, and UI editability | rejected |
| Remove managed entity types | Simpler metadata | Breaks extraction control and existing UI semantics | rejected |
| Keep legacy files as permanent backup | Easy manual rollback | Violates the requested removal and leaves stale service files | rejected |

## Out of Scope

- Changing OKF page frontmatter semantics beyond reading existing OKF fields into
  `index.jsonl`.
- Changing body link syntax away from Obsidian wikilinks on disk.
- Adding an external vector database or cloud storage dependency.
- Changing retrieval ranking defaults without separate approval.
- Mutating the HLD source vault.
