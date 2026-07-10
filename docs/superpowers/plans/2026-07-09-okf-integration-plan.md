---
review:
  plan_hash: "dce2aad09004e4ef"
  last_run: "2026-07-10"
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: "n/a"
  spec: "16e312ee9f3ff1d4"
---
# OKF Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge wiki-page frontmatter to OKF-native names (minimal set), carry the knowledge graph as body markdown links, use `description` as the single retrieval overview, migrate existing pages, and add an offline OKF-bundle export.

**Architecture:** A rename primitive in `raw-frontmatter.ts` maps legacy `wiki_*` frontmatter to OKF names and makes `resource` a plain source pointer. Outgoing/external links move OUT of frontmatter into body sections `## Related` / `## External links`. `description` (the verbatim overview) drives embeddings/chunks/seeds; the chunker excludes the link sections. A one-shot migration renames fields, relocates the frontmatter links to the body, and backfills descriptions. An offline module exports an OKF bundle (body `[[links]]` → `[md](links)`).

**Tech Stack:** TypeScript, Obsidian plugin API (`vault.adapter`), `path-browserify`, `yaml`. Tests are hand-rolled `eval/<name>/run.ts` scripts run with `npx tsx`.

**Spec:** `docs/superpowers/specs/2026-07-09-okf-integration-design.md`

**NOTE — prior partial work:** Tasks 1 and 2 were first implemented against an earlier frontmatter model (outgoing_links/external_links IN frontmatter, resource as `[[wikilink]]`). This plan reflects the FINAL model (links in body, resource plain). Tasks 1–2 implementers must ADJUST the already-committed code to match this plan, not assume a clean slate.

## Global Constraints

- OKF applies to **generated wiki pages only**; source notes keep the `wiki_` prefix.
- Wiki-page frontmatter field set: `type` (mandatory), `description`, `resource`, `timestamp`, `tags`, `status`. `title` is NOT stored (derived at export). REMOVED from frontmatter: `wiki_type`, `outgoing_links`, `external_links`.
- Field renames (legacy → OKF): `wiki_sources`→`resource`, `wiki_updated`→`timestamp`, `wiki_status`→`status`.
- `resource` value is the **plain source identifier** (bare stem, NO `[[ ]]`): `["[[stem]]"]` → `["stem"]`. Staleness / source-deletion match by that stem.
- The knowledge graph is in the **body**: outgoing wiki links in a `## Related` section (`[[wikilink]]` on disk), external links in a `## External links` section (`[text](url)`). NOT in frontmatter.
- `## Related` and `## External links` are **excluded from embeddings / chunks / description / index**.
- `type` = entity-type subdirectory (`!Wiki/<folder>/<type>/…`); generic `entities` → `concept`.
- `description` = the overview, verbatim one line (~600–800 chars), NOT truncated; single source for retrieval.
- On-disk body links stay `[[wikilinks]]`; rewrite to `[md](links)` happens ONLY in the export bundle.
- Tags hierarchical (`a/b`) on disk; kebab (`a/b`→`a-b`) ONLY at export.
- No new npm dependencies. `node:fs` only inside a `Platform.isDesktopApp` guard, lazily imported.
- **tsc gate:** the repo has PRE-EXISTING tsc errors in unrelated files; a bare `tsc --noEmit` is NOT a gate. Gate = `npx tsc --noEmit 2>&1 | grep -E "<your touched file stems>"` is EMPTY. Do NOT run `npm run build` per task (bundle rebuilt at branch finish).

---

# Phase 1 — Frontmatter + graph convergence

## Task 1: Rename primitive, plain `resource`, drop link/`wiki_type` frontmatter fields

Adjust the already-committed rename primitive to the FINAL model: only 3 aliases, `resource` becomes a plain string list, and `wiki_type` is dropped from frontmatter. Outgoing/external links are NOT frontmatter fields (their relocation is Task 5).

