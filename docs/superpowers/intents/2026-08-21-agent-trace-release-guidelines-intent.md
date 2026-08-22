---
review:
  intent_hash: 6a642b9c73d7124e
  last_run: 2026-08-22
  phases:
    structure: { status: passed }
    completeness: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
    alignment: { status: passed }
  findings: []
workflow:
  route: chain
  continuation: full
---
# Intent: Agent Trace Release Guidelines

**Date:** 2026-08-21
**Status:** approved

## Objective

Remove the non-native Claude Code backend because its presence can affect plugin publication. Keep OpenAI-compatible operation as the only supported backend now. This change is needed before the next plugin publication attempt.

## Desired Outcomes

- Settings and user interface contain no Claude Code option or reference.
- A user with current OpenAI settings can complete an OpenAI request after the change.
- A vault with existing settings, including a former Claude Code selection, opens without a startup failure.

## Health Metrics

- The existing test suite passes.
- The plugin build succeeds.
- OpenAI requests work with existing vault settings.

## Strategic Context

- Interacts with: runtime backend routing, settings and UI, saved vault settings, repository documentation, release validation, and Obsidian plugin publication.
- Priority trade-off: trust.

## Constraints

### Steering (behavioral guidance)

- Do not implement LM Studio in this change. A future integration may use the OpenAI-compatible API.
- Preserve the already prepared release-validation changes on the current branch.

### Hard (architectural enforcement)

- Remove the Claude Code backend, its UI, settings, documentation, dependencies, and test paths.
- Do not add a replacement backend or a new backend abstraction.
- Do not retain a functional Claude Code runtime path.

## Autonomy Zones

- Full autonomy (reversible, low risk): remove Claude Code code, UI, tests, and documentation; add migration checks.
- Guarded (log + confidence threshold): handle former `claude-agent` settings so startup does not fail and document the resulting behavior.
- Proposal-first (needs approval): change OpenAI user experience, add LM Studio, or add another backend.
- No autonomy (human only): publish the plugin, submit or change Community directory information, or delete user secrets or settings.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: a vault with legacy Claude Code configuration cannot open safely after removal.
- Escalate if: legacy-setting handling requires deleting or changing user data.
- Done when: Claude Code is absent from the product; a vault with legacy configuration starts; OpenAI works; and tests and build pass.
