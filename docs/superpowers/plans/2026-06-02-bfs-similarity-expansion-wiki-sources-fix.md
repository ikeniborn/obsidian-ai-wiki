---
review:
  plan_hash: e7ba436d45fea69f
  spec_hash: 8881456ec82f2fa9
  last_run: 2026-06-03
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    "Task 1": 5b9a69d7be3526d6
    "Task 2": 98b94c4e901df89f
    "Task 3": 0f13a7b5c91eb4fa
    "Task 4": 58f55f7391e553c3
    "Task 5": 2adb045f5eca48d6
    "Task 6": 6024bd026acd33d7
  findings: []
chain:
  intent: docs/superpowers/intents/2026-06-02-bfs-similarity-expansion-wiki-sources-fix-intent.md
  spec: docs/superpowers/specs/2026-06-02-bfs-similarity-expansion-wiki-sources-fix-design.md
---
# BFS Similarity Expansion + wiki_sources Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add similarity-ranked BFS context selection to the query pipeline, and fix wiki_sources false-positive removal in lint by extending dead-link resolution to cover Obsidian title-based links.

**Architecture:** New `bfsExpandRanked` in `wiki-graph.ts` wraps `bfsExpand` with a similarity/Jaccard ranking pass, replacing `bfsExpandWithHops` in `query.ts`. In `lint.ts`, `buildTitleMap` pre-indexes vault file titles, `knownStems` is extended with their stems, and `validateWikiSources` (post-LLM guard) restores wiki_sources entries incorrectly removed by the LLM by re-checking both stem and title resolution. `hubThreshold` is removed everywhere and replaced by `bfsTopK`.

**Tech Stack:** TypeScript, Vitest (`npx vitest run`), Obsidian plugin, `PageSimilarityService` for embeddings, `scoreSeed`/`tokenize` from `wiki-seeds.ts` for Jaccard fallback, `filterStaleWikiLinks`/`parseWikiSourcesFromFm` from `raw-frontmatter.ts`.

---

## File Structure

**Modified files:**
- `src/types.ts` — remove `hubThreshold`, add `bfsTopK`; make `expandedByHop` optional in `graph_stats` RunEvent
- `src/i18n.ts` — remove `hubThreshold_name/desc` keys (3 locales), add `bfsTopK_name/desc`
- `src/settings.ts` — replace Hub threshold UI block with BFS top-K UI block
- `src/wiki-graph.ts` — update `checkGraphStructure` (remove `hubThreshold` param + hub check); add `bfsExpandRanked`
- `src/phases/query.ts` — add `bfsTopK` param; replace `bfsExpandWithHops` with `bfsExpandRanked`; make `expandedByHop` optional in yielded event
- `src/phases/lint.ts` — remove `hubThreshold` param; add `buildTitleMap` and `validateWikiSources`; wire both into `runLint`
- `src/agent-runner.ts` — pass `settings.bfsTopK` to `runQuery`; remove `settings.hubThreshold` from `runLint` call
- `tests/wiki-graph.test.ts` — update `checkGraphStructure` tests; add `bfsExpandRanked` tests
- `tests/phases/lint.test.ts` — add `buildTitleMap` and `validateWikiSources` tests

---

### Task 1: Remove `hubThreshold` — types, i18n, settings, wiki-graph, lint, agent-runner

**Files:**
- Modify: `src/types.ts`
- Modify: `src/i18n.ts`
- Modify: `src/settings.ts`
- Modify: `src/wiki-graph.ts`
- Modify: `src/phases/lint.ts`
- Modify: `src/agent-runner.ts`
- Modify: `tests/wiki-graph.test.ts`

- [ ] **Step 1: Update `checkGraphStructure` tests — remove hub detection, update signatures**

In `tests/wiki-graph.test.ts` around line 157, the `checkGraphStructure` describe block has 6 tests. Delete the hub node test entirely and remove the `hubThreshold` argument from all remaining calls:

```typescript
// DELETE this entire test:
it("detects hub node (outDegree > threshold)", () => { ... });

// UPDATE all remaining calls — remove the number argument:
// Before: checkGraphStructure(graph, 20)  or  checkGraphStructure(graph, 4)
// After:  checkGraphStructure(graph)
```

