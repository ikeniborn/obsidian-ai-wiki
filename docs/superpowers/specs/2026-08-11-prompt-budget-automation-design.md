---
review:
  spec_hash: 1321076f9f29aa13
  last_run: 2026-08-11
  revision: 4
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-009
      phase: consistency
      severity: CRITICAL
      section: 2. Approach decisions
      section_hash: 9a30098dc903891f
      text: "Revision 2 asserted that no content is ever truncated, but the residual case it relied on -- one evidence unit larger than the whole model window -- has no split and no widening left. The claim was unfounded rather than merely optimistic."
      fix: "State the widening order explicitly and name truncation as the sole terminal branch, reachable only past the whole context window and always logged."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-010
      phase: consistency
      severity: CRITICAL
      section: 2. Approach decisions
      section_hash: 9a30098dc903891f
      text: "The chunk budget was to subtract a group overhead measured from domainThemes and languageEvidence, which are produced by the evidence preparation the budget governs. The quantity was unavailable at the moment it was needed."
      fix: "Cap both lists so the worst case is a compile-time constant, and note that neither is read by the coverage invariant."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-011
      phase: consistency
      severity: CRITICAL
      section: 3. Budget arithmetic
      section_hash: b72b16db2632442c
      text: "An input override was clamped to the context window, so input plus output could exceed it: window 8192, override 8192, output 4096."
      fix: "Introduce maxInput as the ceiling for the derived value and the override alike."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-012
      phase: consistency
      severity: CRITICAL
      section: 2. Approach decisions
      section_hash: 9a30098dc903891f
      text: "The payload budget was calibrated while the chunker was deliberately not, so the two sides of the fit proof were measured on different scales."
      fix: "Convert the budget into raw estimator units at the single call site that sets it."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-013
      phase: clarity
      severity: CRITICAL
      section: 2. Approach decisions
      section_hash: 9a30098dc903891f
      text: "Seed coefficients were described as needing only to be in the right neighbourhood because calibration would correct them. Every new model starts at calibration 1 and the intent's band is absolute, so the seed governs the first request outright."
      fix: "Fit the seeds against the recorded data and state the resulting band."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-014
      phase: coverage
      severity: CRITICAL
      section: 4. Components
      section_hash: 72c73236f4fea440
      text: "Runtime wiring was underspecified: the probe target, the diagnostics channel of a helper with no onEvent, and the placement of the context-error hook relative to the repack loop were all left implicit, and the plan derived three defects from that."
      fix: "Name effectiveModel, the returned events array, and onContextError inside the repack boundary."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-015
      phase: coverage
      severity: CRITICAL
      section: 6. Error handling
      section_hash: cf8496a238329475
      text: "Declared events had no producer: context_probe was never emitted and calibration_sample could not report a discarded sample. The budget provenance was also unreachable from the layer that writes prompt_budget."
      fix: "Give the probe an event sink, have observeUsage return a CalibrationOutcome, and carry the provenance as one budgetTelemetry object."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-016
      phase: coverage
      severity: CRITICAL
      section: 7. Testing
      section_hash: af25325eb4798d3f
      text: "The overflow-recovery check relied on an oversized override, which the corrected clamp makes impossible; and the mandatory iwiki update was absent, with two pages already flagged stale against files this design rewrites."
      fix: "Poison the cached record instead, and make the wiki update part of closeout."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-017
      phase: consistency
      severity: CRITICAL
      section: 6. Error handling
      section_hash: 12f7252511c717a7
      text: "Revision 3 allowed a local preflight refusal when the fixed prompt exceeds the model window, while the intent forbade any size failure other than a provider rejection. The document had broken its own governing constraint to stay implementable."
      fix: "Amend the intent to allow exactly that failure, and state it as an unsupported model context rather than a configuration error."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-018
      phase: consistency
      severity: CRITICAL
      section: 2. Approach decisions
      section_hash: e2e23ba82829ff49
      text: "The calibration loop averaged ratios of actual to already-calibrated estimate, so its fixed point is the square root of the true factor: a real factor of 2 settles at 1.414, a permanent 29% underestimate in the dangerous direction."
      fix: "Multiply the factor instead of averaging the ratio into it, and require a multi-step convergence test."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-019
      phase: consistency
      severity: CRITICAL
      section: 3. Budget arithmetic
      section_hash: 50bc91cdec65f75f
      text: "The operation multiplier was applied after the override, so a stored format.maxTokens of 32768 became 131072 before clamping, silently changing what a saved setting means."
      fix: "Apply the multiplier to DEFAULT_OUTPUT_BASE only."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-020
      phase: coverage
      severity: CRITICAL
      section: 6. Error handling
      section_hash: 12f7252511c717a7
      text: "finish_reason=length was claimed fixed by correcting the ceiling, but outputRetryOptions is only reached where the model returned no text at all; a truncation raises StructuredOutputTruncatedError and propagates past that branch, so the growth path never runs."
      fix: "Catch the truncation inside the structured retry loop and re-issue with a larger limit; verify with an integration test per transport."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-021
      phase: coverage
      severity: WARNING
      section: 7. Testing
      section_hash: b580e3455f6dc8d0
      text: "The overflow scenario edited local.json while ModelContextStore holds an in-memory cache that outlives the edit, and a clean domain lint was set as an acceptance criterion although thirteen stale and two orphan pages predate this work."
      fix: "Reload around the poison and the restore with a guaranteed restore; scope the lint criterion to the three touched pages plus no new errors."
      verdict: fixed
      verdict_at: 2026-08-11
chain:
  intent:
    path: docs/superpowers/intents/2026-08-11-prompt-budget-automation-intent.md
    hash: 040e458f7faa2a18
---

# Design: prompt-budget-automation

