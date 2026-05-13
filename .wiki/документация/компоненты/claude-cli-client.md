---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - docs/superpowers/specs/2026-04-29-claude-agent-backend-design.md
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [компонент, backend, spawn, streaming]
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
  maxTokens: number;
  requestTimeoutSec: number;
}
```

## Spawn args

```
iclaude.sh -- -p <userContent> --output-format stream-json --verbose --model <model>
```

Флаги iclaude.sh (`--no-proxy`, `--model`) передаются до `--`; флаги claude (`-p`, `--output-format`) — после.

Важно: `-p` зарезервировано для prompt, флаг `-p`/`--proxy` у `iclaude.sh` занят — нарушение → `exit 1`.

## Обработка больших payload (LARGE_THRESHOLD = 256 КБ)

При `userText > 262144` байт:
1. Контент оборачивается в `<user_input>…</user_input>`
2. Пишется в `tmpDir/llm-wiki-usr-<id>.txt`
3. Передаётся через `--append-system-prompt-file <path>`
4. `-p` несёт явную инструкцию «обработай содержимое из `<user_input>`»

Это решает проблему "Dot received. What's next?" у модели haiku при старом workaround `-p "."`.

## Прерывание

`signal` (AbortSignal) → `SIGTERM` → 3000ms grace → `SIGKILL`.

## Конвертация RunEvent → OpenAI chunk

```
{ kind:"assistant_text", delta:"..." }
→ ChatCompletionChunk { choices:[{ delta:{ content:"..." } }] }
```

Финальный чанк: `finish_reason:"stop"`.

## Связанные страницы

- [[agent-runner]]
- [[поток-выполнения-операции]]
- [[single-flight-guard]]