After edits the tests should look like:

```typescript
describe("checkGraphStructure", () => {
  it("detects isolated node (no in or out)", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set<string>()],
      ["Orphan", new Set<string>()],
    ]);
    const result = checkGraphStructure(graph);
    expect(result).toContain("Orphan: isolated node");
    expect(result).not.toContain("A: isolated");
  });

  it("detects unidirectional link A→B where B exists but has no edge to A", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set<string>()],
    ]);
    const result = checkGraphStructure(graph);
    expect(result).toContain("A → [[B]] not reciprocated");
  });

  it("does NOT flag bidirectional link as unidirectional", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    const result = checkGraphStructure(graph);
    expect(result).not.toContain("not reciprocated");
  });

  it("does NOT flag dangling link (target not in graph) as unidirectional", () => {
    const graph = new Map([["A", new Set(["Ghost"])]]);
    const result = checkGraphStructure(graph);
    expect(result).not.toContain("not reciprocated");
  });

  it("returns empty string when no issues", () => {
    const graph = new Map([
      ["A", new Set(["B"])],
      ["B", new Set(["A"])],
    ]);
    expect(checkGraphStructure(graph)).toBe("");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/wiki-graph.test.ts
```

Expected: FAIL — TypeScript error: `checkGraphStructure` still requires 2 arguments.

- [ ] **Step 3: Update `checkGraphStructure` in `src/wiki-graph.ts`**

At line 107, remove the `hubThreshold` parameter and the hub detection block (lines 124–126):

```typescript
// Before:
export function checkGraphStructure(graph: WikiGraph, hubThreshold: number): string {
  // ...
  if (outDeg > hubThreshold) {
    issues.push(`- ${node}: hub node (${outDeg} outgoing links)`);
  }
  // ...
}

// After:
export function checkGraphStructure(graph: WikiGraph): string {
  const inDegree = new Map<string, number>();
  for (const node of graph.keys()) {
    if (!inDegree.has(node)) inDegree.set(node, 0);
    for (const tgt of graph.get(node)!) {
      inDegree.set(tgt, (inDegree.get(tgt) ?? 0) + 1);
    }
  }

  const issues: string[] = [];
  for (const [node, neighbors] of graph) {
    const outDeg = neighbors.size;
    const inDeg = inDegree.get(node) ?? 0;

    if (inDeg === 0 && outDeg === 0) {
      issues.push(`- ${node}: isolated node (no links in or out)`);
    }
    // hub detection removed
    for (const tgt of neighbors) {
      if (graph.has(tgt) && !graph.get(tgt)!.has(node)) {
        issues.push(`- ${node} → [[${tgt}]] not reciprocated`);
      }
    }
  }
  return issues.join("\n");
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/wiki-graph.test.ts
```

Expected: PASS.

- [ ] **Step 5: Update `src/types.ts` — swap `hubThreshold` for `bfsTopK`; make `expandedByHop` optional**

In `LlmWikiPluginSettings`, replace:
```typescript
hubThreshold: number;
```
With:
```typescript
bfsTopK: number;
```

In `DEFAULT_SETTINGS`, replace:
```typescript
hubThreshold: 20,
```
With:
```typescript
bfsTopK: 10,
```

In the `graph_stats` RunEvent variant (around line 77–84), make `expandedByHop` optional since `bfsExpandRanked` does not track hops:
```typescript
// Before:
expandedByHop: Record<number, string[]>;

// After:
expandedByHop?: Record<number, string[]>;
```

- [ ] **Step 6: Update `src/i18n.ts` — replace `hubThreshold_name/desc` with `bfsTopK_name/desc`**

The i18n file has these keys in 3 locales (English ~line 78, Russian ~line 303, Spanish ~line 526). In all 3 locales, replace both keys:

```typescript
// English (replace existing):
bfsTopK_name: "BFS context top-K",
bfsTopK_desc: "Max BFS-expanded pages ranked by similarity and added to query context. 0 = all pages.",

// Russian (replace existing):
bfsTopK_name: "BFS top-K",
bfsTopK_desc: "Максимум страниц BFS, отранжированных по схожести и добавленных в контекст запроса. 0 = все страницы.",

// Spanish (replace existing):
bfsTopK_name: "BFS top-K",
bfsTopK_desc: "Máx. páginas BFS rankeadas por similitud agregadas al contexto. 0 = todas.",
```

