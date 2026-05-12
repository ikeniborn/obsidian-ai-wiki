# Design: Raw File Backlinks (Обратная интеграция)

**Date:** 2026-05-12  
**Status:** Approved

## Problem

Wiki-статьи знают свои источники (`wiki_sources`), но raw-файлы не знают, какие wiki-статьи из них выросли. Нет обратной связи.

## Goal

Добавить в raw-файлы frontmatter с тремя полями:

```yaml
---
wiki_added: 2026-05-12      # дата первого ingest (не меняется)
wiki_updated: 2026-05-12    # дата последнего ingest/sync
wiki_articles:
  - "[[!Wiki/domain/Article.md]]"
  - "[[!Wiki/domain/Another.md]]"
---
```

Формат `wiki_articles` идентичен `wiki_sources` — Obsidian wikilinks. Даты — `YYYY-MM-DD`.

## Approach: Regex-upsert (Подход A)

Утилитарная функция `upsertRawFrontmatter` манипулирует frontmatter через regex — тот же паттерн что в `controller.ts:90`. Нет новых зависимостей.

## Components

### 1. `src/utils/raw-frontmatter.ts` (новый файл)

```typescript
export function upsertRawFrontmatter(
  content: string,
  fields: {
    wiki_added?: string;    // undefined = не трогать существующее значение
    wiki_updated: string;   // YYYY-MM-DD
    wiki_articles: string[];
  }
): string
```

**Алгоритм:**

1. Если файл начинается с `---\n`:
   - Найти закрывающий `---` (первое вхождение после строки 1)
   - Извлечь YAML-блок
   - Удалить наши поля из блока:
     - `wiki_added: ...` (scalar, одна строка)
     - `wiki_updated: ...` (scalar, одна строка)
     - `wiki_articles:\n` + следующие строки с отступом (`  - ...`)
   - Дописать обновлённые поля в конец блока
2. Если нет frontmatter → prepend новый блок

**Семантика `wiki_added`:**
- Если `fields.wiki_added === undefined` → поле не добавляется и не удаляется из существующего FM
- Если задано → записывается (только при первом ingest, когда его ещё нет в файле)

**Важно:** функция принимает готовый список `wiki_articles` и делает replace. Логика merge (union) — в вызывающем коде (ingest.ts).

### 2. `src/phases/ingest.ts` — добавить шаг внутри блока `if (written.length > 0)`

Место: в существующий блок `if (written.length > 0)` (строки 118–124), вместе с `appendLog`/`updateIndex`.  
Переменная raw-контента: `sourceContent` (строка 37, уже прочитана).

```
// внутри if (written.length > 0):

isFirstTime = !sourceContent.includes('wiki_added:')
existingArticles = parseWikiArticlesFromFm(sourceContent)  // regex по wiki_articles блоку
writtenLinks = written.map(p => `[[${p}]]`)                // written — только успешно записанные пути
mergedArticles = [...new Set([...existingArticles, ...writtenLinks])]

updated = upsertRawFrontmatter(sourceContent, {
  wiki_added: isFirstTime ? today : undefined,  // YYYY-MM-DD
  wiki_updated: today,
  wiki_articles: mergedArticles
})

yield { kind: "tool_use", name: "Write", input: { path: sourceVaultPath } }
try {
  await vaultTools.write(sourceVaultPath, updated)
  yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourceVaultPath}` }
} catch (e) {
  yield { kind: "tool_result", ok: false, preview: `backlink write failed: ${e}` }
  // не прерываем ingest
}
```

**`wiki_articles` при ingest:** merge-only (union существующих + только что записанных `written`). Не `pages` (содержит заблокированные пути) — только `written`.

### 3. `src/phases/lint.ts` — добавить `syncBacklinks` после LLM-отчёта

Место: в конец цикла `for (const domain of targets)`, после `reportParts.push(...)` (строка 98).  
Lint уже читает все wiki-страницы в `const pages = await vaultTools.readAll(files)` (строка 52, `Map<vaultPath, content>`). Использовать эту же переменную.

```
// Backlink full sync — используем уже загруженный pages: Map<string, string>

backlinks = new Map<string, Set<string>>()  // rawVaultPath → Set<wikilink>

