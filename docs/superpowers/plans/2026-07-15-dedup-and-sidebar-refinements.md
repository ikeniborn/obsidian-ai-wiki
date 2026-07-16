---
review:
  plan_hash: c76dc3afad124c8d
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
  spec: docs/superpowers/specs/2026-07-15-dedup-and-sidebar-refinements-design.md
---
# Duplicate Guards, Sidebar Swap & Query Audit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee no duplicate content survives an ingest merge and no duplicate chunk reaches the LLM at query time, swap the two sidebar ask-buttons, and lock the `!Wiki` graph scope + Ask-Wiki/Ask-Domain pipeline parity behind tests.

**Architecture:** Two new pure helper modules (`src/chunk-dedup.ts`, `src/merge-sections.ts`) with unit tests, wired into the existing query paths (`query.ts`, `query-cross-domain.ts`) and the ingest merge branch (`ingest.ts`). A one-line UI edit in `view.ts`. Three deterministic guard/unit tests pin the audit claims (P3 scope, P4 parity, P2 button layout).

**Tech Stack:** TypeScript (ESM), esbuild bundle, `node:test` + `node:assert/strict` run via `tsx`. Obsidian API stubbed in tests via `tests/md-obsidian-loader.mjs` (only needed for obsidian-bound modules).

## Global Constraints

- Test runner: `node --import tsx --test tests/<file>.test.ts`. Add `--import ./tests/md-obsidian-loader.mjs` only when the module under test imports `obsidian`. The new pure helpers do not.
- Tests use `node:test` (`test(...)`) + `node:assert/strict` (`assert`). Match the style in `tests/bm25.test.ts`.
- Type-only imports for `SelectedChunk` (`import type { SelectedChunk } from "./page-similarity"`) so runtime never loads obsidian-bound code.
- Docs/code/comments/commit messages in English.
- Branch: `dev-dedup-and-sidebar-refinements` (already created from `master` 458ed66). Commit per task.
- `dedupOnIngest` default stays `false` (`src/types.ts:326`) — do NOT change it.
- Do NOT refactor adjacent code. Every changed line must trace to a task below.
- After the code tasks, `npm run build` and `npm run lint` must be clean (Task 8).

---

### Task 1: `dedupeChunks` helper (P1a core)

**Files:**
- Create: `src/chunk-dedup.ts`
- Test: `tests/chunk-dedup.test.ts`

**Interfaces:**
- Consumes: `SelectedChunk` (type only) from `src/page-similarity.ts` — fields `{ articleId: string; path: string; heading: string; body: string; score: number; source: "seed" | "graph"; articleScore?: number; ordinal: number }`.
- Produces: `normalizeChunkKey(heading: string, body: string): string` and `dedupeChunks(chunks: SelectedChunk[]): { chunks: SelectedChunk[]; dropped: number }`.

- [ ] **Step 1: Write the failing test**

Create `tests/chunk-dedup.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { dedupeChunks, normalizeChunkKey } from "../src/chunk-dedup";
import type { SelectedChunk } from "../src/page-similarity";

function chunk(over: Partial<SelectedChunk>): SelectedChunk {
  return {
    articleId: "a", path: "!Wiki/d/a.md", heading: "## H", body: "text",
    score: 0.5, source: "seed", ordinal: 0, ...over,
  };
}

test("dedupeChunks removes an exact duplicate and keeps the highest score", () => {
  const input = [
    chunk({ articleId: "a", heading: "## H", body: "same body", score: 0.4 }),
    chunk({ articleId: "b", heading: "## H", body: "same body", score: 0.9 }),
  ];
  const { chunks, dropped } = dedupeChunks(input);
  assert.equal(chunks.length, 1);
  assert.equal(dropped, 1);
  assert.equal(chunks[0].articleId, "b");
  assert.equal(chunks[0].score, 0.9);
});

test("dedupeChunks treats whitespace/case differences as the same chunk", () => {
  const input = [
    chunk({ articleId: "a", heading: "## Title", body: "Hello   World", score: 0.4 }),
    chunk({ articleId: "b", heading: "##  title", body: "hello world", score: 0.6 }),
  ];
  const { chunks, dropped } = dedupeChunks(input);
  assert.equal(chunks.length, 1);
  assert.equal(dropped, 1);
  assert.equal(chunks[0].articleId, "b");
});

test("dedupeChunks preserves first-seen order among kept chunks", () => {
  const input = [
    chunk({ articleId: "x", heading: "## A", body: "one", score: 0.3 }),
    chunk({ articleId: "y", heading: "## B", body: "two", score: 0.3 }),
    chunk({ articleId: "x2", heading: "## A", body: "one", score: 0.9 }),
  ];
  const { chunks } = dedupeChunks(input);
  assert.deepEqual(chunks.map((c) => c.heading), ["## A", "## B"]);
  assert.equal(chunks[0].articleId, "x2"); // higher score wins for key "## A"
});

test("dedupeChunks leaves distinct chunks untouched", () => {
  const input = [
    chunk({ articleId: "a", heading: "## A", body: "one" }),
    chunk({ articleId: "b", heading: "## B", body: "two" }),
  ];
  const { chunks, dropped } = dedupeChunks(input);
  assert.equal(chunks.length, 2);
  assert.equal(dropped, 0);
});

test("normalizeChunkKey collapses whitespace and lowercases", () => {
  assert.equal(normalizeChunkKey("##  Foo", "A\n B  C"), normalizeChunkKey("## foo", "a b c"));
});

test("dedupeChunks handles an empty list", () => {
  const { chunks, dropped } = dedupeChunks([]);
  assert.deepEqual(chunks, []);
  assert.equal(dropped, 0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/chunk-dedup.test.ts`
