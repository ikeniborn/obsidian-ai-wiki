---
wiki_sources: ["src/claude-cli-client.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[llm-client]]"
  - "[[stream-ts]]"
  - "[[run-event]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["ClaudeCliClient"]
---
# ClaudeCliClient (claude-cli-client.ts)

Реализация интерфейса `LlmClient` для claude-agent backend. Вместо HTTP-вызова — запускает дочерний процесс `iclaude.sh` и транслирует его stdout через `parseStreamLine()` в поток `OpenAI.ChatCompletionChunk`.

## Основные характеристики

- **Расположение:** `src/claude-cli-client.ts`
- **Класс:** `ClaudeCliClient implements LlmClient`
- **Конфигурация:** `ClaudeCliConfig` (iclaudePath, model, requestTimeoutSec, cwd, allowedTools, tmpDir, resumeSessionId)

### Протокол вызова iclaude.sh

```
iclaude.sh [--no-proxy] [--model <m>] -- -p <prompt> --output-format stream-json
```

Флаг `-p` передаётся после `--` — он является флагом claude, а не iclaude.sh (который резервирует `-p`/`--proxy`).

### Обработка больших промптов (E2BIG fix)

При размере system/user блока > 32 768 символов (`LARGE_THRESHOLD`) — записывает содержимое во временный файл в `tmpDir` и передаёт путь к нему через `--system-file`/`--prompt-file`. После завершения — удаляет временные файлы.

### Session resume

При наличии `resumeSessionId` — добавляет `--resume <id>` к аргументам iclaude. Сессионный ID фиксируется из первого события `system` (поле `session_id`) и хранится в `lastSessionId`.

### Прерывание процесса

SIGTERM → ожидание 3000 мс (`SIGTERM_GRACE_MS`) → SIGKILL. AbortSignal управляет lifecycle через `signal.addEventListener("abort", ...)`.

## Связанные концепции

- [[llm-client]] — интерфейс, который реализует ClaudeCliClient
- [[stream-ts]] — парсинг строк stdout в RunEvent
