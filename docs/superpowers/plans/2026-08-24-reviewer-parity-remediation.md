---
review:
  plan_hash: 6473b7dba94bf604
  last_run: 2026-08-25
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
result_check:
  verdict: OK
  source: plan
  plan_hash: 6473b7dba94bf604
  last_run: 2026-08-25
  reviewed: true
  docs_checked: true
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
- R3: Tasks 8 and 9 add and close active-surface marker validation with explicit exceptions; Task 10a synchronizes the freshly scanned production bundle, and Task 11 proves the merged active surfaces remain clean.
- R4: Task 9 removes the orphan Claude probe and reproducibly rebuilds and executes the retained mobile eval.
- R5: Tasks 3, 4, 5, and 11 preserve OpenAI-only loading, safe legacy settings, guarded desktop behavior, `isDesktopOnly: false`, and the Obsidian `1.13.0` minimum for `0.3.6`.
- R6: Task 4 preserves published `0.3.5`/`1.7.2` history and synchronizes package, lockfile, source, root, distribution, and compatibility metadata at `0.3.6`; Task 10a synchronizes the production bundle after the later source changes; Task 11 proves all release metadata and artifacts remain exact.
- R7: Task 4 implements and fixture-tests the serialized create-only publisher; Tasks 7, 8, and 9 close its source, active-surface, and mobile-eval gates; Task 10a owns the fresh production bundle generated after those source remediations; Task 11 verifies the clean merged build, permits only a fail-closed same-run/SHA retry, and proves the exact published tag/assets/bytes.
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

### Task 4: Create immutable `0.3.5` history and a create-only `0.3.6` publisher

**Closes:** R5 minimum/mobile metadata, R6 version-history synchronization, and R7 serialized create-only publication.

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

- [ ] Step 1: Add failing metadata and create-only publisher contracts.

Keep generic validator fixture `VERSION = "0.4.0"`: it is above protected `0.3.5` but independent from repository target `0.3.6`. Add `versions.json` to each valid fixture with `0.3.5` fixed at `1.7.2` and `0.4.0` mapped to the fixture manifest minimum. Add isolated negative fixtures for: changed historical mapping; current version below or equal to protected `0.3.5`; missing/mismatched current mapping; current `0.3.6` below a `0.3.7` key; malformed `999.0`; and prerelease `999.0.0-beta`. The malformed-key fixtures must assert these exact diagnostics and no subsequent highest-key diagnostic:

```text
[versions.json] version key 999.0 must use exact x.y.z format
[versions.json] version key 999.0.0-beta must use exact x.y.z format
```

Replace the current repository compatibility assertions with exact package, lockfile, manifest, and history assertions:

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

Replace action-specific workflow assertions with an exact option-B contract. Parse `.github/workflows/release.yml` and assert:

```ts
assert.deepEqual(workflow.on, {
  push: { branches: ["master"], paths: ["src/manifest.json"] },
});
assert.deepEqual(workflow.concurrency, {
  group: "obsidian-ai-wiki-release",
  queue: "max",
  "cancel-in-progress": false,
});
assert.deepEqual(job.permissions, {
  contents: "write",
  attestations: "write",
  "id-token": "write",
});
```

Assert step order is `npm ci` → prebuild validation → zero-warning lint → typecheck → full tests → retained mobile eval → build → postbuild validation → tracked-generated diff → version read → local size/SHA-256 capture → provenance attestation → `Reconcile and publish create-only release`. The tracked diff command must be exactly fail closed over `dist/main.js`, `dist/manifest.json`, `dist/styles.css`, `manifest.json`, and `versions.json`. The digest step must record basename, byte count, and lowercase SHA-256 for the same three flat `dist` assets before attestation. The publication shell must receive `GH_TOKEN: ${{ github.token }}` and contain exactly one release mutation command:

```bash
gh release create "$version" dist/main.js dist/manifest.json dist/styles.css --verify-tag --target "$GITHUB_SHA" --title "$version" --generate-notes
```

Reject any `workflow_dispatch`, second job, variable concurrency group, cancellation, release edit/upload/delete, API write method, force push, clobber/recovery branch, or second `gh release create`. Assert the only tag mutation is `git push --porcelain origin "$GITHUB_SHA:refs/tags/$version"` and its output is accepted as a newly created claim only when the porcelain result contains the `*` new-ref status.

