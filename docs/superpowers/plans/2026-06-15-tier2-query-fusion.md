---
review:
  plan_hash: a942169950c9ea75
  spec_hash: b227f5fd52b5fc02
  last_run: 2026-06-15
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-15-tier2-query-fusion-design.md
result_check:
  verdict: OK
  plan_hash: a942169950c9ea75
  last_run: 2026-06-15
---
# Tier 2 — Query Fusion + Threshold Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Order the native Query context by a scale-free RRF fusion of the vector signal and the graph signal, and gate weak embedding seeds behind a tunable similarity threshold with Jaccard→LLM fallback — both opt-in, default-off, zero regression when off.

**Architecture:** A new pure module `src/fusion.ts` fuses the union `seeds ∪ BFS-expanded` via the existing `rrf()` over two ranked lists (vector score, graph proximity). `runQuery` gains a threshold gate before BFS and fused context ordering after BFS, both behind `nativeAgent` toggles threaded through `agent-runner`. The eval harness gains a `dense+rrf` config that applies the same fusion to its union layer.

**Tech Stack:** TypeScript, Vitest, esbuild (Obsidian plugin). Pure functions are unit-tested with no Obsidian APIs; `runQuery` is tested through its existing mock-adapter harness.

---

## Background: how the pieces fit (read before starting)

The native Query pipeline lives in `src/phases/query.ts#runQuery` (an async generator). Its current shape:

1. **Seed selection** (lines 70–97): embedding/hybrid path (`similarity.selectRelevantScored`) or Jaccard path (`selectSeeds`). Both populate `seeds: string[]` and `seedScores: Record<string, number>`. If empty, `llmSelectSeeds` is the safety net.
2. **BFS expansion** (line 123): `bfsExpandRanked(seeds, graph, depth, …)` returns `{ selectedIds: Set<string>, expandedScores: Record<string, number> }`. `selectedIds = seeds ∪ top-bfsTopK expanded pages`.
3. **graph_stats event** (line 135): emits `seeds, expanded, total, fromCache, seedScores, expandedPages, expandedScores`.
4. **Context block** (line 136): `buildContextBlock(pages, seedSet, selectedIds, topK*3)` — seeds-first concat, capped by page count.

Key existing helpers (do not reimplement):
- `rrf(rankedLists: string[][], k = 60): { id; score }[]` — `src/rrf.ts`. Stable, ignores empty lists.
- `bfsExpandWithHops(seeds, graph, depth): { expanded: Set<string>; byHop: Record<number, string[]> }` — `src/wiki-graph.ts:71`. `byHop` keys are hop numbers (1-based); seeds are NOT in `byHop` (they are hop 0 by definition).
- `pageId(vaultPath): string`, `type WikiGraph = Map<string, Set<string>>` — `src/wiki-graph.ts`.
- `selectSeeds(question, pages, topK, minScore, indexAnnotations): { id; score }[]` — `src/wiki-seeds.ts:57`.

`Array.prototype.sort` is stable in the Node/V8 runtime this project targets — rely on it for tie-breaks (equal keys keep input order).

---

## File Structure

**New files:**
- `src/fusion.ts` — pure `fuseVectorGraph(...)`; the only new production module.
- `tests/fusion.test.ts` — unit tests for `fuseVectorGraph`.
- `tests/eval-retrieval.test.ts` — unit test for the eval runner's fused-union wiring.

**Modified files:**
- `src/wiki-graph.ts` — extract exported `inDegree(graph)`; refactor `checkGraphStructure` to call it.
- `src/types.ts` — two new `nativeAgent` fields + defaults; `seedFallback` on the `graph_stats` event.
- `src/phases/query.ts` — threshold gate; export + fuse-aware `buildContextBlock`; three new `runQuery` params; emit `seedFallback`.
- `src/agent-runner.ts` — thread the three new values into `runQuery`.
- `src/settings.ts` — two UI controls next to the hybrid-retrieval block.
- `src/view.ts` — render `seedFallback` in the verbose trace.
- `scripts/eval-config.ts` — `dense+rrf` config name + `fuse` flag.
- `scripts/eval-retrieval.ts` — apply `fuseVectorGraph` to the union when `cfg.fuse`.
- `tests/wiki-graph.test.ts`, `tests/phases/query.test.ts`, `tests/eval-config.test.ts`, `tests/view-graph-trace.test.ts` — new test cases.
- `lat.md/tests.md`, `lat.md/operations.md` — Tier 2 specs + cross-links.

---

## Task 1: Extract the `inDegree` graph helper

Pull the inline backlink-count computation out of `checkGraphStructure` into a shared exported helper, so `fuseVectorGraph` (Task 2) and the graph-health check use one implementation (spec F-001).

**Files:**
- Modify: `src/wiki-graph.ts:177-201`
- Test: `tests/wiki-graph.test.ts`

- [ ] **Step 1: Write the failing test**

Add this `describe` block to `tests/wiki-graph.test.ts` (after the existing `checkGraphStructure` block). Also add `inDegree` to the existing import on line 2.

```typescript
describe("inDegree", () => {
  // @lat: [[tests#Tier 2 — Query Fusion#inDegree counts backlinks per page]]
  it("counts incoming edges per node, including phantom targets", () => {
    const graph = new Map<string, Set<string>>([
      ["A", new Set(["B", "C"])],
      ["B", new Set(["C"])],
      ["C", new Set<string>()],
    ]);
    const deg = inDegree(graph);
    expect(deg.get("A")).toBe(0);
    expect(deg.get("B")).toBe(1);
    expect(deg.get("C")).toBe(2);
  });

  it("returns 0 for every node of an edgeless graph", () => {
    const graph = new Map<string, Set<string>>([["X", new Set()], ["Y", new Set()]]);
    const deg = inDegree(graph);
    expect(deg.get("X")).toBe(0);
    expect(deg.get("Y")).toBe(0);
  });

  it("counts a backlink to a target absent from graph.keys()", () => {
    const graph = new Map<string, Set<string>>([["A", new Set(["Phantom"])]]);
    expect(inDegree(graph).get("Phantom")).toBe(1);
  });
});
```

Update line 2 of `tests/wiki-graph.test.ts`:

```typescript
import { pageId, buildWikiGraph, bfsExpand, bfsExpandWithHops, checkGraphStructure, bfsExpandRanked, inDegree } from "../src/wiki-graph";
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/wiki-graph.test.ts -t inDegree`
Expected: FAIL — `inDegree is not a function` / import error.

- [ ] **Step 3: Add the helper and refactor `checkGraphStructure`**

In `src/wiki-graph.ts`, replace the current `checkGraphStructure` (lines 177-201) with:

```typescript
/**
 * Backlink count per node: how many pages link TO each node. Targets that appear
 * only as link destinations (phantom pages) are counted too. Shared by the graph
 * health check and Tier 2 fusion's graph-proximity tie-break.
 */
export function inDegree(graph: WikiGraph): Map<string, number> {
  const deg = new Map<string, number>();
  for (const node of graph.keys()) {
    if (!deg.has(node)) deg.set(node, 0);
    for (const tgt of graph.get(node)!) {
      deg.set(tgt, (deg.get(tgt) ?? 0) + 1);
    }
  }
  return deg;
}

export function checkGraphStructure(graph: WikiGraph): string {
  const deg = inDegree(graph);

  const issues: string[] = [];
  for (const [node, neighbors] of graph) {
    const outDeg = neighbors.size;
    const inDeg = deg.get(node) ?? 0;

    if (inDeg === 0 && outDeg === 0) {
      issues.push(`- ${node}: isolated node (no links in or out)`);
    }
    for (const tgt of neighbors) {
      if (graph.has(tgt) && !graph.get(tgt)!.has(node)) {
        issues.push(`- ${node} → [[${tgt}]] not reciprocated`);
      }
    }
  }
  return issues.join("\n");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/wiki-graph.test.ts`
