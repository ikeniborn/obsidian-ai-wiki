---
wiki_sources: ["src/controller.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[llm-wiki-view]]"
  - "[[run-event]]"
  - "[[claude-cli-client]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["WikiController", "controller.ts"]
---
# WikiController (controller.ts)

Координатор между UI Obsidian (командами, кнопками) и `AgentRunner`. Обеспечивает single-flight guard, управляет lifecycle AbortController, обрабатывает доменные события из потока.

## Основные характеристики

- **Расположение:** `src/controller.ts`
- **Класс:** `WikiController(app: App, plugin: LlmWikiPlugin)`
- **Single-flight guard:** поле `private current: AbortController | null` — одновременно только одна операция

### Публичный API

| Метод | Описание |
|-------|---------|
| `ingestActive(domainId?)` | Ingest активного файла vault |
| `query(question, save, domainId?)` | Query с опциональным сохранением |
| `lint(domain)` | Lint домена или всей wiki |
| `fix(domainId, lintReport, instruction)` | Fix по результатам lint |
| `chat(operation, domainId, context, history, newMessage)` | Chat-режим |
| `init(domain, dryRun, sourcePaths?)` | Init домена |
| `cancelCurrent()` | Отмена текущей операции (abort) |
| `isBusy()` | Проверка занятости |

### Обработка доменных событий

Контроллер обрабатывает события из потока `AgentRunner`:
- `domain_created` → push в `plugin.settings.domains`, saveSettings
- `domain_updated` → patch entity_types/language_notes, saveSettings
- `source_path_added` → `consolidateSourcePaths()`, saveSettings

### Chat session management

Поле `_chatSessionId` хранит ID сессии claude для многотурного диалога. Сбрасывается при каждой новой операции. При ошибке или abort — сбрасывается для безопасности.

## Связанные концепции

- [[agent-runner]] — исполнитель операций
- [[llm-wiki-view]] — UI, в который контроллер транслирует события
