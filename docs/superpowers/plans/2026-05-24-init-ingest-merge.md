# init-incremental → ingest merge: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the separate `init-incremental` LLM call; make `ingest` the single phase responsible for both page extraction and optional `entity_types` enrichment.

**Architecture:** `ingest.ts` now emits `domain_updated { entity_types }` when the LLM returns `entity_types_delta`. `init.ts` removes the incremental LLM call entirely and instead intercepts `domain_updated` events from the inner `runIngest` call to keep `currentDomain` in sync. `mergeEntityTypes` moves to `domain.ts` to avoid circular imports.

**Tech Stack:** TypeScript, Vitest, Zod, esbuild

---

## File Map

| File | Change |
|---|---|
| `src/phases/zod-schemas.ts` | Add `entity_types_delta?` to `WikiPagesOutputSchema`; export `WikiPagesOutput` type update |
| `src/domain.ts` | Add `mergeEntityTypes` (moved from `init.ts`) |
| `src/phases/init.ts` | Remove `mergeEntityTypes` export; remove `initIncrementalTemplate` import and LLM call; add intercept loop |
| `src/phases/ingest.ts` | Import `mergeEntityTypes`; emit `domain_updated` when delta present |
| `prompts/ingest.md` | Add instruction to return `entity_types_delta` |
| `prompts/init-incremental.md` | **Delete** |
| `tests/phases/ingest.test.ts` | 2 new tests for delta emission |
| `tests/phases/init.test.ts` | Update import; rewrite Phase 1 incremental tests; add intercept test |
| `docs/prompt-architecture.md` | Remove init-incremental references; update tables |

---

## Task 1: Add `entity_types_delta` to `WikiPagesOutputSchema`

**Files:**
- Modify: `src/phases/zod-schemas.ts`
- Test: `tests/phases/ingest.test.ts` (new test in Task 3 covers this schema)

- [ ] **Step 1: Write a failing test that validates the new schema field**

Add to `tests/phases/ingest.test.ts`, inside a new `describe` at the bottom:

```typescript
describe("WikiPagesOutputSchema — entity_types_delta", () => {
  it("accepts response with entity_types_delta", () => {
    const { WikiPagesOutputSchema } = require("../../src/phases/zod-schemas");
    const input = {
      reasoning: "Found new type",
      pages: [],
      entity_types_delta: [
        { type: "org", description: "Organisation", extraction_cues: ["company", "org"] },
      ],
    };
    const result = WikiPagesOutputSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.entity_types_delta).toHaveLength(1);
  });

  it("accepts response without entity_types_delta (backward compat)", () => {
    const { WikiPagesOutputSchema } = require("../../src/phases/zod-schemas");
    const input = { reasoning: "ok", pages: [] };
    const result = WikiPagesOutputSchema.safeParse(input);
    expect(result.success).toBe(true);
    expect(result.data?.entity_types_delta).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/phases/ingest.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `entity_types_delta` not a known field.

- [ ] **Step 3: Update `WikiPagesOutputSchema` in `src/phases/zod-schemas.ts`**

Replace lines 46–49:

```typescript
export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
});
```

With:

```typescript
export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
  entity_types_delta: z.array(EntityTypeSchema).optional(),
});
```

- [ ] **Step 4: Update the exported `WikiPagesOutput` type (line 67)**

No change needed — it is derived via `z.infer<typeof WikiPagesOutputSchema>` so it updates automatically.

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run tests/phases/ingest.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PASS for the two new WikiPagesOutputSchema tests.

- [ ] **Step 6: Commit**

```bash
git add src/phases/zod-schemas.ts tests/phases/ingest.test.ts
git commit -m "feat(schema): add entity_types_delta? to WikiPagesOutputSchema"
```

---

## Task 2: Move `mergeEntityTypes` from `init.ts` to `domain.ts`

**Files:**
- Modify: `src/domain.ts`
- Modify: `src/phases/init.ts` (remove definition, add import)
- Modify: `tests/phases/init.test.ts` (update import)

- [ ] **Step 1: Add `mergeEntityTypes` to `src/domain.ts`**

After the `validateDomainId` function (line 47), before the `DomainPersistEvent` type (line 49), add:

```typescript
export function mergeEntityTypes(current: EntityType[], incoming: EntityType[]): EntityType[] {
  const map = new Map(current.map(e => [e.type, e]));
  for (const e of incoming) map.set(e.type, e);
  return [...map.values()];
}
```

- [ ] **Step 2: Update `src/phases/init.ts` — remove definition, add import**

Remove lines 15–19 (the `mergeEntityTypes` function body):

```typescript
export function mergeEntityTypes(current: EntityType[], incoming: EntityType[]): EntityType[] {
  const map = new Map(current.map(e => [e.type, e]));
  for (const e of incoming) map.set(e.type, e);
  return [...map.values()];
}
```

Add to the import on line 2 (currently `import type { DomainEntry, EntityType } from "../domain";`):

```typescript
import type { DomainEntry, EntityType } from "../domain";
import { mergeEntityTypes } from "../domain";
```

- [ ] **Step 3: Update import in `tests/phases/init.test.ts` (line 2)**

Change:

```typescript
import { runInit, mergeEntityTypes } from "../../src/phases/init";
```

To:

```typescript
import { runInit } from "../../src/phases/init";
import { mergeEntityTypes } from "../../src/domain";
```

- [ ] **Step 4: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all existing tests pass (same logic, only moved).

- [ ] **Step 5: Commit**

```bash
git add src/domain.ts src/phases/init.ts tests/phases/init.test.ts
git commit -m "refactor(domain): move mergeEntityTypes to domain.ts"
```

---

## Task 3: Emit `domain_updated` from `ingest.ts` when `entity_types_delta` present

**Files:**
- Modify: `src/phases/ingest.ts`
- Test: `tests/phases/ingest.test.ts`

- [ ] **Step 1: Write two failing tests**

Add to `tests/phases/ingest.test.ts` inside a new `describe` block after the existing tests:

```typescript
describe("runIngest — entity_types_delta", () => {
  it("emits domain_updated with merged entity_types when LLM returns entity_types_delta", async () => {
    const domainWithTypes: DomainEntry = {
      id: "work",
      name: "Work",
      wiki_folder: "work",
      source_paths: ["Sources/"],
      entity_types: [
        { type: "concept", description: "A concept", extraction_cues: ["concept"] },
      ],
    };
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Found org type",
      pages: [],
      entity_types_delta: [
        { type: "org", description: "Organisation", extraction_cues: ["company"] },
      ],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt, makeLlm(llmResponse), "llama3.2",
        [domainWithTypes], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const update = events.find((e: any) => e.kind === "domain_updated") as any;
    expect(update).toBeDefined();
    expect(update.domainId).toBe("work");
    const types = update.patch.entity_types.map((t: any) => t.type);
    expect(types).toContain("concept");
    expect(types).toContain("org");
  });

  it("does NOT emit domain_updated when LLM returns no entity_types_delta", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "No new types",
      pages: [],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt, makeLlm(llmResponse), "llama3.2",
        [domain], VAULT_ROOT, new AbortController().signal,
      ),
    );
    const update = events.find((e: any) => e.kind === "domain_updated");
    expect(update).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/phases/ingest.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|PASS|entity_types_delta"
```

Expected: 2 new tests FAIL.

- [ ] **Step 3: Add import and delta logic to `src/phases/ingest.ts`**

Add `mergeEntityTypes` to the import from `../domain` (line 3):

```typescript
import type { DomainEntry } from "../domain";
import { mergeEntityTypes } from "../domain";
```

After the page-writing loop ends (after the `yield { kind: "assistant_text", delta: resultText }` line ~184, before the backlinks block), insert:

```typescript
  const delta = parseResult.value.entity_types_delta;
  if (delta?.length) {
    const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
    yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
  }
```

The insertion point is after `yield { kind: "assistant_text", delta: resultText }` (line ~184) and before `if (written.length > 0) {` (line ~186). The full block placement:

```typescript
  const resultText = buildIngestSummary(domain.id, sourceVaultPath, written, pages.length);
  yield { kind: "assistant_text", delta: resultText };

  // ← INSERT HERE:
  const delta = parseResult.value.entity_types_delta;
  if (delta?.length) {
    const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
    yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
  }

  if (written.length > 0) {
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/phases/ingest.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|PASS|entity_types_delta|domain_updated"
```

Expected: all tests PASS.

- [ ] **Step 5: Run full test suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts tests/phases/ingest.test.ts
git commit -m "feat(ingest): emit domain_updated when LLM returns entity_types_delta"
```

---

## Task 4: Update `prompts/ingest.md` to request `entity_types_delta`

**Files:**
- Modify: `prompts/ingest.md`

- [ ] **Step 1: Add entity_types_delta instruction to `prompts/ingest.md`**

The current prompt ends with (last two lines):

```
Верни ТОЛЬКО JSON-объект — никакого другого текста:
{"reasoning":"Обоснование: какие сущности извлечены и почему","pages":[{"path":"{{wiki_path}}/entities/EntityName.md","content":"---\n...","annotation":"..."}]}
```

Replace those last two lines with:

```
ОБОГАЩЕНИЕ ТИПОВ (entity_types_delta):
Если при анализе источника ты обнаруживаешь:
- новые типы сущностей (ключ type отсутствует в текущем списке выше), или
- улучшения к существующим типам (более точное description или дополнительные extraction_cues для уже существующего ключа type) —
добавь поле entity_types_delta в JSON-ответ. Если ничего нового — просто не включай это поле.

Верни ТОЛЬКО JSON-объект — никакого другого текста:
{"reasoning":"Обоснование: какие сущности извлечены и почему","pages":[{"path":"{{wiki_path}}/entities/EntityName.md","content":"---\nwiki_sources: [\"[[{{source_path}}]]\"]\nwiki_updated: {{today}}\nwiki_status: stub\ntags: []\nwiki_outgoing_links: []\n---\n# EntityName\n\ncontент...","annotation":"Краткое описание сущности для контекстного поиска"}],"entity_types_delta":[{"type":"NewType","description":"...","extraction_cues":["cue1","cue2"]}]}
```

- [ ] **Step 2: Verify build still compiles**

```bash
npm run build 2>&1 | tail -10
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add prompts/ingest.md
git commit -m "feat(prompt): add entity_types_delta instruction to ingest.md"
```

---

## Task 5: Update `init.ts` — remove incremental LLM call, add domain_updated intercept

**Files:**
- Modify: `src/phases/init.ts`
- Modify: `tests/phases/init.test.ts`

- [ ] **Step 1: Write a new failing test for the intercept behavior**

Add to `tests/phases/init.test.ts` inside a new `describe` block:

```typescript
describe("runInitWithSources — domain_updated intercept from ingest", () => {
  const bootstrapJson = JSON.stringify({
    reasoning: "",
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["concept"] }],
    language_notes: "",
  });

  it("intercepts domain_updated from ingest and passes merged entity_types to next file", async () => {
    // 2 source files: a.md (bootstrap + ingest-no-delta), b.md (ingest-with-delta)
    // After b.md ingest: domain should have both concept + person
    const files = { "src/a.md": "content a", "src/b.md": "content b" };
    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");

    const ingestEmpty = JSON.stringify({ reasoning: "ok", pages: [] });
    const ingestWithDelta = JSON.stringify({
      reasoning: "Found person type",
      pages: [],
      entity_types_delta: [
        { type: "person", description: "A person", extraction_cues: ["person"] },
      ],
    });

    // Call sequence: 0=bootstrap(a), 1=ingest(a), 2=ingest(b)
    const llm = makeMultiLlm([bootstrapJson, ingestEmpty, ingestWithDelta]);

    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [], "TestVault", new AbortController().signal),
    );

    // Find the last domain_updated that has entity_types
    const allUpdates = events.filter(
      (e: any) => e.kind === "domain_updated" && e.patch?.entity_types !== undefined,
    ) as any[];
    expect(allUpdates.length).toBeGreaterThan(0);
    const last = allUpdates[allUpdates.length - 1];
    const types = last.patch.entity_types.map((t: any) => t.type);
    expect(types).toContain("concept");
    expect(types).toContain("person");
  });
});
```

- [ ] **Step 2: Rewrite broken tests in `runInitWithSources — Phase 1 incremental` describe**

The existing incremental tests assumed a separate LLM call per file for `EntityTypesDeltaSchema`. After this change the call sequence is: `bootstrap(file0), ingest(file0), ingest(file1), ingest(file2)`. Rewrite those tests.

Replace the entire `describe("runInitWithSources — Phase 1 incremental", ...)` block with:

```typescript
describe("runInitWithSources — Phase 1 incremental (entity types via ingest delta)", () => {
  const bootstrapJson = JSON.stringify({
    reasoning: "",
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["concept"] }],
    language_notes: "",
  });

  // Ingest responses that carry entity_types_delta
  const ingestWithPersonDelta = JSON.stringify({
    reasoning: "ok",
    pages: [],
    entity_types_delta: [
      { type: "concept", description: "Refined concept", extraction_cues: ["refined"] },
      { type: "person", description: "A person", extraction_cues: ["person"] },
    ],
  });

  const ingestWithPlaceDelta = JSON.stringify({
    reasoning: "ok",
    pages: [],
    entity_types_delta: [
      { type: "place", description: "A place", extraction_cues: ["location"] },
    ],
  });

  const ingestEmpty = JSON.stringify({ reasoning: "ok", pages: [] });

  const sourceFiles = {
    "src/a.md": "content a",
    "src/b.md": "content b",
    "src/c.md": "content c",
  };

  it("emits domain_updated with merged entity_types when ingest returns delta", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    // Call sequence for 3 files: bootstrap(a), ingest(a), ingest(b), ingest(c)
    const events = await collect(
      runInit(
        ["dom", "--sources", "src"],
        vt,
        makeMultiLlm([bootstrapJson, ingestEmpty, ingestWithPersonDelta, ingestWithPlaceDelta]),
        "model", [], "TestVault", new AbortController().signal,
      ),
    );
    const updates = events.filter(
      (e: any) => e.kind === "domain_updated" && e.patch?.entity_types,
    ) as any[];
    // At least the loop-end domain_updated for b and c (both have deltas)
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("entity_types accumulate correctly — later files merge on top of earlier", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    // Call sequence: bootstrap(a), ingest(a no-delta), ingest(b with person+refined-concept), ingest(c with place)
    const events = await collect(
      runInit(
        ["dom", "--sources", "src"],
        vt,
        makeMultiLlm([bootstrapJson, ingestEmpty, ingestWithPersonDelta, ingestWithPlaceDelta]),
        "model", [], "TestVault", new AbortController().signal,
      ),
    );
    // Find last domain_updated with entity_types (loop-end after c.md)
    const updatesWithTypes = events.filter(
      (e: any) => e.kind === "domain_updated" && e.patch?.entity_types !== undefined,
    ) as any[];
    const last = updatesWithTypes[updatesWithTypes.length - 1];
    const types = last.patch.entity_types.map((e: any) => e.type);
    expect(types).toContain("concept");
    expect(types).toContain("person");
    expect(types).toContain("place");
    // concept should be refined (from ingestWithPersonDelta)
    const concept = last.patch.entity_types.find((e: any) => e.type === "concept");
    expect(concept.description).toBe("Refined concept");
  });

  it("emits file_start and file_done for each file", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["dom", "--sources", "src"],
        vt,
        makeMultiLlm([bootstrapJson, ingestEmpty, ingestEmpty, ingestEmpty]),
        "model", [], "TestVault", new AbortController().signal,
      ),
    );
    const fileStarts = events.filter((e: any) => e.kind === "file_start") as any[];
    const fileDones = events.filter((e: any) => e.kind === "file_done") as any[];
    expect(fileStarts).toHaveLength(3);
    expect(fileDones).toHaveLength(3);
    for (const fs of fileStarts) expect(fs.phase).toBeUndefined();
    for (const fd of fileDones) expect(fd.phase).toBeUndefined();
  });

  it("emits a single init_start", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(
        ["dom", "--sources", "src"],
        vt,
        makeMultiLlm([bootstrapJson, ingestEmpty, ingestEmpty, ingestEmpty]),
        "model", [], "TestVault", new AbortController().signal,
      ),
    );
    const initStarts = events.filter((e: any) => e.kind === "init_start") as any[];
    expect(initStarts).toHaveLength(1);
    expect(initStarts[0].phase).toBeUndefined();
  });
});
```

- [ ] **Step 3: Update per-file pipeline tests that use incremental responses**

In `describe("runInitWithSources — per-file pipeline", ...)`, update the tests that use `incrementalJson`:

**"writes articles for file[0] before LLM is called for file[1]"** — change the LLM call list:

Old (6 responses):
```typescript
makeOrderedLlm(
  [
    [bootstrapJson],
    [ingestPagesJson("A")],
    [incrementalJson],
    [ingestPagesJson("B")],
    [incrementalJson],
    [ingestPagesJson("C")],
  ],
  (idx) => llmCallLog.push(idx),
)
```

New (4 responses — no incremental calls):
```typescript
makeOrderedLlm(
  [
    [bootstrapJson],
    [ingestPagesJson("A")],
    [ingestPagesJson("B")],
    [ingestPagesJson("C")],
  ],
  (idx) => llmCallLog.push(idx),
)
```

Comment explaining call indices:
```
// Calls: [0]=bootstrap(a), [1]=ingest(a), [2]=ingest(b), [3]=ingest(c)
```

**"resume: skips files already in analyzed_sources_v2 domain"** — the isIngest heuristic in the mock LLM (checking for `"!Wiki"` in the user message) remains valid since ingest messages include `Wiki-папка: !Wiki/...`. Update the response to return proper `WikiPagesOutputSchema` format:

Change:
```typescript
const body = isIngest
  ? JSON.stringify([{ path: `!Wiki/dom/concepts/X.md`, content: "x" }])
  : incrementalJson;
```

To:
```typescript
const body = JSON.stringify({ reasoning: "ok", pages: [{ path: `!Wiki/dom/concepts/X.md`, content: "x" }] });
```

(Remove the `isIngest` check entirely — after the merge, all non-bootstrap calls are ingest calls.)

**"abort mid-file: analyzed_sources NOT updated for that file"** — call index 2 was incremental(b); now it is ingest(b). Update the mock:

Change the body for `idx === 2`:
```typescript
if (idx === 2) {
  return Promise.resolve({
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: incrementalJson } }] };
      ac.abort();
    },
  });
}
```

To (use valid ingest format so parse doesn't throw before abort fires):
```typescript
if (idx === 2) {
  return Promise.resolve({
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: JSON.stringify({ reasoning: "ok", pages: [] }) } }] };
      ac.abort();
    },
  });
}
```

- [ ] **Step 4: Run tests to verify new test fails and updated tests fail or pass as expected**

```bash
npx vitest run tests/phases/init.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: the new intercept test FAILS; updated incremental tests may FAIL because init still makes incremental LLM calls (breaking the LLM call sequence). That's correct — implement next.

- [ ] **Step 5: Implement init.ts changes**

**Remove `initIncrementalTemplate` import** (line 10):

```typescript
import initIncrementalTemplate from "../../prompts/init-incremental.md";
```

Delete that line entirely.

**Replace the `else` branch** (lines 279–326 — the incremental LLM call + local merge). The old else block:

```typescript
    } else {
      // Incremental: delta entity_types
      const currentEntityTypes = currentDomain?.entity_types ?? [];
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: initIncrementalTemplate },
        { role: "user", content: `Текущие entity_types:\n${JSON.stringify(currentEntityTypes, null, 2)}\n\nФайл: ${file}\n\n${fileContent}` },
      ];

      const collected: RunEvent[] = [];
      let parsed: { entity_types?: EntityType[]; language_notes?: string };
      try {
        const r = await parseWithRetry({
          llm, model, baseMessages: messages, opts,
          schema: EntityTypesDeltaSchema,
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "init.delta",
          signal,
          onEvent: (e) => collected.push(e),
        });
        parsed = r.value;
        outputTokens += r.outputTokens;
      } catch (e) {
        for (const ev of collected) yield ev;
        if ((e as Error).name === "AbortError" || signal.aborted) return;
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем (${(e as Error).message})\n` };
        yield { kind: "file_done", file };
        continue;
      }
      for (const ev of collected) yield ev;

      if (signal.aborted) return;

      const delta = { entity_types: parsed.entity_types, language_notes: parsed.language_notes };

      if (!currentDomain) {
        yield { kind: "file_done", file };
        continue;
      }

      const mergedTypes = mergeEntityTypes(currentDomain.entity_types ?? [], delta.entity_types ?? []);
      currentDomain = {
        ...currentDomain,
        entity_types: mergedTypes,
        language_notes: delta.language_notes ?? currentDomain.language_notes,
        analyzed_sources_v2: true,
      };

    }
```

Replace with:

```typescript
    } else {
      if (!currentDomain) {
        yield { kind: "file_done", file };
        continue;
      }
    }
```

**Replace the Step 2 ingest loop** (lines 335–356). Old:

```typescript
    // --- Step 2: Ingest (immediate write) ---
    let retried = false;
    let done = false;
    while (!done) {
      let hadError = false;
      let caughtErr: Error | null = null;
      try {
        for await (const ev of runIngest([file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts)) {
          yield ev;
        }
        done = true;
      } catch (e) {
        hadError = true;
        caughtErr = e as Error;
      }
      if (hadError && caughtErr) {
        const canRetry = !retried;
        const choice = onFileError ? await onFileError(file, caughtErr, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        done = true;
      }
    }
```

Replace with:

```typescript
    // --- Ingest: write pages + intercept domain_updated for entity_types propagation ---
    const domainId = currentDomain.id;
    let retried = false;
    let done = false;
    while (!done) {
      let hadError = false;
      let caughtErr: Error | null = null;
      try {
        for await (const ev of runIngest([file], vaultTools, llm, model, [currentDomain], vaultTools.vaultRoot, signal, opts)) {
          yield ev;
          if (ev.kind === "domain_updated" && ev.domainId === domainId) {
            currentDomain = { ...currentDomain, ...ev.patch };
          }
        }
        done = true;
      } catch (e) {
        hadError = true;
        caughtErr = e as Error;
      }
      if (hadError && caughtErr) {
        const canRetry = !retried;
        const choice = onFileError ? await onFileError(file, caughtErr, canRetry) : "skip";
        if (choice === "stop") return;
        if (choice === "retry" && canRetry) { retried = true; continue; }
        done = true;
      }
    }
```

Note: `domainId` was previously declared inside the `else` branch scope — move the declaration above the `if/else` block or use `currentDomain.id` inline. Since `currentDomain` is always non-null at the ingest step (the `else` branch already guards for null and continues), it is safe to do `const domainId = currentDomain.id;` here.

Also **remove the now-unused imports** from `init.ts`:
- `EntityTypesDeltaSchema` from `./zod-schemas` (if only used in the delta call)
- `EntityType` from `../domain` (check if still used; it is — in the bootstrap parsed type annotation)

Check which imports become unused and remove only those that are truly unused.

- [ ] **Step 6: Run tests**

```bash
npx vitest run tests/phases/init.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: all tests PASS.

- [ ] **Step 7: Run full suite**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "feat(init): replace incremental LLM call with ingest domain_updated intercept"
```

---

## Task 6: Delete `prompts/init-incremental.md`

**Files:**
- Delete: `prompts/init-incremental.md`

- [ ] **Step 1: Delete the file**

```bash
git rm prompts/init-incremental.md
```

- [ ] **Step 2: Run full test suite to confirm no references remain**

```bash
npm test 2>&1 | tail -20
```

Expected: all tests pass (the import was already removed in Task 5).

- [ ] **Step 3: Confirm no remaining references**

```bash
grep -r "init-incremental" src/ tests/ --include="*.ts" --include="*.md"
```

Expected: no output.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(prompts): delete init-incremental.md (merged into ingest.md)"
```

---

## Task 7: Update `docs/prompt-architecture.md`

**Files:**
- Modify: `docs/prompt-architecture.md`

- [ ] **Step 1: Remove `PIN2b` and `INITINC` from prompt diagram**

In the Mermaid diagram (around line 130), remove:
```
    BASE --> PIN2b
```
and:
```
    PIN2b["init files 1+"] --> INITINC["init-incremental.md"]
```

Also remove `INITINC` from the class line (line ~158):
```
    class INGEST,QUERY,LINT,CHAT,LINTCHAT,INIT,INITINC,FORMAT prompt
```
Change to:
```
    class INGEST,QUERY,LINT,CHAT,LINTCHAT,INIT,FORMAT prompt
```

- [ ] **Step 2: Remove `init files 1…N` row from context table; update ingest row**

In `## Контекст, инжектируемый в каждый промт` table (around line 292), remove:
```
| **init** files 1…N | `init-incremental.md` + `base.md` | _(нет переменных — render не нужен)_ | `EntityTypesDeltaSchema` `{reasoning, entity_types?, language_notes?}` |
```

Update the ingest row (line ~286):
```
| **ingest** | `ingest.md` + `base.md` | `domain_name`, `entity_types_block`, `lang_notes`, `wiki_path`, `today`, `schema_block`, `source_path` | `WikiPagesOutputSchema` `{reasoning, pages[{path,content,annotation}]}` |
```
Change to:
```
| **ingest** | `ingest.md` + `base.md` | `domain_name`, `entity_types_block`, `lang_notes`, `wiki_path`, `today`, `schema_block`, `source_path` | `WikiPagesOutputSchema` `{reasoning, pages[{path,content,annotation}], entity_types_delta?}` |
```

- [ ] **Step 3: Remove `init.delta` row from callSite table**

In `Точки вызова (CallSite)` table (around line 245), remove:
```
| `init.delta` | `init.ts` files 1+ | `EntityTypesDeltaSchema` |
```

- [ ] **Step 4: Update comparative table**

Remove the `init-incremental.md` row (line ~307):
```
| `init-incremental.md` | `init`, файлы 1…N (delta) | Обнаружение новых типов сущностей в домене | Не содержит `{{переменных}}` — `render()` не нужен. Задача пересекается с потребностью `ingest` обогащать `entity_types` |
```

Update the `ingest.md` row (line ~301) — change the `Проблемы / противоречия` column:
```
| `ingest.md` | `ingest` | Извлечение экземпляров сущностей из источника → wiki-страницы | Не обогащает `entity_types` при обнаружении новых типов. Нужен отдельный `init`. Потенциальное слияние с `init-incremental.md` |
```
Change to:
```
| `ingest.md` | `ingest` | Извлечение экземпляров сущностей из источника → wiki-страницы + обогащение entity_types через `entity_types_delta?` | Теперь возвращает `entity_types_delta?` — покрывает задачу `init-incremental.md`. |
```

- [ ] **Step 5: Update `## Замечания` section**

Replace the `### init-incremental vs ingest — потенциальное слияние` section:

Old content:
```markdown
### init-incremental vs ingest — потенциальное слияние

`init-incremental.md` обнаруживает **типы** сущностей (мета-уровень).  
`ingest.md` извлекает **экземпляры** по известным типам (объектный уровень).

Сейчас два прохода: `init` строит `entity_types`, `ingest` пишет страницы.

**Идея:** дать `ingest` возможность обогащать `entity_types` инкрементально:
1. Добавить `entity_types_delta?` в `WikiPagesOutputSchema`
2. Обновить `ingest.md` — попросить LLM возвращать дельту при новых типах
3. Прокинуть сохранение домена в `ingest.ts` (сейчас `DomainStore` недоступен из фазы)
```

Replace with:
```markdown
### init-incremental vs ingest — реализовано

`ingest.md` теперь выполняет обе задачи: извлекает экземпляры сущностей (объектный уровень) и опционально обогащает `entity_types` при обнаружении новых или улучшенных типов (мета-уровень).

`init-incremental.md` удалён. `ingest.ts` эмитирует `domain_updated { entity_types }` когда LLM возвращает `entity_types_delta`. Контроллер сохраняет патч в `DomainStore` через существующий механизм `domain_updated` — изменений в контроллере не потребовалось.
```

- [ ] **Step 6: Add entry in `### ingest: entity_types_delta` secondary calls section**

After `### ingest: retry invalid paths` section (around line 275), add:

```markdown
### ingest: entity_types_delta

Если LLM возвращает `entity_types_delta` в ответе:
- `mergeEntityTypes(domain.entity_types, delta)` — merge по ключу `type`
- эмитирует `domain_updated { domainId, patch: { entity_types: merged } }`
- контроллер сохраняет патч; `runInitWithSources` интерцептирует событие для обновления `currentDomain` перед следующим файлом
```

- [ ] **Step 7: Commit**

```bash
git add docs/prompt-architecture.md
git commit -m "docs(architecture): update prompt-architecture.md — remove init-incremental, document ingest delta"
```

---

## Task 8: Final Verification

- [ ] **Step 1: Run full test suite**

```bash
npm test 2>&1 | tail -30
```

Expected: all tests PASS, no failures.

- [ ] **Step 2: Build**

```bash
npm run build 2>&1 | tail -10
```

Expected: clean build, no errors.

- [ ] **Step 3: Verify no dead references to `init-incremental`**

```bash
grep -r "init-incremental\|initIncremental\|init\.delta\|EntityTypesDeltaSchema.*init" src/ tests/ --include="*.ts" | grep -v "lint"
```

Expected: no output (lint still uses `EntityTypesDeltaSchema` via `actualizeDomainConfig` — that's correct and unrelated).

- [ ] **Step 4: Verify `mergeEntityTypes` is only exported from `domain.ts`**

```bash
grep -rn "export function mergeEntityTypes\|export.*mergeEntityTypes" src/ --include="*.ts"
```

Expected: only one match in `src/domain.ts`.

- [ ] **Step 5: Commit summary (if any leftover changes)**

If everything is clean, no commit needed — all changes committed per task.
