---
review:
  plan_hash: a6c81dfaa9fd2d12
  spec_hash: c79f21787a61abc3
  last_run: 2026-05-15
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Phase E — Documentation / Task 10"
      text: "Spec Rollout Phase E требует «Add doc comment in bfsExpand noting undirected behavior» — план только обновляет CLAUDE.md, doc-comment в bfsExpand не добавлен."
      verdict: fixed
      verdict_at: 2026-05-15
    - id: F-002
      phase: verifiability
      severity: WARNING
      section: "Phase D — Invalidation / Task 9, Step 1–2"
      text: "Тест 'invalidates GraphCache after a successful write' напрямую вызывает graphCache.invalidate('work'), не запуская dispatch контроллера. Не верифицирует хук в controller.ts (Step 3). Spec требует: «write operation triggers graphCache.invalidate»."
      verdict: fixed
      verdict_at: 2026-05-15
---

# Graph Cache, Smarter Seeds, Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-memory `GraphCache`, content-aware `selectSeeds`, and `graph_stats` RunEvent to make graph-aware query/lint observable, cacheable, and recall-aware on RU content.

**Architecture:** Two new pure modules (`wiki-graph-cache.ts`, `wiki-seeds.ts`); `query.ts` + `lint.ts` consume the cache; `query.ts` replaces inline `keywordSeeds` with `selectSeeds` and emits `graph_stats`; `controller.ts` invalidates cache after writes; `view.ts` renders the stats line; settings/i18n gain `seedTopK` + `seedMinScore`.

**Tech Stack:** TypeScript, vitest, esbuild, Obsidian API. No new runtime deps.

**Spec:** `docs/superpowers/specs/2026-05-15-graph-cache-seeds-visibility-design.md`

---

## File Structure

| Action | Path | Role |
|---|---|---|
| Create | `src/wiki-graph-cache.ts` | `GraphCache` class + singleton, hash-keyed per-domain |
| Create | `src/wiki-seeds.ts` | `tokenize`, `scoreSeed`, `selectSeeds`, `STOP_WORDS` |
| Modify | `src/types.ts` | `seedTopK`, `seedMinScore` in settings; `graph_stats` in `RunEvent` |
| Modify | `src/phases/query.ts` | Use `graphCache.get` + `selectSeeds`; emit `graph_stats`; drop `keywordSeeds` |
| Modify | `src/phases/lint.ts` | Use `graphCache.get` instead of `buildWikiGraph` |
| Modify | `src/agent-runner.ts` | Propagate `seedTopK`, `seedMinScore` into `runQuery` |
| Modify | `src/controller.ts` | Invalidate cache after successful wiki writes |
| Modify | `src/view.ts` | Render `graph_stats` event |
| Modify | `src/settings.ts` | Two new number inputs (Graph section) |
| Modify | `src/i18n.ts` | EN/RU/ES strings for new settings |
| Create | `tests/wiki-graph-cache.test.ts` | Unit tests for cache |
| Create | `tests/wiki-seeds.test.ts` | Unit tests for tokenize/score/select |
| Modify | `tests/phases/query.test.ts` | New seed/BFS/event coverage |
| Modify | `tests/phases/lint.test.ts` | Second call hits cache |
| Create | `tests/controller-cache-invalidation.test.ts` | Controller dispatch triggers `graphCache.invalidate` |
| Modify | `src/wiki-graph.ts` | Doc-comment на `bfsExpand` (undirected) |
| Modify | `CLAUDE.md` | Phase-E doc updates |

---

## Phase A — Foundation (behavior-neutral additions)

### Task 1: `GraphCache` module