Add a deterministic harness that extracts the complete `Reconcile and publish create-only release` shell, substitutes only GitHub expression values that a runner resolves before execution, and runs it with fixture `dist` assets plus fake `gh` and `git` executables that append every call to an operation log. Set `GITHUB_REPOSITORY=owner/repo`, a fixed `GITHUB_SHA`, `GITHUB_RUN_ID`, `GITHUB_RUN_ATTEMPT`, `GH_TOKEN`, and `RUNNER_TEMP`. The fake `gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/releases?per_page=100"` must model all pages, including drafts; exact matching is only `tag_name === version`. The fake tag-ref response must expose `.object.type` and `.object.sha`; fake asset downloads must return fixture bytes.

Table-drive these states: absent release/tag; completed exact published release; draft; partial asset set; duplicate exact-tag releases; release-list API failure or malformed response; first-attempt existing exact tag; same-original-run rerun with the exact lightweight tag/SHA and a fresh empty release search; wrong tag SHA; annotated tag; lost tag-push acknowledgement; create failure; and post-create wrong, missing, extra, digest-mismatched, or byte-mismatched assets. Assert completed exact state exits zero without `git push` or `gh release create`; every preflight stop state performs no mutation; same-run exact-tag rerun reaches the one create command only after the fresh empty search; lost acknowledgement on the first attempt stops; create/postcondition failures perform no edit, upload, delete, second create, or cleanup. For the successful absent state, assert call order: initial paginated release list → one tag claim → create → fresh paginated release list → tag type/SHA query → three authenticated downloads. For every successful terminal state, assert exact three names, local/API SHA-256 digests, sizes, and downloaded bytes.

- [ ] Step 2: Run the focused tests and confirm both missing validator behavior and stale repository metadata fail.

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: non-zero exit. Validator/history assertions expose stale metadata. Workflow/harness assertions expose missing constant queue policy, gates, generated diff, local digest capture, authenticated paginated reconciliation, exact-state terminal success, atomic create-only tag ownership, single CLI create, and exact postconditions.

- [ ] Step 3: Make release metadata validation fail closed.

Read `versions.json` during prebuild. Before numeric comparison, reject every key that does not match the existing exact release pattern `x.y.z`; if any key is invalid, report each exact malformed key and do not compute a highest key from that object. Only after all keys pass, parse them as numeric `major.minor.patch` tuples. Require `versionsJson["0.3.5"] === "1.7.2"`; require package version to be strictly greater than `0.3.5`; require it to equal the highest SemVer key in `versions.json`; require its mapping to equal `src/manifest.json.minAppVersion`; retain existing package/lockfile/manifest equality checks. Report offending path and values, for example:

```text
[versions.json] 0.3.5 must remain mapped to 1.7.2
[versions.json] version key 999.0 must use exact x.y.z format
[versions.json] version key 999.0.0-beta must use exact x.y.z format
[package.json] release version 0.3.5 must be greater than protected version 0.3.5
[versions.json] highest release key 0.3.7 must equal package.json version 0.3.6
[versions.json] 0.3.6 must map to src/manifest.json minAppVersion 1.13.0
```

Run the focused tests again. Expected: historical, regressed, equal-protected, highest-mismatch, malformed-key, and prerelease-key fixtures observe validator exit `1` with isolated diagnostics. Repository synchronization and every not-yet-implemented workflow/harness assertion still fail.

```bash
node --import tsx --test tests/release-validation.test.ts
```

- [ ] Step 4: Implement the serialized create-only workflow and make the shell harness pass.

Keep only the filtered `master`/`src/manifest.json` push trigger and one `release` job. Add constant top-level concurrency:

```yaml
concurrency:
  group: obsidian-ai-wiki-release
  queue: max
  cancel-in-progress: false
```

Run every gate and build before mutation: `npm ci`, prebuild validation, lint, typecheck, full tests, `node eval/mobile-fixes/run.cjs`, production build, postbuild validation, and `git diff --exit-code -- dist/main.js dist/manifest.json dist/styles.css manifest.json versions.json`. Read the version; write the exact three local asset names, byte sizes, and SHA-256 digests to `$RUNNER_TEMP/release-assets.tsv`; then attest the same three paths with `actions/attest-build-provenance@v2`.

