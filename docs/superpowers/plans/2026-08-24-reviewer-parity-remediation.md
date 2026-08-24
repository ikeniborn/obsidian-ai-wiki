---
review:
  plan_hash: f3a0c83465faab1d
  last_run: 2026-08-24
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-08-24-reviewer-parity-remediation-intent.md
  spec: docs/superpowers/specs/2026-08-24-reviewer-parity-remediation-design.md
---

# Reviewer Parity Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the current official Obsidian source lint and active reviewer-surface scan fail closed with zero warnings while preserving the OpenAI-only runtime, safe legacy-vault startup, and desktop/mobile availability on Obsidian 1.13+.

**Architecture:** Keep two gates: official typed ESLint for `src/**/*.ts`, plus path-scoped release validation for active executable and shipped artifacts. Migrate the settings tab to Obsidian 1.13 Setting Definitions, fix each current lint finding in source, remove stale Claude eval output, and regenerate the retained mobile eval from its TypeScript source.

**Tech Stack:** TypeScript, Obsidian API 1.13, ESLint 9, `eslint-plugin-obsidianmd@0.4.1`, Node test runner, esbuild, npm, iwiki MCP.

---

## Constraints and requirement map

- R1: Tasks 1 and 6 establish exact official lint dependency, config, scope, and zero-warning threshold.
- R2: Tasks 2–5 resolve every current source finding without suppressions.
- R3: Task 7 adds active-surface marker validation and fixtures.
- R4: Task 8 removes the orphan Claude probe and reproducibly rebuilds the mobile eval.
- R5: Tasks 3, 4, and 9 preserve OpenAI-only loading, legacy settings, mobile support, and set `minAppVersion` to `1.13.0`.
- R6: Tasks 6, 7, and 10 integrate and exercise all release gates.
- R7: Tasks 9 and 10 update current docs and iwiki, then reconcile every changed path. No version bump, release, publication, Community submission, or new backend is part of this plan.

Every numbered step inherits its task's `Closes` mapping. Every edit step's DoD is the immediately following verification step. Every commit step must exit zero and `git show --stat --oneline HEAD` must list only that task's declared files.

### Task 1: Pin official lint dependency and expose the zero-warning contract

**Closes:** R1 and the R6 lint-entry requirement.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `eslint.config.mjs`
- Test: `tests/obsidian-review-compliance.test.ts`

- [ ] Step 1: Add a failing contract test.

Extend `tests/obsidian-review-compliance.test.ts` to read `package.json`, `package-lock.json`, and `eslint.config.mjs`, then assert:

```ts
assert.equal(packageJson.devDependencies["eslint-plugin-obsidianmd"], "0.4.1");
assert.equal(packageLock.packages["node_modules/eslint-plugin-obsidianmd"].version, "0.4.1");
assert.equal(packageJson.scripts.lint, 'eslint "src/**/*.ts" --max-warnings 0');
assert.match(eslintConfig, /\.\.\.obsidianmd\.configs\.recommended/);
assert.doesNotMatch(eslintConfig, /rules\s*:/);
```

- [ ] Step 2: Run the focused test and confirm it fails against the old dependency, command, and overrides.

```bash
node --import tsx --test tests/obsidian-review-compliance.test.ts
```

Expected: non-zero exit with at least one assertion showing `^0.3.0`, missing `--max-warnings 0`, or the custom `rules` block.

- [ ] Step 3: Install the exact official lint version and update the lockfile.

```bash
npm install --save-dev --save-exact eslint-plugin-obsidianmd@0.4.1
```

Expected: `package.json` records `"eslint-plugin-obsidianmd": "0.4.1"`; lockfile resolves `0.4.1`.

- [ ] Step 4: Make `eslint.config.mjs` a thin typed wrapper.

Keep the project ignore list and TypeScript parser/project configuration, but remove the Node-global injection and the complete custom `rules` block. Keep the full spread:

```js
export default defineConfig([
  {
    ignores: ["main.js", "dist/**", "node_modules/**", "esbuild.config.mjs"],
  },
  ...obsidianmd.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: { project: "./tsconfig.json" },
    },
  },
]);
```

Change the npm command to `eslint "src/**/*.ts" --max-warnings 0`.

- [ ] Step 5: Run the contract test and capture the official baseline.

```bash
node --import tsx --test tests/obsidian-review-compliance.test.ts
npm run lint
```

