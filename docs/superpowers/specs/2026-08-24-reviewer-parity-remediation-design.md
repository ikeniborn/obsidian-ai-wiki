---
review:
  spec_hash: 5c5c3845f402c34d
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

The repository will use the current official Obsidian ESLint configuration as a zero-warning source gate and a separate allowlist-aware scan for active executable and release artifacts. The change removes two stale Claude-bearing evaluation bundles, adopts the Obsidian 1.13 Settings Definitions API, and raises `minAppVersion` to `1.13.0` while preserving the OpenAI-only runtime, legacy vault startup, desktop and mobile support, historical audit records, and release controls.

## Acceptance (from intent)

- The current official lint command completes without errors.
- Tracked repository artifacts contain no Claude Code evaluation, process, or configuration surfaces.
- The OpenAI plugin builds and works as the sole supported backend, while existing vault settings still start safely.
- A repeat Community scan can be submitted with these reviewer risks removed.
- Done when: current official lint has no errors, Claude surfaces are absent, build and tests pass, and the reviewer-risk scan is clean.

The approved design strengthens the lint outcome to zero errors and zero warnings for `src/**/*.ts`.

## Scope

The change covers the ESLint dependency and configuration, source findings produced by the current official recommended configuration, the settings UI migration, manifest minimum-version metadata, active-surface release validation, stale tracked evaluation bundles, focused regression tests, build output, current repository documentation, and the bound iwiki domain.

Historical artifacts under `docs/superpowers/`, intentional negative test fixtures, and repository-agent instructions remain audit or test evidence. Full-repository ESLint parser coverage, LM Studio support, a new backend, a release, and Community directory submission are outside scope.

## Architecture

Two independent gates cover different reviewer risks.

The source lint gate runs `eslint-plugin-obsidianmd@0.4.1` over `src/**/*.ts` through its complete `configs.recommended` configuration and the existing typed TypeScript project. The project does not disable or downgrade recommended rules. The npm command uses `--max-warnings 0`, so both errors and warnings block the gate.

The settings UI implements the declarative Settings Definitions API introduced in Obsidian 1.13. Legacy `display()` refresh calls and deprecated control methods are removed. Root, source, and distribution manifests declare `minAppVersion: 1.13.0`; the plugin remains available on desktop and mobile installations that meet that minimum.

The active-surface gate extends the existing release validator instead of forcing generated CommonJS, tests, and scripts through one TypeScript parser project. It scans executable and shipped surfaces for removed Claude backend, CLI probe, process, configuration, and UI markers. Its scope and exceptions are explicit, deterministic, and covered by fixtures.

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

The official `obsidianmd/no-nodejs-modules` rule evaluates the guarded OKF desktop adapter. Node imports remain behind the existing `Platform.isDesktop && Platform.isDesktopApp` runtime guard; no unguarded Node import is introduced.

## Validation Flow

Dependency installation resolves the pinned lint plugin. Source lint then produces the complete official finding set. Source corrections continue until the command reports zero errors and zero warnings.

The release validator next scans active repository surfaces. The orphan Claude probe is absent, the regenerated mobile evaluation bundle contains no removed markers, and the production bundle remains OpenAI-only. Typecheck, focused tests, the full test suite, production build, and pre/post release validation run after source and evaluation changes.

A failing command stops the flow. No release metadata, publication, or Community submission follows from this task.

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

Acceptance: OpenAI-only settings and load tests pass; the legacy settings fixture starts without a migration write; root, source, and distribution manifests declare `minAppVersion: 1.13.0` and retain `isDesktopOnly: false`; settings integration tests exercise the supported 1.13 API; the guarded desktop export test passes.

### R6 — Release gate integration

The repository must enforce the zero-warning source lint and active-surface scan in its existing CI/release validation sequence before an artifact can be treated as release-ready.

Acceptance: lint, typecheck, focused tests, the full test suite, production build, prebuild release validation, and postbuild release validation all exit zero; a negative reviewer fixture makes the relevant gate fail.

### R7 — Delivery and documentation boundary

Current developer documentation and the bound iwiki domain must describe the official lint, Obsidian 1.13 minimum, Settings Definitions migration, and active-surface gates. This task must not add LM Studio, another backend, a plugin version bump, publication, or Community submission changes.

Acceptance: repository docs and iwiki agree with R1–R6; result reconciliation maps every changed path to R1–R7 and reports no plugin version bump, publication, submission, or backend-addition path.

## Error Handling

Lint and active-surface findings are fail-closed and report exact paths and rule or marker categories. Generated evaluation rebuild failure reports the unsupported import or bundling step and leaves the tracked artifact unchanged until a successful rebuild is available.

If an official rule requires a change that conflicts with mobile support on Obsidian 1.13+, OpenAI-only execution, safe legacy loading, or guarded desktop behavior, implementation halts for user review. The implementation must not add a suppression, set `isDesktopOnly: true`, add a backend, or weaken a release gate to obtain a passing result.

## Test Strategy

Focused lint tests inspect the resolved plugin version, effective configuration, warning threshold, Settings Definitions behavior, and guarded Node-import behavior. Release-validator tests cover forbidden marker categories, path reporting, allowed historical evidence, and intentional negative fixtures.

Evaluation checks rebuild and execute the mobile-fixes bundle and confirm the Claude probe bundle is absent. Compatibility checks cover OpenAI settings, legacy vault loading without writes, mobile manifests, and guarded desktop export behavior.

Broad verification runs lint, typecheck, all tests, production build, prebuild validation, postbuild validation, a final active-surface scan, and `git diff --check`.

## Documentation Strategy

Current developer documentation records the exact source lint scope, zero-warning threshold, Obsidian 1.13 minimum, Settings Definitions contract, active-surface scan scope, explicit historical/test exceptions, and evaluation bundle policy. The bound iwiki domain records the same reviewer contract and verification evidence. Historical chain records are not rewritten.

## Risks and Mitigations

- The current plugin update can expose many findings. Corrections remain rule-driven and are verified in focused batches before broad checks.
- A broad textual scan can flag audit evidence. The scanner uses explicit active paths and tested exceptions rather than repository-wide text replacement.
- A generated bundle can drift from its source again. A reproducible build command and active-surface regression test make drift visible.
- Lint fixes can alter UI strings or Obsidian API usage. Focused tests and the full suite verify existing observable behavior.
- Raising the minimum version excludes older Obsidian installations. The manifests state `1.13.0` consistently, current docs disclose the boundary, and the change proceeds only because the user approved this compatibility trade-off.
- Node APIs can break mobile loading. The existing runtime guard and official guard-aware rule remain mandatory.

## Human Checkpoints

Changing OpenAI behavior, adding a backend, setting `isDesktopOnly: true`, weakening an official rule, deleting historical evidence, publishing a release, or submitting to the Community directory requires separate user approval. Raising `minAppVersion` to `1.13.0` and migrating the settings UI are authorized by the user's recorded compatibility decision. This specification authorizes design and planning only; implementation begins after the checked plan is approved.
