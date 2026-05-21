---
review:
  plan_hash: 19497734a358c0db
  spec_hash: 49ad7681ac415a09
  last_run: 2026-05-20
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  section_hashes:
    file_map:    3537c5cf6c211c97
    task1:       4c667d445559d63a
    task2:       8c002af1add79672
    task3:       a74c14458ef3e428
    task4:       9c6846c03e9fafdb
    self_review: e2c9b2c6476a2be2
  findings:
    - id: F-001
      phase: verifiability
      severity: WARNING
      section: Task 4 / Step 1
      section_hash: 9c6846c03e9fafdb
      text: >
        Task 4 Step 1 test uses `makeLlmSequence([bad, bad])` but this helper is not defined
        in the step. If it doesn't exist in tests/phases/format.test.ts, the test will fail
        with an import/reference error at runtime.
      verdict: wontfix
      verdict_note: "makeLlmSequence exists in tests/phases/format.test.ts:38"
      verdict_at: 2026-05-20
    - id: F-002
      phase: consistency
      severity: WARNING
      section: Self-Review / Design §2
      section_hash: e2c9b2c6476a2be2
      text: >
        Spec §Design/2 says parseJsonPages "not exported from phase modules"; plan Self-Review
        said "parseJsonPages still exported from src/phases/ingest.ts" without clarification.
        Ambiguous wording could mislead implementor.
      verdict: fixed
      verdict_note: "Self-Review item updated: clarifies spec means no other phase imports it, ingest.ts export stays"
      verdict_at: 2026-05-20
---

# Agent Stability Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace silent-failure JSON parsing in ingest and lint-fix with Zod-validated `parseWithRetry`; merge lint assess+fix into one CoT+Structured call; add Zod validation to format's custom retry loop.

**Architecture:** Four independent changes sharing the same `zod-schemas.ts` foundation. Task 1 (schemas + CallSite) must land first; Tasks 2–4 can run in parallel after that. Each task adds Zod where there was none, wires `structuralErrorCounter`, and updates the matching test file.

**Tech Stack:** TypeScript, Vitest, Zod (`z` from `"zod"`), existing `parseWithRetry` / `structuralErrorCounter` infrastructure.

---

## File Map

| File | What changes |
|---|---|
| `src/phases/zod-schemas.ts` | Add `WikiPageSchema`, `WikiPagesOutputSchema`, `LintOutputSchema`, `FormatOutputSchema` + their inferred types |
| `src/phases/parse-with-retry.ts` | Add `"ingest.pages"` and `"format.output"` to `CallSite` union |
| `src/phases/ingest.ts` | Replace streaming+`parseJsonPages` with `parseWithRetry(WikiPagesOutputSchema)` |
| `src/phases/lint.ts` | Merge assess+fix into single `parseWithRetry(LintOutputSchema)` call; add per-page progress yield; remove `buildFixMessages` |
| `src/phases/format.ts` | Replace `extractJsonObject()` with `parseStructured()` + `FormatOutputSchema.safeParse()` + `structuralErrorCounter.record()` |
| `prompts/ingest.md` | Change output from raw JSON array to `{reasoning, pages}` object |
| `prompts/lint.md` | Change output from Markdown to `{reasoning, report, fixes}` object |
| `tests/phases/ingest.test.ts` | Update `makeLlm` responses to return `{reasoning, pages}` format |
| `tests/phases/lint.test.ts` | Update `makeLlm` from 3-call to 2-call sequence |
| `tests/phases/format.test.ts` | Verify Zod failure path triggers `structuralErrorCounter` |

---

## Task 1: Schemas + CallSite extensions

**Files:**
- Modify: `src/phases/zod-schemas.ts`
- Modify: `src/phases/parse-with-retry.ts`
- Test: `tests/phases/zod-schemas.test.ts`

- [ ] **Step 1: Write failing tests for new schemas**

Add to `tests/phases/zod-schemas.test.ts`:

