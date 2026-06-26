---
review:
  spec_hash: 1d28ac7a1791836a
  last_run: 2026-06-26
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "Key finding that narrows scope"
      section_hash: cbfc45ffb8cf61f9
      fragment: "The 👍/👎 rating row is appended as a direct child of `this.resultSection` (`src/view.ts:948`)."
      text: "Code anchor `src/view.ts:948` is off by one statement. At line 948 the source is `this.renderRatingRow(this.resultSection, entry.id, \"answer\", ...)` is the call, but the surrounding prose in Problem §1 cites :948 for the *append* whereas the append/createDiv inside renderRatingRow lives in renderRatingRow (def at view.ts:822), not at 948. The cited line is the call site, not where the row is rooted; a reader chasing :948 to find the rooting logic lands on the wrong statement."
      fix: "Cite `src/view.ts:947-948` as the *call site* and `src/view.ts:822` (renderRatingRow) as where the row is appended; or reword to 'rendered via renderRatingRow into this.resultSection (call at view.ts:948, append in renderRatingRow at view.ts:822)'."
      verdict: fixed
      verdict_at: 2026-06-26
    - id: F-002
      phase: clarity
      severity: WARNING
      section: "Design — 1. Rating schema — ratings map + axis registry"
      section_hash: e57a91aa778b94ca
      fragment: "interface AxisDef { id: string; labelKey: keyof I18nView; gate?: \"vision\"; }"
      text: "`keyof I18nView` references a type that does not exist. src/i18n.ts defines `type I18n = typeof en` (line 320, NOT exported) and the view strings live at `I18n[\"view\"]`; there is no `I18nView` type anywhere in src/. Implementing AxisDef literally would not compile, and `I18n` itself is unexported so it cannot be imported into eval-log.ts as written."
      fix: "Either export a `ViewStrings = typeof en[\"view\"]` (or `keyof I18n[\"view\"]`) from i18n.ts and reference `labelKey: keyof ViewStrings`, or loosen `labelKey: string` in eval-log.ts to avoid the cross-module type import. State which in the spec so the implementer does not invent a name."
      verdict: fixed
      verdict_at: 2026-06-26
    - id: F-003
      phase: structure
      severity: INFO
      section: "Key finding that narrows scope"
      section_hash: cbfc45ffb8cf61f9
      fragment: "`src/agent-runner.ts:230` writes an `EvalRecord` for any operation"
      text: "Internal line-anchor inconsistency: the Key finding cites `agent-runner.ts:230` for the EvalRecord writer, while §4 (Writer) cites `agent-runner.ts:231`. In the source, line 230 is the `if (devMode.enabled && finalResultText && ...)` gate and line 231 is `const record: EvalRecord = {`. Both anchors are defensible (gate vs construction) but the two sections disagree."
      fix: "Pick one convention: cite :230 for 'the gated writer' consistently, or :231 for 'the record construction' consistently, across Key finding and §4."
      verdict: fixed
      verdict_at: 2026-06-26
chain:
  intent: null
---

# Dev-mode eval for all operations + rating-button reset & binding

Date: 2026-06-26
Branch: `dev-all-ops-eval` (from `master`)

## Problem

Two coupled defects in the dev-mode eval/rating feature:

1. **Rating buttons leak across runs.** The 👍/👎 rating row is appended as a
   direct child of `this.resultSection` (rendered by `renderRatingRow`,
   `src/view.ts:822`; called from `finish()` at `src/view.ts:948`). `reset()`
   (`src/view.ts:595–596`) only hides `resultSection` and empties `finalEl`; it
   never removes the rating row. After a `query`, starting an `ingest` re-shows
   `resultSection` with the **old** query's rating row still attached. The
   buttons stay bound to the previous `runId`, so a click updates the prior
   query's record — and the just-finished operation has no row of its own to
   rate. Reported exactly as: "ingest buttons didn't reset, stayed tied to the
   previous query, can't rate the last operation."

2. **Only 3 operations are ratable.** Rating buttons render only for
   `query`/`chat`/`lint-chat` (axis `answer`) and `format` (`formatting` +
   `recognition`). The other LLM operations (`ingest`, `init`, `lint`,
   `delete`) produce no rating UI and no operation-specific provenance, so their
   output cannot be labelled or optimized in `scripts/eval.ts` / `scripts/dspy`.

The goal: collect 👍/👎 labels for **every** LLM operation, with a per-operation
form rich enough to analyze and optimize that operation downstream.

## Decisions (from brainstorming, user-approved)

- **Scope:** all 8 LLM operations get rating buttons + an `eval.jsonl` record:
  `ingest, query, lint, lint-chat, chat, init, format, delete`.
- **Axes:** per-operation axis sets (not a single uniform thumb).
- **Granularity:** one record + rating set per **run** (`runId`); no per-item
  records. The form carries the list of processed items as provenance.
