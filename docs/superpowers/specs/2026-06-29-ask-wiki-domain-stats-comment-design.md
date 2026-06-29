---
review:
  spec_hash: 616638c9814f9f17
  last_run: 2026-06-29
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: null
---

# Ask Wiki / Ask Domain Buttons, Search Stats, Comment Box — Design

**Date:** 2026-06-29
**Status:** Approved (design), pending implementation plan

## Problem

The cross-domain search shipped in 0.1.190 exposes its scope through a `Scope: [All|Domain]`
`<select>` rendered under the query input (`src/view.ts`). The dropdown is awkward: the
intent ("ask this one domain" vs "ask the whole wiki") is a two-button decision, not a
hidden selector. Three follow-up UX issues:

1. The scope selector should be replaced by two explicit buttons.
2. The dev-mode rating comment textarea is small and hard to type in.
3. A query gives no visible account of what was searched (domains, pages, tokens).

## Goals

- Replace the scope `<select>` with two buttons next to the query input:
  - **Ask Domain** — query the domain currently selected in the sidebar.
  - **Ask Wiki** — cross-domain query over every domain, behind a confirmation dialog.
- Show a search-stats block above the answer for **both** query kinds.
- Make the comment textarea full-width and twice as tall; move **Save comment** to the
  right; turn it into a disabled **Saved** confirmation after saving; nothing else in the box.

## Non-Goals

- No change to retrieval logic (`runQuery` / `runCrossDomainQuery` stay as-is except for the
  new stats emission and one extra `DomainCandidates` field).
- No new settings; no settings migration.
- No stats for `chat` / `format` / `init` / `ingest` / `lint` — stats are query-only.
- The `domainId === undefined` legacy path is untouched.

## UX — Buttons

The `ai-wiki-ask-row` (`src/view.ts`) keeps `Cancel` on the left and gains two buttons on
the right, replacing the single `Ask` button and the whole `ai-wiki-scope-row`:

| button       | enabled when                       | click action                                          |
|--------------|------------------------------------|-------------------------------------------------------|
| `Ask Domain` | a concrete domain is selected      | `submitQuery(domainSelect.value)` → single-domain     |
| `Ask Wiki`   | always (except while running)      | `ConfirmModal` → on confirm `submitQuery("*")` → cross-domain |

- **Ask Domain** is `disabled` while the sidebar is on `(all)` (value `""`); there is no
  concrete domain to target. (Resolves the "always available" wording in favour of the
  only behaviour that makes sense without a selected domain.)
- **Ask Wiki** is always enabled regardless of the sidebar selection (except while a run is
  in progress). On click it opens a `ConfirmModal` (already in `src/modals.ts`) titled with
  an "ask across all wiki domains" message; the query only dispatches on confirm.
- `setRunning` disables both buttons; `finish`/idle restores them via
  `updateButtonAvailability`.

### Removed scope machinery

- `ai-wiki-scope-row`, `scopeToggle`, `desiredScope`, `syncScope`, and the
  `localConfig.lastQueryScope` load/restore/save are all removed.
- `submitQuery()` becomes `submitQuery(domainArg: string)` and no longer computes scope; the
  caller passes `"*"` (Ask Wiki) or the sidebar domain id (Ask Domain).

### Routing (unchanged downstream)

`controller.query(q, "*")` → `runCrossDomainQuery`; `controller.query(q, domainId)` →
`runQuery`. Already implemented; only the call sites in `view.ts` change.

## UX — Search Stats Block

A `query_stats` event renders a compact block at the top of the result section, above the
answer. The block appears **before** the answer streams in (retrieval metrics are known at
that point); the "tokens sent" line is filled in once the LLM call reports usage.

### Event

```ts
// src/types.ts — new RunEvent member
{
  kind: "query_stats";
  crossDomain: boolean;
  pagesScanned: number;          // pages read/analyzed
  pagesSelected: number;         // pages handed to the LLM (in the answer context)
  domainName?: string;           // Ask Domain only
  domainsStudied?: number;       // Ask Wiki only — domains that yielded candidates
  domainsTotal?: number;         // Ask Wiki only — domains configured
  fromDomains?: string[];        // Ask Wiki only — domain names present in the final set
}
```

`inputTokens` ("tokens sent") is **not** a field of `query_stats`. It arrives later via the
existing `llm_call_stats` event (`LlmStreamStats.inputTokens`, populated from stream usage).
The view holds a reference to the stats block and fills the tokens line when the next
`llm_call_stats` for this run arrives.

### Metrics per kind

| line              | Ask Domain (`runQuery`)            | Ask Wiki (`runCrossDomainQuery`)           |
|-------------------|------------------------------------|--------------------------------------------|
| domain(s)         | `domainName` = domain.name         | `domainsStudied` of `domainsTotal`; `fromDomains` |
| pages analyzed    | `files.length` (whole domain)      | Σ `pagesScanned` over non-empty domains    |
| selected for LLM  | `selectedIds.size`                 | `finalIds.length`                          |
| tokens sent       | `inputTokens` (from `llm_call_stats`) | `inputTokens` (from `llm_call_stats`)   |

- "pages analyzed" for Ask Domain is the **whole domain** page count (`files.length`, every
  page is read by `readAll`), not the candidate pool.
- For Ask Wiki it is the sum of each non-empty domain's `files.length`.

### Emission

- **`runQuery`** (`src/phases/query.ts`): emit `query_stats { crossDomain: false,
  domainName: domain.name, pagesScanned: cand.pagesScanned, pagesSelected: selectedIds.size }`
  immediately before `answerFromContext`.
