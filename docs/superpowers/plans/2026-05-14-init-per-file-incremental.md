# Init Per-File Incremental Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `runInitWithSources` Phase 1 to call LLM once per source file, accumulating `entity_types` incrementally, instead of sampling 10 files in a single call.

**Architecture:** Bootstrap on file_0 (full `DomainEntry` from `initTemplate`), then per-file incremental LLM calls (delta `entity_types` from `initIncrementalTemplate`) merged via `mergeEntityTypes`. Resume support via `analyzed_sources` field on `DomainEntry`. Phase 2 (ingest) unchanged.

**Tech Stack:** TypeScript, Vitest, OpenAI-compatible streaming LLM client.

---

## File Map

| File | Change |
|---|---|
| `src/types.ts` | Add `phase?` to `init_start`/`file_start`/`file_done`; expand `domain_updated` patch |
| `src/domain.ts` | Add `analyzed_sources?: string[]` to `DomainEntry` |
| `prompts/init-incremental.md` | New — incremental entity_types prompt |
| `src/phases/init.ts` | Rewrite `runInitWithSources` Phase 1; add `mergeEntityTypes`; add resume logic |
| `src/view.ts` | Handle second `init_start` (reset counter + phase label) |
| `tests/phases/init.test.ts` | Add all new test cases per spec |

---

## Task 1: Type Changes

**Files:**
- Modify: `src/types.ts:51-55`
- Modify: `src/domain.ts:12-19`

- [ ] **Step 1: Expand `domain_updated` patch type and add `phase?` fields in `src/types.ts`**

Replace lines 51–55:
```typescript
  | { kind: "domain_updated"; domainId: string; patch: { entity_types?: EntityType[]; language_notes?: string; wiki_folder?: string; analyzed_sources?: string[] } }
  | { kind: "eval_result"; score: number; reasoning: string }
  | { kind: "init_start"; totalFiles: number; phase?: "analysis" | "ingest" }
  | { kind: "file_start"; file: string; index: number; total: number; phase?: "analysis" | "ingest" }
  | { kind: "file_done"; file: string; phase?: "analysis" | "ingest" }
```

- [ ] **Step 2: Add `analyzed_sources` to `DomainEntry` in `src/domain.ts`**

Replace the `DomainEntry` interface:
```typescript
export interface DomainEntry {
  id: string;
  name: string;
  wiki_folder: string;
  source_paths?: string[];
  entity_types?: EntityType[];
  language_notes?: string;
  analyzed_sources?: string[];
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npm run build`
Expected: no errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts src/domain.ts
git commit -m "feat(types): add phase? to init events; expand domain_updated patch; add analyzed_sources to DomainEntry"
```

---

## Task 2: Incremental Prompt

**Files:**
- Create: `prompts/init-incremental.md`

- [ ] **Step 1: Create `prompts/init-incremental.md`**

```markdown
Ты — аналитик wiki-базы знаний. Обнови список entity_types на основе нового файла источника.

Тебе дан:
- Содержимое одного файла источника
- Текущий список entity_types (JSON)

Верни ТОЛЬКО валидный JSON следующей структуры:
{
  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"..."}],
  "language_notes": "..."
}

