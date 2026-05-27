# Lint Per-Article Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework `runLint` to iterate wiki articles one-by-one, sending each article plus a similarity-selected context set to the LLM, instead of batching all pages in one call.

**Architecture:** Load all pages and build the graph upfront. For each article: select top-K similar pages via `PageSimilarityService.selectRelevant` + BFS expansion, call the LLM with only that subset, apply fixes and deletions immediately (with per-step `fixWikiLinks`, graph rebuild, and vector refresh), then do backlink sync and `actualizeDomainConfig` once after all articles.

**Tech Stack:** TypeScript, Vitest, Zod, `src/phases/lint.ts`, `src/phases/zod-schemas.ts`, `prompts/lint.md`, `src/wiki-graph.ts` (`bfsExpand`), `src/page-similarity.ts` (`selectRelevant`, `refreshCache`), `src/wiki-index.ts` (`parseIndexAnnotations`, `upsertIndexAnnotation`).

---

## Task 1: Extend `LintOutputSchema` with `deletes` field

**Files:**
- Modify: `src/phases/zod-schemas.ts`
- Test: `tests/phases/lint.test.ts`

- [ ] **Step 1: Write failing test for `deletes` field**

Add at the bottom of `tests/phases/lint.test.ts`:

```typescript
import { LintOutputSchema } from "../../src/phases/zod-schemas";

describe("LintOutputSchema", () => {
  it("accepts deletes as optional array of { path, redirectTo? }", () => {
    const result = LintOutputSchema.safeParse({
      reasoning: "found duplicate",
      report: "merged B into A",
      fixes: [],
      deletes: [
        { path: "!Wiki/work/Duplicate.md", redirectTo: "!Wiki/work/Original.md" },
        { path: "!Wiki/work/Dead.md" },
      ],
    });
    expect(result.success).toBe(true);
    expect(result.data?.deletes).toHaveLength(2);
    expect(result.data?.deletes?.[0].redirectTo).toBe("!Wiki/work/Original.md");
    expect(result.data?.deletes?.[1].redirectTo).toBeUndefined();
  });

  it("accepts missing deletes (backwards compat)", () => {
    const result = LintOutputSchema.safeParse({
      reasoning: "ok", report: "no issues", fixes: [],
    });
    expect(result.success).toBe(true);
    expect(result.data?.deletes).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/altuser/Документы/Project/obsidian-ai-wiki
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `deletes` not in schema.

- [ ] **Step 3: Add `deletes` to `LintOutputSchema` in `src/phases/zod-schemas.ts`**

Current `LintOutputSchema` (lines 71-75):
```typescript
export const LintOutputSchema = z.object({
  reasoning: z.string(),
  report: z.string(),
  fixes: z.array(WikiPageSchema),
});
```

Replace with:
```typescript
export const LintDeleteSchema = z.object({
  path: z.string(),
  redirectTo: z.string().optional(),
});

export const LintOutputSchema = z.object({
  reasoning: z.string(),
  report: z.string(),
  fixes: z.array(WikiPageSchema),
  deletes: z.array(LintDeleteSchema).optional(),
});

export type LintDelete = z.infer<typeof LintDeleteSchema>;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: PASS for the two new schema tests.

- [ ] **Step 5: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all pre-existing tests pass (schema change is additive).

- [ ] **Step 6: Commit**

```bash
git add src/phases/zod-schemas.ts tests/phases/lint.test.ts
git commit -m "feat(schema): add deletes field to LintOutputSchema for duplicate removal"
```

---

## Task 2: Update lint prompt for per-article format and delete instruction

**Files:**
- Modify: `prompts/lint.md`

- [ ] **Step 1: Read current prompt**

```bash
cat /home/altuser/Документы/Project/obsidian-ai-wiki/prompts/lint.md
```

- [ ] **Step 2: Update `prompts/lint.md`**

Replace the entire file with:

```markdown
Ты — рецензент и редактор wiki-базы знаний домена «{{domain_name}}».
Анализируй качество wiki: дублирование, пробелы, размытые определения, устаревший контент, битые ссылки.
Одновременно подготовь исправленные версии проблемных страниц.
{{entity_types_block}}
{{schema_block}}

При исправлении страниц:
- tags: проверь и обнови иерархические теги (category/subcategory). Переиспользуй теги из других страниц домена (переданы в контексте). Формат: строчные, через `/`, без пробелов, без `#`
- "annotation": одно предложение — описание сущности для поиска по смыслу
- мёртвые ссылки [[X]] убери или замени; отсутствующий frontmatter добавь; дублирование объедини

При обнаружении дублирующихся статей в переданном наборе:
- объедини контент дублей в основную статью (включи объединённую статью в fixes[])
- укажи пути дублей в поле deletes[].path
- укажи путь основной статьи в deletes[].redirectTo для обновления ссылок

Верни ТОЛЬКО JSON-объект — никакого другого текста:
{"reasoning":"цепочка рассуждений","report":"## Отчёт lint\n\nАнализ качества в формате Markdown...","fixes":[{"path":"!Wiki/domain/type/Entity.md","content":"полный контент исправленной страницы","annotation":"краткое описание"}],"deletes":[{"path":"!Wiki/domain/type/Duplicate.md","redirectTo":"!Wiki/domain/type/Entity.md"}]}

Поле `fixes` содержит ТОЛЬКО изменённые страницы (пустой массив если правок нет).
Поле `deletes` содержит страницы-дубли для удаления (пустой массив или отсутствует если удалений нет).
Поле `report` — полный markdown-отчёт для пользователя.
```

- [ ] **Step 3: Commit**

```bash
git add prompts/lint.md
git commit -m "feat(prompt): add per-article context format and delete instructions to lint prompt"
```

---

## Task 3: Refactor `lint.ts` — per-article loop

**Files:**
- Modify: `src/phases/lint.ts`

This task replaces the single "all pages at once" LLM call with a per-article loop. Read the full current file before making changes.

- [ ] **Step 1: Write failing tests for new per-article behavior**

Add these tests to `tests/phases/lint.test.ts` in the `describe("runLint")` block, before the closing `});`:

```typescript
it("emits per-article info_text progress events", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
    read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const events = await collect(
    runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  const infoEvents = (events as any[]).filter(e => e.kind === "info_text" && e.summary?.includes("Checking"));
  expect(infoEvents.length).toBeGreaterThanOrEqual(1);
  expect(infoEvents[0].summary).toMatch(/Checking 1\/1:/);
});