**Date:** 2026-08-11
**Revision:** 4 — revision 1 was rewritten after a review found eleven defects (§9); revision 2 was corrected after a second review found seven more in the plan that traced back to this document (§10).
**Intent:** `docs/superpowers/intents/2026-08-11-prompt-budget-automation-intent.md` (Status: approved, `intent_hash: 040e458f7faa2a18`)

## 1. Problem

The prompt budget is not measured in tokens. `estimatePreparedMessages`
(`src/prompt-budget.ts:75`) returns the UTF-8 byte length of `JSON.stringify(messages)`, and
`estimateTokens` (`src/markdown-chunks.ts:186`) is the same byte count. Payloads are
serialized twice — once into a message `content`, once again for estimation — so every quote
is escaped twice.

Measured against the provider's reported `inputTokens` in `agent.jsonl`, the estimate
overshoots by 3.6–4.1×:

| request | estimated | actual | ratio |
|---|---|---|---|
| `llm-msohmb2c-1` | 14082 | 3767 | 3.74 |
| `llm-msohmzbi-2` | 15911 | 4381 | 3.63 |
| `llm-msohnp3o-3` | 7373 | 1809 | 4.08 |
| `llm-msohnp3o-3:bounded-1` | 7526 | 1851 | 4.07 |

Four defects follow.

**1.1 The budget is a guess.** `inputBudgetTokens: 16384` is roughly 4.1k real tokens while
the configured model has a context window of at least 128k. Nothing in the codebase reads a
model's context size: `grep context_length` matches only the error parser.

**1.2 Init hard-fails on size.** The fixed Init system prompt consumes ~11.2k of the 16.4k
budget, leaving 5276 for the bootstrap payload (`src/phases/init.ts:237`).
`boundBootstrapPayload` (`src/phases/ingest-evidence.ts:139`) keeps at least one candidate,
one fact and one `exactSource` entry and never truncates strings, so it cannot converge below
the size of one candidate. `runWithContextRepack` rethrows a preflight budget error without
repacking (`src/prompt-budget.ts:428`), producing
`init: configuration error — ... domain was not created.`

**1.3 The chunk budget and the payload budget are computed independently.** Chunk size is
bounded by `policy.inputBudgetTokens` (`src/phases/ingest-evidence.ts:983`,
`findLargestFeasibleBudget(1, 16384, ...)`) — up to ~16k. The bootstrap payload budget is
`inputBudgetTokens − fixedInitPrompt` ≈ 5276.

Bounding the chunk is not by itself enough, because a candidate is not chunk-scoped. Evidence
packets are grouped by `entityKey` and reduced: `reduceUntilBounded`
(`src/phases/ingest-evidence.ts:480-513`) and `dedupeVerifiedEvidencePackets`
(`src/phases/ingest-evidence.ts:369-374`) concatenate `facts` and `exactSource` across **every
chunk that mentions the entity**. One candidate can therefore aggregate ranges from many
chunks and exceed any per-chunk bound. The design must bound the evidence unit, not the chunk
alone.

**1.4 The output ceiling equals the output budget.** `outputRetryOptions`
(`src/phases/structured-output.ts:399`) grows `maxTokens` by 1.5× up to
`outputRetryBudgetTokens`, but `model-call-policy.ts:215` derives that ceiling as
`max(local.maxTokens, global.maxTokens)`. With `perOperation: false` this is
`max(4096, 4096) = 4096` — the current value — so growth is impossible by construction and a
truncated generation surfaces as `structural_error / schema_validate`.

## 2. Approach decisions

### 2.1 Token estimation: per-script coefficients plus runtime calibration

Rejected: a bundled tokenizer. Measured cost with esbuild, minified, one encoding,
tree-shaken: `gpt-tokenizer` cl100k_base adds 0.95 MB to the current 2.87 MB `main.js`
(+33%), `js-tiktoken` with cl100k ranks 1.04 MB, `gpt-tokenizer` o200k_base 2.63 MB (+92%).
Accuracy does not justify it, because cl100k is OpenAI's vocabulary and the target model is
DeepSeek behind a private proxy. Measured on repository content:

```
file                     chars   cl100k   per-script   bytes/3.5
init.md                   1507      372      +1.3%      +15.9%
base.md                   1166      256     +14.1%      +31.3%
_wiki_schema.md           4768     1205      -0.7%      +14.9%
ingest-evidence-map.md    2137      479     +11.7%      +27.6%
safari_proxy_guide.md    11837     4890     -22.2%       +3.5%
```

Rejected: a single byte divisor. `bytes / 3.5` underestimates Russian-heavy prompts, and
underestimation is the dangerous direction — it produces real `context_length_exceeded`.

Neither cl100k nor a fixed coefficient predicts the target model's BPE. The provider's real
count is available on every call: `usage.prompt_tokens` is already parsed and logged. The
design therefore measures instead of guessing.

The provider's own numbers close the loop: after every call the estimate is compared against
the reported `inputTokens`, and the resulting factor is applied to **every subsequent
estimate** — packing, preflight and telemetry alike. Applied, not merely recorded: a factor
that only lands in the cache changes nothing.

The correction is **multiplicative**, and this is not a detail. The observed ratio is
`actual / calibratedEstimate`, so it is already measured through the current factor. Averaging
those ratios into the factor makes it converge on the square root of the truth: with a real
factor of 2 the loop settles at 1.414, a permanent 29% underestimate — in the dangerous
direction. The factor is therefore multiplied, `calibration *= actual / calibratedEstimate`,
smoothed over the window and clamped. A convergence test over several steps is mandatory: a
single-step test cannot distinguish the two formulations.

The seed still has to be right on its own. Every new model starts at calibration 1, so the
first request against it is governed by the coefficients alone — and the intent's 15% band is
absolute, not one-sided. Seed coefficients are therefore **fitted** against the recorded data
rather than guessed: Cyrillic ÷2, Latin and punctuation ÷4, CJK ×1, plus a flat per-message
allowance. Those two values place all four recorded requests between +1.6% and +6.6% of the
provider's own count at calibration 1 — inside the band, and never below it, since
underestimating is the direction that produces real overflows.

