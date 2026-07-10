---
review:
  plan_hash: "728baa9dc52da449"
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
  spec: "25c320acf4396e93"
---
# OKF Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Converge the plugin's generated wiki-page frontmatter to OKF-native field names (drop the `wiki_` prefix) with an idempotent auto-migration, and add an offline OKF-bundle export command.

**Architecture:** A single rename primitive in `raw-frontmatter.ts` maps legacy `wiki_*` field names to OKF-native names; it is applied both at per-write repair and by a one-shot startup migration. `type`/`description` are injected during ingest from the entity-type subdirectory and the page annotation. Source notes keep their `wiki_` prefix but lose the wiki-tracking dates. A separate offline module serializes a domain into an OKF bundle (link rewrite + generated `index.md`/`log.md`).

**Tech Stack:** TypeScript, Obsidian plugin API (`vault.adapter`), `path-browserify`, `yaml`. Tests are hand-rolled `eval/<name>/run.ts` scripts run with `npx tsx`. Node `fs` is used only in the desktop-guarded export writer.

**Spec:** `docs/superpowers/specs/2026-07-09-okf-integration-design.md`

## Global Constraints

- OKF applies to **generated wiki pages only**; source notes keep the `wiki_` prefix.
- Wiki-page OKF field set: `type` (mandatory), `description`, `resource`, `timestamp`, `tags`, `status`, `outgoing_links`, `external_links`. `title` is NOT stored (derived at export). `wiki_type` is removed.
- Field renames (legacy → OKF): `wiki_sources`→`resource`, `wiki_updated`→`timestamp`, `wiki_status`→`status`, `wiki_outgoing_links`→`outgoing_links`, `wiki_external_links`→`external_links`.
- `type` value = the entity-type subdirectory segment of the page path (`!Wiki/<folder>/<type>/<Article>.md`); the generic `entities` folder → `concept`.
- On-disk link syntax stays Obsidian `[[wikilinks]]`; link rewrite to `[md](links)` happens ONLY in the export bundle.
- Wiki tags stay hierarchical (`a/b`) on disk; kebab normalization (`a/b`→`a-b`) happens ONLY at export.
- No new npm dependencies. `node:fs` only inside a `Platform.isDesktopApp` guard, lazily imported.
- Every eval test runs green with `npx tsx eval/<name>/run.ts` (exit code 0).

---

# Phase 1 — Frontmatter convergence (independently shippable)

## Task 1: Rename primitive + wiki-page repair rules

**Files:**
- Modify: `src/utils/raw-frontmatter.ts` (WIKI_PAGE_RULES `:467-477`, `parseWikiSourcesFromFm` `:525`, `ensureWikiSources` `:533`; add `WIKI_FIELD_ALIASES` + `renameWikiPageFields` + `entityTypeFromPath`)
- Test: `eval/okf-frontmatter/run.ts` (create)

**Interfaces:**
- Produces:
  - `WIKI_FIELD_ALIASES: Record<string,string>` — the 5-entry legacy→OKF map.
  - `renameWikiPageFields(content: string): string` — rewrites frontmatter keys per the alias map (last-wins if both present) and drops `wiki_type`. Idempotent; body untouched.
  - `entityTypeFromPath(wikiFolder: string, fullPath: string): string` — the `<type>` subdirectory segment lowercased; `""`/generic `entities` → `concept`.
  - `parseResourceFromFm(content: string): string[]` (renamed from `parseWikiSourcesFromFm`, now reads `resource:`).
  - `ensureResource(content: string, sourceStem: string): { content: string; injected: boolean }` (renamed from `ensureWikiSources`, writes `resource`).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

Create `eval/okf-frontmatter/run.ts`:

```ts
// Run: npx tsx eval/okf-frontmatter/run.ts
import { renameWikiPageFields, entityTypeFromPath, parseResourceFromFm } from "../../src/utils/raw-frontmatter";

let pass = 0, fail = 0; const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; failures.push(name); console.log(`  FAIL  ${name}`); }
}

const legacy = `---
wiki_sources: ["[[Src]]"]
wiki_updated: 2026-07-09
wiki_status: developing
wiki_type: page
wiki_outgoing_links: ["[[wiki_d_x]]"]
wiki_external_links: ["https://a.b"]
---
# X
body [[wiki_d_x]]
`;
const renamed = renameWikiPageFields(legacy);
check("resource present", /^resource:/m.test(renamed));
check("timestamp present", /^timestamp:/m.test(renamed));
check("status present", /^status:/m.test(renamed));
check("outgoing_links present", /^outgoing_links:/m.test(renamed));
check("external_links present", /^external_links:/m.test(renamed));
check("wiki_type dropped", !/wiki_type:/m.test(renamed));
check("no legacy wiki_sources", !/wiki_sources:/m.test(renamed));
check("body preserved", renamed.includes("# X\nbody [[wiki_d_x]]"));
check("idempotent", renameWikiPageFields(renamed) === renamed);

// last-wins when both keys exist
const both = `---\nwiki_sources: ["[[A]]"]\nresource: ["[[B]]"]\n---\n# T\n`;
const bothOut = renameWikiPageFields(both);
check("both→single resource key", (bothOut.match(/^resource:/gm) || []).length === 1);

check("type from subdir", entityTypeFromPath("!Wiki/d", "!Wiki/d/person/wiki_d_alice.md") === "person");
check("type entities→concept", entityTypeFromPath("!Wiki/d", "!Wiki/d/entities/wiki_d_x.md") === "concept");
check("type flat→concept", entityTypeFromPath("!Wiki/d", "!Wiki/d/wiki_d_x.md") === "concept");
check("parseResource reads resource", JSON.stringify(parseResourceFromFm(renamed)) === JSON.stringify(["[[Src]]"]));

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx eval/okf-frontmatter/run.ts`
Expected: FAIL — `renameWikiPageFields`/`entityTypeFromPath`/`parseResourceFromFm` are not exported.

- [ ] **Step 3: Implement the rename primitive and helpers**

In `src/utils/raw-frontmatter.ts`, add near the top (after the existing regex consts):

```ts
export const WIKI_FIELD_ALIASES: Record<string, string> = {
  wiki_sources: "resource",
  wiki_updated: "timestamp",
  wiki_status: "status",
  wiki_outgoing_links: "outgoing_links",
  wiki_external_links: "external_links",
};