it("calls vaultTools.remove when LLM returns deletes", async () => {
  const wikiContent = "---\ntags: []\n---\n# Original\n\nContent.";
  const dupContent = "---\ntags: []\n---\n# Duplicate\n\nSame content.";
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockImplementation((path: string) => {
      if (path.includes("!Wiki"))
        return Promise.resolve({ files: ["!Wiki/work/Original.md", "!Wiki/work/Duplicate.md"], folders: [] });
      return Promise.resolve({ files: [], folders: [] });
    }),
    read: vi.fn().mockImplementation((path: string) => {
      if (path === "!Wiki/work/Original.md") return Promise.resolve(wikiContent);
      if (path === "!Wiki/work/Duplicate.md") return Promise.resolve(dupContent);
      return Promise.resolve("");
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const lintJson = JSON.stringify({
    reasoning: "found duplicate",
    report: "Merged Duplicate into Original.",
    fixes: [{ path: "!Wiki/work/Original.md", content: wikiContent + "\n\nSame content." }],
    deletes: [{ path: "!Wiki/work/Duplicate.md", redirectTo: "!Wiki/work/Original.md" }],
  });
  // 2 articles → 2 lint calls, then actualize
  const llm = makeLlm(lintJson, "{}", 2);
  await collect(
    runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  expect(adapter.remove).toHaveBeenCalledWith("!Wiki/work/Duplicate.md");
});

it("rewrites [[Deleted]] links in wiki pages when delete has redirectTo", async () => {
  const originalContent = "---\ntags: []\n---\n# Original\n\nContent.";
  const linkedContent = "---\ntags: []\n---\n# Linker\n\nSee [[Duplicate]] for more.";
  const dupContent = "---\ntags: []\n---\n# Duplicate\n\nDuplicated.";
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockImplementation((path: string) => {
      if (path.includes("!Wiki"))
        return Promise.resolve({
          files: ["!Wiki/work/Original.md", "!Wiki/work/Linker.md", "!Wiki/work/Duplicate.md"],
          folders: [],
        });
      return Promise.resolve({ files: [], folders: [] });
    }),
    read: vi.fn().mockImplementation((path: string) => {
      if (path === "!Wiki/work/Original.md") return Promise.resolve(originalContent);
      if (path === "!Wiki/work/Linker.md") return Promise.resolve(linkedContent);
      if (path === "!Wiki/work/Duplicate.md") return Promise.resolve(dupContent);
      return Promise.resolve("");
    }),
    remove: vi.fn().mockResolvedValue(undefined),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  const lintJson = JSON.stringify({
    reasoning: "merged",
    report: "ok",
    fixes: [],
    deletes: [{ path: "!Wiki/work/Duplicate.md", redirectTo: "!Wiki/work/Original.md" }],
  });
  const llm = makeLlm(lintJson, "{}", 3);
  await collect(
    runLint(["work"], vt, llm, "model", [domain], VAULT_ROOT, new AbortController().signal),
  );
  const linkerWrite = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.find(
    ([path, content]: [string, string]) => path === "!Wiki/work/Linker.md" && content.includes("[[Original]]"),
  );
  expect(linkerWrite).toBeDefined();
});

it("continues processing remaining articles when one LLM call fails", async () => {
  const adapter = mockAdapter({
    exists: vi.fn().mockResolvedValue(true),
    list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/A.md", "!Wiki/work/B.md"], folders: [] }),
    read: vi.fn().mockResolvedValue("---\ntags: []\n---\n# Page\n\nContent."),
  });
  const vt = new VaultTools(adapter, VAULT_ROOT);
  // First lint call returns invalid JSON (will fail parseWithRetry), second returns valid
  let callCount = 0;
  const llm: LlmClient = {
    chat: {
      completions: {
        create: vi.fn().mockImplementation(() => {
          callCount++;
          const content = callCount === 1
            ? "NOT VALID JSON {{{" // will fail LintOutputSchema parse
            : callCount === 2
            ? JSON.stringify({ reasoning: "ok", report: "B is fine.", fixes: [] })
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
  // Should reach result event (not crash)
  expect(events.some((e: any) => e.kind === "result")).toBe(true);
  // Report should mention B is fine
  const result = events.find((e: any) => e.kind === "result") as any;
  expect(result.text).toContain("B is fine");
});
```

- [ ] **Step 2: Run new tests to verify they fail**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|PASS|✓|✗|×" | tail -30
```

Expected: new tests FAIL, existing tests PASS.

- [ ] **Step 3: Update `makeLlm` helper in `tests/phases/lint.test.ts`**

Replace the `makeLlm` function (lines 18-37) with:

```typescript
function makeLlm(reportJson: string, configJson = "{}", lintCallCount = 1): LlmClient {
  let callCount = 0;
  return {
    chat: {
      completions: {
        create: vi.fn().mockImplementation((_params: any) => {
          const call = ++callCount;
          const content = call <= lintCallCount ? reportJson : configJson;
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

- [ ] **Step 4: Update `"does not rewrite _index.md"` test to pass `lintCallCount = 2`**

Find this test (around line 258) and update its `runLint` call:

```typescript
// Before:
runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] })), "model", [domain], VAULT_ROOT, new AbortController().signal),
// After:
runLint(["work"], vt, makeLlm(JSON.stringify({ reasoning: "ok", report: "No issues.", fixes: [] }), "{}", 2), "model", [domain], VAULT_ROOT, new AbortController().signal),
```

- [ ] **Step 5: Implement the refactored `runLint` in `src/phases/lint.ts`**

The diff is large. Replace the body of `runLint` for each domain with the new per-article loop. Complete new implementation:

```typescript
import { join } from "path-browserify";
import type OpenAI from "openai";
import type { DomainEntry, EntityType } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams } from "./llm-utils";
import { parseWithRetry } from "./parse-with-retry";
import { EntityTypesDeltaSchema, LintOutputSchema } from "./zod-schemas";
import type { LintOutput } from "./zod-schemas";
import lintTemplate from "../../prompts/lint.md";
import { render } from "./template";
import { GLOBAL_WIKI_SCHEMA_PATH, domainWikiFolder, domainIndexPath } from "../wiki-path";
import { upsertRawFrontmatter, parseWikiArticlesFromFm, parseWikiSourcesFromFm } from "../utils/raw-frontmatter";
import { checkGraphStructure, pageId, bfsExpand } from "../wiki-graph";
import { checkWikiLinks, fixWikiLinks } from "../wiki-link-validator";
import { graphCache } from "../wiki-graph-cache";
import { upsertIndexAnnotation, parseIndexAnnotations } from "../wiki-index";
import { appendWikiLog } from "../wiki-log";
import { ensureDomainConfig } from "../domain-config";
import type { PageSimilarityService } from "../page-similarity";

const META_FILES = ["_index.md", "_log.md"];

export async function* runLint(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  hubThreshold: number = 20,
  wikiLinkValidationRetries: number = 3,
  opts: LlmCallOptions = {},
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent> {
  const domainId = args[0];
  const targets = domainId
    ? domains.filter((d) => d.id === domainId)
    : domains;

  if (targets.length === 0) {
    yield { kind: "error", message: domainId ? `Domain "${domainId}" not found.` : "No domains configured." };
    return;
  }

  const start = Date.now();
  const reportParts: string[] = [];
  let outputTokens = 0;

  for (const domain of targets) {
    if (signal.aborted) return;

    const absWiki = join(vaultRoot, domainWikiFolder(domain.wiki_folder));
    const wikiVaultPath = vaultTools.toVaultPath(absWiki);
    if (!wikiVaultPath) {
      reportParts.push(`## ${domain.id}\nWiki folder outside vault — skipped.`);
      continue;
    }

    yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
    await ensureDomainConfig(vaultTools, wikiVaultPath);
    const schemaContent = await tryRead(vaultTools, GLOBAL_WIKI_SCHEMA_PATH);
    const allFiles = await vaultTools.listFiles(wikiVaultPath);
    const files = allFiles.filter((f) => !META_FILES.some((m) => f.endsWith(m)));
    yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };

    const pages = await vaultTools.readAll(files);

    // Build initial graph + structural checks on all pages
    let { graph } = graphCache.get(domain.id, pages);
    const structuralIssues = checkStructure(pages);
    const graphIssues = checkGraphStructure(graph, hubThreshold);
    const wikiLinkIssues = checkWikiLinks(pages);
    const allStructuralIssues = [structuralIssues, graphIssues, wikiLinkIssues].filter(Boolean).join("\n");

    // Vault-wide paths for fixWikiLinks + backlink sync (computed once)
    const allVaultPaths = await vaultTools.listFiles("").catch(() => [] as string[]);
    const allMdPaths = allVaultPaths.filter(p => p.endsWith(".md"));
    const knownStems = new Set([
      ...allMdPaths.map(p => p.split("/").pop()!.replace(/\.md$/, "")),
      ...[...pages.keys()].map((p) => p.split("/").pop()!.replace(/\.md$/, "")),
    ]);
    const stemToPath = new Map<string, string>(
      allMdPaths.map(p => [p.split("/").pop()!.replace(/\.md$/, ""), p])
    );

    // Index annotations + article iteration order
    const indexRaw = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
    const annotations = parseIndexAnnotations(indexRaw);
    const pidToPath = new Map(files.map(p => [pageId(p), p]));
    const articlePaths = [...new Set([
      ...[...annotations.keys()].map(pid => pidToPath.get(pid)!).filter(Boolean),
      ...files,
    ])];

    // Load embedding cache before loop (moved from end)
    if (similarity?.config.mode === "embedding") {
      yield { kind: "info_text", icon: "📥", summary: "загрузка кэша векторов..." };
      await similarity.loadCache(wikiVaultPath, vaultTools);
    }

    const entityTypesBlock = buildEntityTypesBlock(domain);
    const systemContent = render(lintTemplate, {
      domain_name: domain.name,
      entity_types_block: entityTypesBlock ? `\nТИПЫ СУЩНОСТЕЙ ДОМЕНА:\n${entityTypesBlock}` : "",
      schema_block: schemaContent ? `\nКонвенции (_wiki_schema.md):\n${schemaContent}` : "",
    });

    yield { kind: "assistant_text", delta: `Evaluating domain "${domain.id}" quality...\n` };

    const deletedRefs: { deletedName: string; redirectName: string | null }[] = [];
    const skippedArticles: string[] = [];
    const total = articlePaths.length;

    // ── Per-article loop ──────────────────────────────────────────────────────
    for (let i = 0; i < total; i++) {
      if (signal.aborted) return;

      const targetPath = articlePaths[i];
      const articleName = targetPath.split("/").pop()!.replace(/\.md$/, "");
      const articleContent = pages.get(targetPath) ?? "";

      // Context selection: top-K similar + BFS expansion
      const otherPaths = files.filter(p => p !== targetPath && pages.has(p));
      const topKPaths = similarity
        ? await similarity.selectRelevant(articleContent, annotations, otherPaths)
        : [];
      const seeds = [pageId(targetPath), ...topKPaths.map(p => pageId(p))];
      const expanded = bfsExpand(seeds, graph, 1);
      const contextPaths = [...expanded]
        .map(pid => pidToPath.get(pid))
        .filter((p): p is string => !!p && p !== targetPath && pages.has(p));

      // Per-article structural issues
      const articleIssues = allStructuralIssues
        .split("\n")
        .filter(l => l.includes(articleName) || l.includes(targetPath))
        .join("\n") || "Нет.";

      // Build user message
      const contextBlock = contextPaths
        .map(p => `--- ${p} ---\n${pages.get(p) ?? ""}`)
        .join("\n\n");
      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
        { role: "system", content: systemContent },
        {
          role: "user",
          content: [
            `Домен: ${domain.id} (${domain.name})`,
            `Анализируемая статья: ${targetPath}`,
            `Автоматические проблемы:\n${articleIssues}`,
            "",
            `--- ${targetPath} ---`,
            articleContent,
            "",
            contextBlock ? `--- Контекст (связанные статьи) ---\n${contextBlock}` : "",
          ].filter(l => l !== undefined).join("\n"),
        },
      ];

      yield { kind: "info_text", icon: "🔍", summary: `Checking ${i + 1}/${total}: ${articleName}` };
      yield { kind: "tool_use", name: "Analysing wiki", input: { article: articleName, context: contextPaths.length } };

      const pwtEvents: RunEvent[] = [];
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
          onEvent: (ev) => pwtEvents.push(ev),
        });
        const delCount = (lintResult.value.deletes ?? []).length;
        yield { kind: "tool_result", ok: true, preview: `${lintResult.value.fixes.length} fixes${delCount ? `, ${delCount} deleted` : ""}` };
      } catch (e) {
        if (signal.aborted || (e as Error).name === "AbortError") return;
        yield { kind: "tool_result", ok: false, preview: (e as Error).message };
        for (const ev of pwtEvents) yield ev;
        skippedArticles.push(articleName);
        continue;
      }
      for (const ev of pwtEvents) yield ev;
      if (signal.aborted) return;

      outputTokens += lintResult.outputTokens;
      const { fixes, deletes = [] } = lintResult.value;

      yield { kind: "assistant_text", delta: lintResult.value.report };
      reportParts.push(`### ${articleName}\n${lintResult.value.report}`);

      // Apply fixes (fixWikiLinks per-step)
      if (fixes.length > 0) {
        const fixesMapThisStep = new Map(fixes.map(p => [p.path, p]));
        const wlFixResult = fixWikiLinks(fixesMapThisStep, wikiLinkValidationRetries, knownStems);
        if (wlFixResult.warnings.length > 0) {
          yield { kind: "info_text", icon: "⚠️", summary: "WikiLink warnings", details: wlFixResult.warnings };
        }
        for (const fix of fixes) {
          yield { kind: "assistant_text", delta: `  • ${fix.path.split("/").pop()}...\n` };
          if (!fix.path.startsWith(wikiVaultPath + "/")) {
            yield { kind: "tool_use", name: "Write", input: { path: fix.path } };
            yield { kind: "tool_result", ok: false, preview: `Blocked: path outside wiki folder (${wikiVaultPath})` };
            continue;
          }
          yield { kind: "tool_use", name: "Update", input: { path: fix.path } };
          try {
            const fixedContent = wlFixResult.fixed.get(fix.path) ?? fix.content;
            await vaultTools.write(fix.path, fixedContent);
            pages.set(fix.path, fixedContent);
            if (fix.annotation) {
              annotations.set(pageId(fix.path), fix.annotation);
              try {
                await upsertIndexAnnotation(vaultTools, wikiVaultPath, pageId(fix.path), fix.annotation, fix.path);
              } catch { /* non-critical */ }
            }
            yield { kind: "tool_result", ok: true };
          } catch (e) {
            yield { kind: "tool_result", ok: false, preview: (e as Error).message };
          }
        }
        reportParts.push(`#### Исправлено: ${fixes.length} страниц`);
      }

      // Process deletes
      for (const { path: delPath, redirectTo } of deletes) {
        const deletedName = pageId(delPath);
        const redirectName = redirectTo ? pageId(redirectTo) : null;

        yield { kind: "tool_use", name: "Delete", input: { path: delPath } };
        try {
          if (typeof vaultTools.remove === "function") {
            await vaultTools.remove(delPath);
          }
          pages.delete(delPath);
          annotations.delete(deletedName);

          // Rewrite [[deletedName]] links in all wiki pages
          for (const [wikiPath, wikiContent] of pages) {
            if (wikiContent.includes(`[[${deletedName}]]`)) {
              const newContent = redirectName
                ? wikiContent.replaceAll(`[[${deletedName}]]`, `[[${redirectName}]]`)
                : wikiContent.replaceAll(`[[${deletedName}]]`, "");
              await vaultTools.write(wikiPath, newContent);
              pages.set(wikiPath, newContent);
            }
          }

          deletedRefs.push({ deletedName, redirectName });
          yield { kind: "tool_result", ok: true, preview: redirectName ? `merged → [[${redirectName}]]` : "deleted" };
        } catch (e) {
          yield { kind: "tool_result", ok: false, preview: (e as Error).message };
        }
      }

      // Rebuild graph + refresh vectors after state changes
      ({ graph } = graphCache.get(domain.id, pages));
      if (similarity) {
        const { updated } = await similarity.refreshCache(wikiVaultPath, vaultTools, annotations);
        if (similarity.config.mode === "embedding" && updated > 0) {
          yield { kind: "info_text", icon: "📤", summary: `обновлено векторов: ${updated}` };
        }
      }
    }
    // ── End per-article loop ──────────────────────────────────────────────────

    // Skipped articles summary
    if (skippedArticles.length > 0) {
      reportParts.push(`### Пропущены (ошибка LLM)\n${skippedArticles.map(a => `- ${a}.md`).join("\n")}`);
    }

    // Source-file backlink rewrite for deleted articles (one vault-wide scan)
    if (deletedRefs.length > 0) {
      for (const sourcePath of allMdPaths) {
        const content = await vaultTools.read(sourcePath).catch(() => null);
        if (!content) continue;
        let updated = content;
        for (const { deletedName, redirectName } of deletedRefs) {
          if (updated.includes(`[[${deletedName}]]`)) {
            updated = redirectName
              ? updated.replaceAll(`[[${deletedName}]]`, `[[${redirectName}]]`)
              : updated.replaceAll(`[[${deletedName}]]`, "");
          }
        }
        if (updated !== content) await vaultTools.write(sourcePath, updated);
      }
    }

    if (signal.aborted) return;

    // actualizeDomainConfig (unchanged, runs once after loop)
    yield { kind: "assistant_text", delta: `\nActualizing domain config for "${domain.id}"...\n` };
    yield { kind: "tool_use", name: "Updating config", input: {} };
    const patchRes = await actualizeDomainConfig(domain, pages, llm, model, opts, signal);
    yield { kind: "tool_result", ok: true, preview: patchRes.patch ? "config updated" : "no changes" };
    outputTokens += patchRes.outputTokens;
    const patch = patchRes.patch;
    if (patch) {
      const diffReport = computeEntityDiff(domain.entity_types ?? [], patch.entity_types ?? domain.entity_types ?? []);
      reportParts.push(diffReport);
      yield { kind: "domain_updated", domainId: domain.id, patch };
    }

    if (signal.aborted) return;

    // Backlink sync: wiki_articles from wiki_sources (unchanged logic)
    const backlinks = new Map<string, Set<string>>();
    for (const [wikiPath, wikiContent] of pages) {
      for (const src of parseWikiSourcesFromFm(wikiContent)) {
        const bareName = src.slice(2, -2);
        const rawPath = bareName.includes("/")
          ? bareName
          : (stemToPath.get(bareName) ?? bareName);
        if (!backlinks.has(rawPath)) backlinks.set(rawPath, new Set());
        backlinks.get(rawPath)!.add(`[[${wikiPath.split("/").pop()!.replace(/\.md$/, "")}]]`);
      }
    }

    const syncToday = new Date().toISOString().slice(0, 10);
    let syncUpdated = 0;
    for (const [rawPath, articles] of backlinks) {
      yield { kind: "tool_use", name: "Update", input: { path: rawPath } };
      try {
        const rawContent = await vaultTools.read(rawPath);
        const existingArticles = parseWikiArticlesFromFm(rawContent);
        const mergedArticles = [...new Set([...existingArticles, ...articles])];
        const newContent = upsertRawFrontmatter(rawContent, {
          wiki_updated: syncToday,
          wiki_articles: mergedArticles,
        });
        await vaultTools.write(rawPath, newContent);
        syncUpdated++;
        yield { kind: "tool_result", ok: true, preview: rawPath };
      } catch (e) {
        yield {
          kind: "tool_result",
          ok: false,
          preview: `backlink sync failed: ${rawPath}: ${(e as Error).message}`,
        };
      }
    }
    if (backlinks.size > 0) {
      reportParts.push(`Backlinks synced: ${syncUpdated} raw files updated`);
    }

    try {
      await appendWikiLog(vaultTools, wikiVaultPath, domain.id, {
        op: "lint",
        domainId: domain.id,
        fixed: [], // individual fixes tracked per-article
        checkedCount: total,
        outputTokens,
      });
    } catch { /* non-critical */ }
  }

  yield { kind: "result", durationMs: Date.now() - start, text: reportParts.join("\n\n---\n\n"), outputTokens: outputTokens || undefined };
}
```

- [ ] **Step 6: Run all tests**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | tail -40
```