```ts
import { WikiPageSchema, WikiPagesOutputSchema, LintOutputSchema, FormatOutputSchema } from "../../src/phases/zod-schemas";

describe("WikiPageSchema", () => {
  it("accepts page with all fields", () => {
    const result = WikiPageSchema.safeParse({ path: "a/b.md", content: "# B", annotation: "desc" });
    expect(result.success).toBe(true);
  });
  it("accepts page without annotation", () => {
    const result = WikiPageSchema.safeParse({ path: "a/b.md", content: "# B" });
    expect(result.success).toBe(true);
  });
  it("rejects page missing content", () => {
    const result = WikiPageSchema.safeParse({ path: "a/b.md" });
    expect(result.success).toBe(false);
  });
});

describe("WikiPagesOutputSchema", () => {
  it("accepts valid output", () => {
    const result = WikiPagesOutputSchema.safeParse({
      reasoning: "Extracted 2 entities.",
      pages: [{ path: "!Wiki/d/e/A.md", content: "# A" }],
    });
    expect(result.success).toBe(true);
  });
  it("accepts empty pages array", () => {
    const result = WikiPagesOutputSchema.safeParse({ reasoning: "nothing to extract", pages: [] });
    expect(result.success).toBe(true);
  });
  it("rejects missing reasoning", () => {
    const result = WikiPagesOutputSchema.safeParse({ pages: [] });
    expect(result.success).toBe(false);
  });
});

describe("LintOutputSchema", () => {
  it("accepts valid output", () => {
    const result = LintOutputSchema.safeParse({
      reasoning: "Found 1 dead link.",
      report: "## Lint Report\n- dead link in A.md",
      fixes: [{ path: "!Wiki/d/e/A.md", content: "# A\nFixed." }],
    });
    expect(result.success).toBe(true);
  });
  it("accepts empty fixes", () => {
    const result = LintOutputSchema.safeParse({ reasoning: "ok", report: "All good.", fixes: [] });
    expect(result.success).toBe(true);
  });
  it("rejects missing report", () => {
    const result = LintOutputSchema.safeParse({ reasoning: "ok", fixes: [] });
    expect(result.success).toBe(false);
  });
});

describe("FormatOutputSchema", () => {
  it("accepts valid output", () => {
    const result = FormatOutputSchema.safeParse({ report: "## Changes\n- added tags", formatted: "---\ntags: []\n---\n# Page" });
    expect(result.success).toBe(true);
  });
  it("rejects missing formatted", () => {
    const result = FormatOutputSchema.safeParse({ report: "ok" });
    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/phases/zod-schemas.test.ts
```

Expected: FAIL — `WikiPageSchema`, `WikiPagesOutputSchema`, `LintOutputSchema`, `FormatOutputSchema` not exported.

- [ ] **Step 3: Add schemas to `src/phases/zod-schemas.ts`**

Append after the existing `LintChatSchema` block (before the type exports at line 40):

```ts
export const WikiPageSchema = z.object({
  path: z.string(),
  content: z.string(),
  annotation: z.string().optional(),
});

export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
});

export const LintOutputSchema = z.object({
  reasoning: z.string(),
  report: z.string(),
  fixes: z.array(WikiPageSchema),
});

export const FormatOutputSchema = z.object({
  report: z.string(),
  formatted: z.string(),
});

export type WikiPageResponse = z.infer<typeof WikiPageSchema>;
export type WikiPagesOutput = z.infer<typeof WikiPagesOutputSchema>;
export type LintOutput = z.infer<typeof LintOutputSchema>;
export type FormatOutput = z.infer<typeof FormatOutputSchema>;
```

- [ ] **Step 4: Extend `CallSite` union in `src/phases/parse-with-retry.ts`**

Change line 11:

```ts
// Before:
export type CallSite =
  | "init.bootstrap" | "init.delta" | "lint.patch" | "lint-chat.fix" | "query.seeds";

// After:
export type CallSite =
  | "init.bootstrap" | "init.delta"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds"
  | "ingest.pages"
  | "format.output";
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run tests/phases/zod-schemas.test.ts
```

Expected: PASS all 10 tests.

- [ ] **Step 6: Commit**

```bash
git add src/phases/zod-schemas.ts src/phases/parse-with-retry.ts tests/phases/zod-schemas.test.ts
git commit -m "feat(schemas): add WikiPageSchema, WikiPagesOutputSchema, LintOutputSchema, FormatOutputSchema + extend CallSite"
```

---

## Task 2: Ingest — replace `parseJsonPages` with `parseWithRetry`

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `prompts/ingest.md`
- Modify: `tests/phases/ingest.test.ts`

