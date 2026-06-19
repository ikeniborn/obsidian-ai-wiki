# Domain Model

A domain is the unit of organization for a knowledge wiki. Each domain has an id, a wiki folder inside `!Wiki/`, a list of source paths, and a set of entity types that guide LLM extraction. See [[architecture]].

## DomainEntry

Core domain record stored in `!Wiki/_config/_domain.json` via `DomainStore` (`src/domain-store.ts`). Fields: `id`, `name`, `wiki_folder`, `source_paths`, `entity_types`, `language_notes`, `analyzed_sources`. Type defined in `src/domain.ts`.

## EntityType

Describes a category of knowledge entities the LLM should extract during ingest. Fields: `type`, `description`, `extraction_cues`, optional `min_mentions_for_page`, optional `wiki_subfolder`.

Entity types are initialized by [[operations#Init]], refined incrementally by [[operations#Ingest]] (via `entity_types_delta`), and re-synchronized by [[operations#Lint]] (via `actualizeDomainConfig`). Merge logic in `src/domain.ts#mergeEntityTypes`.

## Domain Events

Domain state changes are communicated as `RunEvent` variants and applied by the controller via `applyDomainEvent` (`src/domain.ts`).

| Event | Trigger | Effect |
|---|---|---|
| `domain_created` | init bootstrap | Adds new DomainEntry |
| `domain_updated` | ingest delta, lint patch | Merges patch into entry |
| `source_path_added` | ingest new source | Appends to source_paths |

## Wiki Folder Layout

All wiki artifacts live under `!Wiki/`. Global config in `!Wiki/_config/`; per-domain config in `!Wiki/<domain>/_config/`. Path helpers in `src/wiki-path.ts`.

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

## Wiki Stem Mask

Every wiki page filename stem must match `wiki_<domain.id>_<entity_slug>` in lowercase snake_case (e.g. `wiki_work_neural_networks.md`). Centralized in `src/wiki-stem.ts`.

This disambiguates wiki pages from source files in `source_paths` and across domains (`foo` in `work` vs `personal` never collide). `slugifyEntity` NFD-normalizes, ASCII-collapses, splits camelCase, and lowercases; `buildWikiStem`, `stemRegex`, and `GENERIC_WIKI_STEM_REGEX` build and validate stems. Enforced at four layers — see [[operations#Wiki Stem Mask + Collision Guard]].

The one-shot vault migration renaming legacy unprefixed pages and rewriting backlinks lives in `src/migrate-wiki-prefix.ts` (CLI `scripts/migrate-wiki-prefix.ts`, via `npm run migrate:wiki-prefix`). It also lowercases already-prefixed stems and sets `pageNameVersion = 1` for idempotency.

## Bundled Schemas

`_wiki_schema.md` and `_format_schema.md` are compiled into the plugin (esbuild `.md` text loader from `templates/`) and are the single source of truth. New versions ship only via a plugin release.

- **Read at runtime** directly from bundled constants by ingest, lint, lint-chat, init (`schemaTemplate`) and format (`formatSchemaDefault`).
- **Localized headings.** `_wiki_schema.md` carries a `{{section_conventions}}` placeholder; the four wiki-generating phases render it via `src/phases/llm-utils.ts#wikiSections` with `resolveLang(opts.outputLanguage)`, emitting mandatory/optional page headings in the resolved content language. `wikiSections` takes a concrete `ru|en|es`; `auto` resolves to the Obsidian UI locale (matching the reply-language directive — see [[backends-and-config#Three-Layer Resolution]]), not a fixed Russian fallback. Instruction text stays English. The page schema is one mandatory section (key characteristics) plus four optional ones (usage, examples, limitations, best practices); the former related-concepts and change-history sections are no longer generated — see [[domain-model#Legacy Section Removal]].
- **Never written to the vault.** `!Wiki/_config/` holds no schema files. `cleanupBundledSchemaCopies` deletes stale copies left by older versions on load. See [[architecture#Storage Migration]].

## Legacy Section Removal

The related-concepts and change-history sections were dropped from the page schema because each H2 becomes its own embedding chunk (see [[retrieval#Embedding Cache]]) and these two only ever matched off-topic queries — pure index noise.

`src/strip-legacy-sections.ts` holds the pure logic, reused by both the migration and its eval:
- `stripLegacySections(content)` removes the two H2 sections in all three languages (ru/en/es), from each heading to the next H2 or EOF, preserving frontmatter, H1, intro, and every other section; idempotent.
- `extractRelatedLinks(content)` collects `[[links]]` inside the related-concepts section.
- `addOutgoingLinks(content, links)` unions those links into `wiki_outgoing_links` frontmatter (no-op when all already present).

`src/migrate-drop-sections.ts#migrateDropSections` runs once on load (after `migrateIndexFormat`, guarded by the `migrated_drop_sections` flag in `local.json`). For every domain wiki page it lifts related-section links into frontmatter, then strips both sections. The union is a safety-net: the graph reads `[[links]]` from the whole body (`src/wiki-graph.ts#buildWikiGraph`), so links must reach frontmatter before the section is removed or a graph edge would be lost. No embedding calls happen here — the embeddings cache self-heals on the next ingest/lint, since `refreshCache` (see [[retrieval#Embedding Cache]]) diffs chunks by content hash and drops the now-absent noise chunks. Verified out-of-vault by `eval/legacy-sections/run.ts`.

## Frontmatter Validator

Shared utility (`src/utils/raw-frontmatter.ts`) that detects and repairs malformed frontmatter before ingest writes wiki fields. Parses via `yaml.parse`, applies per-field `FieldRule`s, re-serializes. Returns content unchanged when no repairs needed.

Duplicate YAML keys are pre-merged by regex; unparseable YAML is returned as-is with a warning; field rules strip invalid entries and record a warning per violation. `validateAndRepairSourceFrontmatter` applies `SOURCE_RULES`; `validateAndRepairWikiPageFrontmatter` applies `WIKI_PAGE_RULES`. Bucket kinds `list-wikilinks-wiki-only` / `list-wikilinks-sources-only` enforce that `wiki_outgoing_links` holds only wiki stems and `wiki_sources` rejects them.
