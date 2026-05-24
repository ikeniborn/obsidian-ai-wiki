---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/plans/2026-05-19-live-response-ux.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [live-response, streaming, markdown-renderer, assistantStarted, assistantRenderHandle, view]
tags: [план, view, streaming, ux]
---

# Live Response UX Plan

Реализационный план streaming `assistant_text` в Result section с debounced MarkdownRenderer и авто-коллапсом Progress. Реализован в v0.1.110, **заменён** [[live-status-ux-plan]] в v0.1.111.

## Основные характеристики

Цель: stream `assistant_text` в Result section с debounced `MarkdownRenderer`, авто-коллапс Progress и reasoning при старте ответа.

### Файловая карта

| Action | File | Что меняется |
|---|---|---|
| Modify | `src/view.ts:95-99` | Remove assistantBlock/RafHandle; add assistantStarted/RenderHandle/FinalComp |
| Modify | `src/view.ts:378-389` | Update setRunning() reset block |
| Modify | `src/view.ts:479-486` | Fix tool_use handler |
| Modify | `src/view.ts:572` | Fix result handler |
| Modify | `src/view.ts:523-531` | Remove insertBefore from reasoning creation |
| Modify | `src/view.ts:542-558` | Replace non-reasoning assistant_text handler |
| Add | `src/view.ts` | New private `scheduleAssistantRender()` method |
| Modify | `src/view.ts:667` | Update finish() cleanup |
| Modify | `src/view.ts:198-200` | Update onClose() cleanup |
| Modify | `src/styles.css` | Add reasoning--collapsed rules; remove dead assistant styles |

### Tasks (9 tasks)

1. Replace assistant fields (remove assistantBlock/RafHandle, add assistantStarted/RenderHandle/FinalComp)
2. Update setRunning() reset block
3. Remove stale assistantBlock refs from tool_use and result handlers
4. Remove insertBefore from reasoning block creation
5. Replace non-reasoning assistant_text handler (streaming logic → Progress collapse + scheduleAssistantRender)
6. Add scheduleAssistantRender() method (150ms setTimeout + MarkdownRenderer)
7. Update finish() and onClose() cleanup
8. CSS — add reasoning--collapsed rules, remove dead assistant styles
9. Build, bump version, commit

## Статус

Реализован (v0.1.110), затем заменён [[live-status-ux-plan]] — Progress теперь остаётся открытым.

## История изменений

- **2026-05-19** — создан по `docs/superpowers/plans/2026-05-19-live-response-ux.md`.

## Связанные страницы

- [[live-response-ux-design]]
- [[live-status-ux-plan]]
- [[llm-wiki-view]]
