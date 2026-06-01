---
review:
  plan_hash: "4d55595e99e6fb8b"
  spec_hash: "1ec76461052a7103"
  last_run: "2026-06-01"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: verifiability
      severity: WARNING
      section: "Task 1"
      text: "Task 1 Step 2 expected output is misleading — after extending graph_stats type, npx tsc --noEmit WILL show errors in query.ts (missing seedScores/expandedByHop), but text says 'no errors related to graph_stats'. This is expected intermediate state, not a test failure."
      verdict: accepted
chain:
  intent: "docs/superpowers/intents/2026-06-01-query-tracing-intent.md"
  spec:   "docs/superpowers/specs/2026-06-01-query-tracing-design.md"
---

# Query Pipeline Tracing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add seed scores, BFS-by-hop breakdown, and token counts to the query trace visible in Obsidian UI and `_agent.jsonl`.

**Architecture:** Extend the `graph_stats` RunEvent with two new fields (`seedScores`, `expandedByHop`). Add parallel functions (`bfsExpandWithHops`, `selectRelevantScored`, updated `selectSeeds` return type) that produce the extra data without changing any shared caller paths (lint/ingest/format unaffected). Gate extended UI rendering on `agentLogEnabled`.

**Tech Stack:** TypeScript, Vitest, Obsidian plugin DOM APIs

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `src/types.ts` | Modify | Add `seedScores`, `expandedByHop` to `graph_stats` |
| `src/wiki-graph.ts` | Modify | Add `bfsExpandWithHops`; leave `bfsExpand` unchanged |
| `src/wiki-seeds.ts` | Modify | `selectSeeds` returns `{ id; score }[]` not `string[]` |
| `src/page-similarity.ts` | Modify | Add `selectRelevantScored` alongside `selectRelevant` |
| `src/phases/query.ts` | Modify | Collect scores, use new functions, emit extended `graph_stats` |
| `src/view.ts` | Modify | Extract `formatGraphStatsLines`, gate on `agentLogEnabled` |
| `src/phases/llm-utils.ts` | Modify | `computeSpeedText` shows token counts |
| `tests/wiki-graph.test.ts` | Modify | Add `bfsExpandWithHops` unit tests |
| `tests/wiki-seeds.test.ts` | Modify | Update `selectSeeds` tests for new return type |
| `tests/page-similarity.test.ts` | Modify | Add `selectRelevantScored` tests |
| `tests/phases/query.test.ts` | Modify | Assert extended `graph_stats` fields |
| `tests/view-graph-trace.test.ts` | Create | Unit-test `formatGraphStatsLines` pure function |
| `tests/llm-utils.test.ts` | Modify | Update `computeSpeedText` format assertions |

---

### Task 1: Extend `graph_stats` type

**Files:**
- Modify: `src/types.ts:77-82`

- [ ] **Step 1: Add fields to `graph_stats` union member**

Replace the current `graph_stats` union member (lines 77–82 in `src/types.ts`):

```ts
  | {
      kind: "graph_stats";
      seeds: string[];
      expanded: number;
      total: number;
      fromCache: boolean;
      seedScores: Record<string, number>;
      expandedByHop: Record<number, string[]>;
    };
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: no errors related to `graph_stats` (existing callers in `query.ts` and `view.ts` will show errors — that's expected and will be fixed in later tasks).

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): extend graph_stats with seedScores and expandedByHop"
```

---

### Task 2: Add `bfsExpandWithHops` to `wiki-graph.ts`

**Files:**
- Modify: `src/wiki-graph.ts`
- Test: `tests/wiki-graph.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/wiki-graph.test.ts` after the existing `bfsExpand` describe block:

```ts
import { pageId, buildWikiGraph, bfsExpand, bfsExpandWithHops, checkGraphStructure } from "../src/wiki-graph";

describe("bfsExpandWithHops", () => {
  // Graph: A → B → C → D, E isolated
  const graph = new Map([
    ["A", new Set(["B"])],
    ["B", new Set(["C"])],
    ["C", new Set(["D"])],
    ["D", new Set<string>()],
    ["E", new Set<string>()],
  ]);

  it("depth=0 returns only seeds in hop 0, byHop empty", () => {
    const { expanded, byHop } = bfsExpandWithHops(["A"], graph, 0);
    expect(expanded).toEqual(new Set(["A"]));
    expect(Object.keys(byHop)).toHaveLength(0);
  });

  it("depth=1 attributes direct neighbors to hop 1", () => {
    const { expanded, byHop } = bfsExpandWithHops(["B"], graph, 1);
    // B is seed, A and C are hop 1 (undirected)
    expect(expanded).toEqual(new Set(["A", "B", "C"]));
    expect(byHop[1]).toEqual(expect.arrayContaining(["A", "C"]));
    expect(byHop[1]).toHaveLength(2);
  });

  it("depth=2 attributes second-level neighbors to hop 2", () => {
    const { expanded, byHop } = bfsExpandWithHops(["B"], graph, 2);
    expect(byHop[1]).toEqual(expect.arrayContaining(["A", "C"]));
    expect(byHop[2]).toEqual(expect.arrayContaining(["D"]));
  });

  it("returns empty expanded and empty byHop for empty seeds", () => {
    const { expanded, byHop } = bfsExpandWithHops([], graph, 2);
    expect(expanded).toEqual(new Set());
    expect(byHop).toEqual({});
  });

  it("handles seed not in graph", () => {
    const { expanded, byHop } = bfsExpandWithHops(["Unknown"], graph, 1);
    expect(expanded).toEqual(new Set(["Unknown"]));
    expect(byHop).toEqual({});
  });

  it("does not include isolated nodes not reachable from seeds", () => {
    const { expanded } = bfsExpandWithHops(["A"], graph, 3);
    expect(expanded.has("E")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/wiki-graph.test.ts 2>&1 | tail -10
```

Expected: `bfsExpandWithHops is not a function` or similar import error.

- [ ] **Step 3: Implement `bfsExpandWithHops` in `src/wiki-graph.ts`**

Add after the `bfsExpand` function:

```ts
export function bfsExpandWithHops(
  seeds: string[],
  graph: WikiGraph,
  depth: number,
): { expanded: Set<string>; byHop: Record<number, string[]> } {
  if (seeds.length === 0) return { expanded: new Set(), byHop: {} };

  // Pre-compute reverse index (same logic as bfsExpand)
  const reverse = new Map<string, Set<string>>();
  for (const [src, targets] of graph) {
    for (const tgt of targets) {
      if (!reverse.has(tgt)) reverse.set(tgt, new Set());
      reverse.get(tgt)!.add(src);
    }
  }

  const visited = new Set<string>(seeds);
  let frontier = new Set<string>(seeds);
  const byHop: Record<number, string[]> = {};

  for (let hop = 1; hop <= depth; hop++) {
    const next = new Set<string>();
    for (const node of frontier) {
      for (const neighbor of graph.get(node) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
      for (const neighbor of reverse.get(node) ?? []) {
        if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
      }
    }
    if (next.size === 0) break;
    byHop[hop] = [...next];
    frontier = next;
  }

  return { expanded: visited, byHop };
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npx vitest run tests/wiki-graph.test.ts 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-graph.ts tests/wiki-graph.test.ts
git commit -m "feat(wiki-graph): add bfsExpandWithHops — tracks pages by BFS depth"
```

---

### Task 3: Update `selectSeeds` return type

**Files:**
- Modify: `src/wiki-seeds.ts`
- Test: `tests/wiki-seeds.test.ts`

- [ ] **Step 1: Write failing tests**

Update the existing `selectSeeds` tests in `tests/wiki-seeds.test.ts` — the `describe("selectSeeds")` block. Replace the inner `it` bodies to assert the new `{ id, score }[]` shape:

```ts
describe("selectSeeds", () => {
  const pages = new Map([
    ["wiki/Alpha.md", "alpha content here"],
    ["wiki/Beta.md", "beta unrelated"],
    ["wiki/Gamma.md", "gamma neural network details"],
  ]);

  it("respects topK", () => {
    const r = selectSeeds("alpha beta gamma", pages, 1, 0);
    expect(r.length).toBe(1);
    expect(r[0]).toHaveProperty("id");
    expect(r[0]).toHaveProperty("score");
  });

  it("filters by minScore", () => {
    const r = selectSeeds("alpha", pages, 10, 0.5);
    expect(r.map(x => x.id)).toContain("Alpha");
    expect(r.map(x => x.id)).not.toContain("Beta");
  });

  it("sorts by score descending", () => {
    const r = selectSeeds("alpha gamma neural", pages, 10, 0);
    expect(r[0].id).toBe("Gamma");
  });

  it("returns [] when nothing passes threshold", () => {
    expect(selectSeeds("xyz", pages, 10, 0.5)).toEqual([]);
  });

  it("matches content-only references (not in pageId)", () => {
    const r = selectSeeds("neural network", pages, 10, 0);
    expect(r.map(x => x.id)).toContain("Gamma");
  });

  it("caps content tokenization to first 500 chars", () => {
    const big = new Map([["wiki/Big.md", "irrelevant ".repeat(50) + "needle"]]);
    expect(selectSeeds("needle", big, 10, 0)).toEqual([]);
  });
});

describe("selectSeeds with indexAnnotations", () => {
  const pages = new Map([
    ["wiki/Alpha.md", "# Alpha\nalpha content here"],
    ["wiki/Beta.md", "# Beta\nbeta unrelated"],
  ]);

  it("uses annotation from indexAnnotations map", () => {
    const annotations = new Map([["Alpha", "альфа-частица физика ядро"]]);
    const r = selectSeeds("альфа физика", pages, 10, 0.1, annotations);
    expect(r.map(x => x.id)).toContain("Alpha");
  });

  it("works without indexAnnotations (backward compat)", () => {
    const r = selectSeeds("alpha content", pages, 10, 0);
    expect(r.map(x => x.id)).toContain("Alpha");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/wiki-seeds.test.ts 2>&1 | tail -10
```

Expected: assertion failures (current `selectSeeds` returns `string[]`).

- [ ] **Step 3: Update `selectSeeds` in `src/wiki-seeds.ts`**

Change the function signature and return value (the internal `scored` array already has `{ id, score }[]` shape — just stop mapping to `string[]`):

```ts
export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
  indexAnnotations?: Map<string, string>,
): { id: string; score: number }[] {
  const q = tokenize(question);
  if (q.size === 0) return [];
  const scored: { id: string; score: number }[] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    const annotation = indexAnnotations?.get(id);
    const score = scoreSeed(q, id, content, annotation);
    if (score >= minScore && score > 0) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
```

- [ ] **Step 4: Run wiki-seeds tests**

```bash
npx vitest run tests/wiki-seeds.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Check for other callers (should be none except query.ts)**

```bash
grep -rn "selectSeeds" src/ tests/
```

Expected: `src/wiki-seeds.ts` (definition), `src/phases/query.ts` (one caller). `query.ts` will be fixed in Task 5.

- [ ] **Step 6: Commit**

```bash
git add src/wiki-seeds.ts tests/wiki-seeds.test.ts
git commit -m "feat(wiki-seeds): selectSeeds returns scored results {id, score}[]"
```

---

### Task 4: Add `selectRelevantScored` to `PageSimilarityService`

**Files:**
- Modify: `src/page-similarity.ts`
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write failing tests**

Add a new `describe` block to `tests/page-similarity.test.ts`:

```ts
describe("PageSimilarityService.selectRelevantScored (Jaccard)", () => {
  it("returns scored paths with scores in [0,1]", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 3 });
    const annotations = new Map([
      ["Alpha", "machine learning neural network deep"],
      ["Beta",  "cooking recipes ingredients kitchen"],
      ["Gamma", "machine learning classification model"],
    ]);
    const allPaths = [
      "!Wiki/d/alpha/Alpha.md",
      "!Wiki/d/beta/Beta.md",
      "!Wiki/d/gamma/Gamma.md",
    ];
    const result = await svc.selectRelevantScored(
      "deep learning neural network classification",
      annotations,
      allPaths,
    );
    expect(result.length).toBeGreaterThan(0);
    for (const { path, score } of result) {
      expect(typeof path).toBe("string");
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(1);
    }
    // Alpha and Gamma rank ahead of Beta
    const topPaths = result.slice(0, 2).map(x => x.path);
    expect(topPaths.some(p => p.includes("Alpha"))).toBe(true);
    expect(topPaths.some(p => p.includes("Gamma"))).toBe(true);
  });

  it("returns empty when source has no tokens", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map([["Alpha", "machine learning"]]);
    const allPaths = ["!Wiki/d/sub/Alpha.md"];
    const result = await svc.selectRelevantScored("", annotations, allPaths);
    expect(result).toHaveLength(0);
  });

  it("scores match those returned by selectJaccard internally", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map([
      ["Alpha", "neural network deep learning"],
      ["Beta", "cooking recipes"],
    ]);
    const allPaths = ["!Wiki/d/sub/Alpha.md", "!Wiki/d/sub/Beta.md"];
    const scored = await svc.selectRelevantScored("neural deep", annotations, allPaths);
    const alphaEntry = scored.find(x => x.path.includes("Alpha"));
    expect(alphaEntry).toBeDefined();
    expect(alphaEntry!.score).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/page-similarity.test.ts 2>&1 | tail -10
```

Expected: `svc.selectRelevantScored is not a function`.

- [ ] **Step 3: Add `selectRelevantScored` to `src/page-similarity.ts`**

Add after the `selectRelevant` method (around line 113):

```ts
  async selectRelevantScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): Promise<{ path: string; score: number }[]> {
    const queryTokens = tokenize(sourceContent);
    if (queryTokens.size === 0) return [];

    if (this.config.mode === "jaccard") {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths);
    }
    return this.selectEmbeddingScored(sourceContent, indexAnnotations, allPaths, queryTokens);
  }