Expected: all tests PASS. If any test fails, read the error carefully — it will likely be a mock call count issue. Fix the specific test's `makeLlm` call count.

- [ ] **Step 7: Run full test suite**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -30
```

Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts
git commit -m "feat(lint): replace batch LLM call with per-article loop using similarity context"
```

---

## Task 4: Fix remaining test compatibility issues (if any)

**Files:**
- Modify: `tests/phases/lint.test.ts` (as needed)

After Task 3, some tests may still fail due to `makeLlm` call count expectations. This task covers those fixes.

- [ ] **Step 1: Run lint tests and identify any remaining failures**

```bash
npx vitest run tests/phases/lint.test.ts --reporter=verbose 2>&1 | grep -E "FAIL|×|AssertionError" | head -20
```

- [ ] **Step 2: For each failing test, update `makeLlm` call**

**Pattern:** If a test domain has N wiki articles, pass `lintCallCount = N` as third argument to `makeLlm`.

Common failures:
- Test with 2 articles (`Entity.md`, `Concept.md`): change `makeLlm(json)` → `makeLlm(json, "{}", 2)`
- Test with 3 articles: change → `makeLlm(json, "{}", 3)`

**For tests that use a custom `llm` object** (not `makeLlm`): update the `callCount`-based logic — replace `call === 2 ? configJson : reportJson` with `call > N ? configJson : reportJson` where N = article count.

