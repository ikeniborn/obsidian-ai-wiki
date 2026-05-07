# Fixed Log Paths — Design Spec

Date: 2026-05-07

## Problem

Agent log and dev log use free-form path fields in settings. Users must manually configure paths; mistakes (wrong dir, file vs dir) silently break logging. Dev mode sub-settings (evaluatorModel) are always visible even when dev mode is off.

## Solution

Replace path fields with toggles. Paths are fixed in code: `<vaultRoot>/!Logs/agent.jsonl` and `<vaultRoot>/!Logs/dev.jsonl`. Folder created automatically on first write. Dev sub-settings hidden when dev mode disabled.

## Data Changes

### `LlmWikiPluginSettings` (src/types.ts)

| Before | After |
|--------|-------|
| `agentLogPath: string` | `agentLogEnabled: boolean` |
| `devMode.logDir: string` | _(removed)_ |

### DEFAULT_SETTINGS

```ts
agentLogEnabled: false,
devMode: { enabled: false, evaluatorModel: "sonnet" }
```

## Migration (src/main.ts)

On `loadData()`:
- If saved data has `agentLogPath` (string) → set `agentLogEnabled = agentLogPath.length > 0`, drop field
- If saved data has `devMode.logDir` → drop field (value discarded, path now fixed)

## Path Computation

Fixed paths (no user input):
```
<vaultRoot>/!Logs/agent.jsonl
<vaultRoot>/!Logs/dev.jsonl
```

On first write: `mkdirSync(join(vaultRoot, "!Logs"), { recursive: true })`. Errors swallowed silently (same as current behaviour).

### controller.ts — logEvent()

- Guard: `if (!this.plugin.settings.agentLogEnabled) return`
- Path: `join(vaultRoot, "!Logs", "agent.jsonl")` — vault root from `this.app.vault.adapter.getBasePath?.()`
- Remove old path-parsing heuristic (isDirectory / no-dot check)

### agent-runner.ts — writeDevLog() / updateDevLogEval()

- Both methods receive `vaultRoot: string` as argument
- Path: `join(vaultRoot, "!Logs", "dev.jsonl")`
- Called from `run()` which already has `vaultRoot = req.cwd ?? ""`

## UI Changes (src/settings.ts)

### General section — Agent log

Before: `addText()` with placeholder `/tmp/llm-wiki-agent.jsonl`

After: `addToggle()` bound to `s.agentLogEnabled`. Description states fixed path.

### Dev mode section

- Toggle `devMode.enabled`: add `this.display()` to `onChange` so panel rerenders
- If `!s.devMode.enabled`: skip rendering `evaluatorModel` setting
- Remove `logDir` setting entirely

## i18n (src/i18n.ts)

- `agentLog_desc`: update to describe toggle + fixed path (all 3 locales)
- `devMode_logDir_*`: remove all locale entries
- No new keys needed

## Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | Type + DEFAULT_SETTINGS |
| `src/main.ts` | Migration |
| `src/settings.ts` | UI |
| `src/i18n.ts` | Strings |
| `src/controller.ts` | logEvent() |
| `src/agent-runner.ts` | writeDevLog(), updateDevLogEval() |

## Out of Scope

- No tests added (logging paths are I/O, already untested)
- No change to log format or content
- No UI for viewing logs
