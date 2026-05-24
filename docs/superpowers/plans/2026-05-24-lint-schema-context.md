# lint-schema-context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `schema_block` to `lint.ts` and `lint-chat.ts`; remove it from `query.ts`; update prompts and docs to match.

**Architecture:** Each phase that writes wiki pages reads `_wiki_schema.md` via a local `tryRead` helper (identical to the one in `ingest.ts`) and passes `schema_block` to `render()`. `query.ts` only reads wiki — schema read is removed. Prompt templates updated to match.

**Tech Stack:** TypeScript (esbuild), vitest, Obsidian plugin

---

## File Map

| File | Action |
|---|---|
| `src/phases/lint.ts` | Add `tryRead` helper + `schemaRoot` + `schemaContent` + `schema_block` in render |
| `src/phases/lint-chat.ts` | Add `tryRead` helper + `schemaRoot` + `schemaContent` + `schema_block` in render |
| `src/phases/query.ts` | Remove schema read from `Promise.all`; remove `schema_block:` from render; remove `schemaRoot` var |
| `prompts/lint.md` | Add `{{schema_block}}` after `{{entity_types_block}}` |
| `prompts/lint-chat.md` | Add `{{schema_block}}` before `LINT-ОТЧЁТ:` line |
| `prompts/query.md` | Remove `{{schema_block}}` line |
| `tests/phases/lint.test.ts` | Add 2 tests: schema present → in messages; absent → not in messages |
| `tests/phases/query.test.ts` | Add 1 test: `_wiki_schema.md` never read |
| `docs/prompt-architecture.md` | Update render-variables table + Mermaid diagram + remove stale remark |

---

### Task 1: Write failing tests for lint schema_block

**Files:**
- Modify: `tests/phases/lint.test.ts`

- [ ] **Step 1: Write the failing tests**

Add at the end of the `describe("runLint"` block (before its closing `}`):

