---
review:
  plan_hash: ba2c925c841559e6
  spec_hash: 5ac0478ad0860003
  last_run: 2026-06-22
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      severity: WARNING
      section: "Task 3 / spec Component 3"
      section_hash: c6cb75185ce626b2
      text: "reconcileIndex signature diverges from the spec's illustrative form (spec: reconcileIndex(indexContent, pageFiles, getAnnotation) → adds:{pid,section,annotation}; plan: reconcileIndex(indexContent, wikiFolder, pages[{path,content,annotation?}]) → adds:{pid,annotation,fullPath}). Same requirements covered; the 'Notes / deviations' section does not record this signature change."
      verdict: fixed
      resolution: "Notes / deviations from spec now records the reconcileIndex signature change and its rationale (fallback deriver called internally, wikiFolder for section derivation, fullPath in adds)."
    - id: F-002
      severity: WARNING
      section: "Task 5 Step 3 / spec Testing"
      section_hash: 7600cd910a2e0df7
      text: "Spec Testing lists 'empty-section cleanup on removal' for reconcileIndex, but no eval in the plan asserts removeIndexAnnotation drops an emptied section. Coverage relies on the existing removeIndexAnnotation behavior (spec line 91) without a regression check."
      verdict: fixed
      resolution: "Notes / deviations explains empty-section cleanup is delegated to in-production removeIndexAnnotation (wiki-index.ts:106-116); Task 6 Step 5 adds an explicit empty-section assertion (awk check) that closes it end-to-end on the rtk-task fixture."
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-22-wiki-dead-links-index-reconciliation-design.md
result_check:
  verdict: OK
  plan_hash: ba2c925c841559e6
  last_run: 2026-06-22
---

# Wiki Dead-Link Removal & Index Reconciliation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make dead `[[links]]` and `_index.md`↔disk drift self-healing deterministically (no LLM), so articles carry no broken links and every page is indexed and retrievable.

**Architecture:** Three new pure functions — `stripDeadLinks` (in `src/wiki-link-validator.ts`), `deriveFallbackAnnotation` and `reconcileIndex` (in `src/wiki-index.ts`) — are unit-tested headlessly via the esbuild eval harness, then wired into ingest (prevention) and lint (cure). Dead-link removal always runs (not gated on retries/LLM); index reconciliation is bidirectional (add missing pages, remove orphan entries).

**Tech Stack:** TypeScript, esbuild (bundling + eval harness), Obsidian plugin runtime, `yaml`. No new dependencies.

## Global Constraints

- All new behavior must work with the LLM disabled (deterministic string/index ops only).
- A link is dead **iff** its trailing stem ∉ vault-wide `knownStems` (all `.md` stems + pages written this run + title-map stems). Links to source notes are never dead.
- Dead-link removal deletes the whole `[[...]]` token (including visible text); emptied table cells are left intact.
- Fallback annotation = `"<H1> — <first body sentence>. Type: <entityType>"`, single line, truncated to ≤800 chars.
- `tsc` baseline is NOT clean (~135 pre-existing errors in untouched files). Gate on NEW errors in touched files only, never on "tsc clean".
- `npm run lint` mirrors the Obsidian reviewer; keep node builtins lazy + desktop-guarded (not relevant here — pure string/index code).
- Reconciliation edits only `_index.md`; it never creates or deletes page files.
- Match existing module style; reuse existing private helpers (`splitFrontmatter`, `extractLinks`, `setFmLinks`, `deriveSection`, `parseIndexAnnotations`).

---

### Task 1: `stripDeadLinks` in `wiki-link-validator.ts`

Remove dead `[[links]]` from an article body, tidy the resulting whitespace/punctuation, then re-derive `wiki_outgoing_links` from the cleaned body so frontmatter and body stay synced.

**Files:**
- Modify: `src/wiki-link-validator.ts` (add exported `stripDeadLinks` + private `tidyAfterRemoval`)
- Create: `eval/wiki-hygiene/run.ts` (new eval harness; this task adds the `stripDeadLinks` block)
- Create: `eval/wiki-hygiene/.gitignore` (ignore the built `run.cjs`)

**Interfaces:**
- Consumes: existing module-private `splitFrontmatter(content) → [fm, body] | null`, `extractLinks(text) → string[]`, `setFmLinks(fm, links: string[]) → string`.
- Produces: `export function stripDeadLinks(content: string, knownStems: Set<string>): string`

