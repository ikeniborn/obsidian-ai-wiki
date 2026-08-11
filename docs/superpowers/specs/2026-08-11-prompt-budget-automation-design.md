---
review:
  spec_hash: eaf96ca6b05732dd
  last_run: 2026-08-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: 4. Components
      section_hash: 885066639d44d89a
      fragment: "settings.ts, i18n.ts | budget fields move to Advanced"
      text: "The accepted scope item \"keep compressionProfile, it is semantics not arithmetic\" was not reflected anywhere in the spec."
      fix: "State in 4.4 that Compression profile stays in the main settings section."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-002
      phase: coverage
      severity: WARNING
      section: Acceptance (from intent)
      section_hash: d0c7f297bc8a24dc
      fragment: "Two clauses above say \"truncated with an explicit marker\""
      text: "Overstated: Desired Outcome 3 already permits \"or split across calls\", so only the \"Done when\" clause diverges."
      fix: "Narrow the note to the \"Done when\" clause and say how result reconciliation should treat the substitution."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-003
      phase: clarity
      severity: CRITICAL
      section: 3. Architecture
      section_hash: 626bea9a0cb327da
      fragment: "inputBudget = override ?? floor((contextWindow - outputReserve) x SAFETY)"
      text: "Circular definition: outputReserve was defined as outputBudget, outputBudget depended on inputBudget, and inputBudget depended on outputReserve. The formulas were not computable."
      fix: "Order the formulas explicitly and drop outputReserve in favour of outputBudget, which is resolved first."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-004
      phase: clarity
      severity: WARNING
      section: 2. Approach decisions
      section_hash: c16ec83985780158
      fragment: "with a short timeout"
      text: "The probe timeout was the only constant left unquantified after the other constants were pinned."
      fix: "Pin it to 2000 ms in the constants table and in 2.2."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-005
      phase: clarity
      severity: INFO
      section: 3. Architecture
      section_hash: 626bea9a0cb327da
      fragment: "ModelContext store"
      text: "One entity carried three names: \"ModelContext store\", \"ModelContextStore\", \"model context cache\"."
      fix: "Use ModelContextStore throughout."
      verdict: fixed
      verdict_at: 2026-08-11
chain:
  intent:
    path: docs/superpowers/intents/2026-08-11-prompt-budget-automation-intent.md
    hash: 77a5215b67e1d735
---

# Design: prompt-budget-automation

**Date:** 2026-08-11
**Intent:** `docs/superpowers/intents/2026-08-11-prompt-budget-automation-intent.md` (Status: approved)

## 1. Problem

The prompt budget is not measured in tokens. `estimatePreparedMessages`
(`src/prompt-budget.ts:75`) returns the UTF-8 byte length of
`JSON.stringify(messages)`, and `estimateTokens` (`src/markdown-chunks.ts:186`) is the same
byte count. Payloads are serialized twice — once into a message `content`, once again for
estimation — so every quote is escaped twice.

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
the size of one `exactSource[].text`. `runWithContextRepack` rethrows a preflight budget error
without repacking (`src/prompt-budget.ts:428`), producing
`init: configuration error — ... domain was not created.`

**1.3 The chunk budget and the payload budget are computed independently.** Chunk size is
bounded by `policy.inputBudgetTokens` (`src/phases/ingest-evidence.ts:983`,
`findLargestFeasibleBudget(1, 16384, ...)`) — up to ~16k. The bootstrap payload budget is
`inputBudgetTokens − fixedInitPrompt` ≈ 5276. An `exactSource` range is bounded by its chunk
(`assertLocalRange`), so a single range can legally be three times larger than the payload
budget. This mismatch is the root cause of the unreachable floor in 1.2.

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

Coefficients are calibrated against the provider's own numbers. The same four log entries
give the payload ratio directly, because the system message is identical (4181 chars) in all
four requests:

```
msg2 − msg1:  614 tokens over 1907 chars = 3.11 chars/token
msg2 − msg3: 2572 tokens over 6672 chars = 2.59
msg1 − msg3: 1958 tokens over 4765 chars = 2.43
```

Starting coefficients: Cyrillic ÷2, Latin and punctuation ÷3.5, CJK ×1, plus a fixed
per-message allowance for role and separators. A runtime correction factor per
`(baseUrl, model)` converges the estimate to the provider's own accounting within a few
calls.

### 2.2 Context window: lazy probe, cached

`GET /v1/models`, then Ollama's `POST /api/show`, then a per-backend constant. One probe per
`(baseUrl, model)` with a 2000 ms timeout; the result is persisted. Any probe failure falls
through silently — it is not an error. Rejected: probing upward by deliberately provoking
provider rejections, which conflicts with the intent's zero-unrecovered-overflow metric.

