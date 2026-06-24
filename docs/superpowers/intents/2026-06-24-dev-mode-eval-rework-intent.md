---
review:
  intent_hash: 5ec13d255475b490
  last_run: 2026-06-24
  phases:
    structure:    { status: passed }
    completeness: { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
    alignment:    { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: WARNING
      section: "Health Metrics"
      section_hash: 533fc1efa87986c9
      text: "'negligible per-run overhead' has no measurable threshold. 'no extra LLM calls' is binary/checkable, but 'negligible' is mood; give a bound (e.g. < X ms added per run) or drop the adjective."
      verdict: open
      verdict_at: null
    - id: F-002
      phase: alignment
      severity: INFO
      section: "Desired Outcomes"
      section_hash: a41d4482946f1ba9
      text: "Scope now spans UI (query/chat + format two-axis buttons), per-run telemetry instrumentation across four deterministic-rule sites, eval.ts metrics, and dspy. Consider phasing this into stages during writing-plans rather than one implementation pass."
      verdict: open
      verdict_at: null
---

# Intent: dev-mode eval rework — human-labeled answer + format quality dataset with harness telemetry

**Date:** 2026-06-24
**Status:** approved

## Objective
Today's dev mode auto-scores each run with a separate LLM judge
(`devMode.evaluatorModel` → `runEvaluator` → `prompts/evaluator.md` → `eval`
field in `!Wiki/_config/_dev.jsonl`). The judge signal is not trustworthy
enough to drive prompt work. Replace it with **human-collected quality labels**,
persisted as a gold dataset, and reuse that dataset to (a) compare variants via
`scripts/eval.ts` and (b) improve prompts on bad outputs via `scripts/dspy`.
Doing it now so accumulated 👍/👎 labels become the ground truth before further
prompt tuning.

Scope covers **two operations**, not just query/chat:
- **query/chat** — one 👍/👎 on the answer.
- **format** — 👍/👎 on the formatted output, split into two axes: **formatting
  quality** (always) and, when the run ran vision, **recognition quality** (the
  image/PDF/Excalidraw understanding). Labels are bucketed by vision on/off so
  `prompts/format.md` and `prompts/vision-*.md` can be tuned independently.

Each dev-mode run also records **harness telemetry** in the same dataset:
**LLM errors** (`error` / `structural_error` / sentinel-salvage) and a
**deterministic-rule firing count** (`ruleId → count`). The point: when a 👎 (or
any run) is analysed, the telemetry shows whether the model produced bad output
the harness repaired (→ improve the prompt) or a deterministic rule fired
rarely/over-eagerly (→ improve the harness).

## Desired Outcomes
- **Per-run record.** Every dev-mode query/chat/format run appends one record to
  `!Wiki/_config/eval.jsonl` at run end, carrying provenance + harness telemetry
  + `rating: null`. The 👍/👎 click **updates that run's record** (matched by
  `runId`); it does not create the record. Re-clicking flips the rating in place
  (no duplicate rows).
- **query/chat labels.** In dev mode, under a query/chat answer, 👍/👎 appear on
  **desktop and mobile**; clicking sets `rating` on the run's record.
- **format labels (two axes).** In dev mode, on the format preview, a 👍/👎 rates
  **formatting quality**; when the run ran vision (`visionCount > 0`) a second
  👍/👎 rates **recognition quality**. Both render on **desktop and mobile**.
- **Record schema (operation-aware), at least:**
  ```jsonc
  // query / chat
  { runId, ts, operation, model, question, found_pages[], answer,
    promptVersion, retrievalConfig, llmErrors[], ruleFirings{}, rating }
  // format
  { runId, ts, operation:"format", model, visionModel?, source_path,
    vision:"on"|"off", visionCount, promptVersion, visionPromptVersion?,
    llmErrors[], ruleFirings{},
    rating /*formatting*/, recognitionRating? /*only when vision ran*/ }
  ```
  Provenance must attribute a label to a concrete artifact (prompt/template
  version, model, retrieval/vision config). Schema may be extended for richer
  eval + dspy signal.
- **Telemetry captured per run:**
  - `llmErrors[]` — `error` / `structural_error` / sentinel-salvage events as
    `{kind, callSite?, errorType?, retryAttempt?, message}`.
  - `ruleFirings{ruleId: count}` over four deterministic-rule groups: WikiLink
    fixes (`fixWikiLinks`, `stripDeadLinks`, `resolveLink` det, `annotateBroken`),
    format sentinel strips (`stripSentinelMarkers`, salvage/truncation),
    frontmatter repair (`recoverSourceFrontmatter` / `validateAndRepairFrontmatter`
    / `restoreSourceFrontmatter`), structured-output retries (`parseWithRetry`,
    `wrapWithJsonFallback`).
- `scripts/eval.ts` reads `eval.jsonl` and reports: an answer-quality metric, a
  **format-quality** and **recognition-quality** metric (bucketed by vision
  on/off), and an aggregate **telemetry report** (error rates + `ruleFirings`
  totals per prompt) so prompt-vs-harness decisions are data-backed.
- `scripts/dspy` consumes the labeled set — **both 👍 and 👎** — and optimizes
  prompts from `prompts/` + `templates/`, including `prompts/format.md` and
  `prompts/vision-*.md` from format/recognition labels, using 👍 cases as a guard
  against regressing already-good outputs.

## Health Metrics
- Normal (non-dev) query/chat/format/vision behavior and performance unchanged —
  recording, telemetry, and buttons are gated on `devMode.enabled`.
- Telemetry adds negligible per-run overhead (in-memory counters flushed once at
  run end); no extra LLM calls.
- Mobile build does not crash (node builtins stay lazy + desktop-guarded;
  query/chat and format buttons still render on mobile).
- `npm run lint` clean; no new tsc errors in touched files.

## Strategic Context
- Interacts with: query/chat phase (data source — `graph_stats` found pages +
  `result` answer), format phase (`src/phases/format.ts`, preview via
  `format_preview` event) + vision pre-step (`src/phases/attachment-analyzer.ts`,
  `visionCount` from the sentinel side-channel), `src/view.ts` (renders the answer
  at `finish()` and the format preview at `renderFormatPreview()`, hosts 👍/👎
  buttons), `src/agent-runner.ts` (`writeDevLog`/`updateDevLogEval` — becomes the
  per-run telemetry writer + rating updater), `settings.ts` (`devMode` flag),
  `!Wiki/_config/eval.jsonl` (shared, synced by Obsidian across desktop/mobile —
  non-critical), `scripts/eval.ts` (Node/tsx harness), `scripts/dspy` (Python,
  separate LLM API for prompt optimization).
- Telemetry sources: the deterministic-rule sites (`src/wiki-link-validator.ts`,
  `src/phases/link-resolver.ts` + `query-link-validator.ts`,
  `src/phases/format-utils.ts`, `src/utils/raw-frontmatter.ts`), the structural
  retry path (`src/phases/parse-with-retry.ts`,
  `src/structural-error-counter.ts`), and the error events in the `RunEvent` union
  (`src/types.ts`).
- Priority trade-off: **trust** — accuracy of the label signal and correct
  attribution of a label (and its telemetry) to the prompt/model/config that
  produced the output. A telemetry count that misses or double-counts a rule
  firing is worse than absent, because it misdirects the prompt-vs-harness call.

## Constraints
### Steering (behavioral guidance)
- Recording + telemetry + buttons active **only when `devMode.enabled`**; non-dev
  path untouched.
- `eval.jsonl` is JSONL written **one record per dev-mode run** at run end (with
  `rating: null`). The 👍/👎 click edits that run's record in place (matched by
  `runId`) — it does not append. Re-clicking flips the rating; no duplicate rows.
