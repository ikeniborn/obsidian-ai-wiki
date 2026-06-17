# Backends and Config

Two LLM backends are supported and selected in settings; backend choice drives how the `LlmClient` is constructed in `WikiController.buildAgentRunner`. Settings are split across two stores to keep secrets off synced devices. See [[architecture#Backends]].

## Native Agent

OpenAI-compatible HTTP client (`openai` SDK). Works with Ollama, OpenAI, or any compatible server. Supports streaming, `json_object` response format, thinking budget, and per-operation model overrides.

HTTP `timeout` is set per-operation from `settings.timeouts[opKey]`; a value of `0` passes `undefined` (no HTTP timeout). Chat sessions forward `settings.timeouts.lint`. On mobile, streaming is disabled via `wrapMobileNoStream`. This is the only backend that uses [[retrieval#PageSimilarityService]] embeddings.

## Claude Agent

Wraps `ClaudeCliClient` (`src/claude-cli-client.ts`) — spawns `iclaude.sh` / `claude` CLI as a subprocess. Shell consent is required on first run. Not available on mobile.

Per-operation effort levels map to Claude's extended thinking. The subprocess kill timer is skipped when `requestTimeoutSec = 0` (no-limit mode). On this backend, format vision is enabled and chat sessions resume via `sessionId`.

## Split Settings Stores

Settings are split into two stores to avoid syncing secrets across devices. `resolveEffective` (`src/effective-settings.ts`) merges them at runtime: spreads `data.json`, overlays only `apiKey` from local nativeAgent and `password` from local proxy.

- **`data.json`** (synced via Obsidian Sync) — all user preferences: `nativeAgent` connection params, `claudeAgent` model/effort/tools, proxy config, operation configs, UI settings.
- **`local.json`** (machine-local, never synced) — secrets only: `nativeAgent.apiKey`, `proxy.password`, `iclaudePath`; plus `shellConsentGiven`, `lastDomain`, machine overrides (`backend`, `agentLogEnabled`).

## Output Language

A global `outputLanguage` (`auto | ru | en | es`, default `auto`) fixes the response language across all operations, including vision; `auto` binds to the source/article language. It replaced the former `vision.language`. Drives the localized wiki section headings via [[domain-model#Bundled Schemas]].

## Settings Migration

`migrateToLocalV2` runs on first load after upgrade — reads the old `local.json` (which held full nativeAgent/claudeAgent/proxy fields from v1), moves those into `data.json`, and rewrites `local.json` to the lean secret-only shape. New installs skip v2 via `migrated_v2: true`. See [[architecture#Plugin Entry Point]].

## Settings Panel Notes

`LlmWikiSettingTab.render()` (`src/settings.ts`) saves `scrollTop` before `containerEl.empty()` and restores it via `requestAnimationFrame` after rebuild, preventing scroll reset when onChange handlers re-render. The scrollable container is resolved via `.vertical-tab-content` / `.modal-content` / `parentElement` — not `parentElement` alone.

The embedding-dimensions field exposes a **Check** button (verifies the entered value, probes native size, warns on lossy truncation) and a **Default** button (fills the native size); dimensions auto-detect on model select. `lintOptions.useLlm` is stored in `data.json` as the lint-modal default but is no longer exposed in the panel.
