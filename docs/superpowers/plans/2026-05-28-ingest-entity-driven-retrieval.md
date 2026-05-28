---
review:
  plan_hash: ba7946672c93d317
  spec_hash: 4e056974150d5a05
  last_run: 2026-05-28
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: warning
      section: "Task 9 / Step 5e"
      section_hash: 61d05e69bbeb8e28
      verdict: fixed
      text: |
        Plan inserted `const threshold = 5;  // TODO read from effective settings if exposed; see step 9 below` as intermediate code. Project rule forbids `TODO`/`TBD`/`FIXME` placeholders in plan body.
      resolution: |
        Replaced with `const threshold = opts.mergeDeleteWarnThreshold ?? 5;` directly. The `LlmCallOptions.mergeDeleteWarnThreshold` field and the `AgentRunner` wiring are added in Task 6 Step 3a/3b before Task 9 runs, so the field is available at the call site without a TODO.
    - id: F-002
      phase: verifiability
      severity: warning
      section: "Task 9 / Step 5"
      section_hash: 61d05e69bbeb8e28
      verdict: fixed
      text: |
        Step 5 of Task 9 contained 12 sub-steps that together rewrote `runIngest`. Single step ≫ 2–5 min budget required by writing-plans skill.
      resolution: |
        Split into atomic sub-steps 5a–5g: 5a imports, 5b `buildExtractMessages`, 5c existing-pages block replacement, 5d `buildIngestMessages` extension, 5e delete loop, 5f summary computation + `buildIngestSummary` rewrite, 5g source-backlink rewrite with `deletedStems` filter and `written ∪ deletedPaths` guard.
    - id: F-003
      phase: structure
      severity: warning
      section: "Task 9 / Step 5 / sub-step 12"
      section_hash: 61d05e69bbeb8e28
      verdict: fixed
      text: |
        Exploratory instruction: `Grep "structuredRetries:" src/agent-runner.ts` + "mirror the access pattern used for `relevantPagesTopK`" — no concrete code patch.
      resolution: |
        Moved to Task 6 Step 3b with concrete edit: file path `src/agent-runner.ts`, line range 31–45, exact before/after snippets for all three `opts: { ... }` literals plus the new `const mergeDeleteWarnThreshold = s.nativeAgent.mergeDeleteWarnThreshold;` line.
    - id: F-004
      phase: structure
      severity: warning
      section: "Task 9 / Step 5 / sub-step 11"
      section_hash: 61d05e69bbeb8e28
      verdict: fixed
      text: |
        "Inside that block, also append the log even if `written.length === 0` (when `deletedPaths` is non-empty)." — description without exact code.
      resolution: |
        Task 9 Step 5g now contains the literal replacement code for lines 241–271 of `src/phases/ingest.ts`: full `if (written.length > 0 || deletedPaths.length > 0) { … }` block with `if (logEntries.length > 0) await appendWikiLog(...)` log guard and `deletedStems`-filtered `existingArticles`.
    - id: F-005
      phase: structure
      severity: warning
      section: "Task 6 / Step 1"
      section_hash: 55afd2de0a39a97a
      verdict: fixed
      text: |
        Test snippet relied on `createMockPlugin` and `DEFAULT_NATIVE` with caveat "Reuse … patterns already present in this test file. If they don't exist exactly, follow the helper style used by the other tests in the file".
      resolution: |
        Replaced with concrete test grounded in the actual `makePlugin(adapterImpl, manifestDir?)` helper at lines 4–9 of `tests/local-config.test.ts`. Uses `LocalConfigStore.save({iclaudePath: "", nativeAgent: {…}})` shape that matches the real `LocalConfig` interface. Adds a second compile-time test mirroring the existing `LocalConfig.claudeAgent effort field` style.
  sections:
    Task 1: 9fa5002401f71832
    Task 2: 2d1f33bf77a167e9
    Task 3: 400d5fe599646012
    Task 4: fd9fcd6b732d8287
    Task 5: cfc6930a38c66e44
    Task 6: 55afd2de0a39a97a
    Task 7: 70458abc0b32a3c0
    Task 8: f6bbd636bc34e0be
    Task 9: 61d05e69bbeb8e28
    Task 10: cfeb686fb392283c
    Task 11: 46025b64f1ced761
chain:
  intent: docs/superpowers/intents/2026-05-28-ingest-entity-driven-retrieval-intent.md
  spec: docs/superpowers/specs/2026-05-28-ingest-entity-driven-retrieval-design.md
---

# Ingest Entity-Driven Retrieval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace ingest's single-call `source → similarity → BFS → LLM` flow with a two-LLM-call entity-driven flow (extract entities → per-entity vector top-K → write/update/merge), removing BFS from ingest while preserving it for other phases.

**Architecture:** LLM #1 extracts entities from the source via a new prompt validated by `EntitiesOutputSchema`. `PageSimilarityService.selectByEntities` runs a batched vector top-K (Jaccard fallback) over `_index.md` annotations per entity. The union of per-entity top-K paths is passed to LLM #2 (extended `WikiPagesOutputSchema` with optional `deletes[]`), which emits creates/updates and optional merge-deletes. Delete loop strips removed pages from `_index.md` and rewrites local backlinks.

**Tech Stack:** TypeScript, Zod, Vitest, OpenAI-compatible SDK, Obsidian Plugin API. lat.md/ for project docs.

**Spec:** [`docs/superpowers/specs/2026-05-28-ingest-entity-driven-retrieval-design.md`](../specs/2026-05-28-ingest-entity-driven-retrieval-design.md)

**Note for the implementer:** Run tests with `npm test`. Run a single suite with `npm test -- tests/path/to/file.test.ts`. Run a single case with `npm test -- tests/path/to/file.test.ts -t "case name"`. After non-trivial changes, run `lat check` per project CLAUDE.md.

---

## Task 1: Extend zod-schemas — `EntitiesOutputSchema` + `deletes[]` on `WikiPagesOutputSchema`

**Files:**
- Modify: `src/phases/zod-schemas.ts`
- Test: `tests/phases/zod-schemas.test.ts`

- [ ] **Step 1: Write failing tests in `tests/phases/zod-schemas.test.ts`**

Append at end of file:

```ts
import { EntitiesOutputSchema } from "../../src/phases/zod-schemas";

describe("EntitiesOutputSchema", () => {
  it("accepts minimal entity", () => {
    const r = EntitiesOutputSchema.safeParse({
      reasoning: "ok",
      entities: [{ name: "Foo" }],
    });
    expect(r.success).toBe(true);
  });

  it("accepts entity with type and context_snippet", () => {
    const r = EntitiesOutputSchema.safeParse({
      reasoning: "ok",
      entities: [{ name: "Foo", type: "Concept", context_snippet: "Foo is a concept." }],
    });
    expect(r.success).toBe(true);
  });

  it("rejects empty name", () => {
    const r = EntitiesOutputSchema.safeParse({
      reasoning: "ok",
      entities: [{ name: "" }],
    });
    expect(r.success).toBe(false);
  });

  it("rejects entities array longer than 50", () => {
    const entities = Array.from({ length: 51 }, (_, i) => ({ name: `E${i}` }));
    const r = EntitiesOutputSchema.safeParse({ reasoning: "ok", entities });
    expect(r.success).toBe(false);
  });

  it("rejects missing reasoning", () => {
    const r = EntitiesOutputSchema.safeParse({ entities: [{ name: "Foo" }] });
    expect(r.success).toBe(false);
  });
});

describe("WikiPagesOutputSchema — deletes", () => {
  it("accepts optional deletes[]", () => {
    const r = WikiPagesOutputSchema.safeParse({
      reasoning: "merge",
      pages: [{ path: "!Wiki/d/e/New.md", content: "# New" }],
      deletes: [{ path: "!Wiki/d/e/Old.md" }],
    });
    expect(r.success).toBe(true);
    expect(r.data?.deletes).toHaveLength(1);
  });

  it("accepts response without deletes (backward compat)", () => {
    const r = WikiPagesOutputSchema.safeParse({
      reasoning: "ok",
      pages: [{ path: "!Wiki/d/e/A.md", content: "# A" }],
    });
    expect(r.success).toBe(true);
    expect(r.data?.deletes).toBeUndefined();
  });

  it("rejects deletes entry without path", () => {
    const r = WikiPagesOutputSchema.safeParse({
      reasoning: "merge",
      pages: [],
      deletes: [{}],
    });
    expect(r.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/phases/zod-schemas.test.ts`
