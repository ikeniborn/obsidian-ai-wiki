# Architecture

Obsidian plugin that builds and maintains a domain wiki from raw notes using an LLM backend. Core flow: Plugin → Controller → AgentRunner → phase functions → vault writes.

## Plugin Entry Point

Top-level Obsidian plugin class. Registers commands, sidebar view, ribbon icon, status bar. Owns `WikiController`, `DomainStore`, `LocalConfigStore`. Handles multi-version settings migration on load.

See [[src/main.ts#LlmWikiPlugin]].

## Controller

Orchestration layer between the UI and `AgentRunner`. Guards busy state, resolves the active backend, builds an `AgentRunner`, and streams `RunEvent`s to the sidebar view.

Persists domain mutations from events via `DomainStore`. See [[src/controller.ts#WikiController]].

## AgentRunner

Stateless execution engine. Receives a `RunRequest`, selects LLM call options per operation, and delegates to the correct phase function. Wraps the LLM client in `wrapWithJsonFallback` at construction time.

Optionally runs the evaluator in `devMode`. See [[src/agent-runner.ts#AgentRunner]].

## Phase Functions

Each operation is implemented as an async generator in `src/phases/`. Functions yield `RunEvent` objects and write directly to the vault via `VaultTools`. No shared mutable state between phases.

| Phase file | Operation |
|---|---|
| `phases/ingest.ts` | ingest |
| `phases/query.ts` | query |
| `phases/lint.ts` | lint |
| `phases/lint-chat.ts` | lint-chat |
| `phases/chat.ts` | chat |
| `phases/init.ts` | init |
| `phases/format.ts` | format |
| `phases/evaluator.ts` | devMode evaluator |

See [[operations#Operations]].

## Backends

Two LLM backends are supported and selected in settings. Backend choice affects how the `LlmClient` is constructed in `WikiController.buildAgentRunner`.

### Native Agent

OpenAI-compatible HTTP client (`openai` SDK). Works with Ollama, OpenAI, or any compatible server. Supports streaming, `json_object` response format, thinking budget, and per-operation model overrides.

HTTP `timeout` is set per-operation from `settings.timeouts[opKey]`. A value of `0` passes `undefined` to the SDK (no HTTP timeout). Chat sessions (`dispatchChat`) forward `settings.timeouts.lint` as the per-operation timeout to `buildAgentRunner`. See [[src/controller.ts#WikiController#buildAgentRunner]].

On mobile, streaming is disabled via `wrapMobileNoStream`. See [[src/controller.ts#WikiController#buildAgentRunner]].

### Claude Agent

Wraps `ClaudeCliClient` — spawns `iclaude.sh` / `claude` CLI as a subprocess. Shell consent is required on first run. Not available on mobile.

Per-operation effort levels map to Claude's extended thinking. The subprocess kill timer is skipped when `requestTimeoutSec=0` (no-limit mode). See [[src/claude-cli-client.ts#ClaudeCliClient]].

## PageSimilarityService

Reduces LLM context by pre-selecting top-K relevant wiki pages. Built by `AgentRunner.buildSimilarity()`. Exposes three public methods: `selectRelevant`, `selectRelevantScored` (scored variant for query tracing), and `selectByEntities`.

Two modes: `jaccard` (default, no API calls) uses token overlap scoring via `scoreSeed`; `embedding` fetches vectors from an OpenAI-compatible endpoint (no API key required — supports Ollama), falls back to Jaccard on error. Embedding vectors are cached per domain at `_config/_embeddings.json` and invalidated by annotation content hash. `refreshCache` updates stale entries after a domain write pass — called by both ingest (after writing pages) and lint. Configured via `embeddingModel`, `embeddingDimensions`, `relevantPagesTopK` in `LocalConfig.nativeAgent`. Only active for `native-agent` backend.

`loadCache()` reads `_embeddings.json` into memory before `selectRelevant()` so ingest, query, and lint don't re-fetch vectors from the API on every run. Called by ingest, query, and lint phases before `selectRelevant` or `refreshCache`.

`refreshCache` returns `{ updated: number }` — the count of newly embedded pages written to the cache. Returns `{ updated: 0 }` when in `jaccard` mode, when config is incomplete, or when no entries need updating.

Ingest uses `selectByEntities` for per-entity vector top-K; query/lint/format/init continue to use `selectRelevant` + BFS via `wiki-graph`.

See [[src/page-similarity.ts#PageSimilarityService]], [[src/agent-runner.ts#AgentRunner]], [[operations#Ingest#Per-Entity Retrieval]].

## VaultTools

Thin adapter over Obsidian's vault API. Used by all phase functions for read, write, list, mkdir, remove, and rmdir. Decouples phases from Obsidian internals and enables testing.

`VaultAdapter` exposes optional `remove?` and `rmdir?` methods. `removeSubfolders(vaultDir)` lists immediate subdirectories of a folder and calls `rmdir` on each, skipping locked entries that throw. Returns early if the directory does not exist.

See [[src/vault-tools.ts#VaultTools]].

## Settings and Local Config

Settings are split into two stores to avoid syncing secrets. `data.json` (synced) holds UI preferences and operation configs. `local.json` (local) holds API keys, iclaudePath, and shell consent.

`resolveEffective` merges both into a single `LlmWikiPluginSettings` for runtime use. See [[src/effective-settings.ts#resolveEffective]].

## Storage Migration

One-time migration that runs on plugin load to move `.config/` directories to `_config/`. Detects old layout by checking for `!Wiki/.config/_domain.json`, then copies all config files to the new paths and removes the old ones.

Throws `StorageMigrationConflictError` if both `.config/` and `_config/` exist simultaneously, indicating an interrupted previous migration. See [[src/storage-migration.ts#runStorageMigration]].

## Wiki Stem Mask

The helper [[src/wiki-stem.ts]] centralizes the `wiki_<domain>_<entity>` filename mask used wherever a wiki page stem is generated or validated.

It exposes `slugifyEntity` (NFD-normalize, ASCII-collapse, split camelCase boundaries, and lowercase), `buildWikiStem(domainId, entityName)`, `stemRegex(domainId)` for per-domain match, and the domain-agnostic `GENERIC_WIKI_STEM_REGEX` used by zod schemas. Entity slugs are always lowercase `[a-z0-9_]`.

The one-shot vault migration that renames legacy unprefixed pages and rewrites all backlinks lives in [[src/migrate-wiki-prefix.ts]]; the CLI wrapper is `scripts/migrate-wiki-prefix.ts`, invoked via `npm run migrate:wiki-prefix -- <vault-root> [--apply]`. It also lowercases the entity portion of already-prefixed stems (`wiki_work_Foo` → `wiki_work_foo`) and sets `DomainEntry.pageNameVersion = 1` for idempotency.

## Frontmatter Validator

Shared utility that detects and repairs malformed frontmatter before ingest writes wiki fields. Parses via `yaml.parse`, applies per-field `FieldRule`s, re-serializes via `yaml.stringify`. Returns original content unchanged when no repairs needed.

Key behaviors: duplicate YAML keys are pre-merged by regex before parsing; unparseable YAML is returned as-is with a warning; field-level rules strip invalid list entries or scalars and record a warning per violation. Only files with at least one warning are rewritten.

`validateAndRepairSourceFrontmatter` applies `SOURCE_RULES` (wiki_articles, wiki_added, wiki_updated, tags, aliases, external_links, related). `validateAndRepairWikiPageFrontmatter` applies `WIKI_PAGE_RULES` (wiki_sources, wiki_updated, wiki_status, wiki_type, tags, aliases, wiki_outgoing_links, wiki_external_links). Both are called in `[[src/phases/ingest.ts]]` (`runIngest`) before their respective `vaultTools.write` calls; any warnings are emitted as `info_text` events. See [[src/utils/raw-frontmatter.ts#validateAndRepairFrontmatter]], [[src/utils/raw-frontmatter.ts#validateAndRepairSourceFrontmatter]], [[src/utils/raw-frontmatter.ts#validateAndRepairWikiPageFrontmatter]].

Two bucket-enforcing kinds were added — `list-wikilinks-wiki-only` (only `wiki_<domain>_<slug>` stems allowed) and `list-wikilinks-sources-only` (wiki stems rejected). Both inherit the `[[...]]` format check from `list-wikilinks` and additionally call `isWikiStem` from [[src/wiki-stem.ts#isWikiStem]]. `WIKI_PAGE_RULES` uses these kinds for `wiki_outgoing_links` and `wiki_sources` respectively.

## Run Events

All operations communicate via `RunEvent` — a discriminated union emitted as an async generator stream. Events cover: LLM streaming deltas, tool calls, domain mutations, format previews, structural errors, graph stats, and phase progress.

`info_text` events carry an icon, summary, and optional detail lines — rendered as step-items in the sidebar without requiring LLM output. Used by ingest to report similarity seed count and BFS expansion size.

| Event type | Description |
|---|---|
| `llm_call_stats` | Per-call timing metadata: inputTokens, outputTokens, ttftMs, llmDurationMs, inTokPerSec, outTokPerSec. Emitted after each streaming LLM call completes. |

See [[src/types.ts#RunEvent]].
