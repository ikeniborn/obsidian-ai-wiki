---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - docs/architecture/diagrams/data-flow.md
  - docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [паттерн, strategy, backend, LlmClient]
---

# Backend Strategy Pattern

`LlmClient` — тонкий интерфейс (одно поле `chat.completions.create`). Две реализации взаимозаменяемы — фазы не знают, с каким backend работают.

## Интерфейс LlmClient

```ts
export type LlmClient = {
  chat: {
    completions: {
      create(params: ChatCompletionCreateParamsStreaming, opts?: { signal?: AbortSignal }):
        Promise<AsyncIterable<ChatCompletionChunk>>;
      create(params: ChatCompletionCreateParamsNonStreaming, opts?: { signal?: AbortSignal }):
        Promise<ChatCompletion>;
    };
  };
};
```

`OpenAI` из npm удовлетворяет этому типу структурно. `ClaudeCliClient` реализует явно.

## Реализации

| Backend | Класс | Транспорт |
|---|---|---|
| `claude-agent` | `ClaudeCliClient` | spawn iclaude.sh, stream-json stdout |
| `native-agent` | `new OpenAI(...)` | HTTP API (Ollama, OpenAI, OpenRouter) |

## Выбор реализации

В `WikiController.buildAgentRunner()`:

```ts
const llm: LlmClient = settings.backend === "claude-agent"
  ? new ClaudeCliClient(settings.claudeAgent)
  : new OpenAI({ baseURL, apiKey, dangerouslyAllowBrowser: true });
```

## Per-Device Settings Overlay

`backend`, `iclaudePath`, `apiKey`, `baseUrl`, `model` хранятся в `local.json` (не синхронизируются через Obsidian Sync). `resolveEffective(settings, local)` сливает overlay перед использованием. Цель: на каждом устройстве своя конфигурация backend.

## Mobile

На mobile `ClaudeCliClient` недоступен (`node:child_process` нет). При загрузке `backend: "claude-agent"` мигрирует → `"native-agent"`. Используется `mobileFetch` (`src/mobile-fetch.ts`) — `requestUrl`-backed fetch, обходит CORS для cloud-провайдеров.

## Связанные страницы

- [[claude-cli-client]]
- [[agent-runner]]
- [[wiki-controller]]