- [ ] **Step 1: Create the eval `.gitignore`**

Create `eval/wiki-hygiene/.gitignore`:

```
run.cjs
```

- [ ] **Step 2: Write the failing eval for `stripDeadLinks`**

Create `eval/wiki-hygiene/run.ts`:

```ts
/**
 * Out-of-vault eval for the wiki-hygiene pure functions. Exercises the REAL
 * functions from src/ against synthetic fixtures. No vault, no LLM, no DOM.
 *
 * Build & run (from repo root):
 *   node_modules/.bin/esbuild eval/wiki-hygiene/run.ts \
 *     --bundle --platform=node --format=cjs \
 *     --outfile=eval/wiki-hygiene/run.cjs
 *   node eval/wiki-hygiene/run.cjs
 */
import { stripDeadLinks } from "../../src/wiki-link-validator";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}

console.log("\n=== stripDeadLinks ===");
{
  // known = {alive}. dead link in prose + table + frontmatter outgoing.
  const known = new Set(["alive", "src_note"]);
  const content = [
    "---",
    "wiki_sources:",
    '  - "[[src_note]]"',
    "wiki_outgoing_links:",
    '  - "[[alive]]"',
    '  - "[[dead]]"',
    "---",
    "# Title",
    "",
    "Refs [[alive]] and [[dead]] inline.",
    "",
    "| Field | Value |",
    "|-------|-------|",
    "| Rel | [[dead]] |",
  ].join("\n");
  const out = stripDeadLinks(content, known);
  check("dead link removed from body prose", !out.includes("[[dead]]"), out);
  check("alive link kept", out.includes("[[alive]]"));
  check("source-note link in wiki_sources untouched", out.includes('"[[src_note]]"'));
  check("wiki_outgoing_links re-synced (no dead)", /wiki_outgoing_links:\n {2}- "\[\[alive\]\]"\n---/.test(out), out);
  check("no double space left in prose", !/Refs {2}and/.test(out) && out.includes("Refs alive and"), out);
}
{
  // dead link at sentence end → no dangling space before period.
  const out = stripDeadLinks("# T\n\nSee [[gone]].\n", new Set<string>());
  check("dangling space before period tidied", out.includes("See.") || out.includes("See ."), JSON.stringify(out));
}
{
  // no frontmatter → operate on whole content as body, no crash.
  const out = stripDeadLinks("plain [[gone]] text", new Set<string>());
  check("no-frontmatter body cleaned", out === "plain text", JSON.stringify(out));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("FAILURES:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
```

- [ ] **Step 3: Run the eval to verify it fails**

Run:
```bash
node_modules/.bin/esbuild eval/wiki-hygiene/run.ts --bundle --platform=node --format=cjs --outfile=eval/wiki-hygiene/run.cjs && node eval/wiki-hygiene/run.cjs
```
Expected: build FAILS — `stripDeadLinks` is not exported from `wiki-link-validator` (esbuild: "No matching export").

- [ ] **Step 4: Implement `stripDeadLinks`**

In `src/wiki-link-validator.ts`, add at the end of the file (after `checkWikiLinks`):

```ts
function tidyAfterRemoval(text: string): string {
  return text
    .replace(/ +([,.;:)\]])/g, "$1") // drop space before punctuation
    .replace(/[ \t]+$/gm, "");        // trim trailing spaces per line
}

// Remove [[links]] whose trailing stem is not in knownStems (dead links), then
// re-derive wiki_outgoing_links from the cleaned body so fm and body stay synced.
// Deterministic — safe to run unconditionally (no LLM, no retries).
export function stripDeadLinks(content: string, knownStems: Set<string>): string {
  const parts = splitFrontmatter(content);
  const fm = parts ? parts[0] : null;
  let body = parts ? parts[1] : content;

  body = body.replace(
    /[ \t]*\[\[([^\]|]+?)(?:\|[^\]]+)?\]\][ \t]*/g,
    (full: string, link: string) => {
      const stem = link.trim().split("/").pop()!;
      return knownStems.has(stem) ? full : " ";
    },
  );
  body = tidyAfterRemoval(body);

  if (fm === null) return body.trim();

  const bodyLinks = [...new Set(extractLinks(body).map((l) => `[[${l}]]`))];
  return setFmLinks(fm, bodyLinks) + body;
}
```