**Files:**
- Create: `src/wiki-graph-cache.ts`
- Test: `tests/wiki-graph-cache.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/wiki-graph-cache.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from "vitest";
import { GraphCache } from "../src/wiki-graph-cache";

function pages(entries: [string, string][]): Map<string, string> {
  return new Map(entries);
}

describe("GraphCache", () => {
  let cache: GraphCache;
  beforeEach(() => { cache = new GraphCache(); });

  it("returns fromCache=false on first get", () => {
    const r = cache.get("d1", pages([["a.md", "x"]]));
    expect(r.fromCache).toBe(false);
    expect(r.graph.has("a")).toBe(true);
  });

  it("returns fromCache=true on second get with same pages", () => {
    const p = pages([["a.md", "x"]]);
    cache.get("d1", p);
    const r = cache.get("d1", p);
    expect(r.fromCache).toBe(true);
  });

  it("rebuilds after invalidate", () => {
    const p = pages([["a.md", "x"]]);
    cache.get("d1", p);
    cache.invalidate("d1");
    expect(cache.get("d1", p).fromCache).toBe(false);
  });

  it("rebuilds when page content length changes", () => {
    cache.get("d1", pages([["a.md", "x"]]));
    const r = cache.get("d1", pages([["a.md", "xx"]]));
    expect(r.fromCache).toBe(false);
  });

  it("rebuilds when pages added", () => {
    cache.get("d1", pages([["a.md", "x"]]));
    const r = cache.get("d1", pages([["a.md", "x"], ["b.md", "y"]]));
    expect(r.fromCache).toBe(false);
  });

  it("rebuilds when pages removed", () => {
    cache.get("d1", pages([["a.md", "x"], ["b.md", "y"]]));
    const r = cache.get("d1", pages([["a.md", "x"]]));
    expect(r.fromCache).toBe(false);
  });

  it("clear empties all entries", () => {
    const p = pages([["a.md", "x"]]);
    cache.get("d1", p);
    cache.clear();
    expect(cache.get("d1", p).fromCache).toBe(false);
  });

  it("different domainIds do not collide", () => {
    const p = pages([["a.md", "x"]]);
    cache.get("d1", p);
    expect(cache.get("d2", p).fromCache).toBe(false);
  });

  it("invalidate of missing key is a no-op", () => {
    expect(() => cache.invalidate("missing")).not.toThrow();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/wiki-graph-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `GraphCache`**

`src/wiki-graph-cache.ts`:

```typescript
import { buildWikiGraph, type WikiGraph } from "./wiki-graph";

type CacheEntry = { hash: string; graph: WikiGraph };

function hashPages(pages: Map<string, string>): string {
  const parts: string[] = [];
  const keys = [...pages.keys()].sort();
  for (const k of keys) parts.push(`${k}:${pages.get(k)!.length}`);
  return parts.join("|");
}

export class GraphCache {
  private store = new Map<string, CacheEntry>();

  get(domainId: string, pages: Map<string, string>): { graph: WikiGraph; fromCache: boolean } {
    const hash = hashPages(pages);
    const hit = this.store.get(domainId);
    if (hit && hit.hash === hash) return { graph: hit.graph, fromCache: true };
    const graph = buildWikiGraph(pages);
    this.store.set(domainId, { hash, graph });
    return { graph, fromCache: false };
  }

  invalidate(domainId: string): void {
    this.store.delete(domainId);
  }

  clear(): void {
    this.store.clear();
  }
}

export const graphCache = new GraphCache();
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/wiki-graph-cache.test.ts`
Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-graph-cache.ts tests/wiki-graph-cache.test.ts
git commit -m "feat(graph): add in-memory GraphCache keyed by domain + page-length hash"
```

---

### Task 2: `wiki-seeds` module

**Files:**
- Create: `src/wiki-seeds.ts`
- Test: `tests/wiki-seeds.test.ts`

- [ ] **Step 1: Write failing tests**

