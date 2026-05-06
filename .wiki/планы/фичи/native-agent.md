---
wiki_sources: [docs/superpowers/plans/2026-04-28-native-agent.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [agent-runner, native-backend]
---
# Native Agent (AgentRunner)

Фича добавляет второй wiki-бэкенд (`native-agent`), работающий через любой OpenAI-совместимый LLM (Ollama, OpenRouter и т.д.) без зависимости от iclaude.sh. AgentRunner оркестрирует фазы wiki напрямую в TypeScript.

## Основные характеристики

- Новый интерфейс `LlmClient` — подмножество OpenAI-клиента (только `chat.completions.create`)
- Класс `AgentRunner` маршрутизирует операции (`ingest`, `query`, `lint`, `init`) по отдельным phase-функциям
- Все phase-функции — `async function*` генераторы, эмитирующие `RunEvent`
- `WikiController` маршрутизирует по `settings.backend`: `"claude-code"` → IclaudeRunner, `"native-agent"` → AgentRunner
- Новые файлы: `src/vault-tools.ts`, `src/agent-runner.ts`, `src/phases/ingest.ts`, `src/phases/query.ts`, `src/phases/lint.ts`, `src/phases/init.ts`

## Файловая карта

| Файл | Роль |
|---|---|
| `src/agent-runner.ts` | Оркестратор: маршрутизация по операции, управление LlmClient |
| `src/vault-tools.ts` | Обёртка над Obsidian VaultAdapter для файловых операций |
| `src/phases/ingest.ts` | Извлечение сущностей из source-файла |
| `src/phases/query.ts` | Ответ на вопрос по wiki |
| `src/phases/lint.ts` | Проверка качества wiki-страниц |
| `src/phases/init.ts` | Инициализация нового домена |
