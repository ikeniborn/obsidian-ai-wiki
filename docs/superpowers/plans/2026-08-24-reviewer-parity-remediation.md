---
review:
  plan_hash: 9090e503b885e7d2
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

**Goal:** Make the current official Obsidian source lint and active reviewer-surface scan fail closed with zero warnings, then deliver the verified remediation as release `0.3.6` without changing published `0.3.5` history.

**Architecture:** Keep two reviewer gates: official typed ESLint for `src/**/*.ts`, plus path-scoped release validation for active executable and shipped artifacts. Add a fail-closed release-history boundary that preserves `versions.json["0.3.5"] = "1.7.2"`, synchronizes package and manifest metadata at `0.3.6`/Obsidian `1.13.0`, and permits the existing workflow to publish only the verified pull-request merge revision.

**Tech Stack:** TypeScript, Obsidian API 1.13, ESLint 9, `eslint-plugin-obsidianmd@0.4.1`, Node test runner, esbuild, npm, GitHub Actions, GitHub CLI, iwiki MCP.

---

## Constraints and requirement map

- R1: Tasks 1 and 7 establish the exact official lint dependency, config, scope, and zero-warning threshold.
- R2: Tasks 2, 3, 5, 6, and 7 resolve every current source finding without suppressions or contract drift.
- R3: Tasks 8, 9, and 11 add and prove active-surface marker validation with explicit exceptions.
- R4: Task 9 removes the orphan Claude probe and reproducibly rebuilds and executes the retained mobile eval.
- R5: Tasks 3, 4, 5, and 11 preserve OpenAI-only loading, safe legacy settings, guarded desktop behavior, `isDesktopOnly: false`, and the Obsidian `1.13.0` minimum for `0.3.6`.
- R6: Tasks 4 and 11 preserve published `0.3.5`/`1.7.2` history and synchronize package, lockfile, source, root, distribution, and compatibility metadata at `0.3.6`.
- R7: Tasks 4, 7, 8, 9, and 11 prove every gate, merge only the verified pull request, and monitor the existing workflow through tag/release `0.3.6` with the exact flat assets.
- R8: Tasks 10 and 11 update current repository/iwiki guidance, reconcile every changed path, and keep Community directory submission and metadata outside delivery.

Every numbered step inherits its task's `Closes` mapping. Every edit step's DoD is the immediately following verification step. Every commit step must exit zero and `git show --stat --oneline HEAD` must list only that task's declared files.

### Task 1: Pin official lint dependency and expose the zero-warning contract

**Closes:** R1 official lint dependency, config, scope, and warning threshold.

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

- [ ] Step 5: Run the contract test and capture the intentionally failing official baseline.

```bash
node --import tsx --test tests/obsidian-review-compliance.test.ts
npm run lint
```

Expected: contract test passes; lint fails with the known remediation inventory rather than a config error. This is diagnostic inventory, not a passing strict lint gate.

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
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `tests/settings-definitions.test.ts`
- Modify: `tests/settings-model-controls.test.ts`

- [ ] Step 1: Add source-contract tests for the supported API and preserved settings surface.

Assert in `tests/settings-definitions.test.ts` that `LlmWikiSettingTab` implements `getSettingDefinitions(): SettingDefinitionItem[]`, imports `SettingDefinitionItem`, and contains no `display(): void` or `this.display()`. Assert `src/main.ts` refreshes with `this.settingTab?.update()`. Read `package.json` and `package-lock.json`, then assert:

```ts
assert.equal(packageJson.devDependencies.obsidian, "1.13.1");
assert.equal(packageLock.packages["node_modules/obsidian"].version, "1.13.1");
```

Keep the existing settings layout assertions in `tests/settings-model-controls.test.ts`; replace its assertion that forbids rerender during typing so it now forbids `this.update()` in the live per-character budget callback.

- [ ] Step 2: Run focused settings tests and confirm the new API assertions fail.

```bash
node --import tsx --test tests/settings-definitions.test.ts tests/settings-model-controls.test.ts
```

Expected: non-zero exit because the tab still implements and calls `display()`; the dependency assertions also fail if the Obsidian API is not already pinned exactly.

- [ ] Step 3: Pin the exact Obsidian API used by the migration.

```bash
npm install --save-dev --save-exact obsidian@1.13.1
```