The fit target comes from the four log entries, where the system message is identical
(4181 chars) in all four requests, so the differences isolate the payload ratio:

```
msg2 − msg1:  614 tokens over 1907 chars = 3.11 chars/token
msg2 − msg3: 2572 tokens over 6672 chars = 2.59
msg1 − msg3: 1958 tokens over 4765 chars = 2.43
```

### 2.2 Context window: lazy probe, cached, model-scoped

One probe per `(baseUrl, model)`, hardened against four failure modes the first revision
missed:

- **Model scoping.** `/v1/models` returns a list. The probe selects the entry whose `id`
  equals the configured model and reads the context length from that entry only. A context
  length found under a different model's entry is ignored — using it would produce a
  confidently wrong window and real overflows. If no entry matches by `id`, the probe treats
  the endpoint as having no answer.
- **Concurrency.** Several operations can start at once. The store keeps one in-flight promise
  per key, so concurrent callers share a single probe.
- **Cancellation and deadline.** The caller's `AbortSignal` propagates into the probe, and the
  2000 ms budget is a deadline shared across both endpoints, not 2000 ms per endpoint.
- **Fallback staleness.** A `default` record is cached with an expiry, so a provider that was
  merely unreachable at first use is re-probed later instead of being permanently pinned to
  the fallback. `discovered` and `learned` records do not expire.

Endpoint order: `GET /v1/models`, then Ollama's `POST /api/show`, then the backend constant.
Any probe failure falls through silently — it is not an error.

Rejected: probing upward by deliberately provoking provider rejections, which conflicts with
the intent's zero-unrecovered-overflow metric.

### 2.3 Migration: ask once, rewrite nothing without an answer

The origin of a stored value cannot be determined: `16384` may be an untouched default or a
number the user typed. Revision 1 cleared it on that guess, which violated the intent's hard
constraint against rewriting user values.

Instead, on the first load after the upgrade, an installation that still holds any native
budget value is shown one notice with two actions — switch to automatic, or keep the saved
numbers. Whatever the answer, `migrated_auto_budget` is set in `local.json` and the question
is never asked again. Declining leaves every value in place as an explicit override.

A fresh installation has no stored values, so it is automatic with no prompt.

### 2.4 Oversized payload: split at evidence-unit granularity

When the bootstrap payload exceeds its budget, it is split into K groups and the results
merged. Nothing is discarded.

Splitting whole candidates is not sufficient, because §1.3 shows one candidate can aggregate
evidence from many chunks. The split therefore descends one level: a candidate that does not
fit alone is divided into sub-candidates that share its `entityKey` and carry disjoint subsets
of its `facts` and `exactSource`. The same entity may appear in several groups with different
evidence.

This is safe because the bootstrap call produces a domain-level result — entity types, themes
and language notes — and the merge (§5.2) unions entity types across groups. A group seeing
part of an entity's evidence still contributes the same entity type.

Division is iterative, not a single arithmetic pass. One evidence unit can be far larger than
the average, so cutting a candidate into `ceil(size / budget)` parts can still leave a part
over budget. The splitter halves until every part fits or holds a single unit, then reports
the largest indivisible group upward.

**When the evidence is atomic, the budget moves, not the evidence.** The splitter never fails
on size — that would be the hard constraint the whole change exists to remove. The caller
widens the budget in a fixed order, stopping as soon as the group fits:

1. drop the schema block from the system prompt, the same lever `lint-chat.ts:272` already
   pulls;
2. reclaim the output reserve down to a floor that still fits a `DomainEntry`;
3. only if the unit is larger than the model's entire context window — where no prompt can
   contain it — truncate that one range on a line boundary with an explicit marker, leave
   `exactSourceRanges` intact so coverage is unaffected, and record `evidence_truncated`.

Branch 3 is the sole place in this design where content is lost, it is reachable only when a
single source fragment exceeds the whole model window, and it is always logged. Everything
short of that is handled by splitting and widening with no loss.

### 2.5 Chunk budget bound to the payload budget minus group overhead

Chunk size is bounded by `min(mapper request budget, payloadBudget − groupOverhead)` instead
of the raw input budget, where `groupOverhead` is what a group carries besides its evidence:
the duplicated `domainThemes` and `languageEvidence`, and the JSON envelope.

`groupOverhead` cannot be measured when it is needed. Both lists are produced by the very
evidence preparation the chunk budget governs. So they are **bounded rather than measured**:
`domainThemes` is capped at 24 entries, `languageEvidence` at 12, each entry at 240
characters. Neither list is read by the coverage invariant — they are signals for domain
naming and language inference, not evidence — so capping them loses no facts, and it makes the
worst-case overhead a compile-time constant available before chunking.

One further unit mismatch must be closed. `payloadBudget` is expressed in calibrated tokens,
while `chunkMarkdownSource` measures in raw estimator tokens: the chunker stays uncalibrated
so its boundaries are a pure function of the text. The **budget** is therefore divided by the
calibration factor at the single call site that sets it, so both sides of the comparison are
in the same unit. Comparing the two scales directly, as a first draft did, invalidates the fit
proof.

With those two corrections a single `exactSource` range, produced inside one chunk
(`assertLocalRange`), is bounded by the chunk, and the chunk is bounded by the payload budget
net of the worst-case overhead. One evidence unit therefore fits a group by construction, and
§2.4's widening covers the residual case where it does not.

This moves chunk boundaries. Existing domains are not re-indexed automatically; the user
re-runs `Init --force` manually, per the intent's hard constraint.

### 2.6 Scope: native-agent only