Note on the replace callback: matched whitespace on both sides is consumed and a removed link collapses to a single `" "`, so `"Refs [[alive]] and [[dead]] inline."` → `"Refs [[alive]] and inline."` (one space, no doubles). `tidyAfterRemoval` then fixes ` .`/` ,` cases.

- [ ] **Step 5: Run the eval to verify it passes**

Run:
```bash
node_modules/.bin/esbuild eval/wiki-hygiene/run.ts --bundle --platform=node --format=cjs --outfile=eval/wiki-hygiene/run.cjs && node eval/wiki-hygiene/run.cjs
```
Expected: PASS — `... passed, 0 failed`.

- [ ] **Step 6: Type-check touched file**

Run:
```bash
npx tsc --noEmit 2>&1 | grep "wiki-link-validator.ts" || echo "no new errors in wiki-link-validator.ts"
```
Expected: `no new errors in wiki-link-validator.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/wiki-link-validator.ts eval/wiki-hygiene/run.ts eval/wiki-hygiene/.gitignore
git commit -m "feat(wiki-links): stripDeadLinks — remove dead [[links]] from body + re-sync fm"
```

---

### Task 2: `deriveFallbackAnnotation` in `wiki-index.ts`

Deterministically build a one-line index annotation from a page's H1, first body sentence, and entity type, for pages where the LLM emitted none.

**Files:**
- Modify: `src/wiki-index.ts` (add exported `deriveFallbackAnnotation`)
- Modify: `eval/wiki-hygiene/run.ts` (add the `deriveFallbackAnnotation` block)

**Interfaces:**
- Produces: `export function deriveFallbackAnnotation(content: string, entityType?: string): string`

- [ ] **Step 1: Write the failing eval**

In `eval/wiki-hygiene/run.ts`, add the import at the top:

```ts
import { deriveFallbackAnnotation } from "../../src/wiki-index";
```

And add this block before the final summary lines (`console.log(`\n${pass}...`)`):

```ts
console.log("\n=== deriveFallbackAnnotation ===");
{
  const content = [
    "---", "wiki_status: stub", "---",
    "# CH_METE_S3_DDRD",
    "",
    "CH_METE_S3_DDRD is a Clickhouse table type. It exports to S3.",
    "",
    "## Details",
    "more text",
  ].join("\n");
  const a = deriveFallbackAnnotation(content, "entities");
  check("starts with H1", a.startsWith("CH_METE_S3_DDRD — "), a);
  check("contains first sentence", a.includes("CH_METE_S3_DDRD is a Clickhouse table type."), a);
  check("has Type", a.includes("Type: entities"), a);
  check("single line", !a.includes("\n"), a);
}
{
  const a = deriveFallbackAnnotation("# Only Title\n", undefined);
  check("missing body → still has title + general type", a.startsWith("Only Title") && a.includes("Type: general"), a);
}
{
  const longBody = "# T\n\n" + "word ".repeat(400);
  const a = deriveFallbackAnnotation(longBody, "tasks");
  check("truncated to <= 800 chars", a.length <= 800, String(a.length));
}
{
  const a = deriveFallbackAnnotation("# T\n\nLinks [[wiki_x_minio]] here.\n", "entities");
  check("wikilink brackets unwrapped in annotation", !a.includes("[[") && a.includes("wiki_x_minio"), a);
}
```

- [ ] **Step 2: Run the eval to verify it fails**

Run:
```bash
node_modules/.bin/esbuild eval/wiki-hygiene/run.ts --bundle --platform=node --format=cjs --outfile=eval/wiki-hygiene/run.cjs && node eval/wiki-hygiene/run.cjs
```
Expected: build FAILS — `deriveFallbackAnnotation` not exported from `wiki-index`.

- [ ] **Step 3: Implement `deriveFallbackAnnotation`**

In `src/wiki-index.ts`, add after `parseIndexAnnotations`:

```ts
// Deterministic one-line annotation for pages the LLM left un-annotated, so they
// still get an index entry (and therefore an embedding) and become retrievable.
// LLM lint later upgrades it to a full Covers:/Type:/Terms: annotation.
export function deriveFallbackAnnotation(content: string, entityType?: string): string {
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");
  const h1 = (body.match(/^#\s+(.+)$/m)?.[1] ?? "").trim() || "(untitled)";

  const firstLine = body.split("\n").find((l) => {
    const t = l.trim();
    return t && !t.startsWith("#") && !t.startsWith("|") && !t.startsWith("---");
  }) ?? "";
  const sentence = firstLine.trim().split(/(?<=[.!?])\s/)[0] ?? "";

  const type = (entityType ?? "").trim() || "general";
  const unwrap = (s: string) => s.replace(/\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]/g, "$1");

  let out = `${unwrap(h1)} — ${unwrap(sentence)} Type: ${type}`
    .replace(/\s+/g, " ")
    .trim();
  if (out.length > 800) out = out.slice(0, 797).trimEnd() + "...";
  return out;
}
```

