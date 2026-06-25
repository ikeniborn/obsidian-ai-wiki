---
review:
  spec_hash: 09ead92eba32b2fa
  last_run: 2026-06-25
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: INFO
      section: "9. Removals"
      section_hash: 245325a476209eda
      fragment: "its render in `src/view.ts` (~lines 816–822)"
      text: "Concrete source line numbers drift and are not a stable anchor."
      fix: "Reference the eval_result case by symbol; mark line numbers approximate."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-002
      phase: coverage
      severity: WARNING
      section: "5. Telemetry: rule_fired event + accumulation"
      section_hash: 80e072ea66e61a64
      fragment: "| `resolveLink` | caller counts `kind === \"resolved\"` |"
      text: "Intent lists `resolveLink det` (deterministic only); spec did not state the count is deterministic-only."
      fix: "Clarify resolveLink is the 0-LLM deterministic resolver, so kind=='resolved' tallies deterministic resolutions only."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-003
      phase: coverage
      severity: INFO
      section: "13. Strategic context & constraints (carried from intent)"
      section_hash: 414692a7d7da5ea5
      fragment: "HUMAN CHECKPOINTS ... deleting evaluator.* / the retrieval harness; the dspy pipeline design"
      text: "Intent's human-only zone also lists committing to master; spec's checkpoint list omitted it."
      fix: "Add committing to master (already enforced by Branch workflow / PR-only) to the checkpoint list."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-004
      phase: clarity
      severity: WARNING
      section: "8. `scripts/dspy` rework"
      section_hash: 3e94ae503dc068e8
      fragment: "reject a candidate prompt whose score on the 👍 set drops"
      text: "Regression-guard reject condition had no threshold/baseline; intent requires the 'did not regress 👍' measure defined."
      fix: "Define baseline = current prompt's mean 👍-set metric; reject if candidate's mean 👍-set metric < baseline (strict)."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-005
      phase: clarity
      severity: WARNING
      section: "4. Per-run record: schema + writer"
      section_hash: 24a318bb488d2421
      fragment: "hash8(sorted concat of the distinct vision-*.md templates the run actually invoked)"
      text: "'sorted concat' lacked a delimiter/encoding — boundary collisions weaken unambiguous attribution."
      fix: "Hash each template, sort filenames, join per-template hashes with '|', hash again."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-006
      phase: clarity
      severity: INFO
      section: "10. Health metrics (resolves intent finding F-001)"
      section_hash: 3e6791857ea643a3
      fragment: "Mobile build builds and runs; ... buttons render on mobile."
      text: "'builds and runs' had no concrete check while the rest of the section gives checkable bounds."
      fix: "State the check: npm run build succeeds, no new top-level node-builtin import; buttons verified in mobile UI path."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-007
      phase: clarity
      severity: INFO
      section: "9. Removals"
      section_hash: 245325a476209eda
      fragment: "`scripts/obsidian-shim.ts` (if used only by the harness)"
      text: "Conditional removal without a stated resolution rule."
      fix: "State the decidable rule: remove only if no non-harness importer remains; otherwise retain."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-008
      phase: consistency
      severity: CRITICAL
      section: "3. Storage location & auto-migration"
      section_hash: ad7e68f18274a2ec
      fragment: "labels become per-device ... supersedes the intent's synced/shared location"
      text: "Spec relocates logs to a non-synced plugin dir, contradicting the intent's vault/synced location and Done-when #1/#2."
      fix: "Amend the intent (2026-06-25, user-approved) to record the plugin-dir relocation + per-device sync; the two docs no longer contradict."
      verdict: fixed
      verdict_at: 2026-06-25
    - id: F-009
      phase: consistency
      severity: INFO
      section: "1. Objective & scope"
      section_hash: 6956eeb10c264fef
      fragment: "dev→eval vs agent→agent mapping spread across §1/§3/§9"
      text: "Rename+relocation mapping was spread across sections without a single canonical table."
      fix: "Add one canonical rename+relocation table in §3, referenced by §1/§4/§9."
      verdict: fixed
      verdict_at: 2026-06-25
chain:
  intent: docs/superpowers/intents/2026-06-24-dev-mode-eval-rework-intent.md
---

# Design: dev-mode eval rework — human-labeled quality dataset with harness telemetry

