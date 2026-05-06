---
wiki_sources: ["docs/architecture/README.md", "docs/architecture/diagrams/data-flow.md", "docs/architecture/diagrams/dependency-graph.md"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[архитектура-плагина]]"
  - "[[backend-strategy]]"
  - "[[поток-выполнения-операции]]"
wiki_external_links: []
tags: ["docs", "architecture", "obsidian-llm-wiki"]
aliases: ["ClaudeCliClient", "claude-cli-client.ts", "iclaude adapter"]
---

# ClaudeCliClient (claude-cli-client.ts)

Адаптер Claude CLI бэкенда. Запускает `iclaude.sh` как дочерний процесс, читает stream-json строки со stdout через `readline`, конвертирует их в `AsyncIterable<ChatCompletionChunk>` совместимый с OpenAI SDK.

## Основные характеристики

- **Файл:** `src/claude-cli-client.ts`
- **Слой:** Infrastructure (I/O, LLM)
- **Протокол spawn:** `stdio: ["ignore", "pipe", "pipe"]` — stdin закрыт, stdout/stderr захвачены
- **Парсинг:** каждая строка stdout → `parseStreamLine()` → `RunEvent | null`
- **Прерывание:** SIGTERM → grace 3000ms → SIGKILL
- **Реализует:** интерфейс `LlmClient` (поле `chat.completions.create`)

## Зависимости

Использует: `parseStreamLine()` (stream.ts), `types.ts`.
