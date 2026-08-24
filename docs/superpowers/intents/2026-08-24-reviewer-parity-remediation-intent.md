---
review:
  intent_hash: 756956eab75cca13
  last_run: 2026-08-24
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

# Intent: reviewer-parity-remediation

**Date:** 2026-08-24
**Status:** approved

## Objective

Remove stale Claude evaluation/process/configuration surfaces and restore parity with the current official Obsidian ESLint rules so the Community review can be resubmitted without these reviewer risks.

## Desired Outcomes

- The current official lint command completes without errors.
- Tracked repository artifacts contain no Claude Code evaluation, process, or configuration surfaces.
- The OpenAI plugin builds and works as the sole supported backend, while existing vault settings still start safely.
- A repeat Community scan can be submitted with these reviewer risks removed.

## Health Metrics

- OpenAI remains the only runtime backend and existing vault settings do not prevent startup.
- Desktop and mobile support remain available.
- Build, tests, and release package validation continue to pass.

## Strategic Context

- Interacts with: `eval/`, ESLint configuration, TypeScript sources and tests, GitHub Community review, and users of the OpenAI plugin.
- Priority trade-off: trust over speed over cost.

## Constraints

### Steering (behavioral guidance)

- Make only minimal, targeted changes.
- Treat current official Obsidian lint rules as the source of truth.

### Hard (architectural enforcement)

- Claude Code must be absent from settings, UI, runtime, and tracked evaluation artifacts.
- OpenAI must remain functional; LM Studio is out of scope.
- Do not declare a release ready without clean current lint and required verification.

## Autonomy Zones

- Full autonomy (reversible, low risk): remove stale evaluation artifacts and make mechanical lint corrections with tests.
- Guarded (log + confidence threshold): update ESLint configuration and test expectations with recorded rationale and checks.
- Proposal-first (needs approval): change public behavior, manifest/release metadata, or add a backend.
- No autonomy (human only): publish to Community plugins or change the OpenAI contract without explicit user authorization.

## Stop Rules

- Halt if: the official lint requires a refactor that conflicts with mobile support or the OpenAI-only contract.
- Escalate if: eliminating a reviewer risk requires a public behavior or backend decision.
- Done when: current official lint has no errors, Claude surfaces are absent, build and tests pass, and the reviewer-risk scan is clean.