Expected: contract test passes; lint fails with the known remediation inventory rather than a config error.

- [ ] Step 6: Commit the gate contract only.

```bash
git add package.json package-lock.json eslint.config.mjs tests/obsidian-review-compliance.test.ts
git commit -m "build(lint): pin official Obsidian reviewer rules"
```

### Task 2: Replace unsafe implicit stringification

**Closes:** R2 official type-aware stringification findings.

**Files:**

- Create: `src/utils/describe-unknown.ts`
- Create: `tests/describe-unknown.test.ts`
- Modify: `src/file-transaction.ts`
- Modify: `src/migrate-jsonl-domain-storage.ts`
- Modify: `src/phases/delete.ts`
- Modify: `src/phases/llm-utils.ts`
- Modify: `src/retrieval-eval-metrics.ts`
- Modify: `src/run-event-bridge.ts`
- Modify: `src/utils/raw-frontmatter.ts`
- Modify: `src/vault-tools.ts`

- [ ] Step 1: Write focused behavior tests for a deterministic unknown-value description.

Use the following contract in `tests/describe-unknown.test.ts`:

```ts
assert.equal(describeUnknown(new Error("broken")), "broken");
assert.equal(describeUnknown("plain"), "plain");
assert.equal(describeUnknown(7), "7");
assert.equal(describeUnknown({ key: "value" }), '{"key":"value"}');
const circular: Record<string, unknown> = {};
circular.self = circular;
assert.equal(describeUnknown(circular), "Unknown value");
```

- [ ] Step 2: Run the new test and confirm the missing module failure.

```bash
node --import tsx --test tests/describe-unknown.test.ts
```

Expected: non-zero exit because `src/utils/describe-unknown.ts` does not exist.

- [ ] Step 3: Add the smallest shared helper that never falls back to object default stringification.

```ts
export function describeUnknown(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return value.toString();
  }
  if (typeof value === "symbol") return value.description ?? "Symbol";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value) ?? "Unknown value";
  } catch {
    return "Unknown value";
  }
}
```

- [ ] Step 4: Replace only the official `no-base-to-string` and `restrict-template-expressions` sites with `describeUnknown(...)` or explicit primitive narrowing. Preserve surrounding error prefixes and event payload fields.

- [ ] Step 5: Run the helper test, the source tests that exercise touched code, and lint for the touched files.

```bash
node --import tsx --test tests/describe-unknown.test.ts tests/file-transaction.test.ts tests/source-deletion.test.ts tests/wiki-index-jsonl.test.ts
npx eslint src/utils/describe-unknown.ts src/file-transaction.ts src/migrate-jsonl-domain-storage.ts src/phases/delete.ts src/phases/llm-utils.ts src/retrieval-eval-metrics.ts src/run-event-bridge.ts src/utils/raw-frontmatter.ts src/vault-tools.ts --max-warnings 0
```

Expected: both commands exit zero; no stringification finding remains in these files.

- [ ] Step 6: Commit the rule-driven stringification fixes.

```bash
git add src/utils/describe-unknown.ts tests/describe-unknown.test.ts src/file-transaction.ts src/migrate-jsonl-domain-storage.ts src/phases/delete.ts src/phases/llm-utils.ts src/retrieval-eval-metrics.ts src/run-event-bridge.ts src/utils/raw-frontmatter.ts src/vault-tools.ts
git commit -m "fix(lint): make unknown value formatting explicit"
```

### Task 3: Migrate the settings tab to Obsidian 1.13 Setting Definitions

**Closes:** R2 settings-API findings and R5 settings/legacy-load compatibility.

**Files:**

- Modify: `src/settings.ts`
- Modify: `src/main.ts`
- Create: `tests/settings-definitions.test.ts`
- Modify: `tests/settings-model-controls.test.ts`

- [ ] Step 1: Add source-contract tests for the supported API and preserved settings surface.

Assert in `tests/settings-definitions.test.ts` that `LlmWikiSettingTab` implements `getSettingDefinitions(): SettingDefinitionItem[]`, imports `SettingDefinitionItem`, and contains no `display(): void` or `this.display()`. Assert `src/main.ts` refreshes with `this.settingTab?.update()`.

Keep the existing settings layout assertions in `tests/settings-model-controls.test.ts`; replace its assertion that forbids rerender during typing so it now forbids `this.update()` in the live per-character budget callback.

