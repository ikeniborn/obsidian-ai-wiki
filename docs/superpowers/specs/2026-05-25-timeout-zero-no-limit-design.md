# Design: timeout=0 means no limit per operation

**Date:** 2026-05-25
**Status:** draft
**Intent:** [docs/superpowers/intents/2026-05-25-timeout-zero-no-limit-intent.md](../intents/2026-05-25-timeout-zero-no-limit-intent.md)

## Overview

Allow per-operation timeout values of `0` to mean "no time limit". Currently `0` is rejected by validation and would cause immediate subprocess kill if it reached the client. This design fixes all three timeout enforcement layers while keeping non-zero behavior unchanged.

## Architecture

Three independent layers enforce timeouts; all three must handle `0` correctly:

1. **`runOp` abort layer** — `controller.ts`: already guards with `timeoutMs > 0`. No change needed.
2. **Subprocess kill layer** — `claude-cli-client.ts`: unconditionally calls `window.setTimeout`. Must be guarded.
3. **HTTP client layer** — OpenAI SDK `timeout` option: `0 * 1000 = 0` is passed today; SDK interprets this as "no timeout" in some versions but this is implementation-defined. Safe approach: pass `undefined` when `timeoutSec === 0`.

## Data Flow

```
settings.timeouts[opKey]  (0 = unlimited, >0 = cap in seconds)
        │
        ▼
runOp()
  ├── timeoutMs = opTimeout * 1000
  ├── if (timeoutMs > 0) → ctrl.abort() after timeout   [no change]
  └── buildAgentRunner(vaultRoot, resumeSession, opKey, timeoutSec=opTimeout)
             │
             ├── ClaudeCliClient { requestTimeoutSec: timeoutSec }
             │       └── _generate: if (timeoutSec > 0) → setTimeout kill
             │
             └── OpenAI { timeout: timeoutSec > 0 ? timeoutSec*1000 : undefined }
```

## File-by-File Changes

### `src/settings.ts` — `parseTimeoutString`

**Before:**
```ts
parts.every((n) => Number.isFinite(n) && n > 0)
```
**After:**
```ts
parts.every((n) => Number.isFinite(n) && n >= 0)
```

Negative values are still rejected. Zero is now valid per-field (e.g., `0/300/900/3600/600`).

### `src/controller.ts` — `buildAgentRunner`

Add `timeoutSec = 0` as final parameter:

```ts
private async buildAgentRunner(
  vaultRoot: string,
  resumeSessionId?: string,
  opKey?: string,
  timeoutSec = 0,
): Promise<AgentRunner>
```

Remove `Math.max` line:
```ts
// REMOVE:
const maxTimeoutSec = Math.max(...Object.values(s.timeouts));
```

Use `timeoutSec` in both client branches:

```ts
// ClaudeCliClient:
requestTimeoutSec: timeoutSec,

// OpenAI:
timeout: timeoutSec > 0 ? timeoutSec * 1000 : undefined,
```

### `src/controller.ts` — `runOp`

`buildAgentRunner` is called **before** `timeoutMs` is currently computed. Compute `opTimeoutSec` first, then pass it to both `buildAgentRunner` and the abort layer:

```ts
// Compute before buildAgentRunner call:
const opTimeoutSec = this.plugin.settings.timeouts[opKey as keyof typeof this.plugin.settings.timeouts];
const agentRunner = await this.buildAgentRunner(vaultRoot, undefined, opKey, opTimeoutSec);

// Existing abort layer — replace the separate computation with:
const timeoutMs = opTimeoutSec * 1000;
```

The existing `timeoutMs > 0` guard already handles unlimited correctly — no change needed there.

### `src/claude-cli-client.ts` — `_generate`

**Before:**
```ts
const timeoutHandle = window.setTimeout(() => {
  timedOut = true;
  child.kill("SIGTERM");
  window.setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
}, timeoutSec * 1000);
```

**After:**
```ts
const timeoutHandle = timeoutSec > 0
  ? window.setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      window.setTimeout(() => { if (child.exitCode === null) child.kill("SIGKILL"); }, SIGTERM_GRACE_MS);
    }, timeoutSec * 1000)
  : null;
```

In `finally`:
```ts
// BEFORE:
window.clearTimeout(timeoutHandle);
// AFTER:
if (timeoutHandle !== null) window.clearTimeout(timeoutHandle);
```

### `src/i18n.ts` — timeout field description

Add "0 = no limit" hint to `timeouts_desc` in all three locales (en, ru, es):

```ts
timeouts_desc: "ingest / query / lint / init / format (0 = no limit)",
```

```ts
timeouts_desc: "ingest / query / lint / init / format (0 = без лимита)",
```

```ts
timeouts_desc: "ingest / query / lint / init / format (0 = sin límite)",
```

## Invariants

- `timeoutMs > 0` guard in `runOp` is the single source of truth for the user-facing abort. Not duplicated.
- Cancel button always works: abort signal path is independent of timeout value.
- Non-zero timeouts: behavior unchanged at all three layers.
- `buildAgentRunner` is called per-operation (not cached), so per-op timeout is safe.

## Out of Scope

- Default values in `src/types.ts` stay as-is (`ingest: 300`, etc.) — all non-zero.
- No UI input validation beyond what `parseTimeoutString` provides.