Expected: `package.json` records `"obsidian": "1.13.1"`; the lockfile resolves `node_modules/obsidian` to `1.13.1`.

- [ ] Step 4: Convert existing setting rows into Setting Definition items without changing callback bodies.

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

- [ ] Step 5: Load cached domain/local state asynchronously, then invoke the supported refresh.

Keep `refresh()` responsible only for loading `cachedDomains` and `localCache`; end it with `this.update()`. Start it when the tab is created or first indexed, without persisting settings. Replace all structural `this.display()` calls with `this.update()` and `src/main.ts` busy refresh with `this.settingTab?.update()`.

- [ ] Step 6: Run focused settings and legacy-loading tests.

```bash
node --import tsx --test tests/settings-definitions.test.ts tests/settings-model-controls.test.ts tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts
```

Expected: zero exit; dependency, controls, and order assertions pass; legacy Claude-shaped fields remain ignored and loading causes no migration write.

- [ ] Step 7: Capture the intentionally failing post-migration lint inventory.

```bash
npm run lint
```

Expected: non-zero exit, with no `prefer-setting-definitions` or deprecated `display` finding. The compatibility findings are exactly 13 `obsidianmd/no-unsupported-api` errors plus one `obsidianmd/settings-tab/require-display` warning, all assigned to immediate Task 4. The two environment findings are `no-undef` warnings at `src/native-openai-transport.ts:13` for `NodeJS` and `src/view.ts:1640` for `require`, both assigned to Task 5. Remaining sentence-case or deprecated-control findings are listed and assigned to Task 6. Any other rule or path blocks this commit. This step is a diagnostic inventory, not a strict lint gate.

- [ ] Step 8: Commit the API migration and exact API pin.

```bash
git add package.json package-lock.json src/settings.ts src/main.ts tests/settings-definitions.test.ts tests/settings-model-controls.test.ts
git commit -m "refactor(settings): adopt Obsidian setting definitions"
```

### Task 4: Create immutable `0.3.5` history and synchronized `0.3.6` metadata

**Closes:** R5 minimum/mobile metadata, R6 version-history synchronization, and the metadata boundary required by R7.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/manifest.json`
- Generated by build: `manifest.json`
- Generated by build: `dist/main.js`
- Generated by build: `dist/manifest.json`
- Modify: `versions.json`
- Modify: `scripts/validate-release.mjs`
- Modify: `.github/workflows/release.yml`
- Modify: `tests/release-validation.test.ts`

- [ ] Step 1: Add failing fixture, repository, monotonic-version, and workflow contracts.

Set generic fixture `VERSION` to `0.4.0`: above protected `0.3.5`, but independent from repository target `0.3.6`. Add `versions.json` to each valid fixture with historical `0.3.5` fixed at `1.7.2` and `0.4.0` mapped to the fixture manifest minimum. Add negative fixtures proving prebuild validation rejects: changed historical mapping; current version `0.3.4` below protected `0.3.5`; current version equal to protected `0.3.5`; current mapping missing/mismatched; and a current `0.3.6` package/manifest when `versions.json` also contains a higher `0.3.7` SemVer key. Keep every negative fixture internally synchronized except for the single invariant named by its test, so each expected diagnostic is isolated. Replace the current repository compatibility assertions with exact package, lockfile, manifest, and history assertions:

```ts
assert.equal(packageJson.version, "0.3.6");
assert.equal(packageLock.version, "0.3.6");
assert.equal(packageLock.packages[""].version, "0.3.6");
assert.equal(sourceManifest.version, "0.3.6");
assert.equal(rootManifest.version, "0.3.6");
assert.equal(distManifest.version, "0.3.6");
assert.equal(sourceManifest.minAppVersion, "1.13.0");
assert.equal(sourceManifest.isDesktopOnly, false);
assert.deepEqual(rootManifest, sourceManifest);
assert.deepEqual(distManifest, sourceManifest);
assert.equal(versionsJson["0.3.5"], "1.7.2");
assert.equal(versionsJson["0.3.6"], "1.13.0");
```

Extend the existing release-workflow test so it asserts:

```ts
assert.deepEqual(workflow.on, {
  push: { branches: ["master"], paths: ["src/manifest.json"] },
});
assert.equal(workflow.on.workflow_dispatch, undefined);
assert.ok(tagGuardIndex > readVersionIndex);
assert.ok(tagGuardIndex < releaseIndex);
assert.match(String(steps[tagGuardIndex].run), /refs\/tags\/\$version/);
assert.equal(release?.with?.overwrite_files, false);
```

The test must identify a named `Reject existing release tag` shell step. Execute its extracted command in a temporary `PATH` with a fake `git`: when fake `git ls-remote` exits `0` for an existing tag, assert guard status `1` and stderr/stdout contains `refusing overwrite`; when fake Git exits `2` for no matching tag, assert guard status `0`. Replace the GitHub version expression with fixture version `0.4.0` only in this shell-contract harness. With the workflow's only trigger fixed to the filtered `master` push, the release action has no pull-request, manual-dispatch, or non-master entry point.

- [ ] Step 2: Run the focused tests and confirm both missing validator behavior and stale repository metadata fail.

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: non-zero exit. The old validator accepts regressed/equal-protected/highest-key mismatches; repository assertions report package/manifests at `0.3.5`, changed `versions.json["0.3.5"]`, and missing `versions.json["0.3.6"]`; workflow assertions report the obsolete `workflow_dispatch`, missing tag guard, and missing `overwrite_files: false`.

- [ ] Step 3: Make release validation and workflow publication fail closed.

Read `versions.json` during prebuild. Parse release keys as numeric `major.minor.patch` tuples. Require `versionsJson["0.3.5"] === "1.7.2"`; require package version to be strictly greater than `0.3.5`; require it to equal the highest SemVer key in `versions.json`; require its mapping to equal `src/manifest.json.minAppVersion`; retain existing package/lockfile/manifest equality checks. Report offending path and values, for example:

```text
[versions.json] 0.3.5 must remain mapped to 1.7.2
[package.json] release version 0.3.5 must be greater than protected version 0.3.5
[versions.json] highest release key 0.3.7 must equal package.json version 0.3.6
[versions.json] 0.3.6 must map to src/manifest.json minAppVersion 1.13.0
```

In `.github/workflows/release.yml`, delete `workflow_dispatch` and its manual-retry commentary so the filtered `master` push is the only trigger. Move `Read version` before attestation/publication, then add this guard immediately after it:

```yaml
- name: Reject existing release tag
  run: |
    version="${{ steps.version.outputs.version }}"
    if git ls-remote --exit-code --tags origin "refs/tags/$version"; then
      echo "Release tag $version already exists; refusing overwrite."
      exit 1
    fi
