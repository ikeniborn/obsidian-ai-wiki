---
review:
  intent_hash: 1ab1e36636f64522
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

Remove stale Claude evaluation/process/configuration surfaces, restore parity with the current official Obsidian ESLint rules, and deliver the verified remediation as GitHub release `0.3.6` after its pull request is merged. Preserve published release `0.3.5` and its historical compatibility metadata unchanged so the Community review can be repeated against a new, auditable release without rewriting release history.

## Desired Outcomes

- The current official lint command completes with zero errors and zero warnings.
- Active tracked repository and release artifacts contain no Claude Code evaluation, process, configuration, runtime, or UI surfaces.
- The OpenAI plugin builds and works as the sole supported backend, while existing vault settings still start safely.
- Published release `0.3.5`, including its historical `minAppVersion` and `versions.json` mapping, remains unchanged.
- After full verification passes and the remediation pull request is merged, release `0.3.6` is published automatically with synchronized version metadata, `minAppVersion: 1.13.0`, and the validated flat plugin assets.
- Release `0.3.6` is available for a repeat Community scan with these reviewer risks removed; submitting or changing the Community plugin-directory entry is not part of this work.

## Health Metrics

- OpenAI remains the only runtime backend and existing vault settings do not prevent startup.
- Desktop and mobile support remain available on the declared Obsidian `1.13.0` minimum for `0.3.6`.
- Lint, typecheck, focused tests, the full test suite, production build, prebuild release validation, postbuild release validation, active-surface scan, mobile evaluation, and diff checks all pass before merge and release.
- No release is published from an unmerged pull request or from a revision with a warning, test failure, validation failure, or inconsistent version metadata.
- Existing `0.3.5` tag, release assets, manifest metadata, and historical version mapping do not change.

## Strategic Context

- Interacts with: `eval/`, ESLint configuration, TypeScript sources and tests, manifest/version metadata, the pull-request and GitHub Release workflows, GitHub Community review, and users of the OpenAI plugin.
- Priority trade-off: trust over speed over cost.

## Constraints

### Steering (behavioral guidance)

- Make only minimal, targeted changes.
- Treat current official Obsidian lint rules as the source of truth.
- Treat `0.3.6` as a new release record; never retrofit the compatibility decision onto already published `0.3.5`.
- Use the existing validated release workflow after merge rather than adding another publication path.

### Hard (architectural enforcement)

- Claude Code must be absent from settings, UI, runtime, active release artifacts, and tracked executable evaluation artifacts.
- OpenAI must remain functional as the sole backend; LM Studio and any other backend are out of scope.
- Published `0.3.5` and its historical `minAppVersion`/version mapping are immutable; the Obsidian `1.13.0` compatibility floor must be recorded under new version `0.3.6`.
- Release `0.3.6` must not be published until every required zero-warning and full-verification gate passes and the remediation pull request is merged.
- Release `0.3.6` must contain synchronized version metadata and the validated flat `main.js`, `manifest.json`, and `styles.css` asset set.
- Community plugin-directory submission, account actions, review actions, and directory metadata changes are not authorized.

## Autonomy Zones

- Full autonomy (reversible, low risk): remove stale evaluation artifacts and make mechanical lint corrections with tests.
- Guarded (log + confidence threshold): update ESLint configuration, tests, `0.3.6` manifest/version metadata, and release artifacts with recorded rationale and passing checks; after the pull request is merged, run the already authorized automated `0.3.6` GitHub publication only if every hard release gate is satisfied.
- Proposal-first (needs approval): change public behavior, change the approved `0.3.6` compatibility target or release workflow, weaken a verification gate, or expand remediation scope.
- No autonomy (human only): modify published `0.3.5` history, submit or change the Community plugin-directory entry, change the OpenAI contract, or add LM Studio or another backend.

## Stop Rules

- Halt if: the official lint requires a refactor that conflicts with mobile support or the OpenAI-only contract.
- Halt if: any required verification reports an error or warning, the pull request is not merged, `0.3.5` history would change, or `0.3.6` version/compatibility metadata or release assets are inconsistent.
- Escalate if: eliminating a reviewer risk requires a public behavior, backend, compatibility-target, or release-workflow decision outside the approved boundaries.
- Done when: current official lint reports zero errors and zero warnings; Claude active surfaces are absent; all full-verification commands pass; the remediation pull request is merged; GitHub release `0.3.6` is published with `minAppVersion: 1.13.0` and the validated flat assets; and published `0.3.5` plus its historical compatibility mapping remain unchanged. Community plugin-directory submission is explicitly not required for completion.
