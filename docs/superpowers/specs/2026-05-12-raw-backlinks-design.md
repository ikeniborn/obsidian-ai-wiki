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

Формат `wiki_articles` идентичен `wiki_sources` — Obsidian wikilinks.

## Approach: Regex-upsert (Подход A)

Утилитарная функция `upsertRawFrontmatter` манипулирует frontmatter через regex — тот же паттерн что в `controller.ts:90`. Нет новых зависимостей.

## Components

### 1. `src/utils/raw-frontmatter.ts` (новый файл)

```typescript
export function upsertRawFrontmatter(
  content: string,
  fields: {
    wiki_added?: string;    // undefined = не трогать существующее значение
    wiki_updated: string;
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
- Если задано → перезаписывается (только при первом ingest, когда его ещё нет)

### 2. `src/phases/ingest.ts` — добавить шаг после записи wiki-страниц

Место: после `vaultTools.write` wiki-страниц (строки 99–113).

```
rawContent (уже прочитан раньше, переиспользуем переменную)

isFirstTime = !rawContent.includes('wiki_added:')
existingArticles = parseWikiArticles(rawContent)   // regex по wiki_articles
writtenLinks = pages.map(p => `[[${p.path}]]`)
mergedArticles = union(existingArticles, writtenLinks)

updated = upsertRawFrontmatter(rawContent, {
  wiki_added: isFirstTime ? today : undefined,
  wiki_updated: today,
  wiki_articles: mergedArticles
})

try {
  await vaultTools.write(sourceVaultPath, updated)
  yield { kind: "tool_result", ok: true, preview: `backlinks → ${sourceVaultPath}` }
} catch (e) {
  yield { kind: "tool_result", ok: false, preview: `backlink write failed: ${e}` }
  // не прерываем ingest
}
```

**Поведение `wiki_articles` при ingest:** merge-only (union). Старые ссылки не удаляются.

### 3. `src/phases/lint.ts` — добавить `syncBacklinks` после существующих проверок

```
syncBacklinks(domain, wikiFiles, vaultTools):

  // 1. Build reverse map
  // wikiFiles = string[] (vault paths) из vaultTools.listFiles()
  map = Map<rawVaultPath, Set<wikiArticleWikilink>>
  for each wikiFilePath of wikiFiles:
    content = await vaultTools.read(wikiFilePath)
    sources = parseWikiSources(content)  // regex /wiki_sources:\s*\n((?:\s*-\s*.+\n?)+)/
    for source of sources:
      rawPath = extractPath(source)      // [[path]] → path (strip [[ ]])
      map[rawPath] ??= new Set()
      map[rawPath].add(`[[${wikiFilePath}]]`)

  // 2. Update each raw file
  updated = 0
  for [rawPath, articles] of map:
    try:
      rawContent = await vaultTools.read(rawPath)
      newContent = upsertRawFrontmatter(rawContent, {
        wiki_added: undefined,    // не трогаем — был установлен при ingest
        wiki_updated: today,
        wiki_articles: [...articles]   // полная замена (full sync)
      })
      await vaultTools.write(rawPath, newContent)
      updated++
    catch:
      reportParts.push(`  ⚠ backlink sync failed: ${rawPath}`)

  reportParts.push(`Backlinks synced: ${updated} raw files updated`)
```

**Отличие от ingest:** `wiki_articles` полностью заменяется (full sync), а не merge.  
**`wiki_added` не трогается** при sync — он установлен при первом ingest.

## Behavior Summary

| Операция | `wiki_added` | `wiki_updated` | `wiki_articles` |
|----------|-------------|----------------|-----------------|
| Первый ingest | set today | set today | merge с [] |
| Повторный ingest | не трогать | update | merge с существующими |
| Lint sync | не трогать | update | full replace |

## Tests

### `tests/utils/raw-frontmatter.test.ts` (новый файл)

| Кейс | Вход | Ожидание |
|------|------|----------|
| Нет frontmatter | plain markdown | prepend блок с wiki_ полями |
| Есть FM без wiki_ | `title: X` | добавить wiki_ в конец FM |
| Есть FM + старые wiki_articles | `[A]` + merge `[B]` | результат `[A, B]` |
| `wiki_added` уже есть, `fields.wiki_added=undefined` | `wiki_added: 2026-01-01` | сохранить старую дату |
| `wiki_articles` block style | `wiki_articles:\n  - "[[A]]"` | корректно заменить |
| Пустой файл | `""` | prepend блок |

### `tests/phases/ingest.test.ts` — дополнить существующие тесты

- После ingest `vaultTools.write` вызван для raw-файла с корректным frontmatter
- Повторный ingest: `wiki_added` не меняется, `wiki_articles` — union
- Ошибка write raw → ingest не падает

### `tests/phases/lint.test.ts` — дополнить

- `syncBacklinks` строит корректный map из `wiki_sources`
- raw-файлы обновлены с полным списком (full replace)
- raw-файл вне vault → warning в report, не fail

## UI / Events

Backlink-запись отображается через существующий `tool_result` event — отдельный UI-компонент не нужен.

## Constraints

- Ошибка записи backlink не прерывает ingest/lint
- `wiki_added` никогда не перезаписывается автоматически после первой установки
- Raw-файл вне vault при lint sync — пропускается с warning
- Не трогаем raw-файлы без записей в backlink map (могут быть источниками другого домена)