`tests/wiki-seeds.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { tokenize, scoreSeed, selectSeeds } from "../src/wiki-seeds";

describe("tokenize", () => {
  it("lowercases and splits on non-word", () => {
    expect([...tokenize("Hello, World!")]).toEqual(["hello", "world"]);
  });

  it("drops tokens of length <= 2", () => {
    expect([...tokenize("ab cd efg")]).toEqual(["efg"]);
  });

  it("drops english stop-words", () => {
    expect([...tokenize("the quick brown fox")]).toEqual(["quick", "brown", "fox"]);
  });

  it("drops russian stop-words", () => {
    expect([...tokenize("что такое нейронная сеть")]).toEqual(["такое", "нейронная", "сеть"]);
  });

  it("returns empty set on empty string", () => {
    expect(tokenize("").size).toBe(0);
  });

  it("handles mixed RU + EN", () => {
    const t = tokenize("Машинное обучение neural network");
    expect(t.has("машинное")).toBe(true);
    expect(t.has("neural")).toBe(true);
  });
});

describe("scoreSeed", () => {
  it("returns 1 for identical token sets", () => {
    const q = tokenize("alpha beta");
    expect(scoreSeed(q, "alpha", "beta")).toBeCloseTo(1, 5);
  });

  it("returns 0 for disjoint sets", () => {
    const q = tokenize("alpha beta");
    expect(scoreSeed(q, "gamma", "delta")).toBe(0);
  });

  it("is in [0,1] range", () => {
    const q = tokenize("alpha beta gamma");
    const s = scoreSeed(q, "alpha", "delta epsilon");
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });

  it("returns 0 when question is empty", () => {
    expect(scoreSeed(new Set(), "alpha", "beta")).toBe(0);
  });
});

describe("selectSeeds", () => {
  const pages = new Map([
    ["wiki/Alpha.md", "alpha content here"],
    ["wiki/Beta.md", "beta unrelated"],
    ["wiki/Gamma.md", "gamma neural network details"],
  ]);

  it("respects topK", () => {
    const r = selectSeeds("alpha beta gamma", pages, 1, 0);
    expect(r.length).toBe(1);
  });

  it("filters by minScore", () => {
    const r = selectSeeds("alpha", pages, 10, 0.5);
    expect(r).toContain("Alpha");
    expect(r).not.toContain("Beta");
  });

  it("sorts by score descending", () => {
    const r = selectSeeds("alpha gamma neural", pages, 10, 0);
    expect(r[0]).toBe("Gamma");
  });

  it("returns [] when nothing passes threshold", () => {
    expect(selectSeeds("xyz", pages, 10, 0.5)).toEqual([]);
  });

  it("matches content-only references (not in pageId)", () => {
    const r = selectSeeds("neural network", pages, 10, 0);
    expect(r).toContain("Gamma");
  });

  it("caps content tokenization to first 200 chars", () => {
    const big = new Map([["wiki/Big.md", "irrelevant ".repeat(50) + "needle"]]);
    expect(selectSeeds("needle", big, 10, 0)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/wiki-seeds.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `wiki-seeds`**

`src/wiki-seeds.ts`:

```typescript
import { pageId } from "./wiki-graph";

const STOP_WORDS = new Set([
  // EN
  "the", "and", "for", "are", "was", "were", "with", "that", "this", "from",
  "have", "has", "had", "but", "not", "you", "your", "our", "their", "his",
  "her", "its", "into", "about", "what", "which", "when", "where", "how",
  // RU
  "что", "как", "для", "или", "это", "при", "без", "тот", "его", "она",
  "они", "был", "была", "быть", "тоже", "также", "если", "тогда", "потом",
  "когда", "очень", "более", "менее", "нет", "уже", "ещё", "еще",
]);

const CONTENT_CAP = 200;

export function tokenize(s: string): Set<string> {
  const out = new Set<string>();
  if (!s) return out;
  for (const raw of s.toLowerCase().split(/[\s\W]+/u)) {
    if (raw.length <= 2) continue;
    if (STOP_WORDS.has(raw)) continue;
    out.add(raw);
  }
  return out;
}

