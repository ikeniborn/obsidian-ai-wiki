---
wiki_sources: ["docs/architecture/README.md", "docs/architecture/overview.yaml"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[архитектура-плагина]]"
  - "[[wiki-controller]]"
wiki_external_links: []
tags: ["docs", "architecture", "obsidian-llm-wiki"]
aliases: ["single-flight", "single flight guard", "флаг занятости"]
---

# Single-Flight Guard

Паттерн управления параллельным доступом: в любой момент разрешена только одна активная операция LLM Wiki. Повторный вызов операции во время выполнения текущей отклоняется с уведомлением пользователя.

## Основные характеристики

- **Реализован в:** [[wiki-controller|WikiController]] (`src/controller.ts`, поле `current`)
- **Причина:** `iclaude.sh` не реентерабелен — параллельный spawn испортит stdout-поток и cwd
- **Поведение при конфликте:** Notice("операция уже выполняется") без прерывания текущей операции
- **Флаг:** `this.current` — ссылка на текущий `AbortController`; `null` когда операций нет

## Применение в контексте obsidian-llm-wiki

Проверка `isBusy()` выполняется в `WikiController` до любого spawn. Пользователь видит Notice в UI, новая операция не запускается. После завершения текущей операции `current` сбрасывается в `null`, и следующий вызов проходит.