- format carries **two rating axes**: `rating` (formatting quality, always) and
  `recognitionRating` (only when `visionCount > 0`). query/chat carry the single
  `rating`. `recognitionRating` stays absent (not `null`) on no-vision format runs.
- Each record captures `runId`, prompt/template version, model (+ `visionModel`
  for vision runs), and retrieval/vision config so a 👎 — and its telemetry — map
  unambiguously to one artifact (required by dspy).
- Both `eval.ts` and `dspy` read prompts from `prompts/` + `templates/`.

### Hard (architectural enforcement)
- Mobile: no node builtins in the plugin bundle (lazy + desktop-guard); query/chat
  and format 👍/👎 render on mobile too.
- Prompt text stays in `prompts/*.md` (no hardcoded prompt strings in `.ts`).
- Rule-firing counts are surfaced **structurally** — each deterministic rule
  reports its count via a typed signal (e.g. a `rule_fired{ruleId, count}` event,
  or a structured return the caller tallies). No parsing of `info_text` summary
  strings to reconstruct counts (brittle, breaks the trust priority).
- Telemetry counters are accumulated in memory during the run and flushed once
  into the per-run record; they never trigger extra LLM calls.
- Remove: `src/phases/evaluator.ts`, `prompts/evaluator.md`,
  `devMode.evaluatorModel`, the `eval_result` event, and the `runEvaluator`
  wiring in `AgentRunner`.