Automatic budgeting applies to `native-agent`. `claude-agent` keeps its stored defaults, its
settings layout, its policy resolution and its transport unchanged; it inherits the honest
token estimate and nothing else. Its context window is not discoverable — the CLI does not
expose one — so automating it would require a hardcoded per-model table this project would
have to maintain.

## 3. Budget arithmetic

The budget stops being a number from settings and becomes a computed value whose source is
recorded. Evaluated strictly in this order, so no value depends on one defined after it:

```
outputBudget  = min(override.output ?? DEFAULT_OUTPUT_BASE × operationMultiplier(op),
                    floor(contextWindow × OUTPUT_MAX_SHARE))                           (2)
maxInput      = floor((contextWindow − outputBudget) × SAFETY)                         (3)
inputBudget   = min(override.input ?? maxInput, maxInput)                              (4)
payloadBudget = inputBudget − fixedPromptEstimate                                      (5)
groupOverhead = worstCase(capped domainThemes + capped languageEvidence + envelope)     (6)
chunkBudget   = min(mapperRequestBudget, payloadBudget − groupOverhead) / calibration   (7)
```

Per request, after the prompt is packed and using the calibrated estimate:

```
outputCeiling = contextWindow − estimatedInput                                         (8)
```

`outputCeiling` is **not** part of the resolved budget object. Revision 1 stored it
statically as `contextWindow − inputBudget`, which is a different and looser quantity. It is
computed at the call site, immediately before dispatch, because only there is the actual
packed prompt known. That is what gives `outputRetryOptions` real room to grow.

Constants:

| Constant | Value | Rationale |
|---|---|---|
| `SAFETY` | `0.9` | absorbs residual estimator error after calibration |
| `DEFAULT_OUTPUT_BASE` | `8192` | the current per-operation default for Init and Lint; unchanged in meaning |
| `operationMultiplier` | `format: 4`, everything else `1` | preserves the deliberate 32768 output allowance `format` carries today against a base of 8192 |
| `OUTPUT_MAX_SHARE` | `0.5` | the reply may never claim more than half the window. Without this bound a small context leaves nothing for the input: at 8192 an unclamped base would take 8191 and reduce the input budget to zero |
| `BACKEND_DEFAULT` | `8192` real tokens | the fallback when no endpoint answers. Small enough not to exceed the window of any model realistically served, so it never causes an avoidable overflow |
| calibration window `N` | `8` samples | enough to damp a single anomalous `usage` report, short enough to follow a model swap |
| calibration clamp | `[0.5, 3.0]` | a sample outside this range indicates the provider counts `usage` differently than assumed |
| probe deadline | `2000` ms | shared across both endpoints, once per `(baseUrl, model)` |
| `default` record TTL | `24` hours | a provider unreachable at first use is re-probed later |

Worked examples, so the formulas are checkable:

| contextWindow | operation | outputBudget | inputBudget |
|---|---|---|---|
| 131072 (discovered) | `init` | `min(8192, 65536)` = 8192 | `floor((131072−8192)×0.9)` = 110592 |
| 131072 (discovered) | `format` | `min(32768, 65536)` = 32768 | `floor((131072−32768)×0.9)` = 88473 |
| 8192 (fallback) | `init` | `min(8192, 4096)` = 4096 | `floor((8192−4096)×0.9)` = 3686 |

With `BACKEND_DEFAULT` at 8192 the derived input budget is 3686 tokens — smaller than today's
effective 4.1k. That is the intended trade: it is honest, it never overflows, and the repack
loop plus the learned cache recover from it. The intent's ≥16k outcome is conditional on
discovery reporting a window, which is why §2.2 hardens the probe rather than inflating the
fallback.

`maxInput` in (3) is the ceiling for the derived value **and** for an override. Clamping an
override to the whole window instead would let input and output together exceed the context:
window 8192 with an 8192 override and a 4096 output budget sums to 12288.

Two sources are tracked separately, because the input can be automatic while the output is
overridden and vice versa:

```
inputSource  ∈ override | discovered | learned | default
outputSource ∈ override | default
```

Revision 1 collapsed them into one field, so an operation with any stored `maxTokens` reported
`source: override` even when its input budget had been derived from a discovered window.

## 4. Components

### 4.1 `src/token-estimate.ts` (new) — how many tokens is this

```ts
export const MEDIA_TOKENS: number;
export function estimateText(text: string, calibration?: number): number;
export function estimateMessages(
  messages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
  calibration?: number,
): number;
```

Counts each message character by character (Cyrillic ÷2, CJK ×1, everything else ÷3.5), adds
a flat 4 tokens per message for its role and separators, adds `MEDIA_TOKENS` per `image_url`
part without counting the URL, and counts every other string-valued field — `name`,
`tool_calls[].function.arguments`, `tool_call_id` — as text. That preserves the existing
"metadata is counted" behaviour without the double-JSON inflation. The result is multiplied by
`calibration`, default `1`. Pure, no I/O.

### 4.2 `src/model-context.ts` (new) — what is known about this model

```ts
export interface ModelContextRecord {
  contextWindow: number;
  source: "discovered" | "learned" | "default";
  calibration: number;   // estimated → actual, moving average over N samples
  samples: number;
  expiresAt?: number;    // set for `default` records only
}

export interface ModelContextStore {
  get(baseUrl: string, model: string): ModelContextRecord | undefined;
  resolve(baseUrl: string, model: string, apiKey: string, signal?: AbortSignal): Promise<ModelContextRecord>;
  observeUsage(baseUrl: string, model: string, estimated: number, actual: number): CalibrationOutcome;
  observeContextError(baseUrl: string, model: string, maxContextTokens?: number): void;
}

/** What observeUsage actually did, so the telemetry reports the truth. */
export interface CalibrationOutcome { ratio: number; applied: boolean; clamped: boolean }

export function probeContextWindow(
  fetchFn: typeof fetch,
  baseUrl: string,
  apiKey: string,
  model: string,
  deadlineMs: number,
  signal?: AbortSignal,
  onProbe?: (event: ContextProbeEvent) => void,
): Promise<number | null>;
```

