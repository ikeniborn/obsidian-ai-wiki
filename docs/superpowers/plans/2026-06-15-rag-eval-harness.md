---
review:
  plan_hash: 6b9174a80959930a
  spec_hash: 3147eff51cb9f531
  last_run: 2026-06-15
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: WARNING
      section: "File structure / Build order line"
      section_hash: 77585f1f3db53536
      text: 'Build-order roadmap line lists wrong task numbers: it says vault loaders=Task 6, orchestration=Task 7, CLI=Task 8, gold fixture=Task 9, lat docs=Task 10, live run=Task 11. Actual body numbering is 7, 8, 9, 10, 12, 11, and pure modules span Tasks 2-6 (not 2-5). The task headings and the Done-when mapping use the correct numbers; only this one summary line is stale.'
      verdict: fixed
      verdict_at: 2026-06-15
      resolution: 'Build-order line corrected to: pure modules = Tasks 2-6, vault loaders = Task 7, orchestration = Task 8, CLI = Task 9, gold fixture = Task 10, run+live = Task 11, lat docs = Task 12.'
    - id: F-002
      phase: coverage
      severity: INFO
      section: "Task 1 / Task 9 CLI surface"
      section_hash: 8bcd5a08f7e818b6
      text: 'Plan adds a `--wiki <subfolder>` flag and EVAL_EMBED_BASE_URL/EVAL_EMBED_API_KEY env config that are absent from the spec Component 1 CLI surface. Both resolve spec underspecification (--vault alone cannot locate the wiki subfolder; the spec does not state how dense baseUrl/apiKey are supplied) and are additive + documented. Recorded as a deliberate deviation from the spec text.'
      verdict: accepted
      verdict_at: 2026-06-15
chain:
  intent: docs/superpowers/intents/2026-06-14-rag-query-quality-intent.md
  spec: docs/superpowers/specs/2026-06-15-rag-eval-harness-design.md
---
# Retrieval Eval Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone CLI (`scripts/eval.ts`, run via `tsx`) that measures retrieval quality (Recall@k + MRR) of the wiki query pipeline against a fixed `question → gold page` set, so two configs (dense vs jaccard, ±BFS depth) can be compared and the delta is visible.

**Architecture:** A thin orchestration harness ("approach A") that calls the **same public retrieval functions** as `src/phases/query.ts` (seed selection + `bfsExpandRanked`) without running `runQuery`. Pure metric/report/gold/config modules are unit-tested with vitest; the impure orchestration + CLI glue is verified by a live keyless run against a real vault. Because the plugin imports `requestUrl` from the type-only `obsidian` package, the harness ships an `obsidian-shim.ts` (real `fetch`-based `requestUrl`) and a scripts-only tsconfig that aliases `obsidian` → the shim.

**Tech Stack:** TypeScript (ESM), `tsx` (esbuild runner), `node:fs/promises`, global `fetch` (undici, already a dep), vitest for unit tests. Reuses `src/page-similarity.ts`, `src/wiki-graph.ts`, `src/wiki-seeds.ts`, `src/wiki-index.ts`, `src/wiki-path.ts`.

---

## Critical context (read before starting)

These facts were verified against the codebase and shape the whole plan. Do not re-derive them.

1. **`obsidian` is a types-only package** (`node_modules/obsidian/package.json` has `"main": ""`). `src/page-similarity.ts` line 1 is `import { requestUrl } from "obsidian";`. Under `tsx`, that bare import **fails at module-eval time** — so importing `PageSimilarityService` breaks the harness even in jaccard mode (which never calls the network). The build externalizes `obsidian` (`esbuild.config.mjs` line 9); vitest aliases it to `vitest.mock.ts`. The harness gets its own alias via a scripts-only tsconfig (Task 1).
2. **`tsx` is NOT installed** (`node_modules/.bin/tsx` absent) even though `package.json` references it in `migrate:wiki-prefix`. Task 1 adds it to `devDependencies`.
3. **Do NOT add `paths` to the root `tsconfig.json`** — that would redirect `obsidian` for `tsc`/the whole `src/` typecheck and break types everywhere. The alias lives only in `scripts/tsconfig.eval.json`.
4. **`--vault` alone cannot locate the wiki subfolder.** The wiki lives at `<vault>/!Wiki/<subfolder>/` (`WIKI_ROOT = "!Wiki"`, `src/wiki-path.ts`). The harness auto-detects the single subfolder under `!Wiki/` that has `_config/_index.md`, with a `--wiki <subfolder>` override.
5. **Embedding config:** `model` + `dimensions` are read from the cache file header (`_config/_embeddings.json`) so `loadCache` accepts the cache (`loadCache` only keeps a cache whose `model`/`dimensions` match the config). `baseUrl` comes from `EVAL_EMBED_BASE_URL`, `apiKey` from `EVAL_EMBED_API_KEY` (both env). `apiKey` is optional by design (keyless Ollama is supported). If `baseUrl`/`model` are absent, `selectEmbeddingScored` already falls back to jaccard internally — the harness logs a warning so the run is not silently mislabeled "dense".
6. **Signatures the harness depends on** (verified):
   - `parseIndexAnnotations(content: string): Map<string,string>` — `src/wiki-index.ts`
   - `selectSeeds(question, pages: Map<string,string>, topK, minScore, indexAnnotations?): {id,score}[]` — `src/wiki-seeds.ts`
   - `buildWikiGraph(pages: Map<string,string>): WikiGraph`, `pageId(path): string`, `bfsExpandRanked(seeds, graph, depth, pages, query, bfsTopK, annotations?, similarity?): Promise<{selectedIds:Set<string>; expandedScores:Record<string,number>}>` — `src/wiki-graph.ts`
   - `new PageSimilarityService(config: SimilarityConfig)`, `.loadCache(domainRoot, vaultTools)`, `.selectRelevantScored(sourceContent, indexAnnotations, allPaths): Promise<{path,score}[]>` — `src/page-similarity.ts`
   - `domainIndexPath(folder)`, `domainEmbeddingsPath(folder)`, `domainWikiFolder(sub)`, `WIKI_ROOT` — `src/wiki-path.ts`
   - The seed+BFS block mirrored: `src/phases/query.ts:69-135`.

## File structure

Files aligned to the spec's component list. Pure modules (no `obsidian`, no fs) are split out so they unit-test cleanly.