- [ ] Step 2: Run focused settings tests and confirm the new API assertions fail.

```bash
node --import tsx --test tests/settings-definitions.test.ts tests/settings-model-controls.test.ts
```

Expected: non-zero exit because the tab still implements and calls `display()`.

- [ ] Step 3: Convert existing setting rows into Setting Definition items without changing callback bodies.

Import `SettingDefinitionItem`. Replace imperative top-level `render()` ownership with synchronous `getSettingDefinitions()` returning groups and definition items. For custom controls, use supported render definitions:

```ts
{
  name: T.settings.model_name,
  desc: T.settings.model_desc,
  render: (setting) => {
    this.addModelControl(setting, currentValue, onCommit);
  },
}
```

Represent existing headings as `type: "group"` definitions. Preserve current conditional structure by building arrays from current settings state; callbacks that change structure call `this.update()`. Live per-character callbacks continue repainting their registered controls in place and do not call `update()`.

- [ ] Step 4: Load cached domain/local state asynchronously, then invoke the supported refresh.

Keep `refresh()` responsible only for loading `cachedDomains` and `localCache`; end it with `this.update()`. Start it when the tab is created or first indexed, without persisting settings. Replace all structural `this.display()` calls with `this.update()` and `src/main.ts` busy refresh with `this.settingTab?.update()`.

- [ ] Step 5: Run focused settings and legacy-loading tests.

```bash
node --import tsx --test tests/settings-definitions.test.ts tests/settings-model-controls.test.ts tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts
```

Expected: zero exit; controls/order assertions pass; legacy Claude-shaped fields remain ignored and loading causes no migration write.

- [ ] Step 6: Run lint for the migrated settings paths.

```bash
npx eslint src/settings.ts src/main.ts --max-warnings 0
```

Expected: no `prefer-setting-definitions` or deprecated `display` findings. Any remaining sentence-case or deprecated-control findings belong to Task 4 and must be listed before proceeding.

- [ ] Step 7: Commit the API migration.

```bash
git add src/settings.ts src/main.ts tests/settings-definitions.test.ts tests/settings-model-controls.test.ts
git commit -m "refactor(settings): adopt Obsidian setting definitions"
```

### Task 4: Replace deprecated controls and fix reviewer-facing sentence case

**Closes:** R2 deprecated UI and sentence-case findings.

**Files:**

- Modify: `src/settings.ts`
- Modify: `src/modals.ts`
- Modify: `src/main.ts`
- Modify: `src/view.ts`
- Create: `tests/ui-review-compliance.test.ts`
- Modify only if displayed text assertions require it: `tests/settings-model-controls.test.ts`
- Modify only if displayed text assertions require it: `tests/view-llm-lifecycle.test.ts`

- [ ] Step 1: Add or update focused assertions for destructive buttons and reviewer-facing labels.

In `tests/ui-review-compliance.test.ts`, read the four UI source files. Assert destructive actions use `.setDestructive()` and no source contains `.setWarning()` or `.setDynamicTooltip()`. Update existing exact text assertions only where the official sentence-case rule changes displayed text; preserve product spelling as `AI Wiki` rather than `Aiwiki`.

- [ ] Step 2: Run the focused UI tests and confirm failure against deprecated methods or old strings.

```bash
node --import tsx --test tests/ui-review-compliance.test.ts tests/settings-model-controls.test.ts tests/view-llm-lifecycle.test.ts
```

Expected: non-zero exit for the new deprecated-method or text assertions.

- [ ] Step 3: Apply direct supported replacements.

Replace destructive `.setWarning()` calls in `src/settings.ts` and `src/modals.ts` with `.setDestructive()`. Remove `.setDynamicTooltip()` where the current value is already visible inline. Change only strings reported by `obsidianmd/ui/sentence-case`, using sentence case while preserving established acronyms when the rule accepts them.

- [ ] Step 4: Run focused tests and strict lint for all UI paths.

```bash
node --import tsx --test tests/ui-review-compliance.test.ts tests/settings-model-controls.test.ts tests/view-llm-lifecycle.test.ts
npx eslint src/settings.ts src/modals.ts src/main.ts src/view.ts --max-warnings 0
```

Expected: both commands exit zero; no deprecated UI API or sentence-case finding remains.

- [ ] Step 5: Commit the UI corrections.