/** Rename legacy wiki_* keys to OKF-native names (last-wins), drop wiki_type. Idempotent. */
export function renameWikiPageFields(content: string): string {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return content;
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return content; }

  let modified = false;
  for (const [legacy, okf] of Object.entries(WIKI_FIELD_ALIASES)) {
    if (legacy in parsed) {
      if (!(okf in parsed)) parsed[okf] = parsed[legacy]; // legacy fills only if OKF absent (last-wins on new)
      delete parsed[legacy];
      modified = true;
    }
  }
  if ("wiki_type" in parsed) { delete parsed["wiki_type"]; modified = true; }

  if (!modified) return content;
  const body = content.slice(fmMatch[0].length);
  return `---\n${yamlStringify(parsed)}---\n${body}`;
}

/** Entity-type subdirectory segment of a wiki page path; generic/flat → "concept". */
export function entityTypeFromPath(wikiFolder: string, fullPath: string): string {
  const prefix = wikiFolder.endsWith("/") ? wikiFolder : wikiFolder + "/";
  const rel = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  const parts = rel.split("/");
  const seg = parts.length >= 2 ? parts[0].trim().toLowerCase() : "";
  return !seg || seg === "entities" ? "concept" : seg;
}
```

Rename the readers (keep back-compat exports as thin aliases if any external caller uses the old name — see Task 4 which retargets all callers):

```ts
export function parseResourceFromFm(content: string): string[] {
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return [];
  const match = /resource:\s*\n((?:[ \t]+-[ \t]+[^\n]+\n?)+)/m.exec(fmMatch[1]);
  if (!match) return [];
  return [...match[1].matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => `[[${m[1]}]]`);
}

export function ensureResource(
  content: string,
  sourceStem: string,
): { content: string; injected: boolean } {
  const sources = parseResourceFromFm(content);
  if (sources.length > 0) return { content, injected: false };
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return { content, injected: false };
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return { content, injected: false }; }
  const body = content.slice(fmMatch[0].length);
  parsed.resource = [`[[${sourceStem}]]`];
  return { content: `---\n${yamlStringify(parsed)}---\n${body}`, injected: true };
}
```

Update `WIKI_PAGE_RULES` (`:467-477`) to the OKF names + remove `wiki_type` + add new fields:

```ts
const WIKI_PAGE_RULES: FieldRule[] = [
  { field: "resource",       kind: "list-wikilinks-sources-only" },
  { field: "timestamp",      kind: "date-scalar" },
  { field: "status",         kind: "warn-enum", values: ["stub", "developing", "mature"] },
  { field: "tags",           kind: "list-tags" },
  { field: "aliases",        kind: "aliases" },
  { field: "outgoing_links", kind: "list-wikilinks-wiki-only" },
  { field: "external_links", kind: "list-urls" },
  { field: "wiki_type",      kind: "remove" },
  { field: "annotation",     kind: "remove" },
];
```

Note: there is intentionally NO rule for `type` or `description` — `validateAndRepairFrontmatter` passes unknown fields through untouched, so the injected `type`/`description` (Task 2) survive repair without validation. The `wiki_type: remove` line strips the legacy page-role field even if `renameWikiPageFields` was bypassed. Apply `renameWikiPageFields` at the START of `validateAndRepairWikiPageFrontmatter` so repair emits OKF names:

```ts
export function validateAndRepairWikiPageFrontmatter(
  content: string,
): { content: string; warnings: string[] } {
  const renamed = renameWikiPageFields(content);
  return validateAndRepairFrontmatter(renamed, WIKI_PAGE_RULES);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx eval/okf-frontmatter/run.ts`
Expected: `TOTAL: 14 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add src/utils/raw-frontmatter.ts eval/okf-frontmatter/run.ts
git commit -m "feat(okf): rename primitive + wiki-page repair to OKF-native field names"
```

---

## Task 2: `type` / `description` governance in ingest

**Files:**
- Modify: `src/utils/raw-frontmatter.ts` (add `ensureType`, `ensureDescription`)
- Modify: `src/phases/ingest.ts` (`parseWikiStatus` `:38-39`; write pipeline `:446-467`)
- Modify: `prompts/ingest.md` (`:20-21`, JSON template `:57`), `prompts/ingest-merge.md`
- Test: `eval/okf-frontmatter/run.ts` (extend)

**Interfaces:**
- Consumes: `entityTypeFromPath` (Task 1).
- Produces:
  - `ensureType(content: string, type: string): string` — insert `type:` as the first frontmatter key if absent.
  - `ensureDescription(content: string, annotation: string): string` — insert `description:` (first 1–2 sentences of `annotation`) if absent and annotation non-empty.

- [ ] **Step 1: Write the failing test** — append to `eval/okf-frontmatter/run.ts` before the TOTAL line:

```ts
import { ensureType, ensureDescription } from "../../src/utils/raw-frontmatter";
const noType = `---\nresource: []\n---\n# A\n`;
check("type injected", /^type: person$/m.test(ensureType(noType, "person")));
check("type not duplicated", ensureType(ensureType(noType, "person"), "person").match(/^type:/gm)!.length === 1);
const ann = "Alice is a lead engineer. She owns billing.";
check("description injected", /^description: /m.test(ensureDescription(noType, ann)));
check("description empty→noop", ensureDescription(noType, "") === noType);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx eval/okf-frontmatter/run.ts`
Expected: FAIL — `ensureType`/`ensureDescription` not exported.

- [ ] **Step 3: Implement `ensureType` / `ensureDescription`** in `src/utils/raw-frontmatter.ts`:

```ts
export function ensureType(content: string, type: string): string {
  if (hasFrontmatterField(content, "type")) return content;
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return content;
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return content; }
  const body = content.slice(fmMatch[0].length);
  const ordered = { type, ...parsed };
  return `---\n${yamlStringify(ordered)}---\n${body}`;
}