`resolve` is lazy and deduplicated: cache hit that has not expired → the in-flight promise for
that key if one exists → a fresh probe. Persisted through an injected reader/writer pair, so
the store has no Obsidian dependency and is testable against a plain object. It knows nothing
about prompts, phases or evidence.

### 4.3 `src/budget-resolver.ts` (new) — how much may be spent

```ts
export interface ResolvedBudget {
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  contextWindow: number;
  inputSource: "override" | "discovered" | "learned" | "default";
  outputSource: "override" | "default";
  calibration: number;
}

export function resolveBudget(
  record: ModelContextRecord,
  operation: OpKey,
  overrides: { input?: number; output?: number },
): ResolvedBudget;

export function outputCeiling(contextWindow: number, estimatedInput: number): number;
```

Pure functions. All reserve, multiplier and safety arithmetic lives here and nowhere else.
`outputCeiling` is deliberately separate and takes the packed estimate, per §3 (7).

### 4.4 Runtime wiring

Revision 1 referenced a `this.modelContextStore` that does not exist and assumed a
synchronous resolution path that is not one. The real wiring:

| Site | Change |
|---|---|
| `src/controller.ts:124` | `LocalConfigStore` is already injected. Construct one `ModelContextStore` beside it, with `read`/`write` adapters over `LocalConfig.modelContext` and a `fetchFn` from `selectNativeFetch`. |
| `src/controller.ts:766` | Pass the store into the `AgentRunner` constructor. |
| `src/agent-runner.ts:52` | `buildOptsFor` becomes `async` and returns its diagnostics as an array rather than emitting them: it is a private helper with no `onEvent` in scope. Its two call sites (`:233`, `:238`) await it and yield the events. For `claude-agent` it returns today's result unchanged and never touches the store. |
| `src/model-call-policy.ts` | Exports `effectiveModel(settings, operation, parent?)`. The probe must target the model the call will use: with `perOperation` enabled the policy picks `local?.model ?? global.model` (`:228`), so probing `global.model` unconditionally would cache one model's window under another's budget. |
| `src/prompt-budget.ts` | `runWithContextRepack` gains an `onContextError` callback, invoked where it already classifies a failure. A terminal `catch` never sees an error the repack loop recovered from — and a recovered overflow is precisely the signal that teaches the cache, so without this hook the `learned` source can never appear. |

The record-aware resolver is introduced as a **new export beside** the existing
`resolveModelCallPolicy`, and the old one is deleted only once every caller has moved.
Changing the signature in place would leave the codebase uncompilable between two units of
work, which makes neither of them independently verifiable.

### 4.5 Changes to existing modules

| File | Change |
|---|---|
| `src/prompt-budget.ts` | `estimatePreparedMessages(messages, calibration?)` delegates to `estimateMessages`. The added parameter is optional, so the twelve existing call sites keep compiling; the budget-consuming ones pass `opts.tokenCalibration`. |
| `src/markdown-chunks.ts` | `estimateTokens` delegates to `estimateText`. |
| `src/types.ts` | native settings budgets become optional; `LlmCallOptions` gains `tokenCalibration?: number` and `onUsageObserved?`; three new `RunEvent` kinds; `prompt_budget` gains `contextWindow`, `inputSource`, `outputSource`, `calibration`. |
| `src/local-config.ts` | `LocalConfig` gains `modelContext` and `migrated_auto_budget`. |
| `src/model-call-policy.ts` | native budgets come from `resolveBudget`; the `claude-agent` branch is untouched. |
| `src/phases/structured-output.ts` | ceiling from `outputCeiling(contextWindow, estimatedInput)` computed per request; report usage back for calibration. |
| `src/phases/ingest-evidence.ts` | `boundBootstrapPayload` → `splitBootstrapPayload` at evidence-unit granularity; `chunkBudgetTokens` in `EvidencePolicy`. |
| `src/phases/init.ts` | bind the chunk budget net of group overhead; merge K bootstrap entries; drop the size-based hard failure. |
| `src/settings.ts`, `src/i18n.ts` | native budget fields move to Advanced, empty means automatic; the control is always rendered; strings in ru/en/es. `Compression profile` stays where it is: it selects semantics, not arithmetic. |
| `src/main.ts` | the one-shot upgrade notice from §2.3. |

The boundary below `LlmCallOptions` does not move. Phases keep receiving
`inputBudgetTokens: number` and do not know where it came from.

## 5. Data flow

### 5.1 Init, end to end

```
1. AgentRunner.buildOptsFor("init")                                   [async]
     └─ ModelContextStore.resolve(baseUrl, model, apiKey, signal)
          fresh cache? → in-flight probe? → GET /v1/models (id match)
          → POST /api/show → BACKEND_DEFAULT (with TTL)
          ⇒ { contextWindow: 131072, source: "discovered", calibration: 1.04 }
     └─ resolveBudget(record, "init", overrides)
          ⇒ input 110592, output 8192, inputSource "discovered", outputSource "default"
     └─ agent.jsonl: { kind: "budget_resolved", operation: "init", ... }

2. init.ts
     fixedPromptEstimate = estimateMessages(system prompt + empty payload, calibration)
     payloadBudget       = 110592 − fixedPromptEstimate
     groupOverhead       = estimate(themes + languageEvidence + envelope)
     chunkBudget         = min(mapperRequestBudget, payloadBudget − groupOverhead)

3. prepareBootstrapEvidenceBundle(...)
     chunk the source by chunkBudget
     mapper calls → evidence packets → candidates (aggregated per entityKey)

4. splitBootstrapPayload(payload, payloadBudget) → BootstrapEvidence[]
     fits whole                → [payload]              ← normal case
     candidate too large alone → sub-candidates by evidence unit
     ⇒ K groups, each ≤ payloadBudget

5. K × init.bootstrap → K × DomainEntry → mergeBootstrapEntries(...)

6. bootstrapTaxonomyIssue(merged, FULL bootstrapEvidence)
     coverage is checked against all evidence, not against one group

7. per request: outputCeiling(contextWindow, estimatedInput) → opts.outputRetryBudgetTokens
8. after each call: observeUsage(estimated, actual); on a context error, observeContextError
```

