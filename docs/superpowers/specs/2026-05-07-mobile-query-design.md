# Mobile Query Support — Design

**Status:** Draft
**Date:** 2026-05-07
**Scope:** query / query-save only (iOS, Android via Obsidian Mobile)

## 1. Goal

Allow users to run wiki queries from Obsidian Mobile against a cloud-hosted LLM (OpenAI-compatible HTTP API). Other operations (ingest, lint, init, fix, chat) remain desktop-only in this iteration.

Phase 2 (out of scope here): on-device LLM (WebLLM / llama.cpp WASM). Mention only as future direction.

## 2. Constraints

- Obsidian Mobile sandbox: no `node:child_process`, no `node:fs`, no spawn, no shell.
- Plugin currently `isDesktopOnly: true` → cannot install on mobile at all.
- `ClaudeCliClient` requires `iclaude.sh` binary → unusable on mobile.
- `nativeAgent` backend uses OpenAI SDK over HTTPS → already mobile-compatible.
- Several modules import `node:fs` / `node:path` at top level — must be moved behind guards or replaced.

## 3. Architecture

```
main.ts onload()
  ├─ detect Platform.isMobile
  ├─ loadSettings: if mobile && backend === "claude-agent" → force "native-agent" + persist
  ├─ register commands always: open-panel, query, query-save, cancel
  └─ register commands only on desktop: ingest, lint, init

controller.dispatch(op)
  └─ if isMobile && op ∉ {query, query-save} → Notice + early return

buildAgentRunner()
  ├─ desktop + claude-agent → dynamic import("./claude-cli-client")
  └─ native-agent (default mobile) → new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser: true })

phases/query.ts
  └─ replace node:path.join with vault-relative string concat
```

Single bundle. Same `main.js` for desktop and mobile. Branching at runtime via `Platform.isMobile`.

## 4. Components & File Changes

| File | Change |
|---|---|
| `manifest.json` (root) | `isDesktopOnly: false` |
| `src/manifest.json` | `isDesktopOnly: false` |
| `src/main.ts` | `Platform.isMobile` gate on `addCommand` for ingest/lint/init; mobile backend migration in `loadSettings` |
| `src/controller.ts` | Remove top-level `node:fs` / `node:path` (move to dynamic import inside desktop-only branches). Reject non-query ops on mobile. Skip `agentLogEnabled` writes on mobile. Add `requireNativeAgent()` precheck (baseUrl + apiKey non-empty) parallel to `requireClaudeAgent()` |
| `src/agent-runner.ts` | Lazy-import `node:fs` / `node:path` only when `devMode.enabled && !Platform.isMobile`. Guard `writeDevLog` / `updateDevLogEval` |
| `src/claude-cli-client.ts` | No code changes. Imported only via `await import()` on desktop branch in `buildAgentRunner` |
| `src/phases/query.ts` | Drop `import { join } from "node:path"`. Compute `absWiki` via vault-relative path through `VaultTools` |
| `src/settings.ts` | Hide claude-agent section + iclaudePath input on mobile. Skip `autodetectCwd()` (fs walk) |
| `src/local-config.ts` | Verify fs paths; skip iclaudePath UI on mobile |
| `esbuild.config.mjs` | No change (`node:*` already external) |
| `docs/mobile-cloud-ollama.md` | **New.** User guide: cloud LLM provider setup (OpenRouter / Ollama Cloud / together.ai), baseUrl, apiKey, model name, troubleshooting CORS |
| `docs/superpowers/specs/2026-05-07-mobile-query-design.md` | This spec |

No deletions. All changes additive or conditional.

## 5. Data Flow (mobile query)

1. User taps `query` command → `QueryModal` (Obsidian API, mobile-safe).
2. `controller.query(question, save=false)` → `controller.dispatch("query", [question])`.
3. Guards:
   - `isMobile && op ∉ {query, query-save}` → Notice + return.
   - Skip `requireClaudeAgent` (native-agent only on mobile).
4. `buildAgentRunner(vaultRoot)`:
   - `backend === "native-agent"` → `new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser: true })`.
5. `AgentRunner.run({ operation: "query", ... })` → `runQuery(...)`.
6. `runQuery`:
   - `vaultTools.listFiles(wikiVaultPath)` (Obsidian adapter — mobile-safe).
   - `vaultTools.readAll(files)`.
   - Build `contextBlock` with 80k truncate (pure JS).
   - `llm.chat.completions.create({ stream: true })` — HTTPS fetch.
   - Stream chunks → yield `assistant_text` events.
7. `view.appendEvent` → live render.
8. `result` event → history persisted via `saveData` (mobile-safe).

Logs (`agentLogEnabled` → `appendFileSync`, `devMode` → `writeDevLog`) skipped on mobile.

## 6. Error Handling