export function ensureDescription(content: string, annotation: string): string {
  const desc = firstSentences(annotation, 2);
  if (!desc || hasFrontmatterField(content, "description")) return content;
  const fmMatch = FM_RE.exec(content);
  if (!fmMatch) return content;
  let parsed: Record<string, unknown>;
  try { parsed = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; }
  catch { return content; }
  const body = content.slice(fmMatch[0].length);
  parsed.description = desc;
  return `---\n${yamlStringify(parsed)}---\n${body}`;
}

/** First `n` sentences of a one-line annotation, trimmed. */
function firstSentences(text: string, n: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "";
  const parts = t.match(/[^.!?]+[.!?]+/g);
  if (!parts) return t;
  return parts.slice(0, n).join(" ").trim();
}
```

- [ ] **Step 4: Wire governance into ingest** — in `src/phases/ingest.ts`:

Update `parseWikiStatus` (`:38-39`) to read the new field:

```ts
function parseWikiStatus(content: string): string {
  const m = /^---\n[\s\S]*?^status:[ \t]*(.+)$/m.exec(content);
  return m ? m[1].trim() : "unknown";
}
```

Add imports to the `raw-frontmatter` import block (`:19`): `ensureType, ensureDescription, entityTypeFromPath, ensureResource` (and replace `ensureWikiSources` with `ensureResource`).

In the write pipeline, replace the `ensureWikiSources` block (`:467-474`) and inject type/description right before the write. After the `ensureEntityTypeTag` block (`:456-465`):

```ts
const okfType = entityTypeFromPath(wikiVaultPath, page.path);
const typed = ensureType(entityTagged, okfType);
const described = ensureDescription(typed, page.annotation ?? "");
const sourceStem = sourceVaultPath.split("/").pop()!.replace(/\.md$/, "");
const { content: sourcedPage, injected } = ensureResource(described, sourceStem);
```

(the following `yield ... wiki_sources injected` message text should read `resource injected`.)

- [ ] **Step 5: Update the prompt templates** — in `prompts/ingest.md`:

Line 20 becomes:
```
- Frontmatter is mandatory: type: <entity type>, resource, timestamp: {{today}}, status: stub|developing|mature
```
Line 21 `- tags:` unchanged. Replace `wiki_sources`→`resource`, `wiki_outgoing_links`→`outgoing_links` in the field-rule bullets and in the JSON template (`:57`):
```
"content":"---\ntype: <entity type>\nresource: [\"[[{{source_stem}}]]\"]\ntimestamp: {{today}}\nstatus: stub\ntags: []\noutgoing_links: []\n---\n# EntityName\n\ncontent..."
```
Apply the same `wiki_sources`→`resource`, `wiki_outgoing_links`→`outgoing_links`, `wiki_updated`→`timestamp`, `wiki_status`→`status` substitutions throughout `prompts/ingest.md` and `prompts/ingest-merge.md`. Leave the `annotation` field guidance as-is (annotation stays JSON-only; `description` is injected deterministically in TS).

- [ ] **Step 6: Run tests + typecheck**

Run: `npx tsx eval/okf-frontmatter/run.ts`
Expected: `TOTAL: 18 passed, 0 failed`
Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add src/utils/raw-frontmatter.ts src/phases/ingest.ts prompts/ingest.md prompts/ingest-merge.md eval/okf-frontmatter/run.ts
git commit -m "feat(okf): inject type/description on ingest; emit OKF field names in prompts"
```

---

## Task 3: Remove wiki-tracking dates from source notes

**Files:**
- Modify: `src/utils/raw-frontmatter.ts` (`SOURCE_RULES` `:422-438`, `upsertRawFrontmatter` `:485-515`, `restoreSourceFrontmatter` `:454-465`)
- Modify: `src/phases/ingest.ts` (`upsertRawFrontmatter` call `:358-361`)
- Modify: `src/phases/lint.ts` (backlink sync `:625-628`)
- Test: `eval/okf-frontmatter/run.ts` (extend)

**Interfaces:**
- Produces: `upsertRawFrontmatter(content: string, fields: { wiki_articles: string[] }): string` — now writes only `wiki_articles`; strips any `wiki_added`/`wiki_updated`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test** — append to `eval/okf-frontmatter/run.ts`:

```ts
import { validateAndRepairSourceFrontmatter, upsertRawFrontmatter } from "../../src/utils/raw-frontmatter";
const srcNote = `---\nwiki_added: 2026-01-01\nwiki_updated: 2026-07-09\nwiki_articles:\n  - "[[wiki_d_x]]"\ntags: [a]\n---\n# Note\n`;
const repaired = validateAndRepairSourceFrontmatter(srcNote).content;
check("source drops wiki_added", !/wiki_added:/m.test(repaired));
check("source drops wiki_updated", !/wiki_updated:/m.test(repaired));
check("source keeps wiki_articles", /wiki_articles:/m.test(repaired));
const upserted = upsertRawFrontmatter(`---\ntags: [a]\n---\n# N\n`, { wiki_articles: ["[[wiki_d_x]]"] });
check("upsert writes articles only", /wiki_articles:/m.test(upserted) && !/wiki_updated:/m.test(upserted));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx eval/okf-frontmatter/run.ts`
Expected: FAIL — `wiki_added`/`wiki_updated` still present; `upsertRawFrontmatter` signature mismatch.

- [ ] **Step 3: Implement source-side changes** in `src/utils/raw-frontmatter.ts`:

In `SOURCE_RULES` (`:422-438`), change the two date rules to removals:

```ts
  { field: "wiki_added",   kind: "remove" },
  { field: "wiki_updated", kind: "remove" },
