# Domain Model

A domain is the unit of organization for a knowledge wiki. Each domain has an id, a wiki folder inside `!Wiki/`, a list of source paths, and a set of entity types that guide LLM extraction.

## DomainEntry

Core domain record stored in `!Wiki/.config/_domain.json` via `DomainStore`. Fields: `id`, `name`, `wiki_folder`, `source_paths`, `entity_types`, `language_notes`, `analyzed_sources`.

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

All wiki artifacts live under `!Wiki/<wiki_folder>/`. The `.config/` subdirectory holds metadata files:

```
!Wiki/
  <domain>/
    .config/
      _domain.json       — domain entries list
      _wiki_schema.md    — LLM wiki conventions (vault copy)
      _format_schema.md  — format conventions (vault copy)
      _index.md          — page annotations index
      _agent.jsonl       — operation log (if enabled)
      _dev.jsonl         — dev mode eval log
    <EntityType>/
      PageName.md        — wiki page
```

See [[src/wiki-path.ts#domainWikiFolder]], [[src/wiki-path.ts#domainIndexPath]].

## Vault Schema Variants

`_wiki_schema.md` and `_format_schema.md` exist in two places:

- **Bundled** (`prompts/templates/`): used by init and as fallback.
- **Vault copy** (`!Wiki/<domain>/.config/`): read at runtime by ingest, lint, lint-chat, format.

Changes to the bundled template do not propagate to existing vaults automatically.