export function scoreSeed(
  questionTokens: Set<string>,
  pageIdValue: string,
  content: string,
): number {
  if (questionTokens.size === 0) return 0;
  const head = content.slice(0, CONTENT_CAP);
  const p = tokenize(pageIdValue);
  for (const t of tokenize(head)) p.add(t);
  if (p.size === 0) return 0;
  let inter = 0;
  for (const t of questionTokens) if (p.has(t)) inter++;
  const union = questionTokens.size + p.size - inter;
  return union === 0 ? 0 : inter / union;
}

export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
): string[] {
  const q = tokenize(question);
  if (q.size === 0) return [];
  const scored: { id: string; score: number }[] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    const score = scoreSeed(q, id, content);
    if (score >= minScore && score > 0) scored.push({ id, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK).map((x) => x.id);
}
```

- [ ] **Step 4: Run tests, verify they pass**

Run: `npx vitest run tests/wiki-seeds.test.ts`
Expected: PASS, 16/16.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-seeds.ts tests/wiki-seeds.test.ts
git commit -m "feat(graph): add content-aware selectSeeds with Jaccard scoring"
```

---

### Task 3: Extend `types.ts` with settings + `graph_stats` event

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add `seedTopK`, `seedMinScore` to `LlmWikiPluginSettings`**

In `src/types.ts`, locate `LlmWikiPluginSettings` interface. Add after `hubThreshold: number;` (currently line 123):

```typescript
  seedTopK: number;
  seedMinScore: number;
```

- [ ] **Step 2: Add defaults in `DEFAULT_SETTINGS`**

In `src/types.ts`, locate `DEFAULT_SETTINGS`. Add after `hubThreshold: 20,` (currently line 161):

```typescript
  seedTopK: 5,
  seedMinScore: 0.1,
```

- [ ] **Step 3: Add `graph_stats` to `RunEvent` union**

In `src/types.ts`, append before the closing `;` of the `RunEvent` union (after the `structural_error` member):

```typescript
  | {
      kind: "graph_stats";
      seeds: string[];
      expanded: number;
      total: number;
      fromCache: boolean;
    }
```

- [ ] **Step 4: Run type-check / build**

Run: `npm run build`
Expected: build succeeds. No call sites use these yet.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add seedTopK/seedMinScore settings + graph_stats RunEvent"
```

---

## Phase B — Integration

### Task 4: Wire `selectSeeds` + cache into `query.ts`, emit `graph_stats`

**Files:**
- Modify: `src/phases/query.ts`
- Test: `tests/phases/query.test.ts`

- [ ] **Step 1: Add failing test — `graph_stats` event emitted**

In `tests/phases/query.test.ts`, append a new test inside the `describe("runQuery", ...)` block:

```typescript
  it("emits graph_stats event with correct shape", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Alpha.md", "!Wiki/work/Beta.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("Alpha.md")) return "alpha content";
        if (p.endsWith("Beta.md")) return "beta [[Alpha]]";
        return "";
      }),
      exists: vi.fn().mockResolvedValue(true),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(["alpha"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.05),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats).toBeDefined();
    expect(stats.seeds).toContain("Alpha");
    expect(stats.total).toBe(2);
    expect(stats.expanded).toBeGreaterThanOrEqual(stats.seeds.length);
    expect(typeof stats.fromCache).toBe("boolean");
  });
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/phases/query.test.ts -t "graph_stats"`
Expected: FAIL — runQuery does not accept extra args / does not emit event.

- [ ] **Step 3: Modify `runQuery` signature + body**

In `src/phases/query.ts`:

a) Update imports:

```typescript
import { pageId, bfsExpand } from "../wiki-graph";
import { graphCache } from "../wiki-graph-cache";
import { selectSeeds } from "../wiki-seeds";
```

(remove `buildWikiGraph` from the wiki-graph import.)

b) Extend the `runQuery` signature — add two args after `opts`:

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
): AsyncGenerator<RunEvent> {
```

c) Replace the seed-selection block. Find:

```typescript
  // Graph-filtered context
  const graph = buildWikiGraph(pages);
  const allPageIds = [...pages.keys()].map(pageId);
  let seeds = keywordSeeds(question, pages);
```

