---
wiki_sources: ["src/phases/query.ts"]
wiki_updated: 2026-05-08
wiki_status: developing
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[vault-tools]]"
  - "[[llm-client]]"
  - "[[query-промпт]]"
  - "[[run-event]]"
  - "[[wiki-path-ts]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["runQuery", "query.ts"]
---
# runQuery (phases/query.ts)

Фазовая функция операции query. Читает wiki-страницы домена через vault-relative пути, формирует ответ на вопрос пользователя через LLM, при флаге `save` — создаёт новую wiki-страницу `Q-<slug>.md` с ответом.

## Основные характеристики

- **Расположение:** `src/phases/query.ts`
- **Сигнатура:** `async function* runQuery(args, save, vaultTools, llm, model, domains, vaultRoot, signal, opts): AsyncGenerator<RunEvent>`

### Алгоритм

1. Валидация: вопрос (`args[0]`) и `domains[0]` обязательны; `wiki_folder` не должен содержать `..`
2. `wikiVaultPath = domainWikiFolder(domain.wiki_folder)` — vault-relative путь к папке домена
3. `vaultTools.listFiles(wikiVaultPath)` — все `.md`; исключаются мета-файлы `_index.md`, `_log.md`, `_schema.md`
4. Параллельно прочитать `_index.md` и `_schema.md` из родительской папки (best-effort)
5. `vaultTools.readAll(files)` — все wiki-страницы как Map
6. Сборка контекста: `--- {path} ---\n{content}` с обрезкой по `MAX_CONTEXT_CHARS = 80_000`
7. Сборка system-промпта `query.md` через `render()` с `domain_name`, `entity_types_block`, `schema_block` (≤ 2000 chars), `index_block` (≤ 3000 chars)
8. Стриминг через `llm.chat.completions.create(stream: true)`; на ошибку — fallback non-streaming
9. При `save = true` — записать `Q-<slug>.md` с frontmatter (`wiki_status: mature`) в `wikiVaultPath/`

### Mobile-совместимость

Фаза работает целиком через `VaultTools` (vault-relative пути) — нет обращений к `node:fs`/`node:path`. На мобильной платформе работает без изменений.

### Связанные концепции

- [[query-промпт]] — шаблон для формирования ответа
- [[wiki-path-ts]] — `domainWikiFolder()` для построения vault-relative пути
- [[vault-tools]] — `listFiles`, `readAll`, `write`