### 5.2 Merge semantics

`DomainEntry` is `{ id, name, wiki_folder, entity_types[], language_notes }`. Merging K
responses is deterministic, with no heuristic conflict resolution:

| Field | Rule | Why this is safe |
|---|---|---|
| `id` | from group 0 | `domainId` is an input to the prompt (`os-mac`); the model does not invent it |
| `wiki_folder` | from group 0 | same; under `force && existing` it is overwritten from `existing` anyway |
| `name` | from group 0 | derived from `id` |
| `entity_types` | union through the existing `mergeBootstrapEntityTypes`, folded over K | the function already exists and already merges against `existing`; no new logic |
| `language_notes` | first non-empty | language notes for one source do not diverge |

A conflict on `id` or `wiki_folder` between groups is not resolved silently: the divergence is
recorded in `agent.jsonl` and group 0 wins. This is the only place where the split path can
differ from a single call.

### 5.3 Grouping

Greedy and two-level. Candidates are filled into a group in order until the estimate exceeds
`payloadBudget`. A candidate that does not fit an empty group is divided into sub-candidates
carrying disjoint subsets of its `facts` and `exactSource` under the same `entityKey`.
`domainThemes` and `languageEvidence` are duplicated into every group; that duplication is
exactly the `groupOverhead` subtracted in §3 (6).

A single evidence unit that does not fit is impossible after §2.5. If it happens anyway it is
a construction bug, not user input: raise with an explicit message about the chunk-budget
misalignment, naming both numbers, and never with the words "configuration error".

## 6. Error handling

No budget-resolution failure is visible to the user. The only visible size-related failure is
a provider rejection after every recovery loop has run.

| Situation | Behaviour | User-visible |
|---|---|---|
| Probe times out, fails, or 404s | next endpoint, then the constant with a TTL | no, `agent.jsonl` only |
| Probe returns garbage, or no entry matches the model `id` | treated as no answer | no |
| Concurrent operations start together | one shared in-flight probe per key | no |
| The caller aborts during a probe | the probe aborts with it; nothing is cached | no |
| The model behind a name is swapped for a smaller one | provider returns `context_length_exceeded` → `shrinkInputBudget` → cached as `learned` | no, self-healing |
| `context_length_exceeded` | existing `runWithContextRepack`, up to two repacks | no, until exhausted |
| Repack exhausted | the provider error as-is — the only acceptable size failure | yes |
| `finish_reason=length` | caught inside the structured retry loop and retried with a larger limit | no |
| Output ceiling reached and still truncated | existing structured repair, then an error | yes |
| Provider reports no `usage` | calibration is not updated, the step is skipped | no |
| Override exceeds the model context | clamped to the context, the clamp is logged | no |

### 6.1 The fixed prompt does not fit the model context

Today this is `init: configuration error — fixed bootstrap prompt requires N tokens but input
budget is M; domain was not created.` The cause was the invented budget. Once the budget is
derived from the model's context, this genuinely means the Init system prompt is larger than
the model's window.

Following the existing pattern at `lint-chat.ts:272`, first rebuild the prompt without
`schema_block` and re-estimate. If that still does not fit, fail with an honest message naming
the model and its context window rather than a user setting, and without the words
"configuration error" — there is nothing for the user to configure.

### 6.2 Truncated generation

`outputRetryOptions` is not reachable from a truncation today. It is called only where the
model returned **no usable text at all** and `consumedOutputLimit` is true
(`src/phases/structured-output.ts:766`, `:837`). A `finish_reason: "length"` raises
`StructuredOutputTruncatedError` from `callWithFormatFallback` (`:483`, `:640`, `:648`) and
propagates past that branch, so the growth path never runs. Fixing the ceiling alone, as a
first draft assumed, changes nothing.

The retry loop must catch `StructuredOutputTruncatedError`, apply `outputRetryOptions` to the
current options, and re-issue — on both the streaming and the non-streaming path, each of
which raises it from a different place. Verification is an integration test per path that
feeds a real `finish_reason: "length"` and asserts a second request with a larger `maxTokens`,
not a unit test of the pure function.

### 6.3 Corrupted calibration

One anomalous `usage` value must not break budgeting. The correction is a moving average over
the last 8 samples, hard-clamped to `[0.5, 3.0]`. A sample outside the range is discarded and
logged: it indicates that the provider counts `usage` differently than assumed, which is
diagnostics, not a reason to change behaviour.

### 6.4 Diagnostics

Five new events in `agent.jsonl`; existing diagnostics are not reduced:

```
budget_resolved     { operation, model, contextWindow, inputSource, outputSource,
                      calibration, samples, inputBudget, outputBudget }
context_probe       { baseUrl, model, endpoint, ok, ms, matchedById, contextLength? }
calibration_sample  { model, estimated, actual, ratio, applied, clamped }
evidence_split      { callSite, groups, candidates, subdivided, payloadBudget }
evidence_truncated  { entityKey, range, keptTokens, totalTokens, budget }
```

Each event needs a producer, or it is decoration. `context_probe` is emitted by an event sink
the probe accepts; `calibration_sample` reports the outcome `observeUsage` returns, so a
discarded sample records `applied: false, clamped: true` rather than a hardcoded success.

