# Intent: Fix incorrect docs — base.md applied to evaluator

**Date:** 2026-05-25
**Status:** draft

## Objective

Old comment states "base.md is not applied to evaluator". This is false.
`evaluator.ts` calls `buildChatParams` with `messages = [{ role: "user", content }]` (no system message),
so `prependBaseContract` creates `{ role: "system", content: baseContract }` — base.md IS present.
`evaluator.md` goes to user role, which is unique, but base.md still appears in the request.
Fix: update lat.md and `docs/prompt-architecture.md` to reflect reality.

## Desired Outcomes

- `lat check` passes with no errors
- lat.md accurately describes evaluator's use of base.md (system role) + evaluator.md (user role)
- `docs/prompt-architecture.md` no longer contains the false claim about base.md not applying to evaluator

## Health Metrics

- Code behavior unchanged — documentation only
- `lat check` passes before and after changes

## Strategic Context

- Interacts with: developers and AI agents reading lat.md / prompt-architecture.md
- Priority trade-off: trust (accuracy of docs) over speed

## Constraints

### Steering (behavioral guidance)

- lat.md section leading paragraph must be ≤250 characters
- All wiki links must resolve (validated by `lat check`)

### Hard (architectural enforcement)

- No code changes — documentation edits only

## Autonomy Zones

- Full autonomy (reversible, low risk): edit lat.md sections, edit prompt-architecture.md
- No autonomy (human only): none applicable

## Stop Rules

- Halt if: `lat check` fails after edits
- Done when: both lat.md and `docs/prompt-architecture.md` updated, `lat check` green
