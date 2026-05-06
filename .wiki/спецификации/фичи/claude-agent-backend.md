---
wiki_sources:
  - "docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - backend
  - claude-agent
aliases:
  - "ClaudeCliClient"
  - "claude-agent backend"
---

# Claude-Agent Backend

Замена backend `claude-code` (IclaudeRunner + iclaude.sh + skillPath) на `claude-agent`, который использует процесс `claude`/`iclaude.sh` как LLM-провайдер без привязки к навыкам. Оркестрацию берут TypeScript-фазы через унифицированный тип `LlmClient`. Итог: два backend — `"claude-agent"` и `"native-agent"`.

## Основные характеристики

- **`LlmClient` интерфейс**: минимальный тип, описывающий только `chat.completions.create()`; `OpenAI` npm удовлетворяет структурно, `ClaudeCliClient` — явно
- **`ClaudeCliClient`**: реализует `LlmClient`; spawn `iclaudePath` с аргументами `-p userText --output-format stream-json --verbose --model --max-tokens`; конвертирует `RunEvent{kind:"assistant_text"}` → `ChatCompletionChunk`
- **Удаление `IclaudeRunner`**: вместе с `runner.ts`, `prompt.ts`, `tests/runner.integration.test.ts`, `tests/prompt.test.ts`
- **Настройки**: новая секция `claudeAgent` с полями `iclaudePath`, `model`, `domainMapDir`, `systemPrompt`, `maxTokens`, `requestTimeoutSec`; удаление top-level `cwd`, `allowedTools`, `model`, `showRawJson`
- **Обратная совместимость**: при `backend: "claude-code"` плагин автоматически переключается на `"claude-agent"` и копирует `iclaudePath`

## Конвертация событий

```
RunEvent{kind:"assistant_text", delta:"..."}
→ ChatCompletionChunk{choices:[{delta:{content:"..."}}]}
```

## Связанные концепции

- [[native-agent]]
- [[claude-cli-client-ts]]
- [[agent-runner-ts]]