**Files:**
- Modify: `src/utils/raw-frontmatter.ts` (`WIKI_FIELD_ALIASES`, `renameWikiPageFields`, `parseResourceFromFm`, `ensureResource`, `WIKI_PAGE_RULES`, add `plainResourceList` handling)
- Modify: `eval/okf-frontmatter/run.ts` (already exists — adjust)

**Interfaces:**
- Produces (final signatures):
  - `WIKI_FIELD_ALIASES = { wiki_sources: "resource", wiki_updated: "timestamp", wiki_status: "status" }` (3 only).
  - `renameWikiPageFields(content)` — renames the 3, drops `wiki_type`, converts `resource` values `[[stem]]`→`stem`. Idempotent; leaves `wiki_outgoing_links`/`wiki_external_links` untouched (Task 5 relocates them).
  - `parseResourceFromFm(content): string[]` — plain resource stems (no brackets).
  - `ensureResource(content, sourceStem): { content, injected }` — writes `resource: ["stem"]` (plain).
  - `entityTypeFromPath` — unchanged from prior commit.

- [ ] **Step 1: Adjust the test** — in `eval/okf-frontmatter/run.ts`, replace the Task-1 block so it asserts the FINAL model (remove `outgoing_links`/`external_links` frontmatter assertions; add plain-resource):

```ts
const legacy = `---
wiki_sources: ["[[Src]]"]
wiki_updated: 2026-07-09
wiki_status: developing
wiki_type: page
---
# X
body [[wiki_d_x]]
`;
const renamed = renameWikiPageFields(legacy);
check("resource present", /^resource:/m.test(renamed));
check("resource is plain (no brackets)", /resource:\s*\n\s*-\s*"?Src"?/m.test(renamed) || /resource:\s*\[\s*"?Src"?\s*\]/.test(renamed));
check("timestamp present", /^timestamp:/m.test(renamed));
check("status present", /^status:/m.test(renamed));
check("wiki_type dropped", !/wiki_type:/m.test(renamed));
check("no legacy wiki_sources", !/wiki_sources:/m.test(renamed));
check("body preserved", renamed.includes("# X\nbody [[wiki_d_x]]"));
check("idempotent", renameWikiPageFields(renamed) === renamed);
check("parseResource plain", JSON.stringify(parseResourceFromFm(renamed)) === JSON.stringify(["Src"]));
check("type from subdir", entityTypeFromPath("!Wiki/d", "!Wiki/d/person/wiki_d_alice.md") === "person");
check("type entities→concept", entityTypeFromPath("!Wiki/d", "!Wiki/d/entities/wiki_d_x.md") === "concept");
```
(Keep the `ensureType`/`ensureDescription`/source-date/`collectDescriptions` blocks that later Task-steps appended; only the Task-1 assertions change. Update the running `TOTAL` expectation in later steps accordingly — count the checks after editing.)

- [ ] **Step 2: Run to verify current (old-model) code fails the new assertions**

Run: `npx tsx eval/okf-frontmatter/run.ts`
Expected: FAIL on "resource is plain" / "wiki_type dropped stays" mismatches (old code kept `[[ ]]` and had 5 aliases).

- [ ] **Step 3: Adjust `raw-frontmatter.ts`**

Reduce the alias map to 3 and make `renameWikiPageFields` convert resource to plain + drop `wiki_type`:

```ts
export const WIKI_FIELD_ALIASES: Record<string, string> = {
  wiki_sources: "resource",
  wiki_updated: "timestamp",
  wiki_status:  "status",
};

/** Strip [[ ]] from a wikilink string → bare stem; pass through plain strings. */
function toPlainStem(v: unknown): unknown {
  if (typeof v !== "string") return v;
  const m = /^\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]$/.exec(v.trim());
  return m ? m[1].split("/").pop()!.replace(/\.md$/, "") : v;
}

export function renameWikiPageFields(content: string): string {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return content;
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return content; }

  let modified = false;
  for (const [legacy, okf] of Object.entries(WIKI_FIELD_ALIASES)) {
    if (legacy in parsed) {
      if (!(okf in parsed)) parsed[okf] = parsed[legacy];
      delete parsed[legacy];
      modified = true;
    }
  }
  if ("wiki_type" in parsed) { delete parsed["wiki_type"]; modified = true; }
  // resource → plain stems
  if (Array.isArray(parsed.resource)) {
    const plain = (parsed.resource as unknown[]).map(toPlainStem);
    if (JSON.stringify(plain) !== JSON.stringify(parsed.resource)) { parsed.resource = plain; modified = true; }
  }
  if (!modified) return content;
  const body = content.slice(fmMatch[0].length);
  return `---\n${yamlStringify(parsed)}---\n${body}`;
}
```

