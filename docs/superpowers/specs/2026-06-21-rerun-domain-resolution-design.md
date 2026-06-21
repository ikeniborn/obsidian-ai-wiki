# Re-run domain resolution

**Date:** 2026-06-21
**Branch:** `dev/rerun-domain-resolution`
**Status:** approved design

## Problem

Re-running a query from the history list (sidebar panel) silently runs it against
the **wrong domain** — typically the first domain in the list (`domains[0]`).
Reported on mobile, but the root cause is platform-independent.

### Reproduction

1. Open the AI wiki sidebar panel.
2. Open the **History** section.
3. Click the **↺ Re-run** button on a previous query.
4. The query runs against the wrong domain (not the domain the original query used).

A direct query (typing a question and pressing **Ask**) works, because the user
picks a valid domain in the dropdown first.

### Root cause

The re-run handler (`src/view.ts`, the `rerunBtn` click listener) routes the
domain through the DOM `<select>` element as if it were the source of truth:

```js
this.domainSelect.value = it.domainId ?? "";   // history entry knows its domain
this.domainSelect.dispatchEvent(new Event("change"));
this.queryInput.value = it.args[0] ?? "";
this.submitQuery();                             // reads domainSelect.value back
```

`submitQuery()` then calls `controller.query(q, this.domainSelect?.value || undefined)`.

Setting `<select>.value` to an id that has **no matching `<option>`** is silently
ignored by the browser — `.value` falls back to `""`. That happens when:

- `refreshDomains()` (async, `src/view.ts`) has not populated the select yet, or
  its `loadDomains()` call failed (more likely on mobile, where `onOpen` re-runs
  on every pane switch), or
- the history entry's `domainId` no longer matches a current domain (renamed /
  deleted), or
- the entry has no `domainId` (older entry, or a command-palette run).

With `.value === ""`, `submitQuery` sends `"" || undefined` → `undefined`.
In `src/agent-runner.ts` an `undefined` `domainId` skips the per-domain filter,
so the full domain list reaches `runQuery`, which unconditionally takes
`domains[0]` (`src/phases/query.ts`). Result: the wrong domain, with no error.

Re-run also calls `submitQuery()` directly. `submitQuery` itself has no
domain guard — the "no domain → can't query" protection is the **disabled Ask
button** (`askBtn.disabled = !hasDomain` in `updateButtonAvailability`,
`src/view.ts`). Calling `submitQuery()` from the re-run handler bypasses that
disabled-button state entirely.

### Why a direct Ask works but re-run does not

A direct Ask uses whatever valid domain the user selected in the dropdown.
Re-run forces `it.domainId` through the DOM select, and when that round-trip
drops the value, it falls through to `domains[0]`.

## Scope

Fix the **re-run-from-history path only**. The history entry already stores an
authoritative `domainId` (`RunHistoryEntry.domainId`, written in
`src/controller.ts`); re-run must use it directly instead of laundering it
through the DOM.

**Out of scope** (intentionally left unchanged):

- The `domains[0]` fallback in `src/phases/query.ts` and the command-palette
  query path (`src/main.ts`) that runs without a `domainId`. These keep their
  current "default to first domain" behavior.
- The `detectDomain` / `DomainModal` `domains[0]` fallbacks (ingest, modals).

## Design (Approach A)

Make the history entry's `domainId` the source of truth for re-run. Validate it
against the current domain list; never silently fall back to `domains[0]`.

### Behavior

On **↺ Re-run** click:

1. Resolve the domain from the history entry, not the DOM select.
2. If the entry has a `domainId` that matches an existing domain → run the query
   with that `domainId` passed **directly** to `controller.query`.
3. If the `domainId` is missing or does not match any current domain → show a
   `Notice` and do **not** run the query.

Busy-state handling is unchanged: `controller.query` → `dispatch` already guards
with `isBusy()`.

### Code changes

1. **Pure helper in a new standalone module `src/rerun-domain.ts`** (testable in
   isolation). It lives in its own file — not in `src/view.ts` — so the headless
   eval imports a tiny dependency-light module instead of pulling the whole
   plugin graph (`view.ts` transitively imports `./modals`, `./main`). This
   mirrors the established `src/source-deletion.ts` pattern.

   ```ts
   import type { RunHistoryEntry, DomainEntry } from "./types"; // DomainEntry from ./domain

   export function resolveRerunDomain(
     entry: RunHistoryEntry,
     domains: DomainEntry[],
   ): { ok: true; domainId: string } | { ok: false; reason: "missing" | "not-found" }
   ```

   - `entry.domainId` falsy → `{ ok: false, reason: "missing" }`
   - `entry.domainId` not in `domains` → `{ ok: false, reason: "not-found" }`
   - otherwise → `{ ok: true, domainId: entry.domainId }`

   `src/view.ts` imports `resolveRerunDomain` from `./rerun-domain`.

2. **Re-run handler in `src/view.ts`** (replaces the DOM round-trip):

   - `const domains = await this.plugin.controller.loadDomains();` — authoritative
     list, independent of the select's current population state / mobile race.
   - `const r = resolveRerunDomain(it, domains);`
   - `if (!r.ok) { new Notice(<message for r.reason>); return; }`
   - For UX, sync the dropdown: `if (this.domainSelect) this.domainSelect.value = r.domainId;`
     (the option exists because `domains` came from the same source).
   - `void this.plugin.controller.query(it.args[0] ?? "", r.domainId);`

   The DOM select is no longer the source of truth for the query's domain.

### i18n

Add message key(s) for the failure `Notice` in **all three** locales — `en`
(default), `ru`, `es` (`src/i18n.ts`) — or `tsc` fails on the missing key in the
typed locale objects. Key e.g. `view.rerunDomainMissing` (covers both "missing"
and "not-found", or one key each). Wording: domain for this history entry is
unavailable; pick a domain manually.

## Testing

- **Unit (headless):** test `resolveRerunDomain` via the existing out-of-vault
  esbuild harness (`--alias:obsidian=stub`). Cases:
  - valid `domainId` present in list → `{ ok: true, domainId }`
  - `domainId` undefined/empty → `{ ok: false, reason: "missing" }`
  - `domainId` not in list (renamed/deleted) → `{ ok: false, reason: "not-found" }`
- **Manual (mobile + desktop):** re-run a history entry; confirm the query runs
  against the entry's original domain. Re-run an entry whose domain was deleted;
  confirm a `Notice` appears and nothing runs.

## Docs

Update `docs/wiki` (iwiki) pages covering query / history re-run / domain
resolution to reflect that re-run uses the history entry's stored `domainId`
and errors out (rather than defaulting) when it cannot be resolved.