Expected: FAIL with `EntitiesOutputSchema is not exported` and `deletes` cases failing.

- [ ] **Step 3: Update `src/phases/zod-schemas.ts`**

Add `EntitiesOutputSchema` and extend `WikiPagesOutputSchema`:

```ts
export const EntitiesOutputSchema = z.object({
  reasoning: z.string(),
  entities: z.array(z.object({
    name: z.string().min(1),
    type: z.string().optional(),
    context_snippet: z.string().optional(),
  })).max(50),
});

export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
  deletes: z.array(z.object({ path: z.string() })).optional(),
  entity_types_delta: z.array(EntityTypeSchema).optional(),
});

export type EntitiesOutput = z.infer<typeof EntitiesOutputSchema>;
```

The existing `WikiPagesOutput` type stays — `z.infer` picks the new field automatically.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/phases/zod-schemas.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/phases/zod-schemas.ts tests/phases/zod-schemas.test.ts
git commit -m "feat(ingest): add EntitiesOutputSchema and deletes[] on WikiPagesOutputSchema"
```

---

## Task 2: Add `ingest.entities` call site to `CallSite` union and `RunEvent`

**Files:**
- Modify: `src/phases/parse-with-retry.ts:13-18`
- Modify: `src/types.ts:70`

This task has no dedicated test — the union extension is a compile-time check. Tests added in later tasks exercise the new call site via runtime usage.

- [ ] **Step 1: Update `src/phases/parse-with-retry.ts` CallSite union**

Edit lines 13–18:

```ts
export type CallSite =
  | "init.bootstrap"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds"
  | "ingest.entities"
  | "ingest.pages"
  | "format.output";
```

- [ ] **Step 2: Update `src/types.ts` RunEvent.structural_error callSite**

Edit line 70 (inside the `structural_error` member of `RunEvent`):

```ts
      callSite: "init.bootstrap" | "init.delta" | "lint.patch" | "lint.fix" | "lint-chat.fix" | "query.seeds" | "ingest.entities" | "ingest.pages" | "format.output";
```

- [ ] **Step 3: Verify build passes**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/phases/parse-with-retry.ts src/types.ts
git commit -m "feat(ingest): register ingest.entities call site"
```

---

## Task 3: `PageSimilarityService.selectByEntities`

**Files:**
- Modify: `src/page-similarity.ts`
- Test: `tests/page-similarity.test.ts`

- [ ] **Step 1: Write failing tests in `tests/page-similarity.test.ts`**

Append at end of file:

```ts
import { vi } from "vitest";

describe("PageSimilarityService.selectByEntities (Jaccard mode)", () => {
  it("returns top-K paths per entity", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 2 });
    const annotations = new Map([
      ["Alpha", "neural network deep learning"],
      ["Beta",  "cooking recipes kitchen"],
      ["Gamma", "machine learning classification"],
    ]);
    const allPaths = [
      "!Wiki/d/x/Alpha.md",
      "!Wiki/d/x/Beta.md",
      "!Wiki/d/x/Gamma.md",
    ];
    const { results, allFailed } = await svc.selectByEntities(
      [
        { name: "Neural Nets", context_snippet: "deep learning" },
        { name: "Recipes", context_snippet: "cooking" },
      ],
      annotations,
      allPaths,
    );
    expect(allFailed).toBe(false);
    expect(results.size).toBe(2);
    expect(results.get("Neural Nets::")?.some((p) => p.includes("Alpha"))).toBe(true);
    expect(results.get("Recipes::")?.some((p) => p.includes("Beta"))).toBe(true);
  });

  it("returns empty array for entity with no annotation matches", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 5 });
    const annotations = new Map([["Alpha", "neural network"]]);
    const allPaths = ["!Wiki/d/x/Alpha.md"];
    const { results, allFailed } = await svc.selectByEntities(
      [{ name: "Completely Unrelated", context_snippet: "xyzzy plugh" }],
      annotations,
      allPaths,
    );
    expect(allFailed).toBe(false);
    expect(results.get("Completely Unrelated::")).toEqual([]);
  });

  it("uses type in key: `${name}::${type}`", async () => {
    const svc = new PageSimilarityService({ mode: "jaccard", topK: 1 });
    const { results } = await svc.selectByEntities(
      [{ name: "Foo", type: "Concept" }],
      new Map([["Foo", "Foo concept"]]),
      ["!Wiki/d/x/Foo.md"],
    );
    expect([...results.keys()]).toEqual(["Foo::Concept"]);
  });
});

describe("PageSimilarityService.selectByEntities (embedding mode)", () => {
  beforeEach(() => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn();
  });

  it("batches all entity queries in one HTTP call", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          { embedding: [1, 0, 0] },  // entity 1
          { embedding: [0, 1, 0] },  // entity 2
        ],
      }),
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    // Pre-seed cache with page vectors so we only fetch the entity queries.
    (svc as unknown as { cache: unknown }).cache = {
      model: "m", dimensions: 3,
      entries: {
        Alpha: { vector: encodeVector(new Float32Array([1, 0, 0])), hash: "x" },
        Beta:  { vector: encodeVector(new Float32Array([0, 1, 0])), hash: "x" },
      },
    };

    await svc.selectByEntities(
      [{ name: "Q1" }, { name: "Q2" }],
      new Map([["Alpha", "a"], ["Beta", "b"]]),
      ["!Wiki/d/x/Alpha.md", "!Wiki/d/x/Beta.md"],
    );

    // Exactly one POST to /embeddings carrying both entity query strings.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.input).toEqual(["Q1", "Q2"]);
  });

  it("ranks by cosine similarity per entity", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [1, 0, 0] }] }),
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;

    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    (svc as unknown as { cache: unknown }).cache = {
      model: "m", dimensions: 3,
      entries: {
        Alpha: { vector: encodeVector(new Float32Array([1, 0, 0])), hash: "x" },
        Beta:  { vector: encodeVector(new Float32Array([0, 1, 0])), hash: "x" },
      },
    };

    const { results } = await svc.selectByEntities(
      [{ name: "Q" }],
      new Map([["Alpha", "a"], ["Beta", "b"]]),
      ["!Wiki/d/x/Alpha.md", "!Wiki/d/x/Beta.md"],
    );
    expect(results.get("Q::")).toEqual(["!Wiki/d/x/Alpha.md"]);
  });

  it("falls back to Jaccard when embedding HTTP throws", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn().mockRejectedValue(new Error("network down"));
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const { results, allFailed } = await svc.selectByEntities(
      [{ name: "neural network" }],
      new Map([["Alpha", "neural network deep learning"]]),
      ["!Wiki/d/x/Alpha.md"],
    );
    expect(allFailed).toBe(false);
    expect(results.get("neural network::")).toEqual(["!Wiki/d/x/Alpha.md"]);
  });

  it("allFailed=true when annotations map is empty (no candidates at all)", async () => {
    (globalThis as unknown as { fetch: unknown }).fetch = vi.fn().mockRejectedValue(new Error("dead"));
    const svc = new PageSimilarityService({
      mode: "embedding", topK: 1, model: "m", dimensions: 3,
      baseUrl: "http://x", apiKey: "k",
    });
    const { results, allFailed } = await svc.selectByEntities(
      [{ name: "Q1" }, { name: "Q2" }],
      new Map(),
      [],
    );
    expect(allFailed).toBe(true);
    expect(results.get("Q1::")).toEqual([]);
    expect(results.get("Q2::")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/page-similarity.test.ts`
Expected: FAIL with `selectByEntities is not a function`.

- [ ] **Step 3: Implement `selectByEntities` in `src/page-similarity.ts`**

Add the new exported types and method to `PageSimilarityService` (place near `selectRelevant`):

```ts
export interface ExtractedEntity {
  name: string;
  type?: string;
  context_snippet?: string;
}

export interface EntityRetrievalResult {
  results: Map<string, string[]>;
  allFailed: boolean;
}

function entityKey(e: { name: string; type?: string }): string {
  return `${e.name}::${e.type ?? ""}`;
}

function entityQuery(e: ExtractedEntity): string {
  return [e.name, e.type, e.context_snippet].filter(Boolean).join(" — ");
}
```

Then add to `PageSimilarityService`:

```ts
async selectByEntities(
  entities: ExtractedEntity[],
  indexAnnotations: Map<string, string>,
  allPaths: string[],
): Promise<EntityRetrievalResult> {
  const results = new Map<string, string[]>();
  if (entities.length === 0) return { results, allFailed: false };

  if (this.config.mode === "jaccard") {
    let anySuccess = false;
    for (const e of entities) {
      const queryTokens = tokenize(entityQuery(e));
      const top = this.scoreJaccardOnce(queryTokens, indexAnnotations, allPaths);
      results.set(entityKey(e), top);
      if (indexAnnotations.size > 0) anySuccess = true;
    }
    return { results, allFailed: !anySuccess };
  }

  return this.selectByEntitiesEmbedding(entities, indexAnnotations, allPaths);
}

private scoreJaccardOnce(
  queryTokens: Set<string>,
  indexAnnotations: Map<string, string>,
  allPaths: string[],
): string[] {
  if (queryTokens.size === 0) return [];
  const scored: { path: string; score: number }[] = [];
  for (const path of allPaths) {
    const pid = pageId(path);
    const annotation = indexAnnotations.get(pid);
    if (!annotation) continue;
    const score = scoreSeed(queryTokens, pid, "", annotation);
    if (score > 0) scored.push({ path, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, this.config.topK).map((x) => x.path);
}

private async selectByEntitiesEmbedding(
  entities: ExtractedEntity[],
  indexAnnotations: Map<string, string>,
  allPaths: string[],
): Promise<EntityRetrievalResult> {
  const { baseUrl, apiKey, model, topK } = this.config;
  const results = new Map<string, string[]>();

  if (!baseUrl || !model) {
    // Mirror selectRelevant: degrade to Jaccard cleanly.
    let anySuccess = false;
    for (const e of entities) {
      const top = this.scoreJaccardOnce(tokenize(entityQuery(e)), indexAnnotations, allPaths);
      results.set(entityKey(e), top);
      if (indexAnnotations.size > 0) anySuccess = true;
    }
    return { results, allFailed: !anySuccess };
  }

  // 1) Batch-embed every entity query in one POST.
  let entityVecs: Float32Array[];
  try {
    entityVecs = await fetchEmbeddings(baseUrl, apiKey, model, entities.map(entityQuery));
  } catch {
    // Vector path dead → Jaccard fallback per entity.
    let anySuccess = false;
    for (const e of entities) {
      const top = this.scoreJaccardOnce(tokenize(entityQuery(e)), indexAnnotations, allPaths);
      results.set(entityKey(e), top);
      if (indexAnnotations.size > 0) anySuccess = true;
    }
    return { results, allFailed: !anySuccess };
  }

  // 2) Resolve page vectors from cache (and miss-embed in batches).
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
    if (!annotations[i]) continue;
    if (pageVecs.has(pids[i])) continue;
    cur.pids.push(pids[i]);
    cur.texts.push(annotations[i]);
    if (cur.pids.length >= EMBEDDING_BATCH_SIZE) {
      batches.push(cur);
      cur = { pids: [], texts: [] };
    }
  }
  if (cur.pids.length > 0) batches.push(cur);

  for (const batch of batches) {
    try {
      const vecs = await fetchEmbeddings(baseUrl, apiKey, model, batch.texts);
      for (let i = 0; i < batch.pids.length; i++) pageVecs.set(batch.pids[i], vecs[i]);
    } catch {
      // Batch-level Jaccard sentinel — matches selectRelevant behaviour.
      for (let i = 0; i < batch.pids.length; i++) {
        pageVecs.set(batch.pids[i], new Float32Array(0));
      }
    }
  }

  // 3) Score per-entity, top-K per entity.
  let anySuccess = false;
  for (let ei = 0; ei < entities.length; ei++) {
    const e = entities[ei];
    const queryVec = entityVecs[ei];
    const queryTokens = tokenize(entityQuery(e));
    const scored: { path: string; score: number }[] = [];
    for (let pi = 0; pi < allPaths.length; pi++) {
      const pid = pids[pi];
      const vec = pageVecs.get(pid);
      if (!vec) continue;
      const score = vec.length === 0
        ? scoreSeed(queryTokens, pid, "", annotations[pi])
        : cosine(queryVec, vec);
      if (score > 0) scored.push({ path: allPaths[pi], score });
    }
    scored.sort((a, b) => b.score - a.score);
    const top = scored.slice(0, topK).map((x) => x.path);
    results.set(entityKey(e), top);
    if (indexAnnotations.size > 0) anySuccess = true;
  }

  return { results, allFailed: !anySuccess };
}
```

Note: `tokenize`, `scoreSeed`, `pageId`, `cosine`, `fetchEmbeddings`, `EMBEDDING_BATCH_SIZE`, `decodeVector` are all already imported or declared in this file (see existing `selectEmbedding`). Reuse, do not duplicate.

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/page-similarity.test.ts`
Expected: PASS, all new and existing cases green.

- [ ] **Step 5: Commit**

```bash
git add src/page-similarity.ts tests/page-similarity.test.ts
git commit -m "feat(ingest): add PageSimilarityService.selectByEntities"
```

---

## Task 4: `removeIndexAnnotation` in `wiki-index.ts`

**Files:**
- Modify: `src/wiki-index.ts`
- Test: `tests/wiki-index.test.ts`

- [ ] **Step 1: Write failing tests in `tests/wiki-index.test.ts`**

Append at end of file:

```ts
import { removeIndexAnnotation } from "../src/wiki-index";