Also update the `I18n` type interface (if it exists in the same file or a separate types file) — replace `hubThreshold_name: string; hubThreshold_desc: string;` with `bfsTopK_name: string; bfsTopK_desc: string;`.

- [ ] **Step 7: Update `src/settings.ts` — replace Hub threshold UI block**

Find the Hub threshold setting block (lines 685–698 approximately). Replace entirely:

```typescript
// Before (remove this block):
new Setting(containerEl)
  .setName(T.settings.hubThreshold_name)
  .setDesc(T.settings.hubThreshold_desc)
  .addText(text =>
    text
      .setPlaceholder("20")
      .setValue(String(s.hubThreshold))
      .onChange(async (value) => {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n > 0) {
          s.hubThreshold = n;
          await this.plugin.saveSettings();
        }
      })
  );

// After (add in same position):
new Setting(containerEl)
  .setName(T.settings.bfsTopK_name)
  .setDesc(T.settings.bfsTopK_desc)
  .addText(text =>
    text
      .setPlaceholder("10")
      .setValue(String(s.bfsTopK))
      .onChange(async (value) => {
        const n = parseInt(value, 10);
        if (!isNaN(n) && n >= 0) {
          s.bfsTopK = n;
          await this.plugin.saveSettings();
        }
      })
  );
```

- [ ] **Step 8: Update `src/phases/lint.ts` — remove `hubThreshold` parameter**

At line 64, remove `hubThreshold: number = 20,` from `runLint` signature.

At line 110, update the call:
```typescript
// Before:
const graphIssues = checkGraphStructure(graph, hubThreshold);
// After:
const graphIssues = checkGraphStructure(graph);
```

- [ ] **Step 9: Update `src/agent-runner.ts` — update both call sites**

At line 95, add `this.settings.bfsTopK` as the new positional argument before `similarity`:
```typescript
// Before:
yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, similarity);

// After:
yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, this.settings.bfsTopK, similarity);
```

At line 98, remove `this.settings.hubThreshold`:
```typescript
// Before:
yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.hubThreshold, this.settings.wikiLinkValidationRetries, opts, similarity);

// After:
yield* runLint(req.args, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.wikiLinkValidationRetries, opts, similarity);
```

- [ ] **Step 10: Run all tests**

```bash
npx vitest run
```

Expected: PASS (or only pre-existing failures unrelated to this task).

- [ ] **Step 11: Commit**

```bash
git add src/types.ts src/i18n.ts src/settings.ts src/wiki-graph.ts src/phases/lint.ts src/agent-runner.ts tests/wiki-graph.test.ts
git commit -m "refactor: replace hubThreshold with bfsTopK, remove hub detection from checkGraphStructure"
```

---

### Task 2: Implement `bfsExpandRanked`

**Files:**
- Modify: `src/wiki-graph.ts`
- Modify: `tests/wiki-graph.test.ts`

- [ ] **Step 1: Write failing tests for `bfsExpandRanked`**

Add at the end of `tests/wiki-graph.test.ts`. Import `bfsExpandRanked` (not yet exported — this will cause the first failure):