After attestation, implement one `Reconcile and publish create-only release` Bash step with `set -euo pipefail` and `GH_TOKEN: ${{ github.token }}`. Its read-only helpers must:

1. Call `gh api --paginate --slurp "repos/$GITHUB_REPOSITORY/releases?per_page=100"`, validate the response is an array of page arrays, flatten every draft and published record, and select only exact `tag_name == version` matches.
2. Treat zero matches as claimable state; treat more than one, any draft, any partial/wrong/extra asset state, malformed output, or API/authentication error as a stop.
3. Treat one published, non-draft, non-prerelease match as terminal success without mutation only after `gh api "repos/$GITHUB_REPOSITORY/git/ref/tags/$version"` proves `.object.type == "commit"` and `.object.sha == GITHUB_SHA`, and exact asset validation proves the three names, `sha256:<local digest>` fields, sizes, and authenticated downloaded bytes against `$RUNNER_TEMP/release-assets.tsv`.

With zero release matches, run exactly one non-force claim:

```bash
git push --porcelain origin "$GITHUB_SHA:refs/tags/$version"
```

Accept direct claim success only when porcelain reports a newly created ref (`*`), never an up-to-date (`=`) ref. On any failed/non-new claim, continue only when `GITHUB_RUN_ATTEMPT > 1`, the exact tag API reports lightweight type `commit` at `GITHUB_SHA`, and a new authenticated paginated release list still has zero exact matches. This is the only same-original-run rerun path; first-attempt existing tags, wrong SHA/type, ambiguity, and lost first-attempt acknowledgement stop.

After a new or permitted rerun claim, invoke the single exact `gh release create` command from Step 1. A create error stops as possible residue. Re-run release listing and exact tag/asset verification after create. Any postcondition mismatch stops without mutation, cleanup, retry, or repair. Do not add edit, upload, clobber, delete, force, or recovery commands.

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: workflow static contracts and every fake-CLI state pass. Mutation logs prove no command crosses a failed preflight or completed-exact terminal state; successful create order and final exact tag/asset/digest/byte postconditions pass.

- [ ] Step 5: Bump package and source metadata, restore historical mapping, and build every generated release file.

Set `package.json.version`, `package-lock.json.version`, and `package-lock.json.packages[""].version` to `0.3.6` without changing dependencies or creating a Git tag. Set `src/manifest.json` to version `0.3.6`, `minAppVersion: "1.13.0"`, and `isDesktopOnly: false`. Restore `versions.json["0.3.5"]` to `"1.7.2"`; do not delete or rewrite any older key. Then generate root/distribution metadata and bundle from source:


```bash
npm run build
```

Expected: build exits zero; `manifest.json` and `dist/manifest.json` are generated from `src/manifest.json`; `dist/main.js` is rebuilt; package, both lockfile root records, and all manifests declare `0.3.6`; all manifests declare `minAppVersion: 1.13.0` and `isDesktopOnly: false`; `versions.json["0.3.5"]` remains `1.7.2` and build appends `versions.json["0.3.6"] = "1.13.0"`.

- [ ] Step 6: Prove historical immutability, publisher fail-closure, mobile availability, and the expected remaining lint inventory.

```bash
node --import tsx --test tests/release-validation.test.ts tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts
npm run release:validate:pre
npm run release:validate:post
npm run lint
```

Expected: focused tests and both release validators exit zero. Fixtures prove immutable history, exact metadata, constant serialized queueing, all gates/diff/digests/attestation before mutation, authenticated paginated exact-tag discovery, strict tag ownership, single create-only publication, exact terminal/post-create state, and fail-closed stop behavior. All 13 `no-unsupported-api` errors and the `require-display` warning from Task 3 are absent. Lint remains non-zero only for the two `no-undef` warnings assigned to Task 5 plus sentence-case/deprecated-control findings assigned to Task 6. Any version, workflow, compatibility, mobile, legacy-load, publisher-state, or unrelated finding blocks this commit.

