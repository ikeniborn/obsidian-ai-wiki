---
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-02-bfs-scope-phantom-fix-design.md
review:
  plan_hash: 10bd9cafba6d5eca
  spec_hash: e167046383a07912
  last_run: 2026-06-02
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
      section: "## Task 4"
      section_hash: 4e3accb1fa121902
      text: "Task 4 (lat.md docs update) has no corresponding requirement in spec ## Scope — not listed in scope or out-of-scope explicitly"
      verdict: accepted
      verdict_at: 2026-06-02
---

# BFS Scope and Phantom Node Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs in BFS traversal: phantom nodes (dangling `[[links]]` leaking into `expanded`) and fragile `_config` exclusion (filename-only filter misses future files).

**Architecture:** Two surgical one-liner fixes — one `graph.has()` guard in both BFS loops in `src/wiki-graph.ts`, one path-segment check added to the filter in `src/phases/query.ts`. No new abstractions.

**Tech Stack:** TypeScript, Vitest

---

## File Map

| File | Change |
|------|--------|
| `src/wiki-graph.ts` | Add `&& graph.has(neighbor)` to forward-traversal loops in `bfsExpand` (line 50) and `bfsExpandWithHops` (line 93) |
| `src/phases/query.ts` | Add `&& !f.includes("/_config/")` to file filter (line 99) |
| `tests/wiki-graph.test.ts` | Add two tests: phantom guard in `bfsExpand`, phantom guard in `bfsExpandWithHops` |
| `tests/phases/query.test.ts` | Add one test: `_config/` files excluded from BFS graph |

---

## Task 1: Phantom node guard in `bfsExpand`

**Files:**
- Modify: `src/wiki-graph.ts:49-51`
- Test: `tests/wiki-graph.test.ts`

- [ ] **Step 1: Write the failing test**

Open `tests/wiki-graph.test.ts` and add inside the existing `describe("bfsExpand", ...)` block, after the last existing test:

