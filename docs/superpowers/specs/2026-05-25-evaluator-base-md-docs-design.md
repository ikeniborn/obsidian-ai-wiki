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

Remove section `### evaluator + base.md — не изолирован` (lines 318–320) entirely.
All correct information is already present in:
- Line 164 (note under "Промты по фазам" diagram)
- Line 298 (table row for evaluator operation)
- Line 304 (base.md row in comparison table)
- Line 312 (evaluator.md row in comparison table)

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
