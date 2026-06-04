# Operations

The seven operations available in AI Wiki. Each maps to a phase function and produces specific artifacts. Prompt dependencies are documented in `docs/prompt-architecture.md`.

## Init

Bootstraps a new domain. File 0 calls `parseWithRetry` with `DomainEntrySchema` to produce `id`, `name`, `wiki_folder`, `entity_types`, `language_notes`. Subsequent files run as ingest passes.

Creates `_wiki_schema.md`, `_format_schema.md`, `DomainEntry`. See [[src/phases/init.ts]], [[llm-pipeline#parseWithRetry]].

### Reinit (--force)

Re-runs init on an existing domain, wiping the wiki folder first.

`wipeDomainFolder` removes all files then calls `removeSubfolders` to delete subdirectories (skipping locked entries). The wipe patch resets `entity_types` and `analyzed_sources` but preserves `language_notes`. See [[src/phases/init.ts#wipeDomainFolder]], [[architecture#VaultTools]].

## Ingest

Two-call entity-driven flow. LLM #1 extracts entities from the source. Per-entity vector top-K over `_index.md` annotations selects existing pages. LLM #2 emits writes, optional `deletes` for merges, and `entity_types_delta`.

See [[src/phases/ingest.ts]], [[domain#DomainEntry]].

### Entity Extraction

LLM #1 uses `callSite: "ingest.entities"` with `EntitiesOutputSchema` (`{reasoning, entities: [{name, type?, context_snippet?}]}`). `parseWithRetry` validates; exhausted retries halt the run with an error event and empty result. See [[src/phases/ingest.ts]], [[llm-pipeline#parseWithRetry#Call Sites]].

Entities without a matching domain type are returned without `type`; synthesis assigns the type via `entity_types_delta`.

### Per-Entity Retrieval

After extraction, `PageSimilarityService.selectByEntities` runs per-entity top-K over `_index.md` annotations. The union of all per-entity hits is the existing-pages context for LLM #2 — BFS is not used.

In `embedding` mode, all entity queries are sent in one batched POST to `/embeddings`; page-annotation vectors are fetched in additional batches (up to 100 per call) for any pages not yet in `_embeddings.json`. Cache hits skip the page fetch entirely. Cosine similarity then ranks pages per entity. In `jaccard` mode (or after an embedding HTTP error), per-entity Jaccard scoring over annotations selects the top-K. `allFailed` is true only when `allPaths.length > 0 && !anySuccess` — an empty wiki (`allPaths = []`) is not a failure. If `selectByEntities` returns `allFailed: true` and both entities and `nonMetaPaths` are non-empty, ingest halts before invoking LLM #2. An empty top-K for an entity is not an error — LLM #2 treats it as a create signal. See [[src/page-similarity.ts#PageSimilarityService]], [[architecture#PageSimilarityService]].

### LLM Progress Step

Both calls emit progress events. LLM #1 emits `tool_use name: "Extracting entities"` (preview: entity count on success). LLM #2 emits `tool_use name: "Synthesising pages"` (preview: `"N pages · ~Xk tokens sent"`). See [[llm-pipeline#LLM Progress Events]].

### Per-page Progress Events

Before writing each wiki page, ingest emits `tool_use` with `name: "Create"` for new pages or `name: "Update"` for existing ones. Error-path yields (blocked/invalid paths) keep `name: "Write"`.

For each entry in `deletes`, ingest emits `tool_use name: "Delete"` followed by `tool_result` — `ok: true` on success, `ok: false` with an "outside wiki folder" preview when the path escapes the wiki root.

### Wiki Stem Mask + Collision Guard

Every wiki page filename stem must match `wiki_<domain.id>_<entity_slug>` in lowercase snake_case (e.g. `wiki_work_neural_networks.md`).

This disambiguates wiki pages from source files in `domain.source_paths` (no `[[NFS]]` ambiguity) and across domains (`foo` in `work` vs `personal` never collide). Enforced at four layers:

1. **Zod schema** — [[src/phases/zod-schemas.ts#WikiPageSchema]] runs `GENERIC_WIKI_STEM_REGEX` from [[src/wiki-stem.ts]] on every emitted page path stem. Unprefixed stems are rejected during structured parsing.
2. **Prompt** — `prompts/ingest.md` instructs LLM #2 to emit `wiki_{{domain_id}}_<EntitySlug>` paths and is given a list of forbidden stems via `{{forbidden_stems_block}}` — the basenames of files in `domain.source_paths`, collected by [[src/phases/ingest.ts#collectSourceStems]].
3. **Runtime guard** — after path validation, [[src/phases/ingest.ts]] re-checks each emitted page stem against `stemRegex(domain.id)` and the source-stem set. Violations yield `tool_result ok:false` with a stem-specific preview and skip the page.
4. **Migration** — [[scripts/migrate-wiki-prefix.ts]] (logic in [[src/migrate-wiki-prefix.ts]]) renames legacy unprefixed wiki pages, rewrites backlinks across page bodies, `_index.md`, `_log.md`, `_embeddings.json` keys, and source `wiki_articles`, and bumps `DomainEntry.pageNameVersion` to `1` so re-runs are no-ops. Until a domain is migrated (`pageNameVersion < 1`), ingest deletes legacy unprefixed pages via `vaultTools.remove` before LLM #2 and emits an `info_text` summary reporting the count deleted (only `.md` files in the wiki folder; meta files like `_index.md`, `_log.md`, `_embeddings.json`, and anything under `_config/` are excluded).

**Check B — missing wiki_sources cleanup.** After populating `existingPages`, ingest filters out any pages whose content does not contain a `wiki_sources:` field in frontmatter. These are considered structurally invalid regardless of their filename. Each is removed via `vaultTools.remove`, deleted from the `existingPages` map so LLM #2 receives no stale context, and a single `info_text` event is emitted with the count and paths (up to 10). See [[src/phases/ingest.ts]].

### Result Summary

After writes and deletes, ingest emits a result text broken down by action. Three terms are possible: `создано C, обновлено U, объединено M`.

Nonzero terms are joined with commas in that order. The `стр.` suffix is appended only when exactly one term is nonzero (e.g. `создано 3 стр.`). Zero-write runs report no changes.

### Merge Handling

When LLM #2 emits `deletes[]` on `WikiPagesOutputSchema`, ingest removes each listed page via `vaultTools.remove` and strips its line from `_index.md` via [[src/wiki-index.ts#removeIndexAnnotation]].

The current source's `wiki_articles` frontmatter list is filtered to drop links pointing at deleted page stems before new wiki links are merged in. When `deletes.length` exceeds `mergeDeleteWarnThreshold` (default 5, configurable via `LlmCallOptions.mergeDeleteWarnThreshold`), ingest yields a `Large merge: K deletions` `info_text` warning before processing the deletes. Deleted pages are logged as `УДАЛЕНА` entries in the wiki log. See [[src/phases/ingest.ts]].

### entity_types_delta

When the ingest LLM response includes `entity_types_delta`, the runner merges it into the current `entity_types` via `mergeEntityTypes` and emits `domain_updated`. The controller persists the patch.

`domain_updated` is emitted after `source_path_added` — event order: `assistant_text` → source write → `source_path_added` → `domain_updated`.

## Query

Two-phase retrieval: seed selection from `_index.md` annotations, then BFS expansion over the wiki graph. Similarity (embedding or Jaccard) selects seeds; graph traversal expands coverage.

See [[src/phases/query.ts]], [[wiki-graph#Query Graph Traversal]].

### Seed Selection

Seeds are wiki page IDs most relevant to the question. Both embedding and Jaccard paths capture `seedScores: Record<string, number>` for tracing.

If seed selection yields nothing, `llmSelectSeeds` asks the LLM to pick from all annotated page IDs. See [[src/wiki-seeds.ts#selectSeeds]], [[src/phases/query.ts#llmSelectSeeds]], [[src/page-similarity.ts#PageSimilarityService]].

### BFS Expansion

BFS always runs from the seed set — both when seeds come from similarity and from Jaccard. All wiki pages are read to build the graph; only BFS-expanded pages are passed to the LLM. The graph is undirected — `A → [[B]]` allows traversal B→A.

`bfsExpandRanked` wraps BFS with a similarity/Jaccard ranking pass. Non-seed pages are ranked and capped at `bfsTopK` (setting, default 10). Seeds are always included. The `graph_stats` event emits `seedScores`, `expandedPages` (BFS-added IDs excluding seeds), and `expandedScores` (similarity or Jaccard score per expanded page) for tracing. When fallback to full BFS occurs, `expandedScores` is empty.

Forward traversal guards against phantom nodes: `[[links]]` whose targets have no corresponding page are never added to the expanded set. Files under any `_config/` subdirectory are excluded before graph construction.

See [[src/wiki-graph.ts#bfsExpandRanked]], [[wiki-graph#Query Graph Traversal]].

### Answer Generation

System prompt loaded from `prompts/query.md`. Injected variables: `domain_name`, `entity_types_block`, `index_block`. User message contains `Вопрос: {question}` followed by the context block of selected wiki pages.

The prompt enforces: inline `[[WikiLink]]` references per fact (not a trailing sources block), code/commands in backticks or fenced blocks with language tag, section headers only when answer covers multiple topics, no filler phrases.

### Query Trace UI

When `agentLogEnabled` is true, the `graph_stats` event is rendered with scores and BFS-by-hop breakdown in multi-line trace format. When false, compact single-line form is shown instead.

Trace format (agentLogEnabled): `Seeds (N)` header, each seed with score on its own indented line, then `BFS expanded (N):` with each expanded page and its score on its own indented line.

The formatting is handled by [[src/view.ts#formatGraphStatsLines]], a pure function testable without Obsidian DOM APIs.

## Lint

Analyzes wiki pages for a domain one article at a time. For each article selects a limited context set via `PageSimilarityService` + BFS graph expansion, then calls the LLM. Results are merged into `LintOutputSchema`.

Before the per-article loop, lint pre-builds a title map from non-wiki vault files. `buildTitleMap` reads H1 headings (or `title:` frontmatter) from each file and stores a lowercase-title → stem mapping. Title-derived stems are added to `knownStems` so `[[Title-based links]]` in `wiki_sources` are not falsely removed.

Per-article loop:
1. `selectRelevant(articleContent, annotations, otherPaths)` → top-K paths
2. `bfsExpand([articleId, ...topKIds], graph, depth=1)` → expanded page set
3. LLM call with article + context → `{ report, fixes[], deletes[] }`
4. Apply fixes: `fixWikiLinks` per-step, then `validateWikiSources` guards `wiki_sources` against false-positive removals by the LLM — entries are kept if resolvable by filename stem OR page title. Write to vault, update `pages` and `annotations` in-memory.
5. Process `deletes`: `vaultTools.remove`, rewrite `[[deleted]]` links in wiki pages
6. Rebuild graph (`graphCache`) + refresh vectors (`similarity.refreshCache`)

See [[src/phases/lint.ts#buildTitleMap]], [[src/phases/lint.ts#validateWikiSources]].

### Lint Options

`runLint` accepts two optional parameters to customize lint behavior:

- **`useLlm: boolean = true`** — when `false`, skips the per-article LLM loop and `actualizeDomainConfig` entirely. Lint operates in programmatic-only mode: `cleanupInvalidPages` runs, then sources are not backlinked. This mode is significantly faster for analyzing large wikis without semantic review. Suitable for batch validation or when domain configuration is already stable.
- **`entityTypeFilter: string[] = []`** — when non-empty, filters `articlePaths` to only wiki pages whose subfolder path matches a requested entity type (e.g. `['Person', 'Concept']`). Empty means process all article paths. Allows targeted linting of specific entity classes without full-domain scans.

After all articles:
- Post-loop empty-sources deletion — wiki pages in `writtenPaths` with zero `wiki_sources` entries after `validateWikiSources` are deleted; their stems are pushed into `deletedRefs` so the backlink rewrite removes their `wiki_articles` entries from source files.
- Source-file backlink rewrite (vault-wide scan for deleted article refs, skipping wiki pages)
- `actualizeDomainConfig` — syncs `entity_types` from final wiki content
- Backlink sync — writes `wiki_articles` into source files via `wiki_sources`
- `appendWikiLog`

Emits `info_text "Checking i/N: ArticleName"` per article. Skipped articles (LLM error) reported at end.

`LintOutputSchema.deletes` carries `{ path, redirect_to? }` for duplicate merges. See [[src/phases/lint.ts]], [[llm-pipeline#LLM Progress Events]], [[architecture#PageSimilarityService]].

### Lint Modal UI

`LintOptionsModal` takes the pre-selected domain from the sidebar — the lint button is disabled when no domain is selected, so there is no "all" case.

Constructor: `(app, domain: DomainEntry, defaultUseLlm, articleCounts: Map<string, number>, onSubmit)`. Article counts are computed by the sidebar before opening the modal: for each entity type with a `wiki_subfolder`, count `.md` files under `wiki_folder/wiki_subfolder/`.

Layout (top to bottom): title `h3`, Use LLM toggle, `"Entity types:"` paragraph, **[Убрать все] [Добавить все]** button row, entity type toggles with muted `(N)` count spans, `▶ Run` button. `ToggleComponent[]` refs are stored locally so the select-all/deselect-all buttons can sync both DOM state and `entityTypeFilter` in one click.

Submit passes `{ useLlm, entityTypeFilter: [...] }` — the domain ID is implicit (caller captures `domainEntry.id` in the closure). See [[src/modals.ts#LintOptionsModal]].

### Cleanup Pass

Before the Glob step, lint runs `cleanupInvalidPages` to remove stale or malformed pages. Files starting with `_` are skipped. A `step` event is emitted when pages are deleted.

A page is deleted if its stem fails `GENERIC_WIKI_STEM_REGEX` (wrong prefix/format) or its frontmatter lacks `wiki_sources`.

See [[src/phases/lint.ts#cleanupInvalidPages]].

### Backlink Sync

After writing fixed pages, lint syncs `wiki_articles` backlinks into source files. For each wiki page with `wiki_sources`, it resolves each source to a vault path and appends the wiki page as `[[WikiPageName]]` into the source file's `wiki_articles` field.

`wiki_sources` uses bare names (`[[FileName]]`). Lint builds a `stemToPath` map from all vault `.md` files (via `vaultTools.listFiles("")`) to resolve bare names to vault paths. Legacy path-style entries (containing `/`) are used as-is for backward compatibility. See [[src/phases/lint.ts]].

## Lint-Chat

Interactive fix pass driven by a lint report. The user provides an instruction; the LLM returns `LintChatSchema` with updated page contents. Pages are written back to the vault.

Emits `tool_use name: "Glob"` (file list) and `tool_use name: "Read"` (page load) before any I/O so the UI shows activity immediately. Before the LLM call emits `tool_use name: "Applying fixes"`; `tool_result` on success shows page count. `parseWithRetry` events are forwarded after success or failure. See [[src/phases/lint-chat.ts]], [[llm-pipeline#LLM Progress Events]].

## Chat

Free-form conversation after any operation. Takes `context` (last operation result) and `chatMessages` history. On claude-agent backend, sessions resume via `sessionId` for multi-turn continuity.

See [[src/phases/chat.ts]].

## Format

Reformats a non-wiki markdown page without changing facts. LLM returns `FormatOutputSchema` with `report` and `formatted`. Preview is written to a temp file; user applies or cancels via sidebar.

Iterative refinement via `formatRefine`. On claude-agent, vision is enabled. See [[src/phases/format.ts]], [[src/controller.ts#WikiController#format]].
