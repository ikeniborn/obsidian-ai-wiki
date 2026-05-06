---
wiki_sources: [docs/superpowers/plans/2026-05-04-agent-base-contract.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [base-contract, base-md, системный-промпт]
---
# Agent Base Contract (base.md)

Фича добавляет системный промпт `prompts/base.md`, который автоматически вставляется перед каждым LLM-вызовом.

## Основные характеристики

- Файл `prompts/base.md` содержит базовые инструкции для LLM-агента (роль, формат ответа, ограничения)
- Функция `prependBaseContract()` добавляется в `src/llm-utils.ts` (или аналогичный утилитарный модуль)
- `buildChatParams()` вызывает `prependBaseContract()` перед сборкой параметров запроса
- esbuild встраивает `prompts/base.md` как строку через text-loader (см. [[wiki-init-root-files]])
- Подход позволяет обновлять базовый контракт без перекомпиляции (только для dev-режима)

## Применение

Базовый контракт применяется ко всем операциям: ingest, query, lint, init, chat. Специфичные промпты phase-функций добавляются после базового контракта.
