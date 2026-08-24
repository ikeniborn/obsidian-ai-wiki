---
review:
  spec_hash: 9af440ff918abbcc
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

Delivery creates a new release record rather than rewriting history. Published and tagged `0.3.5` remains immutable, and its historical `versions.json` mapping remains `1.7.2`. Package, source-manifest, root-manifest, and built distribution versions advance together to `0.3.6`; the `0.3.6` manifests and `versions.json["0.3.6"]` declare Obsidian `1.13.0`. After every required zero-warning verification passes and the remediation pull request is merged, the existing release workflow publishes `0.3.6` automatically through a serialized, create-only tag-and-release protocol with the validated flat assets.

## Acceptance (from intent)

- The current official lint command completes with zero errors and zero warnings.
- Active tracked repository and release artifacts contain no Claude Code evaluation, process, configuration, runtime, or UI surfaces.
- The OpenAI plugin builds and works as the sole supported backend, while existing vault settings still start safely.
- Published and tagged `0.3.5` remains unchanged, including its historical `versions.json` value of `1.7.2`.
- Package, lockfile, source, root, and distribution metadata agree on version `0.3.6`; every `0.3.6` manifest and `versions.json["0.3.6"]` declare `1.13.0`.
- Lint, typecheck, focused tests, the full test suite, production build, prebuild release validation, postbuild release validation, active-surface scan, mobile evaluation, and diff checks pass before merge and release.
- The merged `0.3.6` revision is published by the existing release workflow through a non-force lightweight tag claim and one create-only `gh release create` call; the final published release has an exact-commit tag and exactly the locally verified `main.js`, `manifest.json`, and `styles.css` assets.
- Release `0.3.6` is ready for a repeat Community scan. Community plugin-directory submission and metadata changes are not required or authorized.

## Scope

The change covers the ESLint dependency and configuration, source findings produced by the current official recommended configuration, the settings UI migration, active-surface release validation, stale tracked evaluation bundles, focused regression tests, build output, current repository documentation, and the bound iwiki domain. Delivery scope also includes the synchronized `0.3.6` version bump, the new `1.13.0` compatibility record, merge-only use of the existing release workflow, and automatic publication of GitHub release `0.3.6` after all gates pass.

Historical artifacts under `docs/superpowers/`, intentional negative test fixtures, and repository-agent instructions remain audit or test evidence. Full-repository ESLint parser coverage, Claude or LM Studio runtime support, any backend other than OpenAI, modification of published or tagged `0.3.5`, and Community plugin-directory submission, account actions, review actions, or directory metadata changes are outside scope.

## Architecture

Two independent reviewer gates plus one release-history boundary cover the approved risks.

The source lint gate runs `eslint-plugin-obsidianmd@0.4.1` over `src/**/*.ts` through its complete `configs.recommended` configuration and the existing typed TypeScript project. The project does not disable or downgrade recommended rules. The npm command uses `--max-warnings 0`, so both errors and warnings block the gate.

The settings UI implements the declarative Settings Definitions API introduced in Obsidian 1.13. Legacy `display()` refresh calls and deprecated control methods are removed. The new `0.3.6` root, source, and distribution manifests declare `minAppVersion: 1.13.0`; the plugin remains available on desktop and mobile installations that meet that minimum.

The active-surface gate extends the existing release validator instead of forcing generated CommonJS, tests, and scripts through one TypeScript parser project. It scans executable and shipped surfaces for removed Claude backend, CLI probe, process, configuration, and UI markers. Its scope and exceptions are explicit, deterministic, and covered by fixtures.

Version history and release delivery form a third fail-closed boundary. Validation requires immutable `0.3.5` history, synchronized `0.3.6` metadata, the new `0.3.6` compatibility mapping, and exactly the flat release asset set. The existing release workflow remains the only publication path: a merge to `master` supplies the release revision, and a constant release concurrency group with `queue: max` and `cancel-in-progress: false` serializes runs, retains waiting runs up to the platform queue limit, and does not cancel an in-flight publisher. The workflow completes every verification gate and build-provenance attestation before the first tag or release mutation. It then performs authenticated, fail-closed reconciliation of every draft or published release for version `0.3.6`, atomically claims a lightweight tag at exactly `github.sha` without force, and invokes one create-only GitHub CLI release command. It never edits, uploads into, clobbers, or automatically repairs an existing or partial release.

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

