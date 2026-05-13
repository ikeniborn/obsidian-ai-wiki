---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md
  - src/claude-cli-client.ts
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [компонент, backend, spawn, streaming, proxy]
---

# ClaudeCliClient

Адаптер между `iclaude.sh` (дочерний процесс) и интерфейсом `LlmClient` (OpenAI-совместимым). Реализует `chat.completions.create` через spawn + readline по stdout.

## Назначение

`ClaudeCliClient` (`src/claude-cli-client.ts`) запускает `iclaude.sh` как дочерний процесс, читает stream-json из stdout построчно, конвертирует события в `ChatCompletionChunk` (для streaming) или `ChatCompletion` (non-streaming fallback).

## Конфигурация

```ts
interface ClaudeCliConfig {
  iclaudePath: string;
  model: string;
  requestTimeoutSec: number;
  cwd?: string;
  allowedTools?: string;
  tmpDir: string;
  resumeSessionId?: string;
  tmpWrite: (absPath: string, content: string) => Promise<void>;
  tmpRemove: (absPath: string) => void;
}
```

`tmpWrite`/`tmpRemove` — vault-адаптеры для записи/удаления temp-файлов (не используют `node:fs` напрямую). `cwd` — рабочий каталог дочернего процесса. `allowedTools` — строка инструментов для `--tools`.

## Spawn args и proxy-правило

```
iclaude.sh [--no-proxy] [--model X] -- --model X -p <prompt> --output-format stream-json --verbose
```

**Критично:** `iclaude.sh` резервирует флаг `-p`/`--proxy` для proxy URL. Все флаги `iclaude.sh` передаются **до `--`**, флаги `claude` — **после `--`**. Нарушение порядка → `iclaude.sh` завершится с `exit 1` без stderr, клиент получит ненулевой exitCode.

Флаги `--model` и `--resume` передаются после `--` как claude-флаги, чтобы `iclaude.sh` не мутировал `.claude_config`.

## Обработка больших payload (LARGE_THRESHOLD = 256 КБ)

При `userText > 262144` байт:
1. Контент оборачивается в `<user_input>…</user_input>`
2. Пишется через `tmpWrite` в `tmpDir/ai-wiki-usr-<id>.txt`
3. Передаётся через `--append-system-prompt-file <path>`
4. `-p` несёт явную инструкцию «обработай содержимое из `<user_input>`»

Аналогично для `systemContent > 262144` байт — через `--system-prompt-file`.

При resume (`resumeSessionId` задан) системный промпт не передаётся повторно — он уже хранится в сессии claude.

## Прерывание

`signal` (AbortSignal) → `SIGTERM` → 3000ms grace → `SIGKILL`. Timeout срабатывает аналогично: `SIGTERM` → `SIGKILL`. Cleanup temp-файлов выполняется в `finally`.

## Конвертация RunEvent → OpenAI chunk

```
{ kind:"assistant_text", delta:"..." }
→ ChatCompletionChunk { choices:[{ delta:{ content:"..." } }] }
```

При `ev.isReasoning` delta помещается в поле `reasoning`, иначе в `content`. Финальный чанк: `finish_reason:"stop"`.

## Связанные страницы

- [[agent-runner]]
- [[поток-выполнения-операции]]
- [[single-flight-guard]]
