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

### Per-page Progress Events

Before writing each wiki page, ingest emits `tool_use` with `name: "Create"` for new pages or `name: "Update"` for existing ones. Error-path yields (blocked/invalid paths) keep `name: "Write"`.

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

Analyzes all wiki pages for a domain, returns `LintOutputSchema` with `report` and `fixes[]`. A second call `actualizeDomainConfig` runs after lint to sync `entity_types` from real wiki content.

Emits `domain_updated` with updated entity types. See [[src/phases/lint.ts]].

## Lint-Chat

Interactive fix pass driven by a lint report. The user provides an instruction; the LLM returns `LintChatSchema` with updated page contents. Pages are written back to the vault.

See [[src/phases/lint-chat.ts]].

## Chat

Free-form conversation after any operation. Takes `context` (last operation result) and `chatMessages` history. On claude-agent backend, sessions resume via `sessionId` for multi-turn continuity.

See [[src/phases/chat.ts]].

## Format

Reformats a non-wiki markdown page without changing facts. LLM returns `FormatOutputSchema` with `report` and `formatted`. Preview is written to a temp file; user applies or cancels via sidebar.

Iterative refinement via `formatRefine`. On claude-agent, vision is enabled. See [[src/phases/format.ts]], [[src/controller.ts#WikiController#format]].