### 2a. Update prompt

- [ ] **Step 1: Change ingest prompt output format**

In `prompts/ingest.md`, find and replace the final output instruction block:

```
// Before (last 3 lines of prompt):
Верни ТОЛЬКО JSON-массив, без другого текста:
[{"path":"{{wiki_path}}/entities/EntityName.md","content":"---\nwiki_sources: [\"[[{{source_path}}]]\"]\nwiki_updated: {{today}}\nwiki_status: stub\nwiki_keywords: [токен1, токен2]\ntags: []\nwiki_outgoing_links: []\n---\n# EntityName\n\ncontент...","annotation":"Краткое описание сущности для контекстного поиска"}]
```

Replace with:

```
Верни ТОЛЬКО JSON-объект — никакого другого текста:
{"reasoning":"Обоснование: какие сущности извлечены и почему","pages":[{"path":"{{wiki_path}}/entities/EntityName.md","content":"---\nwiki_sources: [\"[[{{source_path}}]]\"]\nwiki_updated: {{today}}\nwiki_status: stub\nwiki_keywords: [токен1, токен2]\ntags: []\nwiki_outgoing_links: []\n---\n# EntityName\n\ncontент...","annotation":"Краткое описание сущности для контекстного поиска"}]}
```

- [ ] **Step 2: Write failing tests for `runIngest` with new format**

Add new `describe` block in `tests/phases/ingest.test.ts`:

```ts
describe("runIngest with WikiPagesOutputSchema format", () => {
  it("writes pages from {reasoning, pages} response", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Extracted one entity.",
      pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity\n\nFact." }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(adapter.write).toHaveBeenCalledWith("!Wiki/work/entities/Entity.md", "# Entity\n\nFact.");
    expect(events.some((e: any) => e.kind === "result")).toBe(true);
  });

  it("yields reasoning as isReasoning assistant_text event", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llmResponse = JSON.stringify({
      reasoning: "Two entities found.",
      pages: [{ path: "!Wiki/work/entities/A.md", content: "# A" }],
    });
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm(llmResponse),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const reasoningEv = events.find(
      (e: any) => e.kind === "assistant_text" && e.isReasoning === true && e.delta === "Two entities found.",
    );
    expect(reasoningEv).toBeDefined();
  });

  it("yields structural_error event and result:0 on invalid JSON response", async () => {
    const adapter = mockAdapter({
      read: vi.fn().mockResolvedValue("source text"),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runIngest(
        [`${VAULT_ROOT}/Sources/doc.md`],
        vt,
        makeLlm("not json at all"),
        "llama3.2",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });
});
```

- [ ] **Step 3: Run new tests to verify they fail**

```bash
npx vitest run tests/phases/ingest.test.ts -t "WikiPagesOutputSchema"
```

Expected: FAIL — ingest still uses `parseJsonPages`, doesn't produce `reasoning` event.

- [ ] **Step 4: Refactor `runIngest` to use `parseWithRetry`**

In `src/phases/ingest.ts`:

1. Add imports at the top (after existing imports):

```ts
import { parseWithRetry } from "./parse-with-retry";
import { WikiPagesOutputSchema } from "./zod-schemas";
```

2. Replace the streaming+parseJsonPages block (lines 74–105 in current file). Find:

```ts
  const start = Date.now();
  const messages = buildIngestMessages(
    sourceVaultPath, sourceContent, domain, wikiVaultPath,
    existingPages, schemaContent, indexContent,
  );
  const params = buildChatParams(model, messages, opts, true);

  let fullText = "";
  let outputTokens = 0;
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) fullText += content;
      if (tok !== undefined) outputTokens += tok;
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
  }

  if (signal.aborted) return;

  let pages = parseJsonPages(fullText);
```

Replace with:

