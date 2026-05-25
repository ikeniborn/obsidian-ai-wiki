# Design: Ingest Progress — Create vs Update Labels

**Date:** 2026-05-26
**Status:** approved
**Intent:** [2026-05-25-ingest-progress-create-update-intent.md](../intents/2026-05-25-ingest-progress-create-update-intent.md)

## Overview

Single-file change to `src/phases/ingest.ts`. No changes to `types.ts`, `view.ts`, or `controller.ts`.

During ingest, the sidebar and logs currently show "Write" for every wiki page write. The fix changes the `tool_use` event `name` field to "Create" or "Update" based on whether the page already existed in the vault before the write. The final result summary is also updated to break down created vs updated counts.

## Change Points

### 1. Per-page label — `ingest.ts:174`

`existingContent` is already read at line 171-172 before the `tool_use` event is emitted. Use it directly:

```typescript
// before
yield { kind: "tool_use", name: "Write", input: { path: page.path } };

// after
yield { kind: "tool_use", name: existingContent === null ? "Create" : "Update", input: { path: page.path } };
```

`view.ts:596` renders `ev.name` as the step label — no changes needed there.
`controller.ts:715` uses `ev.name` in history — updates automatically.

### 2. Count derivation — after the write loop

`logEntries` already records `action: "СОЗДАНА" | "ОБНОВЛЕНА"` for each successful write. Derive counts from it:

```typescript
const createdCount = logEntries.filter(e => e.action === "СОЗДАНА").length;
const updatedCount = logEntries.filter(e => e.action === "ОБНОВЛЕНА").length;
```

### 3. `buildIngestSummary` — signature + result text

Change signature from `(domainId, sourcePath, written, total)` to `(domainId, sourcePath, createdCount, updatedCount, total)`.

Result text logic:

| Case | Text |
|------|------|
| only creates | `создано N стр.` |
| only updates | `обновлено N стр.` |
| mixed | `создано C, обновлено U` |
| zero | unchanged — "нет новых или изменённых страниц" |

The `written.length` (total successful) is replaced by `createdCount + updatedCount` for the success check.

## Scope

- **In scope:** `ingest.ts` only — label, counts, summary text
- **Out of scope:** lint.ts, lint-chat.ts, query.ts Write events (those are not wiki-page ingest writes)
- **Out of scope:** Error-case `tool_use` events (blocked paths, path violations) — remain "Write" with `ok: false`
- **Out of scope:** Backlink write at line 229 — remains "Write" (source file, not wiki page)

## Files Changed

| File | Change |
|------|--------|
| `src/phases/ingest.ts` | label, counts, summary |

No other files.