Replace with:

```typescript
  // Graph-filtered context
  const { graph, fromCache } = graphCache.get(domain.id, pages);
  const allPageIds = [...pages.keys()].map(pageId);
  const topK = Math.max(1, Math.min(50, Math.floor(seedTopK)));
  const minScore = Math.max(0, Math.min(1, seedMinScore));
  let seeds = selectSeeds(question, pages, topK, minScore);
```

d) After `const selectedIds = bfsExpand(seeds, graph, graphDepth);` insert:

```typescript
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: pages.size, fromCache };
```

e) Delete the entire `keywordSeeds` function (currently lines 152–163).

- [ ] **Step 4: Run query tests, verify they pass**

Run: `npx vitest run tests/phases/query.test.ts`
Expected: PASS — existing tests still pass (defaults preserve behavior for content-keyword overlap), new `graph_stats` test passes.

Note: if pre-existing tests relied on the old substring-match behavior, adjust the fixture content so a Jaccard score > `seedMinScore` is achievable (e.g., make question tokens overlap with pageId or first 200 chars of content).

- [ ] **Step 5: Commit**

```bash
git add src/phases/query.ts tests/phases/query.test.ts
git commit -m "feat(query): use GraphCache + selectSeeds, emit graph_stats"
```

---

### Task 5: Wire cache into `lint.ts`

**Files:**
- Modify: `src/phases/lint.ts`
- Test: `tests/phases/lint.test.ts`

- [ ] **Step 1: Add failing test — second lint call hits cache**

In `tests/phases/lint.test.ts`, append (adapt to whichever describe block exists):

```typescript
  it("second runLint call hits GraphCache for the same domain", async () => {
    const { graphCache } = await import("../../src/wiki-graph-cache");
    graphCache.clear();
    // First call populates the cache via runLint; assert via direct probe.
    // (Integration probe — call cache directly after runLint finishes once.)
    // Setup adapter that returns one stable page
    const adapter = {
      read: vi.fn().mockResolvedValue("---\n---\n# X"),
      write: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/X.md"], folders: [] }),
      exists: vi.fn().mockResolvedValue(true),
      mkdir: vi.fn().mockResolvedValue(undefined),
    } as any;
    const vt = new (await import("../../src/vault-tools")).VaultTools(adapter, "/v");
    const llm = makeLlm("[]"); // reuse helper from this test file
    const dom = { id: "work", name: "Work", wiki_folder: "work", source_paths: [] };
    await collect(runLint([], vt, llm, "model", [dom], "/v", new AbortController().signal, 20, {}));
    const pages = new Map([["!Wiki/work/X.md", "---\n---\n# X"]]);
    expect(graphCache.get("work", pages).fromCache).toBe(true);
  });
```

(If `makeLlm` / `collect` / `runLint` import shapes differ in `lint.test.ts`, mirror that file's existing helpers.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/phases/lint.test.ts -t "GraphCache"`
Expected: FAIL — lint still calls `buildWikiGraph` directly, cache is empty.

- [ ] **Step 3: Modify `runLint`**

In `src/phases/lint.ts`:

a) Update imports:

```typescript
import { checkGraphStructure } from "../wiki-graph";
import { graphCache } from "../wiki-graph-cache";
```

(remove `buildWikiGraph` from the wiki-graph import.)

b) Replace:

```typescript
    const graph = buildWikiGraph(pages);
```

with:

```typescript
    const { graph } = graphCache.get(domain.id, pages);
```

- [ ] **Step 4: Run lint tests**

Run: `npx vitest run tests/phases/lint.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): consume GraphCache instead of rebuilding graph"
```

---

### Task 6: Propagate seed settings through `agent-runner.ts`

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Update `query` and `query-save` cases**

In `src/agent-runner.ts`, replace the two `runQuery` calls in `runOperation`:

Before:

```typescript
      case "query":
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts);
        break;
      case "query-save":
        yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts);
        break;
```

