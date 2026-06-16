# Architecture

Obsidian plugin that builds and maintains a domain wiki from raw notes using an LLM backend. Core flow: Plugin → Controller → AgentRunner → phase functions → vault writes.

## Plugin Entry Point

Top-level Obsidian plugin class. Registers commands, sidebar view, ribbon icon, status bar. Owns `WikiController`, `DomainStore`, `LocalConfigStore`. Handles multi-version settings migration on load.

See [[src/main.ts#LlmWikiPlugin]].

## Controller

Orchestration layer between the UI and `AgentRunner`. Guards busy state, resolves the active backend, builds an `AgentRunner`, and streams `RunEvent`s to the sidebar view.

Persists domain mutations from events via `DomainStore`. See [[src/controller.ts#WikiController]].

`logEvent` writes JSONL to `!Wiki/_config/_agent.jsonl` when `agentLogEnabled` is true. Folder creation uses `vault.createFolder().catch(() => {})` unconditionally — **do not guard with `adapter.exists()`**, which is unreliable for folders on Obsidian mobile.

`mobileFetch` (used on mobile for all LLM HTTP requests) must convert `Headers` instances to `Record<string, string>` before passing to `requestUrl` — the OpenAI SDK passes a `Headers` class instance, not a plain object. Without conversion, `Content-Type` and `Authorization` headers are silently dropped, causing LLM requests to fail.

## AgentRunner

Stateless execution engine. Receives a `RunRequest`, selects LLM call options per operation, and delegates to the correct phase function. Wraps the LLM client in `wrapWithJsonFallback` at construction time.

Optionally runs the evaluator in `devMode`. The `run()` method wraps each attempt in a per-attempt `AbortController`; if the LLM goes silent for `llmIdleTimeoutSec` seconds, it retries up to `llmIdleRetries` times before propagating the error. See [[src/agent-runner.ts#AgentRunner]].

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

## Query Link Validator

Post-stream module that validates wiki links in a query answer against the actual vault contents. Runs after the LLM stream completes in `runQuery`.

Four exported helpers: `extractAnswerLinks` parses `[[stem]]` references from the answer text; `findBrokenLinks` checks each stem against a known-stems set; `annotateBroken` appends `*(нет в wiki)*` to broken link occurrences; `rewriteWithValidLinks` calls the LLM non-streaming to produce a corrected answer when retries are configured.

Broken links trigger a retry only when `validationRetries > 0`. If the rewrite still has broken links, or throws, or the signal is aborted, the fallback is to annotate the original answer. See [[src/phases/query-link-validator.ts#extractAnswerLinks]], [[src/phases/query-link-validator.ts#rewriteWithValidLinks]].

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

Two modes: `jaccard` (default, no API calls) uses token overlap scoring via `scoreSeed`; `embedding` fetches vectors from an OpenAI-compatible endpoint (no API key required — supports Ollama), falls back to Jaccard on error. Embedding vectors are cached per domain at `_config/_embeddings.json` and invalidated by annotation content hash. `refreshCache` updates stale entries after a domain write pass — called by both ingest (after writing pages) and lint; it persists for `hybrid` mode too, only pure `jaccard` returns early, so hybrid's dense side reuses persisted vectors instead of re-embedding the corpus every query. Configured via `embeddingModel`, `embeddingDimensions`, `relevantPagesTopK` in `LocalConfig.nativeAgent`. Only active for `native-agent` backend.

When `embeddingDimensions` is set, [[src/page-similarity.ts#fetchEmbeddings]] sends it as the `dimensions` field on every `/embeddings` request (OpenAI Matryoshka truncation), threaded through every call site so pipeline and probe agree. Previously it was only a cache-key label, so a value mismatching the model's real output silently invalidated the cache on load. [[src/page-similarity.ts#probeEmbeddingDimensions]] embeds a single `"ping"` input to detect the model's native vector length, or — given a requested size — reports whether the model honors it. The settings panel exposes a **Check** button (verifies the entered value, probes native size for context, warns on lossy truncation) and a **Default** button (fills the native size); dimensions auto-detect on model select. See [[src/settings.ts]].

`encodeVector`/`decodeVector` serialize Float32Array to base64 using `btoa`/`atob` with chunked `String.fromCharCode` (8192-byte chunks). **Must not use `Buffer`** — unavailable in Obsidian mobile (browser environment).

Embedding vectors are cached per domain at `_config/_embeddings.json` as schema **v2**: each page entry holds a `chunks` array — one `summary` vector (the one-line annotation) plus one `section` vector per body section window. `splitSections` builds the windows (strip frontmatter + H1, H2 units with H3+ folded in, short units merged, long units windowed with overlap, capped at `chunkMaxCount` with the fold made visible in the final heading). `buildChunkInputs` prepends the annotation and H2 heading to each section window for whole-article grounding, and hashes that embed text per chunk. `refreshCache` reuses cached vectors whose hash matches and embeds only new chunks, so a single changed section re-embeds one vector. Page score is the **max** cosine across the page's chunk vectors — one matching body section surfaces the page. Old `{ vector, hash }` caches lack `version: 2`; `loadCache` returns null for them and `refreshCache` rebuilds. Chunking is tunable via `nativeAgent.chunk*` settings, defaulted in `buildSimilarity`.

See [[src/page-similarity.ts#splitSections]], [[src/page-similarity.ts#buildChunkInputs]], [[src/page-similarity.ts#PageSimilarityService#refreshCache]].

`loadCache()` reads `_embeddings.json` into memory before `selectRelevant()` so ingest, query, and lint don't re-fetch vectors from the API on every run. Called by ingest, query, and lint phases before `selectRelevant` or `refreshCache`.

`refreshCache` returns `{ updated: number }` — the count of newly embedded **chunks** written to the cache. Returns `{ updated: 0 }` when in `jaccard` mode, when config is incomplete, or when no entries need updating.

Ingest uses `selectByEntities` for per-entity vector top-K; query/lint/format/init continue to use `selectRelevant` + BFS via `wiki-graph`.

See [[src/page-similarity.ts#PageSimilarityService]], [[src/agent-runner.ts#AgentRunner]], [[operations#Ingest#Per-Entity Retrieval]].

A `hybrid` mode fuses embedding and jaccard rankings via the reusable [[src/rrf.ts#rrf]] util (Reciprocal Rank Fusion), so both overlap and semantic signals contribute to the final ranking. `maxSimilarityToExisting()` scores a candidate text against all cached pages for ingest dedup; `pairwiseNearDuplicates()` compares all page pairs for the lint near-duplicate report.

## VaultTools

Thin adapter over Obsidian's vault API. Used by all phase functions for read, write, list, mkdir, remove, and rmdir. Decouples phases from Obsidian internals and enables testing.

`VaultAdapter` exposes optional `remove?`, `rmdir?`, and `resolveLink?` methods. `resolveLink(linkpath, sourcePath)` resolves an Obsidian wiki-link to a vault-relative path via `metadataCache.getFirstLinkpathDest`; required by the vision pre-step to locate embedded attachments by bare filename. [[src/vault-tools.ts#VaultTools#resolveLink]] returns `null` when the adapter cannot resolve the link rather than echoing the raw path — this blocks path traversal, since an unresolved embed like `![[../../secret.png]]` would otherwise reach `read`/`readBinary` and escape the vault root. The vision pre-step skips attachments that resolve to `null`. `removeSubfolders(vaultDir)` lists immediate subdirectories of a folder and calls `rmdir` on each, skipping locked entries that throw. Returns early if the directory does not exist.

See [[src/vault-tools.ts#VaultTools]].

## Settings and Local Config

Settings are split into two stores to avoid syncing secrets across devices.

`data.json` (synced via Obsidian Sync) holds all user-configurable preferences: `nativeAgent` connection params (baseUrl, model, temperature, etc.), `claudeAgent` model/effort/tools, proxy config (enabled, url, username, noProxy), operation configs, and UI settings.

`local.json` (machine-local, never synced) holds only device-specific secrets: `nativeAgent.apiKey`, `proxy.password`, and `iclaudePath`. Also stores `shellConsentGiven`, `lastDomain`, and machine-specific overrides (`backend`, `agentLogEnabled`).

`resolveEffective` merges both stores at runtime: spreads `data.json` settings, overlays only `apiKey` from local nativeAgent and `password` from local proxy. See [[src/effective-settings.ts#resolveEffective]].

`lintOptions.useLlm` is stored in `data.json` and preserved as the default value for the lint modal toggle, but it is no longer exposed in the plugin settings panel — the toggle was removed to keep settings focused on persistent configuration rather than per-run choices. See [[src/settings.ts]].

`LlmWikiSettingTab.render()` saves `scrollTop` before `containerEl.empty()` and restores it via `requestAnimationFrame` after rebuild — preventing scroll reset when onChange handlers call `display()` to re-render the panel. The scrollable container is resolved via `containerEl.closest('.vertical-tab-content') ?? containerEl.closest('.modal-content') ?? containerEl.parentElement` — **do not use `containerEl.parentElement` alone**, it is not the scrollable element in Obsidian's settings modal.

Migration `migrateToLocalV2` runs on first load after upgrade — reads old `local.json` (which contained full nativeAgent/claudeAgent/proxy fields from v1 migration), moves those fields into `data.json`, and rewrites `local.json` to the lean secret-only shape. New installs skip v2 via `migrated_v2: true` set by `migrateToLocalV1`.

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

## Sidebar View

`AiWikiView` is the Obsidian `ItemView` that owns the plugin's sidebar panel. It holds references to all action buttons and the domain selector `<select>` element.

`updateButtonAvailability()` is called whenever the domain selection or active file changes (domainSelect `change` event, workspace `file-open` event, and end of any operation via `finish()`). It reads `domainSelect.value` and `workspace.getActiveFile()` to set `disabled` on each button: domain-dependent buttons (`askBtn`, `ingestBtn`, `lintBtn`, `reinitBtn`, `addSourceBtn`) require a selected domain; `formatBtn` requires an active non-wiki file; `initBtn` is always enabled.

`eval_result` events are rendered via `MarkdownRenderer.render()` with `**[eval: N/10]**` bold prefix, replacing the former plain-text `.setText()`. A `Component` instance is created and loaded before each render call to support interactive markdown features (link clicks, commands). See [[src/view.ts#LlmWikiView]].

## Run Events

All operations communicate via `RunEvent` — a discriminated union emitted as an async generator stream. Events cover: LLM streaming deltas, tool calls, domain mutations, format previews, structural errors, graph stats, and phase progress.

`info_text` events carry an icon, summary, and optional detail lines — rendered as step-items in the sidebar without requiring LLM output. Used by ingest to report similarity seed count and BFS expansion size.

| Event type | Description |
|---|---|
| `llm_call_stats` | Per-call timing metadata: inputTokens, outputTokens, ttftMs, llmDurationMs, inTokPerSec, outTokPerSec. Emitted after each streaming LLM call completes. |

See [[src/types.ts#RunEvent]].
