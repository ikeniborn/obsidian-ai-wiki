# Format: Preserve wiki_* Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent `formatApply` from losing `wiki_added`, `wiki_updated`, `wiki_articles` frontmatter fields that were written by ingest/lint.

**Architecture:** Add a pure `patchWikiFields(original, formatted)` helper in `controller.ts` that copies `wiki_*` fields from the original file into the formatted content via `upsertRawFrontmatter`. Call it in `formatApply` before writing, in both replace and keep-old branches.

**Tech Stack:** TypeScript, Vitest, existing `upsertRawFrontmatter` / `parseWikiArticlesFromFm` from `src/utils/raw-frontmatter.ts`.

---

### Task 1: Write failing tests for wiki_* preservation

**Files:**
- Modify: `tests/controller-format.test.ts`

The existing test `"formatApply переносит content из temp в оригинал"` mocks only ONE `adapter.read`. After our change, `formatApply` will read BOTH the original file AND the temp file, so the existing test will break. We update it first, then add new assertion tests.

- [ ] **Step 1: Update the existing formatApply test to mock two reads**

In `tests/controller-format.test.ts`, find the test `"formatApply переносит content из temp в оригинал, удаляет temp"` (line 95) and replace it:

```typescript
it("formatApply переносит content из temp в оригинал, удаляет temp", async () => {
  const { ctrl, app } = build();
  (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
    originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
  };
  // First read: original (no wiki fields) → patch is no-op
  // Second read: temp (formatted content)
  (app.vault.adapter.read as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce("")
    .mockResolvedValueOnce("ОТФОРМАТИРОВАНО");
  await ctrl.formatApply(false);
  expect(app.vault.adapter.write).toHaveBeenCalledWith("x.md", "ОТФОРМАТИРОВАНО");
  expect(app.vault.adapter.remove).toHaveBeenCalledWith("!Temp/x.formatted.md");
  expect((ctrl as unknown as { _pendingFormat: unknown })._pendingFormat).toBeNull();
});
```

- [ ] **Step 2: Add test — original has wiki_* fields → preserved after replace apply**

Append inside the `describe("WikiController formatApply / formatCancel / formatRefine")` block:

```typescript
it("formatApply(replace) сохраняет wiki_* поля из оригинала", async () => {
  const { ctrl, app } = build();
  (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
    originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
  };
  const original = [
    "---",
    "wiki_added: 2026-01-01",
    "wiki_updated: 2026-05-01",
    "wiki_articles:",
    '  - "[[AI]]"',
    "---",
    "Старый текст",
  ].join("\n");
  const formatted = "---\ntags:\n  - note\n---\nНовый текст";
  (app.vault.adapter.read as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce(formatted);
  await ctrl.formatApply(false);
  const written = (app.vault.adapter.write as ReturnType<typeof vi.fn>).mock.calls[0][1] as string;
  expect(written).toContain("wiki_updated: 2026-05-01");
  expect(written).toContain("wiki_added: 2026-01-01");
  expect(written).toContain("[[AI]]");
  expect(written).toContain("Новый текст");
});
```

- [ ] **Step 3: Add test — original without wiki_* fields → content unchanged**

```typescript
it("formatApply(replace) без wiki_* в оригинале — контент без изменений", async () => {
  const { ctrl, app } = build();
  (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
    originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
  };
  const original = "---\ntags:\n  - note\n---\nОригинал";
  const formatted = "---\ntags:\n  - note\n---\nОтформатировано";
  (app.vault.adapter.read as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce(original)
    .mockResolvedValueOnce(formatted);
  await ctrl.formatApply(false);
  expect(app.vault.adapter.write).toHaveBeenCalledWith("x.md", formatted);
});
```

- [ ] **Step 4: Add test — keepOld=true (fallback path) сохраняет wiki_* поля**

```typescript
it("formatApply(keepOld) сохраняет wiki_* поля (fallback read+write+remove)", async () => {
  const { ctrl, app } = build();
  (ctrl as unknown as { _pendingFormat: unknown })._pendingFormat = {
    originalPath: "x.md", tempPath: "!Temp/x.formatted.md", chat: [],
  };
  (app.vault.adapter.exists as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
  const original = [
    "---",
    "wiki_updated: 2026-05-01",
    "wiki_articles:",
    '  - "[[AI]]"',
    "---",
    "Старый",
  ].join("\n");
  const formatted = "---\ntags:\n  - note\n---\nНовый";
  (app.vault.adapter.read as ReturnType<typeof vi.fn>)
    .mockResolvedValueOnce(original)   // p.originalPath
    .mockResolvedValueOnce(formatted); // p.tempPath
  await ctrl.formatApply(true);
  const writeCalls = (app.vault.adapter.write as ReturnType<typeof vi.fn>).mock.calls as [string, string][];
  const toOriginal = writeCalls.find(([path]) => path === "x.md");
  expect(toOriginal?.[1]).toContain("wiki_updated: 2026-05-01");
  expect(toOriginal?.[1]).toContain("[[AI]]");
  expect(toOriginal?.[1]).toContain("Новый");
  // deprecated file gets the unmodified original
  const toDeprecated = writeCalls.find(([path]) => path === "x.deprecated.md");
  expect(toDeprecated?.[1]).toBe(original);
});
```

