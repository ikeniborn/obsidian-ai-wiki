---
wiki_status: developing
wiki_sources:
  - README.md
  - prompts/init.md
  - prompts/init-incremental.md
wiki_updated: 2026-05-15
wiki_domain: документация
wiki_outgoing_links:
  - "[[ingest-operation]]"
  - "[[поток-выполнения-операции]]"
  - "[[wiki-controller]]"
  - "[[reasoning-first-json]]"
tags: [операция, init, домен, инициализация]
aliases: ["init operation", "инициализация домена"]
---

# Init Operation

Инициализирует новый wiki-домен с нуля: создаёт структуру папок и служебные файлы, генерирует `entity_types` через LLM-анализ источников.

## Назначение

Первый шаг при добавлении нового раздела wiki. Настраивает домен для последующего ingest корпуса источников. Включает два LLM-промпта: bootstrap-анализ (полный init) и инкрементальное обновление `entity_types`.

## UX-поток

1. `Command Palette` → `AI Wiki: Init домена`.
2. Ввести имя домена (например, `work`).
3. Снять флаг Dry Run → запустить.
4. Плагин создаёт структуру папок и служебные файлы.
5. После init рекомендуется запустить ingest для наполнения домена.

## LLM-промпты

### init.md — Bootstrap-анализ

Полный bootstrap: генерирует начальную запись домена для `domain-map.json`.

Входные данные:
- `{{schema_block}}` — конвенции вики (schema.md)
- `{{index_block}}` — текущий index.md

Выходной JSON (поле `reasoning` первым):
```json
{
  "reasoning": "...",
  "id": "{{domain_id}}",
  "name": "...",
  "wiki_folder": "vaults/{{vault_name}}/!Wiki/{{domain_id}}",
  "source_paths": [],
  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"{{domain_id}}/..."}],
  "language_notes": ""
}
```

### init-incremental.md — Инкрементальное обновление entity_types

Используется при каждом новом файле-источнике в рамках init: уточняет и расширяет `entity_types` на основе нового источника без полного пересчёта.

Входные данные:
- Содержимое одного файла источника
- Текущий список `entity_types` (JSON)

Выходной JSON (поле `reasoning` первым):
```json
{
  "reasoning": "...",
  "entity_types": [{"type":"...","description":"...","extraction_cues":["..."],"min_mentions_for_page":1,"wiki_subfolder":"..."}],
  "language_notes": "..."
}
```

Правила обновления:
- Добавлять новые типы или уточнять описания существующих
- Не менять поле `type` (id) у существующих типов
- `language_notes` обновлять только при наличии новых конвенций
- Возвращать только JSON, без пояснений

Паттерн ответа: [[reasoning-first-json]].

## Ограничения платформы

Только desktop.

## Связанные страницы

- [[ingest-operation]]
- [[поток-выполнения-операции]]
- [[wiki-controller]]
- [[reasoning-first-json]]
