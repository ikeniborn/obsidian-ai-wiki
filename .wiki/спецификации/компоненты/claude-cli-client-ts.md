---
wiki_sources:
  - "docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md"
  - "docs/superpowers/specs/2026-05-05-e2big-fix-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - component
  - typescript
aliases:
  - "ClaudeCliClient"
  - "src/claude-cli-client.ts"
---

# src/claude-cli-client.ts

Реализация `LlmClient` через spawn процесса `claude`/`iclaude.sh`. Конвертирует OpenAI-совместимые `chat.completions.create()` вызовы в CLI-аргументы, читает stream-json stdout и возвращает `ChatCompletionChunk`. Используется в backend `claude-agent`.

## Основные характеристики

- **`ClaudeCliConfig`**: `iclaudePath`, `model`, `requestTimeoutSec`, `cwd?`, `allowedTools?`, `tmpDir`
- **Алгоритм spawn**: аргументы `--model`, `--`, `-p userText` (или temp file), `--output-format stream-json --verbose --disable-slash-commands --dangerously-skip-permissions`
- **Temp files**: при `userText > 32 KB` → `--append-system-prompt-file + -p "."`; при `systemContent > 32 KB` → `--system-prompt-file`; cleanup в `finally`
- **Streaming**: `AsyncGenerator<ChatCompletionChunk>`; парсит stdout построчно через `parseStreamLine()`; фильтрует `assistant_text` события
- **Abort**: через `AbortSignal` → SIGTERM → 3000ms grace → SIGKILL
- **Multi-turn**: не поддерживается (всегда system+user); берётся только последний `role:"user"` message
- **`params.model`**: используется вместо `this.cfg.model` (с fallback), что позволяет per-operation models

## Связанные концепции

- [[claude-agent-backend]]
- [[e2big-fix]]
- [[agent-runner-ts]]