Правила:
- `entity_types`: добавь новые типы, уточни существующие. Не меняй поле `type` (id). Если изменений нет — верни текущий список без изменений.
- `language_notes`: обнови если файл показывает новые языковые конвенции. Если нечего добавить — пропусти поле.
- Никаких других полей. Никаких пояснений. Только JSON.
```

- [ ] **Step 2: Commit**

```bash
git add prompts/init-incremental.md
git commit -m "feat(prompts): add init-incremental.md for per-file entity_types accumulation"
```

---

## Task 3: `mergeEntityTypes` — TDD

**Files:**
- Modify: `tests/phases/init.test.ts`
- Modify: `src/phases/init.ts`

- [ ] **Step 1: Write failing tests for `mergeEntityTypes`**

Add to `tests/phases/init.test.ts` (after existing imports, add the exported function import):
```typescript
import { runInit, mergeEntityTypes } from "../../src/phases/init";
```

Add a new describe block at the bottom of the file:
```typescript
describe("mergeEntityTypes", () => {
  it("appends new type from incoming", () => {
    const current = [{ type: "person", description: "A person", extraction_cues: [] }];
    const incoming = [{ type: "company", description: "A company", extraction_cues: [] }];
    const result = mergeEntityTypes(current, incoming);
    expect(result).toHaveLength(2);
    expect(result.map(e => e.type)).toContain("company");
  });

  it("overrides existing type when incoming has same type id", () => {
    const current = [{ type: "person", description: "Old", extraction_cues: ["old cue"] }];
    const incoming = [{ type: "person", description: "New", extraction_cues: ["new cue"] }];
    const result = mergeEntityTypes(current, incoming);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe("New");
    expect(result[0].extraction_cues).toEqual(["new cue"]);
  });

  it("returns current unchanged when incoming is empty", () => {
    const current = [{ type: "person", description: "A person", extraction_cues: [] }];
    const result = mergeEntityTypes(current, []);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("person");
  });

  it("returns incoming when current is empty", () => {
    const incoming = [{ type: "company", description: "A company", extraction_cues: [] }];
    const result = mergeEntityTypes([], incoming);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("company");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: FAIL — `mergeEntityTypes is not exported`

- [ ] **Step 3: Implement and export `mergeEntityTypes` in `src/phases/init.ts`**

Add after the imports in `src/phases/init.ts`:
```typescript
export function mergeEntityTypes(current: EntityType[], incoming: EntityType[]): EntityType[] {
  const map = new Map(current.map(e => [e.type, e]));
  for (const e of incoming) map.set(e.type, e);
  return [...map.values()];
}
```

Add the `EntityType` import. In `src/phases/init.ts` line 2, change:
```typescript
import type { DomainEntry } from "../domain";
```
to:
```typescript
import type { DomainEntry, EntityType } from "../domain";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: PASS (4 new tests + all existing)

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "feat(init): export mergeEntityTypes with full test coverage"
```

---

## Task 4: Phase 1 Bootstrap (file_0) — TDD

**Files:**
- Modify: `tests/phases/init.test.ts`
- Modify: `src/phases/init.ts`

### Setup

The new `runInitWithSources` needs to call LLM once per file, so tests need a multi-response mock. Add helper to `tests/phases/init.test.ts` after existing `makeLlm`:

```typescript
function makeMultiLlm(responses: string[]): LlmClient {
  let callIndex = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          const json = responses[callIndex] ?? responses[responses.length - 1];
          callIndex++;
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content: json } }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
}
```

Also add mock adapter helper that provides source files:
```typescript
function mockAdapterWithSources(files: Record<string, string>): VaultAdapter {
  return mockAdapter({
    list: vi.fn().mockImplementation(async (path: string) => {
      const all = Object.keys(files);
      const filtered = path === "" ? all : all.filter(f => f.startsWith(path));
      return { files: filtered, folders: [] };
    }),
    read: vi.fn().mockImplementation(async (path: string) => {
      if (path in files) return files[path];
      return "";
    }),
  });
}
```

- [ ] **Step 1: Write failing tests for Phase 1 bootstrap**

Add to `tests/phases/init.test.ts`:
```typescript
describe("runInitWithSources — Phase 1 bootstrap", () => {
  const bootstrapDomainJson = JSON.stringify({
    id: "testdomain",
    name: "Test Domain",
    wiki_folder: "testdomain",
    source_paths: [],
    entity_types: [{ type: "concept", description: "A concept", extraction_cues: ["concept"] }],
    language_notes: "English",
  });

  const sourceFiles = {
    "sources/file0.md": "Content of file 0",
  };

  it("emits init_start { phase: 'analysis' } before bootstrap", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const initStart = events.find((e: any) => e.kind === "init_start") as any;
    expect(initStart).toBeDefined();
    expect(initStart.phase).toBe("analysis");
    expect(initStart.totalFiles).toBe(1);
  });

  it("new domain → emits domain_created with full entry and source_paths from args", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const created = events.find((e: any) => e.kind === "domain_created") as any;
    expect(created).toBeDefined();
    expect(created.entry.id).toBe("testdomain");
    expect(created.entry.source_paths).toContain("sources");
    expect(created.entry.entity_types).toHaveLength(1);
  });

  it("existing domain → emits domain_updated with patch { entity_types, language_notes, wiki_folder, analyzed_sources: [] }", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const existing: DomainEntry = { id: "testdomain", name: "Existing", wiki_folder: "old" };
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [existing], "TestVault", new AbortController().signal),
    );
    // First domain_updated is the bootstrap patch (before clear event)
    const bootstrapUpdate = events.find((e: any) => e.kind === "domain_updated" && Array.isArray(e.patch?.analyzed_sources)) as any;
    expect(bootstrapUpdate).toBeDefined();
    expect(bootstrapUpdate.patch.entity_types).toBeDefined();
    expect(bootstrapUpdate.patch.language_notes).toBeDefined();
    expect(bootstrapUpdate.patch.wiki_folder).toBeDefined();
    expect(bootstrapUpdate.patch.analyzed_sources).toEqual([]);
    expect(events.some((e: any) => e.kind === "domain_created")).toBe(false);
  });

  it("emits file_start { index: 0, phase: 'analysis' } and file_done { phase: 'analysis' } for file_0", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["testdomain", "--sources", "sources"], vt, makeMultiLlm([bootstrapDomainJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const fileStart = events.find((e: any) => e.kind === "file_start") as any;
    const fileDone = events.find((e: any) => e.kind === "file_done") as any;
    expect(fileStart?.index).toBe(0);
    expect(fileStart?.phase).toBe("analysis");
    expect(fileDone?.phase).toBe("analysis");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: FAIL — bootstrap tests fail (current code does batch LLM, not per-file)

- [ ] **Step 3: Rewrite `runInitWithSources` — Phase 1 bootstrap portion**

Replace the entire `runInitWithSources` function body in `src/phases/init.ts` with the new implementation. Add the import at the top:

```typescript
import initIncrementalTemplate from "../../prompts/init-incremental.md";
```

New `runInitWithSources` skeleton — bootstrap portion (Phase 1, file_0 only at this step):

```typescript
async function* runInitWithSources(
  domainId: string,
  sourcePaths: string[],
  dryRun: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultName: string,
  signal: AbortSignal,
  opts: LlmCallOptions,
  onFileError: OnFileError | undefined,
): AsyncGenerator<RunEvent> {
  const start = Date.now();
  const wikiRootGuess = `!Wiki`;

  await ensureRootFiles(vaultTools, wikiRootGuess);

  const allVaultFiles = await vaultTools.listFiles("");
  const sourceFiles = allVaultFiles.filter(
    (f) => f.endsWith(".md") && sourcePaths.some((sp) => f.startsWith(sp)),
  );

  if (!sourceFiles.length) {
    yield { kind: "error", message: `No .md files found in source paths: ${sourcePaths.join(", ")}` };
    return;
  }

  const existing = domains.find((d) => d.id === domainId);

  // Determine which files to analyze (resume support)
  // isResuming = analyzed_sources defined (even []) means bootstrap was done; skip it
  const isResuming = existing?.analyzed_sources !== undefined;
  const alreadyAnalyzed = new Set(existing?.analyzed_sources ?? []);
  const toAnalyze = isResuming
    ? sourceFiles.filter(f => !alreadyAnalyzed.has(f))
    : sourceFiles;

  // --- Phase 1: Analysis ---
  yield { kind: "init_start", totalFiles: toAnalyze.length, phase: "analysis" };

  const [schemaContent, indexContent] = await Promise.all([
    tryRead(vaultTools, `${wikiRootGuess}/_wiki_schema.md`),
    tryRead(vaultTools, `${wikiRootGuess}/_index.md`),
  ]);

  // Bootstrap determines current domain state (either existing or created from file_0)
  let currentDomain: DomainEntry | null = existing ?? null;

  for (let i = 0; i < toAnalyze.length; i++) {
    if (signal.aborted) {
      // Persist current analyzed_sources state before stopping
      if (currentDomain) {
        yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
        yield { kind: "domain_updated", domainId, patch: { analyzed_sources: currentDomain.analyzed_sources } };
        yield { kind: "tool_result", ok: true };
      }
      return;
    }

    const file = toAnalyze[i];
    yield { kind: "file_start", file, index: i, total: toAnalyze.length, phase: "analysis" };

    // Read file content
    let fileContent: string;
    try {
      fileContent = await vaultTools.read(file);
    } catch {
      yield { kind: "assistant_text", delta: `⚠ ${file}: не удалось прочитать файл, пропускаем\n` };
      yield { kind: "file_done", file, phase: "analysis" };
      continue;
    }

    // Truncation warning
    if (fileContent.length > 8_000) {
      yield { kind: "assistant_text", delta: `⚠ ${file}: truncated to 8 000 chars (original: ${fileContent.length} chars)\n` };
    }
    const truncated = fileContent.slice(0, 8_000);

    if (i === 0 && !isResuming) {
      // Bootstrap: use initTemplate to get full DomainEntry
      const systemContent = render(initTemplate, {
        domain_id: domainId,
        vault_name: vaultName,
        schema_block: schemaContent ? `\nКонвенции вики (_wiki_schema.md):\n${schemaContent.slice(0, 1500)}` : "",
        index_block: indexContent ? `\nСуществующая структура (_index.md):\n${indexContent.slice(0, 1000)}` : "",
      });

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: `Domain ID: ${domainId}\nVault name: ${vaultName}\nSource paths: ${sourcePaths.join(", ")}\n\n${file}:\n${truncated}`,
        },
      ];

      let fullText = "";
      try {
        const params = buildChatParams(model, messages, opts);
        const stream = await llm.chat.completions.create(
          { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          { signal },
        );
        for await (const chunk of stream) {
          const { reasoning, content } = extractStreamDeltas(chunk);
          if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
          if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
        }
      } catch (e) {
        if (signal.aborted || (e as Error).name === "AbortError") return;
        const params = buildChatParams(model, messages, opts);
        const resp = await llm.chat.completions.create(
          { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        );
        fullText = resp.choices[0]?.message?.content ?? "";
        if (fullText) yield { kind: "assistant_text", delta: fullText };
      }

      if (signal.aborted) return;

      let entry: DomainEntry;
      try {
        const match = fullText.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON object found");
        entry = JSON.parse(match[0]) as DomainEntry;
        const vaultPrefix = `vaults/${vaultName}/`;
        if (entry.wiki_folder?.startsWith(vaultPrefix)) entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
        if (entry.wiki_folder?.startsWith("!Wiki/")) entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
        if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
      } catch {
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем bootstrap\n` };
        yield { kind: "file_done", file, phase: "analysis" };
        continue;
      }

      if (dryRun) {
        yield {
          kind: "result",
          durationMs: Date.now() - start,
          text: `Dry run — domain entry:\n\`\`\`json\n${JSON.stringify(entry, null, 2)}\n\`\`\``,
        };
        return;
      }

      currentDomain = {
        ...(existing ?? { id: domainId, name: entry.name }),
        wiki_folder: entry.wiki_folder,
        entity_types: entry.entity_types,
        language_notes: entry.language_notes,
        source_paths: sourcePaths,
        analyzed_sources: [],
      };

      yield { kind: "tool_use", name: existing ? "UpdateDomain" : "SaveDomain", input: { id: domainId } };
      if (existing) {
        yield {
          kind: "domain_updated", domainId,
          patch: { entity_types: currentDomain.entity_types, language_notes: currentDomain.language_notes, wiki_folder: currentDomain.wiki_folder, analyzed_sources: [] },
        };
      } else {
        yield { kind: "domain_created", entry: currentDomain };
      }
      yield { kind: "tool_result", ok: true };

    } else {
      // Incremental: use initIncrementalTemplate to get delta entity_types
      const currentEntityTypes = currentDomain?.entity_types ?? [];
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: initIncrementalTemplate },
        {
          role: "user",
          content: `Текущие entity_types:\n${JSON.stringify(currentEntityTypes, null, 2)}\n\nФайл: ${file}\n\n${truncated}`,
        },
      ];

      let fullText = "";
      try {
        const params = buildChatParams(model, messages, opts);
        const stream = await llm.chat.completions.create(
          { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
          { signal },
        );
        for await (const chunk of stream) {
          const { reasoning, content } = extractStreamDeltas(chunk);
          if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
          if (content) { fullText += content; }
        }
      } catch (e) {
        if (signal.aborted || (e as Error).name === "AbortError") return;
        const params = buildChatParams(model, messages, opts);
        const resp = await llm.chat.completions.create(
          { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        );
        fullText = resp.choices[0]?.message?.content ?? "";
      }

      if (signal.aborted) return;

      let delta: { entity_types?: EntityType[]; language_notes?: string };
      try {
        const match = fullText.match(/\{[\s\S]*\}/);
        if (!match) throw new Error("No JSON");
        delta = JSON.parse(match[0]) as { entity_types?: EntityType[]; language_notes?: string };
      } catch {
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем\n` };
        yield { kind: "file_done", file, phase: "analysis" };
        continue;
      }

      if (!currentDomain) {
        yield { kind: "file_done", file, phase: "analysis" };
        continue;
      }

      const mergedTypes = mergeEntityTypes(currentDomain.entity_types ?? [], delta.entity_types ?? []);
      currentDomain = {
        ...currentDomain,
        entity_types: mergedTypes,
        language_notes: delta.language_notes ?? currentDomain.language_notes,
        analyzed_sources: [...(currentDomain.analyzed_sources ?? []), file],
      };

      yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
      yield {
        kind: "domain_updated", domainId,
        patch: {
          entity_types: currentDomain.entity_types,
          language_notes: currentDomain.language_notes,
          analyzed_sources: currentDomain.analyzed_sources,
        },
      };
      yield { kind: "tool_result", ok: true };
    }

    yield { kind: "file_done", file, phase: "analysis" };
  }

  // Phase 1 complete — always clear analyzed_sources progress marker (even if empty [])
  if (currentDomain) {
    yield { kind: "tool_use", name: "UpdateDomain", input: { id: domainId } };
    yield { kind: "domain_updated", domainId, patch: { analyzed_sources: undefined } };
    yield { kind: "tool_result", ok: true };
  }

  if (!currentDomain) {
    yield { kind: "error", message: `init --sources: не удалось создать домен из файлов` };
    return;
  }

  // --- Phase 2: Ingest ---
  yield { kind: "init_start", totalFiles: sourceFiles.length, phase: "ingest" };
  yield { kind: "assistant_text", delta: `\nCreating wiki pages from ${sourceFiles.length} source files...\n` };

  for (let i = 0; i < sourceFiles.length; i++) {
    if (signal.aborted) return;
    const file = sourceFiles[i];
    yield { kind: "file_start", file, index: i, total: sourceFiles.length };

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

    yield { kind: "file_done", file };
  }

  await appendLog(vaultTools, wikiRootGuess, domainId);

  yield {
    kind: "result",
    durationMs: Date.now() - start,
    text: `Domain "${domainId}" initialised from ${sourceFiles.length} source files.`,
  };
}
```

- [ ] **Step 4: Run bootstrap tests to verify they pass**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: all bootstrap tests pass; existing tests still pass

- [ ] **Step 5: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts
git commit -m "feat(init): rewrite Phase 1 with per-file incremental LLM calls and bootstrap"
```

---

## Task 5: Incremental Loop Tests

**Files:**
- Modify: `tests/phases/init.test.ts`

- [ ] **Step 1: Write tests for incremental accumulation (file_1..N-1)**

Add to `tests/phases/init.test.ts`:
```typescript
describe("runInitWithSources — Phase 1 incremental", () => {
  const bootstrapJson = JSON.stringify({
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: ["concept"] }],
    language_notes: "",
  });

  const incrementalJson1 = JSON.stringify({
    entity_types: [
      { type: "concept", description: "Refined concept", extraction_cues: ["refined"] },
      { type: "person", description: "A person", extraction_cues: ["person"] },
    ],
  });

  const incrementalJson2 = JSON.stringify({
    entity_types: [
      { type: "place", description: "A place", extraction_cues: ["location"] },
    ],
    language_notes: "Russian",
  });

  const sourceFiles = {
    "src/a.md": "content a",
    "src/b.md": "content b",
    "src/c.md": "content c",
  };

  it("emits domain_updated after each incremental file with merged entity_types", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    const updates = events.filter((e: any) => e.kind === "domain_updated" && e.patch?.entity_types) as any[];
    // 2 incremental updates + final clear
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("entity_types accumulate correctly — later files merge on top of earlier", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    // Find last domain_updated with entity_types before clear (analyzed_sources: undefined)
    const updatesWithTypes = events.filter((e: any) => e.kind === "domain_updated" && e.patch?.entity_types !== undefined) as any[];
    const last = updatesWithTypes[updatesWithTypes.length - 1];
    const types = last.patch.entity_types.map((e: any) => e.type);
    expect(types).toContain("concept");
    expect(types).toContain("person");
    expect(types).toContain("place");
    // concept should be refined (from incrementalJson1)
    const concept = last.patch.entity_types.find((e: any) => e.type === "concept");
    expect(concept.description).toBe("Refined concept");
  });

  it("emits file_start { phase: 'analysis' } and file_done { phase: 'analysis' } for each incremental file", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    const fileStarts = events.filter((e: any) => e.kind === "file_start" && e.phase === "analysis") as any[];
    const fileDones = events.filter((e: any) => e.kind === "file_done" && e.phase === "analysis") as any[];
    expect(fileStarts).toHaveLength(3);
    expect(fileDones).toHaveLength(3);
  });

  it("emits init_start { phase: 'ingest' } before Phase 2 loop", async () => {
    const adapter = mockAdapterWithSources(sourceFiles);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson1, incrementalJson2]), "model", [], "TestVault", new AbortController().signal),
    );
    const initStarts = events.filter((e: any) => e.kind === "init_start") as any[];
    expect(initStarts).toHaveLength(2);
    expect(initStarts[0].phase).toBe("analysis");
    expect(initStarts[1].phase).toBe("ingest");
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add tests/phases/init.test.ts
git commit -m "test(init): add incremental accumulation and Phase 2 init_start tests"
```

---

## Task 6: Error Handling Tests

**Files:**
- Modify: `tests/phases/init.test.ts`

- [ ] **Step 1: Write failing tests for error handling and truncation**

Add to `tests/phases/init.test.ts`:
```typescript
describe("runInitWithSources — error handling", () => {
  const bootstrapJson = JSON.stringify({
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
    language_notes: "",
  });

  it("skips unreadable file in Phase 1 and continues with next file", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["src/a.md", "src/b.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (path: string) => {
        if (path === "src/a.md") return "content a";
        if (path === "src/b.md") throw new Error("Permission denied");
        return "";
      }),
    });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    // Should complete (reach result) and emit warning for b.md
    const warnings = events.filter((e: any) => e.kind === "assistant_text" && e.delta?.includes("src/b.md")) as any[];
    expect(warnings.length).toBeGreaterThan(0);
    // No error event (phase just skips the file)
    const analysisErrors = events.filter((e: any) => e.kind === "error");
    expect(analysisErrors).toHaveLength(0);
  });

  it("skips file when LLM returns invalid JSON and does NOT add it to analyzed_sources", async () => {
    const adapter = mockAdapterWithSources({ "src/a.md": "content a", "src/b.md": "content b" });
    const vt = new VaultTools(adapter, "/vault");
    const invalidJson = "not json at all";
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, invalidJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const domainUpdatesWithSources = events.filter(
      (e: any) => e.kind === "domain_updated" && Array.isArray(e.patch?.analyzed_sources)
    ) as any[];
    // b.md (invalid JSON) should NOT be in analyzed_sources
    for (const upd of domainUpdatesWithSources) {
      expect(upd.patch.analyzed_sources).not.toContain("src/b.md");
    }
  });

  it("emits assistant_text truncation warning when file exceeds 8000 chars", async () => {
    const longContent = "x".repeat(8_001);
    const adapter = mockAdapterWithSources({ "src/a.md": longContent });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const warning = events.find(
      (e: any) => e.kind === "assistant_text" && e.delta?.includes("truncated to 8 000 chars")
    ) as any;
    expect(warning).toBeDefined();
    expect(warning.delta).toContain("src/a.md");
  });

  it("does NOT emit truncation warning when file is exactly 8000 chars", async () => {
    const exactContent = "x".repeat(8_000);
    const adapter = mockAdapterWithSources({ "src/a.md": exactContent });
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const warning = events.find(
      (e: any) => e.kind === "assistant_text" && e.delta?.includes("truncated to 8 000 chars")
    );
    expect(warning).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: all pass (implementation already handles these cases)

- [ ] **Step 3: Commit**

```bash
git add tests/phases/init.test.ts
git commit -m "test(init): add Phase 1 error handling and truncation warning tests"
```

---

## Task 7: Resume Logic Tests

**Files:**
- Modify: `tests/phases/init.test.ts`

- [ ] **Step 1: Write tests for resume and analyzed_sources clearing**

Add to `tests/phases/init.test.ts`:
```typescript
describe("runInitWithSources — resume logic", () => {
  const bootstrapJson = JSON.stringify({
    id: "dom",
    name: "Dom",
    wiki_folder: "dom",
    source_paths: [],
    entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
    language_notes: "",
  });

  const incrementalJson = JSON.stringify({
    entity_types: [{ type: "person", description: "Person", extraction_cues: [] }],
  });

  it("skips files already in analyzed_sources and resumes from next file", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b", "src/c.md": "c" };
    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");
    // Domain already has a.md and b.md analyzed
    const existingWithProgress: DomainEntry = {
      id: "dom", name: "Dom", wiki_folder: "dom",
      entity_types: [{ type: "concept", description: "Concept", extraction_cues: [] }],
      analyzed_sources: ["src/a.md", "src/b.md"],
    };
    const llm = makeMultiLlm([incrementalJson]); // only 1 call expected (c.md)
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [existingWithProgress], "TestVault", new AbortController().signal),
    );
    const fileStarts = events.filter((e: any) => e.kind === "file_start" && e.phase === "analysis") as any[];
    expect(fileStarts).toHaveLength(1);
    expect(fileStarts[0].file).toBe("src/c.md");
  });

  it("clears analyzed_sources after successful Phase 1 (emits domain_updated with analyzed_sources: undefined)", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b" };
    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, makeMultiLlm([bootstrapJson, incrementalJson]), "model", [], "TestVault", new AbortController().signal),
    );
    const clearEvent = events.find(
      (e: any) => e.kind === "domain_updated" && "analyzed_sources" in e.patch && e.patch.analyzed_sources === undefined
    ) as any;
    expect(clearEvent).toBeDefined();
  });

  it("abort during Phase 1 stops loop and persists current analyzed_sources", async () => {
    const files = { "src/a.md": "a", "src/b.md": "b", "src/c.md": "c" };
    const ac = new AbortController();
    let callCount = 0;
    // Abort after bootstrap call (a.md), before b.md
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            if (callCount === 1) {
              return Promise.resolve({
                [Symbol.asyncIterator]: async function* () {
                  yield { choices: [{ delta: { content: bootstrapJson } }] };
                },
              });
            }
            // Second call (b.md incremental) — abort before returning
            ac.abort();
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content: incrementalJson } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;
    const adapter = mockAdapterWithSources(files);
    const vt = new VaultTools(adapter, "/vault");
    const events = await collect(
      runInit(["dom", "--sources", "src"], vt, llm, "model", [], "TestVault", ac.signal),
    );
    // No final result event (aborted before Phase 2)
    expect(events.some((e: any) => e.kind === "result")).toBe(false);
    // No Phase 2 init_start event
    expect(events.filter((e: any) => e.kind === "init_start" && e.phase === "ingest")).toHaveLength(0);
    // analyzed_sources persisted at abort point
    const persistEvent = events.find(
      (e: any) => e.kind === "domain_updated" && Array.isArray(e.patch?.analyzed_sources)
    ) as any;
    expect(persistEvent).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/phases/init.test.ts`
Expected: all pass

- [ ] **Step 3: Commit**

```bash
git add tests/phases/init.test.ts
git commit -m "test(init): add resume logic and analyzed_sources clearing tests"
```

---

## Task 8: View Changes

**Files:**
- Modify: `src/view.ts`

- [ ] **Step 1: Add `progressPhaseEl` field to `LlmWikiView` class**

In `src/view.ts`, after line 70 (`private progressDone = 0;`), add:
```typescript
  private progressPhaseEl: HTMLElement | null = null;
```

- [ ] **Step 2: Reset `progressPhaseEl` in `onStart()` method**

Find the block in `onStart()` (around line 286–288) that resets progressEl:
```typescript
    this.progressEl = null;
    this.progressTotal = 0;
    this.progressDone = 0;
```
Change to:
```typescript
    this.progressEl = null;
    this.progressPhaseEl = null;
    this.progressTotal = 0;
    this.progressDone = 0;
```

- [ ] **Step 3: Update `init_start` handler to support phase label and second-phase reset**

Find the `init_start` handler (around line 312–321):
```typescript
    if (ev.kind === "init_start") {
      this.progressTotal = ev.totalFiles;
      this.progressDone = 0;
      const step = this.stepsEl.createDiv("ai-wiki-step ai-wiki-progress");
      step.createSpan({ cls: "ai-wiki-step-icon" }).setText("📂");
      this.progressEl = step.createSpan({ cls: "ai-wiki-progress-text" });
      this.progressEl.setText(`0 / ${ev.totalFiles} файлов`);
      this.scrollSteps();
      return;
    }
```

Replace with:
```typescript
    if (ev.kind === "init_start") {
      this.progressTotal = ev.totalFiles;
      this.progressDone = 0;
      if (this.progressEl) {
        // Second init_start (Phase 2) — reset existing elements in place
        this.progressEl.setText(`0 / ${ev.totalFiles} файлов`);
        if (this.progressPhaseEl) {
          const label = ev.phase === "ingest" ? "Ingesting files…" : "Analysing files…";
          this.progressPhaseEl.setText(label);
        }
      } else {
        const step = this.stepsEl.createDiv("ai-wiki-step ai-wiki-progress");
        step.createSpan({ cls: "ai-wiki-step-icon" }).setText("📂");
        const label = ev.phase === "ingest" ? "Ingesting files…" : "Analysing files…";
        this.progressPhaseEl = step.createSpan({ cls: "ai-wiki-progress-phase" });
        this.progressPhaseEl.setText(label);
        this.progressEl = step.createSpan({ cls: "ai-wiki-progress-text" });
        this.progressEl.setText(`0 / ${ev.totalFiles} файлов`);
      }
      this.scrollSteps();
      return;
    }
```

- [ ] **Step 4: Build and verify no TypeScript errors**

Run: `npm run build`
Expected: successful build

- [ ] **Step 5: Run full test suite**

Run: `npm test`
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/view.ts
git commit -m "feat(view): show phase label on init_start; reset progress bar for Phase 2"
```

---

## Task 9: Final Verification

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: all tests pass, no regressions

- [ ] **Step 2: Verify build**

Run: `npm run build`
Expected: `main.js` produced without errors

- [ ] **Step 3: Commit if any cleanup needed**

```bash
git add -p
git commit -m "chore(init): cleanup after per-file incremental implementation"
```
