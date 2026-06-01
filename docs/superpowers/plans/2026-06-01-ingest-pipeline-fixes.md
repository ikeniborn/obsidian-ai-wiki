---
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-01-ingest-pipeline-fixes-design.md
review:
  plan_hash: 4ac900434bf5914f
  spec_hash: a0b7e4df016e2b66
  last_run: 2026-06-01
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# Ingest Pipeline Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three defects in the ingest pipeline: alias prohibition in synthesis prompt, entity extraction for unknown concept types, and `domain_updated` event ordering.

**Architecture:** Three independent single-file edits — two prompt text changes and one TypeScript block reorder. No new files, no schema changes, no new tests (per spec: prompt fixes are not unit-tested; ordering fix is observable via log). Existing test suite runs after each task as regression guard.

**Tech Stack:** TypeScript (`src/phases/ingest.ts`), plain-text prompts (`prompts/ingest.md`, `prompts/ingest-entities.md`), Vitest

---

## File Map

| File | Change |
|------|--------|
| `prompts/ingest.md` | Add one rule after line 23 (alias prohibition) |
| `prompts/ingest-entities.md` | Replace ЗАДАЧА block (lines 8–12) |
| `src/phases/ingest.ts` | Move `entity_types_delta` block from lines 400–404 to after line 466 |

---

### Task 1: Fix alias prohibition in synthesis prompt

**Files:**
- Modify: `prompts/ingest.md:23`

- [ ] **Step 1: Add the alias prohibition rule**

Open `prompts/ingest.md`. After line 23:
```
- wiki_outgoing_links: ТОЛЬКО вики-страницы (файлы внутри !Wiki/) — bare имя без пути: [[wiki_domain_page]]. Никогда [[ИмяИсточника]]
```

Insert immediately after (new line 24):
```
- В теле статей: ТОЛЬКО [[stem]] — никогда [[stem|алиас]]. Синтаксис [[A|B]] запрещён.
```

Result — lines 23–25 of `prompts/ingest.md`:
```
- wiki_outgoing_links: ТОЛЬКО вики-страницы (файлы внутри !Wiki/) — bare имя без пути: [[wiki_domain_page]]. Никогда [[ИмяИсточника]]
- В теле статей: ТОЛЬКО [[stem]] — никогда [[stem|алиас]]. Синтаксис [[A|B]] запрещён.
- Раздел "## Основные характеристики" обязателен для каждой страницы
```

- [ ] **Step 2: Run existing tests to confirm no regression**

```bash
npm test
```

Expected: all tests pass (the edit touches only prompt text, not TypeScript).

- [ ] **Step 3: Commit**

```bash
git add prompts/ingest.md
git commit -m "fix(prompt): prohibit wikilink alias syntax in synthesis prompt

[[stem|alias]] rejected by zod schema on every attempt 0; explicit
prohibition prevents systematic retry."
```

---

### Task 2: Relax entity extraction constraint for unknown concept types

**Files:**
- Modify: `prompts/ingest-entities.md:8–12`

- [ ] **Step 1: Replace the ЗАДАЧА block**

In `prompts/ingest-entities.md`, replace this block (lines 8–15):

```
ЗАДАЧА:
- Прочитай источник.
- Верни список сущностей, которые встречаются в источнике и соответствуют ТИПАМ выше.
- Для каждой сущности:
  - name: каноническое имя сущности (без кавычек, как заголовок будущей страницы)
  - type: тип из списка выше (опционально, если не подходит ни один — пропусти)
  - context_snippet: одна фраза из источника, поясняющая зачем сущность нужна (опционально)

Не дублируй: один name → одна запись. Не извлекай сущности с min_mentions_for_page > 1, если они упомянуты только раз.
```

With:

```
ЗАДАЧА:
- Прочитай источник.
- Верни все сущности, достойные отдельной wiki-страницы:
  - Если сущность соответствует типу выше → укажи type.
  - Если не соответствует ни одному типу, но концепция значима → верни без type (новый тип, будет определён при синтезе).
  - Не возвращай пустой список, если источник содержит значимые концепции.
- Для каждой сущности:
  - name: каноническое имя сущности (без кавычек, как заголовок будущей страницы)
  - type: тип из списка выше (опционально)
  - context_snippet: одна фраза из источника, поясняющая зачем сущность нужна (опционально)

Не дублируй: один name → одна запись. Не извлекай сущности с min_mentions_for_page > 1, если они упомянуты только раз.
```

The full file after the edit:

```
Ты — извлекатель сущностей из источника для домена «{{domain_name}}».

ТИПЫ СУЩНОСТЕЙ ДОМЕНА:
{{entity_types_block}}
{{lang_notes}}

ЗАДАЧА:
- Прочитай источник.
- Верни все сущности, достойные отдельной wiki-страницы:
  - Если сущность соответствует типу выше → укажи type.
  - Если не соответствует ни одному типу, но концепция значима → верни без type (новый тип, будет определён при синтезе).
  - Не возвращай пустой список, если источник содержит значимые концепции.
- Для каждой сущности:
  - name: каноническое имя сущности (без кавычек, как заголовок будущей страницы)
  - type: тип из списка выше (опционально)
  - context_snippet: одна фраза из источника, поясняющая зачем сущность нужна (опционально)

Не дублируй: один name → одна запись. Не извлекай сущности с min_mentions_for_page > 1, если они упомянуты только раз.

Верни ТОЛЬКО JSON:
{"reasoning":"...","entities":[{"name":"...","type":"...","context_snippet":"..."}]}
```

- [ ] **Step 2: Run existing tests to confirm no regression**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add prompts/ingest-entities.md
git commit -m "fix(prompt): allow entity extraction for unknown concept types

Files with no matching domain entity type (e.g. Исследования криптовалюты.md)
returned 0 entities, causing blind synthesis. Entities without a known type
are now returned without type field; synthesis assigns the type via
entity_types_delta."
```

---

### Task 3: Fix `domain_updated` event ordering in ingest.ts

**Files:**
- Modify: `src/phases/ingest.ts:400–404` (move block to after line 466)

- [ ] **Step 1: Remove the `entity_types_delta` block from its current position**

In `src/phases/ingest.ts`, remove lines 400–404 (the block between `yield { kind: "assistant_text" }` and `const deletedStems`):

```typescript
  const delta = parseResult.value.entity_types_delta;
  if (delta?.length) {
    const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
    yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
  }
```

After removal, lines 397–410 should read:

```typescript
  const resultText = buildIngestSummary(domain.id, sourceVaultPath, createdCount, updatedCount, mergedCount, pages.length);
  yield { kind: "assistant_text", delta: resultText };

  const deletedStems = new Set(deletedPaths.map((p) => p.split("/").pop()!.replace(/\.md$/, "")));

  if (written.length > 0 || deletedPaths.length > 0) {
```

- [ ] **Step 2: Insert the `entity_types_delta` block after `source_path_added`**

After line 466 (the `yield { kind: "source_path_added" ... }` line), insert the block:

```typescript
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }

  const delta = parseResult.value.entity_types_delta;
  if (delta?.length) {
    const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
    yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
  }
```

The full region `src/phases/ingest.ts:397–475` after the edit:

```typescript
  const resultText = buildIngestSummary(domain.id, sourceVaultPath, createdCount, updatedCount, mergedCount, pages.length);
  yield { kind: "assistant_text", delta: resultText };

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
    const { content: repairedSource, warnings: sourceWarnings } =
      validateAndRepairSourceFrontmatter(updatedSource);
    const wikiFileStems = new Set(
      [...existingPaths, ...written]
        .filter(p => !deletedPaths.includes(p) && !p.endsWith("_index.md"))
        .map(p => p.split("/").pop()!.replace(/\.md$/, ""))
    );
    const existingArticleStems = parseWikiArticlesFromFm(repairedSource)
      .map(link => link.slice(2, -2))
      .filter(stem => !GENERIC_WIKI_STEM_REGEX.test(stem));
    const existingStems = new Set([...wikiFileStems, ...existingArticleStems]);
    const { content: filteredSource, warnings: staleWarnings } =
      filterStaleWikiLinks(repairedSource, existingStems, ["wiki_articles", "related"]);
    const allSourceWarnings = [...sourceWarnings, ...staleWarnings];
    if (allSourceWarnings.length > 0) {
      yield {
        kind: "info_text",
        icon: "⚠️",
        summary: "Source frontmatter repaired",
        details: allSourceWarnings,
      };
    }
    yield { kind: "tool_use", name: "Update", input: { path: sourceVaultPath } };
    try {
      await vaultTools.write(sourceVaultPath, filteredSource);
      yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourceVaultPath}` };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: `backlink write failed: ${(e as Error).message}` };
    }

    const parentPath = extractParentSourcePath(absSource, vaultRoot);
    yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
  }

  const delta = parseResult.value.entity_types_delta;
  if (delta?.length) {
    const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
    yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
  }
```

- [ ] **Step 3: Run existing tests**

```bash
npm test
```

Expected: all tests pass. TypeScript must compile without errors.

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit
```

Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add src/phases/ingest.ts
git commit -m "fix(ingest): emit domain_updated after source_path_added

entity_types_delta block was yielding domain_updated before the source
frontmatter write and source_path_added event. Move block to after the
backlink write section so event order is: Update source →
source_path_added → domain_updated."
```