- [ ] **Step 5: Run tests — убедиться, что новые тесты падают, обновлённый существующий — пока тоже (до реализации)**

```bash
npx vitest run tests/controller-format.test.ts
```

Ожидаемо: 3 новых теста FAIL (функция ещё не реализована), обновлённый тест — FAIL (два read вместо одного ещё не поддержаны).

---

### Task 2: Реализовать patchWikiFields + обновить formatApply

**Files:**
- Modify: `src/controller.ts`

- [ ] **Step 1: Добавить импорт raw-frontmatter в начало `src/controller.ts`**

После строки `import { domainWikiFolder } from "./wiki-path";` добавить:

```typescript
import { upsertRawFrontmatter, parseWikiArticlesFromFm } from "./utils/raw-frontmatter";
```

- [ ] **Step 2: Добавить функцию `patchWikiFields` перед классом `WikiController`**

Вставить после функции `toVaultPath` (после строки `}`), перед первым `export` или объявлением класса:

```typescript
function patchWikiFields(originalContent: string, formattedContent: string): string {
  const wikiUpdatedMatch = /^wiki_updated:[ \t]*(.+)$/m.exec(originalContent);
  if (!wikiUpdatedMatch) return formattedContent;
  const wikiUpdated = wikiUpdatedMatch[1].trim();
  const wikiAddedMatch = /^wiki_added:[ \t]*(.+)$/m.exec(originalContent);
  const wikiAdded = wikiAddedMatch?.[1].trim();
  const wikiArticles = parseWikiArticlesFromFm(originalContent);
  return upsertRawFrontmatter(formattedContent, {
    wiki_added: wikiAdded,
    wiki_updated: wikiUpdated,
    wiki_articles: wikiArticles,
  });
}
```

- [ ] **Step 3: Обновить ветку `keepOld=true` в `formatApply` (строки 109–124)**

Заменить весь блок `if (keepOld) { ... }`:

```typescript
if (keepOld) {
  const deprecatedPath = p.originalPath.replace(/\.md$/, ".deprecated.md");
  if (await adapter.exists(deprecatedPath)) {
    throw new Error(`${deprecatedPath} уже существует — удалите вручную или примените delete-old`);
  }
  const originalContent = await adapter.read(p.originalPath);
  const formattedContent = await adapter.read(p.tempPath);
  const patched = patchWikiFields(originalContent, formattedContent);
  if (adapter.rename) {
    await adapter.write(p.tempPath, patched);
    await adapter.rename(p.originalPath, deprecatedPath);
    await adapter.rename(p.tempPath, p.originalPath);
  } else {
    // fallback: read+write+remove
    await adapter.write(deprecatedPath, originalContent);
    await adapter.write(p.originalPath, patched);
    await this.app.vault.adapter.remove(p.tempPath);
  }
}
```

- [ ] **Step 4: Обновить ветку `keepOld=false` в `formatApply` (строки 125–134)**

Заменить блок `} else { ... }`:

```typescript
} else {
  const originalContent = await adapter.read(p.originalPath);
  const content = await adapter.read(p.tempPath);
  const patched = patchWikiFields(originalContent, content);
  const origFile = this.app.vault.getAbstractFileByPath(p.originalPath);
  if (origFile instanceof TFile) {
    await this.app.vault.modify(origFile, patched);
  } else {
    await adapter.write(p.originalPath, patched);
  }
  await this.app.vault.adapter.remove(p.tempPath);
}
```

- [ ] **Step 5: Запустить тесты — все должны PASS**

```bash
npx vitest run tests/controller-format.test.ts
```

Ожидаемо: все тесты PASS.

- [ ] **Step 6: Запустить полный test suite**

```bash
npm test
```

Ожидаемо: все тесты PASS, нет регрессий.

- [ ] **Step 7: Commit**

```bash
git add src/controller.ts tests/controller-format.test.ts
git commit -m "feat(format): preserve wiki_* frontmatter fields on apply"
```

---

### Task 3: Обновить _format_schema.md

**Files:**
- Modify: `templates/_format_schema.md`

- [ ] **Step 1: Заменить правило про wiki_* поля**

В файле `templates/_format_schema.md` найти строку:
```
Поля `wiki_*` запрещены.
```

Заменить на:
```
Поля `wiki_*` — не включать в вывод. Они управляются программно и будут восстановлены автоматически.
```

- [ ] **Step 2: Version bump + build**

Прочитать версию из `package.json`. Текущая: `0.1.81`. Поднять patch: `0.1.82`.

Обновить `package.json` — поле `version`: `"0.1.82"`.
Обновить `src/manifest.json` — поле `version`: `"0.1.82"`.

```bash
npm run build
```

Ожидаемо: `main.js` пересобран без ошибок.

- [ ] **Step 3: Commit**

```bash
git add templates/_format_schema.md package.json src/manifest.json main.js
git commit -m "chore: bump version to 0.1.82, build — format preserves wiki_* fields"
```
