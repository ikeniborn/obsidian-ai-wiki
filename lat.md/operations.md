# Operations

The seven operations available in AI Wiki. Each maps to a phase function and produces specific artifacts. Prompt dependencies are documented in `docs/prompt-architecture.md`.

## Init

Bootstraps a new domain. File 0 calls `parseWithRetry` with `DomainEntrySchema` to produce `id`, `name`, `wiki_folder`, `entity_types`, `language_notes`. Subsequent files run as ingest passes.

Creates `_wiki_schema.md`, `_format_schema.md`, `DomainEntry`. See [[src/phases/init.ts]], [[llm-pipeline#parseWithRetry]].

## Ingest

Extracts entity instances from a source file and writes or updates wiki pages. LLM returns `WikiPagesOutputSchema` — a list of `{path, content, annotation}` — plus optional `entity_types_delta`.

Delta is merged into domain config and emitted as `domain_updated`. See [[src/phases/ingest.ts]], [[domain#DomainEntry]].

### entity_types_delta

When the ingest LLM response includes `entity_types_delta`, the runner merges it into the current `entity_types` via `mergeEntityTypes` and emits `domain_updated`. The controller persists the patch.

## Query

Two-phase retrieval: seed selection from `_index.md` annotations, then BFS expansion over the wiki graph. Jaccard token scoring runs first; `llmSelectSeeds` is used as fallback only when Jaccard produces zero results.

See [[src/phases/query.ts]], [[wiki-graph#Query Graph Traversal]].

### Seed Selection

Seeds are wiki page IDs most relevant to the question. `selectSeeds` uses Jaccard similarity over tokenized question vs page content + index annotations.

If Jaccard yields nothing, `llmSelectSeeds` asks the LLM to pick from all annotated page IDs. See [[src/wiki-seeds.ts#selectSeeds]], [[src/phases/query.ts#llmSelectSeeds]].

### BFS Expansion

From the seed set, BFS expands to neighbor pages within `graphDepth` hops. The graph is undirected — `A → [[B]]` allows traversal B→A. Hub pages are not excluded but flagged by `checkGraphStructure`.

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
