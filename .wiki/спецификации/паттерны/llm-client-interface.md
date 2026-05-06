---
wiki_sources:
  - "docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md"
  - "docs/superpowers/specs/2026-04-28-native-agent-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - pattern
  - architecture
aliases:
  - "LlmClient Pattern"
  - "Backend Abstraction"
---

# LlmClient — интерфейс абстракции backend

Минимальный TypeScript-интерфейс, абстрагирующий LLM-бэкенд от фазовых функций. Позволяет одному `AgentRunner` работать с `ClaudeCliClient` (spawn процесса) и `OpenAI` npm (HTTP) без изменения логики фаз.

## Основные характеристики

- **Интерфейс**: определяет только `chat.completions.create()` с overload для streaming и non-streaming; `OpenAI` npm удовлетворяет структурно, `ClaudeCliClient` — явно
- **Применение**: фазы `ingest.ts`, `query.ts`, `lint.ts`, `chat.ts`, `fix.ts`, `init.ts` принимают `llm: LlmClient` вместо `llm: OpenAI`
- **`AgentRunner`**: принимает `llm: LlmClient` в конструкторе; создание клиента вынесено в `controller.buildAgentRunner()`
- **`ClaudeCliClient`**: реализует интерфейс через spawn subprocess + parseStreamLine + конвертацию в ChatCompletionChunk
- **Отличие от OpenAI**: не поддерживает multi-turn (только system+user), игнорирует `temperature/top_p/num_ctx`

## Связанные концепции

- [[claude-agent-backend]]
- [[native-agent]]
- [[agent-runner-ts]]