**Date:** 2026-06-25
**Status:** approved (design)
**Intent:** [[docs/superpowers/intents/2026-06-24-dev-mode-eval-rework-intent.md]]
**Branch:** `dev/dev-mode-eval-rework`

## 1. Objective & scope

Replace the per-run LLM-judge auto-score (`devMode.evaluatorModel` → `runEvaluator` →
`prompts/evaluator.md` → `eval` field) with **human-collected 👍/👎 quality labels**
persisted as a gold dataset, and reuse that dataset to (a) compare variants via
`scripts/eval.ts` and (b) optimize prompts via `scripts/dspy`.

Three operations produce records: **query**, **chat**, **format**. Each dev-mode run
appends one record carrying provenance + **harness telemetry** (`llmErrors[]`,
`ruleFirings{}`); the 👍/👎 click updates that record in place by `runId`.

Everything is gated on `devMode.enabled`. The non-dev query/chat/format/vision path is
untouched.

### Resolved design decisions

- **Rule-firing telemetry** → new typed `rule_fired` RunEvent; callers emit from the
  structured returns the rules already produce (extending the few that lack a count);
  `AgentRunner` tallies. No `info_text` text-parsing. (Mirrors `structural_error`.)
- **Prompt versioning** → runtime content-hash (FNV-1a, 8 hex) of the imported prompt
  string, memoized. Captures exact bytes, mobile-safe, zero build changes.
- **dspy metric** → binary (`👍`=1.0 / `👎`=0.0), optimize toward 👍, with 👍 cases held
  out as a regression guard (see §8 for the exact reject condition).
- **dspy rework is in scope** (one spec, sequenced into phases during writing-plans).

### Storage relocation (extends the intent)

The accumulation logs move **out of the synced vault** into the plugin directory:

- `!Wiki/_config/_agent.jsonl` → `.obsidian/plugins/ai-wiki/agent.jsonl`
- `!Wiki/_config/_dev.jsonl`  → `.obsidian/plugins/ai-wiki/eval.jsonl`

Leading `_` is dropped (the `_`-prefix convention only matters for vault-content globs,
which no longer apply in the plugin directory). On plugin update the old vault files are
migrated automatically (see §3).

> **Trade-off (supersedes the intent's "synced by Obsidian across desktop/mobile"
> assumption):** `.obsidian/plugins/` is **not** part of the synced vault content by
> default. `eval.jsonl` and `agent.jsonl` are therefore **deliberately not synced** —
> labels are **per-device** (mobile labels stay on mobile and are not seen by
> `eval.ts`/`dspy` running on desktop). This is an **explicitly agreed** decision, not an
> incidental consequence. Precedent: `VisionTempStore` already writes under the plugin
> directory, never the vault content tree.

## 2. runId — one canonical id

Today two ids exist: `agent-runner.ts` `runId = Date.now().toString(36)` (used only for the
vision-temp directory) and `controller.ts` `entry.id = String(startedAt)` (run history +
`view.finish(entry)`). These are unified.

- `controller` generates `runId = String(startedAt)` once at run start.
- It is passed into `AgentRunner` (as `req.runId`) → written into the record **and**
  reused for the vision-temp directory (the local `Date.now().toString(36)` id is removed).
- It reaches `view`:
  - query/chat — via `finish(entry)` (`entry.id`), stored as `this.lastRunId`;
  - format — a new `runId` field on the `format_preview` event.

The 👍/👎 button callbacks therefore always know the `runId` of the displayed
answer/preview and call `controller.rateRun(runId, axis, rating)`.

## 3. Storage location & auto-migration

**Canonical rename + relocation mapping** (the single source of truth referenced by §1, §4,
§9):

| log | old path (vault, migration source) | new path (plugin dir, write target) |
|---|---|---|
| dev/eval log | `!Wiki/_config/_dev.jsonl` | `.obsidian/plugins/ai-wiki/eval.jsonl` |
| agent log | `!Wiki/_config/_agent.jsonl` | `.obsidian/plugins/ai-wiki/agent.jsonl` |