| File | Responsibility | Pure? |
|------|----------------|-------|
| `scripts/obsidian-shim.ts` | `requestUrl` over global `fetch`, matching the shape `page-similarity.ts` uses (`{status, text}`). | impure (network) |
| `scripts/tsconfig.eval.json` | Scripts-only tsconfig: extends root, aliases `obsidian` → shim, includes only `scripts/*.ts`. | n/a |
| `scripts/eval-metrics.ts` | `recallAt`, `mrr`, `averageLayer` (Component 5). | **pure** |
| `scripts/eval-report.ts` | `formatTable` (console table + baseline delta), `Snapshot`/`LayerMetrics` types (Component 7). | **pure** |
| `scripts/eval-gold.ts` | `GoldPair` type, `parseGold` (parse + validate the gold JSON) (Component 3). | **pure** |
| `scripts/eval-config.ts` | `ConfigRecord` type, `resolveConfigs` (CLI flags → registry) (Component 6). | **pure** |
| `scripts/eval-vault.ts` | node-fs shim, `locateWikiFolder`, `loadIndexAnnotations`, `loadWikiPages`, `readEmbeddingHeader` (Component 2). | impure (fs) |
| `scripts/eval-retrieval.ts` | `makeRunner` — seed + union layers per config, mirrors `query.ts` (Component 4). | impure (network) |
| `scripts/eval.ts` | CLI entry: arg parse, wire, run, errors, exit codes (Component 1). | impure |
| `scripts/eval/example.gold.json` | Template gold set (the two spec examples). | data |
| `scripts/eval/README.md` | One paragraph: gold sets are vault-specific; how to make one. | docs |
| `tests/eval-metrics.test.ts` | Unit tests for `recallAt`, `mrr`, `averageLayer`. | test |
| `tests/eval-report.test.ts` | Unit tests for `formatTable` + delta. | test |
| `tests/eval-gold.test.ts` | Unit tests for `parseGold`. | test |
| `tests/eval-config.test.ts` | Unit tests for `resolveConfigs`. | test |
| `lat.md/tests.md` | New `## Retrieval Eval Harness` spec section (3 leaves). | docs |
| `lat.md/operations.md` | New `## Retrieval Eval Harness` narrative section. | docs |
| `package.json` | Add `tsx` devDep + `eval` npm script. | config |

Build order: Task 1 (infra, de-risk the obsidian alias first) → Tasks 2–6 (pure modules, TDD) → Task 7 (vault loaders) → Task 8 (orchestration) → Task 9 (CLI) → Task 10 (gold fixture) → Task 11 (run suite + live run) → Task 12 (lat docs + `lat check`).

---

### Task 1: Infra — obsidian shim, scripts tsconfig, tsx devDep, smoke test

De-risk the `obsidian` resolution **first**: nothing else runs under `tsx` until this works.

**Files:**
- Create: `scripts/obsidian-shim.ts`
- Create: `scripts/tsconfig.eval.json`
- Modify: `package.json:6-13` (scripts) and `package.json:14-25` (devDependencies)

- [ ] **Step 1: Write the obsidian shim**

Create `scripts/obsidian-shim.ts`. `page-similarity.ts`'s `fetchEmbeddings` calls `requestUrl({url, method, headers, body, throw:false})` and reads only `resp.status` (number) and `resp.text` (string). Implement exactly that surface over global `fetch`:

```typescript
// Runtime stand-in for Obsidian's `requestUrl`, used only by the eval harness
// (scripts/) which runs under tsx outside Obsidian. The real `obsidian` package
// is types-only, so its `requestUrl` has no runtime implementation here.
// Mirrors the subset of the API that src/page-similarity.ts consumes: { status, text }.
export interface RequestUrlParam {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  throw?: boolean;
}

export interface RequestUrlResponse {
  status: number;
  text: string;
}

export async function requestUrl(param: RequestUrlParam): Promise<RequestUrlResponse> {
  const res = await fetch(param.url, {
    method: param.method ?? "GET",
    headers: param.headers,
    body: param.body,
  });
  const text = await res.text();
  return { status: res.status, text };
}
```

- [ ] **Step 2: Write the scripts-only tsconfig**

Create `scripts/tsconfig.eval.json`. It extends the root config, aliases `obsidian` to the shim, and overrides `include` so a typecheck only pulls in the harness's import graph (not all of `src/`):

```json
{
  "extends": "../tsconfig.json",
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "obsidian": ["./obsidian-shim.ts"]
    },
    "noEmit": true
  },
  "include": ["./*.ts"]
}
```

- [ ] **Step 3: Add tsx devDependency and the `eval` npm script**

Edit `package.json`. In `"scripts"` add (after `"migrate:wiki-prefix"`):

```json
    "eval": "TSX_TSCONFIG_PATH=scripts/tsconfig.eval.json tsx scripts/eval.ts"
```

In `"devDependencies"` add (keep alphabetical, before `"typescript"`):

```json
    "tsx": "^4.19.0",
```

Then install:

Run: `npm install`
Expected: `tsx` appears under `node_modules/.bin/tsx`.

- [ ] **Step 4: Smoke-test the alias (this proves the whole approach)**

Create a throwaway smoke file `scripts/_smoke.ts`:

```typescript
import { PageSimilarityService } from "../src/page-similarity";
const s = new PageSimilarityService({ mode: "jaccard", topK: 5 });
console.log("obsidian alias OK:", s.config.mode);
```

Run: `TSX_TSCONFIG_PATH=scripts/tsconfig.eval.json npx tsx scripts/_smoke.ts`
Expected: prints `obsidian alias OK: jaccard` with **no** `Cannot find module 'obsidian'` / `requestUrl is not a function` error.

**If it fails** with an unresolved `obsidian`: `tsx` did not honor `paths`. Fallback — pass the alias via a Node import map is not available; instead set the env explicitly and confirm the tsconfig path is correct, or as a last resort use `tsx --tsconfig scripts/tsconfig.eval.json scripts/_smoke.ts`. Resolve before continuing; the rest of the plan assumes the alias works.

- [ ] **Step 5: Delete the smoke file**

Run: `rm scripts/_smoke.ts`

- [ ] **Step 6: Commit**

```bash
git add scripts/obsidian-shim.ts scripts/tsconfig.eval.json package.json package-lock.json
git commit -m "build(eval): obsidian-shim + scripts tsconfig + tsx for the eval harness"
```

---

### Task 2: Metrics — `recallAt`, `mrr` (pure, TDD)

**Files:**
- Create: `scripts/eval-metrics.ts`
- Test: `tests/eval-metrics.test.ts`

- [ ] **Step 1: Write failing tests for `recallAt` and `mrr`**

