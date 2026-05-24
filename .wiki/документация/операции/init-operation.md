---
wiki_status: developing
wiki_sources:
  - README.md
  - prompts/init.md
  - prompts/init-incremental.md
  - docs/superpowers/specs/2026-05-15-reinit-force-design.md
wiki_updated: 2026-05-21
wiki_domain: документация
wiki_outgoing_links:
  - "[[ingest-operation]]"
  - "[[поток-выполнения-операции]]"
  - "[[wiki-controller]]"
  - "[[reasoning-first-json]]"
  - "[[reinit-force-design]]"
tags: [операция, init, домен, инициализация, force]
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

## Поток выполнения (no-sources путь)

Начиная с версии 0.1.113 `runInit` без `--sources` больше не делает vault-sampling (случайные файлы vault → LLM). Вместо этого:

```
domainId → найти в настройках
  ↓ не найден       → error "domain not found — add it in settings first"
  ↓ entity_types > 0 → error "already initialised. Use Lint"
  ↓ source_paths пуст → error "no source_paths configured — add them in settings"
  ↓ делегация        → runInitWithSources(existing.source_paths, ...)
```

Путь `--sources` и `--force` — без изменений.

## Флаги CLI

| Флаг | Назначение |
|---|---|
| `--dry-run` | Запуск без записи на диск (preview изменений) |
| `--sources <p1> <p2> ...` | Явный список путей источников; иначе берутся из `entry.source_paths` настроек домена |
| `--force` | Полная переинициализация: wipe wiki-папки домена + сброс `entity_types`/`analyzed_sources`/`language_notes` + повторный bootstrap+delta+ingest. См. [[reinit-force-design]]. Несовместим с `--dry-run`; требует существующий домен и непустые `source_paths` |

## Ограничения платформы

Только desktop.

## Связанные страницы

- [[ingest-operation]]
- [[поток-выполнения-операции]]
- [[wiki-controller]]
- [[reasoning-first-json]]
- [[reinit-force-design]] — флаг `--force` (wipe + rebuild)
- [[reinit-button-design]] — UI-кнопка re-init