Expected: FAIL — `Cannot find module '../src/chunk-dedup'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/chunk-dedup.ts`:

```ts
import type { SelectedChunk } from "./page-similarity";

/**
 * Identity key for exact-duplicate chunk detection: lowercase the heading+body,
 * collapse whitespace runs to a single space, trim. No fuzzy matching.
 */
export function normalizeChunkKey(heading: string, body: string): string {
  return `${heading}\n${body}`.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Remove exact-duplicate chunks (same normalizeChunkKey). Keeps the
 * highest-`score` copy per key and preserves first-seen order among the kept
 * chunks. Returns the deduped list plus how many chunks were dropped.
 */
export function dedupeChunks(chunks: SelectedChunk[]): { chunks: SelectedChunk[]; dropped: number } {
  const bestByKey = new Map<string, SelectedChunk>();
  const order: string[] = [];
  for (const chunk of chunks) {
    const key = normalizeChunkKey(chunk.heading, chunk.body);
    const prev = bestByKey.get(key);
    if (!prev) {
      bestByKey.set(key, chunk);
      order.push(key);
    } else if (chunk.score > prev.score) {
      bestByKey.set(key, chunk);
    }
  }
  const deduped = order.map((key) => bestByKey.get(key)!);
  return { chunks: deduped, dropped: chunks.length - deduped.length };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/chunk-dedup.test.ts`
Expected: PASS — 6 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/chunk-dedup.ts tests/chunk-dedup.test.ts
git commit -m "feat(retrieval): add dedupeChunks exact chunk dedup helper"
```

---

### Task 2: Wire `dedupeChunks` into both query paths + diag (P1a wiring, P4 groundwork)

**Files:**
- Modify: `src/types.ts` (add `chunkDupsDropped?: number` to the `query_stats` event)
- Modify: `src/phases/query.ts` (import + dedupe after `selectRelevantChunks`, before `rerankChunks`; emit diag)
- Modify: `src/phases/query-cross-domain.ts` (same)

**Interfaces:**
- Consumes: `dedupeChunks` from `src/chunk-dedup.ts` (Task 1).
- Produces: both query paths rerank a deduplicated chunk list; `query_stats.chunkDupsDropped` reports the count.

- [ ] **Step 1: Add the diag field to the event type**

In `src/types.ts`, inside the `kind: "query_stats"` object (after the `contextTopN?: number;` line ~76), add:

```ts
      chunkDupsDropped?: number;   // exact-duplicate chunks removed before rerank
