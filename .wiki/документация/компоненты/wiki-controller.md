---
wiki_sources: ["docs/architecture/README.md", "docs/architecture/overview.yaml", "docs/architecture/diagrams/data-flow.md", "docs/architecture/diagrams/dependency-graph.md"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[архитектура-плагина]]"
  - "[[single-flight-guard]]"
  - "[[async-generator-events]]"
  - "[[поток-выполнения-операции]]"
wiki_external_links: []
tags: ["docs", "architecture", "obsidian-llm-wiki"]
aliases: ["WikiController", "controller.ts", "orchestrator"]
---

# WikiController (controller.ts)

Центральный оркестратор плагина obsidian-llm-wiki. Обеспечивает single-flight guard, диспетчеризацию операций, управление доменами и историей операций.

## Основные характеристики

- **Файл:** `src/controller.ts`
- **Слой:** Application (оркестрация)
- **Ключевые обязанности:**
  - Single-flight guard через `this.current` (AbortController)
  - Создание `AgentRunner` и `ClaudeCliClient`
  - Итерация `AsyncGenerator<RunEvent>` и передача событий в `LlmWikiView`
  - Перехват событий `domain_created`, `source_path_added` → обновление settings
  - Управление историей операций (лимит 20 записей)

## Зависимости

Использует: `AgentRunner`, `LlmWikiView`, `ClaudeCliClient`, `VaultTools`, `DomainEntry`, `consolidateSourcePaths()`, `modals`, `i18n`.