```typescript
  it("passes schema_block to LLM system message when schema file present", async () => {
    const schemaContent = "# Wiki Schema\n- use lowercase tags";
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/.config/_wiki_schema.md") return Promise.resolve(schemaContent);
        return Promise.resolve("---\ntags: []\n---\n# Page\n\nContent.");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] }));
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const firstCall = createMock.mock.calls[0];
    const systemMsg = firstCall?.[0]?.messages?.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Конвенции (_wiki_schema.md):");
    expect(systemMsg?.content).toContain(schemaContent);
  });

  it("passes empty schema_block when schema file absent", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/.config/_wiki_schema.md") return Promise.reject(new Error("not found"));
        return Promise.resolve("---\ntags: []\n---\n# Page\n\nContent.");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] }));
    await collect(
      runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const firstCall = createMock.mock.calls[0];
    const systemMsg = firstCall?.[0]?.messages?.find((m: any) => m.role === "system");
    expect(systemMsg?.content).not.toContain("Конвенции (_wiki_schema.md):");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: FAIL — the two new tests should fail because `lint.ts` doesn't yet pass `schema_block`.

---

### Task 2: Implement schema_block in lint.ts

**Files:**
- Modify: `src/phases/lint.ts`

- [ ] **Step 1: Add `tryRead` helper at bottom of file**

Add after the last function (`actualizeDomainConfig`):

```typescript
async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}
```

- [ ] **Step 2: Add schemaRoot + schemaContent read, update render call**

In `runLint`, after `await ensureDomainConfig(vaultTools, wikiVaultPath);` (line 59) and before the `yield { kind: "tool_use", name: "Glob"` line, add:

```typescript
    const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");
    const schemaContent = await tryRead(vaultTools, `${schemaRoot}/.config/_wiki_schema.md`);
```

Then update the `render(lintTemplate, {...})` call (around line 76) to add `schema_block`:

```typescript
    const systemContent = render(lintTemplate, {
      domain_name: domain.name,
      entity_types_block: entityTypesBlock ? `\nТИПЫ СУЩНОСТЕЙ ДОМЕНА:\n${entityTypesBlock}` : "",
      schema_block: schemaContent ? `\nКонвенции (_wiki_schema.md):\n${schemaContent}` : "",
    });
```

- [ ] **Step 3: Run tests to verify new tests pass**

```bash
npx vitest run tests/phases/lint.test.ts
```

Expected: All tests PASS including the two new ones.

- [ ] **Step 4: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): read _wiki_schema.md and pass schema_block to prompt"
```

---

### Task 3: Add {{schema_block}} to prompts/lint.md

**Files:**
- Modify: `prompts/lint.md`

- [ ] **Step 1: Add placeholder**

Current `prompts/lint.md`:
```
Ты — рецензент и редактор wiki-базы знаний домена «{{domain_name}}».
Анализируй качество wiki: дублирование, пробелы, размытые определения, устаревший контент, битые ссылки.
Одновременно подготовь исправленные версии проблемных страниц.
{{entity_types_block}}
```

Add `{{schema_block}}` on a new line after `{{entity_types_block}}`:

```
Ты — рецензент и редактор wiki-базы знаний домена «{{domain_name}}».
Анализируй качество wiki: дублирование, пробелы, размытые определения, устаревший контент, битые ссылки.
Одновременно подготовь исправленные версии проблемных страниц.
{{entity_types_block}}
{{schema_block}}
```

- [ ] **Step 2: Commit**

```bash
git add prompts/lint.md
git commit -m "feat(prompts): add schema_block placeholder to lint.md"
```

---

### Task 4: Write failing tests for query schema removal

**Files:**
- Modify: `tests/phases/query.test.ts`

- [ ] **Step 1: Write the failing test**

Add inside `describe("runQuery"` block:

```typescript
  it("does not read _wiki_schema.md for query", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("# Page\n\nContent."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runQuery(["what is X?"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    const readMock = adapter.read as ReturnType<typeof vi.fn>;
    const schemaRead = readMock.mock.calls.find(([path]: [string]) =>
      path.endsWith("_wiki_schema.md"),
    );
    expect(schemaRead).toBeUndefined();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run tests/phases/query.test.ts
```

Expected: FAIL — `query.ts` currently reads `_wiki_schema.md`.

---

### Task 5: Remove schema_block from query.ts

**Files:**
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Remove schemaRoot variable (line 50)**

Delete the line:
```typescript
  const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");
```

- [ ] **Step 2: Replace Promise.all with single tryRead**

Replace (lines 55–58):
```typescript
  const [indexContent, schemaContent] = await Promise.all([
    tryRead(vaultTools, domainIndexPath(wikiVaultPath)),
    tryRead(vaultTools, `${schemaRoot}/.config/_wiki_schema.md`),
  ]);
```

With:
```typescript
  const indexContent = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
```

- [ ] **Step 3: Remove schema_block from render call**

Find the `render(queryTemplate, {...})` call (around line 146). Remove the `schema_block:` line:

```typescript
  const systemPrompt = render(queryTemplate, {
    domain_name: domain.name,
    entity_types_block: entityTypesBlock,
    index_block: indexContent ? `\nВики-индекс (_index.md):\n${indexContent}` : "",
  });
```

- [ ] **Step 4: Run tests to verify new test and existing tests pass**

```bash
npx vitest run tests/phases/query.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/query.ts tests/phases/query.test.ts
git commit -m "feat(query): remove schema_block — query does not modify wiki"
```

---

### Task 6: Remove {{schema_block}} from prompts/query.md

**Files:**
- Modify: `prompts/query.md`

- [ ] **Step 1: Remove the placeholder**

Current `prompts/query.md`:
```
Ты — ассистент по wiki-базе знаний домена «{{domain_name}}».
Отвечай строго на основе предоставленных wiki-страниц. Будь точен и лаконичен.
Используй WikiLinks [[название]] при ссылках на страницы из индекса.
{{entity_types_block}}
{{schema_block}}
{{index_block}}
```

Remove the `{{schema_block}}` line:
```
Ты — ассистент по wiki-базе знаний домена «{{domain_name}}».
Отвечай строго на основе предоставленных wiki-страниц. Будь точен и лаконичен.
Используй WikiLinks [[название]] при ссылках на страницы из индекса.
{{entity_types_block}}
{{index_block}}
```

- [ ] **Step 2: Commit**

```bash
git add prompts/query.md
git commit -m "feat(prompts): remove schema_block from query.md"
```

---

### Task 7: Write failing tests for lint-chat schema_block

**Files:**
- Modify: `tests/phases/lint-chat.test.ts` (create if not exists, else add to existing describe)

- [ ] **Step 1: Check if test file exists**

```bash
ls tests/phases/lint-chat.test.ts 2>/dev/null && echo "exists" || echo "missing"
```

- [ ] **Step 2: Add tests**

If the file exists, add inside the existing describe block. If it doesn't exist, create it. The test file needs these imports and tests:

```typescript
import { describe, it, expect, vi } from "vitest";
import { runLintFixChat } from "../../src/phases/lint-chat";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";
import type { RunRequest } from "../../src/types";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlm(json: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: json } }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const VAULT_ROOT = "/vaults/Work";

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "work",
  source_paths: [],
};

describe("runLintFixChat", () => {
  it("passes schema_block to LLM system message when schema file present", async () => {
    const schemaContent = "# Wiki Schema\n- lowercase tags";
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/.config/_wiki_schema.md") return Promise.resolve(schemaContent);
        return Promise.resolve("---\ntags: []\n---\n# Page");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const req: RunRequest = { operation: "lint-chat", args: [], context: "lint report here" };
    const llm = makeLlm(JSON.stringify({ summary: "done", pages: [] }));
    await collect(runLintFixChat(req, vt, VAULT_ROOT, domain, llm, "model", {}, new AbortController().signal));
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.find((m: any) => m.role === "system");
    expect(systemMsg?.content).toContain("Конвенции (_wiki_schema.md):");
    expect(systemMsg?.content).toContain(schemaContent);
  });

  it("passes empty schema_block when schema file absent", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path === "!Wiki/.config/_wiki_schema.md") return Promise.reject(new Error("not found"));
        return Promise.resolve("---\ntags: []\n---\n# Page");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const req: RunRequest = { operation: "lint-chat", args: [], context: "lint report" };
    const llm = makeLlm(JSON.stringify({ summary: "done", pages: [] }));
    await collect(runLintFixChat(req, vt, VAULT_ROOT, domain, llm, "model", {}, new AbortController().signal));
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const systemMsg = createMock.mock.calls[0]?.[0]?.messages?.find((m: any) => m.role === "system");
    expect(systemMsg?.content).not.toContain("Конвенции (_wiki_schema.md):");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run tests/phases/lint-chat.test.ts
```

Expected: FAIL — `lint-chat.ts` doesn't yet pass `schema_block`.

---

### Task 8: Implement schema_block in lint-chat.ts

**Files:**
- Modify: `src/phases/lint-chat.ts`

- [ ] **Step 1: Check how `wikiVaultPath` is computed in lint-chat.ts**

In `lint-chat.ts` line 34: `const wikiVaultPath = domainWikiFolder(domain.wiki_folder);`

For `wiki_folder = "work"`, `domainWikiFolder("work")` returns `"!Wiki/work"`.
So `schemaRoot = "!Wiki/work".split("/").slice(0,-1).join("/")` = `"!Wiki"`.
Schema path = `"!Wiki/.config/_wiki_schema.md"` — matches lint.ts behavior.

- [ ] **Step 2: Add `tryRead` helper at end of file**

```typescript
async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}
```

- [ ] **Step 3: Add schemaRoot + schemaContent, update render**

After `await ensureDomainConfig(vaultTools, wikiVaultPath);` (line 35) and before `const allFiles = ...` (line 38), add:

```typescript
  const schemaRoot = wikiVaultPath.split("/").slice(0, -1).join("/");
  const schemaContent = await tryRead(vaultTools, `${schemaRoot}/.config/_wiki_schema.md`);
```

Then update the `render(lintChatTemplate, {...})` call (around line 48) to add `schema_block`:

```typescript
  const systemContent = render(lintChatTemplate, {
    domain_name: domain.name,
    lint_report: req.context ?? "",
    pages_block: pagesBlock,
    schema_block: schemaContent ? `\nКонвенции (_wiki_schema.md):\n${schemaContent}` : "",
  });
```

- [ ] **Step 4: Run tests**

```bash
npx vitest run tests/phases/lint-chat.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/lint-chat.ts tests/phases/lint-chat.test.ts
git commit -m "feat(lint-chat): read _wiki_schema.md and pass schema_block to prompt"
```

---

### Task 9: Add {{schema_block}} to prompts/lint-chat.md

**Files:**
- Modify: `prompts/lint-chat.md`

- [ ] **Step 1: Add placeholder before LINT-ОТЧЁТ section**

Current `prompts/lint-chat.md`:
```
Ты — редактор wiki-базы знаний домена «{{domain_name}}».
Прими задание пользователя и lint-отчёт, исправь указанные проблемы в страницах.

Верни JSON:
{"summary":"## markdown что сделано","pages":[{"path":"...","content":"...","annotation":"одно предложение — описание сущности для поиска по смыслу"}]}
Если правок нет — pages пустой массив, summary — текстовый ответ.

LINT-ОТЧЁТ:
{{lint_report}}

СТРАНИЦЫ ДОМЕНА:
{{pages_block}}
```

Add `{{schema_block}}` before `LINT-ОТЧЁТ:`:

```
Ты — редактор wiki-базы знаний домена «{{domain_name}}».
Прими задание пользователя и lint-отчёт, исправь указанные проблемы в страницах.

Верни JSON:
{"summary":"## markdown что сделано","pages":[{"path":"...","content":"...","annotation":"одно предложение — описание сущности для поиска по смыслу"}]}
Если правок нет — pages пустой массив, summary — текстовый ответ.
{{schema_block}}

LINT-ОТЧЁТ:
{{lint_report}}

СТРАНИЦЫ ДОМЕНА:
{{pages_block}}
```

- [ ] **Step 2: Commit**

```bash
git add prompts/lint-chat.md
git commit -m "feat(prompts): add schema_block placeholder to lint-chat.md"
```

---

### Task 10: Run full test suite

**Files:** none

- [ ] **Step 1: Run all tests**

```bash
npm test
```

Expected: All tests pass. Zero failures.

- [ ] **Step 2: Build**

Before building — bump patch version per CLAUDE.md rules:

Read current version from `package.json`, increment patch, write to `package.json` and `src/manifest.json`.

```bash
npm run build
```

Expected: `dist/main.js` produced with no errors.

---

### Task 11: Update docs/prompt-architecture.md

**Files:**
- Modify: `docs/prompt-architecture.md`

- [ ] **Step 1: Update "Контекст, инжектируемый в каждый промт" table**

Find the table rows for `lint`, `lint-chat`, and `query`. Change:

| Операция | Промт | Переменные `render()` | Схема ответа |
|---|---|---|---|
| **query** | `query.md` + `base.md` | `domain_name`, `entity_types_block`, ~~`schema_block`,~~ `index_block` | free text |
| **lint** | `lint.md` + `base.md` | `domain_name`, `entity_types_block`, **`schema_block`** | `LintOutputSchema` `{reasoning, report, fixes[]}` |
| **lint-chat** | `lint-chat.md` + `base.md` | `domain_name`, `lint_report`, `pages_block`, **`schema_block`** | `LintChatSchema` `{summary, pages[{path,content,annotation?}]}` |

- [ ] **Step 2: Update Mermaid diagram (Промты по фазам)**

In the Mermaid flowchart, change the `V_WIKI` connections:

Remove:
```
V_WIKI -->|schema_block| PQ2
```

Add:
```
V_WIKI -->|schema_block| PL2
V_WIKI -->|schema_block| PLC2
```

Keep:
```
V_WIKI -->|schema_block| PI2
```

- [ ] **Step 3: Update "Сравнительная таблица промтов"**

Update the `lint.md` row — remove the "Не получает `schema_block`" problem note:

```
| `lint.md` | `lint` | Анализ качества wiki + автоисправление страниц | — |
```

Update the `query.md` row to note schema was removed:

```
| `query.md` | `query`, `query-save` | Ответ на вопрос по wiki-индексу домена | Нет явного ограничения на длину ответа; при большом `index_block` контекст разрастается |
```

- [ ] **Step 4: Remove stale "### lint.md — не получает schema_block" remark**

Find and delete the section:
```
### lint.md — не получает schema_block

В отличие от `ingest` и `query`, `lint.ts` не читает `.config/_wiki_schema.md` и не передаёт `schema_block` в промт. LLM проверяет wiki без знания конвенций.
```

- [ ] **Step 5: Commit**

```bash
git add docs/prompt-architecture.md
git commit -m "docs(prompt-architecture): update schema_block ownership — lint/lint-chat add, query removes"
```