- [ ] Step 7: Stage exactly the Task 4 source, test, and generated paths; reject cross-task staging, then commit.

```bash
git add package.json package-lock.json src/manifest.json manifest.json dist/main.js dist/manifest.json versions.json scripts/validate-release.mjs .github/workflows/release.yml tests/release-validation.test.ts
git diff --cached --check
git diff --cached --name-only
```

Expected: check exits zero. Staged names are exactly `package.json`, `package-lock.json`, `src/manifest.json`, `manifest.json`, `dist/main.js`, `dist/manifest.json`, `versions.json`, `scripts/validate-release.mjs`, `.github/workflows/release.yml`, and `tests/release-validation.test.ts`; no Task 5+ path or unrelated pre-existing change is staged.

```bash
git commit -m "build(release): prepare version 0.3.6"
```

Expected: commit succeeds and contains only Step 7's exact staged paths. It creates no tag and publishes nothing.

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

### Task 10a: Synchronize generated production bundle

**Closes:** R3 fresh active-surface bundle, R6 synchronized production artifact, and R7 release-asset ownership.

Tasks 5 and 6 change production source after Task 4 builds `dist/main.js`. This task gives that later generated delta one explicit owner before Task 11 requires a clean release-candidate checkout.

**Files:**

- Modify generated: `dist/main.js`

- [ ] Step 1: Rebuild from the fully remediated source and postvalidate the generated release state.

```bash
npm run build
npm run release:validate:post
git diff --check
```

Expected: every command exits zero; the build incorporates the committed Tasks 5 and 6 source changes, and postbuild validation accepts the regenerated production bundle.

- [ ] Step 2: Prove the only generated delta is `dist/main.js`.

```bash
test "$(git status --short)" = " M dist/main.js"
test "$(git diff --name-only)" = "dist/main.js"
git diff --stat -- dist/main.js
```

Expected: both assertions exit zero; status and unstaged diff contain exactly `dist/main.js`, with no metadata, source, documentation, or unrelated generated path.

- [ ] Step 3: Stage exactly the regenerated production bundle and reject any other path.

```bash
git add dist/main.js
git diff --cached --check
test "$(git diff --cached --name-only)" = "dist/main.js"
test -z "$(git diff --name-only)"
```

Expected: staged diff is whitespace-clean and contains exactly `dist/main.js`; no unstaged path remains.

- [ ] Step 4: Commit the generated-artifact synchronization.

```bash
git commit -m "build(release): sync reviewer remediation bundle"
```

Expected: commit succeeds and contains only `dist/main.js`.

- [ ] Step 5: Rebuild once more and require byte-stable generated output and a clean checkout.

```bash
npm run build
npm run release:validate:post
git diff --exit-code -- dist/main.js dist/manifest.json dist/styles.css manifest.json versions.json
git diff --exit-code
git status --short
```

Expected: every command exits zero; both diffs are empty and final status prints nothing, proving the committed bundle is reproducible from the complete post-remediation source.

### Task 11: Reconcile the verified result and deliver create-only release `0.3.6`

**Closes:** Final R1–R8 evidence: clean full-checkout build, immutable `0.3.5`, verified PR merge, option-B publisher state, exact `0.3.6` tag/assets/digests/bytes, and Community exclusion.

**Depends on:** Tasks 1–10a complete, including Task 10a's committed, byte-stable `dist/main.js`; do not start release-candidate reconciliation from the pre-Tasks-5/6 Task 4 bundle.

**Files:**

- Modify through iwiki MCP: `obsidian-ai-wiki` reviewer/release guidance page selected after `wiki_search`
- Create after execution: `docs/superpowers/results/2026-08-24-reviewer-parity-remediation-result.md`
- Update through iwiki MCP: `reference/tasks/reviewer-parity-remediation` and active history segment
- External delivery through existing mechanisms only: remediation pull request and `.github/workflows/release.yml` run

- [ ] Step 1: Start from a clean branch and run the complete release-candidate verification in enforced order.