Update `parseResourceFromFm` to read plain strings (bare stems), and `ensureResource` to write `resource: ["stem"]` (plain, no brackets):

```ts
export function parseResourceFromFm(content: string): string[] {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return [];
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; } catch { return []; }
  const r = parsed.resource;
  return Array.isArray(r) ? (r as unknown[]).filter((x): x is string => typeof x === "string") : [];
}

export function ensureResource(content: string, sourceStem: string): { content: string; injected: boolean } {
  if (parseResourceFromFm(content).length > 0) return { content, injected: false };
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, injected: false };
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; } catch { return { content, injected: false }; }
  const body = content.slice(fmMatch[0].length);
  parsed.resource = [sourceStem];
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, injected: true };
}
```

Update `WIKI_PAGE_RULES` — `resource` is now a plain-string list, drop the link-field rules. Add a new `FieldRule` kind `list-strings` (a list of plain strings; drop non-strings) if none fits, or reuse an existing lenient list handling. Final:

```ts
const WIKI_PAGE_RULES: FieldRule[] = [
  { field: "resource",  kind: "list-strings" },   // plain source stems
  { field: "timestamp", kind: "date-scalar" },
  { field: "status",    kind: "warn-enum", values: ["stub", "developing", "mature"] },
  { field: "tags",      kind: "list-tags" },
  { field: "aliases",   kind: "aliases" },
  { field: "wiki_type", kind: "remove" },
  { field: "wiki_outgoing_links", kind: "remove" },
  { field: "wiki_external_links", kind: "remove" },
  { field: "annotation", kind: "remove" },
];
```

Add the `list-strings` case to `validateAndRepairFrontmatter` (a list; keep only string entries; drop the field if empty). `renameWikiPageFields` still runs first inside `validateAndRepairWikiPageFrontmatter`.

- [ ] **Step 4: Run to verify pass**

Run: `npx tsx eval/okf-frontmatter/run.ts`
Expected: `TOTAL: <N> passed, 0 failed` (N = the count after your Step-1 edit). Scoped tsc grep (`raw-frontmatter`) empty.

- [ ] **Step 5: Commit**

```bash
git add src/utils/raw-frontmatter.ts eval/okf-frontmatter/run.ts
git commit -m "refactor(okf): 3-alias rename, plain resource, drop link/wiki_type frontmatter fields"
```

---

## Task 2: `type` / `description` governance + emit body link sections

Adjust ingest governance to the final model: inject `type`/`description`, write `resource` plain, and make the prompts author `## Related` / `## External links` body sections instead of frontmatter link arrays.

**Files:**
- Modify: `src/phases/ingest.ts` (write pipeline; `parseWikiStatus`), `src/utils/raw-frontmatter.ts` (`ensureType`/`ensureDescription` already added — verify verbatim description)
- Modify: `prompts/ingest.md`, `prompts/ingest-merge.md`
- Modify: `eval/okf-frontmatter/run.ts` (already has type/description checks — verify)

**Interfaces:**
- Consumes: `entityTypeFromPath`, `ensureType`, `ensureDescription`, `ensureResource` (Task 1).

- [ ] **Step 1: Verify/repair the governance test** — the `ensureType`/`ensureDescription` checks should assert: `type` injected once, `description` = full annotation verbatim (`.includes(ann)`), empty annotation → no-op. Keep them.

