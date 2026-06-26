---
review:
  spec_hash: d0e5bc69dacb3f5e
  last_run: 2026-06-26
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings: []
chain:
  intent: null
---

# Dev-mode rating buttons: visual feedback & reliable persistence

Date: 2026-06-26
Branch: `dev-fix-rating-buttons` (from `master`, in-place, no worktree)

## Problem

In dev mode the sidebar renders 👍/👎 rating buttons after a finished run
(`renderRatingRow`, `src/view.ts:822`). Reported symptoms:

1. Buttons appear dead — clicking gives no visible response.
2. A record is written to `eval.jsonl`, but its `rating` stays `null` ("score
   not updated").

## Root cause (single)

There is **no CSS for the selected state**. `grep rating src/styles.css` → 0;
`dist/styles.css` → 0. The click handler toggles the `is-active` class and calls
`rateRun`, but no rule styles `.ai-wiki-rating-btn` or `.is-active`, so a click
produces no visible change.

Persistence logic itself is correct: `updateEvalRating` (`src/eval-log.ts:76`)
flips the value — first 👍 click sets `up`, a second identical click clears it
back to `null`. The write path (agent-runner, `visionTempBaseDir`) and the update
path (controller `pluginDir()`) both resolve to `manifest.dir`, so they target
the same file.

Failure chain: user clicks 👍 → nothing visible (no CSS) → assumes it failed →
clicks 👍 again → toggle flips back to `null`. Net result: `rating: null` in the
file and "buttons don't react". Both reported symptoms share this one cause.

Confirmed: `eval.jsonl` in the Work vault holds 1 record with
`rating: null, recognitionRating: null`.

## Goals

- A clicked rating button is visibly selected; unselected buttons are dimmed.
- Selected button uses an accent fill: 👍 green, 👎 red. Unselected → muted
  (lower opacity).
- Reselecting the other axis switches the highlight; clicking the active button
  again clears the selection (changed-my-mind).
- The shown state always reflects what was actually persisted to `eval.jsonl`.

Non-goals: no toast/notification, no aggregate "score" panel, no new i18n
strings (labels already exist: `ratingUp/ratingDown/ratingFormatting/
ratingAnswer/ratingRecognition`).

## Design

### Fix A — CSS (`src/styles.css`)

Add rules using Obsidian theme variables (light/dark safe), consistent with
existing `.ai-wiki-*` patterns:

- `.ai-wiki-rating-row` — flex, gap, vertical alignment for label + buttons.
- `.ai-wiki-rating-label` — muted secondary text.
- `.ai-wiki-rating-btn` — base state: `cursor: pointer`, dimmed
  (`opacity: ~0.5`), subtle border; `:hover` brightens.
- Buttons get a permanent modifier at creation: `is-up` on 👍, `is-down` on 👎.
- `.ai-wiki-rating-btn.is-up.is-active` — green fill (`--color-green` /
  accent), full opacity.
- `.ai-wiki-rating-btn.is-down.is-active` — red fill (`--color-red`).

### Fix B — UI reflects persisted truth (`src/eval-log.ts`, `src/controller.ts`, `src/view.ts`)

Replace the optimistic, UI-only toggle with a write-then-render flow so the
button state can never diverge from the file:

- `updateEvalRating` returns the resulting `Rating` (`"up" | "down" | null`),
  or `undefined` when the write fails / the record is not found.
- `rateRun` (`src/controller.ts:195`) returns that value through.
- In `renderRatingRow`, the click handler `await`s `rateRun`, then sets
  `is-active` on the button matching the returned value and clears the other.
  On `undefined`, it leaves the buttons unchanged (visibly signalling the write
  did not take).

This removes the two-sources-of-truth pattern (independent UI toggle vs. persist
flip) and directly closes the "score not updating" trust gap.

### Reselection / clear

Already handled by `updateEvalRating`'s flip semantics; it now becomes visible.
Clicking the active button returns `null` → both buttons render dimmed.

## Affected files

- `src/styles.css` — new rating CSS (~20 lines).
- `src/eval-log.ts` — `updateEvalRating` return type.
- `src/controller.ts` — `rateRun` return type.
- `src/view.ts` — `renderRatingRow` handler rework + `is-up`/`is-down` classes.

## Build & deploy

`npm run build` writes `dist/main.js`, `dist/styles.css`, `dist/manifest.json`
(and root `manifest.json`). The build does **not** copy into the vault, so the
artifacts must be copied to
`<vault>/.obsidian/plugins/ai-wiki/` (`main.js`, `styles.css`, `manifest.json`)
and the plugin reloaded in Obsidian.

## Verification

With dev mode enabled, run a `query`, then on the result:

1. Click 👍 → button shows green fill, 👎 stays dimmed.
2. Click 👎 → 👎 shows red fill, 👍 returns to dimmed.
3. Click 👎 again → both dimmed.

Check `eval.jsonl` for that `runId` after each step: `rating` transitions
`up → down → null`. This confirms feedback, persistence, and reselection in one
pass.