- Retire the retrieval-eval harness: `scripts/eval-*.ts` + `scripts/eval/` gold
  dir. The new `scripts/eval.ts` reads `eval.jsonl` (answer-quality replaces
  retrieval Recall@k/MRR).
- Rename the log file `_dev.jsonl` → `eval.jsonl` (update `src/wiki-path.ts` +
  `src/storage-migration.ts`).
- Do not commit directly to `master`; work on a `dev/*` branch, merge via PR.

## Autonomy Zones
- Full autonomy (reversible, low risk): 👍/👎 button placement & markup for
  query/chat **and format** (desktop + mobile, both axes), `eval.jsonl` record
  schema (incl. telemetry fields), i18n strings, docs/wiki update.
- Guarded (log + confidence threshold): `_dev.jsonl` → `eval.jsonl` rename +
  migration; the per-run telemetry writer + `runId` plumbing into the view; the
  rule-firing instrumentation at each deterministic-rule site; the
  quality/recognition/telemetry metrics in `scripts/eval.ts`.
- Proposal-first (needs approval): deleting `evaluator.ts` / `evaluator.md` /
  retrieval-eval harness; the dspy pipeline design (what is optimized — incl.
  `format.md` + `vision-*.md` — and how "did not regress 👍 cases" is measured).
- No autonomy (human only): touching the normal (non-dev) query/chat/format/vision
  path; committing to `master` directly.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules
- Halt if: removing the evaluator/retrieval harness, the file rename, or the
  telemetry instrumentation would alter the non-dev query/chat/format/vision path
  or break the mobile build.
- Escalate if: a trustworthy attribution of a label (or its telemetry) to a single
  prompt/model/config record cannot be achieved with the available run data; or a
  deterministic rule cannot report its firing count without text-parsing.
- Done when:
  1. In dev mode, 👍/👎 are visible under a query/chat answer on **desktop and
     mobile**; a click updates the run's `eval.jsonl` record
     `{runId, question, found_pages[], answer, rating, promptVersion, model,
     retrievalConfig, llmErrors[], ruleFirings{}}`.
  2. In dev mode, the format preview shows a **formatting** 👍/👎 always and a
     **recognition** 👍/👎 when vision ran (desktop + mobile); a click updates the
     format record `{runId, operation:"format", vision, visionCount, rating,
     recognitionRating?, ...provenance, llmErrors[], ruleFirings{}}`.
  3. Every dev-mode run appends exactly one per-run record carrying `llmErrors[]`
     and `ruleFirings{}` over the four rule groups, surfaced structurally (no
     `info_text` text-parsing).
  4. Non-dev query/chat/format/vision is unchanged; the mobile build builds and
     runs.
  5. `npm run lint` is clean; no new tsc errors in touched files.
  6. `scripts/eval.ts` produces answer-quality, format-quality, and
     recognition-quality metrics (vision on/off buckets) plus an aggregate
     telemetry report (error rates + `ruleFirings` per prompt) from `eval.jsonl`.
  7. `scripts/dspy` consumes the labeled set (👍 + 👎), including format/vision
     labels, and optimizes prompts from `prompts/` + `templates/` (incl.
     `format.md` + `vision-*.md`) without regressing 👍 cases.
  8. The LLM judge (`evaluator.*`, `devMode.evaluatorModel`, `eval_result`) and
     the retrieval-eval harness are removed.
