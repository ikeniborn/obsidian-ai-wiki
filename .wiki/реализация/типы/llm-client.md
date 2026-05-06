---
wiki_sources: ["src/types.ts", "src/claude-cli-client.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[claude-cli-client]]"
  - "[[agent-runner]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["LlmClient", "LlmClient interface"]
---
# LlmClient (types.ts)

Минимальный интерфейс OpenAI-совместимого клиента, используемый всеми фазовыми функциями. Абстрагирует от конкретного backend (ClaudeCliClient vs OpenAI/Ollama).

## Основные характеристики

- **Расположение:** `src/types.ts`
- **Тип:** `type LlmClient = { chat: { completions: { create(...) } } }`

### Интерфейс

```typescript
type LlmClient = {
  chat: {
    completions: {
      create(
        params: OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        opts?: { signal?: AbortSignal },
      ): Promise<AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>;
      create(
        params: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        opts?: { signal?: AbortSignal },
      ): Promise<OpenAI.Chat.ChatCompletion>;
    };
  };
};
```

### Реализации

| Реализация | Backend | Создаётся в |
|-----------|---------|------------|
| `ClaudeCliClient` | claude-agent (spawn iclaude.sh) | WikiController.buildAgentRunner() |
| `OpenAI` (npm openai) | native-agent (HTTP к Ollama/OpenAI) | WikiController.buildAgentRunner() |

### Переключение в тестах

Фазовые функции принимают `LlmClient` как параметр — тесты передают mock-объект с `vi.fn().mockResolvedValue(...)`, что позволяет тестировать фазы без реального LLM.

## Связанные концепции

- [[claude-cli-client]] — основная реализация для production
- [[agent-runner]] — потребитель LlmClient