```

Add the private helpers after the `selectJaccard` and `selectEmbedding` methods:

```ts
  private selectJaccardScored(
    queryTokens: Set<string>,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
  ): { path: string; score: number }[] {
    const scored: { path: string; score: number }[] = [];
    for (const path of allPaths) {
      const pid = pageId(path);
      const annotation = indexAnnotations.get(pid);
      if (!annotation) continue;
      const score = scoreSeed(queryTokens, pid, "", annotation);
      if (score > 0) scored.push({ path, score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, this.config.topK);
  }

  private async selectEmbeddingScored(
    sourceContent: string,
    indexAnnotations: Map<string, string>,
    allPaths: string[],
    queryTokens: Set<string>,
  ): Promise<{ path: string; score: number }[]> {
    const { baseUrl, apiKey, model, topK } = this.config;
    if (!baseUrl || !model) {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths);
    }

    let queryVec: Float32Array;
    try {
      const truncated = sourceContent.slice(0, 2000);
      [queryVec] = await fetchEmbeddings(baseUrl, apiKey!, model, [truncated]);
    } catch {
      return this.selectJaccardScored(queryTokens, indexAnnotations, allPaths);
    }

    const pids = allPaths.map((p) => pageId(p));
    const annotations = pids.map((pid) => indexAnnotations.get(pid) ?? "");
    const pageVecs = new Map<string, Float32Array>();

    if (this.cache && this.cache.model === model) {
      for (let i = 0; i < pids.length; i++) {
        const entry = this.cache.entries[pids[i]];
        if (entry) pageVecs.set(pids[i], decodeVector(entry.vector));
      }
    }

    const batches: { pids: string[]; texts: string[] }[] = [];
    let cur: { pids: string[]; texts: string[] } = { pids: [], texts: [] };
    for (let i = 0; i < pids.length; i++) {
      if (!annotations[i] || pageVecs.has(pids[i])) continue;
      cur.pids.push(pids[i]);
      cur.texts.push(annotations[i]);
      if (cur.pids.length >= EMBEDDING_BATCH_SIZE) { batches.push(cur); cur = { pids: [], texts: [] }; }
    }
    if (cur.pids.length > 0) batches.push(cur);

    for (const batch of batches) {
      try {
        const vecs = await fetchEmbeddings(baseUrl, apiKey!, model, batch.texts);
        for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], vecs[i]);
      } catch {
        for (const pid of batch.pids) pageVecs.set(pid, new Float32Array(0));
      }
    }

    const scored: { path: string; score: number }[] = [];
    for (let i = 0; i < allPaths.length; i++) {
      const pid = pids[i];
      const vec = pageVecs.get(pid);
      if (!vec) continue;
      const score = vec.length === 0
        ? scoreSeed(queryTokens, pid, "", annotations[i])
        : cosine(queryVec, vec);
      if (score > 0) scored.push({ path: allPaths[i], score });
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
```

- [ ] **Step 4: Run page-similarity tests**

```bash
npx vitest run tests/page-similarity.test.ts 2>&1 | tail -10
```

Expected: all pass (new tests pass, existing tests unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat(page-similarity): add selectRelevantScored — returns {path, score}[]"
```

---

### Task 5: Update `query.ts` to collect and emit extended trace

**Files:**
- Modify: `src/phases/query.ts`
- Test: `tests/phases/query.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `tests/phases/query.test.ts` after existing tests:

```ts
  it("graph_stats event includes seedScores and expandedByHop", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Alpha.md", "!Wiki/work/Beta.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Alpha]] !Wiki/work/Alpha.md — machine learning\n- [[Beta]] !Wiki/work/Beta.md — cooking";
        if (p.endsWith("Alpha.md")) return "# Alpha\n[[Beta]]\nmachine learning content";
        if (p.endsWith("Beta.md")) return "# Beta\ncooking content";
        return "";
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(
        ["machine learning"],
        false,
        vt,
        makeLlm("answer"),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
        1, // graphDepth=1 so BFS expands
      ),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats).toBeDefined();
    expect(stats.seedScores).toBeDefined();
    expect(typeof stats.seedScores).toBe("object");
    // At least one seed should have a score
    const scoreValues = Object.values(stats.seedScores) as number[];
    expect(scoreValues.some(s => s > 0)).toBe(true);
    expect(stats.expandedByHop).toBeDefined();
    expect(typeof stats.expandedByHop).toBe("object");
  });
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/phases/query.test.ts 2>&1 | tail -15
```

Expected: `stats.seedScores` is undefined or TypeScript compile error.

- [ ] **Step 3: Update imports in `src/phases/query.ts`**

Replace:
```ts
import { pageId, bfsExpand } from "../wiki-graph";
import { selectSeeds } from "../wiki-seeds";
```

With:
```ts
import { pageId, bfsExpandWithHops } from "../wiki-graph";
import { selectSeeds } from "../wiki-seeds";
```

- [ ] **Step 4: Update Phase 2 (seed selection) in `src/phases/query.ts`**

Replace the current Phase 2 block:

```ts
  // Phase 2: seed selection from index annotations (no file content needed)
  let seeds: string[];
  if (similarity && similarity.config.mode === "embedding") {
    await similarity.loadCache(wikiVaultPath, vaultTools);
    const allAnnotatedPaths = [...indexAnnotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`);
    const selected = await similarity.selectRelevant(question, indexAnnotations, allAnnotatedPaths);
    seeds = selected.map((p) => pageId(p)).slice(0, topK);
  } else {
    const syntheticPages = new Map<string, string>(
      [...indexAnnotations.keys()].map((id) => [`${wikiVaultPath}/${id}.md`, ""])
    );
    seeds = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
  }
```

With:

```ts
  // Phase 2: seed selection from index annotations (no file content needed)
  let seeds: string[];
  let seedScores: Record<string, number> = {};
  if (similarity && similarity.config.mode === "embedding") {
    await similarity.loadCache(wikiVaultPath, vaultTools);
    const allAnnotatedPaths = [...indexAnnotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`);
    const selected = await similarity.selectRelevantScored(question, indexAnnotations, allAnnotatedPaths);
    const topSelected = selected.slice(0, topK);
    seeds = topSelected.map((x) => pageId(x.path));
    seedScores = Object.fromEntries(topSelected.map((x) => [pageId(x.path), x.score]));
  } else {
    const syntheticPages = new Map<string, string>(
      [...indexAnnotations.keys()].map((id) => [`${wikiVaultPath}/${id}.md`, ""])
    );
    const seedResults = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
    seeds = seedResults.map((x) => x.id);
    seedScores = Object.fromEntries(seedResults.map((x) => [x.id, x.score]));
  }