```bash
git fetch origin master
git status --short
npm ci
npm run lint
npm run typecheck
npm test
npm run release:validate:pre
node eval/mobile-fixes/run.cjs
npm run build
npm run release:validate:post
git diff --check origin/master...HEAD
git diff --exit-code -- dist/main.js dist/manifest.json dist/styles.css manifest.json versions.json
git diff --exit-code
git status --short
```

Expected: both status commands print nothing; every command exits zero; lint has zero warnings; tests have zero failures; validators and retained mobile eval pass; build leaves every tracked generated path unchanged; branch diff has no whitespace error.

- [ ] Step 2: Audit reproducible generated assets from a complete tracked checkout.

Create a detached temporary worktree at the committed candidate. Do not copy a partial source subset: the audit must include the repository's tracked `package-lock.json`, `tsconfig.json`, source tree, build config, validator, manifests, styles, and eval inputs.

```bash
set -e
audit_parent="$(mktemp -d)"
audit_root="$audit_parent/checkout"
cleanup_audit() { git worktree remove --force "$audit_root" >/dev/null 2>&1 || true; rmdir "$audit_parent" >/dev/null 2>&1 || true; }
trap cleanup_audit EXIT
git worktree add --detach "$audit_root" HEAD
(
set -e
cd "$audit_root"
test -f tsconfig.json
npm ci
npm run typecheck
npm run build
npm run release:validate:post
git diff --exit-code -- dist/main.js dist/manifest.json dist/styles.css manifest.json versions.json
)
trap - EXIT
cleanup_audit
```

Expected: clean full checkout uses the real TypeScript project and produces byte-identical tracked generated assets. Any build, validator, typecheck, or diff failure stops delivery; a partial copied fixture is not acceptable evidence.

- [ ] Step 3: Prove active-surface cleanliness and exact local metadata.

```bash
if rg -n -i 'claude code|claude-agent|ClaudeCliClient|iclaudePath|claudePath|child_process|spawn\(' src eval scripts dist/main.js --glob '!scripts/validate-release.mjs' --glob '!scripts/dspy/CLAUDE.md'; then echo 'forbidden active reviewer marker found' >&2; exit 1; fi
git diff origin/master...HEAD -- package.json package-lock.json src/manifest.json manifest.json dist/manifest.json versions.json
node -e 'const pkg=require("./package.json"); const lock=require("./package-lock.json"); const source=require("./src/manifest.json"); const root=require("./manifest.json"); const dist=require("./dist/manifest.json"); const versions=require("./versions.json"); if (![pkg.version,lock.version,lock.packages[""].version,source.version,root.version,dist.version].every(v=>v==="0.3.6")) throw new Error("0.3.6 version drift"); if (![source,root,dist].every(m=>m.minAppVersion==="1.13.0"&&m.isDesktopOnly===false)) throw new Error("manifest compatibility drift"); if (versions["0.3.5"]!=="1.7.2"||versions["0.3.6"]!=="1.13.0") throw new Error("versions.json history drift");'
```

Expected: marker command exits zero through its no-match branch; diff/assertion prove package, both lockfile root fields, source/root/dist manifests at `0.3.6`; every manifest has `minAppVersion: 1.13.0` and `isDesktopOnly: false`; historical/current mappings are exact; no backend was added.

- [ ] Step 4: Capture stable published `0.3.5` evidence before delivery without mutating it.

```bash
evidence_dir=".git/reviewer-parity-release-evidence"
mkdir -p "$evidence_dir/0.3.5-before"
gh release view 0.3.5 --json tagName,isDraft,isPrerelease,assets,url --jq '{tagName,isDraft,isPrerelease,url,assets:([.assets[]|{name,size,url}]|sort_by(.name))}' > "$evidence_dir/0.3.5-release-before.json"
gh api 'repos/{owner}/{repo}/git/ref/tags/0.3.5' --jq '.object|{sha,type}' > "$evidence_dir/0.3.5-tag-before.json"
jq -e '.tagName=="0.3.5" and .isDraft==false and .isPrerelease==false' "$evidence_dir/0.3.5-release-before.json"
gh release download 0.3.5 --dir "$evidence_dir/0.3.5-before" --pattern manifest.json
node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(m.version!=="0.3.5"||m.minAppVersion!=="1.7.2") throw new Error("published 0.3.5 manifest drift");' "$evidence_dir/0.3.5-before/manifest.json"
sha256sum "$evidence_dir/0.3.5-before/manifest.json" > "$evidence_dir/0.3.5-manifest-before.sha256"
```