- [ ] **Step 2: Wire the write pipeline** — in `src/phases/ingest.ts`, the page write must call, in order: `validateAndRepairWikiPageFrontmatter` → `ensureEntityTypeTag` → `ensureType(content, entityTypeFromPath(wikiVaultPath, page.path))` → `ensureDescription(content, page.annotation ?? "")` → `ensureResource(content, sourceStem)` → write. Replace the old `ensureWikiSources` call with `ensureResource`. Update `parseWikiStatus` to read `status`:

```ts
function parseWikiStatus(content: string): string {
  const m = /^---\n[\s\S]*?^status:[ \t]*(.+)$/m.exec(content);
  return m ? m[1].trim() : "unknown";
}
```

- [ ] **Step 3: Update prompts** — in `prompts/ingest.md` and `prompts/ingest-merge.md`:
  - Frontmatter block emits: `type: <entity type>`, `resource: ["<source stem>"]` (plain, no `[[ ]]`), `timestamp: {{today}}`, `status: stub|developing|mature`, `tags: []`. NO `outgoing_links`/`external_links` in frontmatter.
  - Add body-section conventions: outgoing wiki links go in a `## Related` section as `[[stem]]` bullet list; external links go in a `## External links` section as `[text](url)` bullets. State that `## Related`/`## External links` are the ONLY place for links (not frontmatter).
  - Keep `annotation` JSON-only (injected into `description` in TS).
  - Update the JSON `content` template accordingly.

- [ ] **Step 4: Run tests + scoped tsc**