for [wikiPath, wikiContent] of pages:
  sources = parseWikiSourcesFromFm(wikiContent)  // regex /wiki_sources:\s*\n((?:\s*-\s*.+\n?)+)/
  for source of sources:
    rawPath = source.replace(/^\[\[/, '').replace(/\]\]$/, '')  // [[path]] → path
    if not backlinks.has(rawPath): backlinks.set(rawPath, new Set())
    backlinks.get(rawPath).add(`[[${wikiPath}]]`)

updated = 0
for [rawPath, articles] of backlinks:
  try:
    rawContent = await vaultTools.read(rawPath)
    newContent = upsertRawFrontmatter(rawContent, {
      wiki_added: undefined,          // не трогаем — установлен при первом ingest
      wiki_updated: today,            // YYYY-MM-DD
      wiki_articles: [...articles]    // полная замена (full sync)
    })
    await vaultTools.write(rawPath, newContent)
    updated++
  catch:
    reportParts.push(`  ⚠ backlink sync failed: ${rawPath}`)

reportParts.push(`Backlinks synced: ${updated} raw files updated`)
```

**Отличие от ingest:** `wiki_articles` полностью заменяется (full sync), а не merge.  
**`wiki_added` не трогается** при sync — установлен при первом ingest.  
**Дополнительных reads нет** — lint уже загружает все wiki-страницы через `readAll`.

### 4. init-фаза

`init.ts` внутри вызывает `runIngest()` для каждого source-файла (строки 286–324). Backlinks проставляются автоматически через ingest — отдельной обработки в init не нужно.

## Behavior Summary

| Операция | `wiki_added` | `wiki_updated` | `wiki_articles` |
|----------|-------------|----------------|-----------------|
| Первый ingest | set today | set today | union с [] |
| Повторный ingest | не трогать | update | union с существующими в FM |
| Lint sync | не трогать | update | full replace (по wiki_sources) |
| init | (через ingest) | (через ingest) | (через ingest) |

## Tests

### `tests/utils/raw-frontmatter.test.ts` (новый файл)

Тестирует `upsertRawFrontmatter` как чистую функцию (replace-семантика):

| Кейс | Входной контент | fields | Ожидание |
|------|----------------|--------|----------|
| Нет frontmatter | plain markdown | все поля заданы | prepend блок `---\nwiki_*\n---\n` |
| Есть FM без wiki_ | `---\ntitle: X\n---` | все поля | wiki_ добавлены в конец FM |
| Есть FM + старый wiki_articles `[A]`, вызов с `[A,B]` | block style | `wiki_articles:[A,B]` | FM содержит только `[A,B]` |
| `wiki_added` в FM, `fields.wiki_added=undefined` | `wiki_added: 2026-01-01` | `wiki_added:undefined` | дата сохранена |
| `wiki_added` не в FM, `fields.wiki_added='2026-05-12'` | нет wiki_added | `wiki_added:'2026-05-12'` | поле добавлено |
| Пустой файл | `""` | все поля | prepend блок |

### `tests/phases/ingest.test.ts` — дополнить существующие тесты

- После ingest `vaultTools.write` вызван для `sourceVaultPath` с корректным frontmatter (wiki_added, wiki_updated, wiki_articles = только `written[]`)
- `pages` содержит заблокированный путь → он не попадает в `wiki_articles`
- Повторный ingest: `wiki_added` не меняется, `wiki_articles` — union
- `written.length === 0` → backlink write не вызывается
- Ошибка write raw → ingest не падает, продолжает

### `tests/phases/lint.test.ts` — дополнить

- `syncBacklinks` строит корректный map из `wiki_sources` wiki-страниц
- raw-файлы обновлены с полным списком (full replace), не merge
- `wiki_added` в raw сохранён без изменений
- `vaultTools.read(rawPath)` бросает → warning в reportParts, не fail
- `pages` уже загружен — лишних `read` вызовов нет (mock не ожидает дополнительных вызовов read для wiki-файлов)

## UI / Events

Backlink-запись отображается через существующий `tool_result` event. Перед write — `tool_use` с `name: "Write"`. Отдельный UI-компонент не нужен.

## Constraints

- Backlink write ошибка не прерывает ingest/lint
- `wiki_added` никогда не перезаписывается автоматически после первой установки
- Raw-файл недоступен при lint sync — пропускается с warning в report
- Raw-файлы без записей в backlink map не трогаются
- `wiki_articles` строятся только из `written[]` при ingest (не из `pages[]`)