Expected: authenticated release and tag reads succeed; `0.3.5` is published, its manifest remains `0.3.5`/`1.7.2`, and stable release asset metadata, tag object type/SHA, and manifest digest are retained for the after comparison. No command changes the tag or release.

- [ ] Step 5: Update current reviewer/release guidance in the bound iwiki domain before result reconciliation.

Read the target page immediately before mutation, pass its current PostgreSQL revision and protected section hash, update or insert the reviewer-gate section, then run `wiki_lint`. Record official lint version/scope, zero-warning rule, Obsidian `1.13.0` minimum for `0.3.6`, immutable `0.3.5`/`1.7.2` history, Setting Definitions, active surfaces/exceptions, eval policy, synchronized metadata checks, constant queue policy, authenticated fail-closed reconciliation, create-only mutation boundary, and Community exclusion.

Expected: mutation succeeds, reindex is automatic, and task-page lint has no broken/stale/missing-source finding. Do not call Git-only `wiki_sync`.

- [ ] Step 6: Write and reconcile the verified pre-delivery result over the complete branch diff.

Create `docs/superpowers/results/2026-08-24-reviewer-parity-remediation-result.md` with a changed-path-to-R1–R8 table and exact Steps 1–4 outcomes. State: implementation and clean candidate are verified; metadata is `0.3.6`; published `0.3.5` remains unchanged; PR merge and automatic option-B release remain; no Community directory action occurred; no alternate backend was added.

```text
$check-chain result docs/superpowers/plans/2026-08-24-reviewer-parity-remediation.md --since=origin/master
```

Expected: reconciliation reviews the full branch diff, maps every path/outcome to R1–R8, updates current `result_check` frontmatter, and returns `OK` for PR delivery without claiming merge/release. On `needs_work`, change strategy, close the named gap, rerun affected checks, and do not push.

After `OK`, stage exactly the gate-updated plan and result:

```bash
git add docs/superpowers/plans/2026-08-24-reviewer-parity-remediation.md docs/superpowers/results/2026-08-24-reviewer-parity-remediation-result.md
git diff --cached --check
git diff --cached --name-only
git commit -m "docs(result): reconcile reviewer parity remediation"
git status --short
```

Expected: staged names are exactly those two paths; commit succeeds; final status is clean. Lifecycle remains `completion-pending` until durable PR/release evidence exists.

- [ ] Step 7: Push only the task branch and open the remediation pull request against `master` through `superpowers:finishing-a-development-branch` and `git-workflow`.

```bash
git push -u origin dev-reviewer-parity-remediation
pr_url="$(gh pr create --base master --head dev-reviewer-parity-remediation --title 'fix: remediate Obsidian reviewer parity' --body $'## Summary\n- adopt official zero-warning Obsidian lint contract\n- remove stale Claude reviewer surfaces\n- prepare serialized create-only release 0.3.6\n\n## Verification\n- npm run lint\n- npm run typecheck\n- npm test\n- npm run release:validate:pre\n- node eval/mobile-fixes/run.cjs\n- npm run build\n- npm run release:validate:post\n- clean full-checkout generated-asset diff')"
printf '%s\n' "$pr_url"
```

Expected: push targets only `dev-reviewer-parity-remediation`; PR URL has base `master` and exact task head. Never push or merge directly to `master`.

- [ ] Step 8: Wait for every required PR check, then merge only that verified pull request.

```bash
gh pr checks "$pr_url" --watch --fail-fast
gh pr view "$pr_url" --json mergeStateStatus,reviewDecision,statusCheckRollup
gh pr merge "$pr_url" --merge --delete-branch
gh pr view "$pr_url" --json state,mergedAt,mergeCommit,url
```

Expected: checks are successful, merge state is clean, required review is approved, and final view reports `MERGED` plus merge commit OID. Any failed/pending check, blocked state, or missing approval stops delivery.

- [ ] Step 9: Locate and monitor the automatic release run for the exact merge revision.