```ts
  const start = Date.now();
  const messages = buildIngestMessages(
    sourceVaultPath, sourceContent, domain, wikiVaultPath,
    existingPages, schemaContent, indexContent,
  );

  const pwtEvents: RunEvent[] = [];
  let parseResult: Awaited<ReturnType<typeof parseWithRetry<import("./zod-schemas").WikiPagesOutput>>>;
  try {
    parseResult = await parseWithRetry({
      llm, model, baseMessages: messages, opts,
      schema: WikiPagesOutputSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.pages",
      signal,
      onEvent: (ev) => pwtEvents.push(ev),
    });
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    for (const ev of pwtEvents) yield ev;
    yield { kind: "error", message: `ingest: LLM output failed validation — ${(e as Error).message}` };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
    return;
  }
  for (const ev of pwtEvents) yield ev;
  if (signal.aborted) return;

  const outputTokens = parseResult.outputTokens;
  yield { kind: "assistant_text", delta: parseResult.value.reasoning, isReasoning: true };
  let pages = parseResult.value.pages;
```

3. Remove the now-unused imports: `buildChatParams`, `extractStreamDeltas`, `extractUsage` are still used in `retryInvalidPaths` — **do not remove them**.

- [ ] **Step 5: Update existing `runIngest` tests to use new response format**

The existing tests in `tests/phases/ingest.test.ts` call `makeLlm(responseText)` where `responseText` was a raw JSON array. Update all tests in `describe("runIngest")` to wrap LLM response in `{reasoning, pages}`. Search for `JSON.stringify([` in the test file and wrap each:

```ts
// Before:
const llmResponse = JSON.stringify([
  { path: "!Wiki/work/entities/Entity.md", content: "# Entity\n\nFact." },
]);

// After:
const llmResponse = JSON.stringify({
  reasoning: "Extracted Entity.",
  pages: [{ path: "!Wiki/work/entities/Entity.md", content: "# Entity\n\nFact." }],
});
```

Also update `makeLlm("[]")` calls to `makeLlm(JSON.stringify({ reasoning: "nothing", pages: [] }))` in tests that expect empty output.

Full list of calls to update (all in `describe("runIngest")`):
- "writes pages returned by LLM" — wrap llmResponse
- "yields source_path_added when new parent folder encountered" — wrap llmResponse
- "yields source_path_added with direct parent path" — wrap llmResponse
- "yields result with count=0 when LLM returns empty array" — change `makeLlm("[]")` to `makeLlm(JSON.stringify({ reasoning: "nothing to extract", pages: [] }))`
- "writes backlinks frontmatter" — wrap llmResponse
- "preserves wiki_added" — wrap llmResponse
- "does not write backlinks when no wiki pages were written" — change `makeLlm("[]")`
- "calls write on _index.md with annotation" — wrap llmResponse
- "does not fail ingest when raw file backlink write throws" — wrap llmResponse
- `describe("runIngest path validation")` tests — wrap all `badResponse`/`goodResponse`

- [ ] **Step 6: Run all ingest tests**

```bash
npx vitest run tests/phases/ingest.test.ts
```

Expected: PASS all tests (existing + new).

- [ ] **Step 7: Commit**

```bash
git add src/phases/ingest.ts prompts/ingest.md tests/phases/ingest.test.ts
git commit -m "feat(ingest): replace parseJsonPages with parseWithRetry + WikiPagesOutputSchema"
```

---

## Task 3: Lint — merge assess+fix into single CoT+Structured call

**Files:**
- Modify: `src/phases/lint.ts`
- Modify: `prompts/lint.md`
- Modify: `tests/phases/lint.test.ts`

### 3a. Update lint prompt

- [ ] **Step 1: Update `prompts/lint.md`**

Replace entire file content with:

```md
Ты — рецензент и редактор wiki-базы знаний домена «{{domain_name}}».
Анализируй качество wiki: дублирование, пробелы, размытые определения, устаревший контент, битые ссылки.
Одновременно подготовь исправленные версии проблемных страниц.
{{entity_types_block}}

При исправлении страниц:
- wiki_keywords: добавь или обнови в frontmatter (5-10 ключевых токенов, строчные, дефис-вместо-пробела)
- "annotation": одно предложение — описание сущности для поиска по смыслу
- мёртвые ссылки [[X]] убери или замени; отсутствующий frontmatter добавь; дублирование объедини

Верни ТОЛЬКО JSON-объект — никакого другого текста:
{"reasoning":"цепочка рассуждений","report":"## Отчёт lint\n\nАнализ качества в формате Markdown...","fixes":[{"path":"!Wiki/domain/type/Entity.md","content":"полный контент исправленной страницы","annotation":"краткое описание"}]}

Поле `fixes` содержит ТОЛЬКО изменённые страницы (пустой массив если правок нет).
Поле `report` — полный markdown-отчёт для пользователя.
```