`prompt_budget` gains `contextWindow`, `inputSource`, `outputSource` and `calibration`. These
describe how the budget was decided, not how the call behaves, so they travel as one opaque
`budgetTelemetry` object on `LlmCallOptions` rather than as four separate call options that
nothing below this layer reads. It
already carries both `estimatedInputTokens` and `actualInputTokens` on the same record, which
is what verification correlates on — never array position across two event streams. Sidebar
text does not change: numbers go to the log, not the UI.

## 7. Testing

Tests pass `inputBudgetTokens` directly into `LlmCallOptions` (`ingest-bounded.test.ts` uses
20 000, 40 000, 12 500 and others) rather than reading it from settings, so the
`LlmCallOptions` boundary keeps them structurally valid. What changes is the meaning of the
number: a budget of 20 000 used to mean 20 000 bytes (≈5 700 tokens) and now means 20 000
tokens.

### 7.1 Existing tests

| Class | Action | Examples |
|---|---|---|
| Set a budget, assert **relationships** | leave alone; the invariant is unit-independent | most of `prompt-budget.test.ts` |
| Set a budget, assert **absolute values** | rewrite as a relationship against the same estimator, or divide the constant by 3.5 with a comment naming this change | parts of `ingest-bounded.test.ts`, `format-budget.test.ts`, `query-budget.test.ts` |
| Assert the size-related hard failure | inverted: success through split is now expected | `init-bootstrap-fail-loud.test.ts` |
| Settings and migrations | new cases | `settings-model-controls.test.ts`, `model-call-policy.test.ts` |

When rescaling, convert the assertion to a relationship rather than tuning the constant until
it passes; otherwise the next estimator change breaks it again.

### 7.2 New tests

**`token-estimate.test.ts`.** Fixtures carry the recorded character counts, message counts and
provider token totals, with the payload script mix stated as an explicit assumption. Three
distinct assertions, because one of them alone hides the case that matters:

- the **absolute** band at calibration 1 — `abs(estimated / actual − 1) ≤ 0.15` — which is
  what the first request against an unseen model actually experiences;
- no underestimation at calibration 1, since that direction produces real overflows;
- a fitted factor keeps every case inside the band, which tests the calibration path itself.

A test that fits an offline factor before checking the band, as a first draft did, conceals a
seed that misses it.

**`model-context.test.ts`.** The probe selects by model `id` and ignores another model's
context length; garbage and non-matching responses; the deadline is shared across endpoints;
a caller abort cancels and caches nothing; concurrent `resolve` calls share one probe; a
`default` record expires and is re-probed; `observeContextError` shrinks and marks `learned`;
calibration is a clamped moving average that discards anomalies.

**`budget-resolver.test.ts`.** Formula order; `format` receives 4× the base output; an
override is clamped to the context window; `inputSource` and `outputSource` move
independently; `outputCeiling(contextWindow, estimatedInput)` exceeds the output budget — the
regression test for §1.4.

**Split and merge**, in `ingest-evidence.test.ts` and the `init-*` suites. The central case is
equivalence: on the same evidence, the merged result of K calls equals the result of a single
call. Plus a candidate aggregating ranges from several chunks that must be subdivided, a
forced K ≥ 3, an `id` conflict between groups, and taxonomy coverage checked against the full
evidence.

**Chunk budget binding.** An invariant test over a source whose entity spans many chunks: no
resulting evidence unit exceeds `payloadBudget − groupOverhead`.

**Migration.** The notice appears once when a stored value exists; accepting clears the native
budgets; declining leaves them; `migrated_auto_budget` is set either way; a second load is
silent; `claude-agent` values are untouched in both branches.

**Settings rendering.** The control renders when the value is `undefined`, and clearing it
deletes the property rather than keeping the previous number — the guard at
`src/settings.ts:355` returns early today and must go. The placeholder shows the resolved
automatic value read from the **cached** context record only: rendering a settings tab must
never trigger a network probe, and with nothing cached the field shows the word "Automatic",
which is honest because no budget has been resolved yet.

### 7.3 Baselines for the health metrics

Captured before any change and committed: the full-suite pass/fail counts, and LLM call counts
**per operation and `callSite`**, not one total per fixture. A single total cannot show that
Init got cheaper while Ingest got more expensive.

### 7.4 Live verification

The intent's "Done when" requires a real run. Four distinct checks, none of which substitutes
for another:

1. `init os-mac --force --sources ОС/Mac/` ends with history `status: done`.
2. Estimate against actual, read from single `prompt_budget` records that carry both fields,
   within 15%.
3. An oversized-evidence scenario produces `evidence_split` and a created domain, with no
   content discarded.
4. A provider context-overflow is recovered by the repack loop without surfacing. An oversized
   override cannot produce one — §3 clamps it to `maxInput` — so the scenario poisons the
   cached context record instead, which is also the real-world case the path exists for: a
   model swapped behind an unchanged name. `ModelContextStore` holds an in-memory cache that
   outlives a file edit, so the plugin must be reloaded after poisoning and again after
   restoring, and the restore must be guaranteed rather than left to the last command
   succeeding. Afterwards the record must read `source: "learned"` with a smaller window. This is a separate scenario from check 2, which
   measures the estimator and proves nothing about recovery.

The project wiki is part of closeout, not an afterthought: `wiki_lint` already reports
`architecture/prompt-budget-governor` (source `src/agent-runner.ts`) and
`architecture/model-call-controls` (source `src/model-call-policy.ts`) as stale, and both are
files this design rewrites. Both pages are updated and a page is added for the new modules. The domain carries thirteen
stale and two orphan pages unrelated to this work, so a clean lint of the whole domain is not
an achievable criterion: the requirement is that the three pages touched here are not stale
and that no new lint error appears.

## 8. Acceptance (from intent)

### Desired Outcomes

- Init `os-mac --force --sources ОС/Mac/` on the same vault completes successfully and the
  domain is created; the `data.json` history entry reports `done`, not `error`.