Expected: PASS — new `inDegree` tests pass and all pre-existing `checkGraphStructure` tests still pass (behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/wiki-graph.ts tests/wiki-graph.test.ts
git commit -m "refactor(graph): extract shared inDegree helper from checkGraphStructure"
```

---

## Task 2: Pure fusion module `fuseVectorGraph`

Create the heart of Tier 2: a pure function that fuses the union of seeds and BFS-expanded pages by RRF over a vector-score list and a graph-proximity list.

**Files:**
- Create: `src/fusion.ts`
- Test: `tests/fusion.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/fusion.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { fuseVectorGraph } from "../src/fusion";
import type { WikiGraph } from "../src/wiki-graph";

// Graph: S → A, S → B, A → B. Undirected BFS from S reaches A and B at hop 1.
const graph: WikiGraph = new Map([
  ["S", new Set(["A", "B"])],
  ["A", new Set(["B"])],
  ["B", new Set<string>()],
]);

describe("fuseVectorGraph", () => {
  // @lat: [[tests#Tier 2 — Query Fusion#Fusion orders the union by vector and graph RRF]]
  it("fuses vector rank and graph rank over the union", () => {
    const seeds = ["S"];
    const selectedIds = new Set(["S", "A", "B"]);
    const seedScores = { S: 0.9 };
    const expandedScores = { A: 0.8, B: 0.1 };
    const order = fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, graph, 1, 60);
    // Every union member appears exactly once.
    expect(new Set(order)).toEqual(selectedIds);
    expect(order).toHaveLength(3);
    // S: vector rank 1 (0.9) + graph rank 1 (hop 0) — wins outright.
    expect(order[0]).toBe("S");
    // A outranks B: higher vector score AND higher inDegree at the same hop.
    expect(order.indexOf("A")).toBeLessThan(order.indexOf("B"));
  });

  it("breaks graph-list ties by inDegree (more backlinks ranks higher)", () => {
    // Two expanded pages at the same hop, equal vector score: P has 2 backlinks, Q has 0.
    const tieGraph: WikiGraph = new Map([
      ["S", new Set(["P", "Q"])],
      ["X", new Set(["P"])],
      ["Y", new Set(["P"])],
      ["P", new Set<string>()],
      ["Q", new Set<string>()],
    ]);
    const order = fuseVectorGraph(
      ["S"], new Set(["S", "P", "Q"]), { S: 0.5 }, { P: 0.3, Q: 0.3 }, tieGraph, 1, 60,
    );
    expect(order.indexOf("P")).toBeLessThan(order.indexOf("Q"));
  });

  it("ranks a union page that has no similarity score (score defaults to 0)", () => {
    const order = fuseVectorGraph(
      ["S"], new Set(["S", "A"]), { S: 0.9 }, {}, graph, 1, 60,
    );
    expect(new Set(order)).toEqual(new Set(["S", "A"]));
    expect(order[0]).toBe("S");
  });

  it("returns an empty array for an empty union", () => {
    expect(fuseVectorGraph([], new Set(), {}, {}, graph, 1, 60)).toEqual([]);
  });

  it("respects rrfK (different k can change a contested order)", () => {
    const seeds = ["S"];
    const selectedIds = new Set(["S", "A", "B"]);
    // With a tiny k, rank differences dominate; with a huge k they flatten toward first-seen.
    const small = fuseVectorGraph(seeds, selectedIds, { S: 0.1 }, { A: 0.9, B: 0.8 }, graph, 1, 1);
    const large = fuseVectorGraph(seeds, selectedIds, { S: 0.1 }, { A: 0.9, B: 0.8 }, graph, 1, 100000);
    expect(new Set(small)).toEqual(selectedIds);
    expect(new Set(large)).toEqual(selectedIds);
    // Sanity: both are valid permutations; k is actually threaded into rrf.
    expect(small).toHaveLength(3);
    expect(large).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fusion.test.ts`
Expected: FAIL — cannot resolve `../src/fusion`.

- [ ] **Step 3: Create `src/fusion.ts`**

```typescript
// src/fusion.ts
// Tier 2 — vector ⊕ graph fusion. Over the union U = seeds ∪ BFS-expanded pages,
// build two ranked lists and fuse them with the existing rrf():
//   vector list — U by similarity score descending (seed + expanded scores).
//   graph list  — U by graph proximity: hop ascending (seed = hop 0), tie-broken
//                 by backlink inDegree descending.
// Every union page appears in both lists, so the fusion is well-formed and
// scale-free. Pure — no Obsidian APIs.
import { rrf } from "./rrf";
import { bfsExpandWithHops, inDegree, type WikiGraph } from "./wiki-graph";

export function fuseVectorGraph(
  seeds: string[],
  selectedIds: Set<string>,
  seedScores: Record<string, number>,
  expandedScores: Record<string, number>,
  graph: WikiGraph,
  depth: number,
  rrfK: number,
): string[] {
  const union = [...selectedIds];
  if (union.length === 0) return [];

  // `?? ` keeps an explicit 0 score; only missing keys fall through to 0.
  const scoreOf = (id: string): number => seedScores[id] ?? expandedScores[id] ?? 0;

  // Vector list: score desc; equal scores keep union order (stable sort).
  const vectorList = [...union].sort((a, b) => scoreOf(b) - scoreOf(a));

  // Graph list: hop asc, then inDegree desc; equal keys keep union order.
  const { byHop } = bfsExpandWithHops(seeds, graph, depth);
  const hopOf = new Map<string, number>();
  for (const s of seeds) hopOf.set(s, 0);
  for (const [hop, ids] of Object.entries(byHop)) {
    const h = Number(hop);
    for (const id of ids) if (!hopOf.has(id)) hopOf.set(id, h);
  }
  const missingHop = depth + 1;
  const deg = inDegree(graph);
  const graphList = [...union].sort((a, b) => {
    const ha = hopOf.get(a) ?? missingHop;
    const hb = hopOf.get(b) ?? missingHop;
    if (ha !== hb) return ha - hb;
    return (deg.get(b) ?? 0) - (deg.get(a) ?? 0);
  });

  return rrf([vectorList, graphList], rrfK).map((x) => x.id);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fusion.test.ts`
Expected: PASS — all five cases green.

- [ ] **Step 5: Commit**

```bash
git add src/fusion.ts tests/fusion.test.ts
git commit -m "feat(fusion): pure fuseVectorGraph RRF over seeds + BFS union"
```

---

## Task 3: Settings fields, defaults, and the trace-event type

Add the two opt-in `nativeAgent` settings, their defaults, and the `seedFallback` field on the `graph_stats` event. All additions are optional/defaulted, so the project still compiles before any consumer uses them.

**Files:**
- Modify: `src/types.ts:193-199` (interface), `src/types.ts:262-264` (defaults), `src/types.ts:79-88` (graph_stats event)
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/types.test.ts` (inside the top-level `describe`, or add a new `describe("Tier 2 defaults", …)`):

```typescript
import { DEFAULT_SETTINGS } from "../src/types";

describe("Tier 2 nativeAgent defaults", () => {
  it("defaults bfsFusion to false (opt-in)", () => {
    expect(DEFAULT_SETTINGS.nativeAgent.bfsFusion).toBe(false);
  });
  it("defaults seedSimilarityThreshold to 0 (gate off)", () => {
    expect(DEFAULT_SETTINGS.nativeAgent.seedSimilarityThreshold).toBe(0);
  });
});
```

If `tests/types.test.ts` does not already import `describe/it/expect`, add `import { describe, it, expect } from "vitest";` at the top.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts -t "Tier 2"`
Expected: FAIL — both values are `undefined`.

- [ ] **Step 3: Add the interface fields, defaults, and event field**

In `src/types.ts`, in the `nativeAgent` interface block, immediately after `rrfK?: number;` (line 194), add:

```typescript
    bfsFusion?: boolean;
    seedSimilarityThreshold?: number;
```

In `DEFAULT_SETTINGS.nativeAgent`, immediately after `rrfK: 60,` (line 263), add:

```typescript
    bfsFusion: false,
    seedSimilarityThreshold: 0,
```

In the `graph_stats` variant of `RunEvent` (lines 79-88), after `expandedByHop?: Record<number, string[]>;`, add:

```typescript
      seedFallback?: "none" | "jaccard" | "llm";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat(types): Tier 2 nativeAgent settings + seedFallback trace field"
```

---

## Task 4: Threshold gate + fallback in `runQuery`

Gate weak embedding/hybrid seeds behind `seedSimilarityThreshold`: below it, fall back to Jaccard `selectSeeds`; if Jaccard is also empty, leave seeds empty so the existing `llmSelectSeeds` guard fires. Record which branch ran in `seedFallback` and emit it on `graph_stats`. Default threshold `0` reproduces current behavior exactly.

**Files:**
- Modify: `src/phases/query.ts:22-38` (signature), `src/phases/query.ts:70-97` (seed block), `src/phases/query.ts:135` (event)
- Modify: `src/agent-runner.ts:114` (thread the value)
- Test: `tests/phases/query.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/phases/query.test.ts`. First extend the imports at the top:

```typescript
import { PageSimilarityService } from "../../src/page-similarity";
```

Then add this `describe` block after the existing `describe("runQuery", …)` block (keep it separate for clarity):

```typescript
describe("runQuery — seed threshold gate", () => {
  function embeddingSim(): PageSimilarityService {
    // embedding mode with no baseUrl/model → selectRelevantScored degrades to
    // deterministic Jaccard scoring. Good enough to exercise the gate branches.
    return new PageSimilarityService({ mode: "embedding", topK: 5 });
  }

  function vaultAdapter() {
    return mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Alpha.md", "!Wiki/work/Beta.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Alpha]] Alpha.md — machine learning\n- [[Beta]] Beta.md — cooking";
        if (p.endsWith("Alpha.md")) return "# Alpha\nmachine learning content";
        if (p.endsWith("Beta.md")) return "# Beta\ncooking content";
        return "";
      }),
    });
  }

  // @lat: [[tests#Tier 2 — Query Fusion#Threshold gate falls back from weak seeds]]
  it("threshold 0 keeps embedding seeds (seedFallback none)", async () => {
    const vt = new VaultTools(vaultAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery(["machine learning"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.0, 10, embeddingSim(), 3, 0 /* threshold */),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats.seedFallback).toBe("none");
    expect(stats.seeds).toContain("Alpha");
  });

  it("threshold above max score falls back to Jaccard seeds", async () => {
    const vt = new VaultTools(vaultAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery(["machine learning"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.0, 10, embeddingSim(), 3, 2.0 /* threshold > any score */),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats.seedFallback).toBe("jaccard");
    expect(stats.seeds).toContain("Alpha");
  });

  it("threshold high + non-matching question falls through to llmSelectSeeds", async () => {
    const vt = new VaultTools(vaultAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery(["zzzznomatch"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.0, 10, embeddingSim(), 3, 2.0),
    );
    // Jaccard returns nothing → empty-seeds guard emits the SelectSeeds tool_use.
    const selectSeedsUse = events.find((e: any) => e.kind === "tool_use" && e.name === "SelectSeeds");
    expect(selectSeedsUse).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/phases/query.test.ts -t "threshold gate"`
Expected: FAIL — `runQuery` does not accept a `seedSimilarityThreshold` argument; `seedFallback` is `undefined`.

- [ ] **Step 3: Add the param and implement the gate**

In `src/phases/query.ts`, change the `runQuery` signature. Replace the parameter list tail (line 37) so it reads:

```typescript
  wikiLinkValidationRetries: number = 3,
  seedSimilarityThreshold: number = 0,
): AsyncGenerator<RunEvent> {
```

Replace the seed-selection block (current lines 70-86) with:

```typescript
  // Phase 2: seed selection from index annotations (no file content needed)
  let seeds: string[];
  let seedScores: Record<string, number> = {};
  let seedFallback: "none" | "jaccard" | "llm" = "none";
  const syntheticPages = new Map<string, string>(
    [...indexAnnotations.keys()].map((id) => [`${wikiVaultPath}/${id}.md`, ""]),
  );
  if (similarity && (similarity.config.mode === "embedding" || similarity.config.mode === "hybrid")) {
    await similarity.loadCache(wikiVaultPath, vaultTools);
    const allAnnotatedPaths = [...indexAnnotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`);
    const selected = await similarity.selectRelevantScored(question, indexAnnotations, allAnnotatedPaths);
    const topSelected = selected.slice(0, topK);
    seeds = topSelected.map((x) => pageId(x.path));
    seedScores = Object.fromEntries(topSelected.map((x) => [pageId(x.path), x.score]));

    // Threshold gate: weak seeds fall back to Jaccard, then to llmSelectSeeds.
    const maxSeedScore = seeds.length ? Math.max(...Object.values(seedScores)) : 0;
    if (maxSeedScore < seedSimilarityThreshold) {
      const jaccardSeeds = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
      if (jaccardSeeds.length > 0) {
        seeds = jaccardSeeds.map((x) => x.id);
        seedScores = Object.fromEntries(jaccardSeeds.map((x) => [x.id, x.score]));
        seedFallback = "jaccard";
      } else {
        seeds = [];
        seedScores = {};
        seedFallback = "llm"; // existing empty-seeds guard runs llmSelectSeeds below
      }
    }
  } else {
    const seedResults = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
    seeds = seedResults.map((x) => x.id);
    seedScores = Object.fromEntries(seedResults.map((x) => [x.id, x.score]));
  }
```

Then update the `graph_stats` emit (current line 135) to include the new field:

```typescript
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedPages, expandedScores, seedFallback };
```

- [ ] **Step 4: Thread the value from `agent-runner`**

In `src/agent-runner.ts:114`, append the new argument to the `runQuery` call (after `this.settings.wikiLinkValidationRetries ?? 3`):

```typescript
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, this.settings.bfsTopK, similarity, this.settings.wikiLinkValidationRetries ?? 3, this.settings.nativeAgent.seedSimilarityThreshold ?? 0);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/phases/query.test.ts`
Expected: PASS — gate tests green and all pre-existing `runQuery` tests still pass (threshold defaults to 0 → `seedFallback` "none", behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/phases/query.ts src/agent-runner.ts tests/phases/query.test.ts
git commit -m "feat(query): seed similarity threshold with Jaccard→LLM fallback + trace marker"
```

---

## Task 5: Fused context ordering in `buildContextBlock`

When `bfsFusion` is on, order the context block by the fused order from `fuseVectorGraph` instead of seeds-first concat, keeping the `topK*3` page cap. When off, ordering is byte-for-byte unchanged. Export `buildContextBlock` so ordering is unit-testable.

**Files:**
- Modify: `src/phases/query.ts:1-18` (imports), `:22-38` (signature), `:123-136` (fuse + call), `:317-338` (buildContextBlock)
- Modify: `src/agent-runner.ts:114` (thread two more values)
- Test: `tests/phases/query.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/phases/query.test.ts`. Extend the import on line 2:

```typescript
import { runQuery, buildContextBlock } from "../../src/phases/query";
```

Add this `describe` block:

```typescript
describe("buildContextBlock", () => {
  const pages = new Map<string, string>([
    ["!Wiki/work/Alpha.md", "alpha body"],
    ["!Wiki/work/Beta.md", "beta body"],
    ["!Wiki/work/Gamma.md", "gamma body"],
  ]);
  const seedSet = new Set(["Alpha"]);
  const selectedIds = new Set(["Alpha", "Beta", "Gamma"]);

  it("without order: seeds first, then BFS pages (unchanged behavior)", () => {
    const block = buildContextBlock(pages, seedSet, selectedIds, 10);
    expect(block.indexOf("Alpha.md")).toBeLessThan(block.indexOf("Beta.md"));
    expect(block).toContain("alpha body");
  });

  // @lat: [[tests#Tier 2 — Query Fusion#Context ordering follows the fused order]]
  it("with order: emits pages in the given fused order", () => {
    const order = ["Gamma", "Alpha", "Beta"];
    const block = buildContextBlock(pages, seedSet, selectedIds, 10, order);
    expect(block.indexOf("Gamma.md")).toBeLessThan(block.indexOf("Alpha.md"));
    expect(block.indexOf("Alpha.md")).toBeLessThan(block.indexOf("Beta.md"));
  });

  it("with order: caps at maxPages and skips ids outside the selection", () => {
    const order = ["Gamma", "Alpha", "Beta"];
    const block = buildContextBlock(pages, seedSet, selectedIds, 2, order);
    const count = (block.match(/^--- /gm) ?? []).length;
    expect(count).toBe(2);
    expect(block).toContain("Gamma.md");
    expect(block).toContain("Alpha.md");
    expect(block).not.toContain("Beta.md");
  });
});

describe("runQuery — fusion ordering smoke", () => {
  it("bfsFusion on still returns the selected pages in context", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Alpha.md", "!Wiki/work/Beta.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("_index.md")) return "- [[Alpha]] Alpha.md — machine learning\n- [[Beta]] Beta.md — learning systems";
        if (p.endsWith("Alpha.md")) return "# Alpha\n[[Beta]]\nmachine learning content";
        if (p.endsWith("Beta.md")) return "# Beta\nlearning systems content";
        return "";
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm("answer");
    await collect(
      runQuery(["machine learning"], false, vt, llm, "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.0, 10, undefined, 3, 0,
        true /* bfsFusion */, 60 /* rrfK */),
    );
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const streamCall = createMock.mock.calls.find((c: any) => c[0]?.stream === true);
    const userContent = streamCall?.[0]?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    expect(userContent).toContain("Alpha");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/phases/query.test.ts -t "buildContextBlock"`
Expected: FAIL — `buildContextBlock` is not exported; `runQuery` does not accept `bfsFusion`/`rrfK`.

- [ ] **Step 3: Add imports, params, fuse wiring, and order-aware `buildContextBlock`**

In `src/phases/query.ts`, extend the `wiki-graph` import (line 13) to bring in the graph value and add the fusion import after line 18:

```typescript
import { pageId, bfsExpandRanked } from "../wiki-graph";
```
becomes
```typescript
import { pageId, bfsExpandRanked } from "../wiki-graph";
import { fuseVectorGraph } from "../fusion";
```

Extend the `runQuery` signature tail (the line you set in Task 4) to:

```typescript
  wikiLinkValidationRetries: number = 3,
  seedSimilarityThreshold: number = 0,
  bfsFusion: boolean = false,
  rrfK: number = 60,
): AsyncGenerator<RunEvent> {
```

Replace the `buildContextBlock` call site (current line 136) with a fuse-aware version. After the `graph_stats` yield (the line ending in `seedFallback };`), change:

```typescript
  const contextBlock = buildContextBlock(pages, seedSet, selectedIds, topK * 3);
```

to:

```typescript
  const fusedOrder = bfsFusion
    ? fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, graphResult.graph, graphDepth, rrfK)
    : undefined;
  const contextBlock = buildContextBlock(pages, seedSet, selectedIds, topK * 3, fusedOrder);
```

Replace the `buildContextBlock` function (current lines 317-338) with:

```typescript
export function buildContextBlock(
  pages: Map<string, string>,
  seeds: Set<string>,
  selectedIds: Set<string>,
  maxPages: number,
  order?: string[],
): string {
  // Fused ordering (Tier 2): emit pages in `order`, capped at maxPages.
  if (order && order.length > 0) {
    const pidToPath = new Map<string, string>();
    for (const path of pages.keys()) pidToPath.set(pageId(path), path);
    let block = "";
    let count = 0;
    for (const id of order) {
      if (count >= maxPages) break;
      if (!selectedIds.has(id)) continue;
      const path = pidToPath.get(id);
      if (path === undefined) continue;
      block += `--- ${path} ---\n${pages.get(path) ?? ""}\n\n`;
      count++;
    }
    return block;
  }

  // Default: seeds first, then BFS-expanded pages (unchanged behavior).
  const seedPages: [string, string][] = [];
  const bfsPages: [string, string][] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    if (!selectedIds.has(id)) continue;
    if (seeds.has(id)) seedPages.push([path, content]);
    else bfsPages.push([path, content]);
  }
  const bfsCap = Math.max(0, maxPages - seedPages.length);
  const ordered = [...seedPages, ...bfsPages.slice(0, bfsCap)];
  let block = "";
  for (const [p, c] of ordered) {
    block += `--- ${p} ---\n${c}\n\n`;
  }
  return block;
}
```

- [ ] **Step 4: Thread the two values from `agent-runner`**

In `src/agent-runner.ts:114`, append the final two arguments to the `runQuery` call (after the `seedSimilarityThreshold` argument added in Task 4):

```typescript
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, this.settings.bfsTopK, similarity, this.settings.wikiLinkValidationRetries ?? 3, this.settings.nativeAgent.seedSimilarityThreshold ?? 0, this.settings.nativeAgent.bfsFusion ?? false, this.settings.nativeAgent.rrfK ?? 60);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/phases/query.test.ts`
Expected: PASS — `buildContextBlock` ordering tests, the fusion smoke test, and all pre-existing tests pass (default path = seeds-first, unchanged).

- [ ] **Step 6: Commit**

```bash
git add src/phases/query.ts src/agent-runner.ts tests/phases/query.test.ts
git commit -m "feat(query): fused context ordering behind bfsFusion toggle"
```

---

## Task 6: Eval harness `dense+rrf` config

Add the reserved `dense+rrf` config: it resolves to embedding mode with a `fuse` flag, and the runner applies `fuseVectorGraph` to the union layer so Recall@k / MRR can be measured against the `dense` baseline.

**Files:**
- Modify: `scripts/eval-config.ts:4-35`
- Modify: `scripts/eval-retrieval.ts:48-87`
- Test: `tests/eval-config.test.ts`, `tests/eval-retrieval.test.ts` (new)

- [ ] **Step 1: Write the failing config test**

Add to `tests/eval-config.test.ts` (inside `describe("resolveConfigs", …)`):

```typescript
  // @lat: [[tests#Tier 2 — Query Fusion#Eval resolves the dense+rrf config]]
  it("resolves dense+rrf to embedding mode with fuse=true", () => {
    const cfgs = resolveConfigs("dense+rrf", 1, 8);
    expect(cfgs[0]).toMatchObject({ name: "dense+rrf", mode: "embedding", fuse: true, bfsDepth: 1, topK: 8 });
  });

  it("leaves fuse falsy for a plain dense config", () => {
    const cfgs = resolveConfigs("dense", 1, 8);
    expect(cfgs[0].fuse).toBeFalsy();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/eval-config.test.ts -t "dense+rrf"`
Expected: FAIL — `unknown --config "dense+rrf"` thrown.

- [ ] **Step 3: Extend `ConfigRecord` and `resolveConfigs`**

In `scripts/eval-config.ts`, add `fuse` to the interface (after `topK: number;`):

```typescript
export interface ConfigRecord {
  name: string;
  mode: "embedding" | "jaccard" | "hybrid"; // PageSimilarityService mode
  bfsDepth: number;
  topK: number;
  fuse?: boolean; // dense+rrf: apply fuseVectorGraph to the union layer
}
```

Add the name mapping (after `hybrid: "hybrid",`):

```typescript
  "dense+rrf": "embedding",
```

Update `resolveConfigs`'s `return names.map(...)` body so the record carries `fuse` and the error lists the new name:

```typescript
  return names.map((name) => {
    const mode = NAME_TO_MODE[name];
    if (!mode) {
      throw new Error(`unknown --config "${name}" (expected: dense, jaccard, hybrid, dense+rrf)`);
    }
    return { name, mode, bfsDepth, topK, fuse: name === "dense+rrf" };
  });
```

- [ ] **Step 4: Run the config test to verify it passes**

Run: `npx vitest run tests/eval-config.test.ts`
Expected: PASS — including the pre-existing `(expected: …)` error test (it matches `/bogus/`, still satisfied).

- [ ] **Step 5: Write the failing runner test**

This test verifies the runner applies `fuseVectorGraph` to the union — not just that it returns the same set. Note on the data: in 2-list RRF a simple two-element transposition always ties and resolves to vector order, which equals the unfused `[...selectedIds]`. To get an observable reorder we use a 4-node chain (`Seed→R→P→Q`) whose hop order (R, P, Q) is a non-transposition permutation of the vector order (P, Q, R). The test reconstructs the runner's pre-fusion state with the same public calls (the documented "mirror" pattern), computes the oracle, and asserts a real reorder occurred before comparing.

Create `tests/eval-retrieval.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { makeRunner, type RunInputs } from "../scripts/eval-retrieval";
import { buildWikiGraph, bfsExpandRanked, pageId } from "../src/wiki-graph";
import { fuseVectorGraph } from "../src/fusion";
import { PageSimilarityService } from "../src/page-similarity";
import type { FsShim } from "../scripts/eval-vault";

// fs shim is unused on the no-endpoint embedding path (loadCache returns early
// with no model), but the type requires it.
const fs: FsShim = { read: async () => "" } as unknown as FsShim;

const wikiVaultPath = "!Wiki/work";
const q = "alpha beta gamma delta";

// Jaccard scores (annotation-only, since dense degrades with no endpoint):
//   Seed 4/4=1.0, P 3/4=0.75, Q 2/4=0.5, R 1/4=0.25.
// Graph chain Seed→R→P→Q puts hops at R=1, P=2, Q=3 — graph order (R,P,Q)
// differs from vector order (P,Q,R) by a 3-cycle, so fusion reorders.
const annotations = new Map<string, string>([
  ["Seed", "alpha beta gamma delta"],
  ["P", "alpha beta gamma"],
  ["Q", "alpha beta"],
  ["R", "alpha"],
]);
const pages = new Map<string, string>([
  ["!Wiki/work/Seed.md", "# Seed\n[[R]]\nalpha beta gamma delta"],
  ["!Wiki/work/R.md", "# R\n[[P]]\nalpha"],
  ["!Wiki/work/P.md", "# P\n[[Q]]\nalpha beta gamma"],
  ["!Wiki/work/Q.md", "# Q\nalpha beta"],
]);

function inputs(): RunInputs {
  return {
    wikiVaultPath, fs, annotations,
    allAnnotatedPaths: [...annotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`),
    pages, graph: buildWikiGraph(pages), embed: {},
  };
}

describe("makeRunner — dense+rrf", () => {
  // @lat: [[tests#Tier 2 — Query Fusion#Eval runner applies the fused order]]
  it("returns the fuseVectorGraph order over the union", async () => {
    const inp = inputs();
    const topK = 1, depth = 3;

    // Mirror the runner's pre-fusion steps with the same public calls.
    const svc = new PageSimilarityService({ mode: "embedding", topK });
    const scored = await svc.selectRelevantScored(q, annotations, inp.allAnnotatedPaths);
    const top = scored.slice(0, topK);
    const seeds = top.map((x) => pageId(x.path));
    const seedScores = Object.fromEntries(top.map((x) => [pageId(x.path), x.score]));
    const { selectedIds, expandedScores } = await bfsExpandRanked(
      seeds, inp.graph, depth, pages, q, 10, annotations, svc,
    );
    const oracle = fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, inp.graph, depth, 60);

    // Precondition: the chosen data genuinely reorders (else fusion is untested here).
    expect(oracle).not.toEqual([...selectedIds]);

    const fused = await (await makeRunner(
      { name: "dense+rrf", mode: "embedding", bfsDepth: depth, topK, fuse: true }, inp,
    ))(q);
    expect(fused.union).toEqual(oracle);
  });
});
```

- [ ] **Step 6: Run the runner test to verify it fails**

Run: `npx vitest run tests/eval-retrieval.test.ts`
Expected: FAIL on `expect(fused.union).toEqual(oracle)` — before wiring, the runner returns the unfused `[...selectedIds]` (`["Seed","P","Q","R"]`), not the fused oracle (`["Seed","P","R","Q"]`). The precondition assertion passes (the two genuinely differ).

- [ ] **Step 7: Apply fusion in the runner**

In `scripts/eval-retrieval.ts`, add the import after the existing `wiki-graph` import (line 8):

```typescript
import { fuseVectorGraph } from "../src/fusion";
```

Replace the embedding/hybrid branch's runner (current lines 66-73) with a version that captures scores and fuses when `cfg.fuse`:

```typescript
    return async (question) => {
      const scored = await service.selectRelevantScored(question, annotations, allAnnotatedPaths);
      const top = scored.slice(0, cfg.topK);
      const seeds = top.map((x) => pageId(x.path));
      const seedScores = Object.fromEntries(top.map((x) => [pageId(x.path), x.score]));
      const { selectedIds, expandedScores } = await bfsExpandRanked(
        seeds, graph, cfg.bfsDepth, pages, question, UNION_BFS_TOPK, annotations, service,
      );
      const union = cfg.fuse
        ? fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, graph, cfg.bfsDepth, 60)
        : [...selectedIds];
      return { seed: seeds, union };
    };
```

(`pageId` is already imported in this file; `bfsExpandRanked`, `UNION_BFS_TOPK`, `graph`, `annotations`, `allAnnotatedPaths`, `pages` are already in scope.)

- [ ] **Step 8: Run both eval tests to verify they pass**

Run: `npx vitest run tests/eval-config.test.ts tests/eval-retrieval.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/eval-config.ts scripts/eval-retrieval.ts tests/eval-config.test.ts tests/eval-retrieval.test.ts
git commit -m "feat(eval): dense+rrf config applies vector⊕graph fusion to the union"
```

---

## Task 7: Settings UI controls

Add the two opt-in controls next to the hybrid-retrieval block, following the existing hard-coded-Russian pattern used there (these controls do not use `T.settings` i18n keys, matching the surrounding `hybridRetrieval`/`rrfK` controls).

**Files:**
- Modify: `src/settings.ts:692-698` (insert after the RRF k control)

- [ ] **Step 1: Add the controls**

In `src/settings.ts`, immediately after the "RRF k" `new Setting(...)` block (the one ending at line 698, before `new Setting(containerEl).setName("Graph health").setHeading();`), insert:

```typescript
        new Setting(containerEl)
          .setName("BFS fusion (vector ⊕ graph)")
          .setDesc("Упорядочить контекст запроса через RRF-фьюз вектора и графа. По умолчанию выкл.")
          .addToggle((t) =>
            t.setValue(s.nativeAgent.bfsFusion ?? false)
              .onChange(async (v) => { s.nativeAgent.bfsFusion = v; await this.plugin.saveSettings(); }),
          );
        new Setting(containerEl)
          .setName("Seed similarity threshold")
          .setDesc("Минимальный max-score seed; ниже — фоллбэк на Jaccard → llmSelectSeeds. 0 = выкл.")
          .addText((t) =>
            t.setValue(String(s.nativeAgent.seedSimilarityThreshold ?? 0))
              .onChange(async (v) => { const n = Number(v); if (Number.isFinite(n) && n >= 0) { s.nativeAgent.seedSimilarityThreshold = n; await this.plugin.saveSettings(); } }),
          );
```

- [ ] **Step 2: Verify the build compiles**

Run: `npm run build`
Expected: esbuild succeeds with no errors (settings UI is not unit-tested; the build is the gate).

- [ ] **Step 3: Commit**

```bash
git add src/settings.ts
git commit -m "feat(settings): UI toggles for BFS fusion and seed similarity threshold"
```

---

## Task 8: Render `seedFallback` in the verbose trace

Surface the fallback branch in the agent-log trace so the Query trace shows why seeds changed. Only render in verbose mode and only when a fallback actually occurred.

**Files:**
- Modify: `src/view.ts:36-39` (trace form of `formatGraphStatsLines`)
- Test: `tests/view-graph-trace.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/view-graph-trace.test.ts` (inside `describe("formatGraphStatsLines", …)`):

```typescript
  it("trace mode: shows seed fallback when not none", () => {
    const ev = { ...baseEvent, seedFallback: "jaccard" as const };
    const lines = formatGraphStatsLines(ev, true);
    expect(lines.some(l => l.includes("Seed fallback: jaccard"))).toBe(true);
  });

  it("trace mode: omits seed fallback line when none/absent", () => {
    const lines = formatGraphStatsLines(baseEvent, true);
    expect(lines.some(l => l.includes("Seed fallback"))).toBe(false);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/view-graph-trace.test.ts -t "seed fallback"`
Expected: FAIL — no "Seed fallback" line is produced.

- [ ] **Step 3: Render the line**

In `src/view.ts`, in `formatGraphStatsLines`, after the seed lines are pushed (after line 39, `if (remainder > 0) lines.push(\`  …+${remainder}\`);`) and before the `if (ev.expandedPages.length > 0)` block, insert:

```typescript
  if (ev.seedFallback && ev.seedFallback !== "none") {
    lines.push(`Seed fallback: ${ev.seedFallback}`);
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/view-graph-trace.test.ts`
Expected: PASS — new cases green, all pre-existing trace tests unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/view.ts tests/view-graph-trace.test.ts
git commit -m "feat(view): render seed fallback branch in the query trace"
```

---

## Task 9: lat.md documentation + cross-links

Document Tier 2 in the knowledge graph: a new `## Tier 2 — Query Fusion` test section (sibling to Tier 1), a `### Fusion` operations subsection with the cross-link to `fuseVectorGraph`, and a `## Tier 2 Features` summary. Every leaf spec already has its `// @lat:` ref placed by Tasks 1–6.

**Files:**
- Modify: `lat.md/tests.md` (after line 528, end of Tier 1 section)
- Modify: `lat.md/operations.md` (Query section ~line 102; after line 225, end of Tier 1 Features)

- [ ] **Step 1: Add the Tier 2 test section**

Append to `lat.md/tests.md`, after the Tier 1 section (after the "Lint surfaces near-duplicate page pairs" leaf, line 528):

```markdown
## Tier 2 — Query Fusion

Specs for Tier 2: RRF fusion of the vector and graph signals over the seed+BFS union, the seed similarity threshold with Jaccard→LLM fallback, and the eval `dense+rrf` config. All opt-in and default-off. See [[operations#Query#Fusion]].

### Fusion orders the union by vector and graph RRF

`fuseVectorGraph` builds a vector list (union by similarity score desc) and a graph list (hop asc, then backlink inDegree desc) and fuses them with `rrf`; every union page appears in both lists and the result is a permutation of the union. Verifies [[src/fusion.ts#fuseVectorGraph]].

### inDegree counts backlinks per page

`inDegree(graph)` returns the number of incoming links per node — including phantom targets that appear only as link destinations — shared by the graph health check and fusion's tie-break. Verifies [[src/wiki-graph.ts#inDegree]].

### Threshold gate falls back from weak seeds

In embedding/hybrid mode, when the max seed score is below `seedSimilarityThreshold`, `runQuery` falls back to Jaccard seeds; if Jaccard is empty it leaves seeds empty so the `llmSelectSeeds` guard runs. The branch taken is reported via `graph_stats.seedFallback`. Threshold `0` disables the gate.

### Context ordering follows the fused order

When `bfsFusion` is on, `buildContextBlock` emits pages in the fused order (capped at the page count), skipping ids outside the selection; when off it keeps the seeds-first concat. Verifies [[src/phases/query.ts#buildContextBlock]].

### Eval resolves the dense+rrf config

`resolveConfigs("dense+rrf", …)` resolves to `mode: "embedding"` with `fuse: true`, carrying bfsDepth and topK, so the harness can measure fused retrieval against the dense baseline.

### Eval runner applies the fused order

The eval runner for a `fuse` config applies `fuseVectorGraph` to the union layer, returning a permutation of the plain dense union that still contains the seeds. Verifies [[scripts/eval-retrieval.ts#makeRunner]].
```

- [ ] **Step 2: Add the Fusion operations subsection**

In `lat.md/operations.md`, in the `## Query` section, add a `### Fusion` subsection. Insert it after the `### BFS Expansion` subsection (after line 102, before `### Answer Generation`):

```markdown
### Fusion

Opt-in (`nativeAgent.bfsFusion`, default off). Orders the final context by a scale-free RRF fusion of the vector signal and the graph signal over the union `seeds ∪ BFS-expanded`, instead of the default seeds-first concat. The page-count cap (`topK * 3`) is unchanged.

The vector list ranks the union by similarity score descending; the graph list ranks it by hop distance ascending (seed = hop 0) tie-broken by backlink `inDegree` descending. `rrf` fuses the two. A separate gate, `nativeAgent.seedSimilarityThreshold` (default `0` = off), drops weak embedding seeds below the threshold and falls back through Jaccard → `llmSelectSeeds`; the branch taken is recorded in `graph_stats.seedFallback`. Both reuse the existing `rrfK` setting.

See [[src/fusion.ts#fuseVectorGraph]], [[src/phases/query.ts#buildContextBlock]].
```

- [ ] **Step 3: Add the Tier 2 Features summary**

Append to `lat.md/operations.md`, after the Tier 1 Features section (after line 225):

```markdown
## Tier 2 Features

Two opt-in retrieval refinements for the native Query pipeline; both default to off and are measurable on the eval harness.

**BFS fusion** (`nativeAgent.bfsFusion: true`): the Query context is ordered by an RRF fusion of the vector rank and the graph rank over the seed+BFS union ([[src/fusion.ts#fuseVectorGraph]]), rather than seeds-first concat. Reuses `rrfK`.

**Seed similarity threshold** (`nativeAgent.seedSimilarityThreshold > 0`): embedding/hybrid seeds whose max score is below the threshold are dropped in favor of Jaccard seeds, falling through to `llmSelectSeeds` when Jaccard is also empty. The eval `dense+rrf` config measures fusion against the dense baseline ([[operations#Retrieval Eval Harness]]).
```

- [ ] **Step 4: Validate the knowledge graph**

Run: `lat check`
Expected: PASS — all wiki links and code refs resolve; every Tier 2 leaf section is covered by exactly one `// @lat:` reference (placed in Tasks 1, 2, 4, 5, 6) and has a ≤250-char leading paragraph.

If `lat check` reports a missing code mention, confirm the matching `// @lat:` comment exists in the test named in that task and that the section heading text matches exactly (including the em dash in `Tier 2 — Query Fusion`).

- [ ] **Step 5: Commit**

```bash
git add lat.md/tests.md lat.md/operations.md
git commit -m "docs(lat): Tier 2 query fusion specs, operations, and cross-links"
```

---

## Task 10: Full verification sweep

Confirm the whole feature is green end-to-end and nothing regressed.

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — entire Vitest suite green, including the new `fusion`, `eval-retrieval`, gate, context-ordering, and trace tests.

- [ ] **Step 2: Lint the touched files**

Run: `npm run lint`
Expected: No new errors in touched files. (Per project memory, the repo has a non-clean tsc baseline; gate on NEW errors in files you changed, not on a globally clean run. `npm run lint` mirrors the Obsidian reviewer — node builtins must stay lazy + desktop-guarded, which this change does not introduce.)

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: esbuild production build succeeds.

- [ ] **Step 4: Final lat check**

Run: `lat check`
Expected: PASS (post-task checklist requirement from `CLAUDE.md`).

- [ ] **Step 5: Commit any stragglers**

```bash
git status   # expect a clean tree; if the embedding cache (lat.md/.cache/vectors.db) changed, leave it unless you intentionally regenerated it
```

---

## Self-Review

**1. Spec coverage:**
- Component 1 — Fusion (`src/fusion.ts`, pure): Task 2. `inDegree` helper extraction (F-001): Task 1.
- Component 2 — Threshold + fallback in `runQuery`, with trace marker (F-002 fallback chain Jaccard→llmSelectSeeds→error): Task 4 (gate + `seedFallback`), Task 8 (trace render).
- Component 3 — Context ordering in `buildContextBlock`, cap retained, zero regression when off: Task 5.
- Component 4 — Settings (`bfsFusion`, `seedSimilarityThreshold` under `nativeAgent`; defaults; threaded through `agent-runner`; UI next to hybrid block): Tasks 3, 4, 5, 7.
- Component 5 — Eval (`dense+rrf` config + runner applies fused order): Task 6.
- Testing section (fusion ordering/ties/single-list/rrfK; threshold above/below/Jaccard-empty; eval resolves + runner fuses): Tasks 2, 4, 6. `lat.md` Tier 2 test section + `require-code-mention` refs + operations Fusion subsection + cross-link: Task 9.
- Error handling (empty union → empty result → existing guard; default off reproduces current behavior): covered by Task 2 empty-union test and Task 4/5 default-path regression checks.

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"/"similar to" — every code step shows complete code and exact commands.

**3. Type consistency:** `fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, graph, depth, rrfK)` is identical in `src/fusion.ts` (Task 2), its `runQuery` call site (Task 5), and the eval runner (Task 6). `buildContextBlock(pages, seeds, selectedIds, maxPages, order?)` matches between definition and both call sites. `runQuery` param order — `…, wikiLinkValidationRetries, seedSimilarityThreshold, bfsFusion, rrfK` — is consistent across the signature (Tasks 4, 5), the `agent-runner` call (Tasks 4, 5), and every test invocation. `seedFallback: "none" | "jaccard" | "llm"` matches between the type (Task 3), the emit (Task 4), and the view render (Task 8). `ConfigRecord.fuse?` matches between `eval-config.ts` and `eval-retrieval.ts` (Task 6).

**Note on rollout:** Per the spec's Rollout section, flipping `bfsFusion`/threshold defaults on is a separate decision gated on a positive `dense` vs `dense+rrf` Recall@k/MRR delta from the eval harness. This plan ships everything default-off; it does not change defaults.
