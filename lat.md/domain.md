# Domain Model

A domain is the unit of organization for a knowledge wiki. Each domain has an id, a wiki folder inside `!Wiki/`, a list of source paths, and a set of entity types that guide LLM extraction.

## DomainEntry

Core domain record stored in `!Wiki/_config/_domain.json` via `DomainStore`. Fields: `id`, `name`, `wiki_folder`, `source_paths`, `entity_types`, `language_notes`, `analyzed_sources`.

See [[src/domain.ts#DomainEntry]], [[src/domain-store.ts#DomainStore]].

## EntityType

Describes a category of knowledge entities the LLM should extract during ingest. Fields: `type`, `description`, `extraction_cues`, optional `min_mentions_for_page`, optional `wiki_subfolder`.

Entity types are initialized by `init`, refined incrementally by `ingest` (via `entity_types_delta`), and re-synchronized by `lint` (via `actualizeDomainConfig`).

See [[src/domain.ts#EntityType]], [[src/domain.ts#mergeEntityTypes]].

## Domain Events

Domain state changes are communicated as `RunEvent` variants and applied by the controller via `applyDomainEvent`:

| Event | Trigger | Effect |
|---|---|---|
| `domain_created` | init bootstrap | Adds new DomainEntry |
| `domain_updated` | ingest delta, lint patch | Merges patch into entry |
| `source_path_added` | ingest new source | Appends to source_paths |

See [[src/domain.ts#applyDomainEvent]], [[src/types.ts#RunEvent]].

## Wiki Folder Layout

All wiki artifacts live under `!Wiki/`. Global config lives in `!Wiki/_config/`; per-domain config in `!Wiki/<domain>/_config/`:

```
!Wiki/
  _config/                       — global config (all domains)
    _domain.json                 — domain entries list
    _agent.jsonl                 — global operation log
    _dev.jsonl                   — dev mode eval log
  <domain>/
    _config/                     — per-domain config
      _index.md                  — page annotations index
      _log.md                    — ingest/lint operation log
    <EntityType>/
      PageName.md                — wiki page
```

See [[src/wiki-path.ts#domainWikiFolder]], [[src/wiki-path.ts#domainIndexPath]].

## Bundled Schemas

`_wiki_schema.md` and `_format_schema.md` are compiled into the plugin (esbuild `.md` text loader from `templates/`) and are the **single source of truth**. New versions ship only via a plugin release.

- **Read at runtime** directly from the bundled constants: ingest, lint, lint-chat, init (`schemaTemplate` = `templates/_wiki_schema.md`), format (`formatSchemaDefault` = `templates/_format_schema.md`).
- **Never written to the vault.** `!Wiki/_config/` holds no schema files; init does not create them and format does not cache them.
- **Migration:** [[src/storage-migration.ts#cleanupBundledSchemaCopies]] runs on plugin load and deletes any stale `!Wiki/_config/_wiki_schema.md` / `_format_schema.md` left by older versions (best-effort). Manual per-vault edits are no longer supported — the trade-off is deterministic, release-driven delivery.
