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