- [ ] **Step 2: Write failing tests for merged lint call**

In `tests/phases/lint.test.ts`, add a new `describe` block:

```ts
describe("runLint with merged assess+fix (LintOutputSchema)", () => {
  it("writes pages from fixes field", async () => {
    const wikiContent = "---\ntags: []\n---\n# Page\n\nContent with [[DeadLink]].";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockImplementation((path: string) => {
        if (path.includes("!Wiki")) {
          return Promise.resolve({ files: ["!Wiki/work/Page.md"], folders: [] });
        }
        return Promise.resolve({ files: [], folders: [] });
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/work/Page.md") return Promise.resolve(wikiContent);
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    // call 1: assess+fix returns LintOutputSchema JSON
    // call 2: actualize returns entity config JSON
    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1
              ? JSON.stringify({
                  reasoning: "Found dead link.",
                  report: "## Lint\n- dead link [[DeadLink]] in Page.md",
                  fixes: [{ path: "!Wiki/work/Page.md", content: "---\ntags: []\n---\n# Page\n\nContent." }],
                })
              : JSON.stringify({ reasoning: "ok", entity_types: [] });
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    expect(events.some((e: any) => e.kind === "result")).toBe(true);
    // fixed page must be written
    const writeCall = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]: [string]) => path === "!Wiki/work/Page.md",
    );
    expect(writeCall).toBeDefined();
    // total LLM calls = 2 (assess+fix, actualize)
    expect(callCount).toBe(2);
  });

  it("yields report as assistant_text before write loop", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    const reportText = "## Lint\nNo issues.";
    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1
              ? JSON.stringify({ reasoning: "ok", report: reportText, fixes: [] })
              : JSON.stringify({ reasoning: "ok", entity_types: [] });
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    const reportEv = events.find(
      (e: any) => e.kind === "assistant_text" && typeof e.delta === "string" && e.delta.includes("No issues"),
    );
    expect(reportEv).toBeDefined();
  });

  it("yields per-page progress assistant_text before each write", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1
              ? JSON.stringify({
                  reasoning: "fix",
                  report: "## Lint\n- fix Page.md",
                  fixes: [{ path: "!Wiki/work/Page.md", content: "# Page\n\nFixed." }],
                })
              : JSON.stringify({ reasoning: "ok", entity_types: [] });
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content } }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );

    const progressEv = events.find(
      (e: any) => e.kind === "assistant_text" && typeof e.delta === "string" && e.delta.includes("Page.md"),
    );
    expect(progressEv).toBeDefined();
  });
});
```

- [ ] **Step 3: Run new tests to verify they fail**

```bash
npx vitest run tests/phases/lint.test.ts -t "merged assess"
```

Expected: FAIL.

- [ ] **Step 4: Refactor `runLint` — replace assess+fix with single `parseWithRetry` call**

In `src/phases/lint.ts`:

1. Add imports:
```ts
import { parseWithRetry } from "./parse-with-retry";
import { LintOutputSchema } from "./zod-schemas";
import type { LintOutput } from "./zod-schemas";
```

2. Remove the existing assess streaming block (lines 88–131) and the fix streaming block (lines 145–168). Replace with:

```ts
    // Combined assess+fix call
    const lintPwtEvents: RunEvent[] = [];
    let lintResult: { value: LintOutput; outputTokens: number };
    try {
      lintResult = await parseWithRetry({
        llm, model,
        baseMessages: messages,
        opts,
        schema: LintOutputSchema,
        maxRetries: opts.structuredRetries ?? 1,
        callSite: "lint.fix",
        signal,
        onEvent: (ev) => lintPwtEvents.push(ev),
      });
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") return;
      for (const ev of lintPwtEvents) yield ev;
      reportParts.push(`## ${domain.id}\nLLM validation failed: ${(e as Error).message}`);
      continue;
    }
    for (const ev of lintPwtEvents) yield ev;
    if (signal.aborted) return;
    outputTokens += lintResult.outputTokens;

    const llmReport = lintResult.value.report;
    yield { kind: "assistant_text", delta: llmReport };
    reportParts.push(`## ${domain.id}\n${allIssues ? `**Структурные проблемы:**\n${allIssues}\n\n` : ""}${llmReport}`);
