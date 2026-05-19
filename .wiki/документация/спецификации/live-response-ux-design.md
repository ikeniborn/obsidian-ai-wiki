---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-19-live-response-ux-design.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [live-response, streaming, markdown-renderer, assistant-text, result, progress-collapse]
tags: [спецификация, view, ux, streaming]
---

# Live Response UX Design

Спецификация streaming `assistant_text` в секцию Result с debounced MarkdownRenderer и авто-коллапсом Progress. **Заменена** более новой спецификацией [[live-status-ux-design]].

## Основные характеристики

### Проблемы, которые решает

1. **Неправильный порядок**: reasoning-блок сверху, ответ-стриминг снизу — нужно скроллить мимо tool calls.
2. **Шум перед ответом**: все `tool_use`, `tool_result` и waiting visible во время выполнения.
3. **Plain text streaming**: `setText()` показывает сырой markdown (`**bold**`, `## Header`) без рендеринга.

### Подход A — стриминг в Result

При первом non-reasoning `assistant_text`:
1. Авто-коллапс Progress (скрыть stepsEl).
2. Коллапс reasoning-блока in-place (скрыть текст, оставить заголовок).
3. Показать Result section со стримингом ответа как rendered markdown.

### Ключевые символы

| Символ | Назначение |
|---|---|
| `assistantStarted: boolean` | true после первого non-reasoning assistant_text |
| `assistantRenderHandle: ReturnType<typeof setTimeout> \| null` | 150ms debounce для MarkdownRenderer |
| `assistantFinalComp: Component \| null` | Obsidian Component для MarkdownRenderer lifecycle |

### scheduleAssistantRender()

```typescript
private scheduleAssistantRender(): void {
  if (this.assistantRenderHandle !== null) return;
  this.assistantRenderHandle = window.setTimeout(() => {
    this.assistantRenderHandle = null;
    if (!this.assistantBuffer) return;
    this.finalEl.empty();
    if (!this.assistantFinalComp) {
      this.assistantFinalComp = new Component();
      this.assistantFinalComp.load();
    }
    void MarkdownRenderer.render(
      this.app, this.assistantBuffer, this.finalEl, "", this.assistantFinalComp
    ).then(() => sanitizeLinks(this.finalEl));
  }, 150);
}
```

Debounce 150ms → ~6 renders/sec при стриминге. Один `assistantFinalComp` переиспользуется между тиками.

### CSS добавления

```css
.reasoning--collapsed .ai-wiki-reasoning-text { display: none; }
.reasoning--collapsed .ai-wiki-step-name::after { content: " (collapsed)"; font-size: 0.8em; opacity: 0.6; }
```

## Статус

Реализована (v0.1.110), затем заменена [[live-status-ux-design]] в v0.1.111 — Progress теперь остаётся открытым, Status-бар вместо streaming в Result.

## История изменений

- **2026-05-19** — создана по `docs/superpowers/specs/2026-05-19-live-response-ux-design.md`.

## Связанные страницы

- [[live-status-ux-design]]
- [[llm-wiki-view]]
- [[live-response-ux-plan]]
