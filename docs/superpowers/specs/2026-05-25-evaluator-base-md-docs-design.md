---
review:
  spec_hash: 84194aca6b6e353a
  last_run: 2026-05-25
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "Changes/1"
      section_hash: 55fb59fec7b02e33
      text: "Hardcoded line numbers replaced with section heading references"
      verdict: fixed
      verdict_at: 2026-05-25
---

# Design: Fix evaluator + base.md documentation

**Date:** 2026-05-25
**Status:** approved
**Intent:** [2026-05-25-evaluator-base-md-intent.md](../intents/2026-05-25-evaluator-base-md-intent.md)

## Problem

`docs/prompt-architecture.md` section `### evaluator + base.md — не изолирован` (lines 318–320)
is written as a historical correction note ("Старый комментарий... — неверен") rather than
clean architecture documentation. The correct information already exists in the tables and
diagrams above it.

`lat.md/llm-pipeline.md` has no section documenting the evaluator's unique prompt pattern:
it is the only phase that passes no system message to `buildChatParams`, causing
`prependBaseContract` to create `system = base.md` from scratch, while `evaluator.md`
renders into user role.

## Changes

### 1. `docs/prompt-architecture.md`

Remove section `### evaluator + base.md — не изолирован` from `## Замечания для архитектурного анализа` entirely.
All correct information is already present in:
- Note under `## Промты по фазам` diagram
- evaluator row in `## Контекст, инжектируемый в каждый промт` table
- base.md and evaluator.md rows in `## Сравнительная таблица промтов`

### 2. `lat.md/llm-pipeline.md`

Add new section `## Evaluator Prompt Pattern` after `## buildChatParams`:

```markdown
## Evaluator Prompt Pattern

Only phase that sends no system message to `buildChatParams`. `prependBaseContract`
creates `system = base.md` from scratch. The evaluator prompt (`evaluator.md`) renders
into user role — unlike all other phases where the phase prompt is the system message.

See [[src/phases/evaluator.ts#runEvaluator]].
```

## Verification

- `lat check` passes after both changes
- No code changes