After:

```typescript
      case "query":
        yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore);
        break;
      case "query-save":
        yield* runQuery(req.args, true, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore);
        break;
```

- [ ] **Step 2: Run full suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add src/agent-runner.ts
git commit -m "refactor(agent-runner): plumb seedTopK/seedMinScore into runQuery"
```

---

### Task 7: Render `graph_stats` in `view.ts`

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Locate event handling in `appendEvent`**

`src/view.ts` near line 419 (end of `file_done` block, before `domain_created`).

- [ ] **Step 2: Insert handler**

Add before `if (ev.kind === "domain_created")`:

```typescript
    if (ev.kind === "graph_stats") {
      const cacheHint = ev.fromCache ? " (cache hit)" : "";
      const preview = ev.seeds.slice(0, 3).join(", ");
      const extra = ev.seeds.length > 3 ? `, …+${ev.seeds.length - 3}` : "";
      const step = this.stepsEl.createDiv("ai-wiki-step");
      step.createSpan({ cls: "ai-wiki-step-icon" }).setText("🌐");
      step.createSpan({ cls: "ai-wiki-step-name" })
        .setText(`Граф: ${ev.seeds.length} seeds [${preview}${extra}] → ${ev.expanded} / ${ev.total} страниц${cacheHint}`);
      this.scrollSteps();
      return;
    }
```

- [ ] **Step 3: Build, verify**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): render graph_stats step (seeds + expansion + cache flag)"
```

---

## Phase C — Settings UI

### Task 8: Add settings fields + i18n strings

**Files:**
- Modify: `src/i18n.ts`
- Modify: `src/settings.ts`

- [ ] **Step 1: Add EN strings**

In `src/i18n.ts` after `hubThreshold_desc` (~line 79):

```typescript
    seedTopK_name: "Seed top-K",
    seedTopK_desc: "Maximum seed pages selected by keyword score (1–50).",
    seedMinScore_name: "Seed min score",
    seedMinScore_desc: "Minimum Jaccard score for a page to be considered a seed (0.0–1.0).",
```

- [ ] **Step 2: Add RU strings**

In `src/i18n.ts` after `hubThreshold_desc` in the RU block (~line 281):

```typescript
    seedTopK_name: "Seed top-K",
    seedTopK_desc: "Максимум seed-страниц по keyword-score (1–50).",
    seedMinScore_name: "Минимальный score seed",
    seedMinScore_desc: "Минимальный Jaccard score, чтобы страница попала в seeds (0.0–1.0).",
```

- [ ] **Step 3: Add ES strings**

In `src/i18n.ts` after `hubThreshold_desc` in the ES block (~line 481):

```typescript
    seedTopK_name: "Top-K semillas",
    seedTopK_desc: "Máximo de páginas semilla por puntuación de palabras clave (1–50).",
    seedMinScore_name: "Puntuación mínima semilla",
    seedMinScore_desc: "Puntuación Jaccard mínima para considerar una página como semilla (0.0–1.0).",
```

- [ ] **Step 4: Add UI fields**

In `src/settings.ts` after the `hubThreshold` setting (currently ends at line 466), insert:

```typescript
    new Setting(containerEl)
      .setName(T.settings.seedTopK_name)
      .setDesc(T.settings.seedTopK_desc)
      .addText((t) =>
        t.setPlaceholder("5")
          .setValue(String(s.seedTopK))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isInteger(n) && n >= 1 && n <= 50) {
              s.seedTopK = n;
              await this.plugin.saveSettings();
            }
          }),
      );

    new Setting(containerEl)
      .setName(T.settings.seedMinScore_name)
      .setDesc(T.settings.seedMinScore_desc)
      .addText((t) =>
        t.setPlaceholder("0.1")
          .setValue(String(s.seedMinScore))
          .onChange(async (v) => {
            const n = Number(v);
            if (Number.isFinite(n) && n >= 0 && n <= 1) {
              s.seedMinScore = n;
              await this.plugin.saveSettings();
            }
          }),
      );
```