- **`runCrossDomainQuery`** (`src/phases/query-cross-domain.ts`): emit `query_stats {
  crossDomain: true, domainsStudied: poolList.length, domainsTotal: domains.length,
  fromDomains: finalNames, pagesScanned: Σ poolList[].pagesScanned,
  pagesSelected: merged.finalIds.length }` immediately before `answerFromContext`.

`pagesScanned` is a **new field on `DomainCandidates`** (`src/phases/query.ts`), set to
`files.length` inside `retrieveDomainCandidates` (where `files.length` is already known and
emitted in `graph_stats.total`). Single-domain reads it from `cand`; cross-domain sums it.

### View rendering

- New branch in `handleEvent` for `query_stats`: build `.ai-wiki-cross-stats` inside
  `resultSection`, above `finalEl`, unhiding `resultSection`. Lines are localized.
- The tokens line starts as a placeholder (e.g. `…`); the `llm_call_stats` branch updates it
  in place when a stats block exists for the current run.
- `setRunning` removes any prior stats block (held in a `private queryStatsEl` ref) so it
  never leaks across runs.

## UX — Comment Box

`renderCommentBox` (`src/view.ts`) and `src/styles.css`:

- textarea: `rows` 2 → 4 (≈ twice the height) and `width: 100%` (scales to sidebar width).
- `Save comment` button is right-aligned (`align-self: flex-end` / actions row
  `justify-content: flex-end`).
- On click: persist via `commentRun`; on success set the button label to the localized
  **Saved** and `disabled = true`. The separate status `<span>` is **removed** — the button
  state is the only confirmation ("nothing else in the box").
- An `input` listener on the textarea re-enables the button and restores the **Save comment**
  label whenever the text differs from the last-saved value (so an edit can be re-saved).

i18n: reuse `commentSave` ("Save comment"); add `commentSavedBtn` ("Saved" / "Сохранено" /
"Guardado") for the post-save button label. The old status-style `commentSaved` ("saved")
is dropped from use (removed if unreferenced elsewhere).

## i18n

- **Remove:** `scopeAll`, `scopeDomain`, `scopeHint`.
- **Rename/add:** `ask` → `askDomain` ("Ask Domain" / "Спросить домен" / "Preguntar dominio");
  add `askWiki` ("Ask Wiki" / "Спросить вики" / "Preguntar wiki").
- **Add confirm:** `askWikiConfirmTitle` + `askWikiConfirmBody` (one line describing the
  cross-domain search) for the `ConfirmModal`.
- **Add stats labels:** `statsDomain`, `statsDomainsStudied` (`(studied, total) => string`),
  `statsInfoFrom`, `statsAnalyzed`, `statsSelected`, `statsInAnswer`, `statsTokensSent`.
- **Add comment label:** `commentSavedBtn`.
- All keys added to en / ru / es.

## Local Config

`src/local-config.ts`: remove `lastQueryScope?: "all" | "domain"` from `LocalConfig`. No
migration needed — a stale key in a persisted file is ignored.

## Error Handling & Edge Cases

- Ask Domain clicked with no domain → impossible (button disabled); defensive `if (!domainArg)`
  in `submitQuery` shows the existing "enter/select" notice.
- Ask Wiki with zero domains configured → `runCrossDomainQuery` already emits
  "No domains configured."; the confirm dialog still opens, the run reports the error.
- `llm_call_stats` for a non-query op (chat/format) must not touch a query stats block: the
  update is guarded by "a stats block exists for the current run".
- Aborted run → `setRunning` of the next run clears the stale stats block; an aborted run
  emits no `result` (unchanged).
- Comment re-edit after `Saved` → `input` listener flips the button back; saving the same
  text twice is idempotent (`commentRun`).

## Testing

- `eval/cross-domain/run.ts`: extend to assert a `query_stats` event is emitted with
  `crossDomain: true`, `pagesSelected === finalIds.length`, `pagesScanned === Σ` of the
  per-domain page counts, and `fromDomains` equal to the domain names present in `finalIds`.
- `eval/` single-domain query (existing harness): assert `runQuery` emits `query_stats`
  with `crossDomain: false`, `pagesScanned === files.length`, `pagesSelected === selectedIds.size`.
- `npm run lint` for typecheck + lint (new event member, removed i18n keys, removed config field).
- Comment box and button layout are UI-only → manual verification in Obsidian.

## Docs (post-implementation, mandatory)

- `iwiki:iwiki-ingest` on `src/view.ts` and `src/phases/query-cross-domain.ts` → update the
  query/stats UI description in `docs/wiki/llm-pipeline.md` (LLM Progress Events) and the
  Cross-Domain Query section in `docs/wiki/retrieval.md`.
- `/iwiki-lint` — no broken refs, no orphans.

## Files Touched

| file | change |
|------|--------|
| `src/view.ts` | remove scope row; `Ask Domain`/`Ask Wiki` buttons + `ConfirmModal`; `submitQuery(domainArg)`; `query_stats` block + tokens fill from `llm_call_stats`; comment box resize + Saved button |
| `src/types.ts` | new `query_stats` `RunEvent` member |
| `src/phases/query.ts` | `pagesScanned` on `DomainCandidates`; emit `query_stats` (single-domain) |
| `src/phases/query-cross-domain.ts` | emit `query_stats` (cross-domain, summed `pagesScanned`) |
| `src/styles.css` | comment textarea full-width/taller; right-aligned Save; `.ai-wiki-cross-stats` block; two-button ask row |
| `src/i18n.ts` | drop scope keys; rename `ask`→`askDomain`; add `askWiki`, confirm + stats + `commentSavedBtn` labels (en/ru/es) |
| `src/local-config.ts` | remove `lastQueryScope` |