```bash
git add src/settings.ts src/modals.ts src/main.ts src/view.ts tests/ui-review-compliance.test.ts tests/settings-model-controls.test.ts tests/view-llm-lifecycle.test.ts
git commit -m "fix(ui): replace deprecated Obsidian controls"
```

Before committing, inspect `git diff --cached --name-only`; unstage any test file not directly changed by this task.

### Task 5: Resolve environment-global findings without weakening mobile guards

**Closes:** R2 environment-global findings and R5 guarded desktop/mobile behavior.

**Files:**

- Modify: `src/native-openai-transport.ts`
- Modify: `src/view.ts`
- Modify: `tests/okf-export-desktop-guard.test.ts`
- Modify: relevant transport test under `tests/`

- [ ] Step 1: Add regression assertions for browser-safe timer typing and guarded Electron access.

Assert the transport timer uses `ReturnType<typeof setTimeout>` rather than `NodeJS.Timeout`. Extend `tests/okf-export-desktop-guard.test.ts` to require the existing `Platform.isDesktop && Platform.isDesktopApp` guard before Electron loading and to reject a free `require(...)` identifier.

- [ ] Step 2: Run focused tests and confirm failure.

```bash
node --import tsx --test tests/okf-export-desktop-guard.test.ts tests/native-openai-transport.test.ts
```

Expected: non-zero exit for at least the `NodeJS.Timeout` or free `require` assertion.

- [ ] Step 3: Replace `NodeJS.Timeout` with `ReturnType<typeof setTimeout>`. Render the system-editor button only inside `if (Platform.isDesktop && Platform.isDesktopApp)`. Inside its click callback, replace the free identifier with a typed desktop host lookup:

```ts
const electron = (window as Window & {
  require(id: "electron"): { shell: { openPath(path: string): Promise<string> } };
}).require("electron");
void electron.shell.openPath(absPath);
```

If the official `obsidianmd/no-nodejs-modules` rule rejects the guarded replacement, stop at the spec's human checkpoint; do not add a suppression and do not set `isDesktopOnly: true`.

- [ ] Step 4: Run focused tests and strict lint.

```bash
node --import tsx --test tests/okf-export-desktop-guard.test.ts tests/native-openai-transport.test.ts
npx eslint src/native-openai-transport.ts src/view.ts --max-warnings 0
```

Expected: zero exit; no `no-undef` or Node-module finding; guard assertions pass.

- [ ] Step 5: Commit environment corrections.

```bash
git add src/native-openai-transport.ts src/view.ts tests/okf-export-desktop-guard.test.ts tests/native-openai-transport.test.ts
git commit -m "fix(runtime): keep desktop APIs behind mobile guards"
```

### Task 6: Close the complete official source lint gate

**Closes:** R1 zero-warning proof and R6 lint-gate integration.

**Files:**

- Modify only source or focused tests identified by the effective lint report.

- [ ] Step 1: Run the exact gate and save the terminal inventory in implementation notes.

```bash
npm run lint
```

Expected: zero exit with zero warnings. If any finding remains, map it to its official rule and an already scoped source path before editing.

- [ ] Step 2: Prove the effective config still contains official rules and no local severity override.

```bash
npx eslint --print-config src/settings.ts > /tmp/reviewer-parity-eslint-config.json
node -e 'const c=require("/tmp/reviewer-parity-eslint-config.json"); const names=["obsidianmd/settings-tab/prefer-setting-definitions","obsidianmd/ui/sentence-case","@typescript-eslint/no-base-to-string","@typescript-eslint/restrict-template-expressions"]; for (const n of names) { if (!c.rules[n] || c.rules[n][0] === 0) throw new Error(`${n} disabled`); }'
```

Expected: zero exit. Remove `/tmp/reviewer-parity-eslint-config.json` after inspection.

- [ ] Step 3: If Step 1 required residual source corrections, run their focused tests and commit only those mapped corrections.

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; dirty paths are only the mapped residual corrections. Commit with `fix(lint): close official reviewer findings` only when needed.

### Task 7: Add a path-scoped active reviewer-surface scan

**Closes:** R3 active-surface detection and the R6 negative reviewer fixture.

**Files:**

- Modify: `scripts/validate-release.mjs`
- Modify: `tests/release-validation.test.ts`

- [ ] Step 1: Add failing fixtures for each forbidden category and active path.