`.github/workflows/release.yml` remains the publication mechanism. Its automatic `master` push path is reached by merging the remediation pull request containing the `src/manifest.json` bump. Workflow concurrency uses one constant group, `queue: max`, and `cancel-in-progress: false`. The workflow validates metadata and active surfaces, runs zero-warning lint, typecheck, tests, production build, postbuild asset checks, and build-provenance attestation before any tag or release mutation.

After those gates, an authenticated paginated GitHub API search lists all releases, including drafts, and selects every record whose `tag_name` exactly equals the version. It fails closed unless it can determine the complete exact-version state. Multiple version matches, a draft, a partial release, an API error, or an ambiguous response stops publication. One already completed exact release is terminal success without mutation only when its lightweight tag resolves exactly to `GITHUB_SHA`, it is published, non-draft, and non-prerelease, and its exact three assets match the local files by name, SHA-256 digest, and bytes.

With no release residue, the workflow claims `refs/tags/0.3.6` by a single atomic non-force push of exactly `GITHUB_SHA`, producing a lightweight tag. A failed claim stops unless this is a rerun of the same original workflow run, the existing ref is a lightweight tag at the same original `GITHUB_SHA`, and a fresh fail-closed release search still finds no residue. Any conflicting commit, annotated tag, first-attempt race, or unprovable state stops. After a successful or permitted same-run claim, the only publication command is:

```bash
gh release create "$version" dist/main.js dist/manifest.json dist/styles.css --verify-tag --target "$GITHUB_SHA" --title "$version" --generate-notes
```

There is no edit, upload, or clobber fallback. A create error or post-create mismatch is possible residue and stops for separate cleanup authorization. Final postconditions require the lightweight tag at exactly `GITHUB_SHA`; one published, non-draft, non-prerelease release; and exactly `main.js`, `manifest.json`, and `styles.css`, each matching the locally attested file by SHA-256 digest and bytes.

## Data and Validation Flow

1. Dependency installation resolves the pinned lint plugin. Source lint produces the complete official finding set; source corrections continue until the command reports zero errors and zero warnings.
2. Release validation scans active repository surfaces. The orphan Claude probe is absent, the regenerated mobile evaluation bundle contains no removed markers, and the production bundle remains OpenAI-only.
3. Version preparation updates package, lockfile, source, and root records to `0.3.6`, preserves `versions.json["0.3.5"] = "1.7.2"`, and appends `versions.json["0.3.6"] = "1.13.0"`. The build generates a matching distribution manifest and flat assets.
4. Typecheck, focused tests, the full test suite, mobile evaluation, production build, prebuild and postbuild release validation, final active-surface scan, and diff checks run against the release candidate. Any error or warning stops delivery.
5. The verified pull request merges. The resulting `master` push triggers the existing release workflow, which enters the constant serialized release queue and repeats its enforced gates against the merged `GITHUB_SHA`.
6. The workflow computes the local asset names, bytes, and SHA-256 digests and attests all three assets before release mutation. It then performs an authenticated, fail-closed search for every draft or published release whose version is `0.3.6`. A completed exact release is terminal success without mutation; ambiguous, multiple, draft, partial, or conflicting state stops.
7. With no release residue, one non-force push atomically claims a lightweight `0.3.6` tag at exactly `GITHUB_SHA`. Claim failure is accepted only for a rerun of the same original workflow and SHA when the existing lightweight tag is exact and a fresh search confirms no release residue; every other failure stops.
8. The workflow runs the single create-only `gh release create` command and verifies the exact tag commit, published/non-draft/non-prerelease flags, exact three asset names, SHA-256 digests, and remote bytes against local files. Any create or postcondition ambiguity stops for separately authorized cleanup. Published `0.3.5` remains untouched. Release `0.3.6` becomes input for a later Community scan, not an authorization to submit or edit directory metadata.

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

