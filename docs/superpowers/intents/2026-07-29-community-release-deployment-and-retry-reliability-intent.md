---
review:
  intent_hash: 7348bf783da14ff6
  last_run: 2026-07-29
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
# Intent: Community Release Deployment and Retry Reliability

**Date:** 2026-07-29
**Status:** approved

## Objective

Correct the GitHub release build and publication path so that a manually published AI Wiki release is consumable by the existing Obsidian Community Plugins listing. In the same delivery, implement and close TD-3 (the deterministic conflict-regeneration integration trigger) and TD-4 (correct Init terminal status after a successful file Retry).

This work is needed now because release `0.2.2` exists but the desktop installation path does not reliably expose the current version, while the two retry invariants remain unverified and open in the technical-debt register.

## Desired Outcomes

- Every release contains valid `main.js`, `manifest.json`, and `styles.css` assets, with the Git tag, `package.json`, and root/source/distribution manifests reporting the same version.
- After a release is manually published to GitHub, the existing `ai-wiki` Community Plugins listing can obtain and expose that version through Obsidian's supported release contract.
- TD-3 passes a deterministic integration scenario covering stale target authority, a malformed first regeneration response, a valid second response, and the configured request bound.
- TD-4 reports `status=done` after an induced file failure followed by a successful Retry, while Skip, Stop, cancellation, and exhausted retry never produce a false `done` status.
- Release gates and all focused regression checks pass.

## Health Metrics

- Existing model request, retry, and token ceilings do not increase.
- Schema/domain validation and stale-conflict handling remain fail-closed.
- Skip, Stop, cancellation, and exhausted retry retain their correct terminal statuses.
- Mobile compatibility remains enabled through `isDesktopOnly: false` and desktop-only paths remain runtime-guarded.
- Release assets retain the filenames and flat format required by Obsidian Community Plugins.
- Existing lint, typecheck, build, and test baselines gain no new failures.

## Strategic Context

- Interacts with:
  - package versioning, root/source/distribution manifests, and the esbuild output contract;
  - the GitHub Actions release workflow and GitHub Release assets;
  - the existing Community Plugins listing and Obsidian desktop updater;
  - the synthesis conflict/regeneration pipeline used by TD-3;
  - the Init file-retry lifecycle, telemetry, and terminal-status aggregation used by TD-4;
  - repository release documentation and the project iwiki domain.
- Priority trade-off: trust over speed and cost. Reproducible releases and correct terminal state take priority over release throughput or shorter CI execution.

## Constraints

### Steering (behavioral guidance)

- Make the smallest sufficient changes to the existing release workflow.
- Use standard GitHub Release assets and the documented Obsidian release contract.
- Keep integration scenarios deterministic and independent of random provider responses.
- Preserve telemetry for both recovered and unrecovered file attempts.

### Hard (architectural enforcement)

- Do not automate Community account actions, submission, review, or approval.
- Do not increase model request, retry, or token ceilings.
- Do not weaken schema, semantic, authority, or apply validation.
- Do not report `status=done` after Skip, Stop, cancellation, or exhausted retry.
- Keep the release tag, `package.json`, root manifest, source manifest, and distribution manifest on one version.
- Block release publication when build, lint, typecheck, or required tests fail.

## Autonomy Zones

- Full autonomy (reversible, low risk): implementation code, focused tests, release workflow, manifests, repository documentation, and local verification.
- Guarded (log + confidence threshold): iwiki updates, version metadata, and generated release assets after their consistency checks pass.
- Proposal-first (needs approval): commit, push, pull request creation, and GitHub Release creation or publication.
- No autonomy (human only): Community account actions, submission/review decisions, and actual Community listing publication.

> These zones OVERRIDE subagent-driven-development's "continuous execution,
> don't pause" default. Any task touching proposal-first / no-go decisions
> is marked HUMAN CHECKPOINT in the plan.

## Stop Rules

- Halt if: the supported Community Plugins release contract conflicts with the current repository layout, retry terminal states cannot be reconciled without ambiguity, or version sources cannot be made consistent.
- Escalate if: the work would require weaker validation, larger request/retry/token limits, or a change to this accepted intent.
- Done when: a release candidate passes every required gate with consistent flat release assets; TD-3 and TD-4 pass their deterministic scenarios; repository documentation and iwiki describe the resulting contracts; and push, pull request, GitHub Release publication, and Community account actions remain separate explicitly approved steps.
