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

On mobile, streaming is disabled via `wrapMobileNoStream`. See [[src/controller.ts#WikiController#buildAgentRunner]].

### Claude Agent

Wraps `ClaudeCliClient` — spawns `iclaude.sh` / `claude` CLI as a subprocess. Shell consent is required on first run. Not available on mobile.

Per-operation effort levels map to Claude's extended thinking. See [[src/claude-cli-client.ts#ClaudeCliClient]].

## PageSimilarityService

Reduces LLM context size by pre-selecting the top-K most relevant wiki pages for a given source file. Built by `AgentRunner.buildSimilarity()` and passed to ingest, init, lint, and format phases.

Two modes: `jaccard` (default, no API calls) uses token overlap scoring via `scoreSeed`; `embedding` fetches vectors from an OpenAI-compatible endpoint, falls back to Jaccard on error. Embedding vectors are cached per domain at `_config/_embeddings.json` and invalidated by annotation content hash. `refreshCache` updates stale entries after a domain write pass (lint, format). Configured via `embeddingModel`, `embeddingDimensions`, `relevantPagesTopK` in `LocalConfig.nativeAgent`. Only active for `native-agent` backend.

See [[src/page-similarity.ts#PageSimilarityService]], [[src/agent-runner.ts#AgentRunner]], [[operations#Ingest#Page Similarity]].

## VaultTools

Thin adapter over Obsidian's vault API. Used by all phase functions for read, write, list, mkdir. Decouples phases from Obsidian internals and enables testing.

See [[src/vault-tools.ts#VaultTools]].

## Settings and Local Config

Settings are split into two stores to avoid syncing secrets. `data.json` (synced) holds UI preferences and operation configs. `local.json` (local) holds API keys, iclaudePath, and shell consent.

`resolveEffective` merges both into a single `LlmWikiPluginSettings` for runtime use. See [[src/effective-settings.ts#resolveEffective]].

## Storage Migration

One-time migration that runs on plugin load to move `.config/` directories to `_config/`. Detects old layout by checking for `!Wiki/.config/_domain.json`, then copies all config files to the new paths and removes the old ones.

Throws `StorageMigrationConflictError` if both `.config/` and `_config/` exist simultaneously, indicating an interrupted previous migration. See [[src/storage-migration.ts#runStorageMigration]].

## Run Events

All operations communicate via `RunEvent` — a discriminated union emitted as an async generator stream. Events cover: LLM streaming deltas, tool calls, domain mutations, format previews, structural errors, graph stats, and final result.

See [[src/types.ts#RunEvent]].
