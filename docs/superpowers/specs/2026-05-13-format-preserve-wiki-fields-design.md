# Design: сохранение wiki_* полей при форматировании

**Дата:** 2026-05-13

## Проблема

Ingest и lint записывают `wiki_added`, `wiki_updated`, `wiki_articles` во frontmatter исходного файла через `upsertRawFrontmatter`. При форматировании ЛЛМ получает инструкцию `Поля wiki_* запрещены` и дропает их из вывода. `formatApply` копирует отформатированный контент поверх оригинала — поля теряются.

## Решение

Два изменения:

### 1. `templates/_format_schema.md`

Заменить строку:
```
Поля `wiki_*` запрещены.
```
На:
```
Поля `wiki_*` — не включать в вывод. Они управляются программно и будут восстановлены автоматически.
```

### 2. `src/controller.ts` — `formatApply()`

Добавить хелпер `patchWikiFields(originalContent: string, formattedContent: string): string`:

1. Распарсить из `originalContent` поля:
   - `wiki_updated` — регексом `/^wiki_updated:[ \t]*(.+)$/m`
   - `wiki_added` — регексом `/^wiki_added:[ \t]*(.+)$/m`
   - `wiki_articles` — через `parseWikiArticlesFromFm`
2. Если `wiki_updated` отсутствует — вернуть `formattedContent` без изменений (нечего восстанавливать)
3. Иначе — вернуть `upsertRawFrontmatter(formattedContent, { wiki_added, wiki_updated, wiki_articles })`

**Режим replace (`keepOld=false`):**
```
formattedContent = await adapter.read(p.tempPath)
patched = patchWikiFields(original, formattedContent)
vault.modify(origFile, patched)
adapter.remove(p.tempPath)
```

**Режим keep-old (`keepOld=true`):**
```
// Патч ДО рейнеймов, пока original ещё на месте
originalContent = await adapter.read(p.originalPath)
formattedContent = await adapter.read(p.tempPath)
patched = patchWikiFields(originalContent, formattedContent)
await adapter.write(p.tempPath, patched)   // перезаписать .formatted.md
// Затем рейнеймы
adapter.rename(p.originalPath, deprecatedPath)
adapter.rename(p.tempPath, p.originalPath)
```

Для keepOld-fallback (read+write+remove) то же самое: патч применяется к `fresh` перед `adapter.write(p.originalPath, fresh)`.

## Инварианты

- Если оригинал не имеет `wiki_*` полей — `upsertRawFrontmatter` не вызывается, поведение не меняется
- Значения полей переносятся точно, без изменений
- `wiki_updated` из оригинала не обновляется (это задача lint/ingest)

## Затронутые файлы

- `templates/_format_schema.md` — правило для ЛЛМ
- `src/controller.ts` — логика apply
- `src/utils/raw-frontmatter.ts` — используется как есть, без изменений