```

3. Remove the actualize call's position between assess and fix — actualize now happens AFTER the combined call. Move the actualize block so it runs after the combined call's `reportParts.push(...)`.

4. Remove `buildFixMessages` function entirely (no longer needed).

5. Replace fix write loop with the new loop from lintResult.value.fixes with per-page progress:

```ts
    const fixedPages = lintResult.value.fixes;
    const writtenPaths: string[] = [];
    for (const page of fixedPages) {
      yield { kind: "assistant_text", delta: `  • ${page.path.split("/").pop()}...\n` };
      if (!page.path.startsWith(wikiVaultPath + "/")) {
        yield { kind: "tool_use", name: "Write", input: { path: page.path } };
        yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
        continue;
      }
      yield { kind: "tool_use", name: "Write", input: { path: page.path } };
      try {
        await vaultTools.write(page.path, page.content);
        writtenPaths.push(page.path);
        yield { kind: "tool_result", ok: true };
        if (page.annotation) {
          try {
            await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(page.path), page.annotation, page.path);
          } catch { /* non-critical */ }
        }
      } catch (e) {
        yield { kind: "tool_result", ok: false, preview: (e as Error).message };
      }
    }
```

6. Remove `import { parseJsonPages } from "./ingest";` — no longer used in lint.

- [ ] **Step 5: Update existing lint tests to match 2-call sequence**

In `tests/phases/lint.test.ts`, the current `makeLlm(report, configJson)` creates a 3-call mock (call 1: report, call 2: configJson, call 3: report again for fix). After the change: call 1 is assess+fix JSON, call 2 is configJson.

Replace the `makeLlm` helper:

```ts
function makeLlm(reportJson: string, configJson = "{}"): LlmClient {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((_params: any) => {
          const call = ++callCount;
          // call 1: combined assess+fix (LintOutputSchema JSON)
          // call 2: actualizeDomainConfig (EntityTypesDeltaSchema JSON via parseWithRetry)
          const content = call === 2 ? configJson : reportJson;
          return Promise.resolve({
            [Symbol.asyncIterator]: async function* () {
              yield { choices: [{ delta: { content } }] };
            },
          });
        }),
      },
    },
  } as unknown as LlmClient;
}
```

Update callers of `makeLlm` in existing tests to pass `LintOutputSchema`-shaped JSON instead of free-text report:

```ts
// Before:
makeLlm("No issues found.")
makeLlm("Lint OK")

// After:
makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues found.", fixes: [] }))
makeLlm(JSON.stringify({ reasoning: "ok", report: "Lint OK", fixes: [] }))
```

Update all occurrences in: "yields result with report for existing domain", "syncs wiki_articles backlinks", "does not fail lint when raw file read throws", "unions wiki_articles across two domain lint runs".

- [ ] **Step 6: Run all lint tests**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: PASS all tests (existing + new).

- [ ] **Step 7: Commit**

```bash
git add src/phases/lint.ts prompts/lint.md tests/phases/lint.test.ts
git commit -m "feat(lint): merge assess+fix into single CoT+Structured call; add per-page UI progress"
```

---

## Task 4: Format — replace `extractJsonObject` with Zod validation

**Files:**
- Modify: `src/phases/format.ts`
- Modify: `tests/phases/format.test.ts`

- [ ] **Step 1: Write a failing test for Zod failure path**

In `tests/phases/format.test.ts`, add:

```ts
import { structuralErrorCounter } from "../../src/structural-error-counter";