```typescript
import { bfsExpandRanked } from "../src/wiki-graph";
import type { PageSimilarityService } from "../src/page-similarity";

describe("bfsExpandRanked", () => {
  // A connects to B, C, D, E (all undirected via reverse edges)
  const graph = new Map<string, Set<string>>([
    ["A", new Set(["B", "C", "D", "E"])],
    ["B", new Set<string>()],
    ["C", new Set<string>()],
    ["D", new Set<string>()],
    ["E", new Set<string>()],
  ]);

  // vaultPath → content; pageId("vault/X.md") === "X"
  const pages = new Map([
    ["vault/A.md", "apple ant armor"],
    ["vault/B.md", "banana bread bake"],
    ["vault/C.md", "cat cup cake"],
    ["vault/D.md", "dog door dial"],
    ["vault/E.md", "egg ear extra"],
  ]);

  it("seeds always included even when bfsTopK=1 and many BFS pages exist", async () => {
    const result = await bfsExpandRanked(["A"], graph, 1, pages, "apple", 1);
    expect(result.has("A")).toBe(true);
  });

  it("bfsTopK=0 returns all BFS pages", async () => {
    const result = await bfsExpandRanked(["A"], graph, 1, pages, "query", 0);
    expect(result).toEqual(new Set(["A", "B", "C", "D", "E"]));
  });

  it("Jaccard fallback: page with higher overlap score included over lower-scored page at bfsTopK=1", async () => {
    // query "cat cup" overlaps with C="cat cup cake" but not B="banana bread bake"
    const result = await bfsExpandRanked(["A"], graph, 1, pages, "cat cup", 1);
    expect(result.has("A")).toBe(true);   // seed always included
    expect(result.has("C")).toBe(true);   // highest overlap
    expect(result.has("B")).toBe(false);  // no overlap
  });

  it("embedding path: mock similarity results are respected", async () => {
    const mockSimilarity = {
      selectRelevantScored: vi.fn().mockResolvedValue([
        { path: "vault/D.md", score: 0.9 },
        { path: "vault/B.md", score: 0.8 },
      ]),
    } as unknown as PageSimilarityService;

    const result = await bfsExpandRanked(
      ["A"], graph, 1, pages, "test query", 2,
      undefined, mockSimilarity,
    );
    expect(result.has("A")).toBe(true);   // seed always included
    expect(result.has("D")).toBe(true);   // rank 1 from mock
    expect(result.has("B")).toBe(true);   // rank 2 from mock
    expect(result.has("C")).toBe(false);  // not in top-2
  });

  it("similarity throws → fallback to full BFS, no exception thrown", async () => {
    const mockSimilarity = {
      selectRelevantScored: vi.fn().mockRejectedValue(new Error("API down")),
    } as unknown as PageSimilarityService;

    const result = await bfsExpandRanked(
      ["A"], graph, 1, pages, "query", 2,
      undefined, mockSimilarity,
    );
    // Full BFS fallback — all reachable pages returned
    expect(result).toEqual(new Set(["A", "B", "C", "D", "E"]));
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/wiki-graph.test.ts
```

Expected: FAIL — `bfsExpandRanked` not exported / not a function.

- [ ] **Step 3: Implement `bfsExpandRanked` in `src/wiki-graph.ts`**

Add imports at the top of `src/wiki-graph.ts`:
```typescript
import { tokenize, scoreSeed } from "./wiki-seeds";
import type { PageSimilarityService } from "./page-similarity";
```

Add the function after the existing `bfsExpandWithHops`:

```typescript
export async function bfsExpandRanked(
  seeds: string[],
  graph: WikiGraph,
  depth: number,
  pages: Map<string, string>,
  query: string,
  bfsTopK: number,
  annotations?: Map<string, string>,
  similarity?: PageSimilarityService,
): Promise<Set<string>> {
  const allBfs = bfsExpand(seeds, graph, depth);
  const seedSet = new Set(seeds.filter(s => allBfs.has(s)));

  if (bfsTopK <= 0) return allBfs;

  const nonSeeds = [...allBfs].filter(pid => !seedSet.has(pid));
  if (nonSeeds.length === 0) return new Set(seedSet);

  // Reverse lookup: pageId → vaultPath
  const pidToPath = new Map<string, string>();
  for (const vaultPath of pages.keys()) {
    pidToPath.set(pageId(vaultPath), vaultPath);
  }

  const nonSeedPaths = nonSeeds.flatMap(pid => {
    const p = pidToPath.get(pid);
    return p ? [p] : [];
  });

  if (similarity) {
    try {
      const scored = await similarity.selectRelevantScored(
        query,
        annotations ?? new Map(),
        nonSeedPaths,
      );
      const topPids = scored.slice(0, bfsTopK).map(({ path }) => pageId(path));
      return new Set([...seedSet, ...topPids]);
    } catch (err) {
      console.warn("[bfsExpandRanked] similarity threw, returning full BFS:", err);
      return allBfs;
    }
  }

  // Jaccard fallback
  const questionTokens = tokenize(query);
  const scored = nonSeeds.map(pid => {
    const path = pidToPath.get(pid);
    const content = path ? (pages.get(path) ?? "") : "";
    return { pid, score: scoreSeed(questionTokens, pid, content) };
  });
  scored.sort((a, b) => b.score - a.score);

  const topPids = scored.slice(0, bfsTopK).map(x => x.pid);
  return new Set([...seedSet, ...topPids]);
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/wiki-graph.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-graph.ts tests/wiki-graph.test.ts
git commit -m "feat(wiki-graph): add bfsExpandRanked with embedding/Jaccard ranking and bfsTopK limit"
```

