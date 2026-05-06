---
wiki_sources: [docs/superpowers/plans/2026-04-29-claude-agent-backend.md, docs/superpowers/plans/2026-05-05-e2big-fix.md, docs/superpowers/plans/2026-05-05-chat-session-resume.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [ClaudeCliClient, claude-client]
---
# src/claude-cli-client.ts

`ClaudeCliClient` реализует OpenAI-совместимый интерфейс `LlmClient` поверх spawn процесса claude CLI. Обеспечивает streaming и non-streaming режимы.

## Основные характеристики

- Реализует `chat.completions.create()` через spawn claude с флагами `--output-format stream-json --verbose`
- `ClaudeCliConfig`: `iclaudePath`, `model`, `requestTimeoutSec`, `cwd?`, `allowedTools?`, `tmpDir`, `resumeSessionId?`
- Внутренние методы: `_create()`, `_makeIterable()`, `_generate()`, `_collect()`
- `_generate()` читает stdout через readline, парсит stream-json события, эмитирует chunks

## Управление аргументами

```
[iclaudePath] [--model <m>] -- [-p <prompt>|"."] 
  [--append-system-prompt-file <f>]  # при большом userText
  --output-format stream-json --verbose
  --disable-slash-commands --dangerously-skip-permissions
  [--tools <t>]
  [--system-prompt <s>|--system-prompt-file <f>]  # только без resume
  [--resume <session_id>]  # только при resume
```

## Изменения по планам

| Фича | Изменение |
|---|---|
| Claude Agent Backend | Создан |
| E2BIG Fix | `tmpDir` обязателен; temp-файлы для > 32 KB контента; очистка в `finally` |
| Chat Session Resume | `resumeSessionId?`; `--resume` после `--`; `--system-prompt` пропускается при resume |