### 2.3 Migration: clear default-valued budgets only

A stored value exactly equal to the old default (`inputBudgetTokens` 16384,
`repairInputBudgetTokens` 65536, the per-operation `maxTokens` defaults) was written by the
plugin, not chosen by the user. It is cleared, enabling automatic budgeting. Any other value
is a deliberate choice and is preserved as an explicit override. One-shot, guarded by
`migrated_auto_budget` in `local.json`, recorded in `agent.jsonl`.

Without this, every existing installation would keep 16384 forever and the defect would
persist unchanged.

### 2.4 Oversized payload: split across calls, not truncation

When the bootstrap payload exceeds its budget, candidates are split into K groups and the
results merged. Nothing is discarded.

Splitting alone does not cover a single `exactSource[].text` larger than the budget, because
a one-candidate group cannot be divided further. That case is removed structurally by 2.5
rather than by truncation, so no content is ever truncated.

### 2.5 Chunk budget bound to the payload budget

Chunk size is bounded by `min(mapper request budget, bootstrap payload budget)` instead of
the raw input budget. An `exactSource` range is bounded by its chunk, so a single range
always fits the payload budget by construction — this closes defect 1.3 and makes the
`boundBootstrapPayload` floor reachable.

This moves chunk boundaries. Existing domains are not re-indexed automatically; the user
re-runs `Init --force` manually, per the intent's hard constraint.

## 3. Architecture

The budget stops being a number from settings and becomes a computed value with a recorded
source.

```
                    ┌──────────────────────────────────┐
                    │  BudgetResolver                  │
                    │  src/budget-resolver.ts          │
                    └──────────────────────────────────┘
                       │              │             │
        contextWindow  │              │ calibration │  overrides
                       ▼              ▼             ▼
              ┌────────────────┐  ┌────────┐  ┌──────────┐
              │ ModelContext-  │  │ Token  │  │ Settings │
              │ Store (local)  │  │ Estim. │  │ Advanced │
              └────────────────┘  └────────┘  └──────────┘
                    ▲     ▲            ▲
      probe /v1/models     │           │
      probe /api/show      │           │
                           │           │
              context_length_exceeded  │
                     (shrink)          │
                                       │
                        inputTokens from the provider
                              (calibration)
```

Three sources of truth replace one constant:

| Value | Source | Persisted to |
|---|---|---|
| Model context window | probe → cache → backend constant | `local.json`, event in `agent.jsonl` |
| Estimator correction | the provider's `inputTokens` on every call | `local.json` |
| Override | Advanced settings field, empty means automatic | `data.json` |

Formulas:

Evaluated strictly in this order, so no value depends on one defined after it:

```
outputBudget  = override.output ?? defaultOutput                        (1)
inputBudget   = override.input  ?? floor((contextWindow − outputBudget) × SAFETY)   (2)
outputCeiling = contextWindow − estimatedInput   (replaces max(local, global))      (3)
payloadBudget = inputBudget − fixedPromptEstimate                       (4)
chunkBudget   = min(mapperRequestBudget, payloadBudget)                 (5)
```

`outputBudget` is the reserve subtracted in (2): the input budget must leave room for the
reply it is asking for. `outputCeiling` in (3) is computed per request, after the prompt is
packed, and is what makes `outputRetryOptions` able to grow — it is deliberately larger than
`outputBudget`.

Constants, fixed here so the formulas are unambiguous:

| Constant | Value | Rationale |
|---|---|---|
| `SAFETY` | `0.9` | absorbs estimator error; the measured worst case is well inside 10% |
| `defaultOutput` | `8192` | the current per-operation default for Init and Lint; unchanged in meaning |
| `BACKEND_DEFAULT` | `16384` real tokens | the fallback when no probe answers. Four times the current effective limit, so the ≥16k desired outcome holds even with discovery unavailable, and at or below the context window of any model realistically served by this backend |
| calibration window `N` | `8` samples | enough to damp a single anomalous `usage` report, short enough to follow a model swap |
| probe timeout | `2000` ms | the probe runs once per `(baseUrl, model)`; two seconds is short enough not to be felt at operation start and long enough for a local Ollama to answer |

`BACKEND_DEFAULT` is the intent's "conservative" constant: a single value declared in code,
not derived at runtime.

Two feedback loops, both partially present today:

- **Down:** `context_length_exceeded` → `shrinkInputBudget` → the shrunk window is written to
  the cache as `learned`. Existing; only the cache write is new.