describe("runFormat Zod validation", () => {
  it("records structuralErrorCounter on Zod parse failure then retry succeeds", async () => {
    structuralErrorCounter.reset();
    const good = JSON.stringify({ report: "## ok", formatted: "---\n# Page" });
    const bad = '{"report": "ok"}'; // missing `formatted` field
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);

    let callCount = 0;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn().mockImplementation(() => {
            callCount++;
            const content = callCount === 1 ? bad : good;
            return Promise.resolve({
              [Symbol.asyncIterator]: async function* () {
                yield { choices: [{ delta: { content }, finish_reason: null }] };
              },
            });
          }),
        },
      },
    } as unknown as LlmClient;

    const events = await collect(
      runFormat([FILE], vt, llm, "model", false, [], new AbortController().signal),
    );

    // Should produce format_preview with second (good) response
    expect(events.some((e: unknown) => (e as { kind: string }).kind === "format_preview")).toBe(true);
    // structuralErrorCounter should have recorded the failure
    const stats = structuralErrorCounter.get();
    expect(stats.failed + stats.retried).toBeGreaterThan(0);
  });

  it("emits error on Zod failure after retry", async () => {
    structuralErrorCounter.reset();
    const bad = '{"report": "ok"}'; // missing `formatted` field
    const adapter = mockAdapter({ [FILE]: SAMPLE });
    const vt = new VaultTools(adapter, VAULT);

    const events = await collect(
      runFormat([FILE], vt, makeLlmSequence([bad, bad]), "model", false, [], new AbortController().signal),
    );
    expect(events.some((e: unknown) => (e as { kind: string }).kind === "error")).toBe(true);
  });
});
```

- [ ] **Step 2: Run failing tests**

```bash
npx vitest run tests/phases/format.test.ts -t "Zod validation"
```

Expected: FAIL — `extractJsonObject` returns null for valid JSON missing a field; no `structuralErrorCounter` hook.

- [ ] **Step 3: Add imports to `src/phases/format.ts`**

```ts
// Add at top with existing imports:
import { parseStructured } from "./llm-utils";
import { FormatOutputSchema } from "./zod-schemas";
import { structuralErrorCounter } from "../structural-error-counter";
```

- [ ] **Step 4: Replace `extractJsonObject` calls with Zod parsing**

In `src/phases/format.ts`, define a local helper after `callOnce`:

```ts
  function parseFormatOutput(text: string): { report: string; formatted: string } | null {
    let raw: unknown;
    try {
      raw = parseStructured(text);
    } catch {
      structuralErrorCounter.record(false, 0);
      return null;
    }
    const result = FormatOutputSchema.safeParse(raw);
    if (result.success) {
      structuralErrorCounter.record(true, 0);
      return result.data;
    }
    structuralErrorCounter.record(false, 0);
    return null;
  }
```

Replace both calls to `extractJsonObject`:

```ts
// Line 126 (first call) — Before:
  let parsed = extractJsonObject(fullText);

// After:
  let parsed = parseFormatOutput(fullText);
```

```ts
// Line 143 (retry call) — Before:
    parsed = extractJsonObject(fullText);

// After:
    parsed = parseFormatOutput(fullText);
```

Also for the token-restore path (line ~179):

```ts
// Before:
      const parsed2 = extractJsonObject(fullText2);

// After:
      const parsed2 = parseFormatOutput(fullText2);
```

Remove `extractJsonObject` from the import at line 8:

```ts
// Before:
import { extractJsonObject, missingTokensWithContext, looksTruncated, appendMissingLines } from "./format-utils";

// After:
import { missingTokensWithContext, looksTruncated, appendMissingLines } from "./format-utils";
```

- [ ] **Step 5: Run all format tests**

```bash
npx vitest run tests/phases/format.test.ts
```

Expected: PASS all tests including new Zod validation tests.

- [ ] **Step 6: Run full test suite to catch regressions**

```bash
npm test
```

Expected: PASS — all tests green.

- [ ] **Step 7: Commit**

```bash
git add src/phases/format.ts tests/phases/format.test.ts
git commit -m "feat(format): replace extractJsonObject with FormatOutputSchema.safeParse + structuralErrorCounter"
```

---

## Self-Review Checklist

After all tasks complete, verify:

- [ ] `src/phases/lint.ts` no longer imports `parseJsonPages` from `"./ingest"`
- [ ] `src/phases/lint.ts` no longer contains `buildFixMessages` function
- [ ] `src/phases/format.ts` no longer imports `extractJsonObject`
- [ ] `parseJsonPages` still exported from `src/phases/ingest.ts` (needed by ingest tests; no other phase file imports it — satisfies spec §Design/2 "not exported from phase modules" = not re-exported via other phases)
- [ ] `npm test` passes with no failures
- [ ] `CallSite` union in `parse-with-retry.ts` contains `"ingest.pages"` and `"format.output"`
- [ ] `LintOutputSchema` in `zod-schemas.ts` re-uses `WikiPageSchema` for the `fixes` array
