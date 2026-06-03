---
lat:
  require-code-mention: true
---
# Tests

Spec sections that map to test code via `// @lat:` comments. Every leaf section is referenced from at least one test in `tests/`.

## Entity Extraction

Tests that validate LLM #1 extracts entities from the source via `ingest.entities` and `EntitiesOutputSchema`.

### Entities schema accepts minimal entity

The `EntitiesOutputSchema` accepts `{reasoning, entities: [{name}]}` — `name` is the only required entity field.

### Entities schema rejects oversize lists

The `EntitiesOutputSchema` rejects an `entities` array containing more than 50 items.

## Per-Entity Retrieval

Tests that validate `PageSimilarityService.selectByEntities` returns per-entity top-K paths.

### Top-K per entity in embedding mode

All entity queries are sent in one batched POST to `/embeddings`; cosine similarity ranks pages and returns top-K per entity.

### Jaccard fallback on HTTP error

When the embeddings endpoint throws, retrieval falls back to per-entity Jaccard scoring over annotations.

### Empty top-K is not an error

An entity with no annotation matches receives `[]` and is treated by LLM #2 as a create signal — `allFailed` stays false unless the retrieval mechanism itself failed for every entity.

### allFailed false when no pages exist

When the wiki is empty (`allPaths` is `[]`), `jaccardFallbackAll` returns `allFailed: false` — no pages to process is not a failure.

## Merge Handling

Tests that validate `deletes[]` on `WikiPagesOutputSchema` and the delete loop.

### Deletes trigger vault.remove + index cleanup

LLM #2 emitting `deletes` removes the listed pages and strips their lines from `_index.md` via `removeIndexAnnotation`.

### Large-merge warning

When `deletes.length` exceeds `mergeDeleteWarnThreshold`, ingest yields a `Large merge: K deletions` warning `info_text` event.

### Backlinks drop deleted stems

The current source's `wiki_articles` frontmatter list is filtered to remove links pointing at deleted page stems.

## Frontmatter Validation

