# Architecture

## Overview

Obsidian plugin that builds and maintains a domain wiki from raw notes using an LLM backend. Core flow: Plugin → Controller → AgentRunner → phase functions → vault writes. See [[index#Architecture map]].

## Plugin Entry Point

Top-level Obsidian plugin class (`LlmWikiPlugin` in `src/main.ts`). Registers commands, sidebar view, ribbon icon, status bar. Owns `WikiController`, `DomainStore`, `LocalConfigStore`, and handles multi-version settings migration on load.

## Controller

Orchestration layer between the UI and the runner (`WikiController` in `src/controller.ts`). Guards busy state, resolves the active backend, builds an `AgentRunner`, and streams `RunEvent`s to the sidebar.

Persists domain mutations from events via `DomainStore`. `logEvent` writes JSONL to `!Wiki/_config/_agent.jsonl` when `agentLogEnabled`. Model reasoning is buffered (`_reasoningBuf`) across `assistant_text`+`isReasoning` deltas and flushed as one consolidated `{event:{kind:"reasoning"}}` record per LLM call when the next non-`assistant_text` event arrives, stamped with the current `_llmCallIndex`; non-reasoning `assistant_text` chatter stays dropped (the final answer is captured by the `result` event). The buffer resets per operation in `dispatch`. Folder creation uses `vault.createFolder().catch(() => {})` unconditionally — `adapter.exists()` is unreliable for folders on Obsidian mobile.

`mobileFetch` (mobile LLM HTTP path) must convert `Headers` instances to `Record<string, string>` before `requestUrl` — the OpenAI SDK passes a `Headers` class instance, and without conversion `Content-Type`/`Authorization` are silently dropped.

Dispatch passes **vault-relative** paths (Obsidian `TFile.path`, forward slashes) to operations — never `adapter.getFullPath()`. The phase layer uses `path-browserify` (POSIX), whose `isAbsolute` does not recognise Windows drive paths (`D:\…`); feeding it an OS-absolute path makes `runIngest` re-root it under the vault, and the adapter then doubles the prefix → `ENOENT` on CJK and non-CJK paths alike (issue #14). `runIngest` re-derives the absolute path from `vaultRoot` for domain detection.

## AgentRunner

Stateless execution engine (`src/agent-runner.ts`). Receives a `RunRequest`, selects LLM call options per operation, and delegates to the correct phase function. Wraps the LLM client in `wrapWithJsonFallback` at construction.

In `devMode` it accumulates per-run telemetry and writes one 👍/👎-rateable `eval.jsonl` record at run end (see [[llm-pipeline#Dev-Mode Eval Record]]). `run()` wraps each attempt in a per-attempt `AbortController`; if the LLM goes silent for `llmIdleTimeoutSec` seconds, it retries up to `llmIdleRetries` times before propagating. See [[llm-pipeline]].

## Phase Functions

Each operation is an async generator in `src/phases/`. Functions yield `RunEvent` objects and write to the vault via `VaultTools`. No shared mutable state between phases.

Files: `ingest.ts`, `query.ts`, `lint.ts`, `lint-chat.ts`, `chat.ts`, `init.ts`, `format.ts`. See [[operations]].

## Backends

Two LLM backends, selected in settings. Backend choice drives how the `LlmClient` is constructed in `WikiController.buildAgentRunner`. See [[backends-and-config]].

- **Native Agent** — OpenAI-compatible HTTP client (`openai` SDK); works with Ollama, OpenAI, or any compatible server. Streaming disabled on mobile via `wrapMobileNoStream`.
- **Claude Agent** — wraps `ClaudeCliClient`, spawning `iclaude.sh` / `claude` as a subprocess. Shell consent required; not on mobile.

## VaultTools

Thin adapter over Obsidian's vault API (`src/vault-tools.ts`). Used by all phases for read, write, list, mkdir, remove, rmdir. Decouples phases from Obsidian internals.

`resolveLink(linkpath, sourcePath)` resolves a wiki-link to a vault-relative path; returns `null` when unresolvable rather than echoing the raw path — this blocks path traversal (an embed like `![[../../secret.png]]` would otherwise escape the vault root). The vision pre-step skips attachments resolving to `null`.

`read` is normalization-tolerant: on a not-found error it retries the NFC and NFD forms of the path (`resolveOnDiskPath`) and logs one diagnostic `console.warn` per miss. `write` resolves the same way so an existing file in a different normalization form (e.g. an NFD source note synced from macOS) is overwritten in place rather than duplicated. ASCII paths are unaffected.

## Query Link Validator

Post-stream modules validating wiki links in a query answer against actual vault contents, after the LLM stream completes. See [[operations#Post-Stream Link Validation]].

`src/phases/query-link-validator.ts` holds the pure helpers: `extractAnswerLinks` parses `[[stem]]` refs; `findBrokenLinks` checks each against known stems; `annotateBroken` appends a "missing" marker. `src/phases/link-resolver.ts` deterministically maps a broken stem to its canonical `wiki_*` page by id fragment (`resolveLink`, no LLM), grouping a source note and its generated wiki page as one entity; distinct ids sharing a digit fragment stay ambiguous. Only stems the resolver cannot map fall back to a `parseWithRetry` repair under `makeQueryAnswerSchema` (callSite `query.answer`), then to annotation.

## Settings and Local Config

Settings split into two stores to avoid syncing secrets across devices. See [[backends-and-config#Split Settings Stores]].

`data.json` (Obsidian Sync) holds preferences; `local.json` (machine-local, never synced) holds secrets only (`nativeAgent.apiKey`, `proxy.password`, `iclaudePath`) plus `shellConsentGiven`, `lastDomain`, machine overrides. `resolveEffective` merges both at runtime.

## Storage Migration

One-time migration on plugin load that moves `.config/` directories to `_config/` (`src/storage-migration.ts`). Detects the old layout via `!Wiki/.config/_domain.json`, copies config files to new paths, removes old ones.

Throws `StorageMigrationConflictError` if both `.config/` and `_config/` exist, indicating an interrupted prior migration. `cleanupBundledSchemaCopies` also deletes stale bundled-schema copies left by older versions. See [[domain-model#Bundled Schemas]].

## Sidebar View

`AiWikiView` (`src/view.ts`) is the Obsidian `ItemView` owning the plugin's sidebar panel — action buttons and the domain selector.

`updateButtonAvailability()` runs on domain/file change and operation end: domain-dependent buttons require a selected domain; `formatBtn` is enabled whenever the active file is a markdown file that is **not** a wiki article (`src/wiki-path.ts#isWikiArticlePath` — any path under `WIKI_ROOT`), independent of domain membership, mirroring the controller's own `format()` gate; `deleteBtn` requires the active file to be a source of the active domain (`src/source-deletion.ts#isSourceFile` — a non-wiki file in `source_paths`); `initBtn` is always enabled. The separate `deleteBtn` (desktop and mobile) launches the source deletion — see [[operations#Delete]]. Renders `RunEvent` progress steps including LLM `tool_use`/`tool_result` indicators.

## Run Events

All operations communicate via `RunEvent` — a discriminated union emitted as an async-generator stream (`src/types.ts`). Events cover LLM streaming deltas, tool calls, domain mutations, format previews, structural errors, graph stats, and phase progress.

`info_text` events carry icon, summary, and optional detail lines, rendered as step-items without LLM output. `llm_call_stats` carries per-call timing (tokens, TTFT, duration, tok/s).