- Paths are **runtime-resolved** from the plugin base directory (`manifest.dir`), not
  static constants:
  - `agentLogPath = `${pluginDir}/agent.jsonl``
  - `evalLogPath  = `${pluginDir}/eval.jsonl``
  - `pluginDir` is the same base already used by `VisionTempStore`
    (`this.visionTempBaseDir`).
- `src/wiki-path.ts`: the old `GLOBAL_DEV_LOG_PATH` / `GLOBAL_AGENT_LOG_PATH` vault
  constants are retained **only as migration sources**.
- `src/storage-migration.ts`: on load, if vault copies exist
  (`!Wiki/_config/_agent.jsonl`, `!Wiki/_config/_dev.jsonl`, and the legacy per-domain
  copies it already scans), append their content into the plugin-dir `agent.jsonl` /
  `eval.jsonl`, then delete the vault copies. **Idempotent** — a second run is a no-op
  (vault sources absent).
- All reads/writes go through `vault.adapter` (mobile-safe).
- Legacy `_dev.jsonl` lines carry the **old** judge-score shape (no `runId`/`rating`).
  Migration carries them over verbatim; `eval.ts`/`dspy` readers **skip records lacking
  `rating`** so legacy lines are ignored rather than crashing the readers.

## 4. Per-run record: schema + writer

`writeEvalRecord` replaces `writeDevLog`: at run end it appends one JSONL line with
`rating: null` + provenance + telemetry. `updateEvalRating(runId, axis, rating)` replaces
`updateDevLogEval`: it locates the record by `runId`, sets/flips `rating` (axis
`"answer"`/`"formatting"`) or `recognitionRating` (axis `"recognition"`), rewrites the
file — no duplicate rows, re-click flips in place.

```jsonc
// query / chat
{ runId, ts, operation, model, question, found_pages[], answer,
  promptVersion, retrievalConfig, llmErrors[], ruleFirings{}, rating }

// format
{ runId, ts, operation: "format", model, visionModel?, source_path,
  vision: "on" | "off", visionCount, promptVersion, visionPromptVersion?,
  llmErrors[], ruleFirings{},
  rating /* formatting */, recognitionRating? /* only when vision ran */ }
```

Field notes:

- `rating` / `recognitionRating`: `"up" | "down" | null`. `recognitionRating` is **absent**
  (not `null`) when `visionCount === 0`.
- `promptVersion = hash8(phaseTemplate)` — content-hash of the phase's prompt string
  (`query.md` / `chat.md` / `format.md`), memoized per module.
- `visionPromptVersion` is computed without concatenation ambiguity: take the distinct
  `vision-*.md` templates the run actually invoked, sort their **filenames**
  lexicographically, map each to its own `hash8(content)`, join those hashes with `"|"`,
  and `hash8` the result — i.e. `hash8(templates.sort().map(t => hash8(t.content)).join("|"))`.
  Hashing per-template before joining removes any boundary collision. Absent on no-vision
  runs. (Recognition quality is a property of the vision subsystem; the hash identifies
  exactly which vision prompts produced the recognitions.)
- `retrievalConfig` = snapshot of `{ mode, seedTopK, bfsTopK, bfsFusion,
  seedSimilarityThreshold, hybridRetrieval }` read from `settings.nativeAgent` at query
  time. A stable plain object for attribution.
- `found_pages[]` = the query/chat retrieved page ids (from `graph_stats`).
- `chat` uses the query/chat schema: `question` = last user message, `answer` = the reply.

A small `src/prompt-version.ts` exports `hash8(s: string): string` (FNV-1a → 8 hex) and a
memoized `promptVersionOf(template: string)`.

## 5. Telemetry: `rule_fired` event + accumulation

New union member in `src/types.ts`:

```ts
{ kind: "rule_fired"; ruleId: string; count: number }
```

`AgentRunner` is already the central event hub (it forwards the phase event stream). It
holds per-run `llmErrors: LlmError[]` and `ruleFirings: Record<string, number>`, resets
them at run start, mutates them as it observes events, and flushes them into
`writeEvalRecord` at run end. **In-memory only; no extra LLM calls; no mid-run I/O.**

- `llmErrors[]` is built from existing `error` / `structural_error` events and the
  sentinel-salvage notice, mapped to
  `{ kind, callSite?, errorType?, retryAttempt?, message }`.
- `ruleFirings{}` sums `rule_fired` events.