---

### Task 3: Migrate `query.ts` to use `bfsExpandRanked`

**Files:**
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Add `bfsTopK` param and update import in `src/phases/query.ts`**

At line 12, update the import from `../wiki-graph`:
```typescript
// Before:
import { pageId, bfsExpandWithHops } from "../wiki-graph";

// After:
import { pageId, bfsExpandRanked } from "../wiki-graph";
```

In the `runQuery` function signature (line 20+), add `bfsTopK: number = 10` before `similarity`:
```typescript
export async function* runQuery(
  args: string[],
  save: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  graphDepth: number = 1,
  opts: LlmCallOptions = {},
  seedTopK: number = 5,
  seedMinScore: number = 0.1,
  bfsTopK: number = 10,          // ← new param
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent>
```

- [ ] **Step 2: Replace `bfsExpandWithHops` call with `bfsExpandRanked`**

At line 119, replace:
```typescript
// Before:
const { expanded: selectedIds, byHop: expandedByHop } = bfsExpandWithHops(seeds, graphResult.graph, graphDepth);
yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedByHop };

// After:
const selectedIds = await bfsExpandRanked(
  seeds,
  graphResult.graph,
  graphDepth,
  pages,
  question,
  bfsTopK,
  indexAnnotations,
  similarity,
);
yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores };
```

Note: `pages`, `question`, and `indexAnnotations` must be variables already available at this point in the function. Verify they are defined above line 119 — the `pages` map and `question` string should be in scope from earlier in `runQuery`. If `question` is named differently (e.g. `args.join(" ")` inlined), use the correct variable.

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/phases/query.ts
git commit -m "feat(query): replace bfsExpandWithHops with bfsExpandRanked for similarity-ranked BFS context"
```

---

### Task 4: Implement `buildTitleMap`

**Files:**
- Modify: `src/phases/lint.ts`
- Modify: `tests/phases/lint.test.ts`

- [ ] **Step 1: Write failing tests for `buildTitleMap`**

In `tests/phases/lint.test.ts`, add a new describe block. Import `buildTitleMap` (not yet exported — this causes the initial failure):

```typescript
import { buildTitleMap } from "../../src/phases/lint";