Run: `npx tsx eval/okf-frontmatter/run.ts` (expect the same `TOTAL` as Task 1's final count — Task 2 changes no counts if the type/description checks already existed). Scoped tsc grep (`phases/ingest|raw-frontmatter`) empty.

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts src/utils/raw-frontmatter.ts prompts/ingest.md prompts/ingest-merge.md eval/okf-frontmatter/run.ts
git commit -m "feat(okf): governance — inject type/description, plain resource, body link sections in prompts"
```

---

## Task 3: Remove wiki-tracking dates from source notes

(unchanged from the original model — source notes are orthogonal to the link/resource change.)

**Files:** `src/utils/raw-frontmatter.ts` (`SOURCE_RULES`, `upsertRawFrontmatter`, `restoreSourceFrontmatter`), `src/phases/ingest.ts`, `src/phases/lint.ts`, `eval/okf-frontmatter/run.ts`.

- [ ] **Step 1: Test** — assert `validateAndRepairSourceFrontmatter` drops `wiki_added`/`wiki_updated` and keeps `wiki_articles`; `upsertRawFrontmatter(content, { wiki_articles })` writes only articles.
- [ ] **Step 2: Run — fails** (`npx tsx eval/okf-frontmatter/run.ts`).
- [ ] **Step 3: Implement** — `SOURCE_RULES`: `wiki_added`/`wiki_updated` → `{ kind: "remove" }`. `upsertRawFrontmatter(content, { wiki_articles: string[] })` strips both dates, keeps `wiki_articles`. `restoreSourceFrontmatter` re-attaches only `wiki_articles`.
- [ ] **Step 4: Update call sites** — `ingest.ts` and `lint.ts` `upsertRawFrontmatter(...)` calls pass only `{ wiki_articles }`; drop `wiki_updated`/`syncToday`.
- [ ] **Step 5: Run + scoped tsc** — eval passes; grep (`raw-frontmatter|phases/ingest|phases/lint`) empty.
- [ ] **Step 6: Commit** — `git commit -m "feat(okf): drop wiki_added/wiki_updated from source notes"`.

---

## Task 4: Retarget consumers — plain `resource`, deletion guard, drop frontmatter link-sync

**Files:** `src/source-deletion.ts`, `src/incremental-sources.ts` (`parsePageSources`), `src/utils/vault-walk.ts` (`parseWikiSources`), `src/phases/ingest.ts` (deletion guard `~194-208`), `src/phases/query.ts`, `src/phases/zod-schemas.ts`, `src/wiki-link-validator.ts`, `src/phases/lint.ts`, `src/strip-legacy-sections.ts`; touched `eval/*` fixtures.

- [ ] **Step 1: Locate** — `grep -rn "wiki_sources\|wiki_outgoing_links\|wiki_external_links\|wiki_updated\|wiki_status\|parseWikiSourcesFromFm\|ensureWikiSources" src eval | grep -v raw-frontmatter.ts`.
- [ ] **Step 2: Plain-`resource` parsers** — in `source-deletion.ts`, `incremental-sources.ts:parsePageSources`, `vault-walk.ts:parseWikiSources`: parse `resource` as a **plain string list** (no `[[ ]]` stripping — the value IS the bare stem). Switch `parseWikiSourcesFromFm` callers to `parseResourceFromFm`. Then DELETE the now-unused `parseWikiSourcesFromFm` / `ensureWikiSources`.
- [ ] **Step 3: Deletion guard** — `ingest.ts:~194-208` (the "delete pages missing `wiki_sources`" logic) must test for `resource:` instead, so migrated pages carrying only `resource` are NOT deleted.
- [ ] **Step 4: Saved-query page** — `query.ts:~357` writes `type: concept`, `resource: []`, `timestamp: ${today}`, `status: mature` (no `outgoing_links`).
- [ ] **Step 5: Drop frontmatter link-sync** — `wiki-link-validator.ts` / `lint.ts` / `strip-legacy-sections.ts`: remove the code that reads/writes a frontmatter `wiki_outgoing_links` array. Outgoing links are the `## Related` body section now. KEEP body dead-link detection (`stripDeadLinks`, `fixWikiLinks`) operating on body `[[links]]`. `zod-schemas.ts`: drop the `wiki_sources` block-quote validation (resource is plain now) or retarget it to `resource`.
- [ ] **Step 6: Fixtures** — update `eval/*/run.ts` wiki-page fixtures: `wiki_sources: ["[[stem]]"]` → `resource: ["stem"]`; remove `wiki_outgoing_links`/`wiki_external_links` frontmatter (move to a `## Related` body section where a test needs them); `wiki_status`→`status`, `wiki_updated`→`timestamp`.
- [ ] **Step 7: Typecheck + touched evals** — `npx tsc --noEmit 2>&1 | grep -E "source-deletion|incremental|vault-walk|wiki-link-validator|phases/(lint|query|ingest|zod-schemas)|strip-legacy"` empty; run `eval/source-deletion/run.ts`, `eval/legacy-sections/run.ts`, `eval/incremental-sources/run.ts` — all 0 failures.
- [ ] **Step 8: Commit** — `git commit -m "refactor(okf): plain resource consumers, deletion guard, drop frontmatter link-sync"`.

---

## Task 5: Auto-migration — rename + plain resource + relocate links to body + backfill description

**Files:** Create `src/migrate-okf-frontmatter.ts`; modify `src/local-config.ts` (flag), `src/main.ts` (wire), `src/wiki-index.ts` (import `deriveFallbackDescription`); Test `eval/okf-migrate/run.ts`.

**Interfaces:**
- Produces `migrateWikiPageOkf(content, wikiFolder, fullPath, annotation): string` (pure) and `migrateOkfFrontmatter(vault, domains, localConfigStore): Promise<void>`.
- Consumes `renameWikiPageFields`, `ensureType`, `ensureDescription`, `entityTypeFromPath` (Task 1–2); `relocateFrontmatterLinks` (added here).

- [ ] **Step 1: Test** — `eval/okf-migrate/run.ts`: a legacy page with `wiki_sources: ["[[Src]]"]`, `wiki_updated`, `wiki_status`, `wiki_type`, `wiki_outgoing_links: ["[[wiki_d_y]]"]`, `wiki_external_links: ["https://a.b"]` →
```ts
const out = migrateWikiPageOkf(legacy, "!Wiki/d", "!Wiki/d/person/wiki_d_alice.md", "Alice leads billing. Owns invoices.");
check("resource plain", /resource:\s*\n\s*-\s*"?Src"?/.test(out) || /resource:\s*\[\s*"?Src"?/.test(out));
check("timestamp/status/type", /^timestamp:/m.test(out) && /^status:/m.test(out) && /^type: person$/m.test(out));
check("description set", /^description: /m.test(out));
check("no frontmatter outgoing/external", !/wiki_outgoing_links:/m.test(out) && !/wiki_external_links:/m.test(out));
check("## Related in body", /^## Related$/m.test(out) && out.includes("[[wiki_d_y]]"));
check("## External links in body", /^## External links$/m.test(out) && out.includes("https://a.b"));
check("idempotent", migrateWikiPageOkf(out, "!Wiki/d", "!Wiki/d/person/wiki_d_alice.md", "Alice leads billing. Owns invoices.") === out);
```
- [ ] **Step 2: Run — fails** (module absent).
- [ ] **Step 3: Implement `relocateFrontmatterLinks` + `migrateWikiPageOkf`** — a pure helper reads `wiki_outgoing_links`/`wiki_external_links` from frontmatter, removes them, and appends/merges `## Related` (each `[[stem]]` as a bullet) and `## External links` (each url as `[url](url)` or `[text](url)`) to the body (dedupe if the section already exists). Then:
```ts
export function migrateWikiPageOkf(content, wikiFolder, fullPath, annotation) {
  let out = relocateFrontmatterLinks(content);          // frontmatter links → body sections
  out = renameWikiPageFields(out);                       // 3 aliases + plain resource + drop wiki_type
  out = ensureType(out, entityTypeFromPath(wikiFolder, fullPath));
  out = ensureDescription(out, annotation);
  return out;
}
```
- [ ] **Step 4: Driver + flag + wire** — `migrateOkfFrontmatter` walks `collectMdInPaths(vault, [wikiFolder])` (skip `_`), reads each page + its `_index.md` annotation (for the description backfill), writes when changed; flag `migrated_okf_frontmatter` in `local-config.ts`; wire a try/catch block into `main.ts` after `migrateDropSections`. Then regenerate `_index.md` (the descriptions now on the pages) — or leave `_index.md` as-is since its lines already equal the descriptions.
- [ ] **Step 5: Run + scoped tsc + build** — `npx tsx eval/okf-migrate/run.ts` (8+ checks, 0 failed); grep (`migrate-okf-frontmatter|local-config|main`) empty.
- [ ] **Step 6: Commit** — `git commit -m "feat(okf): migration — rename, plain resource, relocate links to body, backfill description"`.

---

## Task 5b: Overview single source + exclude link sections from retrieval

**Files:** `src/wiki-index.ts` (`deriveFallbackDescription`, `parseDescriptionFromFm`, `collectDescriptions`), `src/page-similarity.ts` (`splitSections` exclusion + overview source), `src/phases/ingest.ts`, `src/phases/lint.ts`, `src/phases/query.ts`, `src/phases/llm-utils.ts` (`wikiSections`), `templates/_wiki_schema.md`; Test `eval/okf-frontmatter/run.ts`.

- [ ] **Step 1: Test** — `parseDescriptionFromFm` reads the field; `collectDescriptions(pages)` maps pid→description (fallback for missing); `splitSections` on a body containing `## Related`/`## External links` does NOT emit chunks for those sections.
- [ ] **Step 2: Run — fails.**
- [ ] **Step 3: `wiki-index.ts`** — rename `deriveFallbackAnnotation`→`deriveFallbackDescription`; add `parseDescriptionFromFm` + `collectDescriptions` (pid→frontmatter description, fallback `deriveFallbackDescription`).
- [ ] **Step 4: `page-similarity.ts`** — the overview map passed into `refreshCache`/`buildChunkInputs` now comes from `collectDescriptions(pages)` (frontmatter) instead of `parseIndexAnnotations(_index.md)`; at the ingest (`:605-609`) and lint (`:452-454`) call sites pass `collectDescriptions(pageObjects)`. In `splitSections`, drop any section whose heading is `## Related` or `## External links` (case-insensitive, localized variants configured in one constant) so they are never embedded.
- [ ] **Step 5: Query seeds + schema** — `query.ts` builds the overview map with `collectDescriptions(pages)`. `wikiSections` (`llm-utils.ts`) + `_wiki_schema.md`: drop the intro-paragraph rule; add `## Related`/`## External links` conventions.
- [ ] **Step 6: Run + scoped tsc** — eval passes; grep (`wiki-index|page-similarity|phases/(ingest|lint|query|llm-utils)`) empty.
- [ ] **Step 7: Commit** — `git commit -m "feat(okf): overview from frontmatter description; exclude Related/External sections from retrieval"`.

---

# Phase 2 — OKF bundle export (depends on Phase 1)

## Task 6: Export helpers (link rewrite, tag normalize, title derive)

**Files:** Create `src/okf-export-utils.ts`; Test `eval/okf-export/run.ts`.

Produces `buildPidToRelpath`, `rewriteWikilinks` (`[[stem]]`/`[[stem|alias]]`→`[text](rel.md)`, dead→text+list), `normalizeExportTags` (`a/b`→`a-b`, dedupe, kebab), `deriveTitle` (H1/slug). TDD as in the spec's Testing section. The body `## Related` `[[links]]` are rewritten by `rewriteWikilinks` automatically. Commit `feat(okf): export helpers`.

(Full TDD steps: write `eval/okf-export/run.ts` with checks for plain/alias/dead link, kebab tags, title-from-H1/slug; run → fail; implement `src/okf-export-utils.ts`; run → pass; commit.)

## Task 7: Bundle serializer (pure, in-memory)

**Files:** Create `src/okf-export.ts`; extend `eval/okf-export/run.ts`.

`buildOkfBundle(pages, indexDescriptions, log) → { files, warnings }`: per page pass OKF frontmatter through, derive `title`, keep `description`, kebab `tags`, `rewriteWikilinks` over the body (covers `## Related`), collect dead-link warnings; generate `index.md` (`- [pid](rel) — <description>`) and `log.md`; reserved-slug collision warnings. TDD (assert link rewrite in `## Related`, generated index/log, collision warning). Commit `feat(okf): bundle serializer`.

## Task 8: Desktop fs writer + controller entry

**Files:** Create `src/okf-export-fs.ts` (`writeOkfBundle(destAbs, bundle)`, guarded by `Platform.isDesktopApp`, lazy `node:fs/promises`); modify `src/controller.ts` (`exportOkf(domain, destAbs)` — enumerate pages via `collectMdInPaths`, read `_index.md` descriptions + `_log.md`, `buildOkfBundle`, `writeOkfBundle`). Verify: scoped tsc + build clean; manual desktop smoke to `/tmp/okf-out`. Commit `feat(okf): desktop fs writer + controller export`.

## Task 9: Export UI (command, sidebar button, modal)

**Files:** `ExportOkfModal` in `src/modals.ts`; register desktop-only `export-okf` command in `src/main.ts`; sidebar button in `src/view.ts`; labels in `src/i18n.ts`. Verify: scoped tsc + build clean; manual UI smoke (modal, export writes bundle; mobile hides it). Commit `feat(okf): export UI`.

---

## Final verification (whole feature)

- [ ] `npx tsx eval/okf-frontmatter/run.ts`, `eval/okf-migrate/run.ts`, `eval/okf-export/run.ts`, `eval/source-deletion/run.ts`, `eval/legacy-sections/run.ts`, `eval/incremental-sources/run.ts` — each exits 0.
- [ ] Scoped tsc clean for all touched files; `npm run build` succeeds; rebuild + commit `dist/main.js`.
- [ ] Desktop smoke: fresh load migrates once (rename + plain resource + links relocated to `## Related`/`## External links` + descriptions); ingest writes OKF frontmatter + body link sections; retrieval excludes the link sections; export produces a conformant bundle with `[md](links)`; mobile hides export.
- [ ] Update `README.md` + `docs/README.ru.md` and the iwiki `obsidian-ai-wiki` domain per the CLAUDE.md doc mandate.
- [ ] Run `/check-chain result`.