- **Calibration:** after each call, `estimated` against the reported `inputTokens` yields a
  correction factor for that model. New.

Unchanged: `runWithContextRepack`, `packContextUnits`, `shrinkInputBudget`,
`classifyContextError`, `outputRetryOptions`, all twelve consumers of
`estimatePreparedMessages` (the signature is preserved), and the `claude-agent` backend.

## 4. Components

### 4.1 `src/token-estimate.ts` (new) — how many tokens is this

```ts
export function estimateText(text: string): number;
export function estimateMessages(
  messages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
  calibration?: number,
): number;
```

Counts each message's `content` character by character (Cyrillic ÷2, Latin ÷3.5, CJK ×1),
adds a fixed allowance for role and separators, adds `MEDIA_TOKENS` per `image_url` part, and
multiplies by `calibration` (default 1.0). Pure, no I/O, no dependencies.

`prompt-budget.ts::estimatePreparedMessages` becomes a thin wrapper — the signature does not
change, so its twelve consumers are untouched. `markdown-chunks.ts::estimateTokens` moves to
`estimateText`.

### 4.2 `src/model-context.ts` (new) — what is known about this model

```ts
export interface ModelContextRecord {
  contextWindow: number;
  source: "discovered" | "learned" | "default";
  calibration: number;   // estimated → actual, moving average
  samples: number;
}

export interface ModelContextStore {
  get(baseUrl: string, model: string): ModelContextRecord | undefined;
  resolve(baseUrl: string, model: string, signal: AbortSignal): Promise<ModelContextRecord>;
  observeUsage(baseUrl: string, model: string, estimated: number, actual: number): void;
  observeContextError(baseUrl: string, model: string, maxContextTokens?: number): void;
}
```

`resolve` is lazy: cache → `GET /v1/models` → `POST /api/show` → backend constant. Persisted
in `local.json`. Depends only on an HTTP client and the store; it knows nothing about
prompts, phases or evidence.

### 4.3 `src/budget-resolver.ts` (new) — how much may be spent

```ts
export interface ResolvedBudget {
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  outputCeilingTokens: number;
  contextWindow: number;
  source: "override" | "discovered" | "learned" | "default";
  calibration: number;
}

export function resolveBudget(
  record: ModelContextRecord,
  overrides: { input?: number; output?: number },
): ResolvedBudget;
```

A pure function. All reserve and safety-factor arithmetic lives here and nowhere else.

`model-call-policy.ts::resolveModelCallPolicy` becomes asynchronous on this path: it reads
the record from `ModelContextStore`, passes it to `resolveBudget`, and puts the result into
`LlmCallOptions`. The `positiveInt(..., DEFAULT_INPUT_BUDGET)` fallbacks disappear from
settings resolution.

### 4.4 Changes to existing modules

| File | Change |
|---|---|
| `phases/init.ts` | pass `chunkBudget = min(mapperBudget, payloadBudget)`; remove the "configuration error / domain was not created" branch |
| `phases/ingest-evidence.ts` | `boundBootstrapPayload` → `splitBootstrapPayload(value, budget): BootstrapEvidence[]`; add the K-way merge |
| `phases/structured-output.ts` | take the ceiling from `outputCeilingTokens`; call `observeUsage` after each call |
| `settings.ts`, `i18n.ts` | budget fields move to Advanced, empty means automatic; strings in ru/en/es. `Compression profile` stays where it is: it selects semantics, not arithmetic, and the user is still the right owner of that choice |
| `types.ts` | settings budgets become `number \| undefined` |
| `main.ts` | migration: clear values exactly equal to the old defaults, set `migrated_auto_budget` |

The boundary below `LlmCallOptions` does not move. Phases keep receiving
`inputBudgetTokens: number` and do not know where it came from.

## 5. Data flow

### 5.1 Init, end to end

