# Links → Frontmatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перенести исходящие ссылки wiki-статей из обязательного раздела `## Связанные концепции` в frontmatter-поле `links`, сохранив поддержку Obsidian Graph View.

**Architecture:** Два текстовых файла — схема и промпт. `_schema.md` читается кодом как `schema_block` и передаётся LLM при ingest; обновление схемы автоматически меняет поведение генерации. Frontmatter-ссылки формата `"[[page]]"` распознаются Obsidian 1.4+ и покрываются существующим dead-link checker в `checkStructure` без изменений кода.

**Tech Stack:** Markdown, YAML frontmatter, Obsidian WikiLinks

---

### Task 1: Обновить схему страницы в `templates/_schema.md`

**Files:**
- Modify: `templates/_schema.md`

- [ ] **Step 1: Убрать п.5 из обязательной структуры страницы**

В разделе `## Структура страницы (обязательный порядок)` удалить строку:
```
5. `## Связанные концепции` — WikiLinks на другие страницы
```

Результат раздела:
```markdown
## Структура страницы (обязательный порядок)
1. Frontmatter (YAML)
2. Заголовок H1
3. Вводный абзац — 1-3 предложения без заголовка, сразу после H1
4. `## Основные характеристики` — ключевые свойства и параметры
```

- [ ] **Step 2: Добавить поле `links` в таблицу Frontmatter**

В разделе `## Frontmatter` добавить строку в таблицу после строки `aliases`:
```markdown
| `links` | Массив WikiLinks на связанные страницы: `["[[page-a]]", "[[page-b]]"]`. Пустой массив допустим. |
```

- [ ] **Step 3: Проверить итоговый файл**

Открыть `templates/_schema.md` и убедиться:
- В разделе структуры нет пункта про `## Связанные концепции`
- В таблице Frontmatter есть строка с `links`
- Остальные правила не изменились

- [ ] **Step 4: Коммит**

```bash
git add templates/_schema.md
git commit -m "feat(schema): move outgoing links to frontmatter field"
```

---

### Task 2: Обновить пример JSON в `prompts/ingest.md`

**Files:**
- Modify: `prompts/ingest.md`

- [ ] **Step 1: Добавить `links: []` в пример JSON-ответа LLM**

На строке 18 изменить пример frontmatter в JSON-строке.

Было:
```
[{"path":"{{wiki_path}}/EntityName.md","content":"---\nwiki_sources: [{{source_path}}]\nwiki_updated: {{today}}\nwiki_status: stub\ntags: []\n---\n# EntityName\n\ncontент..."}]
```

Стало:
```
[{"path":"{{wiki_path}}/EntityName.md","content":"---\nwiki_sources: [{{source_path}}]\nwiki_updated: {{today}}\nwiki_status: stub\ntags: []\nlinks: []\n---\n# EntityName\n\ncontент..."}]
```

- [ ] **Step 2: Проверить файл**

Убедиться, что строка 18 содержит `links: []` между `tags: []` и закрывающим `---`, остальной текст файла не изменился.

- [ ] **Step 3: Коммит**

```bash
git add prompts/ingest.md
git commit -m "feat(prompt): add links field to ingest JSON example"
```