describe("buildTitleMap", () => {
  it("parses H1 heading and stores lowercased title → stem", async () => {
    const mockVaultTools = {
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "vault/wiki_os_pac_file.md") {
          return "# Настройка прокси\n\nContent here.";
        }
        throw new Error("not found");
      }),
    };

    const result = await buildTitleMap(
      ["vault/wiki_os_pac_file.md"],
      mockVaultTools as any,
    );

    expect(result.get("настройка прокси")).toBe("wiki_os_pac_file");
  });

  it("key is lowercased, so titleMap.has() with lowercase input resolves [[НАСТРОЙКА ПРОКСИ]]", async () => {
    const mockVaultTools = {
      read: vi.fn().mockResolvedValue("# Настройка Прокси\n\nContent."),
    };

    const result = await buildTitleMap(
      ["vault/wiki_os_pac_file.md"],
      mockVaultTools as any,
    );

    expect(result.has("настройка прокси")).toBe(true);
    expect(result.get("настройка прокси")).toBe("wiki_os_pac_file");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: FAIL — `buildTitleMap is not exported` or similar.

- [ ] **Step 3: Implement `buildTitleMap` in `src/phases/lint.ts`**

Add as an exported function (needed by tests; called internally by `runLint` in Task 6):

```typescript
export async function buildTitleMap(
  paths: string[],
  vaultTools: VaultTools,
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const path of paths) {
    try {
      const content = await vaultTools.read(path);
      const stem = path.split("/").pop()!.replace(/\.md$/, "");

      // Prefer title: frontmatter field
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
      if (fmMatch) {
        const titleMatch = fmMatch[1].match(/^title:\s*(.+)$/m);
        if (titleMatch) {
          result.set(titleMatch[1].trim().toLowerCase(), stem);
          continue;
        }
      }

      // Fall back to first H1
      const h1Match = content.match(/^# (.+)$/m);
      if (h1Match) {
        result.set(h1Match[1].trim().toLowerCase(), stem);
      }
      // No title found: skip — stem is already in knownStems by filename
    } catch {
      // Unreadable file: skip silently
    }
  }
  return result;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: PASS for `buildTitleMap` tests.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): add buildTitleMap for Obsidian title-based link resolution"
```

---

### Task 5: Implement `validateWikiSources`

**Files:**
- Modify: `src/phases/lint.ts`
- Modify: `tests/phases/lint.test.ts`

- [ ] **Step 1: Write failing tests for `validateWikiSources`**

Add to `tests/phases/lint.test.ts`:

```typescript
import { validateWikiSources } from "../../src/phases/lint";

describe("validateWikiSources", () => {
  const knownStems = new Set(["wiki_os_pac_file", "wiki_networking_dns"]);
  const titleMap = new Map([["настройка прокси", "wiki_os_pac_file"]]);

  const makeContent = (sources: string[]) =>
    `---\nwiki_sources:\n${sources.map(s => `  - ${s}`).join("\n")}\n---\n# Article`;

  it("[[Настройка прокси]] with matching titleMap entry → preserved", () => {
    const content = makeContent(["[[Настройка прокси]]"]);
    const result = validateWikiSources(content, knownStems, titleMap);
    expect(result).toContain("[[Настройка прокси]]");
  });

  it("[[wiki_os_deleted_page]] not in knownStems or titleMap → removed", () => {
    const content = makeContent(["[[wiki_os_deleted_page]]"]);
    const result = validateWikiSources(content, knownStems, titleMap);
    expect(result).not.toContain("[[wiki_os_deleted_page]]");
  });

  it("content without frontmatter → returned unchanged", () => {
    const content = "no frontmatter here\n# Article";
    const result = validateWikiSources(content, knownStems, titleMap);
    expect(result).toBe(content);
  });

  it("entry without [[...]] format → left intact", () => {
    const content = makeContent(["plain-text-entry"]);
    const result = validateWikiSources(content, knownStems, titleMap);
    expect(result).toContain("plain-text-entry");
  });
});
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: FAIL — `validateWikiSources is not exported`.

- [ ] **Step 3: Implement `validateWikiSources` in `src/phases/lint.ts`**

The function re-uses `filterStaleWikiLinks` for FM manipulation: it builds a set that includes all validated entry texts (both stem-based and title-based), then calls `filterStaleWikiLinks` which only removes entries NOT in that set.

```typescript
export function validateWikiSources(
  content: string,
  knownStems: Set<string>,
  titleMap: Map<string, string>,
): string {
  const entries = parseWikiSourcesFromFm(content);
  if (entries.length === 0) return content;

  const isValid = (entry: string): boolean => {
    const m = entry.match(/^\[\[(.+?)\]\]$/);
    if (!m) return true;  // non-wikilink format: keep as-is
    const text = m[1];
    return knownStems.has(text) || titleMap.has(text.toLowerCase());
  };

  const validated = entries.filter(isValid);
  if (validated.length === entries.length) return content;

  // Build a stems set that preserves exactly the validated entry texts.
  // Any entry not in this set will be removed by filterStaleWikiLinks.
  const preserveTexts = new Set<string>(knownStems);
  for (const entry of validated) {
    const m = entry.match(/^\[\[(.+?)\]\]$/);
    if (m) preserveTexts.add(m[1]);
  }

  const { content: result } = filterStaleWikiLinks(content, preserveTexts, ["wiki_sources"]);
  return result;
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): add validateWikiSources to guard against false-positive wiki_sources removal"
```