```bash
merge_sha="$(gh pr view "$pr_url" --json mergeCommit --jq '.mergeCommit.oid')"
run_id="$(gh run list --workflow Release --branch master --event push --limit 20 --json databaseId,headSha --jq ".[] | select(.headSha == \"$merge_sha\") | .databaseId" | head -n1)"
test -n "$run_id"
test "$(gh run view "$run_id" --json headSha --jq '.headSha')" = "$merge_sha"
gh run view "$run_id" --json headSha,event,status,conclusion,url
gh run watch "$run_id" --exit-status
```

Expected: selected `Release` run is the merged `master` push at `merge_sha`. Successful watch means every gate, clean generated diff, digest capture, attestation, reconciliation, tag/release mutation if needed, and postcondition passed. If run lookup is initially empty, repeat only read-only list; never dispatch another revision.

- [ ] Step 10: On failure, permit only a same-run/SHA rerun whose read-only preflight is safe.

```bash
evidence_dir=".git/reviewer-parity-release-evidence"
test -d "$evidence_dir"
gh run view "$run_id" --json headSha,jobs,url
gh run view "$run_id" --log-failed
test "$(gh run view "$run_id" --json headSha --jq '.headSha')" = "$merge_sha"
gh api --paginate --slurp 'repos/{owner}/{repo}/releases?per_page=100' > "$evidence_dir/0.3.6-release-preflight-pages.json"
jq -e 'type=="array" and all(.[]; type=="array")' "$evidence_dir/0.3.6-release-preflight-pages.json"
jq --arg version '0.3.6' '[.[][]|select(.tag_name==$version)]' "$evidence_dir/0.3.6-release-preflight-pages.json" > "$evidence_dir/0.3.6-release-preflight-exact.json"
gh api 'repos/{owner}/{repo}/git/matching-refs/tags/0.3.6' > "$evidence_dir/0.3.6-tag-preflight.json"
```

Interpret with the same exact-state rules tested in Task 4. One complete exact release is success: do not rerun; continue to Step 11. Multiple matches, draft/prerelease, partial/wrong/extra assets, wrong/annotated tag, malformed/API-ambiguous state, or any run that attempted `gh release create` and returned an error stops for separate cleanup authorization. Do not delete, edit, upload, clobber, or repair residue.

Rerun is allowed only when all earlier lint/typecheck/test/eval/build/validator/diff/digest gates passed, `run_id` still has `headSha == merge_sha`, logs prove release creation was not attempted, exact release matches are empty, and exact tag state is either absent or one lightweight `commit` ref at `merge_sha`. This covers transient attestation failure, safe pre-create failure, or lost tag-push acknowledgement. Rerun only the same original run:

```bash
test "$(gh run view "$run_id" --json headSha --jq '.headSha')" = "$merge_sha"
gh run rerun "$run_id"
gh run watch "$run_id" --exit-status
```

Expected: rerun keeps original `run_id`/`merge_sha`, re-executes every gate, and relies on workflow preflight to allow only empty state or the exact same-run lightweight tag with a fresh empty release search. Any partial residue or create uncertainty remains stopped; cleanup requires separate authorization.

- [ ] Step 11: Rebuild the merged SHA from a full tracked checkout and verify exact published postconditions.