- [ ] **Step 5: Build + run tests**

Run: `npm run build && npm test`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add src/i18n.ts src/settings.ts
git commit -m "feat(settings): seedTopK + seedMinScore UI fields (en/ru/es)"
```

---

## Phase D — Invalidation

### Task 9: Invalidate cache after wiki writes

**Files:**
- Modify: `src/controller.ts`
- Test: `tests/agent-runner.integration.test.ts`

- [ ] **Step 1: Add failing test — controller dispatch invalidates cache**

Create `tests/controller-cache-invalidation.test.ts` (mirror helpers from `tests/controller-format.test.ts`):

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { WikiController } from "../src/controller";
import { graphCache } from "../src/wiki-graph-cache";
import type { DomainEntry } from "../src/domain";

function makeApp() {
  return {
    vault: {
      adapter: {
        getBasePath: () => "/tmp/vault",
        getFullPath: (p: string) => `/tmp/vault/${p}`,
        read: vi.fn().mockResolvedValue(""),
        write: vi.fn().mockResolvedValue(undefined),
        remove: vi.fn().mockResolvedValue(undefined),
        exists: vi.fn().mockResolvedValue(true),
      },
      configDir: ".obsidian",
      getName: () => "vault",
      getAbstractFileByPath: vi.fn().mockReturnValue(null),
      modify: vi.fn().mockResolvedValue(undefined),
    },
    workspace: {
      getLeavesOfType: () => [],
      getRightLeaf: () => null,
      revealLeaf: vi.fn(),
      getActiveFile: vi.fn().mockReturnValue({ path: "src/x.md", extension: "md", name: "x.md" }),
    },
  } as unknown as Parameters<typeof WikiController>[0];
}

function makePlugin(app: ReturnType<typeof makeApp>) {
  return {
    settings: { backend: "native-agent", nativeAgent: { baseUrl: "https://api.x", apiKey: "k" } },
    saveSettings: vi.fn(),
    manifest: { dir: ".obsidian/plugins/ai-wiki", id: "ai-wiki" },
    app,
  } as unknown as Parameters<typeof WikiController>[1];
}

function makeDomainStore(domains: DomainEntry[]) {
  return { load: vi.fn().mockResolvedValue(domains) } as never;
}

describe("WikiController cache invalidation", () => {
  beforeEach(() => graphCache.clear());

  it("invalidates GraphCache after a successful ingest", async () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const dom: DomainEntry = { id: "work", name: "Work", wiki_folder: "work", source_paths: ["src"] };
    const ctrl = new WikiController(app, plugin, makeDomainStore([dom]));
    // Stub agent-runner so dispatch completes "done" without real LLM.
    const runSpy = vi.spyOn(ctrl as never, "runWithRunner" as never)
      .mockImplementation(async function* () { /* empty -> status=done */ });
    const invSpy = vi.spyOn(graphCache, "invalidate");

    await ctrl.ingestActive("work");

    expect(invSpy).toHaveBeenCalledWith("work");
    runSpy.mockRestore();
  });

  it("does not invalidate after a read-only query", async () => {
    const app = makeApp();
    const plugin = makePlugin(app);
    const dom: DomainEntry = { id: "work", name: "Work", wiki_folder: "work", source_paths: [] };
    const ctrl = new WikiController(app, plugin, makeDomainStore([dom]));
    vi.spyOn(ctrl as never, "runWithRunner" as never)
      .mockImplementation(async function* () { /* empty */ });
    const invSpy = vi.spyOn(graphCache, "invalidate");

    await ctrl.query("q", false, "work");

    expect(invSpy).not.toHaveBeenCalled();
  });
});
```

