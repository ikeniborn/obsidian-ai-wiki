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

## Multi-Vector Retrieval

Tests for section-aware chunking, the schema-v2 cache, incremental re-embedding, and max-pool scoring that lifts body-fact recall on both retrieval paths.

### Chunker splits H2 sections

`splitSections` strips frontmatter and the H1 title, emits one unit per H2 section, and folds H3+ content into the parent H2.

### Chunker merges short sections and windows long ones

Sections shorter than `minChars` merge into a neighbour; sections longer than `maxChars` are windowed with `overlapChars` overlap, each window carrying the section heading.

### Chunker caps at maxCount and makes the fold visible

When windows exceed `maxCount`, the first `maxCount - 1` are kept and the rest are folded into one final window whose heading announces the folded count — no silent cap.

### Chunk embed text prepends annotation and heading

`buildChunkInputs` produces a summary chunk equal to the annotation alone and section chunks that prepend the annotation and H2 heading to the window for whole-article grounding.

### Cache v2 round-trips multiple chunks

`refreshCache` writes a `version: 2` cache whose page entry holds one summary chunk plus one section chunk per body section, serialized and parsed without loss.

### Incremental re-embed touches only changed chunks

An unchanged body re-embeds nothing; changing a single section re-embeds exactly that one chunk while summary and other section vectors are reused by hash.

### Max-pool surfaces a body-section match

A page whose only matching vector is a body section outranks a page that matches only on its summary, because page score is the max cosine across the page's vectors.

### Old cache schema loads as null

A pre-v2 `{ vector, hash }` cache is rejected by `loadCache` (returns null, no crash); `refreshCache` discards it and rebuilds as v2.

### Offline Jaccard finds a section keyword

With no API key, the enriched one-line annotation lets `scoreSeed` match a query phrased with a keyword that lives in a body section.

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

## Lint

Integration tests for `runLint` in [[src/phases/lint.ts]] covering the `stripInvalidWikiArticles` cleanup and the `useLlm=false` skip path.

### stripInvalidWikiArticles in lint — plain text stripped

After `runLint`, plain-text `wiki_articles` entries (e.g. `Иммуномодуляторы` without `[[...]]`) in source files are removed by `stripInvalidWikiArticles`.

### useLlm=false skips LLM loop

When `useLlm` is `false`, `runLint` must not invoke `llm.chat.completions.create` at all.

## Ingest

Integration tests for `runIngest` in [[src/phases/ingest.ts]] covering the `stripInvalidWikiArticles` cleanup after ingest.

### stripInvalidWikiArticles in ingest — non-wiki stem stripped

After `runIngest`, `wiki_articles` entries whose stem does not match the `wiki_*` pattern (e.g. `[[ИРС-19]]`) are removed; valid entries like `[[wiki_work_live]]` are kept.

## AgentRunner Idle Watchdog

