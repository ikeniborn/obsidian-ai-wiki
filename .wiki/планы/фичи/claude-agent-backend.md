---
wiki_sources: [docs/superpowers/plans/2026-04-29-claude-agent-backend.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [claude-cli-client, claude-agent]
---
# Claude Agent Backend (ClaudeCliClient)

Фича заменяет бэкенд `claude-code` (IclaudeRunner + buildPrompt) на `claude-agent` (ClaudeCliClient), реализующий OpenAI-совместимый интерфейс поверх spawn claude CLI.

## Основные характеристики

- Новый файл `src/claude-cli-client.ts` реализует `LlmClient` через spawn claude с флагами `--output-format stream-json`
- Интерфейс `ClaudeCliConfig`: `iclaudePath`, `model`, `requestTimeoutSec`, `cwd`, `allowedTools`, `tmpDir`, `resumeSessionId?`
- Новые настройки сгруппированы в `settings.claudeAgent.*`
- Миграция из старого бэкенда в `loadSettings()`: поле `iclaudePath` переезжает в `claudeAgent.iclaudePath`
- Удаляются `src/runner.ts` и `src/prompt.ts` (заменены ClaudeCliClient + phase-промпты)

## Протокол аргументов spawn

```
iclaudePath [--no-proxy|--model <m>] -- [--resume <id>] -p <prompt>
  --output-format stream-json --verbose --disable-slash-commands
  --dangerously-skip-permissions [--system-prompt <s>|--system-prompt-file <f>]
```

- Флаг `-p` (prompt) передаётся после `--` — он является флагом claude, не iclaude
- Флаг `-p`/`--proxy` до `--` зарезервирован iclaude.sh для proxy URL (несовместим)
