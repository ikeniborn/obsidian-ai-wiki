---
wiki_sources: ["src/controller.ts"]
wiki_updated: 2026-05-07
wiki_status: developing
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[llm-wiki-view]]"
  - "[[run-event]]"
  - "[[claude-cli-client]]"
  - "[[domain-store]]"
  - "[[local-config]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["WikiController", "controller.ts"]
---
# WikiController (controller.ts)

Координатор между UI Obsidian и `AgentRunner`. Single-flight guard, lifecycle AbortController, обработка доменных событий из потока. Читает/пишет домены через `DomainStore`, `iclaudePath` — через `LocalConfigStore`.

## Основные характеристики

- **Расположение:** `src/controller.ts`
- **Конструктор:** `WikiController(app, plugin, domainStore, localConfigStore)`
- **Single-flight guard:** `_running` флаг

### Публичный API

| Метод | Описание |
|-------|---------|
| `ingestActive(domainId?)` | Ingest активного файла vault |
| `query(question, save, domainId?)` | Query с опциональным сохранением |
| `lint(domain)` | Lint домена или всей wiki |
| `fix(domainId, lintReport, instruction)` | Fix по результатам lint |
| `chat(...)` | Chat-режим |
| `init(domain, dryRun, sourcePaths?)` | Init домена |
| `loadDomains()` | Async чтение через `DomainStore.load()`. Throws `DomainCorruptError`. |
| `registerDomain(input)` | Создаёт домен, save через `DomainStore` |
| `cancelCurrent()` | Отмена текущей операции |
| `isBusy()` | Проверка занятости |

### Обработка доменных событий

В цикле dispatch потока `AgentRunner`:
1. `await domainStore.load()` — текущее состояние
2. `applyDomainEvent(cur, ev, { vaultRoot })` — pure reducer
3. Если ссылка изменилась → `await domainStore.save(next)`
4. На `DomainCorruptError` → `Notice` пользователю, `ctrl.abort()`, `break`

События: `domain_created`, `domain_updated`, `source_path_added`. Параметр `vaultRoot` нужен для `consolidateSourcePaths()` при `source_path_added`.

### iclaudePath из LocalConfigStore

Перед spawn `iclaude.sh` контроллер читает `await localConfigStore.load()` для получения пути. Cached — повторные вызовы не трогают диск.

### Chat session management

`_chatSessionId` хранит ID claude-сессии для многотурного диалога. Сбрасывается при ошибке/abort/новой операции.

## Связанные концепции

- [[domain-store]] — load/save карты доменов
- [[local-config]] — `iclaudePath` для spawn
- [[agent-runner]] — исполнитель операций
- [[llm-wiki-view]] — UI потребитель событий