(If `runWithRunner` is not the actual private method name, replace with whichever method the dispatch calls into to stream events — mirror `controller-format.test.ts` mocking pattern. Goal: bypass real LLM, let dispatch reach the post-run hook with `status === "done"`.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/controller-cache-invalidation.test.ts`
Expected: FAIL — `invSpy` not called; controller has no invalidation hook yet.

- [ ] **Step 3: Wire invalidation into `controller.ts` dispatch**

In `src/controller.ts`:

a) Add import near other src imports (top of file):

```typescript
import { graphCache } from "./wiki-graph-cache";
```

b) Locate the `dispatch` method's run loop. After the `for await (const ev of runGen)` loop ends and `status` is known, insert (around line 604, just before the `await this.logEvent(..., "finish ...")` call):

```typescript
    // Invalidate graph cache when operation may have mutated wiki pages.
    if (status === "done") {
      const mutatesWiki = op === "ingest" || op === "lint" || op === "query-save" || op === "init";
      if (mutatesWiki) {
        const targets = domainId ? [domainId] : (await this.domainStore.load()).map((d) => d.id);
        for (const id of targets) graphCache.invalidate(id);
      }
    }
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/controller.ts tests/controller-cache-invalidation.test.ts
git commit -m "feat(controller): invalidate GraphCache after wiki-mutating ops"
```

---

## Phase E — Documentation

### Task 10: Update `CLAUDE.md` + bfsExpand doc-comment

**Files:**
- Modify: `CLAUDE.md`
- Modify: `src/wiki-graph.ts`

- [ ] **Step 0: Add doc-comment to `bfsExpand`**

В `src/wiki-graph.ts` над строкой `export function bfsExpand(...)` вставить:

```typescript
/**
 * BFS-expansion seeds → set of reachable pageIds within `depth` hops.
 * Graph is treated as **undirected**: edge `A → B` lets BFS traverse `B → A` too.
 * Rationale: wiki backlinks are symmetric in user mental model — a page referenced
 * by a seed should also be considered context, regardless of which direction the
 * `[[link]]` was authored. Seeds not present in the graph are silently skipped.
 */
```

- [ ] **Step 1: Extend the "Ключевые файлы" table**

Add two rows after `src/wiki-graph.ts` row (or insert into the table in the right place):

```markdown
| `src/wiki-graph-cache.ts` | GraphCache — in-memory, per-domain, hash-keyed; invalidated by controller after writes |
| `src/wiki-seeds.ts` | `selectSeeds()` — Jaccard на токенах pageId + первые 200 символов контента |
```

- [ ] **Step 2: Add note in "Поток выполнения" block**

After `→ phase (ingest/query/…)` line, append a parenthetical: `(query/lint используют graphCache.get; query вызывает selectSeeds и эмитит graph_stats)`.

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md src/wiki-graph.ts
git commit -m "docs: GraphCache + wiki-seeds in CLAUDE.md, undirected note on bfsExpand"
```

---

## Final Verification

- [ ] **Step 1: Full build + test**

Run: `npm run build && npm test`
Expected: build succeeds; all tests pass.

- [ ] **Step 2: Manual smoke (optional, if vault available)**

In Obsidian dev instance: trigger `query`, observe new "Граф: N seeds … (cache hit)" step on second run; trigger `ingest`, observe cache hint disappears on next query.

- [ ] **Step 3: Mark spec as implemented**

Edit `docs/superpowers/specs/2026-05-15-graph-cache-seeds-visibility-design.md` frontmatter — add note or status flip if project convention requires.

---

## Notes for the Implementer

- Default `seedTopK=5`, `seedMinScore=0.1` preserve near-current behavior; spec section "Backward compatibility" explains the precision/recall trade.
- `selectSeeds` returning `[]` falls through to the existing `llmSelectSeeds` → `allPageIds` chain in `query.ts`; do not remove that fallback.
- `graphCache` is a module singleton. Tests must call `graphCache.clear()` in `beforeEach` if they touch the global instance to avoid cross-test leakage.
- All new code is pure TypeScript without Obsidian-specific APIs except in `view.ts` / `settings.ts`. Keeps tests fast.