describe("removeIndexAnnotation", () => {
  it("strips matching entry line and leaves the section if other entries remain", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## entities",
      "- [[Alpha]] entities/Alpha.md — desc A",
      "- [[Beta]] entities/Beta.md — desc B",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await removeIndexAnnotation(vt, "!Wiki/work", "Alpha");
    expect(written()).not.toContain("[[Alpha]]");
    expect(written()).toContain("[[Beta]]");
    expect(written()).toContain("## entities");
  });

  it("removes the section header when last entry deleted", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## entities",
      "- [[Solo]] entities/Solo.md — only one",
      "",
      "## other",
      "- [[X]] other/X.md — keep",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await removeIndexAnnotation(vt, "!Wiki/work", "Solo");
    expect(written()).not.toContain("## entities");
    expect(written()).not.toContain("[[Solo]]");
    expect(written()).toContain("## other");
    expect(written()).toContain("[[X]]");
  });

  it("is a no-op when pid is absent", async () => {
    const initial = [
      "# Wiki Index",
      "",
      "## entities",
      "- [[Alpha]] entities/Alpha.md — desc",
    ].join("\n");
    const { vt, written } = makeVt(initial);
    await removeIndexAnnotation(vt, "!Wiki/work", "Missing");
    expect(written()).toBe(initial);
  });

  it("does not throw when index file is unreadable", async () => {
    const vt = throwVt();
    await expect(removeIndexAnnotation(vt, "!Wiki/work", "Anything")).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/wiki-index.test.ts`
Expected: FAIL with `removeIndexAnnotation is not a function`.

- [ ] **Step 3: Implement `removeIndexAnnotation` in `src/wiki-index.ts`**

Append below `upsertIndexAnnotation`:

```ts
export async function removeIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pid: string,
): Promise<void> {
  const indexPath = domainIndexPath(wikiFolder);
  let content = "";
  try { content = await vaultTools.read(indexPath); } catch { return; }

  const escaped = pid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pidRe = new RegExp(`^- \\[\\[${escaped}\\]\\]`);

  const lines = content.split("\n");
  const targetIdx = lines.findIndex((l) => pidRe.test(l));
  if (targetIdx === -1) return;

  // Drop the entry line.
  const without = [...lines.slice(0, targetIdx), ...lines.slice(targetIdx + 1)];

  // Find the section header above the removed line; remove it if no entries remain.
  let secIdx = -1;
  for (let i = targetIdx - 1; i >= 0; i--) {
    if (without[i]?.startsWith("## ")) { secIdx = i; break; }
  }
  if (secIdx !== -1) {
    const nextSec = without.findIndex((l, i) => i > secIdx && l.startsWith("## "));
    const end = nextSec === -1 ? without.length : nextSec;
    const hasEntries = without.slice(secIdx + 1, end).some((l) => l.startsWith("- "));
    if (!hasEntries) without.splice(secIdx, 1);
  }

  await vaultTools.write(indexPath, without.join("\n"));
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/wiki-index.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-index.ts tests/wiki-index.test.ts
git commit -m "feat(ingest): add removeIndexAnnotation for merge-delete cleanup"
```

---

## Task 5: `wiki-log` — add `"УДАЛЕНА"` action

**Files:**
- Modify: `src/wiki-log.ts`
- Test: `tests/wiki-log.test.ts`

- [ ] **Step 1: Write failing test in `tests/wiki-log.test.ts`**

Append (mirror existing test style):

```ts
import { appendWikiLog } from "../src/wiki-log";

describe("appendWikiLog — УДАЛЕНА action", () => {
  it("emits 'УДАЛЕНА: <path>' line for merge-delete entries", async () => {
    let stored = "";
    const vt = {
      read: vi.fn(async () => stored || ""),
      write: vi.fn(async (_p: string, c: string) => { stored = c; }),
    } as unknown as VaultTools;

    await appendWikiLog(vt, "!Wiki/work", "work", {
      op: "ingest",
      sourcePath: "Sources/doc.md",
      outputTokens: 42,
      entries: [
        { path: "entities/New.md", action: "СОЗДАНА", statusTo: "stub" },
        { path: "entities/Old.md", action: "УДАЛЕНА" },
      ],
    });

    expect(stored).toContain("СОЗДАНА: entities/New.md (stub)");
    expect(stored).toContain("УДАЛЕНА: entities/Old.md");
  });
});
```

(The file already imports `VaultTools` and `vi`; if not, add the same imports as nearby tests.)

- [ ] **Step 2: Run tests, verify they fail**

Run: `npm test -- tests/wiki-log.test.ts`
Expected: FAIL — `"УДАЛЕНА"` not assignable to action type and not handled by builder.

- [ ] **Step 3: Update `src/wiki-log.ts`**

Replace the `IngestLogEntry` interface and the `event.op === "ingest"` branch of `buildEntry`:

```ts
export interface IngestLogEntry {
  path: string;
  action: "СОЗДАНА" | "ОБНОВЛЕНА" | "УДАЛЕНА";
  statusFrom?: string;
  statusTo?: string;
}
```

In `buildEntry`, replace the ingest branch with:

```ts
  if (event.op === "ingest") {
    lines.push(`**Источник:** ${event.sourcePath}`);
    lines.push(`**Токены:** ${event.outputTokens}`);
    lines.push("");
    for (const e of event.entries) {
      if (e.action === "СОЗДАНА") {
        lines.push(`- СОЗДАНА: ${e.path} (${e.statusTo ?? "unknown"})`);
      } else if (e.action === "ОБНОВЛЕНА") {
        const status = e.statusFrom ? `${e.statusFrom}→${e.statusTo}` : (e.statusTo ?? "unknown");
        lines.push(`- ОБНОВЛЕНА: ${e.path} (${status})`);
      } else {
        lines.push(`- УДАЛЕНА: ${e.path}`);
      }
    }
  } else if (event.op === "lint") {
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npm test -- tests/wiki-log.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wiki-log.ts tests/wiki-log.test.ts
git commit -m "feat(ingest): support УДАЛЕНА action in ingest log"
```

---

## Task 6: `mergeDeleteWarnThreshold` — config + i18n + settings slider

**Files:**
- Modify: `src/local-config.ts:25-29`
- Modify: `src/i18n.ts` (en, ru, es bundles)
- Modify: `src/settings.ts` (near the Relevant pages top-K control, around line 545)
- Test: `tests/local-config.test.ts`

- [ ] **Step 1: Write failing test in `tests/local-config.test.ts`**

Reuse the existing `makePlugin(adapterImpl, manifestDir?)` helper at the top of the file (lines 4–9 — see actual file). Append after the last `describe(...)` block:

```ts
describe("LocalConfig.nativeAgent.mergeDeleteWarnThreshold", () => {
  it("round-trips mergeDeleteWarnThreshold through save/load", async () => {
    let written = "";
    const adapter = {
      exists: vi.fn().mockResolvedValue(false),
      read: vi.fn(),
      write: vi.fn().mockImplementation(async (_p: string, c: string) => { written = c; }),
    };
    const store = new LocalConfigStore(makePlugin(adapter));
    await store.save({
      iclaudePath: "",
      nativeAgent: {
        baseUrl: "", apiKey: "", model: "", temperature: 0.2, topP: null,
        mergeDeleteWarnThreshold: 10,
      },
    });
    expect(written).toContain('"mergeDeleteWarnThreshold": 10');
    const loaded = await store.load();
    expect(loaded.nativeAgent?.mergeDeleteWarnThreshold).toBe(10);
  });

  it("LocalConfig.nativeAgent.mergeDeleteWarnThreshold is optional", () => {
    const lc: typeof import("../src/local-config").LocalConfig = {
      iclaudePath: "",
      nativeAgent: { baseUrl: "", apiKey: "", model: "", temperature: 0.2, topP: null },
    };
    expect(lc.nativeAgent?.mergeDeleteWarnThreshold).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- tests/local-config.test.ts`
Expected: FAIL — TypeScript error on `mergeDeleteWarnThreshold` not being in the `nativeAgent` shape.

- [ ] **Step 3: Update `src/local-config.ts`**

Edit the `nativeAgent` block (lines 20–29):

```ts
  nativeAgent?: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    embeddingModel?: string;
    embeddingDimensions?: number;
    relevantPagesTopK?: number;
    mergeDeleteWarnThreshold?: number;
  };
```

- [ ] **Step 3a: Extend `src/types.ts` — `LlmWikiPluginSettings.nativeAgent` + `DEFAULT_SETTINGS` + `LlmCallOptions`**

Edit `src/types.ts` line 176 — add `mergeDeleteWarnThreshold` next to `relevantPagesTopK` inside `LlmWikiPluginSettings.nativeAgent`:

```ts
    embeddingModel?: string;
    embeddingDimensions?: number;
    relevantPagesTopK?: number;
    mergeDeleteWarnThreshold?: number;
```

The field is optional in the interface — no `DEFAULT_SETTINGS.nativeAgent` change is required (omitted defaults remain `undefined`, callers use `?? 5`).

Edit `src/types.ts` line 96–105 — add `mergeDeleteWarnThreshold` to `LlmCallOptions`:

```ts
export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  jsonMode?: "json_object" | "json_schema" | false;
  jsonSchema?: { name: string; schema: object };
  structuredRetries?: number;
  thinkingBudgetTokens?: number;
  mergeDeleteWarnThreshold?: number;
}
```

- [ ] **Step 3b: Wire `mergeDeleteWarnThreshold` through `AgentRunner.buildOptsFor`**

Edit `src/agent-runner.ts` lines 31–45. After `const structuredRetries = s.nativeAgent.structuredRetries ?? 1;` (line 31), add:

```ts
    const mergeDeleteWarnThreshold = s.nativeAgent.mergeDeleteWarnThreshold;
```

Then append `, mergeDeleteWarnThreshold` to every `opts: { ... }` literal in this method. The four locations after edit:

```ts
      return { model, opts: { systemPrompt: s.systemPrompt, structuredRetries, mergeDeleteWarnThreshold } };
```

```ts
    if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries, mergeDeleteWarnThreshold } };
    return { model: na.model, opts: { maxTokens: na.maxTokens, temperature: na.temperature, topP: na.topP, thinkingBudgetTokens: budgetTokens, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries, mergeDeleteWarnThreshold } };
```

- [ ] **Step 4: Add i18n entries to `src/i18n.ts`**

Add to the `en.settings` object (around the `seedMinScore_desc` line):

```ts
    mergeDeleteWarnThreshold_name: "Merge delete warning threshold",
    mergeDeleteWarnThreshold_desc: "Ingest emits a warning when LLM requests deletion of more pages than this in a single merge. Default: 5.",
```

Add to the `ru.settings` object (at the same position):

```ts
    mergeDeleteWarnThreshold_name: "Порог предупреждения о merge-удалениях",
    mergeDeleteWarnThreshold_desc: "Ingest предупреждает, если LLM просит удалить больше страниц при merge. По умолчанию: 5.",
```

Add to the `es.settings` object (same position; mirror EN — Spanish is not the focus of this spec):

```ts
    mergeDeleteWarnThreshold_name: "Umbral de aviso de merge-deletes",
    mergeDeleteWarnThreshold_desc: "Ingest avisa cuando el LLM pide borrar más páginas que este umbral en un merge. Por defecto: 5.",
```

- [ ] **Step 5: Add slider to `src/settings.ts`**

Insert inside the `if (this.localCache.nativeAgent?.embeddingModel !== undefined) { ... }` block in the Semantic Search section (around line 600, after the "Embedding dimensions" Setting), keeping the local-language inline style used in this section:

```ts
        new Setting(containerEl)
          .setName(T.settings.mergeDeleteWarnThreshold_name)
          .setDesc(T.settings.mergeDeleteWarnThreshold_desc)
          .addSlider((s) =>
            s.setLimits(1, 20, 1)
              .setDynamicTooltip()
              .setValue(this.localCache.nativeAgent?.mergeDeleteWarnThreshold ?? 5)
              .onChange(async (v) => {
                await this.patchLocalNative({ mergeDeleteWarnThreshold: v });
              }),
          );
```

(`T` is the existing locale lookup variable used in this file — match the surrounding code.)

- [ ] **Step 6: Run tests, verify pass**

Run: `npm test -- tests/local-config.test.ts && npx tsc --noEmit`
Expected: PASS, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add src/local-config.ts src/types.ts src/agent-runner.ts src/i18n.ts src/settings.ts tests/local-config.test.ts
git commit -m "feat(ingest): add mergeDeleteWarnThreshold setting + AgentRunner wiring"
```

---

## Task 7: New prompt — `prompts/ingest-entities.md`

**Files:**
- Create: `prompts/ingest-entities.md`
- Test: `tests/phases/prompts.test.ts` (or `tests/prompts.test.ts` — whichever already exists)

- [ ] **Step 1: Write failing test**

Locate the existing prompt test file (`tests/prompts.test.ts`). Append:

```ts
import ingestEntitiesTemplate from "../prompts/ingest-entities.md";

describe("prompts/ingest-entities.md", () => {
  it("contains the required template placeholders", () => {
    expect(ingestEntitiesTemplate).toContain("{{domain_name}}");
    expect(ingestEntitiesTemplate).toContain("{{entity_types_block}}");
    expect(ingestEntitiesTemplate).toContain("{{lang_notes}}");
  });

  it("instructs the model to return JSON with reasoning + entities", () => {
    expect(ingestEntitiesTemplate).toMatch(/reasoning/);
    expect(ingestEntitiesTemplate).toMatch(/entities/);
    expect(ingestEntitiesTemplate).toMatch(/name/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- tests/prompts.test.ts`
Expected: FAIL — `Cannot find module '../prompts/ingest-entities.md'`.

- [ ] **Step 3: Create `prompts/ingest-entities.md`**

```
Ты — извлекатель сущностей из источника для домена «{{domain_name}}».

ТИПЫ СУЩНОСТЕЙ ДОМЕНА:
{{entity_types_block}}
{{lang_notes}}

ЗАДАЧА:
- Прочитай источник.
- Верни список сущностей, которые встречаются в источнике и соответствуют ТИПАМ выше.
- Для каждой сущности:
  - name: каноническое имя сущности (без кавычек, как заголовок будущей страницы)
  - type: тип из списка выше (опционально, если не подходит ни один — пропусти)
  - context_snippet: одна фраза из источника, поясняющая зачем сущность нужна (опционально)

Не дублируй: один name → одна запись. Не извлекай сущности с min_mentions_for_page > 1, если они упомянуты только раз.

Верни ТОЛЬКО JSON:
{"reasoning":"...","entities":[{"name":"...","type":"...","context_snippet":"..."}]}
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- tests/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prompts/ingest-entities.md tests/prompts.test.ts
git commit -m "feat(ingest): add ingest-entities.md system prompt for LLM #1"
```

---

## Task 8: Extend `prompts/ingest.md` with merge block

**Files:**
- Modify: `prompts/ingest.md`
- Test: `tests/prompts.test.ts`

- [ ] **Step 1: Write failing test in `tests/prompts.test.ts`**

Append:

```ts
import ingestTemplate from "../prompts/ingest.md";

describe("prompts/ingest.md — merge block", () => {
  it("instructs the model how to express merges via pages + deletes", () => {
    expect(ingestTemplate).toMatch(/ОБЪЕДИНЕНИЕ ДУБЛИКАТОВ/);
    expect(ingestTemplate).toMatch(/deletes/);
  });
});
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npm test -- tests/prompts.test.ts`
Expected: FAIL.

- [ ] **Step 3: Edit `prompts/ingest.md`**

Insert the merge block between the existing `ОБОГАЩЕНИЕ ТИПОВ (entity_types_delta):` block and the final `Верни ТОЛЬКО JSON-объект` line:

```
ОБЪЕДИНЕНИЕ ДУБЛИКАТОВ (merge):
Если среди существующих wiki-страниц нашлись несколько, описывающих одну и ту же сущность:
- эмить одну новую страницу в pages (с объединённым контентом и каноническим путём)
- перечислить старые пути в поле deletes: [{path}, ...]
Старые страницы будут удалены, индекс почищен, backlinks в текущем источнике обновлены автоматически.
```

- [ ] **Step 4: Run test, verify pass**

Run: `npm test -- tests/prompts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add prompts/ingest.md tests/prompts.test.ts
git commit -m "feat(ingest): document merge via pages+deletes in ingest prompt"
```

---

## Task 9: Refactor `runIngest` — two-call orchestration + delete loop + new summary

This is the largest task. It rewrites the core of `src/phases/ingest.ts`. Implement in one focused change set: tests live alongside in Task 9 too because the orchestrator semantics are the contract.

**Files:**
- Modify: `src/phases/ingest.ts`
- Test: `tests/phases/ingest.test.ts`

- [ ] **Step 1: Update the test helper to support a queue of LLM responses**

In `tests/phases/ingest.test.ts`, replace `makeLlm` with a queue-aware version (place near the top of the file, replacing the old definition):

```ts
function makeLlm(responses: string | string[]): LlmClient {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const create = vi.fn().mockImplementation(async () => {
    const text = queue.length > 1 ? queue.shift()! : queue[0];
    return {
      [Symbol.asyncIterator]: async function* () {
        yield { choices: [{ delta: { content: text } }] };
      },
    };
  });
  return { chat: { completions: { create } } } as unknown as LlmClient;
}
```

Behavior contract:
- A single string → returned for every call (preserves existing tests).
- An array → first call returns `[0]`, second `[1]`, etc.; once the array is reduced to its last element it's reused (so tests that only care about the write call can pass a single string).

- [ ] **Step 2: Update existing tests that drive `runIngest` to supply a two-element sequence**

For every existing test in this file that passes a single `JSON.stringify({reasoning, pages})` string, change the argument to:

```ts
makeLlm([
  JSON.stringify({ reasoning: "entities", entities: [{ name: "X" }] }),
  /* original write response */,
])
```

For tests that already passed a single string for the WRITE response only and don't care about the entity step, prefix the array with a default entities response. Concretely, edit each test individually — do not introduce a shared default helper, since the entity payload is part of the test's assertion surface.

- [ ] **Step 3: Add new tests for the two-call flow in `tests/phases/ingest.test.ts`**

```ts
describe("runIngest — entity-driven flow", () => {
  const VAULT_ROOT = "/vaults/Work";
  const domain: DomainEntry = {
    id: "work", name: "Work", wiki_folder: "work", source_paths: ["Sources/"],
  };

  it("calls LLM twice: entities then pages", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "found Foo", entities: [{ name: "Foo" }] }),
      JSON.stringify({ reasoning: "new page", pages: [{ path: "!Wiki/work/entities/Foo.md", content: "# Foo" }] }),
    ]);

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(llm.chat.completions.create).toHaveBeenCalledTimes(2);
  });

  it("halts when entity extraction LLM returns invalid JSON", async () => {
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("source") });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm("not json");

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(events.some((e: any) =>
      e.kind === "structural_error" && e.callSite === "ingest.entities",
    )).toBe(true);
    // No page writes happened.
    expect((adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([p]: [string]) => p.startsWith("!Wiki/work/entities/"),
    )).toBeUndefined();
  });

  it("entity with empty top-K still goes to LLM #2 as create signal", async () => {
    // No annotations → empty top-K, but ingest must still write the new page.
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        throw new Error("not found");
      }),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "novel", entities: [{ name: "Brand New" }] }),
      JSON.stringify({ reasoning: "create", pages: [{ path: "!Wiki/work/entities/BrandNew.md", content: "# BrandNew" }] }),
    ]);

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/entities/BrandNew.md", "# BrandNew");
  });

  it("processes deletes: vault.remove + removeIndexAnnotation called", async () => {
    let indexContent = "# Wiki Index\n\n## entities\n- [[Old]] entities/Old.md — to delete\n";
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (p.endsWith("_index.md")) return indexContent;
        if (p === "!Wiki/work/entities/Old.md") return "# Old";
        throw new Error("not found");
      }),
      write: vi.fn().mockImplementation(async (p: string, c: string) => {
        if (p.endsWith("_index.md")) indexContent = c;
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        files: ["!Wiki/work/entities/Old.md"], folders: [],
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "merge", entities: [{ name: "New" }] }),
      JSON.stringify({
        reasoning: "merge Old → New",
        pages: [{ path: "!Wiki/work/entities/New.md", content: "# New" }],
        deletes: [{ path: "!Wiki/work/entities/Old.md" }],
      }),
    ]);

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(adapter.remove).toHaveBeenCalledWith("!Wiki/work/entities/Old.md");
    expect(indexContent).not.toContain("[[Old]]");
  });

  it("result text shows 'создано C, обновлено U, объединено M'", async () => {
    const existing = new Set([
      "!Wiki/work/entities/Existing.md",
      "!Wiki/work/entities/Old.md",
    ]);
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (existing.has(p)) return "---\nwiki_status: developing\n---\n# X";
        throw new Error("not found");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ files: [...existing], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Existing" }, { name: "New" }] }),
      JSON.stringify({
        reasoning: "merge",
        pages: [
          { path: "!Wiki/work/entities/New.md", content: "---\nwiki_status: stub\n---\n# New" },
          { path: "!Wiki/work/entities/Existing.md", content: "---\nwiki_status: mature\n---\n# Existing" },
        ],
        deletes: [{ path: "!Wiki/work/entities/Old.md" }],
      }),
    ]);

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result?.text).toMatch(/создано 1, обновлено 1, объединено 1/);
  });

  it("emits Large merge warning when deletes.length > threshold", async () => {
    const paths = Array.from({ length: 6 }, (_, i) => `!Wiki/work/entities/Old${i}.md`);
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        if (paths.includes(p)) return "# old";
        throw new Error("not found");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ files: paths, folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "Bundle" }] }),
      JSON.stringify({
        reasoning: "big merge",
        pages: [{ path: "!Wiki/work/entities/Bundle.md", content: "# Bundle" }],
        deletes: paths.map((p) => ({ path: p })),
      }),
    ]);

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));
    const warn = events.find(
      (e: any) => e.kind === "info_text" && (e.summary as string)?.startsWith("Large merge"),
    );
    expect(warn).toBeDefined();
  });

  it("rejects deletes path outside wiki folder", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return "source";
        throw new Error("not found");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "X" }] }),
      JSON.stringify({
        reasoning: "bad",
        pages: [{ path: "!Wiki/work/entities/X.md", content: "# X" }],
        deletes: [{ path: "/etc/passwd" }],
      }),
    ]);

    const events = await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));
    expect(adapter.remove).not.toHaveBeenCalledWith("/etc/passwd");
    const rej = events.find(
      (e: any) => e.kind === "tool_result" && e.ok === false
        && (e.preview as string)?.includes("outside wiki folder"),
    );
    expect(rej).toBeDefined();
  });

  it("source backlinks drop deleted page stems", async () => {
    const existingFm =
      '---\nwiki_articles:\n  - "[[Old]]"\n  - "[[Other]]"\n---\nsource';
    const adapter = mockAdapter({
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p === "Sources/doc.md") return existingFm;
        if (p === "!Wiki/work/entities/Old.md") return "# old";
        throw new Error("not found");
      }),
      remove: vi.fn().mockResolvedValue(undefined),
      list: vi.fn().mockResolvedValue({
        files: ["!Wiki/work/entities/Old.md"], folders: [],
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "New" }] }),
      JSON.stringify({
        reasoning: "merge",
        pages: [{ path: "!Wiki/work/entities/New.md", content: "# New" }],
        deletes: [{ path: "!Wiki/work/entities/Old.md" }],
      }),
    ]);

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    const sourceWrite = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([p]: [string]) => p === "Sources/doc.md",
    );
    expect(sourceWrite).toBeDefined();
    const updated = sourceWrite![1] as string;
    expect(updated).not.toContain("[[Old]]");
    expect(updated).toContain("[[Other]]");
    expect(updated).toContain("[[New]]");
  });

  it("BFS not invoked: graphCache.get is never called from ingest", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm([
      JSON.stringify({ reasoning: "x", entities: [{ name: "X" }] }),
      JSON.stringify({ reasoning: "y", pages: [] }),
    ]);

    const { graphCache } = await import("../../src/wiki-graph-cache");
    const spy = vi.spyOn(graphCache, "get");

    await collect(runIngest(
      [`${VAULT_ROOT}/Sources/doc.md`], vt, llm, "m", [domain], VAULT_ROOT,
      new AbortController().signal,
    ));

    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
```

- [ ] **Step 4: Run tests, verify they fail**

Run: `npm test -- tests/phases/ingest.test.ts`
Expected: FAIL — both new entity-flow tests AND existing tests fail because `runIngest` still issues one LLM call.

**Step 5 is split into atomic sub-steps 5a–5g.** Each sub-step is one focused edit, run no tests until 5g — they must all land together because `runIngest` is internally consistent only after every piece is in place.

- [ ] **Step 5a: Update imports in `src/phases/ingest.ts`**

Remove `graphCache`/`bfsExpand` imports and uses from this file (they remain in the codebase for other phases — only this file stops using them).

Add new imports at top:

```ts
import { EntitiesOutputSchema } from "./zod-schemas";
import type { EntitiesOutput } from "./zod-schemas";
import type { ExtractedEntity } from "../page-similarity";
import { removeIndexAnnotation } from "../wiki-index";
import ingestEntitiesTemplate from "../../prompts/ingest-entities.md";
```

- [ ] **Step 5b: Add `buildExtractMessages` helper near `buildIngestMessages`**

```ts
function buildExtractMessages(
  sourcePath: string,
  sourceContent: string,
  domain: DomainEntry,
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const entityTypesBlock = buildEntityTypesBlock(domain, ""); // wiki path not used here
  const langNotes = domain.language_notes ? `Языковые правила: ${domain.language_notes}` : "";
  const systemContent = render(ingestEntitiesTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock || "(не заданы)",
    lang_notes: langNotes,
  });
  return [
    { role: "system", content: systemContent },
    { role: "user", content: `Источник: ${sourcePath}\n\n${sourceContent}` },
  ];
}
```

- [ ] **Step 5c: Replace existing-pages block with entity-driven flow**

Replace the section "let existingPages: Map<string, string>; if (similarity) { … } else { … }" (lines 91–112) with the new entity-driven flow:

```ts
  await ensureDomainConfig(vaultTools, domainRoot);
  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH),
    tryRead(vaultTools, domainIndexPath(domainRoot)),
  ]);
  const existingPaths = await vaultTools.listFiles(wikiVaultPath);
  const nonMetaPaths = existingPaths.filter((f) => !f.endsWith("_index.md"));
  const annotations = cachedAnnotations ?? parseIndexAnnotations(indexContent);

  yield { kind: "assistant_text", delta: `Synthesizing wiki pages for domain "${domain.id}"...\n` };
  const start = Date.now();

  // === LLM #1: extract entities =========================================
  const messages_extract = buildExtractMessages(sourceVaultPath, sourceContent, domain);
  yield { kind: "tool_use", name: "Extracting entities", input: {} };
  const extractEvents: RunEvent[] = [];
  let entitiesResult: { value: EntitiesOutput; outputTokens: number };
  try {
    entitiesResult = await parseWithRetry({
      llm, model, baseMessages: messages_extract, opts,
      schema: EntitiesOutputSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.entities",
      signal,
      onEvent: (ev) => extractEvents.push(ev),
    });
    yield { kind: "tool_result", ok: true, preview: `${entitiesResult.value.entities.length} entities` };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    for (const ev of extractEvents) yield ev;
    yield { kind: "error", message: `ingest: entity extraction failed — ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
    return;
  }
  for (const ev of extractEvents) yield ev;
  if (signal.aborted) return;

  // === Per-entity top-K retrieval =======================================
  let existingPages: Map<string, string>;
  let retrievalDetails: string[] = [];
  if (similarity) {
    await similarity.loadCache(domainRoot, vaultTools);
    const { results: entityMap, allFailed } = await similarity.selectByEntities(
      entitiesResult.value.entities, annotations, nonMetaPaths,
    );

    if (allFailed && entitiesResult.value.entities.length > 0) {
      yield { kind: "error", message: "ingest: per-entity retrieval failed for all entities" };
      yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
      return;
    }

    const union = new Set<string>();
    for (let i = 0; i < entitiesResult.value.entities.length; i++) {
      const e = entitiesResult.value.entities[i];
      const key = `${e.name}::${e.type ?? ""}`;
      const paths = entityMap.get(key) ?? [];
      retrievalDetails.push(
        `${i + 1}/${entitiesResult.value.entities.length} ${e.name}` +
        `${e.type ? ` (${e.type})` : ""} → ${paths.length ? paths.join(", ") : "—"}`,
      );
      for (const p of paths) union.add(p);
    }

    yield {
      kind: "info_text",
      icon: similarity.config.mode === "embedding" ? "🔍" : "📋",
      summary: `${union.size}/${nonMetaPaths.length} pages retrieved (${similarity.config.mode}, ${entitiesResult.value.entities.length} entities)`,
      details: retrievalDetails,
    };

    existingPages = await vaultTools.readAll([...union]);
  } else {
    // No similarity → all pages are passed (preserves the no-config path).
    existingPages = await vaultTools.readAll(nonMetaPaths);
  }
```

- [ ] **Step 5d: Extend `buildIngestMessages` to receive and render the entity list**

Replace the existing `buildIngestMessages` call (lines 117–120) so it receives the entity list:

```ts
  const messages = buildIngestMessages(
    sourceVaultPath, sourceContent, domain, wikiVaultPath,
    existingPages, schemaContent, indexContent,
    entitiesResult.value.entities,
  );
```

Update `buildIngestMessages` signature near the bottom of the file to accept and render the entities block. Replace the function body:

```ts
function buildIngestMessages(
  sourcePath: string,
  sourceContent: string,
  domain: DomainEntry,
  wikiVaultPath: string,
  existingPages: Map<string, string>,
  schemaContent: string,
  indexContent: string,
  entities: ExtractedEntity[],
): OpenAI.Chat.ChatCompletionMessageParam[] {
  const existing = existingPages.size > 0
    ? [...existingPages.entries()].map(([p, c]) => `${p}:\n${c}`).join("\n\n")
    : "Нет.";

  const today = new Date().toISOString().slice(0, 10);
  const entityTypesBlock = buildEntityTypesBlock(domain, wikiVaultPath);
  const langNotes = domain.language_notes ? `Языковые правила: ${domain.language_notes}` : "";

  const systemContent = render(ingestTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock || "(не заданы)",
    lang_notes: langNotes,
    wiki_path: wikiVaultPath,
    today,
    schema_block: schemaContent ? `КОНВЕНЦИИ (_wiki_schema.md):\n${schemaContent}` : "",
    source_path: sourcePath,
    source_stem: sourcePath.split("/").pop()!.replace(/\.md$/, ""),
  });

  // Build the "Извлечённые сущности" block: one line per entity.
  const existingPathSet = new Set(existingPages.keys());
  const entityLines = entities.map((e) => {
    const matching = [...existingPathSet].filter((p) => {
      // Heuristic: page belongs to this entity if filename stem matches name (case-insensitive).
      const stem = p.split("/").pop()!.replace(/\.md$/, "");
      return stem.toLowerCase() === e.name.toLowerCase();
    });
    const head = `- ${e.name}${e.type ? ` (${e.type})` : ""}`;
    const snippet = e.context_snippet ? ` — ${e.context_snippet}` : "";
    const tail = ` [existing: ${matching.length > 0 ? matching.join(", ") : "—"}]`;
    return head + snippet + tail;
  });
  const entitiesBlock = entityLines.length > 0
    ? `\nИзвлечённые сущности:\n${entityLines.join("\n")}\n`
    : "";

  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: [
        `Домен: ${domain.id} (${domain.name})`,
        `Wiki-папка: ${wikiVaultPath}`,
        ``,
        `Источник: ${sourcePath}`,
        sourceContent,
        ``,
        `Существующие wiki-страницы:\n${existing}`,
        entitiesBlock,
        indexContent ? `\nИндекс wiki (_index.md):\n${indexContent}` : "",
      ].filter(Boolean).join("\n"),
    },
  ];
}
```

- [ ] **Step 5e: Insert the delete loop immediately after the existing write-loop**

Insert after `for (const page of pages) { … }`:

```ts
  // === Delete loop (merge cleanup) ======================================
  const deletes = parseResult.value.deletes ?? [];
  const threshold = opts.mergeDeleteWarnThreshold ?? 5;
  if (deletes.length > threshold) {
    yield {
      kind: "info_text",
      icon: "⚠️",
      summary: `Large merge: ${deletes.length} deletions`,
      details: deletes.map((d) => d.path),
    };
  }

  const deletedPaths: string[] = [];
  for (const d of deletes) {
    if (!d.path.startsWith(wikiVaultPath + "/")) {
      yield { kind: "tool_use", name: "Delete", input: { path: d.path } };
      yield { kind: "tool_result", ok: false, preview: `outside wiki folder (${wikiVaultPath})` };
      continue;
    }
    yield { kind: "tool_use", name: "Delete", input: { path: d.path } };
    try {
      await vaultTools.remove(d.path);
      try { await removeIndexAnnotation(vaultTools, wikiVaultPath, pageId(d.path)); } catch { /* non-critical */ }
      deletedPaths.push(d.path);
      const relPath = d.path.slice(wikiVaultPath.length + 1);
      logEntries.push({ path: relPath, action: "УДАЛЕНА" });
      yield { kind: "tool_result", ok: true };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
    }
  }