```

Rewrite `upsertRawFrontmatter` to accept only `wiki_articles` and strip both dates:

```ts
export function upsertRawFrontmatter(
  content: string,
  fields: { wiki_articles: string[] },
): string {
  const match = FM_RE.exec(content);
  const body = match ? content.slice(match[0].length) : content;
  let existing: Record<string, unknown> = {};
  if (match) {
    try {
      const parsed: unknown = yamlParse(match[1]);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        existing = parsed as Record<string, unknown>;
      }
    } catch { /* malformed — start fresh */ }
  }
  const { wiki_added: _a, wiki_updated: _u, wiki_articles: _ar, ...rest } = existing;
  void _a; void _u; void _ar;
  const result: Record<string, unknown> = { ...rest };
  if (fields.wiki_articles.length > 0) result.wiki_articles = fields.wiki_articles;
  return `---\n${yamlStringify(result)}---\n${body}`;
}
```

Update `restoreSourceFrontmatter` (`:454-465`) to stop threading dates — it now only re-attaches `wiki_articles` and normalizes:

```ts
export function restoreSourceFrontmatter(original: string, formatted: string): string {
  const wiki_articles = parseWikiArticlesFromFm(original);
  if (wiki_articles.length > 0) {
    formatted = upsertRawFrontmatter(formatted, { wiki_articles });
  }
  const { content } = validateAndRepairSourceFrontmatter(formatted);
  return content;
}
```

- [ ] **Step 4: Update call sites**

In `src/phases/ingest.ts` (`:358-361`) change:

```ts
    const updatedSource = upsertRawFrontmatter(normalizedSource, {
      wiki_articles: mergedArticles,
    });
```
(remove the `wiki_added`/`wiki_updated` args; keep whatever variable currently holds the articles list — inspect the surrounding lines and pass only `wiki_articles`.)

In `src/phases/lint.ts` (`:625-628`) change the backlink-sync write the same way:

```ts
      const updated = upsertRawFrontmatter(srcContent, { wiki_articles });
```
(drop `wiki_updated: syncToday`; remove the now-unused `syncToday` local if nothing else uses it.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx tsx eval/okf-frontmatter/run.ts`
Expected: `TOTAL: 22 passed, 0 failed`
Run: `npx tsc --noEmit`
Expected: no errors (fix any remaining `upsertRawFrontmatter` callers the compiler flags).

- [ ] **Step 6: Commit**

```bash
git add src/utils/raw-frontmatter.ts src/phases/ingest.ts src/phases/lint.ts eval/okf-frontmatter/run.ts
git commit -m "feat(okf): drop wiki_added/wiki_updated from source notes"
```

---

## Task 4: Retarget all wiki-page field-name consumers

Mechanical rename of every module that reads/writes wiki-page fields via its own regex, plus the eval fixtures those modules test against. No behavior change — only field names.

**Files:**
- Modify: `src/source-deletion.ts` (`:28`), `src/phases/query.ts` (`:357-359`), `src/wiki-link-validator.ts` (`:34-47,:62-69,:112-117`), `src/phases/lint.ts` (`:49,:100-132,:462,:537,:579,:607`), `src/phases/zod-schemas.ts` (`:55-59`), `src/strip-legacy-sections.ts` (`:70-86`), `src/utils/vault-walk.ts` (`:22`), `src/incremental-sources.ts` (`:81`)
- Modify: any `eval/*/run.ts` fixtures containing `wiki_sources`/`wiki_outgoing_links`/`wiki_status`/`wiki_updated` on wiki pages (notably `eval/source-deletion/`, `eval/legacy-sections/`)
- Test: existing evals for the touched modules

**Interfaces:**
- Consumes: `parseResourceFromFm` (Task 1, replaces `parseWikiSourcesFromFm`).
- Produces: no new exports; call sites of `parseWikiSourcesFromFm`/`ensureWikiSources` switch to `parseResourceFromFm`/`ensureResource`.

- [ ] **Step 1: Find every occurrence**

Run:
```bash
grep -rn "wiki_sources\|wiki_updated\|wiki_status\|wiki_outgoing_links\|wiki_external_links\|parseWikiSourcesFromFm\|ensureWikiSources" src eval | grep -v "raw-frontmatter.ts"
```
Expected: the consumer lines listed above (plus source-note lines in `incremental-sources.ts` / `vault-walk.ts` — see Step 3 for which are wiki-page vs source-note).

- [ ] **Step 2: Rename wiki-page field references (per file)**

Apply these exact substitutions. Each is a wiki-page read/write, so the field renames apply:

`src/source-deletion.ts:28` — `wiki_sources:` → `resource:` in the regex.

`src/phases/query.ts:357-359` — the written frontmatter lines:
```ts
      `type: concept`,
      `resource: []`,
      `timestamp: ${today}`,
      `status: mature`,
```
(add the `type: concept` line; rename the other three.)

`src/wiki-link-validator.ts` — replace every literal `wiki_outgoing_links` with `outgoing_links` (`:34,:45,:47,:66,:117,:214` and any regex/format string). The link-field semantics are unchanged.

`src/phases/lint.ts` — `:49` `/wiki_sources:/` → `/resource:/`; `:100-132` block/inline normalizer `wiki_sources`→`resource`; `:537,:579` bucket `["wiki_outgoing_links"]` → `["outgoing_links"]`; `:607` replace `parseWikiSourcesFromFm` → `parseResourceFromFm`; update the comment at `:110` to name the new fields.

`src/phases/zod-schemas.ts:55` — `wiki_sources:` → `resource:` in the regex; `:59` message text `wiki_sources` → `resource`.

`src/strip-legacy-sections.ts:70-86` — `wiki_outgoing_links` → `outgoing_links` (both the `fm.wiki_outgoing_links` read and the write).

`src/utils/vault-walk.ts:22` — `parseWikiSources` reads a wiki-page `wiki_sources:` → `resource:`.

`src/incremental-sources.ts:81` — `parsePageSources` reads a WIKI page's `wiki_sources:` → `resource:`.

Then fix the import in each file that imported `parseWikiSourcesFromFm` / `ensureWikiSources` to use `parseResourceFromFm` / `ensureResource`.

- [ ] **Step 3: Update eval fixtures**

In every `eval/*/run.ts` (and any `eval/*/fixtures`) that constructs a WIKI-page string with `wiki_sources:`/`wiki_updated:`/`wiki_status:`/`wiki_outgoing_links:`, rename those keys to `resource:`/`timestamp:`/`status:`/`outgoing_links:`. Leave SOURCE-note fixtures' `wiki_articles` untouched, and remove any `wiki_added`/`wiki_updated` from source-note fixtures (Task 3 strips them). Use the Step 1 grep over `eval` to locate them.

- [ ] **Step 4: Typecheck + run touched evals**

