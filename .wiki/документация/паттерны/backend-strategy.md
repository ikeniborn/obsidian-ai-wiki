---
wiki_sources: ["docs/architecture/README.md", "docs/architecture/overview.yaml", "docs/architecture/diagrams/data-flow.md"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[архитектура-плагина]]"
  - "[[claude-cli-client]]"
wiki_external_links: []
tags: ["docs", "architecture", "obsidian-llm-wiki"]
aliases: ["Backend Strategy Pattern", "LlmClient", "strategy pattern", "бэкенд"]
---

# Backend Strategy Pattern (LlmClient)

Паттерн Strategy для абстракции LLM-бэкенда в obsidian-llm-wiki. `LlmClient` — тонкий интерфейс с единственным полем `chat.completions.create`, совместимый с OpenAI SDK. Две реализации взаимозаменяемы и выбираются через настройку `settings.backend`.

## Основные характеристики

| Реализация | Описание | Протокол |
|-----------|----------|----------|
| [[claude-cli-client\|ClaudeCliClient]] | spawn iclaude.sh, readline по stdout, SIGTERM/SIGKILL | stream-json (parseStreamLine()) |
| `new OpenAI(...)` | прямое подключение к OpenAI-совместимому API | OpenAI streaming API (ChatCompletionChunk) |

- **Интерфейс:** `LlmClient` — одно поле `chat.completions.create`
- **Выбор бэкенда:** `settings.backend` (`"claude-agent"` | `"native-agent"`)
- **Абстракция:** фазы (phases/) работают с `LlmClient`, не зависят от конкретного бэкенда

## Применение в контексте obsidian-llm-wiki

`AgentRunner` получает нужный клиент от `WikiController` и передаёт его в фазы. Фазы вызывают `llm.chat.completions.create(...)` — и не знают, через CLI или HTTP это выполняется.