Instrumented deterministic-rule sites (four groups). Where a rule already returns a
structured count, the **caller** emits `rule_fired`; where it does not, the rule's typed
return is **surgically extended** with a count (never reconstructed from summary text):

| ruleId | count source |
|---|---|
| `fixWikiLinks` | number of violations fixed — extend `FixResult` with a `fixedCount` |
| `stripDeadLinks` | number of links removed — extend return to `{ content, removedCount }` |
| `resolveLink` (det) | caller counts `kind === "resolved"`; `resolveLink` is the 0-LLM deterministic resolver, so this tallies **deterministic** resolutions only (matches the intent's `resolveLink det`) |
| `annotateBroken` | caller knows `broken.size` |
| `stripSentinelMarkers` | `removed.length` (already structured) |
| `formatSalvage` | salvage / truncation branch (`sentinel.truncated`) |
| `recoverSourceFrontmatter` | changed flag — extend return |
| `validateAndRepairFrontmatter` | `warnings.length` (already structured) |
| `restoreSourceFrontmatter` | changed flag — extend return |
| `parseWithRetry` | retry attempts (already in `structural_error`) |
| `wrapWithJsonFallback` | emit `rule_fired` when the JSON fallback engages |

Pure utility functions (`resolveLink`, `stripSentinelMarkers`, `validateAndRepairFrontmatter`)
are **not** given an event channel — their callers (in `query.ts` / `format.ts` /
`raw-frontmatter` consumers) emit. The functions extended with a count keep returning a
plain value; no `obsidian`/event dependency leaks into them.

## 6. UI: 👍/👎 buttons (desktop + mobile, gated on `devMode.enabled`)

- **query/chat** — in `view.ts#finish()`, a footer row appended under the rendered answer
  in `this.resultSection`. Click → `controller.rateRun(this.lastRunId, "answer", rating)`.
  Active-state styling; re-click flips.
- **format** — in `view.ts#renderFormatPreview()`, near `btnRow`: a **formatting** 👍/👎
  always; a **recognition** 👍/👎 only when `visionCount > 0`. The `format_preview` event
  carries `runId` + `visionCount`. Clicks → `controller.rateRun(runId, "formatting" |
  "recognition", rating)`.
- i18n labels/tooltips added to `src/i18n.ts` (en/ru/es).
- Buttons are pure DOM — no node builtins, render on mobile.
- Button state reflects clicks within the current view session; `eval.jsonl` is the source
  of truth. Restoring button state across reloads is **not** required.

## 7. `scripts/eval.ts` rework

Reads `eval.jsonl` (default path = plugin-dir `eval.jsonl`, overridable via `--log`),
skips legacy records without `rating`, and reports:

- **answer-quality** — 👍 rate over query/chat records, per `promptVersion`;
- **format-quality** — 👍 rate over `rating`, bucketed by `vision: on|off`, per
  `promptVersion`;
- **recognition-quality** — 👍 rate over `recognitionRating` (vision-on only), per
  `visionPromptVersion`;
- **telemetry report** — `llmErrors[]` error-rates + `ruleFirings{}` totals per prompt, so
  a 👎 can be triaged as prompt-vs-harness.

`package.json` `eval` script becomes `tsx scripts/eval.ts`. The retrieval Recall@k / MRR
harness is removed (see §9); answer-quality replaces it.

## 8. `scripts/dspy` rework

- `lib/loader.py`: read `rating` (skip records without it) instead of `eval.score`. Group
  by `operation`, and for `format` additionally by vision bucket — yielding trainsets for
  query/chat, format(vision-on), format(vision-off), and recognition.
- Metric: `1.0 if rating == "up" else 0.0`. Optimize toward 👍. Hold the 👍 set out as a
  **regression guard** with an explicit reject condition: let `baseline` = the current
  (pre-optimization) prompt's mean metric on the held-out 👍 set; **reject** a candidate
  prompt if its mean metric on that 👍 set is **strictly less than `baseline`** (any
  decrease). Among non-rejected candidates, pick the one maximizing the metric on the full
  trainset. (This is the spec's definition of "did not regress 👍 cases.")
- Optimizes `prompts/format.md` + `prompts/vision-*.md` from format/recognition labels, and
  the query/chat prompts from their labels. Reads `prompts/` + `templates/` (unchanged).
  MIPROv2 + the existing backends (ollama / claude-code) are retained.

## 9. Removals

LLM judge:

- `src/phases/evaluator.ts`, `prompts/evaluator.md`.
- `devMode.evaluatorModel` (in `src/types.ts` shape + defaults, and the `src/settings.ts`
  UI binding).
- the `eval_result` RunEvent (`src/types.ts`), its render (the `eval_result` case in
  `src/view.ts`'s event switch — line numbers approximate, resolve by symbol at
  implementation time), and the `runEvaluator` import + invocation loop in `AgentRunner`.

Retrieval-eval harness:

- `scripts/eval-config.ts`, `scripts/eval-gold.ts`, `scripts/eval-metrics.ts`,
  `scripts/eval-report.ts`, `scripts/eval-retrieval.ts`, `scripts/eval-vault.ts`,
  the `scripts/eval/` gold directory, and `scripts/obsidian-shim.ts` (decidable rule:
  remove it only if no non-harness importer remains after the harness files are deleted;
  otherwise retain it). `scripts/tsconfig.eval.json` is retained/adjusted for the new
  `eval.ts`.

File rename: `_dev.jsonl` → `eval.jsonl` and `_agent.jsonl` → `agent.jsonl`, relocated to
the plugin directory (§3).

## 10. Health metrics (resolves intent finding F-001)

Concrete bound replacing "negligible per-run overhead":

- **Zero extra LLM calls** for telemetry/labeling.
- Per run: exactly **one append** at run end; per rating click: **one read-modify-write**.
- On the run hot path: **in-memory counters only, no I/O**.
- Non-dev query/chat/format/vision path **unchanged** (everything gated on
  `devMode.enabled`).
- Mobile safety check: `npm run build` succeeds and the produced bundle has **no
  top-level (module-load) node-builtin import** introduced by this work (node builtins stay
  lazy + desktop-guarded); the query/chat and format 👍/👎 rows are verified rendering in
  the mobile UI path (`Platform.isMobile` branch of `view.ts`).
- `npm run lint` clean; no new tsc errors in touched files.

## 11. Phasing (for writing-plans, addresses finding F-002)

1. **Foundation** — file rename + plugin-dir storage + auto-migration + `runId` plumbing +
   `rule_fired` event & telemetry accumulation + per-run record (`writeEvalRecord` /
   `updateEvalRating`) + 👍/👎 UI (query/chat + format, both axes, desktop + mobile).
2. **`eval.ts`** — new metrics + telemetry report over `eval.jsonl`.
3. **`dspy`** — binary rating + 👍-guard, format/vision trainsets.

Removals interleave: the evaluator/`eval_result` removal lands once the UI labels work; the
retrieval harness removal lands with the `eval.ts` rework.

## 12. docs/wiki update

After implementation, regenerate affected pages via `iwiki:iwiki-ingest`:

- `docs/wiki/llm-pipeline.md` — drop the "Evaluator Prompt Pattern" section; add the
  `rule_fired` telemetry + per-run record description.
- `docs/wiki/operations.md` — replace "Retrieval Eval Harness" with the new `eval.jsonl`
  human-label harness.

Then `/iwiki-lint` — no broken `[[refs]]`, no orphan/stale pages.

## 13. Strategic context & constraints (carried from intent)

- **Trust priority:** a label (and its telemetry) must map unambiguously to one
  prompt/model/config that produced the output. A miscounted rule firing is worse than an
  absent one — hence the structural `rule_fired` signal and the content-hash
  `promptVersion`.
- **Hard constraints:** prompt text stays in `prompts/*.md`; rule counts are surfaced via a
  typed signal (no `info_text` parsing); telemetry never triggers LLM calls; mobile keeps
  node builtins lazy + desktop-guarded.
- **Branch workflow:** all work on `dev/dev-mode-eval-rework`; merge to `master` via PR.
- **HUMAN CHECKPOINTS** (from the intent's Autonomy Zones) the plan must mark: deleting
  `evaluator.*` / the retrieval harness; the dspy pipeline design; any task touching the
  non-dev path; committing to `master` directly (already enforced by the Branch workflow
  line above — PR-only into `master`).
