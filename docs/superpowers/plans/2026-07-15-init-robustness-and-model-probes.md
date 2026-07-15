---
review:
  plan_hash: 86ba8405b6a1625a
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
  spec: docs/superpowers/specs/2026-07-15-init-robustness-and-model-probes-design.md
---
# Init Robustness & Model Probes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make domain `init` fail loudly and diagnosably on embedding/bootstrap failures, route entity pages by type even when `wiki_subfolder` is empty, centralize the wiki-page filter, and add availability probes for the embedding and reranker models.

**Architecture:** Introduce one path helper (`effectiveSubfolder`) so every page-routing site produces a valid 2-segment path; centralize the "is content page" test on `isWikiPagePath`; make embedding failures throw a named `EmbeddingUnavailableError` that stops the whole init run once with the real endpoint error; make bootstrap failure stop init instead of silently continuing with empty types; surface real errors from the settings model probes and add a reranker probe. Design source: `docs/superpowers/specs/2026-07-15-init-robustness-and-model-probes-design.md`.

**Tech Stack:** TypeScript, Obsidian plugin API, esbuild bundle, `node:test` + `tsx` loader for tests.

## Global Constraints

- `validateArticlePath` (`src/wiki-path.ts`) keeps its strict 2-segment article-path rule — do NOT relax it.
- Docs, code comments, and commit messages in English; conventional-commit subjects.
- Tests run with: `node --import tsx --test tests/<file>.test.ts` (no `npm test` script exists).
- The obsidian test stub's `requestUrl` throws — network paths are tested via that throw or via injected transports, never a live endpoint.
- Rebuild the esbuild bundle (`node esbuild.config.mjs production`) and commit `dist/main.js` in the final task, matching repo convention.
- No separate embedding/rerank base URL — all channels keep using `nativeAgent.baseUrl`.

---

### Task 1: F2 — centralize the wiki-page filter on `isWikiPagePath`

**Files:**
- Modify: `src/phases/delete.ts:49`, `src/phases/delete.ts:133`
- Modify: `src/utils/tag-registry.ts:46` (+ import)
- Modify: `src/migrate-jsonl-domain-storage.ts:78`
- Test: `tests/page-filter-centralization.test.ts`

**Interfaces:**
- Consumes: `isWikiPagePath(path: string): boolean` from `src/wiki-path.ts` (already exported).
- Produces: nothing new; behavior change only (loose `_index.md`/`_log.md` and `.jsonl` sidecars excluded uniformly).

- [ ] **Step 1: Write the failing test**

Create `tests/page-filter-centralization.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { collectDomainTags } = await import("../src/utils/tag-registry");

test("collectDomainTags excludes loose _index.md meta pages", async () => {
  const vault = {
    listFiles: async (dir: string) =>
      dir === "!Wiki/d" ? ["!Wiki/d/page.md", "!Wiki/d/_index.md"] : [],
    readAll: async (paths: string[]) =>
      new Map(paths.map((p) => [
        p,
        p.endsWith("_index.md")
          ? "---\ntags:\n  - beta\n---\n"
          : "---\ntags:\n  - alpha\n---\n",
      ])),
    toVaultPath: () => null,
  };

  const registry = await collectDomainTags(vault, "!Wiki/d", []);

  assert.equal(registry.categories.has("alpha"), true);
  assert.equal(registry.categories.has("beta"), false); // _index.md must be skipped
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/page-filter-centralization.test.ts`
Expected: FAIL — `beta` present (inline filter includes loose `_index.md`).

- [ ] **Step 3: Implement — swap inline filters for `isWikiPagePath`**

In `src/utils/tag-registry.ts`, add to the top imports:

```ts
import { isWikiPagePath } from "../wiki-path";
```

Replace line 46:

```ts
      if (isWikiPagePath(f)) files.add(f);
```

In `src/phases/delete.ts` line 48-50, replace the filter:

```ts
  const pageFiles = (await vaultTools.listFiles(wikiFolder)).filter(isWikiPagePath);
```

and line 131-135 replace the filter inside the `remainingPageStems` set:

```ts
  const remainingPageStems = new Set(
    (await vaultTools.listFiles(wikiFolder))
      .filter(isWikiPagePath)
      .map((p) => pageId(p)),
  );
```

Add `isWikiPagePath` to the existing `../wiki-path` import in `src/phases/delete.ts` (line 5):

```ts
import { domainWikiFolder, validateArticlePath, isWikiPagePath } from "../wiki-path";
```

In `src/migrate-jsonl-domain-storage.ts`, add `isWikiPagePath` to the existing `./wiki-path` import block (near line 11-19), then replace line 78:

```ts
      if (isWikiPagePath(file)) out.push({ path: file, content: await adapter.read(file) });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/page-filter-centralization.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/phases/delete.ts src/utils/tag-registry.ts src/migrate-jsonl-domain-storage.ts tests/page-filter-centralization.test.ts
git commit -m "refactor(wiki-path): centralize page filter on isWikiPagePath (F2)"
```

---

### Task 2: F1 — `effectiveSubfolder` helper

**Files:**
- Modify: `src/wiki-path.ts` (add helper + type import)
- Test: `tests/effective-subfolder.test.ts`

