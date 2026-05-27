# Operations

The seven operations available in AI Wiki. Each maps to a phase function and produces specific artifacts. Prompt dependencies are documented in `docs/prompt-architecture.md`.

## Init

Bootstraps a new domain. File 0 calls `parseWithRetry` with `DomainEntrySchema` to produce `id`, `name`, `wiki_folder`, `entity_types`, `language_notes`. Subsequent files run as ingest passes.

Creates `_wiki_schema.md`, `_format_schema.md`, `DomainEntry`. See [[src/phases/init.ts]], [[llm-pipeline#parseWithRetry]].

## Ingest

Extracts entity instances from a source file and writes or updates wiki pages. LLM returns `WikiPagesOutputSchema` — a list of `{path, content, annotation}` — plus optional `entity_types_delta`.

Delta is merged into domain config and emitted as `domain_updated`. See [[src/phases/ingest.ts]], [[domain#DomainEntry]].

### Page Similarity

Selects seed wiki pages most relevant to a source file, then expands via BFS over the wiki graph before passing context to the LLM. [[src/page-similarity.ts#PageSimilarityService]] implements two modes configured via `SimilarityConfig`.

In `jaccard` mode, Jaccard scoring over tokenized source content vs index annotations ranks candidates; top-K paths are seeds. In `embedding` mode, vectors for all annotated pages are fetched from an OpenAI-compatible endpoint (no API key required for Ollama), cached in `_config/_embeddings.json` per domain, and scored by cosine similarity. Falls back to Jaccard on API error. After similarity selects seeds, ingest reads all non-meta pages, builds the graph cache, and BFS-expands from seed IDs — only the expanded subset is passed to the LLM. `refreshCache` updates the embedding cache after ingest writes pages. An `info_text` event reports how many pages were loaded vs total. See [[architecture#PageSimilarityService]].

### LLM Progress Step

Emits `tool_use name: "Synthesising pages"` before `parseWithRetry`. On success, `tool_result` preview shows context page count and estimated input tokens (`"N pages · ~Xk tokens sent"`); on error, `ok: false`.

Gives the user a visible waiting indicator during the LLM call. See [[llm-pipeline#LLM Progress Events]].

### Per-page Progress Events

Before writing each wiki page, ingest emits `tool_use` with `name: "Create"` for new pages or `name: "Update"` for existing ones. Error-path yields (blocked/invalid paths) keep `name: "Write"`.

### Result Summary

After writing pages, ingest emits a result text broken down by action: `создано N стр.` (all new), `обновлено N стр.` (all updated), or `создано C, обновлено U` (mixed). Zero-write runs report no changes.

### entity_types_delta

When the ingest LLM response includes `entity_types_delta`, the runner merges it into the current `entity_types` via `mergeEntityTypes` and emits `domain_updated`. The controller persists the patch.

## Query

Two-phase retrieval: seed selection from `_index.md` annotations, then BFS expansion over the wiki graph. Similarity (embedding or Jaccard) selects seeds; graph traversal expands coverage.

See [[src/phases/query.ts]], [[wiki-graph#Query Graph Traversal]].

### Seed Selection

Seeds are wiki page IDs most relevant to the question. In `embedding` mode, `loadCache()` + `selectRelevant(question, ...)` uses cosine similarity. In `jaccard` mode, `selectSeeds` scores by token overlap.

If seed selection yields nothing, `llmSelectSeeds` asks the LLM to pick from all annotated page IDs. See [[src/wiki-seeds.ts#selectSeeds]], [[src/phases/query.ts#llmSelectSeeds]], [[src/page-similarity.ts#PageSimilarityService]].

### BFS Expansion

BFS always runs from the seed set — both when seeds come from similarity and from Jaccard. All wiki pages are read to build the graph; only BFS-expanded pages are passed to the LLM. The graph is undirected — `A → [[B]]` allows traversal B→A.

See [[src/wiki-graph.ts#bfsExpand]], [[wiki-graph#Query Graph Traversal]].

## Lint

Analyzes wiki pages for a domain one article at a time. For each article selects a limited context set via `PageSimilarityService` + BFS graph expansion, then calls the LLM. Results are merged into `LintOutputSchema`.

Per-article loop:
1. `selectRelevant(articleContent, annotations, otherPaths)` → top-K paths
2. `bfsExpand([articleId, ...topKIds], graph, depth=1)` → expanded page set
3. LLM call with article + context → `{ report, fixes[], deletes[] }`
4. Apply fixes immediately: `fixWikiLinks` per-step, write to vault, update `pages` and `annotations` in-memory
5. Process `deletes`: `vaultTools.remove`, rewrite `[[deleted]]` links in wiki pages
6. Rebuild graph (`graphCache`) + refresh vectors (`similarity.refreshCache`)

After all articles:
- Source-file backlink rewrite (vault-wide scan for deleted article refs, skipping wiki pages)
- `actualizeDomainConfig` — syncs `entity_types` from final wiki content
- Backlink sync — writes `wiki_articles` into source files via `wiki_sources`
- `appendWikiLog`

Emits `info_text "Checking i/N: ArticleName"` per article. Skipped articles (LLM error) reported at end.

`LintOutputSchema.deletes` carries `{ path, redirect_to? }` for duplicate merges. See [[src/phases/lint.ts]], [[llm-pipeline#LLM Progress Events]], [[architecture#PageSimilarityService]].

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