Run:
```bash
npx tsc --noEmit
npx tsx eval/source-deletion/run.ts
npx tsx eval/legacy-sections/run.ts
```
Expected: `tsc` clean; each eval prints its OK/TOTAL line with 0 failures. If a fixture eval still references a renamed field, fix the fixture (not the source).

- [ ] **Step 5: Commit**

```bash
git add src eval
git commit -m "refactor(okf): retarget wiki-page field consumers to OKF-native names"
```

---

## Task 5: Auto-migration of existing wiki pages

**Files:**
- Create: `src/migrate-okf-frontmatter.ts`
- Modify: `src/local-config.ts` (add `migrated_okf_frontmatter?: boolean` to the LocalConfig type)
- Modify: `src/main.ts` (`:13-14` import, insert await block after `:56`)
- Test: `eval/okf-migrate/run.ts` (create)

**Interfaces:**
- Consumes: `renameWikiPageFields`, `ensureType`, `ensureDescription`, `entityTypeFromPath` (Task 1–2); `collectMdInPaths` (`src/utils/vault-walk.ts`); `domainWikiFolder`, `domainIndexPath` (`src/wiki-path.ts`); `parseIndexAnnotations` (`src/wiki-index.ts`).
- Produces: `migrateWikiPageOkf(content: string, wikiFolder: string, fullPath: string, annotation: string): string` (pure, testable) and `migrateOkfFrontmatter(vault: Vault, domains: DomainEntry[], localConfigStore: LocalConfigStore): Promise<void>` (the driver).

- [ ] **Step 1: Write the failing test**

Create `eval/okf-migrate/run.ts`:

```ts
// Run: npx tsx eval/okf-migrate/run.ts
import { migrateWikiPageOkf } from "../../src/migrate-okf-frontmatter";

let pass = 0, fail = 0; const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; failures.push(name); console.log(`  FAIL  ${name}`); }
}

const legacy = `---
wiki_sources: ["[[Src]]"]
wiki_updated: 2026-07-09
wiki_status: developing
wiki_type: page
wiki_outgoing_links: []
---
# Alice
Alice leads billing.
`;
const out = migrateWikiPageOkf(legacy, "!Wiki/d", "!Wiki/d/person/wiki_d_alice.md", "Alice leads billing. Owns invoices.");
check("resource", /^resource:/m.test(out));
check("timestamp", /^timestamp:/m.test(out));
check("status", /^status:/m.test(out));
check("type=person", /^type: person$/m.test(out));
check("description set", /^description: /m.test(out));
check("no wiki_type", !/wiki_type:/m.test(out));
check("no wiki_sources", !/wiki_sources:/m.test(out));
check("idempotent", migrateWikiPageOkf(out, "!Wiki/d", "!Wiki/d/person/wiki_d_alice.md", "Alice leads billing. Owns invoices.") === out);

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx eval/okf-migrate/run.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the migration module**

Create `src/migrate-okf-frontmatter.ts`:

```ts
import { Notice, type Vault } from "obsidian";
import type { DomainEntry } from "./domain";
import type { LocalConfigStore } from "./local-config";
import { domainWikiFolder, domainIndexPath } from "./wiki-path";
import { collectMdInPaths } from "./utils/vault-walk";
import { parseIndexAnnotations } from "./wiki-index";
import { renameWikiPageFields, ensureType, ensureDescription, entityTypeFromPath } from "./utils/raw-frontmatter";

/** Pure transform: rename legacy fields, inject type (from path) + description (from annotation). Idempotent. */
export function migrateWikiPageOkf(
  content: string,
  wikiFolder: string,
  fullPath: string,
  annotation: string,
): string {
  let out = renameWikiPageFields(content);
  out = ensureType(out, entityTypeFromPath(wikiFolder, fullPath));
  out = ensureDescription(out, annotation);
  return out;
}

/** One-shot, flag-guarded startup migration of every wiki page to OKF-native frontmatter. */
export async function migrateOkfFrontmatter(
  vault: Vault,
  domains: DomainEntry[],
  localConfigStore: LocalConfigStore,
): Promise<void> {
  const local = await localConfigStore.load();
  if (local.migrated_okf_frontmatter) return;

  let filesChanged = 0;
  for (const domain of domains) {
    const wikiFolder = domainWikiFolder(domain.wiki_folder);
    // pid → annotation, for the description backfill
    let annById = new Map<string, string>();
    try {
      const idx = await vault.adapter.read(domainIndexPath(wikiFolder));
      annById = parseIndexAnnotations(idx);
    } catch { /* no index yet */ }

    for (const file of collectMdInPaths(vault, [wikiFolder])) {
      if (file.basename.startsWith("_")) continue;
      const before = await vault.adapter.read(file.path);
      const annotation = annById.get(file.basename) ?? "";
      const after = migrateWikiPageOkf(before, wikiFolder, file.path, annotation);
      if (after !== before) {
        await vault.adapter.write(file.path, after);
        filesChanged++;
      }
    }
  }

  await localConfigStore.save({ ...local, migrated_okf_frontmatter: true });
  if (filesChanged > 0) {
    new Notice(`AI Wiki: OKF frontmatter migrated — ${filesChanged} pages`);
  }
}
```

- [ ] **Step 4: Add the LocalConfig flag** — in `src/local-config.ts`, add to the config interface:

```ts
  migrated_okf_frontmatter?: boolean;
```

- [ ] **Step 5: Wire into `main.ts`** — add the import (`:14`):

```ts
import { migrateOkfFrontmatter } from "./migrate-okf-frontmatter";
```

Insert after the `migrateDropSections` try/catch (after `:56`, before `this.controller = ...`):

```ts
    try {
      const domains = await this.domainStore.load();
      await migrateOkfFrontmatter(this.app.vault, domains, this.localConfigStore);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      new Notice(`AI Wiki: OKF frontmatter migration failed — ${msg}`, 0);
      console.error("[AI Wiki] OKF frontmatter migration error:", e);
    }