- [ ] **Step 4: Run the eval to verify it passes**

Run:
```bash
node_modules/.bin/esbuild eval/wiki-hygiene/run.ts --bundle --platform=node --format=cjs --outfile=eval/wiki-hygiene/run.cjs && node eval/wiki-hygiene/run.cjs
```
Expected: PASS — `... passed, 0 failed`.

- [ ] **Step 5: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | grep "wiki-index.ts" || echo "no new errors in wiki-index.ts"
```
Expected: `no new errors in wiki-index.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/wiki-index.ts eval/wiki-hygiene/run.ts
git commit -m "feat(wiki-index): deriveFallbackAnnotation — H1 + first sentence + Type"
```

---

### Task 3: `reconcileIndex` in `wiki-index.ts`

Compute the bidirectional diff between `_index.md` and the on-disk page set: which pages to add (with annotation or fallback) and which orphan entries to remove.

**Files:**
- Modify: `src/wiki-index.ts` (add exported `reconcileIndex` + `IndexReconcile` type; import `GENERIC_WIKI_STEM_REGEX`)
- Modify: `eval/wiki-hygiene/run.ts` (add the `reconcileIndex` block)

**Interfaces:**
- Consumes: existing private `deriveSection(wikiFolder, fullPath)`, existing `parseIndexAnnotations(content)`, new `deriveFallbackAnnotation` (Task 2), `GENERIC_WIKI_STEM_REGEX` from `./wiki-stem`.
- Produces:
  ```ts
  export interface IndexReconcile {
    adds: Array<{ pid: string; annotation: string; fullPath: string }>;
    removes: string[];
  }
  export function reconcileIndex(
    indexContent: string,
    wikiFolder: string,
    pages: Array<{ path: string; content: string; annotation?: string }>,
  ): IndexReconcile
  ```
  `pages` MUST be the COMPLETE set of the domain's page files (caller passes all of them) — otherwise a missing page would be wrongly treated as an orphan and removed.

- [ ] **Step 1: Write the failing eval**

In `eval/wiki-hygiene/run.ts`, extend the existing wiki-index import line to include `reconcileIndex`:

```ts
import { deriveFallbackAnnotation, reconcileIndex } from "../../src/wiki-index";
```

Add this block before the final summary lines:

```ts
console.log("\n=== reconcileIndex ===");
{
  const wikiFolder = "!Wiki/dom";
  const index = [
    "# Wiki Index",
    "",
    "## tasks",
    "- wiki_dom_keep — kept. Type: task.",
    "- wiki_dom_orphan — orphan, file gone. Type: task.",
  ].join("\n");
  const pages = [
    { path: "!Wiki/dom/tasks/wiki_dom_keep.md", content: "# Keep\n\nbody", annotation: "kept. Type: task." },
    { path: "!Wiki/dom/entities/wiki_dom_new.md", content: "# New\n\nNew entity body.", annotation: "" },
    { path: "!Wiki/dom/_index.md", content: "ignore me" },
  ];
  const r = reconcileIndex(index, wikiFolder, pages);
  check("orphan flagged for removal", r.removes.includes("wiki_dom_orphan"), JSON.stringify(r.removes));
  check("kept page not re-added", !r.adds.some((a) => a.pid === "wiki_dom_keep"), JSON.stringify(r.adds));
  check("new page added", r.adds.some((a) => a.pid === "wiki_dom_new"), JSON.stringify(r.adds));
  check("new page got fallback annotation", r.adds.find((a) => a.pid === "wiki_dom_new")?.annotation.includes("New entity body."), JSON.stringify(r.adds));
  check("meta file ignored", !r.adds.some((a) => a.pid.includes("index")), JSON.stringify(r.adds));
}
{
  // page already-annotated keeps its annotation, not the fallback.
  const r = reconcileIndex("# Wiki Index\n", "!Wiki/dom", [
    { path: "!Wiki/dom/tasks/wiki_dom_a.md", content: "# A\n\nbody.", annotation: "real ann. Type: task." },
  ]);
  check("real annotation preserved on add", r.adds[0]?.annotation === "real ann. Type: task.", JSON.stringify(r.adds));
}
```

- [ ] **Step 2: Run the eval to verify it fails**

Run:
```bash
node_modules/.bin/esbuild eval/wiki-hygiene/run.ts --bundle --platform=node --format=cjs --outfile=eval/wiki-hygiene/run.cjs && node eval/wiki-hygiene/run.cjs
```
Expected: build FAILS — `reconcileIndex` not exported.

- [ ] **Step 3: Implement `reconcileIndex`**

In `src/wiki-index.ts`, add the import near the top (after the existing imports):

```ts
import { GENERIC_WIKI_STEM_REGEX } from "./wiki-stem";
```

Add at the end of the file:

```ts
export interface IndexReconcile {
  adds: Array<{ pid: string; annotation: string; fullPath: string }>;
  removes: string[];
}

