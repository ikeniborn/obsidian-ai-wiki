---
review:
  spec_hash: c461dfef6bb5f93c
  last_run: 2026-08-24
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-08-24-reviewer-parity-remediation-intent.md
---

# Reviewer Parity Remediation Design

## Summary

The repository will use the current official Obsidian ESLint configuration as a zero-warning source gate and a separate allowlist-aware scan for active executable and release artifacts. The change removes two stale Claude-bearing evaluation bundles, adopts the Obsidian 1.13 Settings Definitions API, and keeps the OpenAI-only runtime, legacy vault startup, and desktop and mobile support.

Delivery creates a new release record rather than rewriting history. Published and tagged `0.3.5` remains immutable, and its historical `versions.json` mapping remains `1.7.2`. Package, source-manifest, root-manifest, and built distribution versions advance together to `0.3.6`; the `0.3.6` manifests and `versions.json["0.3.6"]` declare Obsidian `1.13.0`. After every required zero-warning verification passes and the remediation pull request is merged, the existing release workflow publishes `0.3.6` automatically with the validated flat assets.

## Acceptance (from intent)

- The current official lint command completes with zero errors and zero warnings.
- Active tracked repository and release artifacts contain no Claude Code evaluation, process, configuration, runtime, or UI surfaces.
- The OpenAI plugin builds and works as the sole supported backend, while existing vault settings still start safely.
- Published and tagged `0.3.5` remains unchanged, including its historical `versions.json` value of `1.7.2`.
- Package, lockfile, source, root, and distribution metadata agree on version `0.3.6`; every `0.3.6` manifest and `versions.json["0.3.6"]` declare `1.13.0`.
- Lint, typecheck, focused tests, the full test suite, production build, prebuild release validation, postbuild release validation, active-surface scan, mobile evaluation, and diff checks pass before merge and release.
- The merged `0.3.6` revision is published by the existing release workflow with flat `main.js`, `manifest.json`, and `styles.css` assets.
- Release `0.3.6` is ready for a repeat Community scan. Community plugin-directory submission and metadata changes are not required or authorized.

## Scope

The change covers the ESLint dependency and configuration, source findings produced by the current official recommended configuration, the settings UI migration, active-surface release validation, stale tracked evaluation bundles, focused regression tests, build output, current repository documentation, and the bound iwiki domain. Delivery scope also includes the synchronized `0.3.6` version bump, the new `1.13.0` compatibility record, merge-only use of the existing release workflow, and automatic publication of GitHub release `0.3.6` after all gates pass.

Historical artifacts under `docs/superpowers/`, intentional negative test fixtures, and repository-agent instructions remain audit or test evidence. Full-repository ESLint parser coverage, Claude or LM Studio runtime support, any backend other than OpenAI, modification of published or tagged `0.3.5`, and Community plugin-directory submission, account actions, review actions, or directory metadata changes are outside scope.

## Architecture

Two independent reviewer gates plus one release-history boundary cover the approved risks.

The source lint gate runs `eslint-plugin-obsidianmd@0.4.1` over `src/**/*.ts` through its complete `configs.recommended` configuration and the existing typed TypeScript project. The project does not disable or downgrade recommended rules. The npm command uses `--max-warnings 0`, so both errors and warnings block the gate.

The settings UI implements the declarative Settings Definitions API introduced in Obsidian 1.13. Legacy `display()` refresh calls and deprecated control methods are removed. The new `0.3.6` root, source, and distribution manifests declare `minAppVersion: 1.13.0`; the plugin remains available on desktop and mobile installations that meet that minimum.

The active-surface gate extends the existing release validator instead of forcing generated CommonJS, tests, and scripts through one TypeScript parser project. It scans executable and shipped surfaces for removed Claude backend, CLI probe, process, configuration, and UI markers. Its scope and exceptions are explicit, deterministic, and covered by fixtures.

Version history and release delivery form a third fail-closed boundary. Validation requires immutable `0.3.5` history, synchronized `0.3.6` metadata, the new `0.3.6` compatibility mapping, and exactly the flat release asset set. The existing release workflow remains the only publication path: a merge to `master` supplies the release revision, the workflow reruns its verification gates, and only the verified merged revision may create tag and GitHub release `0.3.6`.

## Components

### Official lint baseline

`package.json` and `package-lock.json` pin `eslint-plugin-obsidianmd` to the current `0.4.1` line used by this design. `eslint.config.mjs` remains a thin typed wrapper around the full official recommended configuration. Existing custom rule suppressions and severity downgrades are removed.

The resulting lint report is the source of truth for source corrections. Each correction is limited to the reported rule and preserves the current public behavior. No new suppression replaces a source correction.

### Active-surface validation