**Interfaces:**
- Consumes: `sanitizeWikiSubfolder` (same file); `EntityType` from `src/domain.ts` (type-only).
- Produces: `effectiveSubfolder(et: EntityType): string` — returns `et.wiki_subfolder` when set, else the sanitized entity type name. Consumed by Tasks 3, 4, 5.

- [ ] **Step 1: Write the failing test**

Create `tests/effective-subfolder.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import { effectiveSubfolder } from "../src/wiki-path";

test("effectiveSubfolder returns wiki_subfolder when present", () => {
  assert.equal(
    effectiveSubfolder({ type: "Concept", description: "", extraction_cues: [], wiki_subfolder: "concepts" }),
    "concepts",
  );
});

test("effectiveSubfolder falls back to sanitized type name when empty", () => {
  assert.equal(
    effectiveSubfolder({ type: "Concept", description: "", extraction_cues: [], wiki_subfolder: "" }),
    "Concept",
  );
  assert.equal(
    effectiveSubfolder({ type: "Data Mart", description: "", extraction_cues: [] }),
    "Data Mart",
  );
});

test("effectiveSubfolder strips slashes from a type-name fallback", () => {
  assert.equal(
    effectiveSubfolder({ type: "a/b", description: "", extraction_cues: [], wiki_subfolder: "" }),
    "b",
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/effective-subfolder.test.ts`
Expected: FAIL — `effectiveSubfolder` is not exported.

- [ ] **Step 3: Implement the helper**

In `src/wiki-path.ts`, add a type import at the top:

```ts
import type { EntityType } from "./domain";
```

Add, immediately after `sanitizeWikiSubfolder` (after line 49):

```ts
/**
 * The subfolder an entity type's pages live under. Falls back to the sanitized
 * type name when `wiki_subfolder` is empty, so every type produces a valid
 * nested (2-segment) article path — never a flat one that validateArticlePath
 * would reject.
 */
export function effectiveSubfolder(et: EntityType): string {
  return et.wiki_subfolder || sanitizeWikiSubfolder(et.type);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/effective-subfolder.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/wiki-path.ts tests/effective-subfolder.test.ts
git commit -m "feat(wiki-path): add effectiveSubfolder fallback helper (F1)"
```

---

### Task 3: F1 — route `buildEntityTypesBlock` through `effectiveSubfolder`

**Files:**
- Modify: `src/phases/ingest.ts:764-778` (+ import)
- Test: `tests/entity-types-block-subfolder.test.ts`

**Interfaces:**
- Consumes: `effectiveSubfolder` (Task 2); `buildEntityTypesBlock(domain, wikiVaultPath)` (already exported).
- Produces: nested path template for every type, including empty-`wiki_subfolder` types.

- [ ] **Step 1: Write the failing test**

Create `tests/entity-types-block-subfolder.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { buildEntityTypesBlock } = await import("../src/phases/ingest");

test("empty wiki_subfolder yields a nested path template, not a flat one", () => {
  const block = buildEntityTypesBlock(
    {
      id: "os", name: "OS", wiki_folder: "os",
      entity_types: [{ type: "Concept", description: "d", extraction_cues: ["c"], wiki_subfolder: "" }],
    },
    "!Wiki/os",
  );
  assert.match(block, /!Wiki\/os\/Concept\/<EntityName>\.md/);
  assert.doesNotMatch(block, /!Wiki\/os\/<EntityName>\.md/);
});

test("explicit wiki_subfolder is preserved", () => {
  const block = buildEntityTypesBlock(
    {
      id: "os", name: "OS", wiki_folder: "os",
      entity_types: [{ type: "Concept", description: "d", extraction_cues: ["c"], wiki_subfolder: "concepts" }],
    },
    "!Wiki/os",
  );
  assert.match(block, /!Wiki\/os\/concepts\/<EntityName>\.md/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/entity-types-block-subfolder.test.ts`
Expected: FAIL — empty subfolder currently emits `!Wiki/os/<EntityName>.md`.

- [ ] **Step 3: Implement — route through `effectiveSubfolder`**

Add `effectiveSubfolder` to the existing `../wiki-path` import in `src/phases/ingest.ts` (line 19):

```ts
import { domainWikiFolder, validateArticlePath, domainIndexPath, isWikiPagePath, effectiveSubfolder } from "../wiki-path";
```

Replace `buildEntityTypesBlock` body (lines 764-779):

