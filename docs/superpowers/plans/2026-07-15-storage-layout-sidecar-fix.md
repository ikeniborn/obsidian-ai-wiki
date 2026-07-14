---
review:
  plan_hash: 4100bb76c56601fa
  last_run: 2026-07-15
  phases:
    - name: structure
      status: passed
    - name: coverage
      status: passed
    - name: dependencies
      status: passed
    - name: verifiability
      status: passed
    - name: consistency
      status: passed
  findings: []
chain:
  intent: n/a
  spec:
    path: docs/superpowers/specs/2026-07-14-storage-layout-sidecar-fix-design.md
    hash: 91558911fd8da774
---
# Storage-Layout Sidecar Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop fresh-domain `init` from aborting with `per-entity retrieval failed for all entities`, and stop orphaned empty `!Wiki/_config` folders from lingering.

**Architecture:** Introduce two shared path predicates in `wiki-path.ts` that correctly recognize the JSONL storage layout, apply them everywhere content pages are separated from meta files, make the retrieval `allFailed` guard fire only on a genuine embedding-infrastructure failure, and add a best-effort on-load cleanup that removes empty `_config` folders.

**Tech Stack:** TypeScript (strict), Obsidian plugin API, `node:test` + `node:assert/strict`, esbuild.

## Global Constraints

- Tests run with: `node --import tsx --test tests/<file>.test.ts` (there is no `npm test` script).
- Build with: `node esbuild.config.mjs production`. Lint with: `npm run lint`.
- No new runtime dependencies. Match existing code style (2-space indent, no semicolon omission).
- Code, comments, and commit messages in English.
- Do not change the JSONL schema, the embedding/reranker pipeline, or the migration data format.

---

### Task 1: Meta/sidecar path predicates + drop legacy whitelist

Adds the single source of truth for "is this a wiki content page or a service/meta file", and removes the now-invalid legacy `_config` article whitelist.

**Files:**
- Modify: `src/wiki-path.ts` (add predicates near line 17; edit `validateArticlePath` at lines 33-45)
- Test: `tests/wiki-path-meta.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `isDomainMetaPath(path: string): boolean` — true for `metadata.jsonl`, `index.jsonl`, `log.jsonl`, any path under a `/_config/` segment, and legacy `_index.md` / `_log.md`.
  - `isWikiPagePath(path: string): boolean` — true when `path` ends with `.md` and is not a meta path.

- [ ] **Step 1: Write the failing test**

Create `tests/wiki-path-meta.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { isDomainMetaPath, isWikiPagePath, validateArticlePath } from "../src/wiki-path";