```

- [ ] **Step 6: Run test + typecheck + build**

Run:
```bash
npx tsx eval/okf-migrate/run.ts
npx tsc --noEmit
npm run build
```
Expected: eval `TOTAL: 8 passed, 0 failed`; `tsc` clean; build succeeds.

- [ ] **Step 7: Commit**

```bash
git add src/migrate-okf-frontmatter.ts src/local-config.ts src/main.ts eval/okf-migrate/run.ts
git commit -m "feat(okf): one-shot startup migration of wiki pages to OKF frontmatter"
```

---

# Phase 2 — OKF bundle export (depends on Phase 1)

## Task 6: Link rewrite + tag normalization + title derivation (pure helpers)

**Files:**
- Create: `src/okf-export-utils.ts`
- Test: `eval/okf-export/run.ts` (create)

**Interfaces:**
- Produces:
  - `buildPidToRelpath(pageRelpaths: string[]): Map<string,string>` — page-stem → bundle-relative `.md` path.
  - `rewriteWikilinks(body: string, pidToRel: Map<string,string>): { body: string; dead: string[] }` — `[[stem]]`/`[[stem|alias]]` → `[text](rel.md)`; unknown stem → plain text, listed in `dead`.
  - `normalizeExportTags(tags: string[]): string[]` — `a/b`→`a-b`, dedupe, kebab.
  - `deriveTitle(content: string, slug: string): string` — H1 text, else slug.

- [ ] **Step 1: Write the failing test**

Create `eval/okf-export/run.ts`:

```ts
// Run: npx tsx eval/okf-export/run.ts
import { rewriteWikilinks, normalizeExportTags, deriveTitle, buildPidToRelpath } from "../../src/okf-export-utils";

let pass = 0, fail = 0; const failures: string[] = [];
function check(name: string, cond: boolean) {
  if (cond) pass++; else { fail++; failures.push(name); console.log(`  FAIL  ${name}`); }
}

const rel = buildPidToRelpath(["person/wiki_d_alice.md", "tool/wiki_d_docker.md"]);
const r1 = rewriteWikilinks("See [[wiki_d_alice]] and [[wiki_d_docker|Docker]].", rel);
check("plain link", r1.body.includes("[wiki_d_alice](person/wiki_d_alice.md)"));
check("alias link", r1.body.includes("[Docker](tool/wiki_d_docker.md)"));
const r2 = rewriteWikilinks("Dead [[wiki_d_ghost]].", rel);
check("dead → text", r2.body.includes("wiki_d_ghost") && !r2.body.includes("]("));
check("dead listed", r2.dead.includes("wiki_d_ghost"));
check("tags kebab", JSON.stringify(normalizeExportTags(["a/b", "a/b", "C D"])) === JSON.stringify(["a-b", "c-d"]));
check("title from H1", deriveTitle("---\n---\n# Alice Cooper\nx", "wiki_d_alice") === "Alice Cooper");
check("title fallback slug", deriveTitle("no heading", "wiki_d_alice") === "wiki_d_alice");

console.log(`TOTAL: ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log(`FAILED: ${failures.join(", ")}`); process.exitCode = 1; }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx eval/okf-export/run.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the helpers**

Create `src/okf-export-utils.ts`:

```ts
import { normalizeTag } from "./utils/raw-frontmatter";

/** page-stem → bundle-relative path (folders preserved). */
export function buildPidToRelpath(pageRelpaths: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const rel of pageRelpaths) {
    const stem = rel.split("/").pop()!.replace(/\.md$/, "");
    map.set(stem, rel);
  }
  return map;
}

const WIKILINK = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;

/** Rewrite [[stem]] / [[stem|alias]] → [text](rel.md). Unknown stem → plain text. */
export function rewriteWikilinks(
  body: string,
  pidToRel: Map<string, string>,
): { body: string; dead: string[] } {
  const dead: string[] = [];
  const out = body.replace(WIKILINK, (_m, stem: string, alias?: string) => {
    const key = stem.trim();
    const rel = pidToRel.get(key);
    const text = (alias ?? key).trim();
    if (!rel) { dead.push(key); return text; }
    return `[${text}](${rel})`;
  });
  return { body: out, dead };
}

/** a/b → a-b, dedupe, kebab-case. */
export function normalizeExportTags(tags: string[]): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const norm = normalizeTag(t).replace(/\//g, "-");
    if (norm && !out.includes(norm)) out.push(norm);
  }
  return out;
}

