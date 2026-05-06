---
wiki_sources:
  - "docs/superpowers/specs/2026-04-28-native-agent-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - backend
  - native-agent
aliases:
  - "Native Agent Backend"
  - "AgentRunner"
---

# Native Agent (нативный агент)

Второй backend для плагина `obsidian-llm-wiki`, работающий с любым OpenAI-compatible провайдером (Ollama, OpenAI, OpenRouter, LM Studio). TypeScript управляет фазами, LLM делает только «умные» шаги через прямые completions — без agentic tool-calling loops.

## Основные характеристики

- **Архитектура**: `WikiController.dispatch()` маршрутизирует к `AgentRunner` (новый) или `IclaudeRunner` (существующий) по `settings.backend`
- **Гибридная оркестрация**: TypeScript управляет фазами, LLM делает только synthesis/extraction через completion-вызовы (не tool-calling)
- **OpenAI-compatible API**: зависимость `openai` npm (~100KB); поддерживает stream и non-stream режимы
- **Унифицированный интерфейс**: `AgentRunner.execute()` возвращает те же `RunEvent` что и `IclaudeRunner`
- **Новые файлы**: `agent-runner.ts`, `vault-tools.ts`, `phases/ingest.ts`, `phases/query.ts`, `phases/lint.ts`, `phases/init.ts`
- **Настройки**: `backend`, `nativeAgent.baseUrl`, `nativeAgent.apiKey`, `nativeAgent.model`; дефолт `backend: "claude-code"` для обратной совместимости

## Фазы выполнения

- **ingest**: read source → LLM synthesis → write wiki pages
- **query**: list wiki → readAll → LLM answer → optional save
- **lint**: list wiki → TS structural checks → LLM semantic eval
- **init**: list sources → LLM bootstrap domain-map

## Связанные концепции

- [[claude-agent-backend]]
- [[agent-runner-ts]]
