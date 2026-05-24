---
wiki_status: mature
wiki_sources:
  - "[[docs/superpowers/specs/2026-05-19-agent-stability-audit-design.md]]"
wiki_updated: 2026-05-19
wiki_domain: документация
wiki_keywords: [agent-stability, zod, parse-with-retry, lint-merge, ingest-schema, format-zod, cot-structured]
tags: [спецификация, стабильность, zod, парсинг]
---

# Agent Stability Audit Design

Аудит всех wiki-agent фаз. Унифицирует Zod-схемы + `parseWithRetry` везде, объединяет lint assess+fix в один вызов, добавляет UI-прогресс для fix.

## Основные характеристики

### Проблемы

1. **Нет schema validation для page-array outputs** — `parseJsonPages()` использует regex без Zod/retry. Тихие сбои: невалидный JSON → 0 страниц без ошибки.

2. **Непоследовательная retry-инфраструктура** — `parseWithRetry` есть для `init`, `lint-patch`, `query-seeds`, но не для page-array outputs и `format`.

3. **Lint: 3 LLM-вызова, assess и fix разделены** — assess возвращает free-text, fix возвращает JSON. Два независимых вызова для семантически связанной работы. Fix step без UI-прогресса.

### Аудит фаз

| Фаза | Guard |
|---|---|
| **ingest** | `parseJsonPages()` — regex, без Zod, без retry |
| **lint assess** | free text, не нужен |
| **lint fix** | `parseJsonPages()` — без Zod, без retry, без UI-прогресса |
| **lint actualize** | `parseWithRetry` ✓ |
| **query seeds (Jaccard)** | — |
| **query seeds (LLM fallback)** | `parseWithRetry` ✓ |
| **init bootstrap/delta** | `parseWithRetry` ✓ |
| **format** | Custom hand-rolled retry — не Zod, дублирует parseWithRetry |

### Новые Zod-схемы (src/phases/zod-schemas.ts)

```typescript
export const WikiPageSchema = z.object({
  path: z.string(),
  content: z.string(),
  annotation: z.string().optional(),
});

export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
});

export const LintOutputSchema = z.object({
  reasoning: z.string(),
  report: z.string(),   // markdown для пользователя
  fixes: z.array(WikiPageSchema),
});

export const FormatOutputSchema = z.object({
  report: z.string(),
  formatted: z.string(),
});
```

### Ingest: parseWithRetry вместо parseJsonPages

- Промпт обновлён: возвращать `{reasoning, pages}` вместо raw array
- `pages` валидируется `WikiPagesOutputSchema` через `parseWithRetry`
- `reasoning` emitтится как `{ kind: "assistant_text", isReasoning: true }`
- `callSite`: `"ingest.pages"`

### Lint: merge assess + fix → один CoT+Structured вызов

До: assess (free text) → fix (JSON array) → actualize. 3 вызова.
После: assess+fix (`parseWithRetry` с `LintOutputSchema`) → actualize. 2 вызова.

- `report` заменяет free-text assess output, emitтится как `assistant_text`
- `fixes` заменяет второй вызов buildFixMessages
- UI-прогресс в fix: emit `assistant_text` с именем файла перед каждой записью

### Format: Zod без изменения retry-потока

Format имеет сложный retry (truncation из finish_reason post-call). Замена потока целиком не оправдана.

Минимальное изменение: заменить `extractJsonObject()` на `FormatOutputSchema.safeParse(raw)` + подключить `structuralErrorCounter`.

### CallSite union additions

```typescript
export type CallSite =
  | "init.bootstrap" | "init.delta"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds"
  | "ingest.pages"       // new
  | "format.output";     // new
```

### Impact

| Изменение | LLM calls delta | Validation | Retry |
|---|---|---|---|
| ingest: parseWithRetry | 0 | WikiPagesOutputSchema | ✓ |
| lint: merge assess+fix | −1 per domain | LintOutputSchema | ✓ |
| format: parseWithRetry | 0 | FormatOutputSchema | ✓ |
| lint-fix UI progress | 0 | — | — |

## История изменений

- **2026-05-19** — создана по `docs/superpowers/specs/2026-05-19-agent-stability-audit-design.md`.

## Связанные страницы

- [[ingest-operation]]
- [[lint-operation]]
- [[format-operation]]
- [[structured-output-retry]]
- [[parse-with-retry]]
