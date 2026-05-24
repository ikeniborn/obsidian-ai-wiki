---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/plans/2026-05-19-live-status-ux.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [live-status, status-section, liveStatusSection, view, tool-use, assistant-text, progress]
tags: [план, view, ux, live-status]
---

# Live Status UX Plan

Реализационный план замены live-response-ux стриминга на компактный Status-индикатор. Progress остаётся открытым. Реализован в v0.1.111.

## Основные характеристики

Цель: заменить streaming `assistant_text` в Result на компактный однострочный Status-индикатор, Progress остаётся открытым в течение всей операции.

### Файловая карта

| File | Change |
|---|---|
| `src/styles.css` | Add `.ai-wiki-live-status` rules; remove `.reasoning--collapsed` rules |
| `src/view.ts` | Remove 4 fields, add 3 fields; update onOpen/setRunning/appendEvent/startWaiting/scheduleWaitingTick/finish/onClose; delete scheduleAssistantRender |
| `package.json` + `src/manifest.json` | 0.1.110 → 0.1.111 |
| `dist/main.js` + `dist/styles.css` + `dist/manifest.json` | rebuild |

### Tasks (10 tasks)

1. CSS — remove dead reasoning--collapsed rules, add live-status styles
2. view.ts — remove 4 streaming fields, add 3 live-status fields (liveStatusSection/IconEl/TextEl)
3. view.ts — onOpen(): add live-status DOM section (between stepsEl and resultSection)
4. view.ts — setRunning(): show/clear Status, remove assistant resets
5. view.ts — appendEvent() tool_use: remove stale resets, add `🔧 {name}` Status update
6. view.ts — appendEvent() assistant_text: remove streaming, add Status updates (`🧠`/`💬`)
7. view.ts — startWaiting() + scheduleWaitingTick(): update Status `⏳ {elapsed}s`
8. view.ts — finish() + onClose(): hide Status, remove assistant cleanup, null-out Status refs
9. view.ts — delete scheduleAssistantRender() entirely
10. Version bump 0.1.110 → 0.1.111, build, commit

### Verification checklist (manual)

1. **query** — Progress открыт, Status обновляется `🔧 → ⏳ → 🔧 → 🧠 → 💬`, Result скрыт, после finish — Status скрыт, Result показан
2. **lint** — то же поведение
3. **ingest** — file progress bar в Progress, Status показывает текущий tool_use
4. Cancel mid-operation — Status скрыт, Progress as-is

## История изменений

- **2026-05-19** — создан по `docs/superpowers/plans/2026-05-19-live-status-ux.md`.

## Связанные страницы

- [[live-status-ux-design]]
- [[live-response-ux-plan]]
- [[llm-wiki-view]]