Identify failing tests from Step 1 and apply the fix pattern above to each.

- [ ] **Step 3: Run full test suite to confirm all pass**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -20
```

Expected: all tests pass, 0 failures.

- [ ] **Step 4: Commit if any changes were made**

```bash
git add tests/phases/lint.test.ts
git commit -m "test(lint): fix makeLlm call count for per-article loop tests"
```

---

## Task 5: Update `lat.md` documentation and run `lat check`

**Files:**
- Modify: `lat.md/operations.md` (Lint section)
- Modify: `lat.md/architecture.md` (PageSimilarityService section — lint usage note)

- [ ] **Step 1: Update `lat.md/operations.md` Lint section**

Read the current section:
```bash
/home/altuser/Документы/Project/iclaude/.nvm-isolated/.claude-isolated/scripts/lat-runner.sh section "lat.md/operations#Operations#Lint"
```

Update the Lint section body to reflect the new per-article approach. The section must have a ≤250 char leading paragraph. Replace with:

```markdown
## Lint

Analyzes wiki pages for a domain one article at a time. For each article selects a limited context set via `PageSimilarityService` + BFS graph expansion, then calls the LLM. Results are merged into `LintOutputSchema`.

Per-article loop:
1. `selectRelevant(articleContent, annotations, otherPaths)` → top-K paths
2. `bfsExpand([articleId, ...topKIds], graph, depth=1)` → expanded page set
3. LLM call with article + context → `{ report, fixes[], deletes[] }`
4. Apply fixes immediately: `fixWikiLinks` per-step, write to vault, update `pages` and `annotations` in-memory
5. Process `deletes`: `vaultTools.remove`, rewrite `[[deleted]]` links in wiki pages
6. Rebuild graph (`graphCache`) + refresh vectors (`similarity.refreshCache`)

