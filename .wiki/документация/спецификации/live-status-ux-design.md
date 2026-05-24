---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-19-live-status-ux-design.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [live-status, status-section, view, ux, assistant-text, tool-use, progress]
tags: [спецификация, view, ux, live-status]
---

# Live Status UX Design

Спецификация замены live-response-ux. Убирает авто-коллапс Progress и streaming в Result. Добавляет компактный Status-блок под Progress, отражающий текущую активность в реальном времени.

## Основные характеристики

### Цели

- Progress остаётся открытым в течение всей операции (без авто-коллапса).
- Новая секция **Status** под Progress: однострочный индикатор текущей активности.
- Result показывает только финальный текст после `finish()` (без стриминга).
- Поведение Chat section не меняется.

### Layout

```
[Progress header]          ← всегда видна, клик для toggle
[stepsEl]                  ← полная история: tool calls, reasoning, file progress, errors

[Status section]           ← видна только во время операции, не коллапсируется
  {icon} {activity text}  ← одна строка, обновляется в реальном времени

[Result section]           ← скрыта во время операции, показывается в finish()
  [finalEl]                ← финальный markdown текст
  [Chat section]           ← query/lint/ingest после finish()
```

### Status по событиям

| Событие | Status text |
|---|---|
| `tool_use` | `🔧 {name}  {truncated_arg}` |
| `assistant_text` isReasoning | `🧠 Analysing...` |
| `assistant_text` non-reasoning | `💬 Forming response...` |
| waiting (после `tool_result`) | `⏳ {elapsed}s...` |
| `result` / `finish()` | Status скрыт |

Status не накапливает историю — всегда показывает текущее/последнее состояние.

### Изменения view.ts

**Удаляемые поля (streaming):**
```typescript
private assistantStarted = false;
private assistantBuffer = "";
private assistantRenderHandle: ReturnType<typeof setTimeout> | null = null;
private assistantFinalComp: Component | null = null;
```

**Добавляемые поля:**
```typescript
private liveStatusSection: HTMLElement | null = null;
private liveStatusIconEl: HTMLElement | null = null;
private liveStatusTextEl: HTMLElement | null = null;
```

**onOpen():** DOM-секция Status между stepsEl и resultSection.

**setRunning():** показать и очистить Status; удалить сбросы assistant-полей.

**appendEvent():** обновлять Status вместо стриминга; `scheduleAssistantRender()` удаляется целиком.

**startWaiting():** обновлять Status `⏳ 0.0s`; tick также обновляет liveStatusTextEl.

**finish():** скрыть Status (`addClass("ai-wiki-hidden")`).

**onClose():** обнулить ссылки Status.

### CSS изменения

Добавить:
```css
.ai-wiki-live-status { display: flex; align-items: center; gap: 6px; padding: 5px 8px;
  background: var(--background-secondary); border-radius: 4px;
  font-family: var(--font-monospace); font-size: 12px; color: var(--text-muted); margin-top: 4px; }
.ai-wiki-live-status-icon { flex: 0 0 auto; }
.ai-wiki-live-status-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
```

Удалить (мёртвые правила после live-response-ux):
```css
.reasoning--collapsed .ai-wiki-reasoning-text { ... }
.reasoning--collapsed .ai-wiki-step-name::after { ... }
```

## История изменений

- **2026-05-19** — создана по `docs/superpowers/specs/2026-05-19-live-status-ux-design.md`. Заменяет [[live-response-ux-design]].

## Связанные страницы

- [[live-response-ux-design]]
- [[llm-wiki-view]]
- [[live-status-ux-plan]]
