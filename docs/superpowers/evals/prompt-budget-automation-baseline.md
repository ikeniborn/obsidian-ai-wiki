# Baseline: prompt-budget-automation

Captured on 2026-08-11 at commit dfb088bb, before any change,
so the intent's health metrics are verifiable afterwards.

## Full suite

- tests: 1419
- pass: 1419
- fail: 0

## LLM calls per entry point (bounded-operations-acceptance)

Counts were collected by appending `entryPoint\teffectiveInputBudget` lines to a file
from the instrumented test, because node's `--test` TAP reporter prefixes captured
stderr with `# ` and escapes real tab characters to the literal `\t` sequence, so the
plan's original `grep '^BASELINE_CALL' | cut -f2 | ...` stderr pipeline matched nothing.

| entryPoint | inputBudget | calls |
|---|---|---|
| runLint | 24000 | 14 |
| prepareSourceEvidence | 12000 | 8 |
| synthesizeEntityBatch | 20000 | 7 |
| analyzePdf | 10000 | 7 |
| runFormat | 10000 | 6 |
| runIngest | 20000 | 2 |
| synthesizeEntityBatch:evidence | 35000 | 1 |
| runLintFixChat | 12000 | 1 |
| runLintChat | 2500 | 1 |
| answerFromContext | 3000 | 1 |

## Bounded ingest suite

- tests: 49, pass: 49, fail: 0

## Meaning

The intent allows extra calls caused by splitting an unreachable payload, recorded in
`agent.jsonl` as `evidence_split`. Any other increase against these numbers is a regression.

---

# After: live verification

Captured on 2026-08-12 at commit `cffeca92`, against the same vault, the same command
(`init os-mac --force --sources ОС/Mac/`) and the same backend
(`ollama-deepseek-v4-pro-cloud` at `https://homelab.ikeniborn.ru/v1`).

## Full suite

- tests: 1567
- pass: 1567
- fail: 0

## The failure this branch exists to remove

Before, from `agent.jsonl.pre-budget-automation` of the run that motivated the work:

```
init: configuration error — fixed bootstrap evidence prompt exceeds input budget:
Bootstrap evidence payload requires 7583 tokens but budget is 5276; domain was not created.
```

After, on the same input: `init done` in 198 s, no `error` event, `wipe_complete` and
`domain_created` present. The string `domain was not created` no longer exists anywhere
in `src/`.

## Check 1 — the run succeeded

`data.json` history: `init done` (198 s), followed by `query done` (14 s).

## Check 2 — the estimate tracks the provider

Read off the same `prompt_budget` record, never two streams matched by position:

| callSite | estimated | actual | estimated/actual |
|---|---|---|---|
| init.bootstrap | 10372 | 9788 | 1.060 |
| init.bootstrap-type-map | 1808 | 1531 | **1.181** |
| ingest.synthesize | 3882 | 3981 | 0.975 |
| ingest.synthesize | 3574 | 3611 | 0.990 |
| ingest.synthesize | 5142 | 5626 | 0.914 |
| ingest.synthesize | 5233 | 5348 | 0.978 |
| ingest.synthesize | 3666 | 3724 | 0.984 |
| ingest.synthesize | 3571 | 3630 | 0.984 |
| query.answer | 3585 | 2948 | **1.216** |

**7 of 9 inside the ±15% band.** Both misses are overestimates on the two smallest
prompts, where the flat per-message overhead weighs most; the large prompts — the ones
where the budget actually binds — land between 0.914 and 1.060. The intent's halt
condition is an *under*estimate below 0.85, which never occurred: every deviation is
conservative and can only waste budget, never overflow a request. Accepted as-is rather
than refitting the seed constants against the ~30 live samples now available.

## Check 3 — the budget source and size

```
budget_resolved  contextWindow 131072  inputSource "configured"  outputSource "default"
                 inputBudget 110592    outputBudget 8192
```

The provider advertises no context length for any model — `/v1/models` returns 200 and
lists the model with no length field, while `/api/show`, `/v1/model/info`, `/model/info`
and `/v1/models/<id>` all return 404 — so the window comes from the setting this
verification added, not from a probe. Before the branch the same operation ran on a
16384-**byte** budget; on the phantom 8192-token default it ran on 3686 tokens.

## Check 4 — split and overflow recovery

**Split, confirmed live.** In the first live run, at a payload budget of 3988 tokens:
`evidence_split { groups: 3, candidates: 36, subdivided: 0 }`, and the operation
completed instead of failing. In the final run the payload fitted whole
(`groups: 1, candidates: 13, payloadBudget: 107521`), which is the expected shape at a
real 131072-token window.

**Overflow recovery, not reproducible on this corpus — recorded, not claimed.** A poisoned
window only raises the cap; it cannot inflate a prompt. The `ОС/Mac/` source yields about
10k tokens, so no prompt can exceed the real 131072-token window without fabricating a
source an order of magnitude larger. The path is instead covered by
`tests/runtime-budget-wiring.test.ts`, which drives a real provider context rejection
through the real `ModelContextStore` and the real `runWithContextRepack` (131072 → 8192,
record becomes `source: "learned"`) — verified in review as genuine end-to-end behaviour
rather than an assertion against a mock.

## Calibration

The loop is live and no longer compounds. Every `calibration_sample` carries the factor
that produced its estimate (`appliedCalibration`), the ratios sit inside [0.85, 1.15],
and the factor settled at **1.0143** after 8 samples. An earlier build, whose update
multiplied by the *current* factor while estimates were produced with a *stale* one,
drove the same data to **1.2528** — a +25% inflation from a raw bias of about +4%.

## Meaning

The intent's health metrics are met with one recorded exception: the ±15% band holds on
7 of 9 calls, and the two misses are conservative overestimates on prompts far below the
budget. Extra provider calls caused by splitting an otherwise unreachable payload are
allowed by the intent and are recorded as `evidence_split`.

## Check 4b — the settings UI, confirmed by the owner

Confirmed on 2026-08-12 against the deployed build, closing the last open step of
Task 14 (Step 8) under the amended criterion:

- `Input budget tokens`, `Max completion tokens` and `Repair input budget` are all
  present and all empty.
- Each shows its resolved automatic value as a placeholder: 110592, 8192 and 110592
  respectively, derived from the configured 131072-token window.
- The vision model carries its own context-window field, empty, showing "Automatic".

The Advanced grouping the plan originally required was superseded on the same day:
Obsidian's `Setting.setHeading()` has no closing or scoping mechanism, so the heading
also captured the neighbouring compression-profile control, and the field order is
pinned by tests. The intent, the spec and the plan record the amendment and its reason.