```
1. resolveModelCallPolicy(settings, "init")
     └─ ModelContextStore.resolve(baseUrl, model)
          cache? → GET /v1/models? → POST /api/show? → BACKEND_DEFAULT
          ⇒ { contextWindow: 131072, source: "discovered", calibration: 1.0 }
     └─ resolveBudget(record, overrides)
          ⇒ input 114688, output 8192, ceiling 131072 − estimatedInput
     └─ agent.jsonl: { kind: "budget_resolved", contextWindow, source, calibration }

2. init.ts
     fixedPromptEstimate = estimateMessages(system prompt + empty payload)  ≈ 2800
     payloadBudget       = 114688 − 2800                                    ≈ 111888
     chunkBudget         = min(mapperRequestBudget, payloadBudget)

3. prepareBootstrapEvidenceBundle(...)
     chunk the source by chunkBudget
     mapper calls → evidence packets → candidates

4. splitBootstrapPayload(payload, payloadBudget) → BootstrapEvidence[]
     fits whole → [payload]      ← normal case, today's path
     does not   → K groups       ← fallback path

5. K × init.bootstrap → K × DomainEntry → mergeBootstrapEntries(...)

6. bootstrapTaxonomyIssue(merged, FULL bootstrapEvidence)
     coverage is checked against all evidence, not against one group

7. after each call: observeUsage(estimated, actual) → calibration
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

Greedy, on candidate boundaries: fill a group until the estimate exceeds `payloadBudget`.
`domainThemes` and `languageEvidence` are duplicated into every group — they are small and
needed for the language inference. Candidate order is preserved, so group 0 always holds the
first candidate.

A single candidate that does not fit a group is impossible by construction after 2.5: its
`exactSource[].text` is bounded by its chunk, and the chunk is bounded by `payloadBudget`. If
the invariant is violated anyway it is a construction bug, not user input: raise with an
explicit message about the chunk-budget mismatch, not about configuring a budget.

## 6. Error handling

No budget-resolution failure is visible to the user. The only visible size-related failure is
a provider rejection after every recovery loop has run.

| Situation | Behaviour | User-visible |
|---|---|---|
| Probe times out, fails, or 404s | next step in the chain, ending at the backend constant | no, `agent.jsonl` only |
| Probe returns garbage | validated as an integer in 1k…2M, otherwise the constant | no |
| The model behind a name is swapped for a smaller one | provider returns `context_length_exceeded` → `shrinkInputBudget` → cached as `learned` | no, self-healing |
| `context_length_exceeded` | existing `runWithContextRepack`, up to two repacks | no, until exhausted |
| Repack exhausted | the provider error as-is — the only acceptable size failure | yes |
| `finish_reason=length` | `outputRetryOptions` with the real ceiling `contextWindow − estimatedInput` | no |
| Output ceiling reached and still truncated | existing structured repair, then an error | yes |
| Provider reports no `usage` | calibration is not updated, the step is skipped | no |
| Override exceeds the model context | clamped to the context, the clamp is logged | no |

### 6.1 The fixed prompt does not fit the model context

Today this is `init: configuration error — fixed bootstrap prompt requires N tokens but input
budget is M; domain was not created.` The cause was the invented budget. Once the budget is
derived from the model's context, this genuinely means the Init system prompt is larger than
the model's window — a 4k model, for example.

Following the existing pattern at `lint-chat.ts:272`, first rebuild the prompt without
`schema_block` and re-estimate. If that still does not fit, fail with an honest message naming
the model and its context window rather than a user setting, and without the words
"configuration error" — there is nothing for the user to configure.

### 6.2 Corrupted calibration

One anomalous `usage` value must not break budgeting. The correction is a moving average over
the last 8 samples, hard-clamped to `[0.5, 3.0]`. A sample outside the range is discarded and
logged: it indicates that the provider counts `usage` differently than assumed, which is
diagnostics, not a reason to change behaviour.

### 6.3 Diagnostics

Three new events in `agent.jsonl`; existing diagnostics are not reduced:

```
budget_resolved     { contextWindow, source, calibration, samples,
                      inputBudget, outputBudget, outputCeiling, override }