`scripts/validate-release.mjs` owns the reviewer marker scan because release validation already guards the distributable bundle. The scanner covers active plugin source, tracked executable evaluation artifacts, active release-relevant scripts, and `dist/main.js`.

The scanner excludes historical chain documents, repository-agent instruction files, and intentional negative fixtures used to prove rejection. A rejection identifies the matched category and repository-relative path and exits non-zero without editing files.

### Evaluation artifact cleanup

`eval/claude-probe/run.cjs` is deleted. It is an orphaned generated executable whose TypeScript source and stub were removed with the Claude CLI adapter.

`eval/mobile-fixes/run.ts` remains the authoritative Claude-free source. Its tracked `run.cjs` is rebuilt with a reproducible command that supports the source's Markdown imports. The rebuilt bundle must execute its existing evaluation and pass the active-surface scan.

### Settings Definitions migration

`src/settings.ts` exposes declarative setting definitions and uses the supported update mechanism for dependent controls. Existing labels, values, validation, persistence, and conditional visibility remain observable through the new API. Deprecated destructive-button and slider methods are replaced by their supported equivalents.

`src/main.ts` opens and refreshes the settings tab through the supported 1.13 API. Existing settings tests are adapted to assert equivalent controls and updates instead of legacy `display()` calls.

### Runtime compatibility

Runtime backend selection is not redesigned. OpenAI remains the sole backend. The existing legacy settings whitelist continues to ignore former Claude fields without writing during plugin load. The manifest remains mobile-capable with `isDesktopOnly: false`; compatibility begins at Obsidian `1.13.0` by explicit user decision.

No Claude backend or LM Studio backend is introduced. The official `obsidianmd/no-nodejs-modules` rule evaluates the guarded OKF desktop adapter. Node imports remain behind the existing `Platform.isDesktop && Platform.isDesktopApp` runtime guard; no unguarded Node import is introduced.

### Version history and release delivery

Published `0.3.5` tag, GitHub release, release assets, and manifest metadata are read-only historical records. `versions.json["0.3.5"]` remains `1.7.2`; the Obsidian `1.13.0` floor is not retrofitted onto that release.

`package.json`, the package-lock root records, `src/manifest.json`, `manifest.json`, and the built `dist/manifest.json` use version `0.3.6`. The three `0.3.6` manifests declare `minAppVersion: 1.13.0`, remain `isDesktopOnly: false`, and `versions.json` appends `"0.3.6": "1.13.0"` without changing older mappings.

`.github/workflows/release.yml` remains the publication mechanism. Its automatic `master` push path is reached by merging the remediation pull request containing the `src/manifest.json` bump. Any retained retry dispatch must operate on the same merged `master` revision; it must not publish an unmerged branch. The workflow validates metadata and active surfaces, runs zero-warning lint, typecheck, tests, production build, and postbuild asset checks before provenance attestation and GitHub release creation. It publishes tag and release `0.3.6` with only `dist/main.js`, `dist/manifest.json`, and `dist/styles.css`.

## Data and Validation Flow

1. Dependency installation resolves the pinned lint plugin. Source lint produces the complete official finding set; source corrections continue until the command reports zero errors and zero warnings.
2. Release validation scans active repository surfaces. The orphan Claude probe is absent, the regenerated mobile evaluation bundle contains no removed markers, and the production bundle remains OpenAI-only.
3. Version preparation updates package, lockfile, source, and root records to `0.3.6`, preserves `versions.json["0.3.5"] = "1.7.2"`, and appends `versions.json["0.3.6"] = "1.13.0"`. The build generates a matching distribution manifest and flat assets.
4. Typecheck, focused tests, the full test suite, mobile evaluation, production build, prebuild and postbuild release validation, final active-surface scan, and diff checks run against the release candidate. Any error or warning stops delivery.
5. The verified pull request merges. The resulting `master` push triggers the existing release workflow, which repeats its enforced gates against the merged commit.
6. Only after those gates pass does the workflow attest the three flat assets and create tag and GitHub release `0.3.6`. Published `0.3.5` remains untouched. Release `0.3.6` becomes input for a later Community scan, not an authorization to submit or edit directory metadata.

A failing local, CI, or release-workflow command leaves `0.3.6` unpublished. No workflow path may turn unmerged code, inconsistent metadata, a warning-bearing lint result, or incomplete assets into a release.

## Requirements

### R1 — Current official lint contract

The source lint gate must use `eslint-plugin-obsidianmd@0.4.1`, the complete official recommended configuration, the existing typed TypeScript project, and the `src/**/*.ts` scope. It must not disable or downgrade a recommended rule.