- **Rating storage:** **Approach A** — a `ratings: Record<axisId, Rating>` map on
  the record plus a central `OPERATION_AXES` registry. The legacy scalar
  `rating` / `recognitionRating` fields are removed. `eval.jsonl` is per-device
  dev data (not synced, disposable), so no record migration is required;
  `scripts/eval.ts` / `dspy` (reworked separately) read `ratings` with a legacy
  fallback.

## Key finding that narrows scope

The record **writer is already generic.** `src/agent-runner.ts:230` writes an
`EvalRecord` for any operation whose run yields non-empty `result` text, gated on
`devMode.enabled && req.runId && visionTempBaseDir`. Records for
`ingest`/`init`/`lint`/`delete` are therefore **already written** today —
they simply lack operation-specific provenance and have no rating UI. This work
adds: (a) `eval_meta` provenance per phase, (b) rating buttons for every
operation, (c) the reset/binding fix, (d) the `ratings`-map schema.

## Design

### 1. Rating schema — `ratings` map + axis registry

`src/eval-log.ts`:

- `Rating = "up" | "down" | null` (unchanged).
- `EvalRecord.ratings: Record<string, Rating>` replaces scalar
  `rating` / `recognitionRating`. A key is present only once its axis has been
  clicked (absence = not yet rated). Initialized `{}` by the writer.
- `RatingAxis` widens from the closed union to a `string` (canonical axis id).
- `updateEvalRating(runId, axis, rating)` toggles `ratings[axis]` in place
  (write-then-render, flip-to-null on re-click), returns the resulting `Rating`
  or `undefined` on failure/no-match — same contract as today, just keyed into
  the map.

`AxisDef` (new, in `eval-log.ts`):

```ts
interface AxisDef { id: string; labelKey: string; gate?: "vision"; }
```

`labelKey` is an i18n key resolved at render time via `i18n().view[labelKey]`. It
is typed `string` (not `keyof` an i18n type) so `eval-log.ts` need not import
`i18n.ts`'s unexported `typeof en` shape; `view.ts` does the indexing where the
type is in scope.

`OPERATION_AXES: Record<WikiOperation, AxisDef[]>` is the single source of truth
consumed by `view`, and later by `eval.ts` / `dspy`:

| Operation   | Axis ids                          |
|-------------|-----------------------------------|
| `query`     | `answer`, `retrieval`             |
| `chat`      | `answer`                          |
| `format`    | `formatting`, `recognition`(gate) |
| `ingest`    | `page`, `links`                   |
| `init`      | `coverage`, `page`                |
| `lint`      | `fix`                             |
| `lint-chat` | `fix`                             |
| `delete`    | `rebuild`                         |

`recognition` carries `gate: "vision"` — rendered only when the run actually ran
vision (`visionCount > 0`). It is format-only (vision is a format-phase feature).

### 2. Per-operation provenance (`eval_meta`)

`EvalMetaFields` (`src/eval-log.ts`) gains optional fields (all snake_case where
they mirror existing schema conventions):

- `created_pages?: string[]`
- `updated_pages?: string[]`
- `source_paths?: string[]`
- `files_processed?: number`
- `domain?: string`
- `articles?: string[]`
- `instruction?: string`
- `deleted_source?: string`
- `rebuilt_pages?: string[]`

Existing fields (`question`, `answer`, `found_pages`, `promptVersion`,
`retrievalConfig`, `source_path`, vision fields) are unchanged.

`eval_meta` emission per phase (each emits, at phase end, only the fields it
already holds — the `agent-runner` accumulator merges them; missing fields stay
absent):

| Phase                  | Emits today | New emission                                            |
|------------------------|-------------|---------------------------------------------------------|
| `query` / `chat` / `format` | yes    | unchanged                                               |
| `ingest`               | no          | `source_paths`, `created_pages`/`updated_pages` (from `written`), `found_pages`, `promptVersion` |
| `init`                 | no          | `files_processed`, `created_pages`, `domain`, `promptVersion` |
| `lint`                 | no          | `articles`, `promptVersion` (rule counts already flow via `ruleFirings`) |
| `lint-chat`            | no          | `articles`, `instruction`, `promptVersion`              |
| `delete`               | no          | `deleted_source`, `rebuilt_pages`, `promptVersion`      |

`eval_meta` is in-memory only, emitted from data the phase already computes for
its result text — **zero extra LLM calls, no mid-run I/O.** Where a phase splits
created vs. updated pages is a plan-time detail; fields are optional so partial
provenance degrades gracefully.

### 3. UI: render + reset/binding (`src/view.ts`)

**Reset (fixes defect 1):**

- Add `private ratingSection: HTMLElement | null = null`.
- In `reset()`, before re-arming a run:
  `this.ratingSection?.remove(); this.ratingSection = null;`
  and `this.formatPreviewSection?.remove(); this.formatPreviewSection = null;`
  (the format preview is rooted in `containerEl` and currently also survives a
  new run start).

