# Design: vision pipeline optimization (temp store + heartbeat watchdog)

**Date:** 2026-06-07
**Status:** approved
**Intent:** [2026-06-07-vision-pipeline-optimization-intent.md](../intents/2026-06-07-vision-pipeline-optimization-intent.md)

## Problem

The `format` operation's vision pre-step loops forever on pages with ≥4-5 attachments. The idle-watchdog in `AgentRunner.run` (`src/agent-runner.ts`) wraps the whole operation and resets its timer only on `assistant_text` / `llm_call_stats` events. Vision calls (`callVisionLlm` in `src/phases/attachment-analyzer.ts`) are `stream: false` and emit none of those; an excalidraw render+analysis takes ~65-78s. Five attachments = ~350s of silence > the 300s idle threshold → the combined signal aborts the in-flight call → the operation aborts → the watchdog restarts `runFormat` from scratch → all vision calls are redone → never converges.

## Approach

Chosen: **A — optional `VisionTempStore` threaded via the `AgentRunner` constructor + broadened heartbeat.** Rejected: B (new RunEvent + RunRequest contract change → proposal-first escalation) and C (heartbeat-only; violates req #2/#3).

Three coordinated changes:
1. **Heartbeat** — reset the idle timer on `tool_use` / `tool_result` too, so per-attachment progress prevents the cumulative-time abort while a genuinely hung single call is still caught.
2. **Temp store + resume** — persist each attachment's description (and excalidraw PNG) to a per-run dir in the plugin folder; on an internal idle-retry, completed attachments resume from the store instead of re-calling the LLM.
3. **Excalidraw PNG to plugin dir** — rendered PNGs are written under the plugin directory, never the vault.

Backward compatibility is the design constraint: the store is **optional everywhere**. When absent (every existing test call site, and any non-format/non-vision run) behavior is byte-for-byte today's. No change to the `RunRequest` external contract.

## Components

### New: `src/phases/vision-temp-store.ts`

```
class VisionTempStore {
  constructor(vaultTools: VaultTools, dir: string)   // dir = "<manifest.dir>/.vision-tmp/<runId>"
  async getDescription(path): Promise<string | null> // read <key(path)>.json → desc; null on miss/error
  async putDescription(path, desc): Promise<void>     // write <key(path)>.json
  async putPng(path, b64): Promise<void>              // write <key(path)>.png (req #3); fire-and-forget
  async cleanup(): Promise<void>                       // rmdir(dir, recursive)
}
```

- `dir` lives under `manifest.dir` (= `.obsidian/plugins/<id>/...`), which is vault-relative. Files there are written via the normal vault adapter but are **not** indexed as notes → satisfies "not in vault structure" (req #3).
- `key(path)` = deterministic sanitize (`/` → `_`, strip non-alphanumerics, keep extension hint) — no crypto dependency, stable across retries within a run.
- Every method swallows its own errors and degrades to a no-op / `null` — the store must never block or fail a format.

### Changed: `src/agent-runner.ts`

- Constructor: add 6th param `visionTempBaseDir?: string`.
- `run()`: compute `runId = Date.now().toString(36)` **once, before** the retry `while` loop. Build a `VisionTempStore` only when `req.operation === "format"` && `settings.vision?.enabled` && `visionTempBaseDir` is set; otherwise leave it `undefined`. Call `store?.cleanup()` in a `finally` that wraps the entire `while` loop (runs on success, idle-exhaustion throw, and user cancel).
- `resetTimer` trigger (line ~176): also reset on `tool_use` and `tool_result`.
- `runOperation`: accept the optional store and pass it into the `runFormat` call (line ~126).

### Changed: `src/phases/format.ts`

- `runFormat`: add a trailing optional param `visionTempStore?: VisionTempStore` (after `visionSettings`). In the vision loop (lines ~105-122), before calling `analyzeSingleAttachment`:
  - `const cached = await visionTempStore?.getDescription(path)` — on hit: `visionDescriptions.set(path, cached)`, emit `tool_result` (cached), `continue` (no LLM call, also pulses the heartbeat).
  - on miss: analyze as today, then `await visionTempStore?.putDescription(path, description)` when non-null.
- Pass the store into `analyzeSingleAttachment` so the excalidraw branch can persist its PNG.

### Changed: `src/phases/attachment-analyzer.ts`

- `analyzeSingleAttachment`: add trailing optional `visionTempStore?: VisionTempStore`. In the excalidraw branch, after `renderExcalidrawPng` returns `b64`, call `await visionTempStore?.putPng(path, b64)` (fire-and-forget) before `analyzeExcalidraw`.

### Changed: `src/vault-tools.ts` + `src/controller.ts`

- `VaultAdapter`: add `writeBinary?(path: string, data: ArrayBuffer): Promise<void>`. `VaultTools.writeBinary` delegates (throws a clear error if the adapter lacks it). The real Obsidian `DataAdapter` already implements it; the controller's `Object.create(rawAdapter)` wrapper inherits it.
- `controller.ts`: pass `this.plugin.manifest.dir` as `visionTempBaseDir` into `new AgentRunner(...)` at line ~559.

## Data flow (format with vision)

```
run() [runId computed, store built]
 └─ while(retry):
      runFormat → vision loop, per embed path:
         store.getDescription(path)?
           ├ hit  → map.set(desc); yield tool_result(cached)        ← resume, 0 LLM, heartbeat pulses
           └ miss → yield tool_use → analyzeSingleAttachment
                       └ excalidraw: render → store.putPng → analyzeExcalidraw
                    → store.putDescription → yield tool_result
      → single format call (all descriptions in visionBlock, unchanged)
 └─ finally: store.cleanup()  → tmp dir removed
```

An idle-retry re-enters `runFormat` with the **same** store (same `runId` dir), so already-analyzed attachments resolve from cache instantly and only the incomplete one is re-sent. The final streaming format call resets the heartbeat on `assistant_text`, so it is independently resilient.

## Error handling

- Store `mkdir`/`read`/`write` failures → swallowed; the run proceeds without caching (today's behavior).
- `putPng` is fire-and-forget; a render/write failure never blocks the analysis or the format.
- `cleanup()` runs in `finally`; its errors are swallowed.
- User cancel (`req.signal`) still triggers `finally` → temp dir is cleaned.

## Test plan

- **`tests/vision-temp-store.test.ts`** (new): put→get round-trip; `getDescription` miss returns `null`; `putPng` writes under the plugin-dir path (not the vault); `cleanup` calls `rmdir(dir, recursive)`; every method swallows adapter throws.
- **`tests/agent-runner.test.ts`**: new test — an operation that emits `tool_use`/`tool_result` past the idle threshold does NOT abort/retry (heartbeat). Existing watchdog tests stay green (their mocks emit no tool events).
- **`tests/format-retry.test.ts` / `tests/phases/format.test.ts`**: new test — a second `runFormat` with the same store does NOT call `analyzeSingleAttachment` (description served from cache). Existing vision tests stay green (store `undefined`).
- **`tests/attachment-analyzer.test.ts`**: new test — excalidraw analysis calls `store.putPng` with the rendered b64.
- **Regression**: full `npm test`, `npm run lint`, `lat check`.

## Documentation

Update `lat.md/operations.md#Operations#Format` and/or `lat.md/llm-pipeline.md` to describe the temp-store + resume + heartbeat behavior, plus `lat.md/tests.md` for the new specs. `lat check` must pass.

## Acceptance (from intent)

**Desired Outcomes:**
- Format of a page with 5 `.excalidraw` attachments completes to a `format_preview` — no "LLM idle … retrying" and no "Request was aborted" in the progress log.
- Each attachment is analyzed by exactly one LLM call per run, its description written to a temporary store keyed by the run.
- On an internal idle-retry, already-analyzed attachments are resumed from the temp store — never re-sent to the LLM.
- All vision descriptions are combined into a single formatting pass (existing `visionBlock` behavior preserved).
- Excalidraw PNG renders live in the plugin directory (`<pluginDir>/.vision-tmp/<runId>/`), never in the vault structure, and are deleted when the run finishes.

**Done when:** format of the real FFBI.md (5 `.excalidraw`) reaches `format_preview` with all 5 descriptions present, the progress log shows no "retrying"/"aborted", the plugin temp dir is empty after the run, and `npm run lint` + tests + `lat check` are green.