```ts
it("does not include phantom nodes (dangling links with no graph key) in BFS results", () => {
  // A links to Ghost which has no graph entry
  const graph = new Map([
    ["A", new Set(["B", "Ghost"])],
    ["B", new Set<string>()],
  ]);
  const result = bfsExpand(["A"], graph, 1);
  expect(result.has("Ghost")).toBe(false);
  expect(result.has("B")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/wiki-graph.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `expect(result.has("Ghost")).toBe(false)` fails (currently `Ghost` is included).

- [ ] **Step 3: Apply the fix in `bfsExpand`**

In `src/wiki-graph.ts`, find the forward-traversal loop inside `bfsExpand` (around line 49-51):

```ts
// Before:
for (const neighbor of graph.get(node) ?? []) {
  if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
}
```

Replace with:

```ts
// After:
for (const neighbor of graph.get(node) ?? []) {
  if (!visited.has(neighbor) && graph.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
}
```

The backlink loop (reverse index) is unchanged — it already yields only real nodes.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/wiki-graph.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PASS — new test passes, all existing tests still pass.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-graph.ts tests/wiki-graph.test.ts
git commit -m "fix(bfs): guard phantom nodes in bfsExpand forward traversal"
```

---

## Task 2: Phantom node guard in `bfsExpandWithHops`

**Files:**
- Modify: `src/wiki-graph.ts:92-94`
- Test: `tests/wiki-graph.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe("bfsExpandWithHops", ...)` block in `tests/wiki-graph.test.ts`, after the last existing test:

```ts
it("does not include phantom nodes (dangling links with no graph key) in expanded or byHop", () => {
  // A links to Ghost which has no graph entry
  const graph = new Map([
    ["A", new Set(["B", "Ghost"])],
    ["B", new Set<string>()],
  ]);
  const { expanded, byHop } = bfsExpandWithHops(["A"], graph, 1);
  expect(expanded.has("Ghost")).toBe(false);
  expect(byHop[1]).not.toContain("Ghost");
  expect(expanded.has("B")).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/wiki-graph.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `Ghost` is currently included in `expanded`.

- [ ] **Step 3: Apply the fix in `bfsExpandWithHops`**

In `src/wiki-graph.ts`, find the forward-traversal loop inside `bfsExpandWithHops` (around line 92-94):

```ts
// Before:
for (const neighbor of graph.get(node) ?? []) {
  if (!visited.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
}
```

Replace with:

```ts
// After:
for (const neighbor of graph.get(node) ?? []) {
  if (!visited.has(neighbor) && graph.has(neighbor)) { visited.add(neighbor); next.add(neighbor); }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/wiki-graph.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PASS — new test passes, all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-graph.ts tests/wiki-graph.test.ts
git commit -m "fix(bfs): guard phantom nodes in bfsExpandWithHops forward traversal"
```

---

## Task 3: `_config` directory path exclusion

**Files:**
- Modify: `src/phases/query.ts:99`
- Test: `tests/phases/query.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside the existing `describe("runQuery", ...)` block in `tests/phases/query.test.ts`, after the last existing test:

```ts
it("excludes files under _config/ directory from BFS graph", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({
      files: [
        "!Wiki/work/Page.md",
        "!Wiki/work/_config/_index.md",
        "!Wiki/work/_config/future-config.md",
      ],
      folders: [],
    }),
    read: vi.fn().mockImplementation(async (p: string) => {
      if (p.endsWith("_index.md")) return "- [[Page]] Page.md — content";
      if (p.endsWith("Page.md")) return "# Page\nContent.";
      if (p.endsWith("future-config.md")) return "# Config\nConfig file.";
      return "";
    }),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const events = await collect(
    runQuery(["content"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  const stats = events.find((e: any) => e.kind === "graph_stats") as any;
  expect(stats).toBeDefined();
  // _config/ files must not appear in the total page count sent to graph
  expect(stats.total).toBe(1); // only Page.md
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/phases/query.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `stats.total` is currently 2 (includes `future-config.md`).

- [ ] **Step 3: Apply the fix in `query.ts`**

In `src/phases/query.ts`, find line 99:

```ts
// Before:
const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
```

Replace with:

```ts
// After:
const files = allFiles.filter(
  (f) => !META_FILES.some((m) => f.endsWith(m)) && !f.includes("/_config/"),
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/phases/query.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PASS — new test passes, all existing tests pass.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query.ts tests/phases/query.test.ts
git commit -m "fix(query): exclude _config/ directory from BFS graph file list"
```

---

## Task 4: Update lat.md documentation

**Files:**
- Modify: `lat.md/operations.md` (BFS Expansion section)

- [ ] **Step 1: Update BFS Expansion section**

In `lat.md/operations.md`, find the `### BFS Expansion` section (lines ~88-94) and append a sentence about the phantom guard:

```markdown
### BFS Expansion

BFS always runs from the seed set — both when seeds come from similarity and from Jaccard. All wiki pages are read to build the graph; only BFS-expanded pages are passed to the LLM. The graph is undirected — `A → [[B]]` allows traversal B→A.

`bfsExpandWithHops` produces `expandedByHop: Record<number, string[]>` — pages by BFS depth — for tracing. Both `seedScores` and `expandedByHop` are emitted in the `graph_stats` event.

Forward traversal guards against phantom nodes: `[[links]]` whose targets have no corresponding page are never added to `expanded` or `byHop`. Files under any `_config/` subdirectory are excluded before graph construction.

See [[src/wiki-graph.ts#bfsExpandWithHops]], [[wiki-graph#Query Graph Traversal]].
```

- [ ] **Step 2: Run lat check**

```bash
lat check 2>&1 | tail -30
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lat.md/operations.md
git commit -m "docs(lat): document phantom node guard and _config exclusion in BFS Expansion"
```
