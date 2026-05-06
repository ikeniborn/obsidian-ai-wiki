---
wiki_sources: [docs/superpowers/plans/2026-05-05-chat-session-resume.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [resume-session, мультитурновый-чат]
---
# Chat Session Resume

Фича исправляет потерю контекста в многотурновом чате для `claude-agent` бэкенда, используя нативный `--resume <session_id>` механизм Claude CLI.

## Основные характеристики

- `parseStreamLine()` извлекает `session_id` из системного `init`-события → поле `sessionId?` в `{ kind: "system" }`
- `ClaudeCliConfig` получает `resumeSessionId?: string`
- При resume: `--resume <id>` передаётся после `--`; `--system-prompt` не передаётся (контекст уже в сессии)
- `WikiController` хранит `_chatSessionId: string | undefined`, обновляет при каждом system-событии с `sessionId`
- При ошибке чата `_chatSessionId` сбрасывается (сессия могла истечь)
- При старте не-chat операции `_chatSessionId` сбрасывается (контекст нерелевантен)
- Ollama (native-agent) не затронут — работает корректно без session resume

## Поток данных

```
Первый тур:  spawn claude → init-событие содержит session_id → сохраняется в _chatSessionId
Второй тур:  buildAgentRunner(vaultRoot, _chatSessionId) → ClaudeCliClient с resumeSessionId
             → spawn claude --resume <session_id> -p <вопрос> (без --system-prompt)
```