Tests for [[src/utils/raw-frontmatter.ts#validateAndRepairFrontmatter]] and [[src/utils/raw-frontmatter.ts#validateAndRepairSourceFrontmatter]].

### No-frontmatter passthrough

Content without a frontmatter block is returned unchanged with an empty warnings array.

### Valid frontmatter passthrough

Frontmatter that satisfies all field rules is returned unchanged with an empty warnings array.

### Duplicate key merge

When the same YAML key appears twice, the list items are merged and deduplicated, a single key remains, and a warning naming the key is emitted.

### upsertRawFrontmatter — no duplicate on yaml.stringify indent

When source frontmatter was re-serialized by `yaml.stringify` (which may produce 0-space-indented list items), `upsertRawFrontmatter` must replace the existing `wiki_articles` block cleanly and produce exactly one `wiki_articles:` key.

### Unparseable YAML guard

If the YAML block cannot be parsed, the original content is returned unchanged and a warning prefixed with "Unparseable YAML" is emitted.

### Source invalid date removal

A `wiki_added` or `wiki_updated` value that is not a `YYYY-MM-DD` string is deleted from the frontmatter and a warning containing the field name and "invalid date" is emitted.

### Source invalid wikilink removal

A `wiki_articles` list entry that does not match `[[...]]` is removed from the list and a warning naming the field and the offending value is emitted.

### Source invalid tag removal

A `tags` list entry containing uppercase letters or other invalid characters is removed and a warning naming the field and the offending tag is emitted.

### Source scalar aliases wrap

A scalar `aliases` value is wrapped into a single-element list and a warning naming the field is emitted.

### Source invalid URL removal

An `external_links` entry that does not start with `https://` or `http://` is removed from the list.

### Source related invalid entry removal

A `related` list entry that is not a wikilink is removed from the list.

### filterStaleWikiLinks — stale wiki_articles removed

`[[Foo]]` where `Foo` is absent from `existingStems` is removed from the `wiki_articles` field and a warning `"wiki_articles: stale link [[Foo]] — removed"` is emitted.

### filterStaleWikiLinks — live wiki_articles kept

`[[Bar]]` where `Bar` is present in `existingStems` is left unchanged and no warning is emitted.

### filterStaleWikiLinks — related stale removed

`[[Foo]]` absent from `existingStems` is removed from the `related` field and a warning `"related: stale link [[Foo]] — removed"` is emitted.

### filterStaleWikiLinks — wiki_outgoing_links stale removed

`[[Foo]]` absent from `existingStems` is removed from the `wiki_outgoing_links` field and a warning is emitted.

### filterStaleWikiLinks — non-wikilink entries untouched

An entry that does not match `[[...]]` (e.g., a plain string) in a targeted field is not removed by `filterStaleWikiLinks` — format validation is `validateAndRepairFrontmatter`'s responsibility.

### filterStaleWikiLinks — empty existingStems removes all

When `existingStems` is an empty `Set`, all valid wikilink entries in targeted fields are removed.

### filterStaleWikiLinks — no frontmatter passthrough

Content without a frontmatter block is returned unchanged with an empty warnings array.

### Source body preservation

Invalid frontmatter fields are repaired but body content referencing those field names as plain text is preserved unchanged.

### Source path-style wikilink removal

Entries in `wiki_articles` that contain `/` or end with `.md]]` are path-style links, not stems. They are removed and a warning is emitted. Valid stem links like `[[wiki_valid]]` are kept.

### Source path-style dot-md wikilink removal

Entries in `wiki_articles` ending with `.md]]` (e.g. `[[procedures/file.md]]`) are rejected even if they pass the basic `[[...]]` test, because they reference a path, not a stem.

### Source forbidden wiki field removal

Fields like `wiki_outgoing_links`, `wiki_sources`, `wiki_status`, `wiki_type`, `wiki_external_links` belong to wiki pages only. When present in source frontmatter, they are removed silently with a warning.

### Source forbidden wiki_sources removal

`wiki_sources` in source frontmatter (files outside `!Wiki/`) is a wiki-page-only field and must be stripped.

### Source forbidden annotation removal

`annotation` is a wiki-page-only field and must be stripped from source file frontmatter.

### stripInvalidWikiArticles — plain text removed

Verifies that a plain-text (non-wikilink) entry in wiki_articles is removed and a warning is emitted.

### stripInvalidWikiArticles — non-wiki stem removed

Verifies that a `[[ИРС-19]]`-style wikilink with a non-`wiki_*` stem is removed and a warning is emitted.

### stripInvalidWikiArticles — absent wiki stem removed

Verifies that a valid `wiki_*` stem not present in existingWikiStems is removed and a warning is emitted.

### stripInvalidWikiArticles — present wiki stem kept

Verifies that a valid `wiki_*` stem present in existingWikiStems is kept and no warning is emitted.

### stripInvalidWikiArticles — other fields untouched

Verifies that fields other than wiki_articles (title, body) are not modified by stripInvalidWikiArticles.

### stripInvalidWikiArticles — empty wiki_articles noop

Verifies that an empty wiki_articles field causes no modification and no warnings are emitted.

## Wiki Page Frontmatter Validation

Tests for [[src/utils/raw-frontmatter.ts#validateAndRepairWikiPageFrontmatter]] covering wiki page-specific fields.

### Wiki sources invalid entry removal

A `wiki_sources` list entry that is not a wikilink `[[...]]` is removed and a warning naming the field is emitted.

### Wiki updated invalid date removal

A `wiki_updated` value that is not a `YYYY-MM-DD` string is deleted from the frontmatter and a warning containing the field name and "invalid date" is emitted.

### Wiki status invalid value warning

A `wiki_status` value not in `[stub, developing, mature]` emits a warning but the field is left unchanged in the output.

### Wiki tags invalid entry removal

A `tags` list entry containing spaces or other invalid characters is removed from the list.

### Wiki outgoing links invalid entry removal

A `wiki_outgoing_links` list entry that is not a wikilink is removed from the list.

### Wiki outgoing links non-wiki stem removed

A `wiki_outgoing_links` entry whose stem does not match the `wiki_<domain>_<slug>` pattern is removed and a warning naming the field and "non-wiki stem" is emitted.

### Wiki outgoing links valid wiki stem kept

A `wiki_outgoing_links` entry whose stem matches `wiki_<domain>_<slug>` is preserved unchanged with no warnings.

### Wiki outgoing links mixed list partial removal

A `wiki_outgoing_links` list containing a mix of valid wiki stems and non-wiki stems is filtered to keep only the valid wiki stems.

### Wiki sources wiki stem removed

A `wiki_sources` entry whose stem matches `wiki_<domain>_<slug>` (a wiki page, not a source file) is removed and a warning naming the field and "wiki stem" is emitted.

### Wiki sources valid source stem kept

A `wiki_sources` entry whose stem does not match the wiki pattern is preserved unchanged with no warnings.

### Wiki external links invalid entry removal

A `wiki_external_links` entry that does not start with `https://` or `http://` is removed from the list.

### Wiki scalar aliases wrap

A scalar `aliases` value on a wiki page is wrapped into a single-element list.

### Annotation field strip

A wiki page with `annotation:` in its frontmatter has the field removed by `validateAndRepairWikiPageFrontmatter`. The warnings array includes an entry containing "annotation".

## Ensure Wiki Sources

Tests for [[src/utils/raw-frontmatter.ts#ensureWikiSources]] covering the three injection scenarios.

### Absent wiki_sources injected

When `wiki_sources` is absent from frontmatter, `ensureWikiSources` returns `injected: true` and the output contains `[[sourceStem]]`.

### Non-empty wiki_sources unchanged

When `wiki_sources` is present and non-empty, `ensureWikiSources` returns `injected: false` and content is unchanged.

### Empty wiki_sources after repair injected

When the content reaching `ensureWikiSources` has no `wiki_sources` field (e.g., repair deleted all entries), `ensureWikiSources` injects `[[sourceStem]]` and returns `injected: true`.

## Ingest Pipeline Frontmatter Fixes

Integration tests for [[src/phases/ingest.ts]] verifying the repair-then-inject pipeline applied to each page during write.

### wiki_sources injected when absent

When the LLM emits a page without `wiki_sources`, the written page has `wiki_sources` containing `[[sourceStem]]` derived from the source file name.

### annotation stripped during ingest

When the LLM emits a page with `annotation:` in frontmatter, the written page does not contain `annotation:`.

## Lint Stale Link Cleanup

Integration tests that verify `runLint` in `src/phases/lint.ts` removes stale links via `filterStaleWikiLinks` after the per-article loop.

### Stale wiki_outgoing_links cleanup

A wiki page with `wiki_outgoing_links` pointing at a page that no longer exists in the vault is rewritten after lint to drop the dead entry while keeping live links.

### Stale wiki_articles cleanup in sources

A source file with `wiki_articles` pointing at a deleted wiki page stem is rewritten after lint to remove the stale entry while keeping references to pages that still exist.

### Empty-sources wiki page deletion

A wiki page whose only `wiki_sources` entry is stale (stem not in vault) is deleted after the per-article loop. The referencing source file's stale `[[wikiStem]]` in `wiki_articles` is removed by the `deletedRefs` backlink-rewrite pass.

## validateWikiSources Unit Tests

Unit tests for the `validateWikiSources` function in `src/phases/lint.ts`, verifying that the `originalContent` restore logic correctly recovers valid entries dropped by the LLM.

### LLM collapsed to inline empty — valid entry restored

When the LLM returns `wiki_sources: []` (inline) but `originalContent` had a valid entry, `validateWikiSources` replaces the inline form with a block list containing the missing entry.

### LLM reduced list — missing valid entry restored

When the LLM drops one of two valid entries from `wiki_sources`, the missing entry is re-added so both valid entries appear in the result.

### LLM dropped stale entry — not restored

When the LLM drops a `wiki_sources` entry whose stem is absent from `knownStems` and `titleMap`, that entry is not restored.

### Empty originalContent — no restore

When `originalContent` is `""`, no entries are restored; existing stale-removal logic still removes invalid entries from the LLM-returned content.

### Wiki page stem in wiki_sources — rejected

A `wiki_sources` entry whose stem is present in `wikiStems` (wiki page stems) is removed even if it also appears in `knownStems`. Wiki pages are not valid sources.

### Wiki page stem in original — not restored

When `originalContent` had a `wiki_sources` entry whose stem is in `wikiStems`, the LLM's omission is not restored. Wiki page stems must not be re-injected by the restore pass.

## Lint Bucket Repair

Integration tests that verify `runLint` detects and repairs wrong-bucket stems in wiki page frontmatter — wiki stems in `wiki_sources` and source stems in `wiki_outgoing_links` — before the LLM pass.

### Wiki stem in wiki_sources repaired

A wiki page whose `wiki_sources` list contains a `wiki_*` stem (which belongs in `wiki_outgoing_links`) is rewritten to remove the misplaced stem, and an `info_text` event mentioning "wiki stem" is emitted.

### Source stem in wiki_outgoing_links repaired

A wiki page whose `wiki_outgoing_links` list contains a non-`wiki_*` stem (which belongs in `wiki_sources`) is rewritten to remove the misplaced stem, and an `info_text` event mentioning "non-wiki stem" is emitted.

## Init Reinit

Tests for the `--force` reinit path in `runInit`, which wipes and re-analyzes an existing domain.

### Reinit does not clear language_notes

The `domain_updated` wipe patch emitted at the start of reinit must not include `language_notes`. Domain descriptions are authored, not extraction artifacts, so they must survive reinit.

## Stop Rules

Tests that validate halt conditions.

### Halt on entity extraction failure

`parseWithRetry` exhaustion on `ingest.entities` halts the run with an error event and an empty result.

### Halt on all-entity retrieval failure

When `selectByEntities` returns `allFailed: true` and both entities and `nonMetaPaths` are non-empty, ingest halts before invoking LLM #2.

### BFS not invoked

`graphCache.get` is never called from the ingest path — the test spies on the cache and asserts zero calls.

## Controller Format Cleanup

Tests for `formatApply` post-processing: forbidden wiki_* field stripping and path-style wikilink removal after LLM format.

### formatApply strips forbidden wiki fields

After `formatApply`, any forbidden fields the LLM may have added (e.g. `wiki_outgoing_links`) are removed from the written output. Original wiki tracking fields are preserved.

### formatApply strips path-style wiki_articles entries

After `formatApply`, any `wiki_articles` entries from the original that are path-style wikilinks (containing `/`) are removed from the written output. Valid stem entries are kept.