| Case | Behavior |
|---|---|
| Mobile + `backend=claude-agent` in saved settings | `loadSettings` migration → `native-agent`, `saveSettings()`, Notice "Mobile: switched to native-agent" |
| Mobile + non-query op invoked programmatically | `dispatch` early-return + Notice "Operation not available on mobile" |
| `nativeAgent.baseUrl` / `apiKey` empty | `buildAgentRunner` Notice "Configure cloud LLM in settings" + cancel |
| HTTP 401 / 403 | OpenAI SDK throws → existing `try/catch` in `runQuery` → fallback non-stream → if also fails → `kind: "error"` event → red banner in view |
| Network timeout | `timeouts.query * 1000` already passed to `OpenAI({ timeout })`. AbortError → existing handler |
| CORS block (mobile WebView) | Documented in guide. SDK `dangerouslyAllowBrowser: true` already set |
| Missing domain folder | Existing `wikiVaultPath` check |
| Accidental fs call on mobile | Guard `!Platform.isMobile` before `await import("node:fs")`. Silent skip |

Cancel: existing `AbortController` works (fetch abort signal supported in mobile WebView).

## 7. Testing

| Test | Goal |
|---|---|
| `tests/mobile/platform-guard.test.ts` (new) | Mock `Platform.isMobile=true`. Verify `loadSettings` migrates backend to `native-agent`. Verify `addCommand` for ingest/lint/init **not** called |
| `tests/mobile/dispatch-guard.test.ts` (new) | Mock isMobile. `controller.dispatch("ingest", ...)` → Notice + early return, no `buildAgentRunner` |
| `tests/mobile/no-fs-imports.test.ts` (new) | Static regex check: `phases/query.ts` contains no `from "node:`. Reads file as string |
| `tests/phases/query.test.ts` (extend) | Verify `absWiki` resolved without `node:path` (vault-relative) |
| `tests/agent-runner.integration.test.ts` (extend) | `devMode.enabled=false` → fs not invoked. Mock fs throw → guard prevents propagation |
| Manual: Obsidian Mobile (iOS + Android) | Install dist via Obsidian Sync. Configure OpenRouter. Run query. Verify streaming, cancel, history persistence |

Mock setup in `vitest.mock.ts`:
```ts
vi.mock("obsidian", () => ({
  ...existing,
  Platform: { isMobile: false, isDesktop: true },
}));
```
Tests override per case via `vi.mocked`.

## 8. User Documentation — `docs/mobile-cloud-ollama.md`

New file. Sections:

1. **Overview** — what works on mobile (query / query-save), what does not (ingest, lint, init, fix, chat).
2. **Quick start** — three-step install:
   - Install plugin via Obsidian Sync or BRAT.
   - Open Settings → LLM Wiki → Native Agent.
   - Fill: `baseUrl`, `apiKey`, `model`. Save.
3. **Provider examples** — copy-paste configs:
   - **OpenRouter:** `baseUrl: https://openrouter.ai/api/v1`, `apiKey: sk-or-...`, `model: anthropic/claude-3.5-sonnet`
   - **Ollama Cloud:** `baseUrl: https://ollama.com/v1`, `apiKey: <ollama-cloud-key>`, `model: llama3.2`
   - **together.ai:** `baseUrl: https://api.together.xyz/v1`, `apiKey: ...`, `model: meta-llama/...`
   - **Self-hosted Ollama via Tailscale:** `baseUrl: https://<tailnet-name>.ts.net:11434/v1`, `apiKey: ollama`, `model: llama3.2`. Note: requires Tailscale app on phone + cert trust.
4. **API key handling** — stored in Obsidian settings (`saveData`). Plain JSON, not encrypted. Recommend per-provider scoped keys with rate limits.
5. **Troubleshooting** — CORS error → provider must allow browser origin (most cloud providers do; self-hosted Ollama needs `OLLAMA_ORIGINS=*` env var). Network timeout → increase `timeouts.query`. Empty domain → set domain in desktop session first (mobile cannot create domains in this iteration).
6. **Limits** — context truncated at 80k chars. Domain creation, ingest, lint require desktop.

## 9. Out of Scope

- On-device LLM (Phase 2: WebLLM / WASM).
- Mobile ingest / lint / init / fix / chat.
- RAG / embeddings retrieval.
- New domain creation from mobile.
- Encrypted apiKey storage.

## 10. Migration / Rollout

- Desktop users: no behavior change. `Platform.isMobile === false` → all gates pass through.
- Existing `claude-agent` config on desktop: untouched.
- Mobile install on existing vault with `claude-agent` backend: one-time auto-switch to `native-agent` + Notice. User must enter baseUrl/apiKey before first query.

## 11. Risks

| Risk | Mitigation |
|---|---|
| `node:*` import accidentally added to mobile hot path | Static test `no-fs-imports.test.ts` |
| OpenAI SDK pulls Node-only transitive deps | Already used today in desktop native-agent path; verify bundle on mobile via manual test |
| Obsidian Mobile API differs from desktop in edge cases (`vault.adapter`) | Use only `VaultTools` abstractions, no direct `getBasePath` on mobile path |
| Plain-text apiKey in `data.json` synced via Obsidian Sync | Document in guide; do not auto-mitigate this iteration |