### R7 — Verified create-only post-merge release

The existing release workflow must remain the only publication path and publish `0.3.6` automatically only from the merged remediation revision after every required gate and provenance attestation passes. Its constant concurrency group, `queue: max`, and non-cancelling policy must serialize publishers, retain waiting runs up to the platform queue limit, and leave the active run in progress. Release reconciliation must use authenticated paginated API results and fail closed across every draft and published record whose `tag_name` exactly equals the version. Mutation is limited to one atomic non-force lightweight tag claim at exactly `GITHUB_SHA` and one `gh release create` command with `--verify-tag` and `--target "$GITHUB_SHA"`; no edit, upload, clobber, or partial-state recovery path is permitted.

Acceptance: lint, typecheck, focused tests, the full test suite, mobile evaluation, production build, prebuild release validation, postbuild release validation, active-surface scan, diff checks, local asset digesting, and provenance attestation all pass before tag or release mutation; the workflow runs on the merged `master` commit; authenticated lookup rejects ambiguous, multiple, draft, partial, or conflicting version state; tag claim is non-force, lightweight, and exact-commit; claim failure proceeds only on a rerun of the same original workflow and SHA with the exact existing tag and no release residue. The release is published, non-draft, non-prerelease, and contains exactly `main.js`, `manifest.json`, and `styles.css`, whose SHA-256 digests and downloaded bytes match the local attested files. A completed exact release is terminal success with no mutation. Any negative reviewer fixture, metadata mismatch, release residue, API ambiguity, asset mismatch, or unauthorized rerun prevents publication.

### R8 — Documentation and Community boundary

Current developer documentation and the bound iwiki domain must describe the official zero-warning lint contract, Obsidian `1.13.0` minimum for `0.3.6`, immutable `0.3.5` compatibility history, Settings Definitions migration, active-surface gates, and post-merge release evidence. Community plugin-directory submission and metadata remain outside the delivery.

Acceptance: repository docs and iwiki agree with R1–R7; result reconciliation maps every changed path to R1–R8; no Community directory, account, submission, or review action occurs; no Claude, LM Studio, or other backend is added.

## Error Handling

Lint and active-surface findings are fail-closed and report exact paths and rule or marker categories. Generated evaluation rebuild failure reports the unsupported import or bundling step and leaves the tracked artifact unchanged until a successful rebuild is available.

If an official rule requires a change that conflicts with mobile support on Obsidian 1.13+, OpenAI-only execution, safe legacy loading, or guarded desktop behavior, implementation halts for user review. If preparing `0.3.6` would rewrite published `0.3.5`, change its historical mapping away from `1.7.2`, or require publication before merge, delivery halts. The implementation must not add a suppression, set `isDesktopOnly: true`, add a backend, weaken a release gate, or edit Community directory metadata to obtain a passing result.

Release discovery treats authentication, transport, pagination, malformed response, duplicate version record, draft or partial release, and uncertain tag or asset state as stop conditions. A tag-claim failure stops unless same-original-run rerun evidence, exact lightweight tag SHA, and an empty fresh release search all agree. `gh release create` failure and any postcondition mismatch are treated as possible residue; the workflow does not edit or resume the release. Cleanup or deletion requires separate authorization, after which only a rerun of the same original workflow may proceed when the full fail-closed preflight allows it. An already completed exact release returns success without mutation.

## Test Strategy

Focused lint tests inspect the resolved plugin version, effective configuration, warning threshold, Settings Definitions behavior, and guarded Node-import behavior. Release-validator tests cover forbidden marker categories, path reporting, allowed historical evidence, and intentional negative fixtures.

Evaluation checks rebuild and execute the mobile-fixes bundle and confirm the Claude probe bundle is absent. Compatibility checks cover OpenAI settings, legacy vault loading without writes, mobile manifests, and guarded desktop export behavior.