```

Keep the guard after every lint/typecheck/test/build/validator gate and before attestation/release. Set `overwrite_files: false` on `softprops/action-gh-release@v2`. Do not add another trigger, job, or publication action.

Run the focused tests again. Expected: all negative version fixtures pass by observing validator exit `1`; workflow contracts pass; repository synchronization remains the only failure because release files have not been bumped yet.

```bash
node --import tsx --test tests/release-validation.test.ts
```

- [ ] Step 4: Bump package and source metadata, restore historical mapping, and build every generated release file.

Set `package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version` to `0.3.6` without changing dependencies or creating a Git tag. Set `src/manifest.json` to version `0.3.6`, `minAppVersion: "1.13.0"`, and `isDesktopOnly: false`. Restore `versions.json["0.3.5"]` to `"1.7.2"`; do not delete or rewrite any older key. Then generate root/distribution metadata and bundle from source:


```bash
npm run build
```

Expected: build exits zero; `manifest.json` and `dist/manifest.json` are generated from `src/manifest.json`; `dist/main.js` is rebuilt; package, both lockfile root records, and all manifests declare `0.3.6`; all manifests declare `minAppVersion: 1.13.0` and `isDesktopOnly: false`; `versions.json["0.3.5"]` remains `1.7.2` and build appends `versions.json["0.3.6"] = "1.13.0"`.

- [ ] Step 5: Prove historical immutability, synchronization, mobile availability, and the expected remaining lint inventory.

```bash
node --import tsx --test tests/release-validation.test.ts tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts
npm run release:validate:pre
npm run release:validate:post
npm run lint
```

Expected: focused tests and both release validators exit zero; fixtures prove `0.3.5` cannot change, current version is strictly newer and highest, metadata cannot drift, manual dispatch is absent, existing tags block publication, the guard precedes release, and asset overwrite is disabled. All 13 `no-unsupported-api` errors and the `require-display` warning from Task 3 are absent. Lint remains non-zero only for the two `no-undef` warnings assigned to Task 5 plus sentence-case/deprecated-control findings assigned to Task 6. Any version, workflow, compatibility, mobile, legacy-load, or unrelated finding blocks this commit.

- [ ] Step 6: Stage exactly the Task 4 source, test, and generated paths; reject cross-task staging.

```bash
git add package.json package-lock.json src/manifest.json manifest.json dist/main.js dist/manifest.json versions.json scripts/validate-release.mjs .github/workflows/release.yml tests/release-validation.test.ts
git diff --cached --check
git diff --cached --name-only
```

Expected: check exits zero. Staged names are exactly `package.json`, `package-lock.json`, `src/manifest.json`, `manifest.json`, `dist/main.js`, `dist/manifest.json`, `versions.json`, `scripts/validate-release.mjs`, `.github/workflows/release.yml`, and `tests/release-validation.test.ts`; no Task 5+ path or unrelated pre-existing change is staged.

- [ ] Step 7: Commit the new release record before any passing strict lint gate.

```bash
git commit -m "build(release): prepare version 0.3.6"
```

Expected: commit succeeds and contains only Step 6's exact staged paths. It creates no tag and publishes nothing.

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

- [ ] Step 4: Run focused tests, strict transport lint, and the post-fix view inventory.

```bash
node --import tsx --test tests/okf-export-desktop-guard.test.ts tests/native-openai-transport.test.ts
npx eslint src/native-openai-transport.ts --max-warnings 0
npx eslint src/view.ts --max-warnings 0
```

Expected: tests and transport lint exit zero; guard assertions pass. The `view.ts` inventory exits non-zero only for sentence-case or deprecated-control findings assigned to Task 6; its `no-undef` warning for `require` and any Node-module finding are absent. Any other rule or path blocks this commit. The final command is diagnostic inventory, not a strict lint gate.

- [ ] Step 5: Commit environment corrections.

```bash
git add src/native-openai-transport.ts src/view.ts tests/okf-export-desktop-guard.test.ts tests/native-openai-transport.test.ts
git commit -m "fix(runtime): keep desktop APIs behind mobile guards"
```

### Task 6: Replace deprecated controls and fix reviewer-facing sentence case

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

Expected: both commands exit zero; Task 5 has already removed the `view.ts` environment-global finding, and no deprecated UI API or sentence-case finding remains.

- [ ] Step 5: Commit the UI corrections.

```bash
git add src/settings.ts src/modals.ts src/main.ts src/view.ts tests/ui-review-compliance.test.ts tests/settings-model-controls.test.ts tests/view-llm-lifecycle.test.ts
git commit -m "fix(ui): replace deprecated Obsidian controls"
```

Before committing, inspect `git diff --cached --name-only`; unstage any test file not directly changed by this task.

### Task 7: Close the complete official source lint gate

**Closes:** R1 zero-warning proof and final R2 rule-driven source closure.

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

### Task 8: Add a path-scoped active reviewer-surface scan

**Closes:** R3 active-surface detection and the R7 negative reviewer fixture.

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

Expected: tests pass; current prebuild fails only on the known stale eval artifacts until Task 9.

- [ ] Step 5: Commit the scanner and fixtures.

```bash
git add scripts/validate-release.mjs tests/release-validation.test.ts
git commit -m "test(release): scan active reviewer surfaces"
```

### Task 9: Remove stale Claude eval output and rebuild the retained mobile eval

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

### Task 10: Document current reviewer and release gates

**Closes:** Repository portion of R8 documentation and Community boundary.

**Files:**

- Modify: `README.md`
- Modify: `docs/README.ru.md`

- [ ] Step 1: Inspect the implemented gate commands, scanner scope/exceptions, and retained eval workflow from Tasks 1–9. Map the English and Russian README development sections to the same current contracts; do not edit historical intent, spec, plan, or result artifacts.

- [ ] Step 2: Update current docs with exact contracts: Obsidian 1.13+, Setting Definitions, lint scope and zero-warning threshold, active-surface paths/exceptions, mobile eval rebuild command, immutable `0.3.5`/`1.7.2` history, synchronized `0.3.6` metadata, and merge-triggered automatic release. State that Community plugin-directory submission and metadata remain excluded. Document implemented behavior only; do not mutate or resynchronize compatibility metadata in this task.

- [ ] Step 3: Run current release, legacy-load, mobile-guard, and eval checks after the documentation edit.

```bash
node --import tsx --test tests/release-validation.test.ts tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts tests/okf-export-desktop-guard.test.ts
npm run release:validate:pre
npm run release:validate:post
node eval/mobile-fixes/run.cjs
```

Expected: all commands exit zero; documented gates match executable commands; no settings write occurs during legacy load; manifests remain mobile-capable; retained eval passes.

- [ ] Step 4: Commit only current documentation.

```bash
git add README.md docs/README.ru.md
git commit -m "docs(release): describe reviewer parity gates"
```

Before committing, inspect staged paths and remove any historical or unrelated document.

### Task 11: Reconcile the verified result and deliver release `0.3.6` from the merged pull request

**Closes:** Final evidence for R1–R8, including immutable `0.3.5`, merge-only publication, automatic release `0.3.6`, and the Community boundary.

**Files:**

- Modify through iwiki MCP: `obsidian-ai-wiki` reviewer/release guidance page selected after `wiki_search`
- Create after execution: `docs/superpowers/results/2026-08-24-reviewer-parity-remediation-result.md`
- Update through iwiki MCP: `reference/tasks/reviewer-parity-remediation` and active history segment
- External delivery through existing mechanisms only: remediation pull request and `.github/workflows/release.yml` run

- [ ] Step 1: Start from a clean branch and run complete release-candidate verification in enforced order.

```bash
git fetch origin master
git status --short
npm ci
npm run lint
npm run typecheck
npm test
npm run release:validate:pre
npm run build
npm run release:validate:post
node eval/mobile-fixes/run.cjs
git diff --check origin/master...HEAD
git diff --exit-code
git status --short
```

Expected: both status commands print nothing; every command exits zero; lint has zero warnings; tests have zero failures; prebuild/postbuild validators pass; production build leaves tracked generated files unchanged; retained mobile eval passes; branch diff has no whitespace error.

- [ ] Step 2: Prove active-surface cleanliness, exact `0.3.6` synchronization, and local `0.3.5` history preservation.

```bash
rg -n -i 'claude code|claude-agent|ClaudeCliClient|iclaudePath|claudePath|child_process|spawn\(' src eval scripts dist/main.js
git diff origin/master...HEAD -- package.json package-lock.json src/manifest.json manifest.json dist/manifest.json versions.json
node -e 'const fs=require("node:fs"); const pkg=require("./package.json"); const lock=require("./package-lock.json"); const source=require("./src/manifest.json"); const root=require("./manifest.json"); const dist=require("./dist/manifest.json"); const versions=require("./versions.json"); if (![pkg.version,lock.version,lock.packages[""].version,source.version,root.version,dist.version].every(v=>v==="0.3.6")) throw new Error("0.3.6 version drift"); if (![source,root,dist].every(m=>m.minAppVersion==="1.13.0"&&m.isDesktopOnly===false)) throw new Error("manifest compatibility drift"); if (versions["0.3.5"]!=="1.7.2"||versions["0.3.6"]!=="1.13.0") throw new Error("versions.json history drift");'
```

Expected: scan output is limited to the validator's tested pattern declarations and explicit excluded instruction evidence; no active source, eval, script, or distribution violation appears. Diff and assertion show package, both lockfile root fields, source/root/dist manifests at `0.3.6`; every manifest has `minAppVersion: 1.13.0` and `isDesktopOnly: false`; `versions.json["0.3.5"]` remains `1.7.2`; `versions.json["0.3.6"]` is `1.13.0`; no backend is added.

- [ ] Step 3: Capture the existing published `0.3.5` boundary before delivery.

```bash
history_dir="$(mktemp -d)"
gh release view 0.3.5 --json tagName,isDraft,isPrerelease,assets,url
gh release download 0.3.5 --dir "$history_dir" --pattern manifest.json
node -e 'const fs=require("node:fs"); const p=process.argv[1]; const m=JSON.parse(fs.readFileSync(p,"utf8")); if(m.version!=="0.3.5"||m.minAppVersion!=="1.7.2") throw new Error("published 0.3.5 manifest drift");' "$history_dir/manifest.json"
git ls-remote --tags origin refs/tags/0.3.5
```

Expected: release/tag `0.3.5` exists, is neither draft nor prerelease, its published manifest still declares version `0.3.5` and minimum `1.7.2`, and no command mutates that release or tag. Record release URL, tag object ID, and asset metadata for post-release comparison.

- [ ] Step 4: Update current reviewer/release guidance in the bound iwiki domain before result reconciliation.

Read the target page immediately before mutation, pass its current PostgreSQL revision and protected section hash, update or insert the reviewer-gate section, then run `wiki_lint`. Record official lint version/scope, zero-warning rule, Obsidian `1.13.0` minimum for `0.3.6`, immutable `0.3.5`/`1.7.2` history, Setting Definitions, active surfaces/exceptions, eval policy, synchronized metadata checks, merge-only publication, and Community exclusion.

Expected: mutation succeeds, reindex is automatic, and task-page lint has no broken/stale/missing-source finding. Do not call Git-only `wiki_sync`.

- [ ] Step 5: Write and reconcile the verified pre-delivery result over the complete branch diff.

Create `docs/superpowers/results/2026-08-24-reviewer-parity-remediation-result.md` with a changed-path-to-R1–R8 table and exact Steps 1–3 command outcomes. State that implementation and release candidate are verified; package/manifests are `0.3.6`; published `0.3.5` and its `1.7.2` mapping remain unchanged; PR merge and automatic release are the remaining authorized delivery steps; no Community submission/directory metadata action occurred; and no Claude, LM Studio, or alternate backend was added.

Invoke the bounded result gate against the full committed branch plus uncommitted result artifact:

```text
$check-chain result docs/superpowers/plans/2026-08-24-reviewer-parity-remediation.md --since=origin/master
```

Expected: reconciliation maps every changed path and completed implementation outcome to R1–R8, reviews the full branch diff, writes current `result_check` frontmatter, and returns `OK` for PR delivery. It must not claim merge or release already occurred. If `needs_work`, fix the named evidence gap with a changed strategy, rerun affected verification, and do not push.

After `OK`, stage exactly the result artifact and plan frontmatter written by the gate:

```bash
git add docs/superpowers/plans/2026-08-24-reviewer-parity-remediation.md docs/superpowers/results/2026-08-24-reviewer-parity-remediation-result.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(result): reconcile reviewer parity remediation"
git status --short
```

Expected: staged paths are exactly the plan and result artifact; commit succeeds; final status is clean. Task lifecycle remains `completion-pending` until PR/release delivery evidence is durable.

- [ ] Step 6: Use `superpowers:finishing-a-development-branch` and `git-workflow` to push the task branch and open the remediation pull request against `master`.

```bash
git push -u origin dev-reviewer-parity-remediation
pr_url="$(gh pr create --base master --head dev-reviewer-parity-remediation --title 'fix: remediate Obsidian reviewer parity' --body $'## Summary\n- adopt official zero-warning Obsidian lint contract\n- remove stale Claude reviewer surfaces\n- prepare immutable-history release 0.3.6\n\n## Verification\n- npm run lint\n- npm run typecheck\n- npm test\n- npm run release:validate:pre\n- npm run build\n- npm run release:validate:post\n- node eval/mobile-fixes/run.cjs')"
printf '%s\n' "$pr_url"
```

Expected: push targets only `dev-reviewer-parity-remediation`; PR URL is returned with base `master` and head `dev-reviewer-parity-remediation`. Do not push or merge directly to `master`.

- [ ] Step 7: Wait for every required PR check and merge only the verified pull request.

```bash
gh pr checks "$pr_url" --watch --fail-fast
gh pr view "$pr_url" --json mergeStateStatus,reviewDecision,statusCheckRollup
gh pr merge "$pr_url" --merge --delete-branch
gh pr view "$pr_url" --json state,mergedAt,mergeCommit,url
```

Expected: check watch exits zero; every required check is successful; merge state is clean and any required review is approved. Only then does PR merge succeed. Final view reports `state: MERGED` and a merge-commit OID. A failed/pending required check, blocked merge state, or missing required approval stops delivery; no direct `master` push is allowed.

- [ ] Step 8: Locate and monitor the existing automatic release workflow for the exact merge revision.

```bash
merge_sha="$(gh pr view "$pr_url" --json mergeCommit --jq '.mergeCommit.oid')"
run_id="$(gh run list --workflow Release --branch master --event push --limit 20 --json databaseId,headSha --jq ".[] | select(.headSha == \"$merge_sha\") | .databaseId" | head -n1)"
test -n "$run_id"
gh run view "$run_id" --json headSha,event,status,conclusion,url
gh run watch "$run_id" --exit-status
```

Expected: lookup identifies the `Release` workflow triggered by the merged `master` push, its `headSha` equals `merge_sha`, and watch exits zero only after all existing lint/typecheck/test/build/validator/attestation/publication steps pass. If the run is not visible yet, repeat only the read-only `gh run list` lookup; never dispatch a different revision.

- [ ] Step 9: Retry only a transient post-gate failure on the same merged revision.

On failure, inspect the failed run and its step conclusions:

```bash
gh run view "$run_id" --json headSha,jobs,url
gh run view "$run_id" --log-failed
```

Expected: `headSha` still equals `merge_sha`. If any lint, typecheck, test, build, prebuild/postbuild validator, active-surface, or asset gate failed, stop with `0.3.6` unpublished; do not retry publication. Only when every required gate passed and failure is transient in later attestation/publication may the same run be rerun:

```bash
test "$(gh run view "$run_id" --json headSha --jq '.headSha')" = "$merge_sha"
gh run rerun "$run_id"
gh run watch "$run_id" --exit-status
```

Expected: rerun targets the original merge-SHA run, retains `headSha == merge_sha`, re-executes all workflow gates, and exits zero. Do not dispatch another run, create an artificial version commit, or retry any different revision.

- [ ] Step 10: Verify tag/release `0.3.6`, exact revision, and flat assets; recheck `0.3.5` immutability.

```bash
git fetch origin refs/tags/0.3.6:refs/tags/0.3.6
test "$(git rev-list -n1 0.3.6)" = "$merge_sha"
gh release view 0.3.6 --json tagName,targetCommitish,isDraft,isPrerelease,assets,url
test "$(gh release view 0.3.6 --json assets --jq '[.assets[].name] | sort | join(",")')" = "main.js,manifest.json,styles.css"
release_dir="$(mktemp -d)"
gh release download 0.3.6 --dir "$release_dir" --pattern main.js --pattern manifest.json --pattern styles.css
find "$release_dir" -maxdepth 1 -type f -printf '%f\n' | sort
cmp "$release_dir/main.js" dist/main.js
cmp "$release_dir/manifest.json" dist/manifest.json
cmp "$release_dir/styles.css" dist/styles.css
node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(m.version!=="0.3.6"||m.minAppVersion!=="1.13.0"||m.isDesktopOnly!==false) throw new Error("published 0.3.6 manifest drift");' "$release_dir/manifest.json"
gh release view 0.3.5 --json tagName,isDraft,isPrerelease,assets,url
git ls-remote --tags origin refs/tags/0.3.5
```

Expected: tag `0.3.6` resolves to `merge_sha`; release is neither draft nor prerelease; asset list and download directory contain exactly flat `main.js`, `manifest.json`, and `styles.css`; downloaded bytes match the verified merged build; published manifest declares `0.3.6`, `1.13.0`, and mobile support. Recorded `0.3.5` release URL, tag object ID, and asset metadata match Step 3. No Community directory action occurs.

- [ ] Step 11: Record post-merge release evidence in current iwiki reviewer guidance and authoritative task history.

Read the reviewer guidance page, `reference/tasks/reviewer-parity-remediation`, and its active history segment immediately before compare-and-swap updates. Record PR URL, merge SHA, required-check outcome, release workflow URL, release/tag URL, exact flat asset names, verified `0.3.6` manifest, `0.3.5` before/after comparison, and Community exclusion. Rerun `wiki_lint`.

Expected: hosted writes succeed with current revisions/section hashes; lint has no broken/stale/missing-source finding; spool is empty. Any missing evidence keeps lifecycle `completion-pending`.

- [ ] Step 12: Close delivery only after every durable release condition is present.

Re-read the task page and active history segment. Transition `reference/tasks/reviewer-parity-remediation` to `done` only when the implementation PR is merged, required checks passed, workflow ran on `merge_sha`, release/tag `0.3.6` and exact assets are verified, `0.3.5` evidence is unchanged, result reconciliation is `OK`, spool is empty, and task-page `wiki_lint` is clean.

Expected: task ledger contains durable R1–R8 implementation and delivery evidence; lifecycle is `done`; no Community submission/metadata event exists. Any PR, workflow, release, asset, historical comparison, result, spool, or lint failure retains `completion-pending` and stops completion claims.