Create `tests/eval-metrics.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { recallAt, mrr } from "../scripts/eval-metrics";

describe("recallAt", () => {
  it("counts gold hits within the top-k window, divided by |gold|", () => {
    // gold = 2 ids, both in top-3 → 1.0
    expect(recallAt(["A", "B", "C"], ["A", "B"], 3)).toBe(1);
    // only A is within top-2 → 0.5
    expect(recallAt(["A", "X", "B"], ["A", "B"], 2)).toBe(0.5);
  });

  it("ignores ranks beyond k", () => {
    expect(recallAt(["X", "Y", "A"], ["A"], 2)).toBe(0);
  });

  it("returns 0 for empty gold", () => {
    expect(recallAt(["A"], [], 3)).toBe(0);
  });
});

describe("mrr", () => {
  it("is the reciprocal of the 1-based rank of the first gold hit", () => {
    expect(mrr(["X", "A", "B"], ["A", "B"])).toBe(1 / 2);
    expect(mrr(["A"], ["A"])).toBe(1);
  });

  it("is 0 when no gold id appears in the ranked list", () => {
    expect(mrr(["X", "Y"], ["A"])).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/eval-metrics.test.ts`
Expected: FAIL — `Failed to resolve import "../scripts/eval-metrics"`.

- [ ] **Step 3: Implement `eval-metrics.ts`**

Create `scripts/eval-metrics.ts`:

```typescript
// Pure retrieval metrics over a ranked pageId list and a gold pageId set.
// Obsidian-free and fs-free so they unit-test under vitest without aliases.

/** Recall@k = |gold ∩ ranked[0..k)| / |gold|. 0 when gold is empty. */
export function recallAt(ranked: string[], gold: string[], k: number): number {
  if (gold.length === 0) return 0;
  const top = new Set(ranked.slice(0, k));
  let hit = 0;
  for (const g of gold) if (top.has(g)) hit++;
  return hit / gold.length;
}

/** Reciprocal rank of the first gold hit (1-based). 0 if none appear. */
export function mrr(ranked: string[], gold: string[]): number {
  const goldSet = new Set(gold);
  for (let i = 0; i < ranked.length; i++) {
    if (goldSet.has(ranked[i])) return 1 / (i + 1);
  }
  return 0;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/eval-metrics.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-metrics.ts tests/eval-metrics.test.ts
git commit -m "feat(eval): recallAt + mrr pure metrics with unit tests"
```

---

### Task 3: Metric aggregation — `averageLayer` (pure, TDD)

Averages `recallAt`/`mrr` over all gold pairs, per k. This is the per-layer rollup feeding the snapshot.

**Files:**
- Modify: `scripts/eval-metrics.ts`
- Modify: `tests/eval-metrics.test.ts`

- [ ] **Step 1: Add failing tests for `averageLayer`**

Append to `tests/eval-metrics.test.ts`:

```typescript
import { averageLayer, K_VALUES } from "../scripts/eval-metrics";

describe("averageLayer", () => {
  it("averages recall per k and mrr across questions", () => {
    const ranked = [
      ["A", "B", "C"], // q1
      ["X", "A", "Y"], // q2
    ];
    const gold = [
      ["A"], // q1: A at rank 1
      ["A"], // q2: A at rank 2
    ];
    const m = averageLayer(ranked, gold, [3]);
    // recall@3: q1 hit (1.0) + q2 hit (1.0) → 1.0
    expect(m.recall[3]).toBe(1);
    // mrr: (1/1 + 1/2) / 2 = 0.75
    expect(m.mrr).toBe(0.75);
  });

  it("exposes the fixed k set [3,5,8]", () => {
    expect([...K_VALUES]).toEqual([3, 5, 8]);
  });

  it("returns zeros for an empty question set", () => {
    const m = averageLayer([], [], [3, 5, 8]);
    expect(m.mrr).toBe(0);
    expect(m.recall[3]).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/eval-metrics.test.ts`
Expected: FAIL — `averageLayer`/`K_VALUES` not exported.

- [ ] **Step 3: Implement `averageLayer` + `K_VALUES`**

Append to `scripts/eval-metrics.ts`:

```typescript
/** Fixed reporting cut-offs for Recall@k. MRR is unbounded rank. */
export const K_VALUES = [3, 5, 8] as const;

export interface LayerMetrics {
  recall: Record<number, number>; // keyed by k
  mrr: number;
}

/**
 * Average recall (per k) and mrr over aligned per-question ranked/gold lists.
 * `ranked[i]` and `gold[i]` describe the same question.
 */
export function averageLayer(
  ranked: string[][],
  gold: string[][],
  ks: number[],
): LayerMetrics {
  const n = ranked.length;
  const recall: Record<number, number> = {};
  for (const k of ks) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += recallAt(ranked[i], gold[i], k);
    recall[k] = n ? sum / n : 0;
  }
  let mrrSum = 0;
  for (let i = 0; i < n; i++) mrrSum += mrr(ranked[i], gold[i]);
  return { recall, mrr: n ? mrrSum / n : 0 };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/eval-metrics.test.ts`
Expected: PASS (all assertions).

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-metrics.ts tests/eval-metrics.test.ts
git commit -m "feat(eval): averageLayer per-k/mrr aggregation"
```

---

### Task 4: Gold-set loader — `parseGold` (pure, TDD)

**Files:**
- Create: `scripts/eval-gold.ts`
- Test: `tests/eval-gold.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/eval-gold.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { parseGold } from "../scripts/eval-gold";