---

### Task 6: Wire `buildTitleMap` + `validateWikiSources` into `runLint`

**Files:**
- Modify: `src/phases/lint.ts`

- [ ] **Step 1: Add `buildTitleMap` call after `knownStems` is built**

In `runLint`, after line 120 (end of `knownStems` Set construction) and before `stemToPath`, insert:

```typescript
// Build title map from non-wiki vault files (runs once per domain)
const nonWikiPaths = allMdPaths.filter(p => !p.startsWith(wikiVaultPath + "/"));
const titleMap = await buildTitleMap(nonWikiPaths, vaultTools);

// Extend knownStems with stems from titleMap (its values)
for (const stem of titleMap.values()) {
  knownStems.add(stem);
}
```

- [ ] **Step 2: Add `validateWikiSources` call in the per-article fix loop**

Inside the per-article loop, at the fix-writing step (around line 253), `fixedContent` is computed from `wlFixResult.fixed.get(fix.path) ?? fix.content`. Apply `validateWikiSources` before writing to disk:

```typescript
// Before:
const fixedContent = wlFixResult.fixed.get(fix.path) ?? fix.content;
await vaultTools.write(fix.path, fixedContent);
pages.set(fix.path, fixedContent);

// After:
const rawFixed = wlFixResult.fixed.get(fix.path) ?? fix.content;
const fixedContent = validateWikiSources(rawFixed, knownStems, titleMap);
await vaultTools.write(fix.path, fixedContent);
pages.set(fix.path, fixedContent);
```

- [ ] **Step 3: Run all tests**

```bash
npx vitest run
```

Expected: PASS. If any `runLint` integration tests fail, investigate — do not skip.

- [ ] **Step 4: Commit**

```bash
git add src/phases/lint.ts
git commit -m "feat(lint): wire buildTitleMap + validateWikiSources into runLint for title-aware wiki_sources validation"
```

---

## Self-Review

**Spec coverage check:**

| Requirement | Covered by |
|---|---|
| BFS topology traversal + similarity ranking pass | Task 2 (`bfsExpandRanked`) |
| `bfsTopK` replaces `hubThreshold` | Task 1 + Task 2 |
| Hub threshold removed from settings, types, lint | Task 1 |
| `wiki_sources` preserved through lint pipeline | Task 5 + Task 6 |
| Removed only when unresolvable from stem AND title | `validateWikiSources` filter logic |
| Lint resolves by filename stem OR page title | Task 4 (`buildTitleMap`) + Task 6 (knownStems extension) |
| `wiki_outgoing_links` wiki-internal only | `filterStaleWikiLinks` unchanged — not touched |
| Seeds always in result regardless of `bfsTopK` | `bfsExpandRanked`: `seedSet` always in result |
| `bfsTopK <= 0` returns all BFS pages | `bfsExpandRanked`: early return before ranking |
| Similarity throws → full BFS fallback | `bfsExpandRanked`: catch block returns `allBfs` |
| Embedding unavailable (no similarity) → Jaccard | `bfsExpandRanked`: Jaccard path when `similarity` is undefined |

All spec requirements covered. No extra requirements added.

**Type consistency check:**

- `bfsExpandRanked` returns `Promise<Set<string>>` in implementation (Task 2) and is awaited in query.ts (Task 3) ✓
- `buildTitleMap` returns `Promise<Map<string, string>>` in implementation (Task 4), `await`-ed in Task 6 ✓
- `validateWikiSources` returns `string` in implementation (Task 5) and used synchronously in Task 6 ✓
- `checkGraphStructure(graph)` — 0 args after hubThreshold removal, consistent across Task 1 tests and implementation ✓
- `filterStaleWikiLinks` used in `validateWikiSources` — returns `{ content: string; warnings: string[] }`, `.content` accessed ✓
- `runQuery` new param `bfsTopK: number = 10` added before `similarity` in Task 3; `agent-runner.ts` passes it in Task 1 Step 9 ✓
- `runLint` removes `hubThreshold`; `agent-runner.ts` call updated in Task 1 Step 9 ✓