```

- [ ] **Step 2: Wire into `query.ts`**

In `src/phases/query.ts`, add the import next to the other retrieval imports (near line 28, where `rerankChunks` is imported):

```ts
import { dedupeChunks } from "../chunk-dedup";
```

Then locate this block (around lines 323–335):

```ts
  const selectedChunks: SelectedChunk[] = await chunkSimilarity.selectRelevantChunks(
    question, pages, finalArticleIds, seedSet, articleScores, candidateLimit,
  );
  if (signal.aborted) return;
  if (selectedChunks.length === 0) {
    yield { kind: "error", message: "No relevant pages found for this query." };
    return;
  }
  const reranked = await rerankChunks(question, selectedChunks, {
```

Replace it with (dedupe between selection and rerank):

```ts
  const selectedChunks: SelectedChunk[] = await chunkSimilarity.selectRelevantChunks(
    question, pages, finalArticleIds, seedSet, articleScores, candidateLimit,
  );
  if (signal.aborted) return;
  if (selectedChunks.length === 0) {
    yield { kind: "error", message: "No relevant pages found for this query." };
    return;
  }
  const { chunks: dedupedChunks, dropped: chunkDupsDropped } = dedupeChunks(selectedChunks);
  const reranked = await rerankChunks(question, dedupedChunks, {
```

- [ ] **Step 3: Emit the diag in `query.ts`**

In the `query_stats` emit block (around lines 380–393), add the field after `contextTopN`:

```ts
    rerankerTopN: rerankerRuntime.config.rerankerTopN,
    contextTopN: rerankerRuntime.config.contextTopN,
    chunkDupsDropped,
    reranker: rerankerDiagnostics,
```

- [ ] **Step 4: Wire into `query-cross-domain.ts`**

In `src/phases/query-cross-domain.ts`, add the import near the other retrieval imports (top of file, next to the `reranker` import block ~line 12):

```ts
import { dedupeChunks } from "../chunk-dedup";
```

Locate this block (around lines 139–160):

```ts
  if (selectedChunks.length === 0) {
    yield { kind: "error", message: "No relevant pages found across domains." };
    return;
  }
  const reranked = await rerankChunks(q, selectedChunks, {
```

Replace with:

```ts
  if (selectedChunks.length === 0) {
    yield { kind: "error", message: "No relevant pages found across domains." };
    return;
  }
  const { chunks: dedupedChunks, dropped: chunkDupsDropped } = dedupeChunks(selectedChunks);
  const reranked = await rerankChunks(q, dedupedChunks, {
```

- [ ] **Step 5: Emit the diag in `query-cross-domain.ts`**

In its `query_stats` emit block (around lines 198–212), add after `contextTopN`:

```ts
    rerankerTopN: rerankerRuntime.config.rerankerTopN,
    contextTopN: rerankerRuntime.config.contextTopN,
    chunkDupsDropped,
    reranker: rerankerDiagnostics,
```

- [ ] **Step 6: Typecheck the wiring via build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors (dist bundle regenerated — do not commit dist here; committed in Task 8).

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/phases/query.ts src/phases/query-cross-domain.ts
git commit -m "feat(retrieval): dedupe chunks before rerank in both query paths"
```

---

### Task 3: `ensureIncomingSections` helper (P1b core)

**Files:**
- Create: `src/merge-sections.ts`
- Test: `tests/merge-sections.test.ts`

**Interfaces:**
- Produces: `ensureIncomingSections(merged: string, incoming: string): string` — appends any `##` section present in `incoming` but absent from `merged`, verbatim; skips the structural sections `## Related` and `## External links`.

- [ ] **Step 1: Write the failing test**

Create `tests/merge-sections.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { ensureIncomingSections } from "../src/merge-sections";

test("appends an incoming section missing from the merged page", () => {
  const merged = "# Title\n\n## Overview\nkept\n";
  const incoming = "# Title\n\n## Overview\nold\n\n## Pricing\n$5/mo\n";
  const out = ensureIncomingSections(merged, incoming);
  assert.match(out, /## Pricing/);
  assert.match(out, /\$5\/mo/);
  // The already-present section is not duplicated.
  assert.equal(out.match(/## Overview/g)?.length, 1);
});

test("does not duplicate a section already present (case/space-insensitive heading)", () => {
  const merged = "## Details\nfull\n";
  const incoming = "##  details\nshort\n";
  const out = ensureIncomingSections(merged, incoming);
  assert.equal(out.match(/## Details/gi)?.length, 1);
  assert.doesNotMatch(out, /short/);
});

test("skips ## Related and ## External links", () => {
  const merged = "## Overview\nx\n";
  const incoming = "## Related\n- [[a]]\n\n## External links\n- [t](u)\n";
  const out = ensureIncomingSections(merged, incoming);
  assert.doesNotMatch(out, /## Related/);
  assert.doesNotMatch(out, /## External links/);
});

test("returns the merged page unchanged when nothing is missing", () => {
  const merged = "## A\n1\n\n## B\n2\n";
  const incoming = "## A\nx\n\n## B\ny\n";
  assert.equal(ensureIncomingSections(merged, incoming), merged);
});

test("ignores ### subsections as section boundaries", () => {
  const merged = "## A\ntext\n### Sub\ndeep\n";
  const incoming = "## A\nother\n### Sub\ndeep2\n";
  // "### Sub" is not a top-level ## section, so no append happens.
  assert.equal(ensureIncomingSections(merged, incoming), merged);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/merge-sections.test.ts`
Expected: FAIL — `Cannot find module '../src/merge-sections'`.

- [ ] **Step 3: Write minimal implementation**

Create `src/merge-sections.ts`:

```ts
interface Section {
  headingKey: string; // normalized heading text (no leading #, lowercased)
  block: string;      // heading line + body, trimmed
}

/** Normalized comparison key for a `##` heading line. */
function headingKey(headingLine: string): string {
  return headingLine.replace(/^#+\s*/, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** Split markdown into top-level `##` sections. Content before the first
 *  `## ` heading (title, intro) is ignored — only `##` sections are compared. */
function parseSections(md: string): Section[] {
  const sections: Section[] = [];
  let heading: string | null = null;
  let body: string[] = [];
  const flush = () => {
    if (heading !== null) {
      sections.push({ headingKey: headingKey(heading), block: `${heading}\n${body.join("\n")}`.trim() });
    }
  };
  for (const line of md.split("\n")) {
    if (/^##\s+/.test(line)) {
      flush();
      heading = line.trim();
      body = [];
    } else if (heading !== null) {
      body.push(line);
    }
  }
  flush();
  return sections;
}

const SKIP_HEADINGS = new Set(["related", "external links"]);

/**
 * Deterministic floor for the LLM ingest merge: append any `##` section that
 * exists in `incoming` but is missing from `merged`, verbatim. Structural
 * sections (`## Related`, `## External links`) are skipped — the merge prompt
 * already unions those bullet lists.
 */
export function ensureIncomingSections(merged: string, incoming: string): string {
  const mergedKeys = new Set(parseSections(merged).map((s) => s.headingKey));
  const missing = parseSections(incoming).filter(
    (s) => !SKIP_HEADINGS.has(s.headingKey) && !mergedKeys.has(s.headingKey),
  );
  if (missing.length === 0) return merged;
  const appendix = missing.map((s) => s.block).join("\n\n");
  return `${merged.replace(/\s*$/, "")}\n\n${appendix}\n`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/merge-sections.test.ts`
Expected: PASS — 5 tests, 0 fail.

- [ ] **Step 5: Commit**

```bash
git add src/merge-sections.ts tests/merge-sections.test.ts
git commit -m "feat(ingest): add ensureIncomingSections merge section guarantee"
```

---

### Task 4: Wire `ensureIncomingSections` into the ingest merge branch (P1b wiring)

**Files:**
- Modify: `src/phases/ingest.ts` (import + apply before the merged write at line ~427)

**Interfaces:**
- Consumes: `ensureIncomingSections` from `src/merge-sections.ts` (Task 3); `merged.value.content` (LLM merge output) and `page.content` (incoming draft) already in scope.

- [ ] **Step 1: Add the import**

In `src/phases/ingest.ts`, add near the other local imports (e.g. next to the `ingest-merge.md` prompt import at line 14):

```ts
import { ensureIncomingSections } from "../merge-sections";
```

- [ ] **Step 2: Apply the guarantee before writing the merged page**

Locate (around lines 426–429):

```ts
            yield { kind: "tool_use", name: "Update", input: { path: targetPath } };
            await vaultTools.write(targetPath, merged.value.content);
            written.push(targetPath);
            yield { kind: "tool_result", ok: true, preview: `merged ← ${pageId(page.path)}` };
```

Replace with:

```ts
            yield { kind: "tool_use", name: "Update", input: { path: targetPath } };
            const guardedContent = ensureIncomingSections(merged.value.content, page.content);
            await vaultTools.write(targetPath, guardedContent);
            written.push(targetPath);
            yield { kind: "tool_result", ok: true, preview: `merged ← ${pageId(page.path)}` };
```

- [ ] **Step 3: Typecheck via build**

Run: `npm run build`
Expected: build succeeds, no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "fix(ingest): guarantee incoming sections survive a dedup merge"
```

---

### Task 5: Swap the sidebar ask-buttons (P2)

**Files:**
- Modify: `src/view.ts:219-220`
- Test: `tests/ask-buttons-layout.test.ts`

**Interfaces:**
- Produces: sidebar renders "Ask Wiki" first (grey, no `mod-cta`) and "Ask Domain" second (accent, `mod-cta`). Button fields `this.askDomainBtn` / `this.askWikiBtn` unchanged; handlers and `updateButtonAvailability()` untouched.

- [ ] **Step 1: Write the failing guard test**

Create `tests/ask-buttons-layout.test.ts` (source-level guard — deterministic, no DOM):

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");

test("Ask Wiki button is created before Ask Domain", () => {
  const wikiIdx = src.indexOf("this.askWikiBtn = askButtons.createEl");
  const domainIdx = src.indexOf("this.askDomainBtn = askButtons.createEl");
  assert.ok(wikiIdx > -1 && domainIdx > -1, "both button creations present");
  assert.ok(wikiIdx < domainIdx, "askWiki must be created first");
});

test("Ask Domain is the accent (mod-cta) button, Ask Wiki is not", () => {
  const domainLine = src.split("\n").find((l) => l.includes("this.askDomainBtn = askButtons.createEl"))!;
  const wikiLine = src.split("\n").find((l) => l.includes("this.askWikiBtn = askButtons.createEl"))!;
  assert.match(domainLine, /mod-cta/);
  assert.doesNotMatch(wikiLine, /mod-cta/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --import tsx --test tests/ask-buttons-layout.test.ts`
Expected: FAIL — current order is askDomain first, and askWiki has `mod-cta`.

- [ ] **Step 3: Swap the button creation lines**

In `src/view.ts`, replace lines 219–220:

```ts
    this.askDomainBtn = askButtons.createEl("button", { text: T.view.askDomain });
    this.askWikiBtn = askButtons.createEl("button", { text: T.view.askWiki, cls: "mod-cta" });
```

with:

```ts
    this.askWikiBtn = askButtons.createEl("button", { text: T.view.askWiki });
    this.askDomainBtn = askButtons.createEl("button", { text: T.view.askDomain, cls: "mod-cta" });
```

Leave the click handlers (lines ~222–230), the `askWiki` `ConfirmModal`, and `updateButtonAvailability()` unchanged.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --import tsx --test tests/ask-buttons-layout.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts tests/ask-buttons-layout.test.ts
git commit -m "feat(view): swap ask buttons — Ask Domain primary, Ask Wiki secondary"
```

---

### Task 6: Pin the `!Wiki` graph scope (P3 audit)

**Files:**
- Test: `tests/graph-scope-wiki.test.ts`

**Interfaces:**
- Consumes: `isWikiPagePath` from `src/wiki-path.ts`; source of `src/phases/query.ts`.

- [ ] **Step 1: Write the test**

Create `tests/graph-scope-wiki.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { isWikiPagePath } from "../src/wiki-path";

test("isWikiPagePath accepts wiki content pages, rejects meta/sidecars", () => {
  assert.equal(isWikiPagePath("!Wiki/os/macos.md"), true);
  assert.equal(isWikiPagePath("!Wiki/os/index.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/os/metadata.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/os/log.jsonl"), false);
  assert.equal(isWikiPagePath("!Wiki/_config/_domain.json"), false);
  assert.equal(isWikiPagePath("!Wiki/os/_config/_index.md"), false);
});

test("query.ts scopes the file list to the domain wiki folder and filters to wiki pages", () => {
  const src = readFileSync(new URL("../src/phases/query.ts", import.meta.url), "utf8");
  // Folder is derived from the domain's wiki_folder under !Wiki.
  assert.match(src, /domainWikiFolder\(domain\.wiki_folder\)/);
  // The listed files feeding graph/candidate build are filtered by isWikiPagePath.
  assert.match(src, /listFiles\(wikiVaultPath\)/);
  assert.match(src, /\.filter\(isWikiPagePath\)/);
});
```

- [ ] **Step 2: Run the test**

Run: `node --import tsx --test tests/graph-scope-wiki.test.ts`
Expected: PASS — 2 tests. (This confirms the graph is built only from `!Wiki/<subfolder>` content pages. If any assertion fails, the scope leaked — fix `query.ts` so the file list passes through `isWikiPagePath` before graph build, then re-run.)

- [ ] **Step 3: Commit**

```bash
git add tests/graph-scope-wiki.test.ts
git commit -m "test(retrieval): pin graph search scope to !Wiki content pages"
```

---

### Task 7: Pin Ask-Wiki / Ask-Domain pipeline parity (P4 audit)

**Files:**
- Test: `tests/query-parity.test.ts`

**Interfaces:**
- Consumes: source of `src/phases/query.ts` and `src/phases/query-cross-domain.ts`.

- [ ] **Step 1: Write the test**

Create `tests/query-parity.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const domain = readFileSync(new URL("../src/phases/query.ts", import.meta.url), "utf8");
const cross = readFileSync(new URL("../src/phases/query-cross-domain.ts", import.meta.url), "utf8");

for (const [name, src] of [["query", domain], ["query-cross-domain", cross]] as const) {
  test(`${name} selects chunks, dedupes, then reranks in that order`, () => {
    const selIdx = src.indexOf("selectRelevantChunks");
    const dedupIdx = src.indexOf("dedupeChunks(");
    const rerankIdx = src.indexOf("rerankChunks(");
    assert.ok(selIdx > -1, "selectRelevantChunks present");
    assert.ok(dedupIdx > -1, "dedupeChunks present");
    assert.ok(rerankIdx > -1, "rerankChunks present");
    assert.ok(selIdx < dedupIdx && dedupIdx < rerankIdx, "order: select → dedupe → rerank");
  });

  test(`${name} drives rerank limits from rerankerRuntime.config`, () => {
    assert.match(src, /rerankerRuntime\.config\.rerankerTopN/);
    assert.match(src, /rerankerRuntime\.config\.contextTopN/);
  });

  test(`${name} applies boilerplate demotion`, () => {
    assert.match(src, /boilerplateDemotion|demoteBoilerplate/);
  });
}
```

- [ ] **Step 2: Run the test**

Run: `node --import tsx --test tests/query-parity.test.ts`
Expected: PASS — 6 tests (3 per path). If a `query-cross-domain` assertion fails, align that path with `query.ts` (add the missing `dedupeChunks` call from Task 2, or route the missing limit through `rerankerRuntime.config`), then re-run.

- [ ] **Step 3: Commit**

```bash
git add tests/query-parity.test.ts
git commit -m "test(retrieval): pin Ask-Wiki parity with Ask-Domain pipeline"
```

---

### Task 8: Full test sweep, build, lint, commit dist

**Files:**
- Modify: `dist/` (regenerated bundle)

- [ ] **Step 1: Run the full new test set**

Run:
```bash
node --import tsx --test tests/chunk-dedup.test.ts tests/merge-sections.test.ts tests/ask-buttons-layout.test.ts tests/graph-scope-wiki.test.ts tests/query-parity.test.ts
```
Expected: all pass (6 + 5 + 2 + 2 + 6 = 21 tests), 0 fail.

- [ ] **Step 2: Guard against regressions in touched-area suites**

Run:
```bash
node --import tsx --test tests/reranker.test.ts tests/page-similarity-jsonl.test.ts tests/page-filter-centralization.test.ts
```
Expected: all pass (no regressions from the query-path edits).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: esbuild completes, `dist/main.js` regenerated, no errors.

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors.

- [ ] **Step 5: Commit the rebuilt bundle**

```bash
git add dist
git commit -m "chore(build): rebuild dist for chunk dedup, merge guard & ask-button swap"
```

---

## Verification (whole feature)

- Ask-Domain and Ask-Wiki: `dedupeChunks` runs between selection and rerank in both paths (Task 2 + Task 7 test); `query_stats.chunkDupsDropped` surfaces the count.
- Ingest merge (with `dedupOnIngest` on): an incoming draft's unique `##` section is appended when the LLM merge drops it (Task 3/4 test).
- Sidebar: Ask Wiki grey/first, Ask Domain accent/second (Task 5 test).
- Graph search operates only on `!Wiki/<subfolder>` content pages (Task 6 test).
- Ask-Wiki parity with Ask-Domain pipeline (Task 7 test).
- `npm run build` + `npm run lint` clean (Task 8).

## Notes / risks

- `ensureIncomingSections` compares only top-level `##` headings, normalized (lowercase, collapsed whitespace). A genuinely-new section whose heading differs from the merged one only by wording will still be appended — acceptable (never loses content). `## Sources` is intentionally NOT skipped by this spec; if a future change wants the merged page to carry the incoming source link, that is separate work.
- The P3/P4 tests are source-level guards (deterministic, no live LLM/embeddings). They pin the wiring that the audit verified; a full behavioral eval is out of scope for this plan.
