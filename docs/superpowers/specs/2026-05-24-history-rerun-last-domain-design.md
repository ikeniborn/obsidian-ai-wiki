---
review:
  spec_hash: 1fd4b91ce7156322
  last_run: 2026-05-24
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: INFO
      section: "### 32 — Re-run query from history / ### 33 — Last selected domain"
      section_hash: 797d708fed134a6e
      text: "#### Touch points heading duplicated. Fixed: renamed to '#### Files changed' in both sections."
      verdict: fixed
      verdict_at: 2026-05-24
    - id: F-002
      phase: clarity
      severity: INFO
      section: "### 33 — Last selected domain persisted in local.json"
      section_hash: d05171f504b38c68
      text: "Prose imprecise about previous=='' condition. Fixed: explanation updated to cover mid-session 'all domains' case."
      verdict: fixed
      verdict_at: 2026-05-24
  section_hashes:
    "## Features": 01ba4719c80b6fe9
    "### 32 — Re-run query from history": 797d708fed134a6e
    "### 33 — Last selected domain persisted in local.json": d05171f504b38c68
    "## What is NOT changing": aece6dfd42d8bef0
---

# Design: History Re-run & Last Domain Persistence

Date: 2026-05-24

## Features

### 32 — Re-run query from history

Allow the user to re-execute a past `query` operation directly from the history panel.

#### Scope

Only `query` operations. Other operations (`ingest`, `lint`, `init`, `format`) are intentionally excluded — they require file context or confirmation and are not safe to auto-submit blindly.

#### UI

In `renderHistory()` (`src/view.ts`), for each history item where `it.operation === "query"`, append a `↺` button to the right of the row.

#### Behavior on click

1. Set `domainSelect.value = it.domainId ?? ""`
2. Dispatch `change` event on `domainSelect` (to update log/index links and button states)
3. Set `queryInput.value = it.args[0] ?? ""`
4. Call `this.submitQuery()`

If the plugin is busy (`state === "running"`), `submitQuery()` already shows a Notice — no extra handling needed.

#### Files changed

- `src/view.ts` — `renderHistory()` only. No new methods.

---

### 33 — Last selected domain persisted in local.json

On panel open, restore the domain the user last selected. Persist across sessions via `local.json`.

#### Data model

Add `lastDomain?: string` to `LocalConfig` in `src/local-config.ts`.

Value is the domain `id` string, or `""` for "all domains". `undefined` means never saved (first launch).

#### Save

In `buildDomainRow()` (`src/view.ts`), add a `change` listener on `domainSelect` that calls:

```ts
void this.plugin.localConfigStore.save({ lastDomain: this.domainSelect!.value });
```

This fires on both user interaction and programmatic `dispatchEvent("change")` — that is acceptable since the saved value will be identical.

#### Restore

In `refreshDomains()` (`src/view.ts`), the current `previous` variable captures `domainSelect.value` before repopulation. On first open `previous` is `""`.

Add: if `previous === ""` (domainSelect has no value — either panel just opened, or user has "all domains" selected), fall back to `lastDomain` from `localConfigStore`. In the "all domains" case, `lastDomain` was already saved as `""` by the change listener, so the OR expression evaluates to `""` and no unintended restore occurs.

```ts
const restoreTarget = previous || (await this.plugin.localConfigStore.load()).lastDomain;
```

Then the existing restore logic applies — only restores if the domain id exists in the current list.

#### Files changed

- `src/local-config.ts` — add `lastDomain?: string` to `LocalConfig` interface
- `src/view.ts` — `buildDomainRow()`: add save listener; `refreshDomains()`: add restore logic

---

## What is NOT changing

- History rendering behavior (click still shows result in result panel)
- `RunHistoryEntry` type — no changes
- Settings (`data.json`) — no changes
- Any other file