Version checks compare package, package-lock, source, root, and built distribution metadata; assert `versions.json["0.3.5"] === "1.7.2"` and `versions.json["0.3.6"] === "1.13.0"`; and verify published `0.3.5` has not changed. Workflow checks prove publication uses the merged `master` revision, serializes runs with the required concurrency policy, and performs every gate and attestation before mutation. They cover authenticated paginated release discovery; API and authentication failure; duplicate, draft, partial, and completed releases; conflicting, annotated, and exact lightweight tags; first-run claim races; permitted same-original-run reruns; create failure; and the absence of edit, upload, or clobber fallback.

Broad verification runs lint with zero warnings, typecheck, focused tests, all tests, mobile evaluation, production build, prebuild validation, postbuild validation, a final active-surface scan, and `git diff --check`. After merge, release evidence confirms a lightweight `0.3.6` tag at exactly the merged SHA; one published, non-draft, non-prerelease release; and exactly three flat assets whose names, SHA-256 digests, and downloaded bytes match the local attested files. A completed exact-release fixture proves terminal success performs no mutation; every partial or ambiguous fixture proves fail-closed stop without automatic recovery.

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
- Concurrent release runs could race on a version. A constant concurrency group, `queue: max`, and `cancel-in-progress: false` serialize publishers, retain waiting runs up to the platform queue limit, and preserve the active run; the atomic non-force tag claim remains the final ownership boundary.
- Release automation could publish too early or from the wrong revision. Publication remains on the existing merge-triggered workflow, requires the merged `master` `GITHUB_SHA`, and completes every zero-warning verification gate plus provenance attestation before mutation.
- A network or CLI failure can leave a tag, draft, partial release, or uncertain API state. The workflow never edits or resumes residue. It stops for separate cleanup authorization, then permits only a fail-closed rerun of the same original workflow and SHA.
- A successful create can still contain wrong assets or flags. Exact tag type/SHA, release flags, asset names, SHA-256 digests, and downloaded-byte checks are mandatory postconditions; mismatch stops without automated repair.

## Autonomy Boundaries

- Full autonomy: remove stale executable evaluation artifacts and make mechanical, rule-driven lint corrections with focused tests.
- Guarded autonomy: update ESLint configuration, settings tests, `0.3.6` package and manifest metadata, `versions.json` (`0.3.5` retained at `1.7.2`, `0.3.6` added at `1.13.0`), release validation, and the existing release workflow, with recorded rationale and passing checks.
- Authorized automatic action: after full verification and pull-request merge, the existing workflow may publish `0.3.6` without another approval through the create-only protocol. It may rerun only the same original workflow and SHA when authenticated fail-closed state inspection permits; a completed exact release is terminal success without mutation.
- Proposal-first: change public behavior, the approved `0.3.6` compatibility target, the publication mechanism, or any required verification gate.
- Human-only: clean up or delete release residue; modify published or tagged `0.3.5`; change its historical mapping away from `1.7.2`; submit or edit the Community plugin-directory entry; change the OpenAI contract; or add Claude, LM Studio, or another backend.

## Human Checkpoints

Changing OpenAI behavior, adding Claude, LM Studio, or another backend, setting `isDesktopOnly: true`, weakening an official rule or release gate, deleting historical evidence, changing the approved compatibility target or release mechanism, modifying published `0.3.5`, or submitting or editing the Community directory requires separate user approval.

The `0.3.6` version bump, `minAppVersion: 1.13.0`, retention of `versions.json["0.3.5"] = "1.7.2"`, settings migration, merge-triggered automatic `0.3.6` publication, and fail-closed rerun of the same original workflow and SHA are already authorized. Publication does not require a new checkpoint once all verification passes, the pull request is merged, and release state permits the create-only operation. Draft, partial, conflicting, or ambiguous residue requires a separate cleanup decision. Community plugin-directory submission remains excluded from completion.
