---
title: Move agent.jsonl and dev.jsonl to !Wiki/.config
date: 2026-05-21
status: approved
review:
  passed: true
---

## Goal

Move `!Logs/agent.jsonl` and `!Logs/dev.jsonl` to `!Wiki/.config/_agent.jsonl` and `!Wiki/.config/_dev.jsonl`. Add `_` prefix to match convention established by `_domain.json`.

No data migration. Old files in `!Logs` remain as-is.

## New Paths

| Old | New |
|-----|-----|
| `!Logs/agent.jsonl` | `!Wiki/.config/_agent.jsonl` |
| `!Logs/dev.jsonl` | `!Wiki/.config/_dev.jsonl` |

## Files Changed

### `src/controller.ts` — `logEvent()`

Replace `dir`/`path` variables and mkdir logic:

```ts
// Before
const dir = "!Logs";
const path = `${dir}/agent.jsonl`;
if (!(await adapter.exists(dir))) await adapter.mkdir(dir);

// After
const path = "!Wiki/.config/_agent.jsonl";
if (!(await adapter.exists("!Wiki"))) await this.app.vault.createFolder("!Wiki").catch(() => {});
if (!(await adapter.exists("!Wiki/.config"))) await this.app.vault.createFolder("!Wiki/.config").catch(() => {});
```

### `src/agent-runner.ts` — `logDevEntry()` and `updateDevLogEval()`

`VaultTools` exposes only `adapter` (no `vault.createFolder`), so use `adapter.mkdir()` for the safety-net dir creation. In normal usage `.config` already exists after init.

```ts
// Before (logDevEntry)
const dir = "!Logs";
const path = `${dir}/dev.jsonl`;
if (!(await adapter.exists(dir))) await adapter.mkdir(dir);

// After (logDevEntry)
const path = "!Wiki/.config/_dev.jsonl";
if (!(await adapter.exists("!Wiki"))) await adapter.mkdir("!Wiki");
if (!(await adapter.exists("!Wiki/.config"))) await adapter.mkdir("!Wiki/.config");

// Before (updateDevLogEval)
const path = "!Logs/dev.jsonl";

// After (updateDevLogEval)
const path = "!Wiki/.config/_dev.jsonl";
```

### `src/i18n.ts` — 3 locales (en, ru, es)

Update `agentLog_desc` to reference new path. Remove "Folder is created automatically" — `.config` dir already exists after init.

```
// EN
"Log agent events to <vault>/!Wiki/.config/_agent.jsonl."

// RU
"Записывает события агента в <vault>/!Wiki/.config/_agent.jsonl."

// ES
"Registra eventos del agente en <vault>/!Wiki/.config/_agent.jsonl."
```

## Out of Scope

- No migration of existing `!Logs/*.jsonl` data
- No deletion of `!Logs` directory
- No refactoring of log logic
