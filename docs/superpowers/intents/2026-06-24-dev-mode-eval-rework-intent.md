# Intent: dev-mode eval rework — human-labeled answer-quality dataset

**Date:** 2026-06-24
**Status:** approved

## Objective
Today's dev mode auto-scores each run with a separate LLM judge
(`devMode.evaluatorModel` → `runEvaluator` → `prompts/evaluator.md` → `eval`
field in `!Wiki/_config/_dev.jsonl`). The judge signal is not trustworthy
enough to drive prompt work. Replace it with **human-collected quality labels
on query/chat answers**, persisted as a gold dataset, and reuse that dataset to
(a) compare variants via `scripts/eval.ts` and (b) improve prompts on bad
answers via `scripts/dspy`. Doing it now so accumulated 👍/👎 labels become the
ground truth before further prompt tuning.

## Desired Outcomes
- In dev mode, under a query/chat answer, two buttons 👍/👎 appear on **desktop
  and mobile**; clicking writes/updates one record in `!Wiki/_config/eval.jsonl`.
- Each record holds at least `{question, found_pages[], answer, rating}` plus
  enough provenance to attribute a label to a concrete artifact: prompt/template
  version, model, retrieval config. Schema may be extended to capture richer
  signal for eval + dspy.
- Re-clicking 👍/👎 updates the existing record's rating (no duplicate rows).
- `scripts/eval.ts` reads `eval.jsonl` and reports an agent-quality metric over
  the labeled examples.
- `scripts/dspy` consumes the labeled set — **both 👍 and 👎** — and optimizes
  prompts from `prompts/` + `templates/`, using 👍 cases as a guard against
  regressing already-good answers.

## Health Metrics
- Normal (non-dev) query/chat behavior and performance unchanged — recording and
  buttons are gated on `devMode.enabled`.
- Mobile build does not crash (node builtins stay lazy + desktop-guarded;
  buttons still render on mobile).
- `npm run lint` clean; no new tsc errors in touched files.

## Strategic Context
- Interacts with: query/chat phase (data source — `graph_stats` found pages +
  `result` answer), `src/view.ts` (renders answer + 👍/👎 buttons), `settings.ts`
  (`devMode` flag), `!Wiki/_config/eval.jsonl` (shared, synced by Obsidian across
  desktop/mobile — non-critical), `scripts/eval.ts` (Node/tsx harness),
  `scripts/dspy` (Python, separate LLM API for prompt optimization).
- Priority trade-off: **trust** — accuracy of the label signal and correct
  attribution of a label to the prompt/model/config that produced the answer.

## Constraints
### Steering (behavioral guidance)
- Recording + buttons active **only when `devMode.enabled`**; non-dev path
  untouched.
- `eval.jsonl` is append-only JSONL; re-clicking 👍/👎 edits the record's rating
  rather than appending a duplicate.
- Each record captures prompt/template version, model, and retrieval config so a
  👎 maps unambiguously to one artifact (required by dspy).
- Both `eval.ts` and `dspy` read prompts from `prompts/` + `templates/`.

### Hard (architectural enforcement)
- Mobile: no node builtins in the plugin bundle (lazy + desktop-guard); 👍/👎
  render on mobile too.
- Prompt text stays in `prompts/*.md` (no hardcoded prompt strings in `.ts`).
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
- Full autonomy (reversible, low risk): 👍/👎 button placement & markup
  (desktop + mobile), `eval.jsonl` record schema, i18n strings, docs/wiki update.
- Guarded (log + confidence threshold): `_dev.jsonl` → `eval.jsonl` rename +
  migration, the agent-quality metric in `scripts/eval.ts`.
- Proposal-first (needs approval): deleting `evaluator.ts` / `evaluator.md` /
  retrieval-eval harness; the dspy pipeline design (what is optimized, how
  "did not regress 👍 cases" is measured).
- No autonomy (human only): touching the normal (non-dev) query/chat path;
  committing to `master` directly.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules
- Halt if: removing the evaluator/retrieval harness or the file rename would
  alter the non-dev query/chat path or break the mobile build.
- Escalate if: a trustworthy attribution of a label to a single
  prompt/model/config record cannot be achieved with the available run data.
- Done when:
  1. In dev mode, 👍/👎 are visible under a query/chat answer on **desktop and
     mobile**; a click writes/updates an `eval.jsonl` record
     `{question, found_pages[], answer, rating, prompt/template version, model,
     retrieval config}`.
  2. Non-dev query/chat is unchanged; the mobile build builds and runs.
  3. `npm run lint` is clean; no new tsc errors in touched files.
  4. `scripts/eval.ts` produces an agent-quality metric from `eval.jsonl`.
  5. `scripts/dspy` consumes the labeled set (👍 + 👎) and optimizes prompts from
     `prompts/` + `templates/` without regressing 👍 cases.
  6. The LLM judge (`evaluator.*`, `devMode.evaluatorModel`, `eval_result`) and
     the retrieval-eval harness are removed.