- In `agent.jsonl`, `estimatedInputTokens` differs from the provider's reported
  `inputTokens` by no more than ~15% (currently a factor of ~4).
- No Init or Ingest run ends with `configuration error — ... domain was not created` because
  of input size. A long `exactSource[].text` is truncated with an explicit marker or split
  across calls, and the domain is created.
- The main Settings section no longer shows `Input budget tokens`, `Repair input budget` or
  `Output budget tokens` for the native backend. All three live under Advanced and are empty
  by default, meaning automatic. Previously saved values keep working as an explicit override.
- On first load after the upgrade, an installation that still holds budget values is offered
  a single explicit choice — switch to automatic, or keep the saved numbers. Nothing is
  rewritten without that answer, and the choice is asked once.
- When discovery reports a context window, the effective input budget for Init is at least 4×
  the current 16384-byte-derived limit — that is, ≥16k real tokens. When no endpoint reports
  a window, the conservative fallback applies instead and the budget is smaller; that is a
  correct outcome, not a failure. In both cases `agent.jsonl` records which source produced
  the boundary: discovery, a learned value, or the fallback default. It is never the constant
  16384.
- A truncated generation (`finish_reason=length`) triggers a retry with a larger output
  limit instead of a `structural_error / schema_validate` failure.

### Done when

`init os-mac --force --sources ОС/Mac/` on the real vault finishes with `status: done`;
`agent.jsonl` shows the input estimate within 15% of the provider's reported value, correlated
per request rather than by array position; the main Settings section contains no native budget
fields; a reproduced oversized-evidence scenario creates the domain with the split recorded in
the log and no content discarded; and a reproduced provider context-overflow is recovered by
the repack loop without surfacing to the user.

### Note on the truncation wording

Desired Outcome 3 allows either resolution — "truncated with an explicit marker **or split
across calls**" — and the design takes the split branch, so no content is truncated. Result
reconciliation should accept an `evidence_split` record where a truncation marker is
mentioned.

## 9. What revision 1 got wrong

Recorded so the same mistakes are not reintroduced.

| # | Defect | Fixed in |
|---|---|---|
| 1 | Migration cleared values whose origin cannot be determined, violating a hard constraint | §2.3 |
| 2 | The fallback could not deliver the ≥16k input budget the spec claimed: `floor((16384−8192)×0.9)` is 7372 | §3, and the intent's outcome is now conditional |
| 3 | `maxTokens` was kept while the spec said to clear it, so every budget reported `source: override` | §3, split into `inputSource` and `outputSource` |
| 4 | The calibration factor was stored but never applied to any estimate | §2.1, §4.1, §4.5 |
| 5 | Runtime wiring referenced a store that does not exist, and a sync path that is async | §4.4 |
| 6 | "One candidate always fits" was false: candidates aggregate evidence across chunks | §1.3, §2.4, §2.5 |
| 7 | The output ceiling was static, not per-request as the spec required | §3 (7), §4.3 |
| 8 | Empty settings fields would vanish rather than show as automatic | §4.5, §7.2 |
| 9 | `claude-agent` was in fact modified, against a hard constraint | §2.6 |
| 10 | The probe could adopt another model's context window | §2.2 |
| 11 | Verification correlated two event streams by array position and expected an impossible status value | §6.3, §7.4 |

## 10. What revision 2 got wrong

A second review, this time of the plan, found seven defects that traced back to this document.
Recorded so they are not reintroduced.

| # | Defect | Fixed in |
|---|---|---|
| 1 | Group overhead was to be computed from `domainThemes` and `languageEvidence`, which do not exist until the evidence preparation the budget governs has run | §2.5 — both lists are capped, so the worst case is a constant |
| 2 | The splitter divided once and then failed on size, which the intent's hard constraint forbids | §2.4 — iterate to atomic, then widen the budget; truncate only beyond the whole window |
| 3 | The chunker was uncalibrated while the payload budget was calibrated, so the fit proof compared two scales | §2.5 — the budget is converted into raw estimator units |
| 4 | An input override was clamped to the window rather than to what remains after the output reserve | §3 — `maxInput` bounds both |
| 5 | Runtime wiring probed the wrong model and assumed an event channel the helper does not have | §4.4 — `effectiveModel`, a returned events array, `onContextError` inside the repack boundary |
| 6 | Seed coefficients were treated as approximate because calibration would fix them, but every new model starts at calibration 1 and the intent's band is absolute | §2.1 — fitted seeds, Latin ÷4 |
| 7 | Declared events had no producer and the overflow scenario became impossible once overrides are clamped | §6.3, §7.4 |

## 11. What revision 3 got wrong

| # | Defect | Fixed in |
|---|---|---|
| 1 | The intent's hard constraint was unsatisfiable and this document quietly broke it: a model whose window cannot hold the fixed prompt admits no provider rejection either | Intent revision 3 now allows exactly that one further failure; §6.1 states it |
| 2 | The calibration loop averaged ratios that were themselves measured through the current factor, converging on its square root — a permanent underestimate | §2.1 — multiplicative correction plus a mandatory convergence test |
| 3 | The operation multiplier was applied to an output override, turning a stored `format.maxTokens` of 32768 into 131072 | §3 (2) — the multiplier scales the default only |
| 4 | `finish_reason=length` was declared fixed, but the growth path is unreachable from a truncation: the error propagates past the only branch that calls `outputRetryOptions` | §6.2 — catch it in the retry loop, integration-test both transports |
| 5 | The overflow scenario edited a file while the store holds an in-memory cache that outlives the edit | §7.4 — reload after poisoning and after restoring, with a guaranteed restore |
| 6 | "Clean lint" was an unreachable acceptance criterion: the domain carries thirteen stale and two orphan pages unrelated to this work | §7.4 — the three touched pages, and no new errors |