// Bidirectional diff between _index.md and the on-disk page set.
// `pages` MUST be the complete domain page set, or live pages would be
// mis-flagged as orphans. Meta files (_*) and stems failing the wiki mask
// are ignored. Caller applies adds via upsertIndexAnnotation and removes via
// removeIndexAnnotation.
export function reconcileIndex(
  indexContent: string,
  wikiFolder: string,
  pages: Array<{ path: string; content: string; annotation?: string }>,
): IndexReconcile {
  const indexed = new Set(parseIndexAnnotations(indexContent).keys());
  const onDisk = new Set<string>();
  const adds: IndexReconcile["adds"] = [];

  for (const p of pages) {
    const stem = p.path.split("/").pop()!.replace(/\.md$/, "");
    if (stem.startsWith("_") || !GENERIC_WIKI_STEM_REGEX.test(stem)) continue;
    onDisk.add(stem);
    if (indexed.has(stem)) continue;
    const entityType = deriveSection(wikiFolder, p.path);
    const annotation = (p.annotation && p.annotation.trim())
      ? p.annotation
      : deriveFallbackAnnotation(p.content, entityType);
    adds.push({ pid: stem, annotation, fullPath: p.path });
  }

  const removes = [...indexed].filter((pid) => !onDisk.has(pid));
  return { adds, removes };
}
```

- [ ] **Step 4: Run the eval to verify it passes**

Run:
```bash
node_modules/.bin/esbuild eval/wiki-hygiene/run.ts --bundle --platform=node --format=cjs --outfile=eval/wiki-hygiene/run.cjs && node eval/wiki-hygiene/run.cjs
```
Expected: PASS — `... passed, 0 failed`.

- [ ] **Step 5: Type-check**

Run:
```bash
npx tsc --noEmit 2>&1 | grep "wiki-index.ts" || echo "no new errors in wiki-index.ts"
```
Expected: `no new errors in wiki-index.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/wiki-index.ts eval/wiki-hygiene/run.ts
git commit -m "feat(wiki-index): reconcileIndex — bidirectional _index.md ↔ disk diff"
```

---

### Task 4: Wire dead-link removal + always-index into ingest

Ingest gets prevention: dead links are stripped from every page it writes, and every written page is indexed (LLM annotation or fallback). After the write/delete loops, reconcile the full domain index both ways.

**Files:**
- Modify: `src/phases/ingest.ts` (import the new functions; add a strip pass after `fixWikiLinks` ~line 313; change the index guard ~line 408; add a reconcile step after the delete loop ~line 449)

**Interfaces:**
- Consumes: `stripDeadLinks` (Task 1), `deriveFallbackAnnotation` (Task 2), `reconcileIndex` (Task 3), existing `upsertIndexAnnotation`/`removeIndexAnnotation`, existing `knownStems` (line 309-312), `vaultTools.listFiles`/`readAll`.

- [ ] **Step 1: Add imports**

In `src/phases/ingest.ts`, extend the existing import lines:

```ts
import { upsertIndexAnnotation, parseIndexAnnotations, removeIndexAnnotation, deriveFallbackAnnotation, reconcileIndex } from "../wiki-index";
import { fixWikiLinks, stripDeadLinks } from "../wiki-link-validator";
```

- [ ] **Step 2: Strip dead links after `fixWikiLinks` (always, not gated on retries)**

Find (≈ line 313):

```ts
  const wlFixResult = fixWikiLinks(pagesMap, wikiLinkValidationRetries, knownStems);
  pages = pages.map((p) => ({ ...p, content: wlFixResult.fixed.get(p.path) ?? p.content }));
