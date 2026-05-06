---
wiki_sources: [docs/superpowers/plans/2026-05-05-chat-session-resume.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [parseStreamLine, парсер-стрима]
---
# src/stream.ts

Содержит функцию `parseStreamLine(line: string): RunEvent | null`, преобразующую одну JSON-строку из stdout iclaude/claude в типизированный RunEvent.

## Основные характеристики

- Парсит все типы stream-json событий: `system`, `assistant`, `user`, `result`
- Не-JSON строки (баннеры iclaude) возвращают `null` — игнорируются в runner
- Тестируется через `tests/stream.test.ts` с fixture `tests/fixtures/stream-ingest.jsonl`

## Изменения по планам

| Фича | Изменение |
|---|---|
| Chat Session Resume | `case "system"`: извлекается `session_id` → поле `sessionId?` в RunEvent |

## Парсинг system-события

```typescript
case "system": {
  const subtype = typeof obj.subtype === "string" ? obj.subtype : "system";
  const model = typeof obj.model === "string" ? obj.model : "";
  const sessionId = typeof obj.session_id === "string" ? obj.session_id : undefined;
  const msg = `${subtype}${model ? ` (${model})` : ""}`;
  return { kind: "system", message: msg, sessionId };
}
```
