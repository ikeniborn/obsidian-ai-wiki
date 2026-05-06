---
wiki_sources:
  - "docs/superpowers/specs/2026-05-05-devmode-logdir-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - dev-mode
  - logging
aliases:
  - "logPath → logDir"
  - "dev.jsonl"
---

# DevMode logDir (logPath → logDir)

Переименование поля `devMode.logPath` в `devMode.logDir`: пользователь указывает только директорию, имя файла `dev.jsonl` фиксировано в коде. Фактический путь: `path.join(logDir, "dev.jsonl")`.

## Основные характеристики

- **Проблема**: поле `logPath` требовало полного пути с именем файла (`/tmp/llm-wiki-dev.jsonl`); имя файла не несёт пользовательской ценности
- **Решение**: пользователь вводит только директорию; плагин строит путь как `join(logDir, "dev.jsonl")`
- **Миграция**: при загрузке если `devMode.logPath` существует и `devMode.logDir` нет → `logDir = dirname(logPath)` или `""` если logPath пустой
- **Пустой `logDir`**: логирование отключено (поведение не меняется)
- **i18n**: описания в трёх локалях обновляются — указать что вводится директория

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/types.ts` | `devMode.logPath` → `devMode.logDir` |
| `src/agent-runner.ts` | Читать `logDir`, строить путь через `path.join` |
| `src/settings.ts` | Привязка к `logDir`; placeholder `/tmp` |
| `src/i18n.ts` | Описания в en/ru/es |
| `src/main.ts` | Миграция при loadSettings |

## Связанные концепции

- [[dev-mode-prompt-management]]
