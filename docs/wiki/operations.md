# Operations

The seven operations available in AI Wiki. Each maps to a phase function in `src/phases/` and produces specific vault artifacts. See [[architecture#Phase Functions]] and [[index#What it does]].

## Init

Bootstraps a new domain (`src/phases/init.ts`). File 0 calls `parseWithRetry` with `DomainEntrySchema` to produce `id`, `name`, `wiki_folder`, `entity_types`, `language_notes`. Subsequent files run as ingest passes.

Creates the `DomainEntry` and per-domain `_config`. Wiki/format schema conventions are bundled into the plugin, not written to the vault — see [[domain-model#Bundled Schemas]].

### Reinit (--force)

Re-runs init on an existing domain, wiping the wiki folder first. `wipeDomainFolder` removes all files then calls `removeSubfolders` to delete subdirectories (skipping locked entries). The wipe patch resets `entity_types` and `analyzed_sources` but preserves `language_notes`.

## Ingest

Two-call entity-driven flow (`src/phases/ingest.ts`). LLM #1 extracts entities from the source; per-entity vector top-K over `_index.md` annotations selects existing pages; LLM #2 emits writes, optional `deletes` for merges, and `entity_types_delta`. See [[domain-model#DomainEntry]].

### Entity Extraction

LLM #1 uses `callSite: "ingest.entities"` with `EntitiesOutputSchema` (`{reasoning, entities: [{name, type?, context_snippet?}]}`). `parseWithRetry` validates; exhausted retries halt the run with an error event and empty result. Entities without a matching domain type are returned without `type`; synthesis assigns it via `entity_types_delta`. See [[llm-pipeline#Call Sites]].

### Per-Entity Retrieval

After extraction, `PageSimilarityService.selectByEntities` runs per-entity top-K over `_index.md` annotations — the union of all per-entity hits is the existing-pages context for LLM #2 (BFS is not used). See [[retrieval#PageSimilarityService]].

In `embedding` mode, all entity queries go in one batched POST to `/embeddings`; missing page-annotation vectors are fetched in batches (up to 100 per call); cache hits skip the fetch. In `jaccard` mode, per-entity Jaccard scoring over annotations selects top-K. `allFailed` is true only when paths exist but none succeed — an empty wiki is not a failure. An empty top-K for an entity is a create signal, not an error.

### Wiki Stem Mask + Collision Guard

Every wiki page filename stem must match `wiki_<domain.id>_<entity_slug>` in lowercase snake_case. Enforced at four layers. See [[domain-model#Wiki Stem Mask]].

1. **Zod schema** — `WikiPageSchema` runs `GENERIC_WIKI_STEM_REGEX` on every emitted page path stem; unprefixed stems are rejected during structured parsing.
2. **Prompt** — `prompts/ingest.md` instructs LLM #2 to emit `wiki_{{domain_id}}_<EntitySlug>` paths and is given forbidden stems (source-file basenames) via `{{forbidden_stems_block}}`.
3. **Runtime guard** — after path validation, ingest re-checks each emitted stem against `stemRegex(domain.id)` and the source-stem set; violations yield `tool_result ok:false` and skip the page.
4. **Migration** — `src/migrate-wiki-prefix.ts` renames legacy unprefixed pages, rewrites backlinks, and bumps `pageNameVersion` to 1 so re-runs are no-ops.

**Check B — missing wiki_sources cleanup.** After populating `existingPages`, ingest removes pages whose frontmatter lacks a `wiki_sources:` field (structurally invalid regardless of filename), deletes them from the in-memory map so LLM #2 gets no stale context, and emits one `info_text` with the count.

### Merge Handling

When LLM #2 emits `deletes[]`, ingest removes each listed page via `vaultTools.remove` and strips its line from `_index.md` via `removeIndexAnnotation`. Each delete path is validated before removal to block path traversal: any `..`/`.` segment or a path failing `validateArticlePath` (must be `<domain>/<file>.md` inside the wiki folder) is rejected.

When `deletes.length` exceeds `mergeDeleteWarnThreshold` (default 5), ingest yields a `Large merge: K deletions` warning. Deleted pages are logged as `УДАЛЕНА` in the wiki log. The source's `wiki_articles` is filtered to drop links pointing at deleted stems before new links merge in.

When the source frontmatter is broken, `runIngest` recovers it via `recoverSourceFrontmatter` (`src/utils/raw-frontmatter.ts`) before reading `wiki_added`/`wiki_articles` and upserting the backlinks. It tolerates the shapes seen in the wild: fully unfenced keys, duplicate keys (e.g. two `wiki_updated:` lines), block-list `wiki_articles`, and `wiki_*` keys stranded in the body after a leading fence. It merges the leading fenced YAML with the stray frontmatter run (dedup last-wins, list items kept), strips those lines from the body, and re-serialises a single `---` block — so the existing creation date and accumulated backlinks are recovered instead of being reset to today or dropped. A page already valid (or with no frontmatter) is returned unchanged, so the recovery is idempotent.

### Result Summary

After writes and deletes, ingest emits a result text broken down by action: `создано C, обновлено U, объединено M`. Nonzero terms are joined with commas in that order; the `стр.` suffix is appended only when exactly one term is nonzero. Zero-write runs report no changes.

### entity_types_delta

When the ingest response includes `entity_types_delta`, the runner merges it into `entity_types` via `mergeEntityTypes` and emits `domain_updated`, which the controller persists. Event order: `assistant_text` → source write → `source_path_added` → `domain_updated`. See [[domain-model#Domain Events]].

### Link & Index Hygiene

Deterministic, LLM-free invariants enforced on every ingest (prevention side). After the WikiLink fix pass, ingest runs `stripDeadLinks` (`src/wiki-link-validator.ts`) on every page unconditionally: it removes `[[links]]` whose trailing stem is not in the vault-wide `knownStems`, tidies the surrounding whitespace/punctuation, and re-derives `wiki_outgoing_links` from the cleaned body so frontmatter and body stay synced. Links to source notes (present in `knownStems`) are never treated as dead.

Every written page is indexed regardless of whether LLM #2 emitted an `annotation`: a missing annotation falls back to `deriveFallbackAnnotation` (`src/wiki-index.ts`), which builds `"<H1> — <first body sentence> Type: <section>"` from the page itself. This guarantees the page reaches `_index.md` and therefore the embedding corpus. After the write/delete loops, `reconcileIndex` runs a bidirectional pass over the current domain files — adding pages missing from `_index.md` and removing orphan entries whose file no longer exists. See [[retrieval#Embedding Cache]].

## Query

Two-phase retrieval (`src/phases/query.ts`): seed selection from `_index.md` annotations, then BFS expansion over the wiki graph. Similarity (embedding or Jaccard) selects seeds; graph traversal expands coverage. See [[retrieval#Query Graph Traversal]].

### Seed Selection

Seeds are the wiki page IDs most relevant to the question. Both embedding and Jaccard paths capture `seedScores` for tracing. Each page's match text is its `_index.md` annotation — a rich single-line structured string (summary + `Затрагивает:` entities + `Тип:` + `Термины:` synonyms).

The index line format is `- pid — annotation` — a bare `pid`, no `[[wikilink]]`, no path — so `_index.md` contributes zero edges to the Obsidian graph view. On plugin load, `src/migrate-index-format.ts#migrateIndexFormat` rewrites legacy `- [[pid]] relpath — annotation` lines idempotently. On the embedding path each page is represented by multiple vectors and the seed score is the max cosine, so a query matching a body-only fact still surfaces the page. If seed selection yields nothing, `llmSelectSeeds` asks the LLM to pick from all annotated page IDs.

### BFS Expansion

BFS always runs from the seed set. All wiki pages are read to build the graph; only BFS-expanded pages reach the LLM. `bfsExpandRanked` ranks non-seed pages and caps them at `bfsTopK` (default 10); seeds are always included. The `graph_stats` event emits `seedScores`, `expandedPages`, and `expandedScores` for tracing. See [[retrieval#Wiki Graph]].

### Fusion

Opt-in (`nativeAgent.bfsFusion`, default off) — orders the final context by an RRF fusion of vector and graph signals over the union instead of seeds-first concat. A separate gate `nativeAgent.seedSimilarityThreshold` drops weak embedding seeds. See [[retrieval#Fusion]].

### Answer Generation

System prompt from `prompts/query.md`. Injected variables: `domain_name`, `entity_types_block`, `index_block`. The user message contains `Question: {question}` followed by the context block of selected pages. The prompt enforces inline `[[WikiLink]]` references per fact, code in backticks/fences with a language tag, section headers only for multi-topic answers, and no filler.

### Post-Stream Link Validation

After the answer is streamed, `runQuery` validates all `[[WikiLink]]` references against the vault's known page stems (`src/phases/query-link-validator.ts`). See [[architecture#Query Link Validator]].

Pipeline: extract links → check against vault stems → if broken and `wikiLinkValidationRetries > 0`, call `rewriteWithValidLinks` with BFS context stems as hints → re-check → if still broken, `annotateBroken` marks each with ⚠️. A corrected answer is emitted via `assistant_replace`. The `FixingLinks` tool_use event signals the rewrite pass; on failure or abort, the original is annotated as fallback.

### Query Trace UI

The `graph_stats` event is rendered by `src/view.ts#formatGraphStatsLines` (a pure function). Integration test specs for the link-validation pipeline live in [[query-sentinel-tests]].

When `agentLogEnabled` is true, scores and a BFS-by-hop breakdown render in multi-line trace format; when false, a compact single-line form is shown. Both forms now include a short retrieval tag (`vector` / `jaccard (low …)` / `jaccard (embed failed)` / `llm seeds`) built by `retrievalTag` from `retrievalMode`/`denseMax`/`seedFallbackReason`.

### History Re-run

The history ↺ Re-run button re-runs a stored query against its **original** domain, not the current dropdown selection — resolved from the entry's saved `domainId`, validated, then passed straight to the query.

`src/view.ts` reads a fresh domain list via `controller.loadDomains()` and resolves the entry's `domainId` with `src/rerun-domain.ts#resolveRerunDomain`, then calls `controller.query(question, domainId)` directly. The resolved id is authoritative: it bypasses the DOM `<select>`, closing the prior bug where an option missing from the dropdown (unpopulated select on mobile, or a renamed/deleted domain) silently reset `domainSelect.value` to empty, sent `undefined` downstream, and defaulted to the first domain (`domains[0]` in `src/phases/query.ts`).

`resolveRerunDomain` returns `{ ok: false, reason: "missing" }` when the entry has no `domainId`, or `"not-found"` when the id is absent from the current [[domain-model]] list. On either failure the handler shows the `view.rerunDomainMissing` Notice (en/ru/es) and runs nothing. The select is still synced for display only.

## Lint

Analyzes wiki pages for a domain one article at a time (`src/phases/lint.ts`). For each article it selects a limited context set via `PageSimilarityService` + BFS, then calls the LLM; results merge into `LintOutputSchema`. Before the loop, `buildTitleMap` reads H1/`title:` from non-wiki files so title-based `wiki_sources` links are not falsely removed.

Per-article loop: select top-K → BFS expand (depth 1) → LLM call → apply fixes (`fixWikiLinks`, then `validateWikiSources` keeps entries resolvable by stem OR title) → process `deletes` → rebuild graph + refresh vectors. After all articles: post-loop empty-sources deletion, source-file `wiki_articles` cleanup (outside `!Wiki/` only, validated against all domains), `actualizeDomainConfig`, backlink sync, `appendWikiLog`.

### Lint Options

`runLint` accepts two optional parameters. `useLlm` (default true) — when false, skips the per-article LLM loop and `actualizeDomainConfig`; lint runs programmatic-only (`cleanupInvalidPages`), much faster for large wikis. `entityTypeFilter` (default `[]`) — when non-empty, filters article paths to wiki pages whose subfolder matches a requested entity type, applied before both paths.

`LintOptionsModal` (`src/modals.ts`) takes the pre-selected domain, a Use-LLM toggle, and per-entity-type toggles with `(N)` article counts plus select-all/deselect-all. Submit passes `{ useLlm, entityTypeFilter }`.

### Cleanup Pass

Before the Glob step, lint runs `cleanupInvalidPages` to remove stale or malformed pages (files starting with `_` are skipped). A page is deleted if its stem fails `GENERIC_WIKI_STEM_REGEX` or its frontmatter lacks `wiki_sources`. A `step` event is emitted when pages are deleted.

After the per-article loop, in the always-on block that runs with the LLM on or off, lint applies the same deterministic hygiene as ingest (cure side). It strips dead `[[links]]` from every page body via `stripDeadLinks` using the vault-wide `knownStems` (the retained `filterStaleWikiLinks` frontmatter pass is then a no-op on the synced result), then runs `reconcileIndex` bidirectionally over the full domain page set — adding pages missing from `_index.md` with a fallback annotation and removing orphan entries. This heals drift prevention cannot reach (legacy un-annotated pages, renamed/merged files) and emits an `Index reconciled: +A / -R` report line. See [[operations#Link & Index Hygiene]].

### Backlink Sync

After writing fixed pages, lint syncs `wiki_articles` backlinks into source files. For each wiki page with `wiki_sources`, it resolves each source to a vault path and appends the wiki page as `[[WikiPageName]]`. `wiki_sources` uses bare names; lint builds a `stemToPath` map from all vault `.md` files to resolve them. Legacy path-style entries are used as-is.

## Lint-Chat

Interactive fix pass driven by a lint report (`src/phases/lint-chat.ts`). The user provides an instruction; the LLM returns `LintChatSchema` with updated page contents, written back to the vault.

Emits `tool_use name: "Glob"` (file list) and `"Read"` (page load) before any I/O so the UI shows activity immediately; `"Applying fixes"` before the LLM call. `parseWithRetry` events are forwarded after success or failure.

## Chat

Free-form conversation after any operation (`src/phases/chat.ts`). Takes `context` (last operation result) and `chatMessages` history. On the claude-agent backend, sessions resume via `sessionId` for multi-turn continuity. See [[backends-and-config#Claude Agent]].

## Format

Reformats a non-wiki markdown page without changing facts (`src/phases/format.ts`). The LLM returns sentinel-marked output with `report` and `formatted` sections; the preview is written to a temp file and the user applies or cancels via sidebar. See [[llm-pipeline#Format Sentinel]].

Output parsing uses sentinel markers instead of JSON for robustness. Iterative refinement via `formatRefine`. A mobile Format button makes Format available on mobile too (no longer desktop-only). When `vision.enabled` and `vision.model` are set, a pre-step analyzes embedded images, PDFs, and Excalidraw files (`src/phases/attachment-analyzer.ts`); descriptions are inserted into the formatted output only — the source file is never modified.

### Frontmatter Restore

`runFormat` restores the source frontmatter onto the LLM output before writing the preview, via the shared `restoreSourceFrontmatter` (`src/utils/raw-frontmatter.ts`) — so preview and apply are identical.

It preserves the source `wiki_*` tracking fields (`wiki_added`/`wiki_updated`/`wiki_articles`) when the original carries a `wiki_updated`, and ALWAYS normalizes the YAML (dedupe keys, drop invalid values, re-serialize). The temp preview and the `format_preview` event therefore reflect the restored frontmatter, not only the applied file. The function is idempotent, so the controller's apply-time call is a no-op on already-restored content.

### Progress Language

The format progress stream follows the configured language. `AgentRunner` resolves it with `resolveLang(outputLanguage)` (layer A) and passes the matching `formatProgress` bundle into `runFormat` (`src/i18n.ts`). The same `resolveLang` resolver is used for ingest, lint, and init status strings.

An explicit `ru`/`en`/`es` wins; `auto`/undefined falls back to the Obsidian UI locale (`moment.locale()`). Every progress string — analysing, salvage/truncation notices, sentinel-invalid, write-failure — is a bundle lookup. `format.ts` type-only-imports `FormatProgress` to stay free of an `obsidian` runtime dependency, and an English fallback keeps `runFormat` usable without an explicit bundle.

### Vision Pre-Step

Image and PDF diagram embeds are processed in two stages: the model reads the drawing literally as a silent internal step, then emits a structured, logical description of what the scheme means (purpose, components, flow), and recreates the structure as a `mermaid` block (flow/architecture) or a markdown table (grid/matrix). Excalidraw uses a dedicated prompt (prose/lists only, no `mermaid`); embeds are rendered to PNG by the host `obsidian-excalidraw-plugin` and skipped when the host is absent.

On mobile, vision is image-only: raster images (png/jpg/jpeg/webp) are still analyzed, but PDF and Excalidraw are skipped because they need a desktop renderer. This is gated by `isVisionSupportedOnMobile` (`getMimeType(path) !== null`) threaded as an `imageOnly` flag; skipped embeds report "unsupported on mobile" instead of "unknown extension".

Vision results are cached per run in a `VisionTempStore` (`src/phases/vision-temp-store.ts`) under the plugin directory, never the vault content tree. Each attachment is analyzed by one LLM call and resumed from the store if the idle-watchdog retries, so completed attachments are never re-sent. The watchdog resets on `tool_use`/`tool_result` as well as stream events, so per-attachment progress prevents a cumulative-time abort.

## Delete

Removes a source and its wiki artifacts, rebuilding multi-source pages on their remaining sources (`src/phases/delete.ts#runDelete`). The `delete` operation is dispatched from the sidebar Delete button via `WikiController.deleteSource`, gated to source files of the active domain. See [[architecture#Sidebar View]].

Both the preview modal and the phase compute the same plan from the pure `src/source-deletion.ts#computeDeletionPlan` — a wiki page is `toDelete` when the source is its only `wiki_sources` entry, or `toRebuild` (with its remaining sources resolved) when it has others. Stem matching is exact (`note` never matches `note-2`). `src/source-deletion.ts#isSourceFile` gates the Delete button to `source_paths` members of the active domain; the Format button is **not** gated this way — it stays active for any non-wiki markdown file via `src/wiki-path.ts#isWikiArticlePath` (see [[architecture#Sidebar View]]).

`DeleteSourceModal` (`src/modals.ts`) previews the N pages to delete and M to rebuild with a permanent-deletion warning before any change. Delete is exempt from the mobile dispatch guard, so it works on mobile like Query and Format.

### Execution order

`runDelete` runs: drop the source from `source_paths`/`analyzed_sources` (via `source_path_removed` + `domain_updated`, see [[domain-model#Domain Events]]) → wipe `toRebuild` pages → re-ingest each remaining source sequentially (reusing [[operations#Ingest]], collecting per-source failures without aborting) → delete `toDelete` pages → strip stale `wiki_articles` backlinks → invalidate the graph cache.

Every page removal is `validateArticlePath`-guarded (`<domain>/<file>.md`, no traversal). Inner `runIngest` `result` events are suppressed so only the final result reaches the view.

### Source file deleted last

The source file is permanently removed (`vaultTools.remove`, no trash) **last**, and only when there were zero rebuild failures **and** the run was not aborted. An abort mid-rebuild leaves wiped pages un-rebuilt; deleting the source then would be unrecoverable, so the source is kept and the result reports `source kept — cancelled` / `source kept — retry`.

## Retrieval Eval Harness

Standalone CLI (`scripts/eval.ts`) measuring retrieval quality — Recall@k (k=3,5,8) and MRR — against a fixed gold set, per layer (seed, union) and config (dense, jaccard). Distinct from the answer-quality evaluator (`src/phases/evaluator.ts`).

It runs against a real vault on disk, mirroring the seed-selection + BFS block of query (same public functions, no `runQuery`). Because `src/page-similarity.ts` imports `requestUrl` from the type-only `obsidian` package, the harness aliases `obsidian` to `scripts/obsidian-shim.ts` (a `fetch`-based `requestUrl`). Run via `npm run eval -- --vault <path> --gold <gold.json> [--config dense|jaccard] [...]`. Gold sets live in `scripts/eval/`.

## Tier 1 Features

Three opt-in capabilities; all default to off and are safe to enable independently. See [[retrieval#Dedup helpers]].

- **Hybrid retrieval** (`nativeAgent.hybridRetrieval`): query and lint use `mode: "hybrid"`, fusing embedding and jaccard rankings via RRF before BFS. Degrades to jaccard without an endpoint.
- **Ingest dedup gate** (`nativeAgent.dedupOnIngest` + `dedupThreshold`): after a new page is proposed, `maxSimilarityToExisting()` compares it against the vault; if the closest match is ≥ threshold, ingest runs one LLM merge call and writes into the existing page.
- **Lint near-duplicate report** (`nativeAgent.lintNearDuplicate` + `nearDupThreshold`): in embedding/hybrid mode, lint calls `pairwiseNearDuplicates()` and reports pairs whose max-pool cosine ≥ threshold. Skipped over the page cap.

## Tier 2 Features

Two opt-in retrieval refinements for the native Query pipeline; both default to off and are measurable on the eval harness. See [[retrieval#Fusion]].

- **BFS fusion** (`nativeAgent.bfsFusion`): query context ordered by an RRF fusion of vector and graph ranks over the seed+BFS union, reusing `rrfK`.
- **Seed similarity threshold** (`nativeAgent.seedSimilarityThreshold > 0`): the threshold is compared against the **dense cosine confidence** (`denseMax`), not the fused score — so the gate actually engages in hybrid mode. Seeds below it are dropped in favor of Jaccard, falling through to `llmSelectSeeds` when Jaccard is also empty.
