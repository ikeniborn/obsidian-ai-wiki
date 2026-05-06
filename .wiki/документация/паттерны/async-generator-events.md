---
wiki_sources: ["docs/architecture/README.md", "docs/architecture/overview.yaml", "docs/architecture/diagrams/data-flow.md"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[архитектура-плагина]]"
  - "[[поток-выполнения-операции]]"
  - "[[wiki-controller]]"
wiki_external_links: []
tags: ["docs", "architecture", "obsidian-llm-wiki"]
aliases: ["AsyncGenerator", "event stream", "RunEvent", "event-driven"]
---

# AsyncGenerator / Event-Driven Stream (RunEvent)

Архитектурный паттерн передачи событий между слоями плагина: каждая операция (ingest, query, lint и др.) реализована как `AsyncGenerator<RunEvent>`, что позволяет транслировать события в реальном времени в UI без колбэков и разделяемого состояния.

## Основные характеристики

- **Тип события:** `RunEvent` (определён в `src/types.ts`)
- **Производители:** файлы в `src/phases/` — каждая фаза возвращает `AsyncGenerator<RunEvent>`
- **Потребитель:** [[wiki-controller|WikiController]] итерирует события через `for await` и передаёт в `LlmWikiView.appendEvent(ev)`
- **Преимущество:** live-рендер в боковой панели без polling и SharedState

## Применение в контексте obsidian-llm-wiki

Поток данных: `phases/*` → `AgentRunner` → `WikiController` → `LlmWikiView`. На каждое событие view обновляет UI. Специальные события (`domain_created`, `source_path_added`) перехватываются контроллером для обновления settings.