```

Replace with:

```ts
  const wlFixResult = fixWikiLinks(pagesMap, wikiLinkValidationRetries, knownStems);
  pages = pages.map((p) => {
    const fixed = wlFixResult.fixed.get(p.path) ?? p.content;
    return { ...p, content: stripDeadLinks(fixed, knownStems) };
  });
```

- [ ] **Step 3: Always index written pages (prevention)**

Find (≈ line 408):

```ts
      if (page.annotation) {
        try {
          await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation, page.path);
        } catch { /* non-critical */ }
      }
```

Replace with:

```ts
      try {
        const annotation = (page.annotation && page.annotation.trim())
          ? page.annotation
          : deriveFallbackAnnotation(sourcedPage, deriveSectionForPath(wikiVaultPath, page.path));
        await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), annotation, page.path);
      } catch { /* non-critical */ }
```

`deriveSection` is private to `wiki-index.ts`; rather than export it, derive the entity type inline. Add this small local helper near the top of the ingest module (after imports):

```ts
function deriveSectionForPath(wikiFolder: string, fullPath: string): string {
  const prefix = wikiFolder + "/";
  const rel = fullPath.startsWith(prefix) ? fullPath.slice(prefix.length) : fullPath;
  const parts = rel.split("/");
  return parts.length >= 2 ? parts[0] : "general";
}
```

- [ ] **Step 4: Reconcile the full domain index after the delete loop**

Find the end of the delete loop (after the `for (const d of deletes)` block closes, ≈ line 449, before the function builds its result). Insert:

```ts
  // Full bidirectional index reconciliation: add any page missing from the index
  // (legacy un-annotated pages get a deterministic fallback) and drop orphan
  // entries whose file no longer exists. Non-critical.
  try {
    const finalPaths = (await vaultTools.listFiles(wikiVaultPath))
      .filter((f) => f.endsWith(".md") && !f.endsWith("_index.md") && !f.endsWith("_log.md"));
    const finalPages = await vaultTools.readAll(finalPaths);
    const currentIndex = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
    const recon = reconcileIndex(
      currentIndex, wikiVaultPath,
      [...finalPages].map(([path, content]) => ({ path, content })),
    );
    for (const a of recon.adds) {
      await upsertIndexAnnotation(vaultTools, wikiVaultPath, a.pid, a.annotation, a.fullPath);
    }
    for (const pid of recon.removes) {
      await removeIndexAnnotation(vaultTools, wikiVaultPath, pid);
    }
  } catch { /* non-critical */ }
```

(`domainIndexPath` is already imported in `ingest.ts` at line 17, `pageId` at line 21, and `tryRead` is already in use at line 110 — no new imports needed for this step beyond Step 1.)

- [ ] **Step 5: Type-check touched file**

Run:
```bash
npx tsc --noEmit 2>&1 | grep "phases/ingest.ts" || echo "no new errors in ingest.ts"
```
Expected: `no new errors in ingest.ts`.

- [ ] **Step 6: Lint**

Run:
```bash
npm run lint 2>&1 | tail -5
```
Expected: no new errors for `src/phases/ingest.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "feat(ingest): strip dead links + always-index + reconcile index"
```

---

### Task 5: Wire dead-link removal + reconciliation into lint

Lint gets the cure: a deterministic body dead-link strip over every page (runs with LLM on or off) and a full bidirectional index reconciliation. Both live in the always-on post-loop block.

**Files:**
- Modify: `src/phases/lint.ts` (import the new functions; add a strip pass + reconcile in the post-loop block ≈ lines 526-561)

**Interfaces:**
- Consumes: `stripDeadLinks` (Task 1), `reconcileIndex` (Task 3), existing `upsertIndexAnnotation`/`removeIndexAnnotation`, existing `knownStems` (line 219), `annotations` map (line 239), `pages` map (line 207), `domainIndexPath`.

- [ ] **Step 1: Add imports**

In `src/phases/lint.ts`, extend the imports:

```ts
import { checkWikiLinks, fixWikiLinks, stripDeadLinks } from "../wiki-link-validator";
import { upsertIndexAnnotation, parseIndexAnnotations, reconcileIndex, removeIndexAnnotation } from "../wiki-index";
```

- [ ] **Step 2: Strip dead links from every page body (post-loop, always-on)**

In the post-loop block, find the stale-link cleanup (≈ line 535):

```ts
    for (const [wikiPath, wikiContent] of pages) {
      const { content: filteredWiki } =
        filterStaleWikiLinks(wikiContent, existingWikiStems, ["wiki_outgoing_links"]);
      if (filteredWiki !== wikiContent) {
        pages.set(wikiPath, filteredWiki);
        await vaultTools.write(wikiPath, filteredWiki);
      }
    }