/** H1 text, else the slug. */
export function deriveTitle(content: string, slug: string): string {
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  const h1 = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return h1 || slug;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx eval/okf-export/run.ts`
Expected: `TOTAL: 7 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add src/okf-export-utils.ts eval/okf-export/run.ts
git commit -m "feat(okf): export helpers — link rewrite, tag normalize, title derive"
```

---

## Task 7: Bundle serializer (pure, in-memory)

**Files:**
- Create: `src/okf-export.ts`
- Test: `eval/okf-export/run.ts` (extend)

**Interfaces:**
- Consumes: `buildPidToRelpath`, `rewriteWikilinks`, `normalizeExportTags`, `deriveTitle` (Task 6).
- Produces:
  - `type OkfPage = { relpath: string; content: string }`
  - `type OkfBundle = { files: Array<{ relpath: string; content: string }>; warnings: string[] }`
  - `buildOkfBundle(pages: OkfPage[], indexAnnotations: Map<string,string>, log: string): OkfBundle` — returns the full set of bundle files (per-page + generated `index.md` + `log.md`) plus warnings. No IO.

- [ ] **Step 1: Write the failing test** — append to `eval/okf-export/run.ts`:

```ts
import { buildOkfBundle } from "../../src/okf-export";
const pages = [
  { relpath: "person/wiki_d_alice.md", content: `---\ntype: person\nresource: ["[[Src]]"]\ntimestamp: 2026-07-09\ntags: [team/eng]\n---\n# Alice\nWorks with [[wiki_d_docker]].\n` },
  { relpath: "tool/wiki_d_docker.md", content: `---\ntype: tool\ntimestamp: 2026-07-09\n---\n# Docker\n` },
];
const bundle = buildOkfBundle(pages, new Map([["wiki_d_alice", "Alice leads billing."]]), "log line\n");
const alice = bundle.files.find(f => f.relpath === "person/wiki_d_alice.md")!;
check("link rewritten", alice.content.includes("[wiki_d_docker](tool/wiki_d_docker.md)"));
check("title derived", /^title: Alice$/m.test(alice.content));
check("tags kebab", /team-eng/.test(alice.content));
check("index.md generated", bundle.files.some(f => f.relpath === "index.md"));
check("log.md generated", bundle.files.some(f => f.relpath === "log.md"));

const collide = [{ relpath: "index.md", content: "# real page\n" }];
const b2 = buildOkfBundle(collide, new Map(), "");
check("reserved collision warned", b2.warnings.some(w => w.includes("index.md")));
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx eval/okf-export/run.ts`
Expected: FAIL — `buildOkfBundle` not defined.

- [ ] **Step 3: Implement the serializer**

Create `src/okf-export.ts`:

```ts
import { parse as yamlParse, stringify as yamlStringify } from "yaml";
import {
  buildPidToRelpath, rewriteWikilinks, normalizeExportTags, deriveTitle,
} from "./okf-export-utils";

export interface OkfPage { relpath: string; content: string }
export interface OkfBundle {
  files: Array<{ relpath: string; content: string }>;
  warnings: string[];
}

const FM_RE = /^---\n([\s\S]*?)\n---\n?/;
const RESERVED = new Set(["index.md", "log.md"]);

export function buildOkfBundle(
  pages: OkfPage[],
  indexAnnotations: Map<string, string>,
  log: string,
): OkfBundle {
  const warnings: string[] = [];
  const pidToRel = buildPidToRelpath(pages.map((p) => p.relpath));
  const files: Array<{ relpath: string; content: string }> = [];

  for (const page of pages) {
    if (RESERVED.has(page.relpath)) {
      warnings.push(`source page '${page.relpath}' collides with the reserved OKF '${page.relpath}' — overwritten`);
    }
    const slug = page.relpath.split("/").pop()!.replace(/\.md$/, "");
    const fmMatch = FM_RE.exec(page.content);
    const body = fmMatch ? page.content.slice(fmMatch[0].length) : page.content;

    let fm: Record<string, unknown> = {};
    if (fmMatch) { try { fm = (yamlParse(fmMatch[1]) as Record<string, unknown>) ?? {}; } catch { fm = {}; } }

    if (!("type" in fm)) fm.type = "concept";
    if (!("title" in fm)) fm.title = deriveTitle(page.content, slug);
    if (!("description" in fm)) {
      const ann = indexAnnotations.get(slug);
      if (ann) fm.description = ann;
    }
    if (Array.isArray(fm.tags)) fm.tags = normalizeExportTags(fm.tags as string[]);

    const { body: rewritten, dead } = rewriteWikilinks(body, pidToRel);
    for (const d of dead) warnings.push(`${page.relpath}: dead link [[${d}]] → plain text`);

    files.push({ relpath: page.relpath, content: `---\n${yamlStringify(fm)}---\n${rewritten}` });
  }

  files.push({ relpath: "index.md", content: buildIndex(pages, indexAnnotations) });
  files.push({ relpath: "log.md", content: `# Log\n\n${log}` });
  return { files, warnings };
}

function buildIndex(pages: OkfPage[], ann: Map<string, string>): string {
  const lines = ["# Index", ""];
  for (const p of pages) {
    const slug = p.relpath.split("/").pop()!.replace(/\.md$/, "");
    const desc = ann.get(slug) ?? "";
    lines.push(`- [${slug}](${p.relpath})${desc ? " — " + desc : ""}`);
  }
  return lines.join("\n") + "\n";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx eval/okf-export/run.ts`
Expected: `TOTAL: 13 passed, 0 failed`

- [ ] **Step 5: Commit**

```bash
git add src/okf-export.ts eval/okf-export/run.ts
git commit -m "feat(okf): pure in-memory OKF bundle serializer"
```

---

## Task 8: Desktop filesystem writer + controller entry point

**Files:**
- Create: `src/okf-export-fs.ts`
- Modify: `src/controller.ts` (add an `exportOkf(domain, dest)` method that gathers pages and calls the writer)
- Test: manual (desktop) — no eval (touches `node:fs` + Obsidian)

**Interfaces:**
- Consumes: `buildOkfBundle` (Task 7); `collectMdInPaths`, `domainWikiFolder`, `domainIndexPath`, `parseIndexAnnotations`; `WikiController.cwdOrEmpty()` (`:353`).
- Produces:
  - `writeOkfBundle(destAbs: string, bundle: OkfBundle): Promise<void>` — desktop-guarded `node:fs/promises` writer (mkdir -p per file dir, write each file).
  - `WikiController.exportOkf(domain: DomainEntry, destAbs: string): Promise<{ pages: number; warnings: string[] }>`.

- [ ] **Step 1: Implement the fs writer** — create `src/okf-export-fs.ts`:

```ts
import { Platform } from "obsidian";
import type { OkfBundle } from "./okf-export";

/** Write a bundle to an absolute filesystem path. Desktop only. */
export async function writeOkfBundle(destAbs: string, bundle: OkfBundle): Promise<void> {
  if (!Platform.isDesktopApp) throw new Error("OKF export is desktop-only");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  for (const file of bundle.files) {
    const abs = path.join(destAbs, file.relpath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, file.content, "utf8");
  }
}
```

- [ ] **Step 2: Add the controller method** — in `src/controller.ts`, add:

```ts
async exportOkf(domain: DomainEntry, destAbs: string): Promise<{ pages: number; warnings: string[] }> {
  const { collectMdInPaths } = await import("./utils/vault-walk");
  const { domainWikiFolder, domainIndexPath } = await import("./wiki-path");
  const { parseIndexAnnotations } = await import("./wiki-index");
  const { buildOkfBundle } = await import("./okf-export");
  const { writeOkfBundle } = await import("./okf-export-fs");

  const wikiFolder = domainWikiFolder(domain.wiki_folder);
  const prefix = wikiFolder + "/";
  const pages: Array<{ relpath: string; content: string }> = [];
  for (const file of collectMdInPaths(this.app.vault, [wikiFolder])) {
    if (file.basename.startsWith("_")) continue;
    const content = await this.app.vault.adapter.read(file.path);
    const relpath = file.path.startsWith(prefix) ? file.path.slice(prefix.length) : file.path;
    pages.push({ relpath, content });
  }
  let annotations = new Map<string, string>();
  let log = "";
  try { annotations = parseIndexAnnotations(await this.app.vault.adapter.read(domainIndexPath(wikiFolder))); } catch { /* */ }
  try { log = await this.app.vault.adapter.read(`${wikiFolder}/_log.md`); } catch { /* */ }

  const bundle = buildOkfBundle(pages, annotations, log);
  await writeOkfBundle(destAbs, bundle);
  return { pages: pages.length, warnings: bundle.warnings };
}
```

(Confirm `this.app` exists on the controller; if the controller holds `vault` directly, use that. Match the existing field.)

- [ ] **Step 3: Typecheck + build**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: clean.

- [ ] **Step 4: Manual smoke test (desktop)**

In Obsidian devtools console (or a temporary command), call `controller.exportOkf(domain, "/tmp/okf-out")` for a small domain. Verify `/tmp/okf-out` contains per-page `.md` files with OKF frontmatter, markdown-link bodies, plus `index.md` and `log.md`.

- [ ] **Step 5: Commit**

```bash
git add src/okf-export-fs.ts src/controller.ts
git commit -m "feat(okf): desktop fs writer + controller export entry point"
```

---

## Task 9: Export UI — command, sidebar button, destination modal

**Files:**
- Create: `ExportOkfModal` in `src/modals.ts`
- Modify: `src/main.ts` (register `export-okf` command, desktop-only)
- Modify: `src/view.ts` (add an "Export OKF" sidebar button in the desktop action row)
- Modify: `src/i18n.ts` (add `cmd.exportOkf` label + button label)
- Test: manual (UI)

**Interfaces:**
- Consumes: `WikiController.exportOkf` (Task 8); `ConfirmModal`/`QueryModal` patterns (`src/modals.ts`).
- Produces: `class ExportOkfModal extends Modal` with `constructor(app: App, defaultDest: string, onSubmit: (dest: string) => void)`.

- [ ] **Step 1: Add the modal** — in `src/modals.ts`, following the `QueryModal` template (`:94-120`):

```ts
export class ExportOkfModal extends Modal {
  constructor(app: App, private defaultDest: string, private onSubmit: (dest: string) => void) { super(app); }
  onOpen() {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: "Export OKF bundle" });
    const input = contentEl.createEl("input", { type: "text", value: this.defaultDest });
    input.style.width = "100%";
    input.placeholder = "/absolute/path/to/output-folder";
    new Setting(contentEl).addButton((b) =>
      b.setButtonText("Export").setCta().onClick(() => {
        const dest = input.value.trim();
        if (dest) { this.close(); this.onSubmit(dest); }
      }),
    );
  }
  onClose() { this.contentEl.empty(); }
}
```

- [ ] **Step 2: Register the command** — in `src/main.ts`, inside the existing `if (!Platform.isMobile) { ... }` block (near `:112`):

```ts
      this.addCommand({
        id: "export-okf",
        name: T.cmd.exportOkf,
        callback: () => {
          const domain = this.controller.currentDomain(); // use the existing "selected domain" accessor
          if (!domain) { new Notice("Select a domain first"); return; }
          const defaultDest = `${this.controller.cwdOrEmpty()}/okf-export/${domain.wiki_folder}`;
          new ExportOkfModal(this.app, defaultDest, (dest) => {
            void this.controller.exportOkf(domain, dest).then((r) =>
              new Notice(`OKF export: ${r.pages} pages → ${dest}` + (r.warnings.length ? ` (${r.warnings.length} warnings)` : "")),
            ).catch((e) => new Notice(`OKF export failed: ${(e as Error).message}`, 0));
          }).open();
        },
      });