Unit tests for the idle timeout retry loop in [[src/agent-runner.ts#AgentRunner#run]]. Covers normal completion, one idle retry, and exhausted retries.

### Normal run

When `runOperation` completes before the idle timeout fires, no `system` retry events are emitted. Verifies the happy path produces zero "retrying" messages.

### Idle retry success

When `runOperation` hangs on the first attempt and the idle timer fires, `AgentRunner.run` yields a `system` event matching `LLM idle 5s — retrying (1/3)` and retries; the second call succeeds and yields a `result` event.

### Idle exhausted

When every `runOperation` attempt hangs and `maxRetries` is exhausted, `AgentRunner.run` throws a `DOMException` with message matching `/idle timeout/i`.

### Heartbeat on tool events

When an operation emits `tool_use`/`tool_result` events spaced under the idle threshold but totalling more than it, the idle timer is reset on each event so no retry fires and the final `result` is yielded.

## Vision Temp Store

Unit tests for [[src/phases/vision-temp-store.ts#VisionTempStore]] — per-run caching of vision descriptions and excalidraw PNGs under the plugin directory.

### Description round-trip

`putDescription` then `getDescription` for the same embed path returns the stored description; a missing path returns `null`.

### PNG written to plugin dir

`putPng` writes the decoded bytes to a `.png` file under the run directory, not the vault content tree.

### Cleanup removes run dir

`cleanup` calls the adapter's recursive `rmdir` on the run directory.

### Methods swallow adapter errors

Every store method resolves without throwing when the underlying adapter rejects.

## Format Sentinel Retry

Integration tests for sentinel retry and salvage in `src/phases/format.ts`. Covers the retry loop, retry system prompt content, double failure, truncated-response salvage, and vision embed preservation.

### First attempt fails retry succeeds

When the first LLM response lacks the `<<<FORMATTED>>>` marker, `runFormat` retries once. On success, a `format_preview` event is emitted and no `error` event is produced.

### Retry system prompt contains hint

When `runFormat` retries after a bad sentinel, the retry system prompt must contain the Russian phrase `"Предыдущая попытка не прошла"` followed by the Zod hint, instructing the LLM to correct its output.

### Both attempts fail

When both the initial call and the retry return a bad sentinel (no `<<<FORMATTED>>>` marker), `runFormat` emits an `error` event and no `format_preview`.

### Salvage no END marker

When the LLM response contains `<<<REPORT>>>` and `<<<FORMATTED>>>` but no `<<<END>>>` marker, `runFormat` salvages the partial output. An `info_text` event with "salvage" or "обрезан" in the summary is emitted, and the temp file is still written.

### Vision embed preserved

When vision settings are enabled and the LLM returns a sentinel with vision markers listing an embed path that appears as `![[path]]` in the formatted content, Zod validation succeeds and `format_preview` is emitted.

### Vision resume from temp store

A second `runFormat` sharing the same `VisionTempStore` serves descriptions from the cache and does not call `analyzeSingleAttachment` again; both runs still emit `format_preview`.

## Retrieval Eval Harness

Spec for the standalone retrieval eval harness (`scripts/eval.ts`) pure functions — Recall@k, MRR, gold-set parsing, and the console report formatter. See [[operations#Retrieval Eval Harness]].

### Recall and MRR over a ranked list

`recallAt(ranked, gold, k)` returns `|gold ∩ ranked[0..k)| / |gold|` (0 for empty gold); `mrr(ranked, gold)` returns the reciprocal rank of the first gold hit, or 0 if none appear. `averageLayer` averages both across all gold pairs per k.

### Gold set parsing rejects malformed input

`parseGold` accepts a non-empty JSON array of `{ q, gold }` pairs and throws a descriptive error on an empty set, a missing/empty `q`, an empty `gold` array, or malformed JSON.

### Report table renders metrics and baseline deltas

`formatTable` renders one row per config with the eight `s*/u*` metric cells, and — given a baseline snapshot — annotates each cell with a `▲/▼` signed delta.

## Tier 1 — Graph Health + Hybrid

Specs for the Tier 1 work: reciprocal-rank-fusion hybrid retrieval, ingest-time dedup, and the lint near-duplicate report.

### RRF fuses ranked lists by reciprocal rank

`rrf()` fuses several ranked ID lists by Σ 1/(k+rank); an item ranked high in multiple lists wins, ties break by first-seen, empty lists are ignored. Verifies [[src/rrf.ts#rrf]].

### Hybrid mode fuses dense and jaccard seeds

`PageSimilarityService` in `hybrid` mode fuses the embedding and jaccard rankings via RRF; with no embedding endpoint the dense half degrades to jaccard so the matching page still ranks first.

### Eval harness resolves the hybrid config

`resolveConfigs("hybrid", …)` resolves to a record with `mode: "hybrid"`, carrying bfsDepth and topK, so the eval harness can measure hybrid alongside dense and jaccard.

### Dedup gate scores a candidate against existing pages

`maxSimilarityToExisting()` returns the closest existing page and its score (Jaccard coefficient in jaccard mode, max-pool cosine otherwise), respecting an exclude set and returning a zero score when nothing matches.

### Dedup gate merges a near-duplicate create

When Ingest proposes a new page near-identical to an existing one (score ≥ threshold), the gate runs one LLM merge call and writes the merged content into the existing page instead of spawning a duplicate.

### Lint surfaces near-duplicate page pairs

`pairwiseNearDuplicates()` returns existing page pairs whose max-pool cosine ≥ threshold and skips entirely (reporting the page count) when the vault exceeds the page cap.

## Tier 2 — Query Fusion

Specs for Tier 2: RRF fusion of the vector and graph signals over the seed+BFS union, the seed similarity threshold with Jaccard→LLM fallback, and the eval `dense+rrf` config. All opt-in and default-off. See [[operations#Query#Fusion]].

### Fusion orders the union by vector and graph RRF

`fuseVectorGraph` builds a vector list (union by similarity score desc) and a graph list (hop asc, then backlink inDegree desc) and fuses them with `rrf`; every union page appears in both lists and the result is a permutation of the union. Verifies [[src/fusion.ts#fuseVectorGraph]].

### inDegree counts backlinks per page

`inDegree(graph)` returns the number of incoming links per node — including phantom targets that appear only as link destinations — shared by the graph health check and fusion's tie-break. Verifies [[src/wiki-graph.ts#inDegree]].

### Threshold gate falls back from weak seeds

When the max seed score is below `seedSimilarityThreshold`, `runQuery` falls back to Jaccard seeds; if Jaccard is empty too, seeds stay empty for `llmSelectSeeds`. Branch taken is in `graph_stats.seedFallback`; `0` disables the gate.

### Context ordering follows the fused order

When `bfsFusion` is on, `buildContextBlock` emits pages in the fused order (capped at the page count), skipping ids outside the selection; when off it keeps the seeds-first concat. Verifies [[src/phases/query.ts#buildContextBlock]].

### Eval resolves the dense+rrf config

`resolveConfigs("dense+rrf", …)` resolves to `mode: "embedding"` with `fuse: true`, carrying bfsDepth and topK, so the harness can measure fused retrieval against the dense baseline.

### Eval runner applies the fused order

The eval runner for a `fuse` config applies `fuseVectorGraph` to the union layer, returning a permutation of the plain dense union that still contains the seeds. Verifies [[scripts/eval-retrieval.ts#makeRunner]].
