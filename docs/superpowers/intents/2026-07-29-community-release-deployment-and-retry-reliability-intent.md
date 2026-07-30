---
review:
  intent_hash: b47114b447cfc076
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

Correct the GitHub release build and publication path so that a manually published AI Wiki release is consumable by the existing Obsidian Community Plugins listing. In the same delivery, implement and close TD-3 (the deterministic conflict-regeneration integration trigger), TD-4 (correct Init terminal status after a successful file Retry), and the Init evidence-pipeline reliability and cost defects exposed by live session `1785356426320`.

This work is needed now because release `0.2.2` exists but the desktop installation path does not reliably expose the current version, while the two retry invariants remain unverified and open in the technical-debt register. The live session also showed that one ordinary Markdown source can expand into 89 model requests, 209,344 provider-reported tokens, and 877 seconds of model time before failing on a valid no-evidence case. The fix must improve the general algorithm rather than recognize that source or its vocabulary.

## Desired Outcomes

- Every release contains valid `main.js`, `manifest.json`, and `styles.css` assets, with the Git tag, `package.json`, and root/source/distribution manifests reporting the same version.
- After a release is manually published to GitHub, the existing `ai-wiki` Community Plugins listing can obtain and expose that version through Obsidian's supported release contract.
- TD-3 passes a deterministic integration scenario covering stale target authority, a malformed first regeneration response, a valid second response, and the configured request bound.
- TD-4 reports `status=done` after an induced file failure followed by a successful Retry, while Skip, Stop, cancellation, and exhausted retry never produce a false `done` status.
- Evidence chunking packs adjacent Markdown ranges up to the governed request budget instead of making request count proportional to heading count. Complete source coverage, code fences, heading context, and original line authority remain deterministic for small, medium, heading-heavy, and oversized sources.
- Init does not perform equivalent full-source evidence mapping twice solely because the first source also bootstraps the domain. Any evidence reuse preserves facts, exact source ranges, links, entity routing inputs, and downstream validation.
- Request-local wire normalization accepts semantically complete no-evidence output with an omitted complementary empty collection without a model retry. Missing evidence coverage, invalid ranges, unknown ownership, and malformed non-empty data still fail closed.
- Deterministic corpus-level regressions bound evidence-map calls, structured repairs, and token estimates across source sizes and Markdown shapes without depending on a particular article, language, domain, or provider response.
- Release gates and all focused regression checks pass.

## Health Metrics

- Existing model request, retry, and token ceilings do not increase.
- For each source class, base evidence-map request count scales with budget-packed content size, not raw heading count. Small fitting sources use one base map request per required evidence pass; larger sources use only the number of packed requests required by the governed budget.
- Heading-only and valid no-evidence ranges require zero structured repair requests in deterministic fixtures.
- Exhausted structured repair splits a source range only when a smaller content range can change the validation outcome. A locally normalizable wire omission or an indivisible heading-only range does not trigger recursive source splitting.
- Init performs at most one full evidence extraction for the first source before synthesis; bootstrap may derive taxonomy from that result but must not repeat equivalent mapping.
- Provider-independent acceptance uses deterministic request counts, complete coverage, and serialized-byte/token-estimate totals. Live latency and provider token usage are reported as comparative evidence, not flaky pass/fail timers.
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
  - Markdown chunk construction and packing, conservative prompt-budget governance, bootstrap evidence preparation, first-source ingest, and structured-output wire adapters;
  - repository release documentation and the project iwiki domain.
- Priority trade-off: validation and complete evidence coverage remain non-negotiable. Among algorithms satisfying those invariants, bounded requests, token cost, and latency are acceptance criteria rather than optional optimizations.

## Constraints

### Steering (behavioral guidance)

- Make the smallest sufficient changes to the existing release workflow.
- Use standard GitHub Release assets and the documented Obsidian release contract.
- Keep integration scenarios deterministic and independent of random provider responses.
- Preserve telemetry for both recovered and unrecovered file attempts.
- Evaluate the evidence algorithm with synthetic or corpus fixtures spanning small, medium, heading-heavy, and oversized Markdown. Do not tune against one live article.
- Prefer deterministic local normalization and packing over additional model retries.

### Hard (architectural enforcement)

- Do not automate Community account actions, submission, review, or approval.
- Do not increase model request, retry, or token ceilings.
- Do not weaken schema, semantic, authority, or apply validation.
- Do not add article-, language-, domain-, heading-, command-, or vocabulary-specific production rules.
- Do not omit, truncate, or silently merge distinct source evidence to satisfy request-count targets.
- Do not replace provider-independent safety bounds with a tokenizer that is valid only for one model family.
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

- Halt if: the supported Community Plugins release contract conflicts with the current repository layout, retry terminal states cannot be reconciled without ambiguity, version sources cannot be made consistent, or request reduction would require incomplete source coverage or weaker validation.
- Escalate if: the work would require weaker validation, larger request/retry/token limits, or a change to this accepted intent.
- Done when: a release candidate passes every required gate with consistent flat release assets; TD-3 and TD-4 pass their deterministic scenarios; generic small/medium/heading-heavy/oversized evidence fixtures prove bounded request scaling, single extraction of the first Init source, valid no-evidence normalization, repair/split progress, and complete source coverage; repository documentation and iwiki describe the resulting contracts; and push, pull request, GitHub Release publication, and Community account actions remain separate explicitly approved steps.
