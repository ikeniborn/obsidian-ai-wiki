---
wiki_sources:
  - "docs/superpowers/specs/2026-04-28-native-agent-design.md"
  - "docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - pattern
  - architecture
aliases:
  - "Hybrid Orchestration"
  - "Phase-Based Architecture"
---

# Гибридная оркестрация (TypeScript + LLM)

Архитектурный паттерн нативного агента: TypeScript управляет фазами операции, LLM делает только «умные» шаги через прямые completion-вызовы. Противоположность agentic tool-calling loops — локальные модели без function calling поддерживаются полностью.

## Основные характеристики

- **TypeScript управляет**: последовательностью шагов (list files → read → call LLM → write), файловыми операциями через VaultTools, агрегацией результатов
- **LLM делает**: synthesis (извлечение и синтез wiki-контента), answering (ответы на вопросы), evaluation (оценка качества), bootstrapping (генерация entity_types)
- **Фазы**: `ingest.ts`, `query.ts`, `lint.ts`, `init.ts` — каждая оркестрирует свою последовательность VaultTools + LLM вызовов
- **Преимущества**: предсказуемость (не зависит от того, какие tools выберет LLM), совместимость с локальными моделями, простое тестирование (мок LLM client)
- **VaultTools**: обёртки над `app.vault` API — read, write, list, search; source-файлы вне vault недоступны при `native-agent`

## Связанные концепции

- [[native-agent]]
- [[llm-client-interface]]
- [[agent-runner-ts]]