Cover backend (`claude-agent`, `ClaudeCliClient`), CLI probe (`claude-probe`), process (`child_process`, `spawn(`), configuration (`iclaudePath`, `claudePath`), and UI (`Claude Code`) markers. Fixtures must assert stderr includes both category and repository-relative path. Add controls proving `docs/superpowers/**`, `scripts/dspy/CLAUDE.md`, and the test file's own negative markers are outside scan scope.

- [ ] Step 2: Run release validation tests and confirm new active-source cases fail.

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: non-zero exit because prebuild currently scans no active source paths.

- [ ] Step 3: Implement deterministic active-path scanning in `scripts/validate-release.mjs`.

Define explicit roots/files, recursively walk only existing active surfaces, and exclude the validator's intentional fixture source:

```js
const ACTIVE_SURFACES = ["src", "eval", "scripts", "dist/main.js"];
const EXCLUDED_ACTIVE_PATHS = new Set([
  "scripts/dspy/CLAUDE.md",
  "scripts/validate-release.mjs",
]);
```

The validator file is excluded because it necessarily declares the forbidden marker patterns it enforces. Apply categorized regexes only to text files under the remaining surfaces. Do not scan `docs/`, `tests/`, agent instructions, dependencies, or Git metadata. Report `[{path}] forbidden {category} marker: {marker}`. Run source/eval/script scan in prebuild and include `dist/main.js` in postbuild.

- [ ] Step 4: Run focused validator tests and current prebuild validation.

```bash
node --import tsx --test tests/release-validation.test.ts
npm run release:validate:pre
```

Expected: tests pass; current prebuild fails only on the known stale eval artifacts until Task 8.

- [ ] Step 5: Commit the scanner and fixtures.

```bash
git add scripts/validate-release.mjs tests/release-validation.test.ts
git commit -m "test(release): scan active reviewer surfaces"
```

### Task 8: Remove stale Claude eval output and rebuild the retained mobile eval

**Closes:** R4 eval consistency and R3 clean active eval surfaces.

**Files:**

- Delete: `eval/claude-probe/run.cjs`
- Modify generated: `eval/mobile-fixes/run.cjs`
- Modify: `package.json`
- Modify: `package-lock.json` only if npm changes script-related metadata
- Test: `tests/release-validation.test.ts`

- [ ] Step 1: Add a reproducible npm script for the tracked mobile eval bundle.

Use the already proven build recipe:

```json
"eval:mobile-fixes:build": "esbuild eval/mobile-fixes/run.ts --bundle --platform=node --alias:obsidian=./eval/mobile-fixes/obsidian-stub.ts --loader:.md=text --outfile=eval/mobile-fixes/run.cjs"
```

- [ ] Step 2: Delete the orphan generated Claude probe and rebuild the retained bundle.

```bash
git rm eval/claude-probe/run.cjs
npm run eval:mobile-fixes:build
```

Expected: `eval/claude-probe/run.cjs` is absent; `eval/mobile-fixes/run.cjs` is regenerated from current `run.ts` with Markdown loader support.

- [ ] Step 3: Execute the retained evaluation and active release scan.

```bash
node eval/mobile-fixes/run.cjs
npm run release:validate:pre
```

Expected: both exit zero; eval reports its existing passing result; active scan reports no Claude/process/config/UI marker.

- [ ] Step 4: Verify generated provenance and absence.

```bash
git ls-files --error-unmatch eval/claude-probe/run.cjs
```

Expected: non-zero exit, proving the orphan is no longer tracked.

```bash
rg -n -i 'claude code|claude-agent|ClaudeCliClient|iclaudePath|child_process|spawn\(' eval/mobile-fixes/run.cjs
```

Expected: exit 1 with no matches.

- [ ] Step 5: Commit eval cleanup.

```bash
git add package.json package-lock.json eval/mobile-fixes/run.cjs
git commit -m "chore(eval): remove stale Claude artifacts"
```

### Task 9: Declare Obsidian 1.13 compatibility and document current gates

**Closes:** R5 compatibility metadata and repository portion of R7 documentation.

**Files:**

- Modify: `src/manifest.json`
- Generated by build: `manifest.json`
- Generated by build: `dist/manifest.json`
- Modify: `versions.json`
- Modify: `README.md`
- Modify: current developer documentation selected from existing `docs/` layout
- Modify: `tests/release-validation.test.ts`

- [ ] Step 1: Update manifest fixtures to expect `minAppVersion: "1.13.0"` and retain `isDesktopOnly: false`; add a regression assertion that root/source/dist manifests agree after build.

