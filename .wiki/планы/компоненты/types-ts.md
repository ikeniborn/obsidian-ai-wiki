---
wiki_sources: [docs/superpowers/plans/2026-04-27-interactive-mode.md, docs/superpowers/plans/2026-04-28-native-agent.md, docs/superpowers/plans/2026-04-29-per-operation-models.md, docs/superpowers/plans/2026-04-30-domain-map-in-vault.md, docs/superpowers/plans/2026-05-05-chat-after-all-operations.md, docs/superpowers/plans/2026-05-05-chat-session-resume.md, docs/superpowers/plans/2026-05-05-devmode-logdir.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [RunEvent, WikiOperation, типы]
---
# src/types.ts

Центральный файл TypeScript-типов плагина. Содержит `RunEvent` (union), `WikiOperation`, `RunRequest`, `RunHistoryEntry`, `LlmWikiPluginSettings`, `DEFAULT_SETTINGS`.

## RunEvent union (все варианты)

```typescript
type RunEvent =
  | { kind: "system"; message: string; sessionId?: string }
  | { kind: "tool_use"; name: string; input: Record<string, unknown> }
  | { kind: "tool_result"; ok: boolean; preview?: string }
  | { kind: "assistant_text"; delta: string }
  | { kind: "result"; durationMs: number; text: string }
  | { kind: "error"; message: string }
  | { kind: "source_path_added"; domainId: string; path: string }
  | { kind: "domain_created"; entry: DomainEntry }
  | { kind: "domain_updated"; domainId: string; patch: Partial<DomainEntry> }
  | { kind: "ask_user"; question: string }
```

## Изменения по планам

| Фича | Изменение |
|---|---|
| Interactive Mode | `ask_user` добавлен в RunEvent |
| Domain Map in Vault | `domain_created` добавлен в RunEvent |
| Chat Session Resume | `sessionId?` добавлен в `{ kind: "system" }` |
| Chat After All Ops | `RunHistoryEntry.domainId?`; `RunRequest.operationHeader?` |
| Per-Operation Models | `OpKey`, `OpMap<T>`, `ClaudeOperationConfig`, `NativeOperationConfig` |
| devMode logDir | `devMode.logPath` → `devMode.logDir` |
