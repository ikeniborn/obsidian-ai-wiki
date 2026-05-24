---
status: draft
date: 2026-05-21
---
# Init: Config Folder Creation Fix + Root Log Removal

**Date:** 2026-05-21  
**Status:** Draft  
**Scope:** `src/vault-tools.ts`, `src/phases/init.ts`

---

## Problems

### 1. `!Wiki/.config/` never created on first `init`

`VaultTools.write("!Wiki/.config/_wiki_schema.md")` extracts `dir = "!Wiki/.config"` and calls `adapter.mkdir("!Wiki/.config")`. Obsidian's `DataAdapter.mkdir` is **not recursive** — if `!Wiki` does not yet exist, the call fails silently (error is swallowed in `ensureRootFiles`'s `catch {}`). Result: `.config` folder never appears, schema files never written.

Only `init` creates `!Wiki` and its structure. `reinit`, `ingest`, `query` do not.

### 2. `!Wiki/_log.md` created at wiki root

`init.ts` contains `appendLog()` (line 401) called at line 382. It writes `!Wiki/_log.md` — a root-level log entry for domain creation. This contradicts `ensureRootFiles()` which **removes** `!Wiki/_log.md` as a legacy file (line 424). The same `init` run removes it then recreates it. Logs belong inside domain folders (`!Wiki/<domain>/_log.md`) — root-level log is redundant.

---

## Solution

### Fix 1 — `VaultTools.write`: recursive directory creation

Replace single-level `mkdir` with segment-by-segment creation:

```typescript
async write(vaultPath: string, content: string): Promise<void> {
  const segments = vaultPath.split("/").slice(0, -1);
  for (let i = 1; i <= segments.length; i++) {
    const partial = segments.slice(0, i).join("/");
    if (!(await this.adapter.exists(partial))) {
      await this.adapter.mkdir(partial);
    }
  }
  await this.adapter.write(vaultPath, content);
}
```

For `!Wiki/.config/_wiki_schema.md`: creates `!Wiki`, then `!Wiki/.config`, then writes file. No changes to callers. Existing test "write creates missing dir then writes" still passes (single-level case is covered). Add new test: "write creates all ancestor dirs for nested path".

### Fix 2 — `init.ts`: remove `appendLog`

1. Remove call `await appendLog(vaultTools, wikiRootGuess, domainId)` (line 382)
2. Remove function `appendLog()` (lines 401–413) — no other callers

`ensureRootFiles` already removes legacy `!Wiki/_log.md`. After this fix it simply won't be recreated.

---

## Files Changed

| File | Change |
|---|---|
| `src/vault-tools.ts` | `write()`: recursive dir creation |
| `src/phases/init.ts` | Remove `appendLog` call + function |
| `tests/vault-tools.test.ts` | Add test for recursive ancestor creation |

---

## Out of Scope

- `ingest.ts`, `lint.ts` — domain-level `_log.md` untouched
- `ensureRootFiles` logic — unchanged beyond the bug fix in `write()`
- No new API surface, no behavior changes for callers of `VaultTools.write`