```bash
set -e
evidence_dir=".git/reviewer-parity-release-evidence"
test -d "$evidence_dir"
release_audit_parent="$(mktemp -d)"
release_audit_root="$release_audit_parent/checkout"
release_dir="$release_audit_parent/download"
mkdir -p "$release_dir"
cleanup_release_audit() { git worktree remove --force "$release_audit_root" >/dev/null 2>&1 || true; find "$release_dir" -mindepth 1 -delete >/dev/null 2>&1 || true; rmdir "$release_dir" >/dev/null 2>&1 || true; rmdir "$release_audit_parent" >/dev/null 2>&1 || true; }
trap cleanup_release_audit EXIT
git worktree add --detach "$release_audit_root" "$merge_sha"
(
set -e
cd "$release_audit_root"
test -f tsconfig.json
npm ci
npm run build
npm run release:validate:post
git diff --exit-code -- dist/main.js dist/manifest.json dist/styles.css manifest.json versions.json
)
gh api 'repos/{owner}/{repo}/git/ref/tags/0.3.6' > "$evidence_dir/0.3.6-tag-final.json"
jq --arg sha "$merge_sha" -e '.object.type=="commit" and .object.sha==$sha' "$evidence_dir/0.3.6-tag-final.json"
gh api --paginate --slurp 'repos/{owner}/{repo}/releases?per_page=100' > "$evidence_dir/0.3.6-release-final-pages.json"
jq --arg version '0.3.6' '[.[][]|select(.tag_name==$version)]' "$evidence_dir/0.3.6-release-final-pages.json" > "$evidence_dir/0.3.6-release-final.json"
jq -e 'length==1 and .[0].draft==false and .[0].prerelease==false and ([.[0].assets[].name]|sort)==["main.js","manifest.json","styles.css"]' "$evidence_dir/0.3.6-release-final.json"
for asset in main.js manifest.json styles.css; do local_path="$release_audit_root/dist/$asset"; local_size="$(stat -c %s "$local_path")"; local_digest="$(sha256sum "$local_path" | cut -d' ' -f1)"; jq --arg name "$asset" --arg digest "sha256:$local_digest" --argjson size "$local_size" -e '.[0].assets|map(select(.name==$name and .digest==$digest and .size==$size))|length==1' "$evidence_dir/0.3.6-release-final.json"; done
gh release download 0.3.6 --dir "$release_dir" --pattern main.js --pattern manifest.json --pattern styles.css
test "$(find "$release_dir" -maxdepth 1 -type f -printf '%f\n' | sort | paste -sd, -)" = "main.js,manifest.json,styles.css"
cmp "$release_dir/main.js" "$release_audit_root/dist/main.js"
cmp "$release_dir/manifest.json" "$release_audit_root/dist/manifest.json"
cmp "$release_dir/styles.css" "$release_audit_root/dist/styles.css"
node -e 'const fs=require("node:fs"); const m=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); if(m.version!=="0.3.6"||m.minAppVersion!=="1.13.0"||m.isDesktopOnly!==false) throw new Error("published 0.3.6 manifest drift");' "$release_dir/manifest.json"
gh release view 0.3.5 --json tagName,isDraft,isPrerelease,assets,url --jq '{tagName,isDraft,isPrerelease,url,assets:([.assets[]|{name,size,url}]|sort_by(.name))}' > "$evidence_dir/0.3.5-release-after.json"
gh api 'repos/{owner}/{repo}/git/ref/tags/0.3.5' --jq '.object|{sha,type}' > "$evidence_dir/0.3.5-tag-after.json"
cmp "$evidence_dir/0.3.5-release-before.json" "$evidence_dir/0.3.5-release-after.json"
cmp "$evidence_dir/0.3.5-tag-before.json" "$evidence_dir/0.3.5-tag-after.json"
trap - EXIT
cleanup_release_audit
```

Expected: clean merged checkout uses full tracked project/tsconfig and reproduces assets; tag is lightweight at `merge_sha`; exactly one published non-draft/non-prerelease release exists; its exact three API digests/sizes and downloaded bytes match the clean local files; manifest is `0.3.6`/`1.13.0`/mobile; stable `0.3.5` release/tag evidence is byte-identical to Step 4. No Community action occurs.

- [ ] Step 12: Record durable delivery evidence and close only when every boundary is proven.

Read reviewer guidance, `reference/tasks/reviewer-parity-remediation`, and active history immediately before compare-and-swap writes. Record PR URL, merge SHA, required checks, release run URL, whether publication was first-run, same-run rerun, or completed-exact terminal success, release/tag URL, tag type/SHA, exact assets/digests/bytes, clean full-checkout audit, unchanged `0.3.5`, result `OK`, and Community exclusion. Run `wiki_lint`; confirm spool empty. Transition task to `done` only after re-reading current task/history revisions and verifying every item.

Expected: task ledger contains durable R1–R8 implementation/delivery evidence and lifecycle `done`. Any PR, workflow, preflight, release, tag, asset, digest, byte, clean-build, historical comparison, result, spool, or lint gap retains `completion-pending`. Partial residue has no automatic cleanup; separate authorization is required.