```

Insert this loop immediately BEFORE it (so the body is cleaned first, then `filterStaleWikiLinks` is a harmless no-op on the already-synced frontmatter):

```ts
    // Deterministic dead-link removal from article bodies (runs with LLM on or off).
    // Uses the vault-wide knownStems so links to source notes are preserved.
    for (const [wikiPath, wikiContent] of pages) {
      const cleaned = stripDeadLinks(wikiContent, knownStems);
      if (cleaned !== wikiContent) {
        pages.set(wikiPath, cleaned);
        await vaultTools.write(wikiPath, cleaned);
      }
    }
```

- [ ] **Step 3: Reconcile the index both ways (post-loop, always-on)**

After the backlink-sync block and before `appendWikiLog` (≈ line 601), insert:

```ts
    // Full bidirectional index reconciliation — cure: add pages missing from the
    // index (fallback annotation when none), drop orphan entries. Runs without LLM.
    try {
      const reconPages = [...pages.entries()].map(([path, content]) => {
        const pid = pageId(path);
        const ann = annotations.get(pid);
        return ann ? { path, content, annotation: ann } : { path, content };
      });
      const currentIndex = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
      const recon = reconcileIndex(currentIndex, wikiVaultPath, reconPages);
      for (const a of recon.adds) {
        await upsertIndexAnnotation(vaultTools, wikiVaultPath, a.pid, a.annotation, a.fullPath);
      }
      for (const pid of recon.removes) {
        await removeIndexAnnotation(vaultTools, wikiVaultPath, pid);
      }
      if (recon.adds.length || recon.removes.length) {
        reportParts.push(`Index reconciled: +${recon.adds.length} / -${recon.removes.length}`);
      }
    } catch { /* non-critical */ }
```

(`domainIndexPath` is already imported in `lint.ts` at line 14, `pageId` at line 16, and `tryRead` is already in use at line 238 — no new imports needed for this step beyond Step 1.)

- [ ] **Step 4: Type-check touched file**

Run:
```bash
npx tsc --noEmit 2>&1 | grep "phases/lint.ts" || echo "no new errors in lint.ts"
```
Expected: `no new errors in lint.ts`.

- [ ] **Step 5: Lint**

Run:
```bash
npm run lint 2>&1 | tail -5
```
Expected: no new errors for `src/phases/lint.ts`.

- [ ] **Step 6: Commit**

```bash
git add src/phases/lint.ts
git commit -m "feat(lint): strip dead-link bodies + bidirectional index reconciliation"
```

---

### Task 6: Build, full eval, and manual verification on `rtk-task`

Confirm the whole change builds, the eval suite passes, and the two defects are gone on the real fixture vault.

**Files:**
- None modified (verification only).

- [ ] **Step 1: Production build**

Run:
```bash
npm run build 2>&1 | tail -10
```
Expected: build succeeds, `dist/` updated, no errors.

- [ ] **Step 2: Run the full wiki-hygiene eval**

Run:
```bash
node_modules/.bin/esbuild eval/wiki-hygiene/run.ts --bundle --platform=node --format=cjs --outfile=eval/wiki-hygiene/run.cjs && node eval/wiki-hygiene/run.cjs
```
Expected: `... passed, 0 failed` across stripDeadLinks + deriveFallbackAnnotation + reconcileIndex.

- [ ] **Step 3: Back up the fixture vault, then run lint (no LLM) on `rtk-task`**

Reload the plugin in Obsidian (or `npm run build` then reload), open the vault `/home/ikeniborn/Documents/Project/notes/vaults/Work`, and run **Lint** on domain `rtk-task` with the **Use-LLM toggle OFF**.

Back up first:
```bash
cp -r "/home/ikeniborn/Documents/Project/notes/vaults/Work/!Wiki/rtk-task" /tmp/rtk-task-backup
```

- [ ] **Step 4: Verify no dead links remain (Criterion 1)**

Run:
```bash
grep -rn "ch_mete_s3_ddrdrg" "/home/ikeniborn/Documents/Project/notes/vaults/Work/!Wiki/rtk-task" --include="*.md" | grep -v "_index.md" || echo "no dead link to ch_mete_s3_ddrdrg in pages"
```
Expected: `no dead link to ch_mete_s3_ddrdrg in pages` (the page `wiki_rtk-task_ch_mete_s3_ddrdrg` does not exist, so every `[[...ddrdrg]]` must be gone from bodies and frontmatter).

- [ ] **Step 5: Verify index ↔ disk diff is empty (Criterion 2 & 3)**

Run:
```bash
D="/home/ikeniborn/Documents/Project/notes/vaults/Work/!Wiki/rtk-task"
grep -oE '^- [^ ]+ — ' "$D/_config/_index.md" | sed -E 's/^- (.+) — $/\1/' | sort -u > /tmp/idx.txt
find "$D/tasks" "$D/entities" -name '*.md' -exec basename {} .md \; | sort -u > /tmp/disk.txt
echo "--- in index, no file (must be empty) ---"; comm -23 /tmp/idx.txt /tmp/disk.txt
echo "--- on disk, not indexed (must be empty) ---"; comm -13 /tmp/idx.txt /tmp/disk.txt
echo "--- empty sections (header with no following entry — must be empty) ---"
awk '/^## /{if(prev_hdr)print prev; prev_hdr=1; prev=$0; seen=0; next} /^- /{seen=1; prev_hdr=0} END{if(prev_hdr&&!seen)print prev}' "$D/_config/_index.md"
```
Expected: the first two lists empty. In particular `wiki_rtk-task_ch_mete_s3_ddrd` (and the other 10) now appear in the index; orphans `dwm_86664`, `dwm_89228`, `dwm_89709`, `mmd` are gone. The third check confirms `removeIndexAnnotation` left no empty `## section` behind (closes check-plan F-002 end-to-end).

