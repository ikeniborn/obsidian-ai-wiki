---
wiki_sources:
  - "[[src/utils/raw-frontmatter.ts]]"
wiki_updated: 2026-05-12
wiki_status: developing
wiki_outgoing_links:
  - "[[run-ingest]]"
  - "[[run-lint]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["raw-frontmatter", "upsertRawFrontmatter", "parseWikiArticlesFromFm", "parseWikiSourcesFromFm"]
---
# raw-frontmatter.ts (утилиты frontmatter)

Утилитный модуль для чтения и записи wiki-полей в YAML frontmatter Obsidian-заметок без использования полноценного YAML-парсера. Оперирует строками напрямую через регулярные выражения.

## Расположение

`src/utils/raw-frontmatter.ts`

## Экспортируемые функции

### upsertRawFrontmatter(content, fields)

**Сигнатура:**
```ts
export function upsertRawFrontmatter(
  content: string,
  fields: { wiki_added?: string; wiki_updated: string; wiki_articles: string[] },
): string
```

Вставляет или обновляет поля `wiki_added`, `wiki_updated`, `wiki_articles` в frontmatter файла.

**Поведение:**
- Если frontmatter существует (`---\n...\n---`): удаляет старые wiki-поля (`removeWikiFields`), добавляет новые в конец YAML-блока.
- Если frontmatter отсутствует: создаёт новый блок `---\n{fields}\n---\n` в начале файла.
- Если `fields.wiki_added === undefined`: сохраняет существующее значение `wiki_added` из файла (не перезаписывает дату первого ingest).

**Использование:** вызывается в `runIngest` для записи backlinks в source-файл и в `runLint` для синхронизации backlinks из wiki-страниц.

---

### parseWikiArticlesFromFm(content)

**Сигнатура:**
```ts
export function parseWikiArticlesFromFm(content: string): string[]
```

Парсит поле `wiki_articles` из frontmatter и возвращает массив WikiLink-строк (`[[...]]`).

**Использование:** в `runIngest` — для слияния уже существующих ссылок с новыми при повторном ingest одного файла.

---

### parseWikiSourcesFromFm(content)

**Сигнатура:**
```ts
export function parseWikiSourcesFromFm(content: string): string[]
```

Парсит поле `wiki_sources` из frontmatter wiki-страницы и возвращает массив WikiLink-строк (`[[...]]`).

**Использование:** в `runLint` — для построения обратного индекса `rawPath → Set<wikiPage>` при синхронизации backlinks.

---

## Внутренние функции

| Функция | Назначение |
|---|---|
| `FM_RE` | Regex `/^---\n([\s\S]*?)\n---\n?/` — захватывает YAML-блок |
| `removeWikiFields(yaml)` | Удаляет строки `wiki_added`, `wiki_updated`, `wiki_articles` из YAML |
| `buildWikiFields(fields)` | Форматирует wiki-поля в YAML-строки |

## Связанные концепции

- [[run-ingest]] — использует `upsertRawFrontmatter` и `parseWikiArticlesFromFm` для backlinks в source
- [[run-lint]] — использует `upsertRawFrontmatter` и `parseWikiSourcesFromFm` для backlink sync