```ts
export function buildEntityTypesBlock(domain: DomainEntry, wikiVaultPath: string): string {
  if (!domain.entity_types?.length) return "";
  return domain.entity_types.map((et) => {
    const sub = effectiveSubfolder(et);
    return [
      `### Type: ${et.type}`,
      `Description: ${et.description}`,
      `Keywords: ${et.extraction_cues.join(", ")}`,
      et.min_mentions_for_page != null ? `Min. mentions for a page: ${et.min_mentions_for_page}` : "",
      `Wiki subfolder: ${sub}`,
      `Path for entities of this type: ${wikiVaultPath}/${sub}/<EntityName>.md`,
    ].filter(Boolean).join("\n");
  }).join("\n\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/entity-types-block-subfolder.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/phases/ingest.ts tests/entity-types-block-subfolder.test.ts
git commit -m "fix(ingest): always emit nested entity path via effectiveSubfolder (F1)"
```

---

### Task 4: F1 — route `ensureEntityTypeTag` through `effectiveSubfolder`

**Files:**
- Modify: `src/utils/tag-registry.ts:131` (+ import)
- Test: `tests/entity-type-tag-subfolder.test.ts`

**Interfaces:**
- Consumes: `effectiveSubfolder` (Task 2); `ensureEntityTypeTag(content, pagePath, domain)` (already exported).
- Produces: correct `subfolder → type` match for pages under the derived folder.

- [ ] **Step 1: Write the failing test**

Create `tests/entity-type-tag-subfolder.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { ensureEntityTypeTag } = await import("../src/utils/tag-registry");

test("page under the derived folder of an empty-subfolder type gets the type tag", () => {
  const domain = {
    id: "os", name: "OS", wiki_folder: "os",
    entity_types: [{ type: "Concept", description: "d", extraction_cues: ["c"], wiki_subfolder: "" }],
  };
  const content = "---\ntags: []\n---\nbody\n";
  const { added, tag } = ensureEntityTypeTag(content, "!Wiki/os/Concept/Foo.md", domain);
  assert.equal(added, true);
  assert.equal(tag, "concept");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/entity-type-tag-subfolder.test.ts`
Expected: FAIL — `find(e => e.wiki_subfolder === "Concept")` misses (stored subfolder is `""`).

- [ ] **Step 3: Implement — match on `effectiveSubfolder`**

Add to the imports in `src/utils/tag-registry.ts`:

```ts
import { isWikiPagePath, effectiveSubfolder } from "../wiki-path";
```

(merge with the `isWikiPagePath` import added in Task 1 — one import line).

Replace line 131:

```ts
  const et = domain.entity_types?.find((e) => effectiveSubfolder(e) === subfolder);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/entity-type-tag-subfolder.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/utils/tag-registry.ts tests/entity-type-tag-subfolder.test.ts
git commit -m "fix(tags): match entity type by effectiveSubfolder (F1)"
```

---

### Task 5: F1 — route lint counts, sidebar counters, and card display

**Files:**
- Modify: `src/phases/lint.ts:243`, `src/phases/lint.ts:509-518` (+ import)
- Modify: `src/main.ts:140-142` (+ import)
- Modify: `src/view.ts:408-410` (+ import)
- Modify: `src/modals.ts:533-535` (+ import)

**Interfaces:**
- Consumes: `effectiveSubfolder` (Task 2).
- Produces: empty-`wiki_subfolder` types are counted under their derived folder (no longer treated as 0 and removed).

> **Note:** these are Obsidian-UI / `runLint`-internal sites with no isolated unit seam. Verification is typecheck + lint + build + the manual check in Step 4. The routing logic itself is `effectiveSubfolder`, already covered by Task 2.

- [ ] **Step 1: Route `src/phases/lint.ts`**

Add `effectiveSubfolder` to lint's `../wiki-path` import (find the existing import line and append the name).

Replace the entity-type filter (lines 241-247):

```ts
    const filteredArticlePaths = entityTypeFilter.length > 0
      ? articlePaths.filter(p =>
          entityTypeFilter.some(et => {
            const found = domain.entity_types?.find(e => e.type === et);
            return found ? p.includes(`/${effectiveSubfolder(found)}/`) : false;
          })
        )
      : articlePaths;
```

Replace the empty-type cleanup loop body (lines 509-518):

```ts
    for (const et of effectiveEntityTypes) {
      const sub = effectiveSubfolder(et);
      const count = [...pages.keys()].filter((p) => p.startsWith(`${wikiVaultPath}/${sub}/`)).length;
      if (count > 0) { survivingTypes.push(et); continue; }
      removedTypes.push(et);
      try { await vaultTools.rmdir(`${wikiVaultPath}/${sub}`, true); } catch { /* folder already gone */ }
    }
```

- [ ] **Step 2: Route `src/main.ts` and `src/view.ts` counters**

In `src/main.ts`, add `effectiveSubfolder` to the `./wiki-path` import, then replace lines 140-142:

```ts
              const prefix = `${domainWikiFolder(domainEntry.wiki_folder)}/${effectiveSubfolder(et)}/`;
              counts.set(et.type, allMd.filter(f => f.path.startsWith(prefix)).length);
```

In `src/view.ts`, add `effectiveSubfolder` to the `./wiki-path` import, then replace lines 408-410:

```ts
          const prefix = `${domainWikiFolder(domainEntry.wiki_folder)}/${effectiveSubfolder(et)}/`;
          counts.set(et.type, allMd.filter(f => f.path.startsWith(prefix)).length);
```

- [ ] **Step 3: Route `src/modals.ts` card display**

In `src/modals.ts`, add `effectiveSubfolder` to its `./wiki-path` import (or add the import if absent), then replace lines 533-535:

```ts
    head.createEl("span", { text: effectiveSubfolder(et) + "/", cls: "ai-wiki-et-card-subfolder" });
```

- [ ] **Step 4: Verify (typecheck, lint, build, manual)**

```bash
npx tsc --noEmit
npm run lint
node esbuild.config.mjs production
```

Expected: 0 type errors, 0 lint errors, bundle builds.
Manual (record result): with a domain whose entity type has an empty `wiki_subfolder`, open the Lint modal — the type shows a non-zero count once pages exist under `<TypeName>/`, and lint no longer deletes the type.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts src/main.ts src/view.ts src/modals.ts
git commit -m "fix(lint,ui): count empty-subfolder types by effectiveSubfolder (F1)"
```

---

### Task 6: F4 — bootstrap fail-loud

**Files:**
- Modify: `src/phases/init.ts:237-243`
- Test: `tests/init-bootstrap-fail-loud.test.ts`

**Interfaces:**
- Consumes: `runInitWithSources(...)` (already exported).
- Produces: on bootstrap structured-output failure, an `error` event `init: domain bootstrap failed …` then `return` — no domain created/updated.

- [ ] **Step 1: Write the failing test**

Create `tests/init-bootstrap-fail-loud.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { LlmClient, RunEvent } from "../src/types";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { VaultTools } = await import("../src/vault-tools");
const { runInitWithSources } = await import("../src/phases/init");

function usageChunk() {
  return { id: "u", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}
function chunk(content: string) {
  return { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] };
}
// Bootstrap always returns non-JSON so structured parse fails on every retry.
function brokenBootstrapLlm(): LlmClient {
  return {
    chat: { completions: { create: async () => (async function* () { yield chunk("not json at all"); yield usageChunk(); })() } },
  } as unknown as LlmClient;
}
// Bootstrap returns a valid domain with an empty entity_types list (allowed).
function emptyTypesBootstrapLlm(): LlmClient {
  const body = JSON.stringify({ reasoning: "", id: "demo", name: "Demo", wiki_folder: "demo", entity_types: [], language_notes: "" });
  return {
    chat: { completions: { create: async () => (async function* () { yield chunk(body); yield usageChunk(); })() } },
  } as unknown as LlmClient;
}
function adapter() {
  const files = new Map<string, string>();
  return {
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, v: string) => { files.set(p, v); },
    append: async (p: string, v: string) => { files.set(p, (files.get(p) ?? "") + v); },
    list: async (dir: string) => (dir === "src" ? { files: ["src/a.md"], folders: [] } : { files: [], folders: [] }),
    exists: async (p: string) => files.has(p),
    mkdir: async () => {},
    remove: async (p: string) => { files.delete(p); },
    rename: async () => {},
  };
}

test("bootstrap failure stops init with a loud error and creates no domain", async () => {
  const vt = new VaultTools(adapter(), "/vault");
  const events: RunEvent[] = [];
  for await (const ev of runInitWithSources(
    "demo", ["src"], false, vt, brokenBootstrapLlm(), "m",
    [], "Vault", new AbortController().signal, { structuredRetries: 0 }, undefined, false, undefined,
  )) {
    events.push(ev);
  }

  assert.ok(events.some((e) => e.kind === "error" && /domain bootstrap failed/i.test(e.message)));
  assert.equal(events.some((e) => e.kind === "domain_created" || e.kind === "domain_updated"), false);
});

test("successful bootstrap with empty entity_types does not stop init", async () => {
  const vt = new VaultTools(adapter(), "/vault");
  const events: RunEvent[] = [];
  // dryRun=true → after a successful bootstrap the run yields the dry-run entry and
  // returns before ingest, so an empty-but-valid types list must NOT fail loud.
  for await (const ev of runInitWithSources(
    "demo", ["src"], true, vt, emptyTypesBootstrapLlm(), "m",
    [], "Vault", new AbortController().signal, { structuredRetries: 0 }, undefined, false, undefined,
  )) {
    events.push(ev);
  }

  assert.equal(events.some((e) => e.kind === "error" && /domain bootstrap failed/i.test(e.message)), false);
  assert.ok(events.some((e) => e.kind === "result" && /Dry run/i.test(e.text)));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/init-bootstrap-fail-loud.test.ts`
Expected: the fail-loud test FAILS (current code yields a warning `assistant_text` and continues — no `error` event); the empty-bootstrap test already PASSES (preserved behavior).

- [ ] **Step 3: Implement — fail loud on bootstrap catch**

In `src/phases/init.ts`, replace the bootstrap catch block (lines 237-244):

```ts
      } catch (e) {
        yield { kind: "tool_result", ok: false, preview: (e as Error).message };
        for (const ev of collected) yield ev;
        if ((e as Error).name === "AbortError" || signal.aborted) return;
        yield {
          kind: "error",
          message: `init: domain bootstrap failed — could not derive entity types (structured-output error: ${(e as Error).message}). Fix model/prompt and re-run.`,
        };
        yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
        return;
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/init-bootstrap-fail-loud.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/phases/init.ts tests/init-bootstrap-fail-loud.test.ts
git commit -m "fix(init): fail loud on bootstrap structured-output failure (F4)"
```

---

### Task 7: F3 — embedding request hardening (enrich error, failReason, dimensions opt-in)

**Files:**
- Modify: `src/page-similarity.ts:460` (enrich throw), `:506-509` (`EntityRetrievalResult`), `:783` (store `failReason`)
- Modify: `src/settings.ts:723` (remove dimensions auto-seed)
- Test: `tests/embedding-failreason.test.ts`

**Interfaces:**
- Consumes: existing `PageSimilarityService.selectByEntities`.
- Produces: `EntityRetrievalResult.failReason?: string` — the underlying embedding error, populated when `allFailed` is true. Consumed by Task 8.

- [ ] **Step 1: Write the failing test**

Create `tests/embedding-failreason.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { PageSimilarityService, buildEmbeddingRequestBody } = await import("../src/page-similarity");

test("embedding failure sets allFailed and a non-empty failReason", async () => {
  const svc = new PageSimilarityService({
    mode: "embedding", model: "m", baseUrl: "http://x", apiKey: "k", topK: 5,
  });
  const r = await svc.selectByEntities(
    [{ name: "x", type: "Concept" }],
    new Map([["p", "annotation"]]),
    ["!Wiki/d/Concept/p.md"],
  );
  assert.equal(r.allFailed, true);
  assert.ok(r.failReason && r.failReason.length > 0);
});

test("embedding request body omits dimensions when unset, includes it when set", () => {
  assert.equal("dimensions" in buildEmbeddingRequestBody("m", ["x"]), false);
  assert.equal("dimensions" in buildEmbeddingRequestBody("m", ["x"], 0), false);
  assert.equal(buildEmbeddingRequestBody("m", ["x"], 512).dimensions, 512);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/embedding-failreason.test.ts`
Expected: FAIL — `failReason` is `undefined` (field does not exist yet).

- [ ] **Step 3: Implement**

In `src/page-similarity.ts`, extend the interface (lines 506-509):

```ts
export interface EntityRetrievalResult {
  results: Map<string, string[]>;
  allFailed: boolean;
  failReason?: string;
}
```

Extract the request-body builder so the "omit `dimensions` when unset" rule is
unit-testable, and have `fetchEmbeddings` use it. Add near `fetchEmbeddings`:

```ts
export function buildEmbeddingRequestBody(
  model: string,
  inputs: string[],
  dimensions?: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = { model, input: inputs };
  if (dimensions && dimensions > 0) body.dimensions = dimensions;
  return body;
}
```

In `fetchEmbeddings`, replace the inline body construction (lines 448-449) with:

```ts
  const body = buildEmbeddingRequestBody(model, inputs, dimensions);
```

Enrich the throw in `fetchEmbeddings` (line 460):

```ts
  if (resp.status >= 400) {
    const detail = resp.text ? ` — ${resp.text.slice(0, 200)}` : "";
    throw new Error(`Embedding API error: ${resp.status}${detail}`);
  }
```

Store the reason in `selectByEntitiesEmbedding`'s catch (line 783):

```ts
    } catch (e) {
      return { ...this.jaccardFallbackAll(entities, indexAnnotations, allPaths), allFailed: true, failReason: (e as Error).message };
    }
```

In `src/settings.ts`, make `dimensions` opt-in by removing the auto-seed on model change (line 723 inside the embedding-model `onChange`): delete this line —

```ts
            if (v) await this.setDefaultDimensions(true);  // seed the model's native dimension
```

so the handler becomes:

```ts
          async (v) => {
            s.nativeAgent.embeddingModel = v || undefined;
            await this.plugin.saveSettings();
          },
```

(`fetchEmbeddings` already omits `dimensions` when unset — `page-similarity.ts:449` — so the default request no longer sends the field.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/embedding-failreason.test.ts`
Expected: PASS (2 tests — the stub's `requestUrl` throw is caught → `allFailed:true`, `failReason` set; and the body-builder omits/includes `dimensions`).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/page-similarity.ts src/settings.ts tests/embedding-failreason.test.ts
git commit -m "feat(embeddings): surface failReason and make dimensions opt-in (F3)"
```

---

### Task 8: F3 — `EmbeddingUnavailableError` + fail-fast whole init run

**Files:**
- Create: `src/embedding-error.ts`
- Modify: `src/phases/ingest.ts:161-168` (guard throws)
- Modify: `src/phases/init.ts` — both ingest loops (`runInitWithSources` ~341, `runIncrementalReinit` ~445)
- Test: `tests/init-embedding-stop.test.ts`

**Interfaces:**
- Consumes: `EntityRetrievalResult.failReason` (Task 7).
- Produces: `class EmbeddingUnavailableError extends Error` (`name === "EmbeddingUnavailableError"`); `runIngest` throws it; init loops stop the whole run once and do not mark the file analyzed.

- [ ] **Step 1: Write the failing test**

Create `tests/init-embedding-stop.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";
import type { LlmClient, RunEvent } from "../src/types";

const pathBrowserifyLoader = `
export async function resolve(specifier, context, nextResolve) {
  if (specifier === "path-browserify") return { url: "node:path", shortCircuit: true };
  return nextResolve(specifier, context);
}
`;
register(`data:text/javascript,${encodeURIComponent(pathBrowserifyLoader)}`);
register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { VaultTools } = await import("../src/vault-tools");
const { runInitWithSources } = await import("../src/phases/init");

function usageChunk() {
  return { id: "u", object: "chat.completion.chunk", created: 0, model: "m", choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } };
}
function chunk(content: string) {
  return { id: "c", object: "chat.completion.chunk", created: 0, model: "m", choices: [{ index: 0, delta: { content }, finish_reason: null }] };
}
// Every LLM call returns a valid entities payload (bootstrap is skipped via isResuming).
function entitiesLlm(): LlmClient {
  const body = JSON.stringify({ reasoning: "", entities: [{ name: "X", type: "Concept" }] });
  return {
    chat: { completions: { create: async () => (async function* () { yield chunk(body); yield usageChunk(); })() } },
  } as unknown as LlmClient;
}
function adapter() {
  const files = new Map<string, string>();
  return {
    read: async (p: string) => files.get(p) ?? "",
    write: async (p: string, v: string) => { files.set(p, v); },
    append: async (p: string, v: string) => { files.set(p, (files.get(p) ?? "") + v); },
    list: async (dir: string) => {
      if (dir === "src") return { files: ["src/a.md", "src/b.md"], folders: [] };
      if (dir.startsWith("!Wiki")) return { files: ["!Wiki/demo/entities/p.md"], folders: [] };
      return { files: [], folders: [] };
    },
    exists: async (p: string) => files.has(p),
    mkdir: async () => {},
    remove: async (p: string) => { files.delete(p); },
    rename: async () => {},
  };
}

const stubSimilarity = {
  loadCache: async () => {},
  selectByEntities: async () => ({ results: new Map(), allFailed: true, failReason: "Embedding API error: 400 — model not found" }),
} as unknown as import("../src/page-similarity").PageSimilarityService;

test("embedding failure stops the whole init run once and does not mark files analyzed", async () => {
  const vt = new VaultTools(adapter(), "/vault");
  const domain = {
    id: "demo", name: "Demo", wiki_folder: "demo", source_paths: ["src"],
    entity_types: [{ type: "Concept", description: "d", extraction_cues: ["c"], wiki_subfolder: "" }],
    analyzed_sources: {},
  };
  const events: RunEvent[] = [];
  for await (const ev of runInitWithSources(
    "demo", ["src"], false, vt, entitiesLlm(), "m",
    [domain], "Vault", new AbortController().signal, {}, undefined, false, stubSimilarity,
  )) {
    events.push(ev);
  }

  assert.ok(events.some((e) => e.kind === "error" && /embedding endpoint failed/i.test(e.message)));
  assert.equal(events.filter((e) => e.kind === "file_start").length, 1); // stopped before file b
  const analyzedPatch = events.some(
    (e) => e.kind === "domain_updated" && (e.patch as { analyzed_sources?: Record<string, string> }).analyzed_sources
      && Object.keys((e.patch as { analyzed_sources: Record<string, string> }).analyzed_sources).length > 0,
  );
  assert.equal(analyzedPatch, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/init-embedding-stop.test.ts`
Expected: FAIL — current guard yields a generic error, the loop continues to file b (two `file_start`), and the file is marked analyzed.

- [ ] **Step 3: Add the error class**

Create `src/embedding-error.ts`:

```ts
/** Thrown when the embedding endpoint genuinely fails for a whole entity set. */
export class EmbeddingUnavailableError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "EmbeddingUnavailableError";
  }
}
```

- [ ] **Step 4: Throw from the ingest guard**

In `src/phases/ingest.ts`, add the import near the other imports:

```ts
import { EmbeddingUnavailableError } from "../embedding-error";
```

Replace the retrieval-guard block (lines 161-168) — destructure `failReason` and throw:

```ts
    const { results: entityMap, allFailed, failReason } = await similarity.selectByEntities(
      entitiesResult.value.entities, annotations, nonMetaPaths,
    );

    if (allFailed && entitiesResult.value.entities.length > 0 && nonMetaPaths.length > 0) {
      throw new EmbeddingUnavailableError(failReason ?? "per-entity retrieval failed for all entities");
    }
```

- [ ] **Step 5: Stop the run in both init loops**

In `src/phases/init.ts`, add the import:

```ts
import { EmbeddingUnavailableError } from "../embedding-error";
```

In `runInitWithSources`, in the ingest-loop error handler (around line 341, the `if (hadError && caughtErr) {` block), add the fast-stop as the first check:

```ts
      if (hadError && caughtErr) {
        if (caughtErr instanceof EmbeddingUnavailableError || caughtErr.name === "EmbeddingUnavailableError") {
          yield { kind: "error", message: `init stopped — embedding endpoint failed: ${caughtErr.message}. Fix embedding config and re-run.` };
          yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
          return;
        }
        const canRetry = !retried;
        const choice = onFileError ? await onFileError(file, caughtErr, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        done = true;
      }
```

In `runIncrementalReinit`, in its ingest-loop error handler (around line 445, the `if (caught) {` block), add the same fast-stop as the first check (reuse this function's own start-timestamp variable for `durationMs`; if none exists, emit `durationMs: 0`):

```ts
      if (caught) {
        if (caught instanceof EmbeddingUnavailableError || caught.name === "EmbeddingUnavailableError") {
          yield { kind: "error", message: `init stopped — embedding endpoint failed: ${caught.message}. Fix embedding config and re-run.` };
          yield { kind: "result", durationMs: 0, text: "" };
          return;
        }
        if (caught.name === "AbortError" || signal.aborted) return;
        const canRetry = !retried;
        const choice = onFileError ? await onFileError(file, caught, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        fileDone = true;
      }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `node --import tsx --test tests/init-embedding-stop.test.ts`
Expected: PASS (one `file_start`, embedding-failed error, no analyzed patch).

- [ ] **Step 7: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/embedding-error.ts src/phases/ingest.ts src/phases/init.ts tests/init-embedding-stop.test.ts
git commit -m "fix(init): fail-fast whole run on embedding failure (F3)"
```

---

### Task 9: F6 — surface the real error in the embedding dimension check

**Files:**
- Modify: `src/page-similarity.ts` — add `probeEmbeddingDimensionsResult`, rewrite `probeEmbeddingDimensions` as a wrapper
- Modify: `src/settings.ts:127-134` (`checkDimensions` uses the Result variant)
- Test: `tests/embedding-probe-error.test.ts`

**Interfaces:**
- Produces: `probeEmbeddingDimensionsResult(baseUrl, apiKey, model, requested?): Promise<{ probe?: DimensionProbe; error?: string }>`.
- Preserves: `probeEmbeddingDimensions(...): Promise<DimensionProbe | null>` (unchanged signature; used by `setDefaultDimensions`).

- [ ] **Step 1: Write the failing test**

Create `tests/embedding-probe-error.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { probeEmbeddingDimensionsResult } = await import("../src/page-similarity");

test("probe result surfaces the underlying error instead of a bare null", async () => {
  const r = await probeEmbeddingDimensionsResult("http://x", "k", "m", 1024);
  assert.equal(r.probe, undefined);
  assert.ok(r.error && r.error.length > 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/embedding-probe-error.test.ts`
Expected: FAIL — `probeEmbeddingDimensionsResult` is not exported.

- [ ] **Step 3: Implement**

In `src/page-similarity.ts`, replace the existing `probeEmbeddingDimensions` (lines 481-498) with a Result variant plus a thin wrapper:

```ts
export async function probeEmbeddingDimensionsResult(
  baseUrl: string,
  apiKey: string,
  model: string,
  requested?: number,
): Promise<{ probe?: DimensionProbe; error?: string }> {
  try {
    const [vec] = await fetchEmbeddings(baseUrl, apiKey, model, ["ping"], requested);
    if (!vec || vec.length === 0) return { error: "empty embedding response" };
    return {
      probe: {
        actual: vec.length,
        requested: requested && requested > 0 ? requested : undefined,
        honored: !requested || requested <= 0 || vec.length === requested,
      },
    };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

export async function probeEmbeddingDimensions(
  baseUrl: string,
  apiKey: string,
  model: string,
  requested?: number,
): Promise<DimensionProbe | null> {
  return (await probeEmbeddingDimensionsResult(baseUrl, apiKey, model, requested)).probe ?? null;
}
```

In `src/settings.ts`, add `probeEmbeddingDimensionsResult` to the `./page-similarity` import (line 9), then update `checkDimensions` (lines 133-134):

```ts
    const result = await probeEmbeddingDimensionsResult(na.baseUrl, apiKey, na.embeddingModel, requested);
    if (result.error) { new Notice(`Dimension check failed: ${result.error}`); return; }
    const probe = result.probe!;
```

(The rest of `checkDimensions` — the `nativeProbe` call and the branch comparing `probe.honored` — is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/embedding-probe-error.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/page-similarity.ts src/settings.ts tests/embedding-probe-error.test.ts
git commit -m "feat(settings): surface real embedding probe error (F6)"
```

---

### Task 10: F7 — reranker availability probe + settings button

**Files:**
- Modify: `src/reranker.ts` — add `probeRerankerModel`
- Modify: `src/settings.ts` — add `checkReranker()` + a "Check" button next to the reranker model (~lines 797-802)
- Test: `tests/reranker-probe.test.ts`

**Interfaces:**
- Consumes: `fetchRerankerScores` (default transport), `RerankerConfig`, `RerankerCandidate`, `RerankerTransport`, `normalizeRerankerConfig` (all exported).
- Produces: `probeRerankerModel(baseUrl, apiKey, config, transport?): Promise<{ ok: boolean; error?: string }>`.

- [ ] **Step 1: Write the failing test**

Create `tests/reranker-probe.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { probeRerankerModel, normalizeRerankerConfig } = await import("../src/reranker");
import type { RerankerTransport } from "../src/reranker";

const cfg = normalizeRerankerConfig({ enabled: true, model: "rr" });

test("probeRerankerModel returns ok when the transport yields scores", async () => {
  const transport: RerankerTransport = async () => [{ id: "probe", score: 1 }];
  assert.deepEqual(await probeRerankerModel("http://x", "k", cfg, transport), { ok: true });
});

test("probeRerankerModel surfaces the transport error", async () => {
  const transport: RerankerTransport = async () => { throw new Error("rerank 500 provider error"); };
  const r = await probeRerankerModel("http://x", "k", cfg, transport);
  assert.equal(r.ok, false);
  assert.match(r.error ?? "", /rerank 500 provider error/);
});

test("probeRerankerModel treats an empty score list as failure", async () => {
  const transport: RerankerTransport = async () => [];
  const r = await probeRerankerModel("http://x", "k", cfg, transport);
  assert.equal(r.ok, false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/reranker-probe.test.ts`
Expected: FAIL — `probeRerankerModel` is not exported.

- [ ] **Step 3: Implement the probe**

In `src/reranker.ts`, add after `fetchRerankerScores` (after line 539):

```ts
/**
 * Verify the reranker model is reachable by scoring a single trivial pair.
 * Returns { ok:true } on a valid non-empty score list, else { ok:false, error }.
 * The transport is injectable for testing (defaults to the live HTTP transport).
 */
export async function probeRerankerModel(
  baseUrl: string,
  apiKey: string,
  config: RerankerConfig,
  transport: RerankerTransport = fetchRerankerScores,
): Promise<{ ok: boolean; error?: string }> {
  const candidates = [{ id: "probe", text: "ping" }] as unknown as RerankerCandidate[];
  try {
    const scores = await transport({
      query: "ping",
      candidates,
      config,
      baseUrl,
      apiKey,
      signal: new AbortController().signal,
    });
    if (!Array.isArray(scores) || scores.length === 0) {
      return { ok: false, error: "empty or malformed rerank response" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/reranker-probe.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the settings "Check" button**

In `src/settings.ts`, add `probeRerankerModel` to the `./reranker` import (find the existing reranker import, e.g. `normalizeRerankerConfig`, and append the name; add `normalizeRerankerConfig` too if not already imported).

Add a `checkReranker` method next to `checkDimensions` (after line 150):

```ts
  private async checkReranker(): Promise<void> {
    const na = this.plugin.settings.nativeAgent;
    if (!na.baseUrl || !na.rerankerModel) { new Notice("Set Base URL and reranker model first"); return; }
    const apiKey = this.localCache.nativeAgent?.apiKey ?? "";
    const config = normalizeRerankerConfig({ enabled: true, model: na.rerankerModel });
    const r = await probeRerankerModel(na.baseUrl, apiKey, config);
    new Notice(r.ok ? `OK — reranker "${na.rerankerModel}" reachable` : `Reranker check failed: ${r.error}`);
  }
```

Replace the reranker-model control block (lines 797-802) so the Setting is captured and gets a Check button:

```ts
      const rerankerModelSetting = new Setting(containerEl)
        .setName(T.settings.rerankerModel_name)
        .setDesc(T.settings.rerankerModel_desc);
      this.addModelControl(
        rerankerModelSetting,
        s.nativeAgent.rerankerModel ?? "",
        async (v) => { s.nativeAgent.rerankerModel = v.trim(); await this.plugin.saveSettings(); },
        true,
      );
      rerankerModelSetting.addButton((b) =>
        b.setButtonText("Check").setTooltip("Verify the reranker model is reachable")
          .onClick(() => { void this.checkReranker(); }),
      );
```

- [ ] **Step 6: Verify (typecheck, lint) + commit**

```bash
npx tsc --noEmit
npm run lint
git add src/reranker.ts src/settings.ts tests/reranker-probe.test.ts
git commit -m "feat(settings): add reranker model availability probe (F7)"
```

---

### Task 11: Full verification, bundle rebuild, docs, PR

**Files:**
- Modify: `dist/main.js` (rebuilt)
- Modify: iwiki `obsidian-ai-wiki` domain pages (via MCP), `README.md` / `docs/README.ru.md` if they document init/embedding/reranker behavior

**Interfaces:** none (release/verification task).

- [ ] **Step 1: Run the full test suite**

Run: `node --import tsx --test tests/*.test.ts`
Expected: all tests pass, including the 8 new files from Tasks 1-10.

- [ ] **Step 2: Lint + typecheck**

```bash
npm run lint
npx tsc --noEmit
```

Expected: 0 errors.

- [ ] **Step 3: Rebuild the bundle**

```bash
node esbuild.config.mjs production
```

Expected: `dist/main.js` regenerated with no build errors.

- [ ] **Step 4: Manual end-to-end verification (record results in the PR body)**

- Point the embedding model at a strict endpoint (or a wrong model) → run init → it stops once with the real status/body, not a per-file grind; the source is not marked analyzed.
- A domain with an entity type that has an empty `wiki_subfolder` → its pages land under `<TypeName>/`; the Lint modal shows a non-zero count.
- Settings → embedding "Check" reports the real error on failure; reranker "Check" reports reachable / the real error.

- [ ] **Step 5: Update the iwiki wiki (MANDATORY)**

Per the project convention, reflect the behavior changes in the bound `obsidian-ai-wiki` domain:

```
wiki_status  → confirm domain bound
wiki_bind(read=["obsidian-ai-wiki"], write="obsidian-ai-wiki")
```

- `wiki_update_page` the ingest/init page(s) to describe: fail-fast on embedding failure with the real error; bootstrap fail-loud; `effectiveSubfolder` routing.
- `wiki_update_page` the settings/retrieval page(s) for the reranker probe button and the dimensions opt-in.
- `wiki_lint` → no broken refs / orphans.

- [ ] **Step 6: Update README files if they cover this**

If `README.md` / `docs/README.ru.md` document embedding/reranker setup or init behavior, update both in sync (English + Russian). Skip if they don't cover it.

- [ ] **Step 7: Commit bundle + docs, push, open PR**

```bash
git add dist/main.js
git commit -m "chore(build): rebuild dist bundle for init robustness & model probes"
git push -u origin dev-init-robustness-and-model-probes
```

Open a PR into `master` summarizing F1-F7, the two roots (R1 embedding, R2 bootstrap), and the manual verification results. Use the git-workflow skill for the PR body.