describe("parseGold", () => {
  it("parses an array of {q, gold} pairs", () => {
    const raw = JSON.stringify([
      { q: "как работает ingest", gold: ["Ingest", "Embedding-Cache"] },
      { q: "что делает BFS", gold: ["Query-Graph-Traversal"] },
    ]);
    const pairs = parseGold(raw);
    expect(pairs).toHaveLength(2);
    expect(pairs[0].q).toBe("как работает ingest");
    expect(pairs[0].gold).toEqual(["Ingest", "Embedding-Cache"]);
  });

  it("throws on an empty gold set", () => {
    expect(() => parseGold("[]")).toThrow(/empty/i);
  });

  it("throws when a pair is missing q or has empty gold", () => {
    expect(() => parseGold(JSON.stringify([{ gold: ["A"] }]))).toThrow(/q/i);
    expect(() => parseGold(JSON.stringify([{ q: "x", gold: [] }]))).toThrow(/gold/i);
  });

  it("throws on malformed JSON", () => {
    expect(() => parseGold("{not json")).toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/eval-gold.test.ts`
Expected: FAIL — cannot resolve `../scripts/eval-gold`.

- [ ] **Step 3: Implement `eval-gold.ts`**

Create `scripts/eval-gold.ts`:

```typescript
// Gold-set fixture loader (Component 3). A gold set is a vault-specific JSON
// array of { q, gold } pairs, where `gold` lists 1+ relevant pageId stems.

export interface GoldPair {
  q: string;
  gold: string[];
}

/** Parse + validate a gold-set JSON string. Throws a descriptive Error on any defect. */
export function parseGold(raw: string): GoldPair[] {
  const data = JSON.parse(raw) as unknown; // throws on malformed JSON
  if (!Array.isArray(data)) {
    throw new Error("gold set must be a JSON array of { q, gold } pairs");
  }
  if (data.length === 0) {
    throw new Error("gold set is empty — nothing to evaluate");
  }
  return data.map((entry, i) => {
    const e = entry as { q?: unknown; gold?: unknown };
    if (typeof e.q !== "string" || e.q.trim() === "") {
      throw new Error(`gold[${i}]: "q" must be a non-empty string`);
    }
    if (!Array.isArray(e.gold) || e.gold.length === 0 || !e.gold.every((g) => typeof g === "string")) {
      throw new Error(`gold[${i}]: "gold" must be a non-empty array of pageId strings`);
    }
    return { q: e.q, gold: e.gold as string[] };
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/eval-gold.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-gold.ts tests/eval-gold.test.ts
git commit -m "feat(eval): gold-set parser with validation"
```

---

### Task 5: Config registry — `resolveConfigs` (pure, TDD)

Maps CLI flags to `ConfigRecord[]`. `dense` → `mode: "embedding"`, `jaccard` → `mode: "jaccard"` (the dense↔embedding bridge the spec pins).

**Files:**
- Create: `scripts/eval-config.ts`
- Test: `tests/eval-config.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/eval-config.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { resolveConfigs } from "../scripts/eval-config";

describe("resolveConfigs", () => {
  it("defaults to dense,jaccard when the flag is undefined", () => {
    const cfgs = resolveConfigs(undefined, 1, 8);
    expect(cfgs.map((c) => c.name)).toEqual(["dense", "jaccard"]);
    expect(cfgs.find((c) => c.name === "dense")!.mode).toBe("embedding");
    expect(cfgs.find((c) => c.name === "jaccard")!.mode).toBe("jaccard");
  });

  it("carries bfsDepth and topK onto every record", () => {
    const cfgs = resolveConfigs("dense", 2, 5);
    expect(cfgs[0]).toEqual({ name: "dense", mode: "embedding", bfsDepth: 2, topK: 5 });
  });

  it("accepts a comma list and trims", () => {
    const cfgs = resolveConfigs("jaccard, dense", 0, 8);
    expect(cfgs.map((c) => c.name)).toEqual(["jaccard", "dense"]);
  });

  it("throws on an unknown config name", () => {
    expect(() => resolveConfigs("hybrid", 1, 8)).toThrow(/hybrid/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/eval-config.test.ts`
Expected: FAIL — cannot resolve `../scripts/eval-config`.

- [ ] **Step 3: Implement `eval-config.ts`**

Create `scripts/eval-config.ts`:

```typescript
// Config registry (Component 6). Tier 2 adds entries (dense+rrf, dense+rerank)
// as one record each; the orchestration dispatches on `mode` + future fields.

export interface ConfigRecord {
  name: string;
  mode: "embedding" | "jaccard"; // PageSimilarityService mode
  bfsDepth: number;
  topK: number;
}

// "dense" is the config name; "embedding" is its underlying mechanism (the
// embedding cache + selectRelevantScored). "jaccard" is keyless token overlap.
const NAME_TO_MODE: Record<string, ConfigRecord["mode"]> = {
  dense: "embedding",
  jaccard: "jaccard",
};

export function resolveConfigs(
  configFlag: string | undefined,
  bfsDepth: number,
  topK: number,
): ConfigRecord[] {
  const names = (configFlag ?? "dense,jaccard")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.map((name) => {
    const mode = NAME_TO_MODE[name];
    if (!mode) {
      throw new Error(`unknown --config "${name}" (expected: dense, jaccard)`);
    }
    return { name, mode, bfsDepth, topK };
  });
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/eval-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-config.ts tests/eval-config.test.ts
git commit -m "feat(eval): config registry resolving CLI flags to records"
```

---

### Task 6: Report formatter — `formatTable` + delta (pure, TDD)

Console table: rows = configs, columns `sR@3 sR@5 sR@8 sMRR uR@3 uR@5 uR@8 uMRR` (s = seed, u = union). With a baseline snapshot, appends a per-metric `(▲/▼ signed)` delta. Also defines the `Snapshot` shape used for `--out`.

**Files:**
- Create: `scripts/eval-report.ts`
- Test: `tests/eval-report.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/eval-report.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { formatTable } from "../scripts/eval-report";
import type { Snapshot } from "../scripts/eval-report";

const snap: Snapshot = {
  vault: "/v",
  k: [3, 5, 8],
  configs: [
    {
      name: "dense",
      seed: { recall: { 3: 0.5, 5: 0.6, 8: 0.7 }, mrr: 0.4 },
      union: { recall: { 3: 0.55, 5: 0.65, 8: 0.75 }, mrr: 0.45 },
    },
  ],
};

describe("formatTable", () => {
  it("renders a header and one row per config with all 8 metric cells", () => {
    const out = formatTable(snap);
    expect(out).toContain("sR@3");
    expect(out).toContain("uMRR");
    expect(out).toContain("dense");
    expect(out).toContain("0.500"); // sR@3
    expect(out).toContain("0.750"); // uR@8
  });

  it("annotates deltas against a baseline", () => {
    const baseline: Snapshot = {
      ...snap,
      configs: [
        {
          name: "dense",
          seed: { recall: { 3: 0.4, 5: 0.6, 8: 0.7 }, mrr: 0.4 },
          union: { recall: { 3: 0.55, 5: 0.65, 8: 0.75 }, mrr: 0.45 },
        },
      ],
    };
    const out = formatTable(snap, baseline);
    expect(out).toContain("▲"); // sR@3 went 0.4 → 0.5
    expect(out).toMatch(/\+0\.100/);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/eval-report.test.ts`
Expected: FAIL — cannot resolve `../scripts/eval-report`.

- [ ] **Step 3: Implement `eval-report.ts`**

Create `scripts/eval-report.ts`:

```typescript
// Output formatting (Component 7). Console table + optional baseline delta,
// and the Snapshot shape persisted by --out / read by --baseline.
import type { LayerMetrics } from "./eval-metrics";

export interface ConfigSnapshot {
  name: string;
  seed: LayerMetrics;
  union: LayerMetrics;
}

export interface Snapshot {
  vault: string;
  k: number[];
  configs: ConfigSnapshot[];
}

const COLS = ["sR@3", "sR@5", "sR@8", "sMRR", "uR@3", "uR@5", "uR@8", "uMRR"];

/** The 8 metric cells for a config, in column order, given the k set. */
function cells(c: ConfigSnapshot, ks: number[]): number[] {
  const [k0, k1, k2] = ks;
  return [
    c.seed.recall[k0], c.seed.recall[k1], c.seed.recall[k2], c.seed.mrr,
    c.union.recall[k0], c.union.recall[k1], c.union.recall[k2], c.union.mrr,
  ];
}

function delta(cur: number, base: number | undefined): string {
  if (base === undefined) return "";
  const d = cur - base;
  if (Math.abs(d) < 1e-9) return " (=)";
  const arrow = d > 0 ? "▲" : "▼";
  const sign = d >= 0 ? "+" : "";
  return ` (${arrow}${sign}${d.toFixed(3)})`;
}

export function formatTable(snap: Snapshot, baseline?: Snapshot): string {
  const baseByName = new Map(
    (baseline?.configs ?? []).map((c) => [c.name, c]),
  );
  const lines: string[] = [];
  lines.push(["config".padEnd(18), ...COLS.map((c) => c.padStart(8))].join(" "));
  for (const c of snap.configs) {
    const cur = cells(c, snap.k);
    const base = baseByName.get(c.name);
    const baseCells = base ? cells(base, snap.k) : undefined;
    const row = cur.map((v, i) => {
      const d = baseCells ? delta(v, baseCells[i]) : "";
      return `${v.toFixed(3).padStart(8)}${d}`;
    });
    lines.push([c.name.padEnd(18), ...row].join(" "));
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run tests/eval-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/eval-report.ts tests/eval-report.test.ts
git commit -m "feat(eval): console table formatter with baseline deltas"
```

---

### Task 7: Vault loaders — node-fs shim, wiki location, index + pages (impure)

This is the node-fs `VaultTools` shim (Component 2) plus the vault readers. No unit test (fs glue); verified end-to-end in Task 11. Keep it small and obviously correct.

**Files:**
- Create: `scripts/eval-vault.ts`

- [ ] **Step 1: Implement `eval-vault.ts`**

Create `scripts/eval-vault.ts`:

```typescript
// node-fs vault access for the harness (Component 2). All vault paths are
// vault-relative and resolved against `vaultRoot`. The fs shim exposes only the
// `{ read, write }` surface that PageSimilarityService.loadCache consumes.
import { readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { WIKI_ROOT, domainWikiFolder, domainIndexPath, domainEmbeddingsPath } from "../src/wiki-path";
import { parseIndexAnnotations } from "../src/wiki-index";

export interface FsShim {
  read(vaultPath: string): Promise<string>;
  write(vaultPath: string, data: string): Promise<void>;
}

/** Minimal vault-relative fs adapter rooted at `vaultRoot`. */
export function makeFsShim(vaultRoot: string): FsShim {
  const abs = (p: string) => join(vaultRoot, p);
  return {
    async read(p) {
      return readFile(abs(p), "utf8");
    },
    async write(p, data) {
      const full = abs(p);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, data, "utf8");
    },
  };
}

/**
 * Resolve the wiki folder (e.g. "!Wiki/os"). With `wikiArg`, use it directly.
 * Otherwise auto-detect the single subfolder under !Wiki/ that has
 * _config/_index.md. Errors if zero or more than one candidate exists.
 */
export async function locateWikiFolder(vaultRoot: string, wikiArg?: string): Promise<string> {
  if (wikiArg) {
    const folder = domainWikiFolder(wikiArg);
    if (!existsSync(join(vaultRoot, domainIndexPath(folder)))) {
      throw new Error(`wiki "${wikiArg}" has no ${domainIndexPath(folder)} under ${vaultRoot}`);
    }
    return folder;
  }
  const wikiRootAbs = join(vaultRoot, WIKI_ROOT);
  if (!existsSync(wikiRootAbs)) {
    throw new Error(`no ${WIKI_ROOT}/ folder under ${vaultRoot}`);
  }
  const entries = await readdir(wikiRootAbs, { withFileTypes: true });
  const candidates = entries
    .filter((e) => e.isDirectory() && e.name !== "_config")
    .map((e) => domainWikiFolder(e.name))
    .filter((folder) => existsSync(join(vaultRoot, domainIndexPath(folder))));
  if (candidates.length === 0) {
    throw new Error(`no wiki subfolder with _config/_index.md found under ${WIKI_ROOT}/ — pass --wiki <subfolder>`);
  }
  if (candidates.length > 1) {
    throw new Error(`multiple wiki subfolders found (${candidates.join(", ")}) — pass --wiki <subfolder>`);
  }
  return candidates[0];
}

/** Read + parse the wiki index annotations (pageId → annotation). */
export async function loadIndexAnnotations(fs: FsShim, wikiVaultPath: string): Promise<Map<string, string>> {
  const content = await fs.read(domainIndexPath(wikiVaultPath));
  return parseIndexAnnotations(content);
}

/**
 * Read every wiki .md page into a Map<vaultRelativePath, content>, excluding
 * meta files (_index.md, _log.md) and anything under _config/. Mirrors the file
 * filter in query.ts so pageId() yields the same ids the retrieval layer returns.
 */
export async function loadWikiPages(vaultRoot: string, wikiVaultPath: string): Promise<Map<string, string>> {
  const dirAbs = join(vaultRoot, wikiVaultPath);
  const names = await readdir(dirAbs, { withFileTypes: true });
  const pages = new Map<string, string>();
  for (const e of names) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    if (e.name === "_index.md" || e.name === "_log.md") continue;
    const vaultRel = `${wikiVaultPath}/${e.name}`;
    pages.set(vaultRel, await readFile(join(dirAbs, e.name), "utf8"));
  }
  return pages;
}

/** Read model + dimensions from the embedding cache header (if present). */
export async function readEmbeddingHeader(
  fs: FsShim,
  wikiVaultPath: string,
): Promise<{ model?: string; dimensions?: number }> {
  try {
    const raw = await fs.read(domainEmbeddingsPath(wikiVaultPath));
    const parsed = JSON.parse(raw) as { model?: string; dimensions?: number };
    return { model: parsed.model, dimensions: parsed.dimensions };
  } catch {
    return {};
  }
}
```

- [ ] **Step 2: Typecheck the harness graph so far**

Run: `npx tsc -p scripts/tsconfig.eval.json`
Expected: no errors. (This compiles only the harness import graph; `obsidian` resolves to the shim.)

- [ ] **Step 3: Commit**

```bash
git add scripts/eval-vault.ts
git commit -m "feat(eval): node-fs vault loaders + wiki folder detection"
```

---

### Task 8: Orchestration — `makeRunner` (seed + union layers, impure)

Mirrors `src/phases/query.ts:69-135` by calling the **same public functions in the same order** (approach A). Builds a similarity service once per config (loading the cache once), then returns a per-question runner. No unit test (network/cache glue); verified in Task 11.

**Files:**
- Create: `scripts/eval-retrieval.ts`

- [ ] **Step 1: Implement `eval-retrieval.ts`**

Create `scripts/eval-retrieval.ts`:

```typescript
// Retrieval orchestration (Component 4, approach A — thin orchestration).
// MIRRORS the seed-selection + BFS block of src/phases/query.ts:69-135 by
// calling the same public functions in the same order. It does NOT run runQuery
// and does NOT modify query.ts. If Tier 2 changes production ordering, update
// this file in the same change (drift mitigation).
import type { VaultTools } from "../src/vault-tools";
import { PageSimilarityService } from "../src/page-similarity";
import { buildWikiGraph, pageId, bfsExpandRanked, type WikiGraph } from "../src/wiki-graph";
import { selectSeeds } from "../src/wiki-seeds";
import type { ConfigRecord } from "./eval-config";
import type { FsShim } from "./eval-vault";

// Union-layer BFS top-k. Mirrors query.ts's bfsTopK default (10); kept generous
// so union Recall@8 is not pre-truncated.
const UNION_BFS_TOPK = 10;

export interface RunInputs {
  wikiVaultPath: string;
  fs: FsShim;
  annotations: Map<string, string>;
  allAnnotatedPaths: string[]; // `${wikiVaultPath}/${id}.md` per annotation key
  pages: Map<string, string>; // vaultRelativePath → content
  graph: WikiGraph;
  embed: { baseUrl?: string; apiKey?: string; model?: string; dimensions?: number };
}

export interface QuestionRanks {
  seed: string[]; // ranked pageIds (seed layer)
  union: string[]; // ranked pageIds (seeds first, then BFS-expanded)
}

export type Runner = (question: string) => Promise<QuestionRanks>;

/**
 * Build a per-question runner for one config. For dense (embedding) configs this
 * loads the embedding cache once. Logs a warning if dense is requested without a
 * live endpoint (it will fall back to jaccard internally — not silently labeled "dense").
 */
export async function makeRunner(cfg: ConfigRecord, inputs: RunInputs): Promise<Runner> {
  const { wikiVaultPath, fs, annotations, allAnnotatedPaths, pages, graph, embed } = inputs;

  // syntheticPages: empty-body Map keyed by annotated path, as query.ts builds
  // for the non-embedding seed path.
  const syntheticPages = new Map<string, string>(
    [...annotations.keys()].map((id) => [`${wikiVaultPath}/${id}.md`, ""]),
  );

  if (cfg.mode === "embedding") {
    const service = new PageSimilarityService({
      mode: "embedding",
      model: embed.model,
      dimensions: embed.dimensions,
      baseUrl: embed.baseUrl,
      apiKey: embed.apiKey,
      topK: cfg.topK,
    });
    // loadCache only needs `read`; cast the fs shim to the VaultTools shape.
    await service.loadCache(wikiVaultPath, fs as unknown as VaultTools);
    if (!embed.baseUrl || !embed.model) {
      console.warn(
        `[eval] config "${cfg.name}" requested dense, but no embedding endpoint/model configured ` +
          `(EVAL_EMBED_BASE_URL + cached model). Falling back to jaccard internally.`,
      );
    }
    return async (question) => {
      const scored = await service.selectRelevantScored(question, annotations, allAnnotatedPaths);
      const seeds = scored.slice(0, cfg.topK).map((x) => pageId(x.path));
      const { selectedIds } = await bfsExpandRanked(
        seeds, graph, cfg.bfsDepth, pages, question, UNION_BFS_TOPK, annotations, service,
      );
      return { seed: seeds, union: [...selectedIds] };
    };
  }

  // jaccard
  const service = new PageSimilarityService({ mode: "jaccard", topK: cfg.topK });
  return async (question) => {
    // minScore = 0 so the full ranked list is visible (Recall@k not pre-truncated).
    const seedResults = selectSeeds(question, syntheticPages, cfg.topK, 0, annotations);
    const seeds = seedResults.map((x) => x.id);
    const { selectedIds } = await bfsExpandRanked(
      seeds, graph, cfg.bfsDepth, pages, question, UNION_BFS_TOPK, annotations, service,
    );
    return { seed: seeds, union: [...selectedIds] };
  };
}

/** Convenience: build the graph from pages (kept here so eval.ts stays thin). */
export function buildGraph(pages: Map<string, string>): WikiGraph {
  return buildWikiGraph(pages);
}
```

- [ ] **Step 2: Typecheck the harness graph**

Run: `npx tsc -p scripts/tsconfig.eval.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add scripts/eval-retrieval.ts
git commit -m "feat(eval): seed+union orchestration mirroring query.ts"
```

---

### Task 9: CLI entry — `eval.ts` (arg parse, wire, run, errors, exit codes)

Ties everything together (Component 1). No unit test; verified in Task 11.

**Files:**
- Create: `scripts/eval.ts`

- [ ] **Step 1: Implement `eval.ts`**

Create `scripts/eval.ts`:

```typescript
#!/usr/bin/env node
// Retrieval eval harness (Component 1). Measures Recall@k + MRR of the wiki
// retrieval pipeline against a fixed gold set, for one or more configs.
//
// Usage:
//   tsx scripts/eval.ts --vault <path> --gold <gold.json>
//        [--wiki <subfolder>] [--config dense|jaccard] [--bfs-depth 0|1|2]
//        [--top-k N] [--out run.json] [--baseline run.json]
//
// Env (dense/embedding mode): EVAL_EMBED_BASE_URL, EVAL_EMBED_API_KEY (optional).
import { readFile, writeFile } from "node:fs/promises";
import { pageId } from "../src/wiki-graph";
import { parseGold } from "./eval-gold";
import { resolveConfigs } from "./eval-config";
import { averageLayer, K_VALUES } from "./eval-metrics";
import { formatTable, type Snapshot } from "./eval-report";
import {
  makeFsShim, locateWikiFolder, loadIndexAnnotations, loadWikiPages, readEmbeddingHeader,
} from "./eval-vault";
import { makeRunner, buildGraph, type RunInputs } from "./eval-retrieval";

interface Args {
  vault: string;
  gold: string;
  wiki?: string;
  config?: string;
  bfsDepth: number;
  topK: number;
  out?: string;
  baseline?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const vault = get("--vault");
  const gold = get("--gold");
  if (!vault) throw new Error("--vault <path> is required");
  if (!gold) throw new Error("--gold <gold.json> is required");
  return {
    vault,
    gold,
    wiki: get("--wiki"),
    config: get("--config"),
    bfsDepth: get("--bfs-depth") !== undefined ? Number(get("--bfs-depth")) : 1,
    topK: get("--top-k") !== undefined ? Number(get("--top-k")) : 8,
    out: get("--out"),
    baseline: get("--baseline"),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const goldPairs = parseGold(await readFile(args.gold, "utf8")); // throws if empty/malformed
  const fs = makeFsShim(args.vault);
  const wikiVaultPath = await locateWikiFolder(args.vault, args.wiki);
  const annotations = await loadIndexAnnotations(fs, wikiVaultPath);
  const pages = await loadWikiPages(args.vault, wikiVaultPath);
  const graph = buildGraph(pages);
  const embed = {
    baseUrl: process.env.EVAL_EMBED_BASE_URL,
    apiKey: process.env.EVAL_EMBED_API_KEY,
    ...(await readEmbeddingHeader(fs, wikiVaultPath)), // model + dimensions
  };

  // Warn about gold ids that can never be retrieved (stale gold entries).
  const knownIds = new Set([...pages.keys()].map((p) => pageId(p)));
  for (const { q, gold } of goldPairs) {
    for (const g of gold) {
      if (!knownIds.has(g)) {
        console.warn(`[eval] gold id "${g}" (q: "${q}") not present in vault — counts as a miss`);
      }
    }
  }

  const inputs: RunInputs = {
    wikiVaultPath,
    fs,
    annotations,
    allAnnotatedPaths: [...annotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`),
    pages,
    graph,
    embed,
  };

  const configs = resolveConfigs(args.config, args.bfsDepth, args.topK);
  const ks = [...K_VALUES];
  const snapshot: Snapshot = { vault: args.vault, k: ks, configs: [] };

  for (const cfg of configs) {
    const runner = await makeRunner(cfg, inputs);
    const seedRanks: string[][] = [];
    const unionRanks: string[][] = [];
    const golds: string[][] = [];
    for (const { q, gold } of goldPairs) {
      const ranks = await runner(q);
      seedRanks.push(ranks.seed);
      unionRanks.push(ranks.union);
      golds.push(gold);
    }
    snapshot.configs.push({
      name: cfg.name,
      seed: averageLayer(seedRanks, golds, ks),
      union: averageLayer(unionRanks, golds, ks),
    });
  }

  const baseline = args.baseline
    ? (JSON.parse(await readFile(args.baseline, "utf8")) as Snapshot)
    : undefined;

  console.log(formatTable(snapshot, baseline));

  if (args.out) {
    await writeFile(args.out, JSON.stringify(snapshot, null, 2), "utf8");
    console.log(`\nwrote ${args.out}`);
  }
}

main().catch((err) => {
  console.error(`[eval] ${(err as Error).message}`);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck the full harness graph**

Run: `npx tsc -p scripts/tsconfig.eval.json`
Expected: no errors.

- [ ] **Step 3: Verify CLI error handling (missing required flag)**

Run: `npx tsx scripts/eval.ts`
Expected: prints `[eval] --vault <path> is required` to stderr and exits non-zero. Confirm with: `echo $?` → `1`.

- [ ] **Step 4: Commit**

```bash
git add scripts/eval.ts
git commit -m "feat(eval): CLI entry wiring gold/config/metrics/report"
```

---

### Task 10: Gold-set fixture template

**Files:**
- Create: `scripts/eval/example.gold.json`
- Create: `scripts/eval/README.md`

- [ ] **Step 1: Create the example gold set**

Create `scripts/eval/example.gold.json` (the two examples from the spec; pageIds are placeholders to be replaced per vault):

```json
[
  { "q": "как работает инкрементальный ingest", "gold": ["Ingest", "Embedding-Cache"] },
  { "q": "что делает BFS depth 1", "gold": ["Query-Graph-Traversal"] }
]
```

- [ ] **Step 2: Create the README**

Create `scripts/eval/README.md`:

```markdown
# Eval gold sets

Each `*.gold.json` is a **vault-specific** array of `{ q, gold }` pairs (~30–50
entries). `q` is a question; `gold` is the list of relevant pageId stems
(the same stems retrieval returns, e.g. `Ingest` for `Ingest.md`). A topic may
span pages, so `gold` can hold more than one id.

`example.gold.json` is a template — replace the questions and ids with ones that
reference your own vault, then run:

    npm run eval -- --vault /path/to/vault --gold scripts/eval/your-vault.gold.json

Gold files contain only questions + page ids — no vault content — so they are
safe to commit.
```

- [ ] **Step 3: Commit**

```bash
git add scripts/eval/example.gold.json scripts/eval/README.md
git commit -m "docs(eval): gold-set template + README"
```

---

### Task 11: Run the full suite + live keyless run

Confirm the unit suite stays green and the harness runs end-to-end against a real vault (jaccard is keyless — proves the orchestration without needing an embedding endpoint).

**Files:** none (verification only).

- [ ] **Step 1: Full unit suite**

Run: `npm test`
Expected: PASS, including the four new `tests/eval-*.test.ts` files. No previously-passing test regresses.

- [ ] **Step 2: Lint (touched src only — harness lives in scripts/, not linted, but confirm no src/ regressions)**

Run: `npm run lint`
Expected: clean. (The harness adds only `scripts/` + `tests/` + `scripts/eval/` files; `src/` is untouched, so `lint` and `tsc` on `src/` are unaffected.)

- [ ] **Step 3: Live jaccard run against a real vault**

Pick a real vault that has `!Wiki/<subfolder>/_config/_index.md`. Run jaccard-only (keyless):

Run: `npm run eval -- --vault <REAL_VAULT_PATH> --gold scripts/eval/example.gold.json --config jaccard --out /tmp/eval-run.json`
Expected: prints a table with header `config  sR@3 sR@5 sR@8 sMRR uR@3 uR@5 uR@8 uMRR` and a `jaccard` row of numbers in `[0,1]`; writes `/tmp/eval-run.json`. (Replace `example.gold.json` with a real gold set for meaningful numbers — example ids likely warn "not present in vault".)

- [ ] **Step 4: Verify the baseline delta path**

Run: `npm run eval -- --vault <REAL_VAULT_PATH> --gold scripts/eval/example.gold.json --config jaccard --baseline /tmp/eval-run.json`
Expected: same table, now with ` (=)` deltas next to each cell (identical run → zero delta). This exercises the before/after comparison the Done-when clause requires.

- [ ] **Step 5 (optional, needs an endpoint): Live dense vs jaccard**

With an embedding endpoint and a populated `_embeddings.json` cache in the vault:

Run: `EVAL_EMBED_BASE_URL=<url> EVAL_EMBED_API_KEY=<key-or-empty> npm run eval -- --vault <REAL_VAULT_PATH> --gold scripts/eval/<real>.gold.json --config dense,jaccard`
Expected: both rows print; the `dense` row reflects embedding retrieval (no "Falling back to jaccard" warning). This is the spec's headline signal — dense vs jaccard delta visible.

- [ ] **Step 6: Commit (if any fixups were needed)**

```bash
git add -A
git commit -m "test(eval): verify harness runs end-to-end on a real vault"
```

---

### Task 12: lat.md documentation + `lat check` (REQUIRED by project CLAUDE.md)

Add a test-spec section for the metric functions and tie the vitest cases with `// @lat:` refs; document the harness narratively. `lat.md/tests.md` has `require-code-mention: true`, so **every new leaf section must be referenced by a `// @lat:` comment** in test code.

**Files:**
- Modify: `lat.md/tests.md`
- Modify: `lat.md/operations.md`
- Modify: `tests/eval-metrics.test.ts`, `tests/eval-gold.test.ts`, `tests/eval-report.test.ts` (add `@lat:` refs)

- [ ] **Step 1: Add the test-spec section to `lat.md/tests.md`**

Append at the end of `lat.md/tests.md`:

```markdown
## Retrieval Eval Harness

Spec for the standalone retrieval eval harness (`scripts/eval.ts`) pure functions — Recall@k, MRR, gold-set parsing, and the console report formatter. See [[operations#Retrieval Eval Harness]].

### Recall and MRR over a ranked list

`recallAt(ranked, gold, k)` returns `|gold ∩ ranked[0..k)| / |gold|` (0 for empty gold); `mrr(ranked, gold)` returns the reciprocal of the 1-based rank of the first gold hit, or 0 if none appear. `averageLayer` averages both across all gold pairs per k.

### Gold set parsing rejects malformed input

`parseGold` accepts a non-empty JSON array of `{ q, gold }` pairs and throws a descriptive error on an empty set, a missing/empty `q`, an empty `gold` array, or malformed JSON.

### Report table renders metrics and baseline deltas

`formatTable` renders one row per config with the eight `s*/u*` metric cells, and — given a baseline snapshot — annotates each cell with a `▲/▼` signed delta.
```

- [ ] **Step 2: Add `@lat:` refs in the test files**

In `tests/eval-metrics.test.ts`, add immediately above the `describe("recallAt", ...)` line:

```typescript
// @lat: [[tests#Retrieval Eval Harness#Recall and MRR over a ranked list]]
```

In `tests/eval-gold.test.ts`, add immediately above the `describe("parseGold", ...)` line:

```typescript
// @lat: [[tests#Retrieval Eval Harness#Gold set parsing rejects malformed input]]
```

In `tests/eval-report.test.ts`, add immediately above the `describe("formatTable", ...)` line:

```typescript
// @lat: [[tests#Retrieval Eval Harness#Report table renders metrics and baseline deltas]]
```

- [ ] **Step 3: Add the narrative section to `lat.md/operations.md`**

Append at the end of `lat.md/operations.md`:

```markdown
## Retrieval Eval Harness

Standalone CLI (`scripts/eval.ts`, run via `tsx`) that measures retrieval quality — Recall@k (k = 3, 5, 8) and MRR — of the wiki query pipeline against a fixed `question → gold page` gold set, reporting per layer (seed, union) and per config (dense, jaccard). Distinct from the answer-quality evaluator ([[src/phases/evaluator.ts#runEvaluator]]), which scores the LLM answer.

It runs against a real vault on disk: it mirrors the seed-selection + BFS block of [[src/phases/query.ts]] ("approach A" — same public functions, no `runQuery`), calling [[src/wiki-seeds.ts#selectSeeds]] / [[src/page-similarity.ts#PageSimilarityService#selectRelevantScored]] for seeds and [[src/wiki-graph.ts#bfsExpandRanked]] for the union layer. Because `src/page-similarity.ts` imports `requestUrl` from the type-only `obsidian` package, the harness aliases `obsidian` to `scripts/obsidian-shim.ts` (a `fetch`-based `requestUrl`) via `scripts/tsconfig.eval.json`.

Run: `npm run eval -- --vault <path> --gold <gold.json> [--config dense|jaccard] [--bfs-depth N] [--top-k N] [--out run.json] [--baseline run.json]`. Dense mode reads embedding `model`/`dimensions` from the cache header and `baseUrl`/`apiKey` from `EVAL_EMBED_BASE_URL`/`EVAL_EMBED_API_KEY` (key optional); with no endpoint it logs a warning and falls back to jaccard. Gold sets live in `scripts/eval/` and are vault-specific. Metric/report specs: [[tests#Retrieval Eval Harness]].
```

- [ ] **Step 4: Re-run the new tests (refs are comments — must still pass)**

Run: `npx vitest run tests/eval-metrics.test.ts tests/eval-gold.test.ts tests/eval-report.test.ts`
Expected: PASS.

- [ ] **Step 5: Run `lat check`**

Run: `lat check`
Expected: no errors — all wiki links and code refs resolve, and every new `tests.md` leaf is covered by a `@lat:` comment. Fix any reported broken ref (e.g. a mistyped section path or a `[[src/...]]` symbol that doesn't exist) before committing.

- [ ] **Step 6: Commit**

```bash
git add lat.md/tests.md lat.md/operations.md tests/eval-metrics.test.ts tests/eval-gold.test.ts tests/eval-report.test.ts
git commit -m "docs(lat): document eval harness + tie metric specs to tests"
```

---

## Done-when mapping (from the spec/intent)

- **Recall@k / MRR are real numbers, two configs comparable, delta visible** → Tasks 2–3 (metrics), 6 (report + delta), 9 (CLI wiring), 11 (live run + `--baseline` delta).
- **Ship gate** — tests pass / `lint`+`tsc` clean on touched files / Health Metrics intact → Task 11 steps 1–2. `src/` is untouched (harness is additive in `scripts/`, `tests/`, `scripts/eval/`), so the Query hot path, token budget, latency, and offline-jaccard-keyless metrics are structurally preserved.
- **Observable outcome** — before/after on a fixed set, hybrid vs baseline improvement → Task 11 steps 4–5 (`--out` then `--baseline`; dense vs jaccard). Tier 2 hybrid/rerank configs drop into the registry (Task 5) later as one record each.

## Health-metric guardrails (must not degrade)

- **Offline Jaccard works keyless** → `--config jaccard` constructs `PageSimilarityService({mode:"jaccard"})`, no `baseUrl`/`apiKey`, no network (Task 8). Verified keyless in Task 11 step 3.
- **Query token budget / latency unchanged** → no `src/` edits; the harness never imports or calls `runQuery`.
- **Existing suite green, no new `tsc` errors in touched files, `lint` clean** → Task 11 steps 1–2; harness files live outside `src/**` (the `lint` glob and the mobile/no-fs guard tests only scan `src/`).
