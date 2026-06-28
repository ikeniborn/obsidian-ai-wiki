---
review:
  spec_hash: 0e1982c63a690c7d
  last_run: 2026-06-28
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "6.2 Comment as seed feedback"
      section_hash: cbba7e74b077e0f1
      fragment: "cap at N (e.g. 20) bullets, trim length"
      text: "Per-bullet length trim has no explicit char bound (only the bullet-count cap is concrete)."
      fix: "State a concrete per-comment char cap (e.g. trim each comment to ~200 chars) so the feedback block size is bounded."
      verdict: accepted
      verdict_at: 2026-06-28
chain:
  intent: null
---
# Historical rating + per-run comment → DSPy opinion — Design

**Date:** 2026-06-28
**Status:** Approved (brainstorming)
**Branch:** `dev-historical-rating-comment`

## 1. Problem

Three gaps in the dev-mode eval/rating flow (see [[operations#Dev-Mode Eval Dataset]],
[[llm-pipeline#Dev-Mode Eval Record]]):

- **R1 — Historical entries can't be rated.** Rating rows render only in `finish()`
  for the just-finished run (and in the format preview). Clicking a history row
  (`src/view.ts#renderHistory` click handler) re-renders only the entry's `finalText`
  markdown — no rating rows. Older runs are unratable.
- **R2 — Stale rating leaks across entries.** `ratingSection` is created in `finish()`
  and cleared only in `setRunning()` (next run start). The history-row click never
  touches `ratingSection`, so the previous run's rating rows stay visible above a
  *different* entry's result. Additionally `renderRatingRow` never reads the persisted
  rating, so the 👍/👎 active state is not restored when a result is shown.
- **R3 — No per-answer comment.** There is no way to attach a free-form human note to a
  run. Such notes are valuable optimizer signal: they should be reused later in the
  per-operation DSPy prompt optimization as a human "opinion".

## 2. Goals / Non-goals

**Goals**
- Rate any run — fresh or historical — with the rating bound to that run's `runId`,
  validated independently (no cross-entry leak).
- Restore persisted 👍/👎 state when any result is displayed.
- Add one free-form comment per run (independent of the 👍/👎 rating), persisted to
  `eval.jsonl`.
- Consume the comment in the DSPy optimizer as a per-operation "opinion"
  (seed-augmentation), and migrate the dataset readers from the legacy scalar `rating`
  to the per-axis `ratings` map.

**Non-goals**
- No change to rating axes, the `OPERATION_AXES` registry, or telemetry/provenance.
- No new sync of `eval.jsonl` (still per-device, plugin dir — by design).
- No LLM judge (the optimizer stays judge-free).
- Comment is not injected into interactive improvement (chat / format-refine /
  lint-chat) at runtime — it is dataset-only.

## 3. Data model

`eval.jsonl` is the single source of truth, keyed by `runId` (= `RunHistoryEntry.id`
= `${startedAt}`). Dev-mode only.

`EvalRecord` (`src/eval-log.ts`) gains one optional field:

```ts
comment?: string;   // free-form human note, one per run, set from the UI after the run
```

`ratings: Record<axisId, Rating>` already exists. No schema break — `comment` is
optional and `ratings` already present. A `runId` with no record (devMode was off, or
the line was pruned by `historyLimit`) yields no rating/comment rows.

## 4. Plugin: read/write helpers (`src/eval-log.ts`)

Two new functions, mirroring the existing `updateEvalRating` (all eval-log I/O already
swallows errors so it never blocks a run or the UI):

- `readEvalRecord(adapter, pluginDir, runId): Promise<{ ratings: Record<string, Rating>; comment: string } | undefined>`
  — scan `eval.jsonl`, find the record by `runId` (last match wins, as
  `updateEvalRating` does), return its `ratings` map (default `{}`) and `comment`
  (default `""`). Returns `undefined` on miss/parse/read failure. Tolerates legacy lines
  (missing `ratings`).
- `updateEvalComment(adapter, pluginDir, runId, comment): Promise<string | undefined>`
  — set `comment` in place by `runId`, re-serialize the line, write back. Returns the
  persisted comment, or `undefined` when no record matched / write failed (so the caller
  can avoid showing unpersisted state). Exact structural mirror of `updateEvalRating`.

`src/controller.ts` — thin wrappers, both gated on `devMode.enabled` (return
`undefined` when off):

- `readRun(runId): Promise<{ ratings; comment } | undefined>` → `readEvalRecord`.
- `commentRun(runId, comment): Promise<string | undefined>` → `updateEvalComment`.

## 5. Plugin: shared result-render path (`src/view.ts`) — fixes R1 + R2

**Root cause (R2):** `ratingSection` lifetime is tied to `finish()`/`setRunning()`, and
the history click bypasses both. **Fix:** a single shared render path used by *both*
`finish()` and the history-row click, which always tears down and rebuilds the rating
UI bound to the displayed `runId`.

Extract `renderResultFor(entry: RunHistoryEntry): Promise<void>`:

1. `this.ratingSection?.remove(); this.ratingSection = null;` — always drop the prior
   section (kills the leak).
2. Render `entry.finalText` into `finalEl`; reveal `resultSection` (same as today).
3. If `devMode.enabled && entry.status === "done" && entry.operation !== "format"` and
   `OPERATION_AXES[entry.operation]` has non-vision axes:
   - `const persisted = await this.plugin.controller.readRun(entry.id);`
   - create a fresh `ratingSection` under `resultSection`;
   - for each axis, `renderRatingRow(section, entry.id, axis.id, label, persisted?.ratings[axis.id] ?? null)`;
   - `renderCommentBox(section, entry.id, persisted?.comment ?? "")`.

`finish()` keeps its current responsibilities (status, metrics, chat section, history
refresh) but delegates the result-body + rating/comment rendering to `renderResultFor(entry)`.
The history-row click handler calls `void this.renderResultFor(it)` instead of the
inline markdown render.

Because the rating rows are rebuilt per displayed `runId` and their state is read from
`eval.jsonl` for *that* `runId`, the rating is bound to each operation run and validated
independently — never carried over via UI state (R2), and historical entries are now
ratable (R1).

**Format limitation (explicit, not an oversight).** `format` is excluded from this
history path (`entry.operation !== "format"`), matching current `finish()` behaviour:
its `formatting`/`recognition` axes are bound to the ephemeral preview (vision-gated, the
preview's temp file is gone for a past run). So a historical `format` entry shows its
report on click but no rating/comment rows; format rating/comment stays live-preview-only
(§5.3). All other operations get historical rating + comment via the history path.

### 5.1 `renderRatingRow` — initial state

Add a parameter `initial: Rating`. On render, call the existing `render(initial)` so the
👍/👎 active class reflects the persisted value. Click handling is unchanged
(`controller.rateRun` → persisted value → `render`).

### 5.2 `renderCommentBox(parent, runId, initialComment)`

New method: a labelled `textarea` pre-filled with `initialComment`, a **Save** button,
and a transient "saved" indicator. On save: `const saved = await controller.commentRun(runId, textarea.value); if (saved !== undefined) showSavedIndicator();`. On save failure
(`undefined`) the textarea content is kept. Dev-mode gated (the box is only created from
the dev-mode branch in `renderResultFor` / the format preview).

### 5.3 Format preview path

`renderFormatPreview` already renders its axes for the run's `runId`. Extend it to:
- load `controller.readRun(runId)` and pass each axis's persisted rating to
  `renderRatingRow`;
- render `renderCommentBox(section, runId, persisted?.comment ?? "")` alongside the axes.

### 5.4 i18n (`src/i18n.ts`)

Add `view.commentPlaceholder`, `view.commentSave`, `view.commentSaved` in en/ru/es,
next to the existing `rating*` keys.

## 6. DSPy: scalar→ratings migration + comment as opinion

### 6.1 Primary-axis signal (`scripts/dspy/lib/loader.py`)

Define a per-operation primary axis (the axis whose 👍/👎 reflects answer/output prompt
quality):

| operation | primary axis |
|---|---|
| query | `answer` |
| chat | `answer` |
| format | `formatting` (recognition stays the reserved `:recognition` path) |
| ingest | `page` |
| init | `coverage` |
| lint | `fix` |
| lint-chat | `fix` |
| delete | `rebuild` |

Signal precedence (chosen to never drop a labelled record):

```
up/down = ratings[PRIMARY_AXIS]   if it is a valid "up"/"down"
        else scalar `rating`      (legacy record, no ratings map)
        else skip (unlabelled)
```

A record qualifies (is kept by `load_examples`) when this resolved signal is `up`/`down`.
The comment is carried through into the example dict (`comment` key, default `""`); it
never affects which records are kept and never switches the signal source.

### 6.2 Comment as seed feedback (`scripts/dspy/lib/optimizer.py`)

`up` is taken from the resolved primary-axis signal (§6.1), not the bare scalar.

Build a **"Human reviewer feedback"** block per bucket from the trainset comments,
grouped by the resolved signal:
- `down` + comment → "Problems to fix" bullets;
- `up` + comment → "What to keep" bullets;
- comment present but signal unlabelled → "Notes" bullets.

Dedup identical comments, cap at N (e.g. 20) bullets, trim length. **Prepend** the block
to `template_content` (the seed) *before* `make_signature` — this is the seed
augmentation. The block has no `{{placeholders}}`, so `restore_placeholders` is
unaffected. The jaccard metric and the 👍-guard are unchanged. When the bucket has no
comments, the block is empty and behaviour is byte-identical to today.

The written output remains `restore_placeholders(lm, augmented_template, compiled.signature.instructions)`
— MIPROv2 rewrites the (augmented) seed instruction; the feedback guidance is absorbed
into the rewrite, not appended verbatim.

### 6.3 Report reader (`scripts/eval.ts`)

`scripts/eval.ts` reads the same legacy scalar `rating`; migrate it to the resolved
primary-axis signal (§6.1) so the report is correct on new records, and add a per-bucket
comment count. Keep tolerating legacy lines.

### 6.4 DSPy docs

Update `scripts/dspy/CLAUDE.md` "Input Format" to document the `ratings` map, the
primary-axis resolution, and the `comment` field.

## 7. Error handling

- All `eval-log.ts` reads/writes return `undefined` on any failure → UI shows no
  rating/comment rows; comment-save keeps the textarea content.
- DSPy: records with no resolvable signal are skipped (as today). A mixed log
  (legacy scalar + new `ratings`) is read correctly by both `loader.py` and `eval.ts`.
  Empty feedback block → unchanged optimizer behaviour.

## 8. Testing / verification

- **Plugin (no JS test runner configured)** — verify the pure helpers
  (`readEvalRecord`, `updateEvalComment`) out-of-vault via an `eval/eval-comment/run.ts`
  harness (project convention, cf. `eval/source-deletion`): match-by-runId, last-match
  wins, legacy-line tolerance, in-place comment update. Manual dev-mode checks:
  1. run an op → rate → write comment → Save; reopen → state restored;
  2. select an older history entry → its *own* ratings/comment load, no leak from the
     previous result;
  3. rate/comment a historical entry → persisted to `eval.jsonl`.
- **DSPy** — `make test` (pytest): loader primary-axis selection + legacy fallback +
  comment passthrough; optimizer feedback-block aggregation (down/up/notes grouping,
  dedup, cap) and that the metric + 👍-guard + `restore_placeholders` are unchanged.
- `npm run eval` — report still works on a mixed log.

## 9. Docs (post-implementation, mandatory per CLAUDE.md)

`iwiki:iwiki-ingest` for `docs/wiki/operations.md#Dev-Mode Eval Dataset` and
`docs/wiki/llm-pipeline.md#Dev-Mode Eval Record`: per-run comment field, historical
rating, per-`runId` binding fix, DSPy reads the `ratings` map + comment as seed feedback.
Then `/iwiki-lint`.

## 10. Touched files

**Plugin:** `src/eval-log.ts`, `src/controller.ts`, `src/view.ts`, `src/i18n.ts`,
`eval/eval-comment/run.ts` (new).
**DSPy / report:** `scripts/dspy/lib/loader.py`, `scripts/dspy/lib/optimizer.py`,
`scripts/dspy/tests/test_loader.py`, `scripts/dspy/tests/test_optimizer.py`,
`scripts/dspy/CLAUDE.md`, `scripts/eval.ts`.
**Docs:** `docs/wiki/operations.md`, `docs/wiki/llm-pipeline.md` (via iwiki).