- [ ] Step 2: Run focused manifest tests and confirm they fail against `1.7.2`.

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: non-zero exit on the new minimum-version assertion.

- [ ] Step 3: Change only `src/manifest.json` to `"minAppVersion": "1.13.0"`, then run production build to synchronize root/dist manifests and `versions.json`.

```bash
npm run build
```

Expected: build exits zero; `manifest.json`, `src/manifest.json`, and `dist/manifest.json` match; `versions.json["0.3.5"]` becomes `"1.13.0"`; version remains `0.3.5`; `isDesktopOnly` remains `false`.

- [ ] Step 4: Update current docs with exact contracts: Obsidian 1.13+, Setting Definitions, lint scope and zero-warning threshold, active-surface paths/exceptions, and mobile eval rebuild command. Do not rewrite historical chain documents.

- [ ] Step 5: Run focused release and legacy compatibility checks.

```bash
node --import tsx --test tests/release-validation.test.ts tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts tests/okf-export-desktop-guard.test.ts
npm run release:validate:pre
npm run release:validate:post
```

Expected: all commands exit zero; no settings write occurs during legacy load; manifests remain mobile-capable.

- [ ] Step 6: Commit compatibility metadata and current documentation.

```bash
git add src/manifest.json manifest.json dist/manifest.json versions.json README.md docs tests/release-validation.test.ts
git commit -m "docs(release): require Obsidian 1.13 reviewer gates"
```

Before committing, inspect staged paths and remove any historical or unrelated document.

### Task 10: Full verification, iwiki update, and result reconciliation

**Closes:** R6 full release verification and R7 durable documentation/delivery boundary.

**Files:**

- Modify through iwiki MCP: `obsidian-ai-wiki` reviewer/release guidance page selected after `wiki_search`
- Create after execution: `docs/superpowers/results/2026-08-24-reviewer-parity-remediation-result.md`
- Update through iwiki MCP: `reference/tasks/reviewer-parity-remediation` and active history segment

- [ ] Step 1: Run complete local verification in release order.

```bash
npm run lint
npm run typecheck
npm test
npm run release:validate:pre
npm run build
npm run release:validate:post
node eval/mobile-fixes/run.cjs
git diff --check
```

Expected: every command exits zero; lint has zero warnings; test output has zero failures; production bundle and manifests pass postbuild validation; mobile eval passes.

- [ ] Step 2: Run final active-surface and delivery-boundary checks.

```bash
rg -n -i 'claude code|claude-agent|ClaudeCliClient|iclaudePath|claudePath|child_process|spawn\(' src eval scripts dist/main.js
git diff origin/master...HEAD -- package.json src/manifest.json manifest.json versions.json
```

Expected: first command returns only the excluded validator's pattern declarations or explicitly allowed repository instruction content, and no runtime/eval/release violation; second confirms package version remains `0.3.5`, only minimum compatibility changes, and no new backend.

- [ ] Step 3: Update the bound iwiki domain through MCP.

Read the target page immediately before mutation, use its PostgreSQL revision and section hash, update or insert the reviewer-gate section, then run `wiki_lint`. Record official lint version/scope, zero-warning rule, Obsidian 1.13 minimum, Setting Definitions, active surfaces/exceptions, eval policy, and verification evidence.

Expected: mutation succeeds, reindex is automatic, task-page lint has no broken/stale/missing-source finding. Do not call Git-only `wiki_sync`.

- [ ] Step 4: Write the result artifact with a changed-path-to-R1–R7 table and exact command outcomes. State explicitly: no plugin version bump, release, publication, Community submission, LM Studio, Claude backend, or alternate backend was added.

- [ ] Step 5: Run the bounded result gate.

```bash
$check-chain result docs/superpowers/plans/2026-08-24-reviewer-parity-remediation.md
```

Expected: `OK` for the approved plan/result pair. If `needs_work`, remain in result reconciliation, fix the reported evidence gap, and rerun with a changed strategy.

- [ ] Step 6: Commit result evidence only after the result gate passes.

```bash
git add docs/superpowers/results/2026-08-24-reviewer-parity-remediation-result.md
git commit -m "docs(result): reconcile reviewer parity remediation"
```

- [ ] Step 7: Use `superpowers:finishing-a-development-branch` and `git-workflow` for final branch checks, push, and PR. Do not merge or publish a release without a separate user instruction.