Acceptance: the dependency and lockfile resolve version `0.4.1`; config inspection shows the complete recommended configuration with no project rule suppression; `npm run lint` exits zero with zero errors and zero warnings.

### R2 — Rule-driven source and settings remediation

Every finding emitted by R1 must be resolved in source without changing the OpenAI-only backend contract, legacy settings behavior, mobile availability on supported app versions, or guarded desktop-only behavior. Settings findings are resolved through the Obsidian 1.13 Settings Definitions API rather than lint suppression.

Acceptance: each changed source path maps to an official lint finding; settings controls preserve their values, persistence, validation, and dependent updates on Obsidian 1.13+; focused behavior tests pass; no suppression or unrelated refactor appears in the diff.

### R3 — Active reviewer-surface scan

Release validation must reject removed Claude backend, CLI probe, process, configuration, and UI markers in active executable or shipped surfaces. It must not classify historical chain documents, repository-agent instructions, or intentional negative fixtures as runtime violations.

Acceptance: positive fixtures for each forbidden marker fail with a path and category; allowed historical and negative-fixture controls pass; the current active repository scan exits zero.

### R4 — Evaluation artifact consistency

The orphan `eval/claude-probe/run.cjs` must be absent. `eval/mobile-fixes/run.cjs` must be regenerated from its current Claude-free TypeScript source with Markdown imports supported and must remain runnable.

Acceptance: Git no longer tracks the orphan probe; the mobile evaluation bundle has a reproducible build command, contains no forbidden marker, and its existing evaluation exits zero.

### R5 — OpenAI, legacy vault, mobile, and minimum-version contract

OpenAI must remain the only runtime backend. Legacy vault data containing former Claude fields must not prevent startup or trigger an automatic settings write. Desktop and mobile plugin availability must remain enabled for Obsidian `1.13.0` and later.

Acceptance: OpenAI-only settings and load tests pass; no Claude or LM Studio backend surface exists; the legacy settings fixture starts without a migration write; `0.3.6` root, source, and distribution manifests declare `minAppVersion: 1.13.0` and retain `isDesktopOnly: false`; settings integration tests exercise the supported 1.13 API; the guarded desktop export test passes.

### R6 — Immutable `0.3.5` and synchronized `0.3.6` metadata

Published and tagged `0.3.5` must remain unchanged, and `versions.json["0.3.5"]` must remain `1.7.2`. The remediation must create a distinct `0.3.6` version record whose package, source, root, distribution, and compatibility metadata agree.

Acceptance: remote `0.3.5` tag, release assets, and published manifest are unchanged; `versions.json["0.3.5"]` equals `1.7.2`; `package.json`, both package-lock root version fields, `src/manifest.json`, `manifest.json`, and built `dist/manifest.json` equal `0.3.6`; all `0.3.6` manifests and `versions.json["0.3.6"]` equal `1.13.0` for minimum-app compatibility; release validation rejects any mismatch.

### R7 — Verified post-merge release

The existing release workflow must be the only publication path and must publish `0.3.6` automatically only from the merged remediation revision after every required gate passes. No release may be created from an unmerged pull request, warning-bearing lint result, failing test or evaluation, failed validator, or inconsistent metadata.

Acceptance: lint, typecheck, focused tests, the full test suite, mobile evaluation, production build, prebuild release validation, postbuild release validation, active-surface scan, and diff checks all pass before merge and release; the release workflow runs on the merged `master` commit; tag and GitHub release `0.3.6` contain flat `main.js`, `manifest.json`, and `styles.css`; a negative reviewer fixture or metadata mismatch prevents publication.

### R8 — Documentation and Community boundary

Current developer documentation and the bound iwiki domain must describe the official zero-warning lint contract, Obsidian `1.13.0` minimum for `0.3.6`, immutable `0.3.5` compatibility history, Settings Definitions migration, active-surface gates, and post-merge release evidence. Community plugin-directory submission and metadata remain outside the delivery.

Acceptance: repository docs and iwiki agree with R1–R7; result reconciliation maps every changed path to R1–R8; no Community directory, account, submission, or review action occurs; no Claude, LM Studio, or other backend is added.

## Error Handling

Lint and active-surface findings are fail-closed and report exact paths and rule or marker categories. Generated evaluation rebuild failure reports the unsupported import or bundling step and leaves the tracked artifact unchanged until a successful rebuild is available.

If an official rule requires a change that conflicts with mobile support on Obsidian 1.13+, OpenAI-only execution, safe legacy loading, or guarded desktop behavior, implementation halts for user review. If preparing `0.3.6` would rewrite published `0.3.5`, change its historical mapping away from `1.7.2`, or require publication before merge, delivery halts. The implementation must not add a suppression, set `isDesktopOnly: true`, add a backend, weaken a release gate, or edit Community directory metadata to obtain a passing result.