context_probe       { baseUrl, model, endpoint, ok, ms, contextLength? }
calibration_sample  { model, estimated, actual, ratio, applied, clamped }
```

`prompt_budget` gains `contextWindow`, `budgetSource` and `calibration`. Sidebar text does not
change: numbers go to the log, not the UI.

## 7. Testing

Tests pass `inputBudgetTokens` directly into `LlmCallOptions` (`ingest-bounded.test.ts` uses
20 000, 40 000, 12 500 and others) rather than reading it from settings, so the
`LlmCallOptions` boundary keeps them structurally valid. What changes is the meaning of the
number: a budget of 20 000 used to mean 20 000 bytes (≈5 700 tokens) and now means 20 000
tokens.

### 7.1 Existing tests

| Class | Action | Examples |
|---|---|---|
| Set a budget, assert **relationships** (required packed, optional omitted, coverage complete) | leave alone; the invariant is unit-independent | most of `prompt-budget.test.ts` |
| Set a budget, assert **absolute values** (chunk count, K calls, exact `estimatedInputTokens`) | rescale the budget constant by ÷3.5, or rewrite as a relationship | parts of `ingest-bounded.test.ts`, `format-budget.test.ts`, `query-budget.test.ts` |
| Assert the size-related hard failure "domain was not created" | inverted: success through split is now expected | `init-bootstrap-fail-loud.test.ts` |
| Settings and migrations | new cases | `settings-model-controls.test.ts`, `model-call-policy.test.ts` |

When rescaling, convert the assertion to a relationship rather than tuning the constant until
it passes; otherwise the next estimator change breaks it again.

### 7.2 New tests

**`token-estimate.test.ts`.** Table-driven over real repository files (`init.md`,
`_wiki_schema.md`, a Russian source) with recorded expectations. The key case is the intent's
health metric: the estimate is never more than 15% below the actual. Actual values come from
recorded `(estimated, actual)` pairs, not from a live network call.

**`model-context.test.ts`.** The cache → `/v1/models` → `/api/show` → constant chain against
mocks; garbage responses; timeouts; `observeContextError` shrinks and remembers; calibration
as a moving average, clamped to `[0.5, 3.0]`, with anomalies discarded.

**`budget-resolver.test.ts`.** Pure functions: the formulas, override handling, clamping an
override to the context window, and `outputCeiling > outputBudget` — a regression test for the
current defect where the ceiling equals the value it is meant to raise.

**Split and merge**, in `ingest-evidence.test.ts` and the `init-*` suites. The central case is
equivalence: on the same evidence, the merged result of K calls equals the result of a single
call. Plus a forced K ≥ 3 through an artificially small context, an `id` conflict between
groups, and taxonomy coverage checked against the full evidence.

**Migration.** Values exactly equal to the old defaults are cleared; 24 000 is preserved;
`migrated_auto_budget` is set once; a second run is a no-op.

**Chunk budget binding.** An invariant test: for any source, no `exactSource[].text` exceeds
`payloadBudget`. This is what makes split sufficient and truncation unnecessary.

### 7.3 Baselines for the health metrics

The intent's metrics require "no worse than before", so a baseline must be captured and
committed before any change: LLM calls per operation and create/update decisions on
`bounded-operations-acceptance` and `ingest-bounded`. Without a recorded baseline the metric
is unverifiable.

### 7.4 Live verification

The intent's "Done when" requires a real run: `init os-mac --force --sources ОС/Mac/` on the
user's vault, checking `status: ok` in the history and the estimate-to-actual gap in
`agent.jsonl`. Automated tests do not replace this.

## Acceptance (from intent)

### Desired Outcomes

- Init `os-mac --force --sources ОС/Mac/` on the same vault completes successfully and the
  domain is created; the `data.json` history entry reports `ok`, not `error`.
- In `agent.jsonl`, `estimatedInputTokens` differs from the provider's reported
  `inputTokens` by no more than ~15% (currently a factor of ~4).
- No Init or Ingest run ends with `configuration error — ... domain was not created` because
  of input size. A long `exactSource[].text` is truncated with an explicit marker or split
  across calls, and the domain is created.
- The main Settings section no longer shows `Input budget tokens` or `Repair input budget`.
  Both live under Advanced and are empty by default, meaning automatic. Previously saved
  values keep working as an explicit override.
- On a model with a 128k context window the effective input budget for Init is at least 4×
  the current 16384-byte-derived limit — that is, ≥16k real tokens — and `agent.jsonl`
  records which source produced that boundary: discovery, a learned value, or the fallback
  default. It is never the constant 16384.
- A truncated generation (`finish_reason=length`) triggers a retry with a larger output
  limit instead of a `structural_error / schema_validate` failure.

### Done when

`init os-mac --force --sources ОС/Mac/` on the real vault finishes with `status: ok`;
`agent.jsonl` shows the input estimate within 15% of the provider's reported value; the main
Settings section contains no budget fields; and a reproduced long `exactSource` scenario
creates the domain with the truncation recorded in the log.

### Note on the "Done when" wording

Desired Outcome 3 already allows either resolution — "truncated with an explicit marker **or
split across calls**" — so the design satisfies it directly through section 2.4.

One clause does diverge: "Done when" says the reproduced long-`exactSource` scenario creates
the domain "with the truncation recorded in the log". Sections 2.4 and 2.5 remove truncation
entirely — splitting carries no data loss, and the oversized-single-range case is eliminated
structurally rather than by cutting content. The observable requirement, that the domain is
created instead of the run failing on size, is met more strongly than the intent asked. The
corresponding verification records a `split` event where the intent expected a truncation
marker; result reconciliation should accept that substitution rather than treat it as a
missing outcome.