```

- [ ] **Step 5f: Update summary computation and rewrite `buildIngestSummary`**

Replace the existing `const resultText = buildIngestSummary(...)` call site so it counts all three actions:

```ts
  const createdCount = logEntries.filter(e => e.action === "СОЗДАНА").length;
  const updatedCount = logEntries.filter(e => e.action === "ОБНОВЛЕНА").length;
  const mergedCount  = logEntries.filter(e => e.action === "УДАЛЕНА").length;
  const resultText = buildIngestSummary(domain.id, sourceVaultPath, createdCount, updatedCount, mergedCount, pages.length);
```

Rewrite `buildIngestSummary` to handle three actions:

```ts
function buildIngestSummary(
  domainId: string,
  sourcePath: string,
  createdCount: number,
  updatedCount: number,
  mergedCount: number,
  total: number,
): string {
  const src = sourcePath.split("/").pop() ?? sourcePath;
  const totalActed = createdCount + updatedCount + mergedCount;
  if (totalActed === 0) {
    return `Источник «${src}» обработан — новых или изменённых страниц нет.`;
  }
  const parts: string[] = [];
  if (createdCount > 0) parts.push(`создано ${createdCount}`);
  if (updatedCount > 0) parts.push(`обновлено ${updatedCount}`);
  if (mergedCount  > 0) parts.push(`объединено ${mergedCount}`);
  // Append "стр." only when there is a single term (preserves prior wording: "создано N стр.").
  const countStr = parts.length === 1 ? `${parts[0]} стр.` : parts.join(", ");
  const skipped = total - (createdCount + updatedCount);
  const errStr = skipped > 0 ? `, ошибок ${skipped}` : "";
  return `Источник «${src}» → домен «${domainId}»: ${countStr}${errStr}`;
}
```

- [ ] **Step 5g: Update source-backlink rewrite — drop deleted stems, guard on `written ∪ deletedPaths`**

Edit `src/phases/ingest.ts` lines 241–271. Replace the entire `if (written.length > 0) { … }` block with the version below. Changes:
- guard becomes `written.length > 0 || deletedPaths.length > 0`
- `existingArticles` is filtered against `deletedStems`
- log append runs whenever `logEntries.length > 0`
- source-write `tool_use`/`tool_result` block runs only when either `written.length > 0` (new content to link) OR `deletedPaths.length > 0` (stale links to drop)

```ts
  const deletedStems = new Set(deletedPaths.map((p) => p.split("/").pop()!.replace(/\.md$/, "")));

  if (written.length > 0 || deletedPaths.length > 0) {
    if (logEntries.length > 0) {
      try {
        await appendWikiLog(vaultTools, domainRoot, domain.id, {
          op: "ingest",
          sourcePath: sourceVaultPath,
          entries: logEntries,
          outputTokens,
        });
      } catch { /* non-critical */ }
    }

    const backlinkToday = new Date().toISOString().slice(0, 10);
    const isFirstTime = !hasFrontmatterField(sourceContent, "wiki_added");
    const existingArticles = parseWikiArticlesFromFm(sourceContent).filter((link) => {
      const stem = link.replace(/^\[\[/, "").replace(/\]\]$/, "");
      return !deletedStems.has(stem);
    });
    const writtenLinks = written.map((p) => `[[${p.split("/").pop()!.replace(/\.md$/, "")}]]`);
    const mergedArticles = [...new Set([...existingArticles, ...writtenLinks])];
    const updatedSource = upsertRawFrontmatter(sourceContent, {
      wiki_added: isFirstTime ? backlinkToday : undefined,
      wiki_updated: backlinkToday,
      wiki_articles: mergedArticles,
    });
    yield { kind: "tool_use", name: "Update", input: { path: sourceVaultPath } };
    try {
      await vaultTools.write(sourceVaultPath, updatedSource);
      yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourceVaultPath}` };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: `backlink write failed: ${(e as Error).message}` };
    }

    const parentPath = extractParentSourcePath(absSource, vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }
```

Threshold wiring (`opts.mergeDeleteWarnThreshold`) was already added in **Task 6 Step 3b** (`LlmCallOptions` field + `AgentRunner.buildOptsFor`). No additional change here.

- [ ] **Step 6: Run all tests**

Run: `npm test`
Expected: PASS for all suites. Existing ingest tests updated in Step 2 must still pass with the new two-call helper.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(ingest): entity-driven two-call orchestration with merge-delete support"
```

---

## Task 10: Update lat.md docs

**Files:**
- Modify: `lat.md/operations.md`
- Modify: `lat.md/architecture.md`
- Modify: `lat.md/llm-pipeline.md`
- Create: `lat.md/tests.md`

- [ ] **Step 1: Update `lat.md/operations.md` — `## Ingest` section**

Replace the `## Ingest` body and the `### Page Similarity`, `### LLM Progress Step`, `### Per-page Progress Events`, `### Result Summary` subsections with text that reflects the new flow. Required content:

- Lead paragraph (≤250 chars): "Two-call entity-driven flow. LLM #1 extracts entities from the source. Per-entity vector top-K over `_index.md` annotations selects existing pages. LLM #2 emits writes, optional `deletes` for merges, and `entity_types_delta`."
- New subsection `### Entity Extraction` describing the `ingest.entities` call and `EntitiesOutputSchema`.
- New subsection `### Per-Entity Retrieval` describing `selectByEntities`, vector default, Jaccard fallback, union-of-top-K.
- Keep `### LLM Progress Step` but mention both calls.
- Update `### Per-page Progress Events` to add `Delete` tool_use for merges.
- Update `### Result Summary` to describe the three-term format including `объединено N`.
- New subsection `### Merge Handling` describing `deletes[]`, `removeIndexAnnotation`, and the warning threshold.

Cross-link the relevant code via `[[src/phases/ingest.ts]]`, `[[src/page-similarity.ts#PageSimilarityService]]`, `[[src/wiki-index.ts#removeIndexAnnotation]]`.

- [ ] **Step 2: Update `lat.md/architecture.md` — `## PageSimilarityService` section**

Add a sentence to the lead paragraph mentioning `selectByEntities`, and a final paragraph: "Ingest uses `selectByEntities` for per-entity vector top-K; query/lint/format/init continue to use `selectRelevant` + BFS via `wiki-graph`."

- [ ] **Step 3: Update `lat.md/llm-pipeline.md` — `### Call Sites` table**

Add a row above the `ingest.pages` row:

```markdown
| `ingest.entities` | ingest | `EntitiesOutputSchema` |
```

- [ ] **Step 4: Create `lat.md/tests.md`**

Per project CLAUDE.md, every section needs a leading paragraph ≤250 chars. Use `lat:` frontmatter to require code mentions:

```markdown
---
lat:
  require-code-mention: true
---
# Tests

Spec sections that map to test code via `// @lat:` comments. Every leaf section is referenced from at least one test in `tests/`.

## Entity Extraction

Tests that validate LLM #1 extracts entities from the source via `ingest.entities` and `EntitiesOutputSchema`.

### Entities schema accepts minimal entity

The `EntitiesOutputSchema` accepts `{reasoning, entities: [{name}]}` and rejects entities longer than 50.

### Entity extraction halt on parse failure

When `parseWithRetry` exhausts retries on the entity call, ingest yields an error result and writes nothing.

## Per-Entity Retrieval

Tests that validate `PageSimilarityService.selectByEntities` returns per-entity top-K paths.

### Top-K per entity in embedding mode

A single batched POST to `/embeddings` carries all entity queries, cosine similarity ranks pages, top-K is returned per entity.

### Jaccard fallback on HTTP error

When the embeddings endpoint throws, retrieval falls back to per-entity Jaccard scoring over annotations.

### Empty top-K is not an error

An entity with no annotation matches receives `[]` and is treated by LLM #2 as a create signal — `allFailed` stays false unless the retrieval mechanism itself failed for every entity.

## Merge Handling

Tests that validate `deletes[]` on `WikiPagesOutputSchema` and the delete loop.

### Deletes trigger vault.remove + index cleanup

LLM #2 emitting `deletes` removes the listed pages and strips their lines from `_index.md` via `removeIndexAnnotation`.

### Large-merge warning

When `deletes.length` exceeds `mergeDeleteWarnThreshold`, ingest yields a `Large merge: K deletions` warning `info_text` event.

### Backlinks drop deleted stems

The current source's `wiki_articles` frontmatter list is filtered to remove links pointing at deleted page stems.

## Stop Rules

Tests that validate halt conditions.

### Halt on entity extraction failure

`parseWithRetry` exhaustion on `ingest.entities` halts the run with an error event and an empty result.

### Halt on all-entity retrieval failure

When `selectByEntities` returns `allFailed: true` and entities is non-empty, ingest halts before invoking LLM #2.

### BFS not invoked

`graphCache.get` is never called from the ingest path — the test spies on the cache and asserts zero calls.
```

- [ ] **Step 5: Add `// @lat:` comments in the new tests**

Edit the entity-flow tests added in Task 9 and the schema/retrieval tests from Tasks 1–4 to reference their spec leaf, one comment per test. Example for `tests/phases/ingest.test.ts`:

```ts
// @lat: [[tests#Stop Rules#Halt on entity extraction failure]]
it("halts when entity extraction LLM returns invalid JSON", async () => {
  /* ... */
});

// @lat: [[tests#Stop Rules#BFS not invoked]]
it("BFS not invoked: graphCache.get is never called from ingest", async () => {
  /* ... */
});

// @lat: [[tests#Merge Handling#Deletes trigger vault.remove + index cleanup]]
it("processes deletes: vault.remove + removeIndexAnnotation called", async () => {
  /* ... */
});

// @lat: [[tests#Merge Handling#Large-merge warning]]
it("emits Large merge warning when deletes.length > threshold", async () => {
  /* ... */
});

// @lat: [[tests#Merge Handling#Backlinks drop deleted stems]]
it("source backlinks drop deleted page stems", async () => {
  /* ... */
});
```

For `tests/page-similarity.test.ts`:

```ts
// @lat: [[tests#Per-Entity Retrieval#Top-K per entity in embedding mode]]
it("batches all entity queries in one HTTP call", /* ... */);

// @lat: [[tests#Per-Entity Retrieval#Jaccard fallback on HTTP error]]
it("falls back to Jaccard when embedding HTTP throws", /* ... */);

// @lat: [[tests#Per-Entity Retrieval#Empty top-K is not an error]]
it("returns empty array for entity with no annotation matches", /* ... */);
```

For `tests/phases/zod-schemas.test.ts`:

```ts
// @lat: [[tests#Entity Extraction#Entities schema accepts minimal entity]]
it("accepts minimal entity", /* ... */);
```

Add one corresponding `// @lat:` comment per leaf section in `lat.md/tests.md`.

- [ ] **Step 6: Run `lat check`**

Run: `lat check`
Expected: PASS. All wiki links resolve and every leaf section in `lat.md/tests.md` has a matching `// @lat:` comment.

- [ ] **Step 7: Commit**

```bash
git add lat.md/ tests/
git commit -m "docs(ingest): update lat.md for entity-driven retrieval"
```

---

## Task 11: Final verification — full test run + build + lat check

**Files:** none modified

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 4: lat check**

Run: `lat check`
Expected: all wiki links and code refs pass.

- [ ] **Step 5: Optional sanity scan of the diff vs. baseline ingest**

Verify the legacy BFS plumbing in `wiki-graph.ts`, `wiki-graph-cache.ts`, `bfsExpand`, and `selectRelevant` is untouched (other phases still use it).

```bash
git diff master -- src/wiki-graph.ts src/wiki-graph-cache.ts
```

Expected: no diff for those files.

- [ ] **Step 6: Final commit (only if anything pending)**

If steps 1–5 reveal a small follow-up fix (e.g. a missed `@lat:` reference), commit it as `chore(ingest): final cleanup after verification`. Otherwise this task has no commit.
