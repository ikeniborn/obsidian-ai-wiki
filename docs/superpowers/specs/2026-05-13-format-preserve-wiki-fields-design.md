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

После чтения отформатированного контента (из `.formatted.md`), перед записью в оригинал:

1. Прочитать оригинальный файл (`p.originalPath`)
2. Распарсить из него `wiki_*` поля:
   - `wiki_articles` — через `parseWikiArticlesFromFm`
   - `wiki_added` — регексом `/^wiki_added:[ \t]*(.+)$/m`
   - `wiki_updated` — регексом `/^wiki_updated:[ \t]*(.+)$/m`
3. Если хотя бы одно поле присутствует — вызвать `upsertRawFrontmatter(formattedContent, { wiki_added, wiki_updated, wiki_articles })`
4. Использовать результат вместо `formattedContent`

Применяется для обоих режимов apply: replace (`keepOld=false`) и keep-old (`keepOld=true`).

## Инварианты

- Если оригинал не имеет `wiki_*` полей — `upsertRawFrontmatter` не вызывается, поведение не меняется
- Значения полей переносятся точно, без изменений
- `wiki_updated` из оригинала не обновляется (это задача lint/ingest)

## Затронутые файлы

- `templates/_format_schema.md` — правило для ЛЛМ
- `src/controller.ts` — логика apply
- `src/utils/raw-frontmatter.ts` — используется как есть, без изменений
