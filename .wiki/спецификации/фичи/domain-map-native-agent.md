---
wiki_sources:
  - "docs/superpowers/specs/2026-04-28-domain-map-native-agent-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - domain-map
  - native-agent
aliases:
  - "domainMapDir"
  - "NativeAgentSettings.domainMapDir"
---

# Domain Map Storage для Native Agent

Спека определяет, где хранить `domain-map-<vault>.json` при backend = `native-agent`. Подход C: поле `domainMapDir` в `NativeAgentSettings` с вычисляемым дефолтом из Obsidian API.

## Основные характеристики

- **Проблема**: при `backend = native-agent` настройка `cwd` (путь к skillPath) обычно не задана, что блокирует использование доменов
- **Решение**: `domainMapDir: string` в `NativeAgentSettings`; пустое значение → авто-путь `<vault>/.obsidian/plugins/llm-wiki/`
- **Функция `domainMapPath`**: сигнатура меняется — первый аргумент `dir` (готовый путь к директории), а не `skillPath`; ответственность за добавление `"shared/"` переходит к вызывающему коду
- **`resolveDomainMapDir()`**: новый приватный метод в `controller.ts`; для `claude-code` возвращает `join(skillPath, "shared")`, для `native-agent` — `domainMapDir` или авто-путь
- **UI**: новое поле в секции native-agent настроек

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/types.ts` | `domainMapDir: string` в `NativeAgentSettings` |
| `src/domain-map.ts` | Сигнатура `domainMapPath(dir, vaultName)` |
| `src/controller.ts` | `resolveDomainMapDir()` helper |
| `src/settings.ts` | Поле "Папка domain-map" в UI |

## Связанные концепции

- [[native-agent]]
- [[domain-map-in-vault]]