```

(Adjust `currentDomain()` to the controller's real selected-domain accessor; import `ExportOkfModal` and `Notice`.)

- [ ] **Step 3: Add the sidebar button** — in `src/view.ts`, in the desktop action row (near `:382-392`), following the existing `createEl("button", ...)` pattern:

```ts
    if (!Platform.isMobile) {
      const exportBtn = actionRow.createEl("button", { text: T.btn.exportOkf });
      exportBtn.addEventListener("click", () => {
        (this.app as any).commands?.executeCommandById?.(`${this.plugin.manifest.id}:export-okf`);
      });
    }
```

(Prefer calling the same code path as the command; if the view already has a controller reference, open `ExportOkfModal` directly instead of via `executeCommandById`.)

- [ ] **Step 4: Add i18n labels** — in `src/i18n.ts`, add `exportOkf` to the `cmd` and `btn` label groups (both language tables), e.g. `exportOkf: "Export OKF bundle"` / the Russian equivalent.

- [ ] **Step 5: Typecheck + build**

Run:
```bash
npx tsc --noEmit
npm run build
```
Expected: clean.

- [ ] **Step 6: Manual UI smoke test (desktop)**

Enable the built plugin, select a domain, run Command Palette → "Export OKF bundle" (and the sidebar button). Confirm the modal appears with the default path, and export writes the bundle. On mobile the command/button must be absent.

- [ ] **Step 7: Commit**

```bash
git add src/modals.ts src/main.ts src/view.ts src/i18n.ts
git commit -m "feat(okf): export UI — command, sidebar button, destination modal"
```

---

## Final verification (whole feature)

- [ ] Run every OKF eval:
```bash
npx tsx eval/okf-frontmatter/run.ts
npx tsx eval/okf-migrate/run.ts
npx tsx eval/okf-export/run.ts
npx tsx eval/source-deletion/run.ts
npx tsx eval/legacy-sections/run.ts
```
Expected: each exits 0.
- [ ] `npx tsc --noEmit` clean; `npm run build` succeeds.
- [ ] Desktop smoke: fresh load runs the OKF migration once (Notice shows page count); ingest writes OKF-named pages with `type`/`description`; export produces a conformant bundle; mobile hides the export command.
- [ ] Update `README.md` + `docs/README.ru.md` (Features table: note OKF-native wiki frontmatter + the Export OKF command) and the iwiki `obsidian-ai-wiki` domain per the CLAUDE.md doc mandate.
- [ ] Run `/check-chain result` to reconcile the diff against this plan and the spec.