After all articles:
- Source-file backlink rewrite (vault-wide scan for deleted article refs)
- `actualizeDomainConfig` — syncs `entity_types` from final wiki content
- Backlink sync — writes `wiki_articles` into source files via `wiki_sources`
- `appendWikiLog`

Emits `info_text "Checking i/N: ArticleName"` per article. Skipped articles (LLM error) reported at end.

`LintOutputSchema.deletes` carries `{ path, redirectTo? }` for duplicate merges. See [[src/phases/lint.ts]], [[llm-pipeline#LLM Progress Events]], [[architecture#PageSimilarityService]].

### Backlink Sync

After writing fixed pages, lint syncs `wiki_articles` backlinks into source files. For each wiki page with `wiki_sources`, it resolves each source to a vault path and appends the wiki page as `[[WikiPageName]]` into the source file's `wiki_articles` field.

`wiki_sources` uses bare names (`[[FileName]]`). Lint builds a `stemToPath` map from all vault `.md` files (via `vaultTools.listFiles("")`) to resolve bare names to vault paths. Legacy path-style entries (containing `/`) are used as-is for backward compatibility. See [[src/phases/lint.ts]].
```

- [ ] **Step 2: Run `lat check`**

```bash
/home/altuser/Документы/Project/iclaude/.nvm-isolated/.claude-isolated/scripts/lat-runner.sh check 2>&1 | tail -30
```

Expected: all checks pass. Fix any broken refs reported.

- [ ] **Step 3: Commit lat.md updates**

```bash
git add lat.md/
git commit -m "docs(lat): update Lint section for per-article loop architecture"
```