```

- [ ] **Step 5: Update Phase 4 (BFS + graph_stats yield) in `src/phases/query.ts`**

Replace:
```ts
  const selectedIds = bfsExpand(seeds, graphResult.graph, graphDepth);
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache };
```

With:
```ts
  const { expanded: selectedIds, byHop: expandedByHop } = bfsExpandWithHops(seeds, graphResult.graph, graphDepth);
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedByHop };
```

- [ ] **Step 6: Run query tests**

```bash
npx vitest run tests/phases/query.test.ts 2>&1 | tail -15
```

Expected: all tests pass including new one.

- [ ] **Step 7: Run full test suite to confirm lint/ingest not broken**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/phases/query.ts tests/phases/query.test.ts
git commit -m "feat(query): collect seed scores and BFS-by-hop, emit in graph_stats"
```

---

### Task 6: Update `view.ts` — extract formatter and gate on `agentLogEnabled`

**Files:**
- Modify: `src/view.ts`
- Create: `tests/view-graph-trace.test.ts`

- [ ] **Step 1: Write failing tests for the formatter**

Create `tests/view-graph-trace.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { formatGraphStatsLines } from "../src/view";

describe("formatGraphStatsLines", () => {
  const baseEvent = {
    kind: "graph_stats" as const,
    seeds: ["ArticleA", "ArticleB", "ArticleC"],
    expanded: 7,
    total: 42,
    fromCache: false,
    seedScores: { ArticleA: 0.87, ArticleB: 0.72, ArticleC: 0.41 },
    expandedByHop: { 1: ["ArticleD", "ArticleE"], 2: ["ArticleF", "ArticleG"] },
  };

  it("compact mode: returns single line without scores", () => {
    const lines = formatGraphStatsLines(baseEvent, false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("Граф:");
    expect(lines[0]).toContain("3 seeds");
    expect(lines[0]).not.toContain("0.87");
  });

  it("compact mode: truncates seeds to 3 in preview", () => {
    const lines = formatGraphStatsLines(baseEvent, false);
    expect(lines[0]).toContain("ArticleA");
    expect(lines[0]).toContain("ArticleB");
    expect(lines[0]).toContain("ArticleC");
  });

  it("compact mode: shows cache hit hint", () => {
    const cached = { ...baseEvent, fromCache: true };
    const lines = formatGraphStatsLines(cached, false);
    expect(lines[0]).toContain("cache hit");
  });

  it("trace mode: shows scores formatted to 2 decimal places", () => {
    const lines = formatGraphStatsLines(baseEvent, true);
    expect(lines[0]).toContain("ArticleA (0.87)");
    expect(lines[0]).toContain("ArticleB (0.72)");
  });

  it("trace mode: truncates seeds to 5 with …+N", () => {
    const many = {
      ...baseEvent,
      seeds: ["A", "B", "C", "D", "E", "F", "G"],
      seedScores: { A: 0.9, B: 0.8, C: 0.7, D: 0.6, E: 0.5, F: 0.4, G: 0.3 },
    };
    const lines = formatGraphStatsLines(many, true);
    expect(lines[0]).toContain("…+2");
    expect(lines[0]).not.toContain("(0.40)"); // F not shown
  });

  it("trace mode: shows BFS hop lines", () => {
    const lines = formatGraphStatsLines(baseEvent, true);
    expect(lines.some(l => l.includes("BFS +1") && l.includes("ArticleD"))).toBe(true);
    expect(lines.some(l => l.includes("BFS +2") && l.includes("ArticleF"))).toBe(true);
  });

  it("trace mode: omits BFS lines when expandedByHop is empty", () => {
    const noHops = { ...baseEvent, expandedByHop: {} };
    const lines = formatGraphStatsLines(noHops, true);
    expect(lines.every(l => !l.includes("BFS"))).toBe(true);
  });

  it("trace mode: omits seeds with score 0.00", () => {
    const zeroScore = {
      ...baseEvent,
      seeds: ["ArticleA", "ArticleZ"],
      seedScores: { ArticleA: 0.87, ArticleZ: 0 },
      expandedByHop: {},
    };
    const lines = formatGraphStatsLines(zeroScore, true);
    // ArticleZ with score 0 should not appear as "(0.00)"
    expect(lines[0]).not.toContain("(0.00)");
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
npx vitest run tests/view-graph-trace.test.ts 2>&1 | tail -10
```