test("isDomainMetaPath flags jsonl sidecars, _config, and legacy md meta", () => {
  assert.equal(isDomainMetaPath("!Wiki/os/metadata.jsonl"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/index.jsonl"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/log.jsonl"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/_config/_embeddings.json"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/_index.md"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/_log.md"), true);
  assert.equal(isDomainMetaPath("!Wiki/os/wiki_os_safari.md"), false);
});

test("isWikiPagePath accepts only content .md pages", () => {
  assert.equal(isWikiPagePath("!Wiki/os/wiki_os_safari.md"), true);
  assert.equal(isWikiPagePath("!Wiki/os/metadata.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/os/index.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/os/_index.md"), false);
  assert.equal(isWikiPagePath("!Wiki/os/_config/x.md"), false);
});

test("validateArticlePath rejects legacy _config service paths", () => {
  assert.equal(validateArticlePath("!Wiki/os/wiki_os_safari.md", "!Wiki/os"), true);
  assert.equal(validateArticlePath("!Wiki/os/_config/_index.md", "!Wiki/os"), false);
  assert.equal(validateArticlePath("!Wiki/os/metadata.jsonl", "!Wiki/os"), false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/wiki-path-meta.test.ts`
Expected: FAIL — `isDomainMetaPath`/`isWikiPagePath` are not exported.

- [ ] **Step 3: Add the predicates**

In `src/wiki-path.ts`, insert after the `isWikiArticlePath` function (after line 17):

```ts
/** Basenames of per-domain service files that are NOT wiki content pages. */
const DOMAIN_META_BASENAMES = new Set([
  "metadata.jsonl", "index.jsonl", "log.jsonl", // current JSONL layout
  "_index.md", "_log.md",                       // legacy markdown layout
]);

/** True if `path` is a domain service/meta file rather than a wiki content page. */
export function isDomainMetaPath(path: string): boolean {
  if (path.includes("/_config/")) return true;
  const base = path.split("/").pop() ?? path;
  return DOMAIN_META_BASENAMES.has(base);
}

/** True if `path` is a wiki content page (a `.md` file that is not a meta file). */
export function isWikiPagePath(path: string): boolean {
  return path.endsWith(".md") && !isDomainMetaPath(path);
}
```

- [ ] **Step 4: Drop the legacy `_config` whitelist in `validateArticlePath`**

In `src/wiki-path.ts`, replace the current `validateArticlePath` (lines 33-45) with:

```ts
export function validateArticlePath(path: string, wikiVaultPath: string): boolean {
  const prefix = `${wikiVaultPath}/`;
  if (!path.startsWith(prefix)) return false;
  const remainder = path.slice(prefix.length);
  // Reject old .config paths and any paths with .config
  if (remainder.includes(".config")) return false;
  const segments = remainder.split("/");
  return segments.length === 2 && segments[1].endsWith(".md");
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --import tsx --test tests/wiki-path-meta.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Run the existing wiki-path test to confirm no regression**

Run: `node --import tsx --test tests/wiki-path-jsonl.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Commit**

```bash
git add src/wiki-path.ts tests/wiki-path-meta.test.ts
git commit -m "feat(wiki-path): add sidecar/meta predicates, drop legacy _config whitelist"
```

---

### Task 2: Apply `isWikiPagePath` in ingest / query / lint / lint-chat

Replaces the four divergent stale filters (`_index.md`-only in ingest; `META_FILES = ["_index.md","_log.md"]` in query/lint/lint-chat) with the shared predicate. This is what actually stops `metadata.jsonl` from leaking into `nonMetaPaths` and tripping the guard.

**Files:**
- Modify: `src/phases/ingest.ts:19` (import), `src/phases/ingest.ts:123` (filter)
- Modify: `src/phases/query.ts:10` (import), `src/phases/query.ts:35` (remove `META_FILES`), `src/phases/query.ts:108-110` (filter)
- Modify: `src/phases/lint.ts:16` (import), `src/phases/lint.ts:29` (remove `META_FILES`), `src/phases/lint.ts:201` (filter)
- Modify: `src/phases/lint-chat.ts:13` (import), `src/phases/lint-chat.ts:19` (remove `META_FILES`), `src/phases/lint-chat.ts:46` (filter)

**Interfaces:**
- Consumes: `isWikiPagePath` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Edit `ingest.ts`**

Change the import at line 19 to add `isWikiPagePath`:

```ts
import { domainWikiFolder, validateArticlePath, domainIndexPath, isWikiPagePath } from "../wiki-path";
```

Change line 123 from:

```ts
  const nonMetaPaths = existingPaths.filter((f) => !f.endsWith("_index.md"));
```

to:

```ts
  const nonMetaPaths = existingPaths.filter(isWikiPagePath);
```

- [ ] **Step 2: Edit `query.ts`**

Change the import at line 10 to add `isWikiPagePath`:

```ts
import { domainWikiFolder, domainIndexPath, isWikiPagePath } from "../wiki-path";
```

Delete the `META_FILES` constant at line 35:

```ts
const META_FILES = ["_index.md", "_log.md"];
```

Change the filter at lines 108-110 from:

```ts
  const files = allFiles.filter(
    (f) => !META_FILES.some((m) => f.endsWith(m)) && !f.includes("/_config/"),
  );
```

to:

```ts
  const files = allFiles.filter(isWikiPagePath);
```

- [ ] **Step 3: Edit `lint.ts`**

Change the import at line 16 to add `isWikiPagePath`:

```ts
import { domainWikiFolder, domainIndexPath, WIKI_ROOT, isWikiPagePath } from "../wiki-path";
```

Delete the `META_FILES` constant at line 29:

```ts
const META_FILES = ["_index.md", "_log.md"];
```

Change the filter at line 201 from:

```ts
    const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
```

to:

```ts
    const files = allFiles.filter(isWikiPagePath);
```

- [ ] **Step 4: Edit `lint-chat.ts`**

Change the import at line 13 to add `isWikiPagePath`:

```ts
import { domainWikiFolder, isWikiPagePath } from "../wiki-path";
```

Delete the `META_FILES` constant at line 19:

```ts
const META_FILES = ["_index.md", "_log.md"];
```

Change the filter at line 46 from:

```ts
  const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
```

to:

```ts
  const files = allFiles.filter(isWikiPagePath);
```

- [ ] **Step 5: Verify no stale filters remain**

Run:

```bash
grep -rn 'META_FILES\|endsWith("_index.md")' src/phases/
```

Expected: no output (all four occurrences removed).

- [ ] **Step 6: Typecheck via build**

Run: `node esbuild.config.mjs production`
Expected: build completes with no TypeScript errors.

- [ ] **Step 7: Run the query index test to confirm no regression**

Run: `node --import tsx --test tests/query-jsonl-index.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/phases/ingest.ts src/phases/query.ts src/phases/lint.ts src/phases/lint-chat.ts
git commit -m "fix(phases): use isWikiPagePath so jsonl sidecars are not treated as pages"
```

---

### Task 3: Retrieval `allFailed` guard fires only on genuine failure

Redefines `allFailed` in `page-similarity.ts` so an empty or unrelated index is not treated as a retrieval failure. Only a thrown entity-vector embedding fetch (embeddings configured but the endpoint failed) sets `allFailed = true`.

**Files:**
- Modify: `src/page-similarity.ts:751-764` (`jaccardFallbackAll`), `src/page-similarity.ts:781-783` (embedding catch), `src/page-similarity.ts:819-840` (embedding normal completion)
- Test: `tests/page-similarity-guard.test.ts` (create)

**Interfaces:**
- Consumes: `PageSimilarityService`, `EntityRetrievalResult` (existing, unchanged shape).
- Produces: unchanged `selectByEntities(entities, indexAnnotations, allPaths): Promise<EntityRetrievalResult>` — new semantics for `allFailed`.

- [ ] **Step 1: Write the failing test**

Create `tests/page-similarity-guard.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { PageSimilarityService } from "../src/page-similarity";

test("selectByEntities: empty index is not a retrieval failure", async () => {
  const svc = new PageSimilarityService({ mode: "jaccard", topK: 2 });
  const { allFailed } = await svc.selectByEntities(
    [{ name: "Safari" }, { name: "macOS" }],
    new Map(),                       // no index annotations (fresh domain)
    ["!Wiki/os/wiki_os_safari.md"],  // a page exists on disk
  );
  assert.equal(allFailed, false);
});

test("selectByEntities: annotated pages with no overlap do not fail", async () => {
  const svc = new PageSimilarityService({ mode: "jaccard", topK: 2 });
  const { allFailed } = await svc.selectByEntities(
    [{ name: "Kubernetes" }],
    new Map([["wiki_os_safari", "safari proxy macos"]]), // unrelated annotation
    ["!Wiki/os/wiki_os_safari.md"],
  );
  assert.equal(allFailed, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/page-similarity-guard.test.ts`
Expected: FAIL — first test reports `allFailed` is `true` (current buggy behavior: pages exist but no annotations).

- [ ] **Step 3: Rewrite `jaccardFallbackAll`**

In `src/page-similarity.ts`, replace `jaccardFallbackAll` (lines 751-764) with:

```ts
  private jaccardFallbackAll(
    entities: ExtractedEntity[],
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): EntityRetrievalResult {
    const results = new Map<string, string[]>();
    for (const e of entities) {
      results.set(entityKey(e), this.scoreJaccardOnce(tokenize(entityQuery(e)), indexAnnotations, allPaths));
    }
    // Local scoring cannot fail; an empty result just means "no related pages".
    return { results, allFailed: false };
  }
```

- [ ] **Step 4: Signal genuine failure in the embedding catch**

In `src/page-similarity.ts`, change the entity-vector fetch catch (lines 781-783) from:

```ts
    } catch {
      return this.jaccardFallbackAll(entities, indexAnnotations, allPaths);
    }
```

to:

```ts
    } catch {
      // Embeddings are configured but the endpoint failed for the whole entity
      // set — a genuine infrastructure failure. Degrade to jaccard for results,
      // but signal the failure so ingest can abort with a clear message.
      return { ...this.jaccardFallbackAll(entities, indexAnnotations, allPaths), allFailed: true };
    }
```

- [ ] **Step 5: Drop the annotation-based success check in the embedding path**

In `src/page-similarity.ts`, in `selectByEntitiesEmbedding`, remove the `let anySuccess = false;` line (line 819) and the `if (indexAnnotations.size > 0) anySuccess = true;` line (line 837). Then change the final return (line 840) from:

```ts
    return { results, allFailed: allPaths.length > 0 && !anySuccess };
```

to:

```ts
    // Reaching here means entity vectors were fetched successfully; empty
    // per-entity results are normal, not a failure.
    return { results, allFailed: false };
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --import tsx --test tests/page-similarity-guard.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 7: Run existing similarity tests to confirm no regression**

Run: `node --import tsx --test tests/page-similarity-jsonl.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity-guard.test.ts
git commit -m "fix(page-similarity): allFailed only on genuine embedding failure, not empty index"
```

---

### Task 4: Remove orphaned empty `_config` folders on load

Adds a best-effort, idempotent cleanup that removes the empty global `!Wiki/_config` (the user's reported orphan) and any empty per-domain `!Wiki/<domain>/_config`, and wires it into plugin load after the migrations run.

**Files:**
- Modify: `src/storage-migration.ts` (add `removeEmptyConfigDirs` + `rmdirIfEmpty` helper)
- Modify: `src/main.ts:12` (import), `src/main.ts:42` (call after `migrateLogsToPluginDir`)
- Test: `tests/storage-config-cleanup.test.ts` (create)

**Interfaces:**
- Consumes: `WIKI_ROOT`, `GLOBAL_CONFIG_DIR` (already imported in `storage-migration.ts`).
- Produces: `removeEmptyConfigDirs(vault: Vault): Promise<void>`.

- [ ] **Step 1: Write the failing test**

Create `tests/storage-config-cleanup.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { removeEmptyConfigDirs } from "../src/storage-migration";

class FolderAdapter {
  files = new Set<string>();
  dirs = new Set<string>();
  async exists(p: string): Promise<boolean> { return this.files.has(p) || this.dirs.has(p); }
  async list(p: string): Promise<{ files: string[]; folders: string[] }> {
    const files: string[] = [];
    const folders: string[] = [];
    for (const f of this.files) if (f.slice(0, f.lastIndexOf("/")) === p) files.push(f);
    for (const d of this.dirs) if (d.slice(0, d.lastIndexOf("/")) === p) folders.push(d);
    return { files, folders };
  }
  async rmdir(p: string): Promise<void> { this.dirs.delete(p); }
}

function vault(a: FolderAdapter): any { return { adapter: a }; }

test("removeEmptyConfigDirs deletes empty global and per-domain _config, keeps content", async () => {
  const a = new FolderAdapter();
  a.dirs.add("!Wiki");
  a.dirs.add("!Wiki/_config");        // empty global orphan
  a.dirs.add("!Wiki/os");
  a.dirs.add("!Wiki/os/_config");     // empty per-domain orphan
  a.files.add("!Wiki/os/metadata.jsonl");
  a.files.add("!Wiki/os/wiki_os_safari.md");

  await removeEmptyConfigDirs(vault(a));

  assert.equal(await a.exists("!Wiki/_config"), false);
  assert.equal(await a.exists("!Wiki/os/_config"), false);
  assert.equal(await a.exists("!Wiki/os"), true);
  assert.equal(await a.exists("!Wiki/os/metadata.jsonl"), true);
});

test("removeEmptyConfigDirs keeps a non-empty _config", async () => {
  const a = new FolderAdapter();
  a.dirs.add("!Wiki");
  a.dirs.add("!Wiki/_config");
  a.files.add("!Wiki/_config/_domain.json");

  await removeEmptyConfigDirs(vault(a));

  assert.equal(await a.exists("!Wiki/_config"), true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/storage-config-cleanup.test.ts`
Expected: FAIL — `removeEmptyConfigDirs` is not exported.

- [ ] **Step 3: Implement the cleanup in `storage-migration.ts`**

In `src/storage-migration.ts`, append:

```ts
/**
 * Remove empty `_config` folders left behind by the storage migrations: the
 * global `!Wiki/_config` and each per-domain `!Wiki/<domain>/_config`. Runs
 * unconditionally on load; a no-op when the folders are absent or non-empty.
 * Best-effort — never throws.
 */
export async function removeEmptyConfigDirs(vault: Vault): Promise<void> {
  const adapter = vault.adapter;
  await rmdirIfEmpty(adapter, GLOBAL_CONFIG_DIR);
  try {
    const wiki = await adapter.list(WIKI_ROOT);
    for (const folder of wiki.folders) {
      await rmdirIfEmpty(adapter, `${folder}/_config`);
    }
  } catch { /* !Wiki absent — nothing to clean */ }
}

async function rmdirIfEmpty(adapter: Vault["adapter"], dir: string): Promise<void> {
  try {
    if (!(await adapter.exists(dir))) return;
    const listing = await adapter.list(dir);
    if (listing.files.length === 0 && listing.folders.length === 0) {
      await adapter.rmdir(dir, false).catch(() => { /* ignore */ });
    }
  } catch { /* best-effort */ }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/storage-config-cleanup.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire it into plugin load**

In `src/main.ts`, change the import at line 12 from:

```ts
import { runStorageMigration, cleanupBundledSchemaCopies, migrateLogsToPluginDir } from "./storage-migration";
```

to:

```ts
import { runStorageMigration, cleanupBundledSchemaCopies, migrateLogsToPluginDir, removeEmptyConfigDirs } from "./storage-migration";
```

Then add a call immediately after the `migrateLogsToPluginDir` line (line 42):

```ts
    await removeEmptyConfigDirs(this.app.vault);
```

- [ ] **Step 6: Typecheck via build**

Run: `node esbuild.config.mjs production`
Expected: build completes with no TypeScript errors.

- [ ] **Step 7: Commit**

```bash
git add src/storage-migration.ts src/main.ts tests/storage-config-cleanup.test.ts
git commit -m "fix(storage): remove empty global and per-domain _config folders on load"
```

---

### Task 5: Full regression run

Confirms the whole suite is green after all changes.

**Files:** none (verification only).

- [ ] **Step 1: Run the entire test suite**

Run:

```bash
node --import tsx --test tests/*.test.ts
```

Expected: all tests pass, `# fail 0`.

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 3: Build**

Run: `node esbuild.config.mjs production`
Expected: clean build.

- [ ] **Step 4: Commit (only if lint/build produced fixups)**

```bash
git add -A
git commit -m "chore: lint/build fixups for storage-layout sidecar fix"
```