**Render (fixes defect 2):**

- In `finish()`, for every operation **except `format`**, when
  `entry.status === "done"`: create `this.ratingSection` inside
  `this.resultSection`, then for each `AxisDef` in `OPERATION_AXES[entry.operation]`
  call `renderRatingRow(this.ratingSection, entry.id, axis.id, i18n().view[axis.labelKey])`.
  `entry.id` is the canonical `runId`, so buttons always bind to the displayed
  result.
- `format` keeps its axes in `renderFormatPreview` (where the user reviews the
  preview): `formatting` always, `recognition` when `visionCount > 0` — both read
  from `OPERATION_AXES["format"]` so the registry stays the single source.
- `renderRatingRow`'s `axis` parameter type widens to `string`; its body is
  otherwise unchanged (write-then-render via `controller.rateRun`).
- The existing `QC_OPS` / hard-coded `answer`-only branch in `finish()` is
  replaced by the registry-driven loop.

`renderRatingRow` already gates on `devMode.enabled`, is pure DOM, and renders on
mobile — unchanged.

### 4. Writer (`src/agent-runner.ts`)

The `EvalRecord` written by the generic writer (`agent-runner.ts:230`) drops the
scalar `rating: null` / conditional `recognitionRating` and sets `ratings: {}`.
Everything else (telemetry accumulation, `eval_meta` merge, gating) is unchanged.

### 5. Controller (`src/controller.ts`)

`rateRun(runId, axis: string, rating)` — `axis` type widens to `string`;
forwards to `updateEvalRating`. No logic change.

### 6. i18n (`src/i18n.ts`)

Add axis labels in en/ru/es: `retrieval`, `page`, `links`, `coverage`, `fix`,
`rebuild`. Existing `ratingAnswer`/`ratingFormatting`/`ratingRecognition` stay;
the registry references labels by key.

## Affected files

- `src/eval-log.ts` — `ratings` map, `RatingAxis` → `string`, `AxisDef`,
  `OPERATION_AXES`, `EvalMetaFields` new fields, `updateEvalRating` keying.
- `src/agent-runner.ts` — `EvalRecord` writes `ratings: {}`.
- `src/controller.ts` — `rateRun` axis type.
- `src/view.ts` — `ratingSection`, `reset()` cleanup, registry-driven `finish()`,
  `renderFormatPreview` reads registry, `renderRatingRow` axis type.
- `src/phases/ingest.ts`, `init.ts`, `lint.ts`, `lint-chat.ts`, `delete.ts` —
  emit `eval_meta`.
- `src/i18n.ts` — new axis labels (en/ru/es).
- `src/styles.css` — unchanged (selected-state CSS already shipped in 0.1.187).

## Constraints (carried)

- Everything gated on `devMode.enabled`; the non-dev path is untouched.
- Telemetry/labeling triggers **zero** LLM calls; per run one append, per click
  one read-modify-write; hot path stays in-memory.
- Mobile-safe: pure DOM, no new top-level node-builtin import.
- Branch workflow: work on `dev-all-ops-eval`, merge to `master` via PR only.

## Build & deploy

`npm run build` writes `dist/`. Artifacts are **not** copied into the vault by the
build — copy `main.js`, `styles.css`, `manifest.json` to
`<vault>/.obsidian/plugins/ai-wiki/` and reload the plugin to verify.

## Verification (dev mode enabled)

1. Run `query`, click 👍 on `answer`. Start `ingest`: the query rating row is
   **gone**; the result shows `ingest`'s `page` / `links` rows.
2. Rate `ingest` → `eval.jsonl` shows the ingest record with
   `ratings.page = "up"`, bound to the fresh `runId` (not the query's).
3. Walk each operation (`init`, `lint`, `lint-chat`, `delete`, `chat`, `format`):
   each writes a record with its operation-specific provenance and renders its
   registry axes; a re-click toggles a rating back to `null` in the file.
4. `npm run build` succeeds; `npm run lint` clean; no new tsc errors in touched
   files.

## docs/wiki update

After implementation, regenerate via `iwiki:iwiki-ingest`:

- `docs/wiki/llm-pipeline.md` — per-run record: `ratings` map + per-operation
  axes + provenance (replaces the scalar-rating description).
- `docs/wiki/operations.md` — note that every operation now emits an
  `eval.jsonl` record with operation-specific provenance.

Then `/iwiki-lint` — no broken `[[refs]]`, no orphan/stale pages.

## Out of scope

- Per-item (per-file/per-page) records and ratings.
- `scripts/eval.ts` / `scripts/dspy` rework (consume `ratings` later; a separate
  spec). This spec only guarantees the on-disk form is dspy-ready.