Expected: `formatGraphStatsLines is not exported from ../src/view`.

- [ ] **Step 3: Add `formatGraphStatsLines` export to `src/view.ts`**

Add this exported function near the top of `src/view.ts` (after the imports, before the class definition):

```ts
import type { RunEvent } from "./types";

export function formatGraphStatsLines(
  ev: Extract<RunEvent, { kind: "graph_stats" }>,
  agentLogEnabled: boolean,
): string[] {
  if (!agentLogEnabled) {
    // Compact form (unchanged behavior)
    const preview = ev.seeds.slice(0, 3).join(", ");
    const extra = ev.seeds.length > 3 ? `, …+${ev.seeds.length - 3}` : "";
    const cacheHint = ev.fromCache ? " (cache hit)" : "";
    return [`Граф: ${ev.seeds.length} seeds [${preview}${extra}] → ${ev.expanded} / ${ev.total} страниц${cacheHint}`];
  }

  // Trace form
  const SEED_CAP = 5;
  const cacheHint = ev.fromCache ? "  [cache hit]" : "";
  const shown = ev.seeds.slice(0, SEED_CAP);
  const remainder = ev.seeds.length - shown.length;
  const seedParts = shown
    .filter(id => (ev.seedScores[id] ?? 0) > 0)
    .map(id => `${id} (${(ev.seedScores[id] ?? 0).toFixed(2)})`);
  const seedStr = seedParts.join(", ") + (remainder > 0 ? `, …+${remainder}` : "");
  const lines: string[] = [`Seeds: ${seedStr}${cacheHint}`];

  const hops = Object.keys(ev.expandedByHop).map(Number).sort((a, b) => a - b);
  for (const hop of hops) {
    const pages = ev.expandedByHop[hop];
    if (pages.length > 0) lines.push(`BFS +${hop}: [${pages.join(", ")}]`);
  }
  return lines;
}
```