## Test Strategy

Focused lint tests inspect the resolved plugin version, effective configuration, warning threshold, Settings Definitions behavior, and guarded Node-import behavior. Release-validator tests cover forbidden marker categories, path reporting, allowed historical evidence, and intentional negative fixtures.

Evaluation checks rebuild and execute the mobile-fixes bundle and confirm the Claude probe bundle is absent. Compatibility checks cover OpenAI settings, legacy vault loading without writes, mobile manifests, and guarded desktop export behavior.

Version checks compare package, package-lock, source, root, and built distribution metadata; assert `versions.json["0.3.5"] === "1.7.2"` and `versions.json["0.3.6"] === "1.13.0"`; and verify published `0.3.5` has not changed. Workflow checks prove publication uses the merged `master` revision and that a warning, failure, reviewer marker, metadata mismatch, or asset mismatch blocks release creation.

Broad verification runs lint with zero warnings, typecheck, focused tests, all tests, mobile evaluation, production build, prebuild validation, postbuild validation, a final active-surface scan, and `git diff --check`. After merge, release evidence confirms tag and GitHub release `0.3.6` plus the three validated flat assets.

## Documentation Strategy

Current developer documentation records the exact source lint scope, zero-warning threshold, Obsidian `1.13.0` minimum for `0.3.6`, immutable `0.3.5`/`1.7.2` history, synchronized release metadata, Settings Definitions contract, active-surface scan scope, explicit historical/test exceptions, evaluation bundle policy, and post-merge publication path. The bound iwiki domain records the same reviewer contract and release evidence. Historical chain records are not rewritten.

## Risks and Mitigations

- The current plugin update can expose many findings. Corrections remain rule-driven and are verified in focused batches before broad checks.
- A broad textual scan can flag audit evidence. The scanner uses explicit active paths and tested exceptions rather than repository-wide text replacement.
- A generated bundle can drift from its source again. A reproducible build command and active-surface regression test make drift visible.
- Lint fixes can alter UI strings or Obsidian API usage. Focused tests and the full suite verify existing observable behavior.
- Reusing `0.3.5` for the new compatibility floor would rewrite release history. The release validator fixes the old mapping at `1.7.2`, requires a separate `0.3.6` record, and compares synchronized metadata before publication.
- The `0.3.6` version can drift across package, lockfile, manifests, build output, or `versions.json`. Prebuild and postbuild checks fail on any mismatch.
- Raising the minimum version excludes older Obsidian installations from `0.3.6`. The new manifests and compatibility mapping state `1.13.0` consistently, current docs disclose the boundary, and `0.3.5` history remains available unchanged.
- Node APIs can break mobile loading. The existing runtime guard and official guard-aware rule remain mandatory.
- Release automation could publish too early or from the wrong revision. Publication remains on the existing merge-triggered workflow, requires the merged `master` revision, and follows every zero-warning verification gate.
- A release workflow failure after merge can leave `0.3.6` unpublished. Retry is allowed only against the same verified merged revision; it must not create an artificial history rewrite or bypass a failed gate.

## Autonomy Boundaries

- Full autonomy: remove stale executable evaluation artifacts and make mechanical, rule-driven lint corrections with focused tests.
- Guarded autonomy: update ESLint configuration, settings tests, `0.3.6` package and manifest metadata, `versions.json` (`0.3.5` retained at `1.7.2`, `0.3.6` added at `1.13.0`), release validation, and the existing release workflow, with recorded rationale and passing checks.
- Authorized automatic action: after full verification and pull-request merge, the existing workflow may publish `0.3.6` without another approval. A retry is authorized only for the same merged revision after all gates pass.
- Proposal-first: change public behavior, the approved `0.3.6` compatibility target, the publication mechanism, or any required verification gate.
- Human-only: modify published or tagged `0.3.5`, change its historical mapping away from `1.7.2`, submit or edit the Community plugin-directory entry, change the OpenAI contract, or add Claude, LM Studio, or another backend.

## Human Checkpoints

Changing OpenAI behavior, adding Claude, LM Studio, or another backend, setting `isDesktopOnly: true`, weakening an official rule or release gate, deleting historical evidence, changing the approved compatibility target or release mechanism, modifying published `0.3.5`, or submitting or editing the Community directory requires separate user approval.

The `0.3.6` version bump, `minAppVersion: 1.13.0`, retention of `versions.json["0.3.5"] = "1.7.2"`, settings migration, merge-triggered automatic `0.3.6` publication, and gated retry of the same merged revision are already authorized. Publication does not require a new checkpoint once all verification passes and the pull request is merged. Community plugin-directory submission remains excluded from completion.