- [ ] **Step 6: Update docs/wiki via iwiki**

Run the iwiki ingest + lint skills for the changed sources:
- `iwiki:iwiki-ingest src/wiki-link-validator.ts`
- `iwiki:iwiki-ingest src/wiki-index.ts`
- `iwiki:iwiki-ingest src/phases/ingest.ts`
- `iwiki:iwiki-ingest src/phases/lint.ts`
- then `/iwiki-lint` — no broken `[[refs]]`, no orphan/stale pages.

- [ ] **Step 7: Final commit (docs + built dist if tracked)**

```bash
git add -A
git commit -m "docs(wiki): dead-link removal + index reconciliation; rebuild"
```

---

## Notes / deviations from spec

- **`reconcileIndex` signature differs from the spec's illustrative sketch** (resolves check-plan F-001). Spec sketched `reconcileIndex(indexContent, pageFiles, getAnnotation) → adds:{pid, section, annotation}`. The plan uses `reconcileIndex(indexContent, wikiFolder, pages[{path,content,annotation?}]) → adds:{pid, annotation, fullPath}`: the fallback deriver is called internally (callers don't pass it), `wikiFolder` is needed to derive the entity type / section, and `adds` carry `fullPath` because `upsertIndexAnnotation` derives the section from the path. Same requirements, cleaner call sites.
- **Empty-section cleanup on removal is delegated to the existing `removeIndexAnnotation`** (resolves check-plan F-002). `reconcileIndex` returns `removes: string[]`; the actual emptied-`## section` deletion lives in `removeIndexAnnotation` (`src/wiki-index.ts:106-116`), already in production use (delete phase, ingest delete loop). No new headless eval is added for it (it is async + `VaultTools`-bound, and `--format=cjs` evals cannot use top-level await without restructuring the harness); instead Task 6 Step 5 asserts end-to-end that orphan removal leaves no empty section in the real `rtk-task` index.
- **Reconcile in ingest reads the full domain file set once** at the end (bulk `readAll`). Faithful to the spec's "reconcile after write loop"; for very large wikis this is one extra bulk read per ingest — acceptable given the index manipulation already happening.
- **`filterStaleWikiLinks` is kept** in lint (now redundant for `wiki_outgoing_links` after the body strip + fm re-sync). Removing it is optional cleanup, intentionally out of scope to keep the diff surgical.
- **`format.ts` is untouched** (no vault-wide corpus — per spec non-goals).