- [ ] **Step 4: Update `graph_stats` handler in `src/view.ts`**

Replace the current handler (around line 569):

```ts
    if (ev.kind === "graph_stats") {
      const cacheHint = ev.fromCache ? " (cache hit)" : "";
      const preview = ev.seeds.slice(0, 3).join(", ");
      const extra = ev.seeds.length > 3 ? `, …+${ev.seeds.length - 3}` : "";
      const step = this.stepsEl.createDiv("ai-wiki-step");
      const graphHead = step.createDiv("ai-wiki-step-head");
      graphHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("🌐");
      graphHead.createSpan({ cls: "ai-wiki-step-name" })
        .setText(`Граф: ${ev.seeds.length} seeds [${preview}${extra}] → ${ev.expanded} / ${ev.total} страниц${cacheHint}`);
      graphHead.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
      this.scrollSteps();
      return;
    }
```

With:

```ts
    if (ev.kind === "graph_stats") {
      const agentLogEnabled = this.plugin.settings.agentLogEnabled;
      const lines = formatGraphStatsLines(ev, agentLogEnabled);
      const step = this.stepsEl.createDiv("ai-wiki-step");
      const graphHead = step.createDiv("ai-wiki-step-head");
      graphHead.createSpan({ cls: "ai-wiki-step-icon" }).setText("🌐");
      graphHead.createSpan({ cls: "ai-wiki-step-name" }).setText(lines[0]);
      graphHead.createSpan({ cls: "ai-wiki-step-time muted" }).setText(this.elapsedShort());
      if (agentLogEnabled && lines.length > 1) {
        const detail = step.createDiv("ai-wiki-step-detail");
        for (const line of lines.slice(1)) {
          detail.createDiv().setText(line);
        }
      }
      this.scrollSteps();
      return;
    }
```

- [ ] **Step 5: Run view-graph-trace tests**

```bash
npx vitest run tests/view-graph-trace.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 6: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/view.ts tests/view-graph-trace.test.ts
git commit -m "feat(view): render extended graph trace when agentLogEnabled"
```

---

### Task 7: Update `computeSpeedText` token count format

**Files:**
- Modify: `src/phases/llm-utils.ts`
- Modify: `tests/llm-utils.test.ts`

- [ ] **Step 1: Update failing tests first**

In `tests/llm-utils.test.ts`, update the `computeSpeedText` describe block:

```ts
describe("computeSpeedText", () => {
  it("returns empty string for empty stats array", () => {
    expect(computeSpeedText([])).toBe("");
  });

  it("returns empty string when total llmDurationMs is 0", () => {
    const stats = [{ inputTokens: 100, outputTokens: 50, ttftMs: 100, llmDurationMs: 0 }];
    expect(computeSpeedText(stats)).toBe("");
  });

  it("formats single call correctly with token counts", () => {
    // 200 in / 2s = 100 in tok/s; 100 out / 2s = 50 out tok/s; median ttft = 300ms
    const stats = [{ inputTokens: 200, outputTokens: 100, ttftMs: 300, llmDurationMs: 2000 }];
    expect(computeSpeedText(stats)).toBe(" in: 200 tok (100 tok/s) · out: 100 tok (50 tok/s) · latency: 300ms");
  });

  it("aggregates multiple calls and uses median TTFT", () => {
    const stats = [
      { inputTokens: 100, outputTokens: 50, ttftMs: 500, llmDurationMs: 1000 },
      { inputTokens: 100, outputTokens: 50, ttftMs: 200, llmDurationMs: 1000 },
      { inputTokens: 100, outputTokens: 50, ttftMs: 300, llmDurationMs: 1000 },
    ];
    // sorted ttftMs: [200, 300, 500], median index = floor(3/2) = 1 → 300ms
    // total: 300 in / 3s = 100 tok/s; 150 out / 3s = 50 tok/s
    const result = computeSpeedText(stats);
    expect(result).toContain("latency: 300ms");
    expect(result).toContain("in: 300 tok (100 tok/s)");
    expect(result).toContain("out: 150 tok (50 tok/s)");
  });
});
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npx vitest run tests/llm-utils.test.ts -t "computeSpeedText" 2>&1 | tail -10
```

Expected: assertion failures on the new format string.

- [ ] **Step 3: Update `computeSpeedText` in `src/phases/llm-utils.ts`**

Replace the return statement in `computeSpeedText`:

```ts
  return ` in: ${totalIn} tok (${inS} tok/s) · out: ${totalOut} tok (${outS} tok/s) · latency: ${medTtft}ms`;
```

- [ ] **Step 4: Run llm-utils tests**

```bash
npx vitest run tests/llm-utils.test.ts 2>&1 | tail -10
```

Expected: all pass.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run 2>&1 | tail -20
```

Expected: all pass.

- [ ] **Step 6: Build dist**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds, `dist/main.js` updated.

- [ ] **Step 7: Commit**

```bash
git add src/phases/llm-utils.ts tests/llm-utils.test.ts dist/main.js
git commit -m "feat(llm-utils): computeSpeedText shows token counts alongside tok/s"
```

---

## Self-Review

### Spec coverage

| Spec section | Task |
|---|---|
| `graph_stats` extended type | Task 1 |
| `bfsExpandWithHops` | Task 2 |
| `selectSeeds` returns `{id, score}[]` | Task 3 |
| `selectRelevantScored` | Task 4 |
| `query.ts` collects and emits extended event | Task 5 |
| `view.ts` gated render | Task 6 |
| `computeSpeedText` token count format | Task 7 |
| Existing `bfsExpand`, `selectRelevant` unchanged | Tasks 2,4 — no callers modified |
| `agentLogEnabled=false` compact fallback | Task 6 |
| Seeds truncated to 5 + `…+N` | Task 6 |
| Score formatted to 2 dp | Task 6 |
| BFS hop lines omitted when empty | Task 6 |
| Score=0 entries omitted | Task 6 |

### Placeholder check

None found.

### Type consistency

- `bfsExpandWithHops` returns `{ expanded: Set<string>; byHop: Record<number, string[]> }` — used as `expandedByHop` field in `graph_stats` which is `Record<number, string[]>` ✓
- `selectSeeds` returns `{ id: string; score: number }[]` — destructured in query.ts to `id` and `score` ✓
- `selectRelevantScored` returns `{ path: string; score: number }[]` — used in query.ts with `pageId(x.path)` and `x.score` ✓
- `formatGraphStatsLines` receives `Extract<RunEvent, { kind: "graph_stats" }>` — correct after Task 1 type extension ✓
