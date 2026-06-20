# Backends and Config

Two LLM backends are supported and selected in settings; backend choice drives how the `LlmClient` is constructed in `WikiController.buildAgentRunner`. Settings are split across two stores to keep secrets off synced devices. See [[architecture#Backends]].

## Native Agent

OpenAI-compatible HTTP client (`openai` SDK). Works with Ollama, OpenAI, or any compatible server. Supports streaming, `json_object` response format, thinking budget, and per-operation model overrides.

HTTP `timeout` is set per-operation from `settings.timeouts[opKey]`; a value of `0` passes `undefined` (no HTTP timeout). Chat sessions forward `settings.timeouts.lint`. On mobile, streaming is disabled via `wrapMobileNoStream`, and the ingest/lint-only settings — the chunking fields and the "Graph health" subsection — are hidden via `!Platform.isMobile` in `src/settings.ts`, since those operations are desktop-only. This is the only backend that uses [[retrieval#PageSimilarityService]] embeddings.

The `!Wiki` output tree is excluded from domain source-folder suggestions: `isSelectableSourceFolder` (`src/source-paths.ts`) drops `WIKI_ROOT` and its descendants, applied in `FolderInputSuggest.getSuggestions` (`src/modals.ts`).

## Claude Agent

Wraps `ClaudeCliClient` (`src/claude-cli-client.ts`) — spawns `iclaude.sh` / `claude` CLI as a subprocess. Shell consent is required on first run. Not available on mobile.

Per-operation effort levels map to Claude's extended thinking. The subprocess kill timer is skipped when `requestTimeoutSec = 0` (no-limit mode). On this backend, format vision is enabled and chat sessions resume via `sessionId`.

## Split Settings Stores

Settings are split into two stores to avoid syncing secrets across devices. `resolveEffective` (`src/effective-settings.ts`) merges them at runtime: spreads `data.json`, overlays only `apiKey` from local nativeAgent and `password` from local proxy.

- **`data.json`** (synced via Obsidian Sync) — all user preferences: `nativeAgent` connection params, `claudeAgent` model/effort/tools, proxy config, operation configs, UI settings.
- **`local.json`** (machine-local, never synced) — secrets only: `nativeAgent.apiKey`, `proxy.password`, `iclaudePath`; plus `shellConsentGiven`, `lastDomain`, machine overrides (`backend`, `agentLogEnabled`).

## Output Language

Language settings govern three independent layers resolved at call time (`src/i18n.ts`). `outputLanguage` (`auto | ru | en | es`, default `auto`) is the primary content setting; `reasoningLanguage` (default `en`) controls the model's internal reasoning language.

### Three-Layer Resolution

Language resolution is split into three layers, each with its own resolver and default.

- **Layer A — Status strings** (`resolveLang(outputLanguage)`): localizes progress/status messages shown in the UI (ingest, lint, init, format, view labels). Explicit `ru|en|es` wins; `auto`/undefined falls back to the Obsidian UI locale (`moment.locale()` → ru/es, otherwise en).
- **Layer B — Reasoning language** (`resolveReasoningLang(reasoningLanguage, outputLanguage)`): injects a `## Reasoning language` directive into the system prompt (best-effort). Explicit `ru|en|es` wins; `auto` chains to `resolveLang(outputLanguage)`; undefined defaults to `en` (models reason most reliably in English).
- **Layer C — Generated content** (`resolveLang(outputLanguage)` via `langInstruction`): injects `## Language` into the system prompt to set the output language. Explicit `ru|en|es` wins; `auto`/undefined follows the Obsidian UI locale — **not** the source note language (deliberate change: `auto` no longer follows the source). Drives the localized wiki section headings via [[domain-model#Bundled Schemas]].

### reasoningLanguage Setting

A new `reasoningLanguage` field (`OutputLanguage`, default `"en"`) in `LlmWikiPluginSettings` (`src/types.ts`) is exposed as a "Reasoning language" dropdown in the settings panel (`src/settings.ts`). It is always injected (layer B is unconditional), unlike the content directive which is skipped when `outputLanguage` is unset.

## Settings Migration

`migrateToLocalV2` runs on first load after upgrade — reads the old `local.json` (which held full nativeAgent/claudeAgent/proxy fields from v1), moves those into `data.json`, and rewrites `local.json` to the lean secret-only shape. New installs skip v2 via `migrated_v2: true`. See [[architecture#Plugin Entry Point]].

## Settings Panel Notes

`LlmWikiSettingTab.render()` (`src/settings.ts`) saves `scrollTop` before `containerEl.empty()` and restores it via `requestAnimationFrame` after rebuild, preventing scroll reset when onChange handlers re-render. The scrollable container is resolved via `.vertical-tab-content` / `.modal-content` / `parentElement` — not `parentElement` alone.

The embedding-dimensions field exposes a **Check** button (verifies the entered value, probes native size, warns on lossy truncation) and a **Default** button (fills the native size); dimensions auto-detect on model select. `lintOptions.useLlm` is stored in `data.json` as the lint-modal default but is no longer exposed in the panel.
