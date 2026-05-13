---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - docs/architecture/diagrams/data-flow.md
  - docs/superpowers/specs/2026-05-08-format-operation-design.md
  - docs/superpowers/plans/2026-05-08-format-operation.md
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [операция, format, preview, validator]
---

# Format Operation

Анализ открытой не-wiki markdown-страницы и генерация форматированного preview с предлагаемыми правками. Пользователь итерирует preview через чат, затем применяет или отменяет.

## Жёсткий инвариант

Запрещено добавлять/удалять факты или искажать смысл. Разрешён только перефраз для ясности. Все изменения перечисляются в поле `report`.

## UX-поток

1. Пользователь открывает `.md` вне wiki-домена, нажимает **Format** в боковой панели.
2. Если файл внутри `wiki_folder` — ConfirmModal с предложением запустить Ingest.
3. Иначе — `runFormat` анализирует файл, возвращает JSON `{ report, formatted }`.
4. Preview записывается в `!Temp/<basename>.formatted.md`.
5. Событие `format_preview` отображает отчёт + Apply/Cancel + чат для refine.
6. Refine → добавляет сообщение в chat history, редиспатчит format (регенерация preview).
7. Apply → `vault.modify(TFile, content)` обновляет буфер редактора, temp удаляется.
8. Cancel → temp удаляется, оригинал не тронут.

## Архитектурный поток

```
View.format() → WikiController.format()
  → guard: wiki-folder?
  → AgentRunner.run({ operation:"format", chatMessages })
  → runFormat(args, vaultTools, llm, model, hasVision, chatHistory, signal)
  → LLM: JSON { report, formatted }
  → missingTokens() validator
  → write !Temp/<name>.formatted.md
  → yield format_preview { tempPath, report, missingTokens }
```

## Validator (format-utils.ts)

`significantTokens(text)` извлекает значимые токены:
- URL (`https?://...`) — первыми, затем удаляются из текста
- Числа (`\d+(\.\d+)?`)
- Latin-имена ≥3 букв (CamelCase, PascalCase, dash-case)
- ALL-CAPS акронимы ≥2 букв
- Идентификаторы из `` `inline` `` и ` ```fenced``` ` блоков

Кириллические capitalized слова НЕ считаются значимыми (рефраз допустим).

`missingTokens(orig, formatted)` — case-insensitive сравнение через word-boundary regex `[^A-Za-z0-9_]`.

Начиная с v0.1.64 Apply **не дисейблится** при `missingTokens > 0` — только warning с раскрываемым списком токенов (`<details>` с `<ul>`, max-height 160px, monospace 11px).

## JSON-устойчивость (v0.1.63+)

- Запрос с `response_format: { type: "json_object" }`
- `extractJsonObject` снимает ` ```json ``` ` обёртку; `repairJson` исправляет trailing-commas и экранирует control-chars внутри строк
- При первом провале — 1 авто-retry с явной инструкцией «верни ТОЛЬКО валидный JSON»
- `finish_reason === "length"` → ошибка «ответ обрезан, увеличьте maxTokens» (без retry)
- `stripCodeFence` привязан к началу/концу ответа (`^\s*\`\`\`…\`\`\`\s*$`) — иначе внутренние ` ```sql ` / ` ```bash ` блоки ловились как обёртка (баг v0.1.67)

## Vision-режим

При `backend === "claude-agent"` → `hasVision=true` → локальные image refs (`![...](...)`) добавляются как `image_url` content blocks в user-message.

## Настройки

- `timeouts.format`: default 600 сек
- `nativeAgent.operations.format.maxTokens`: default 32768 (v0.1.65)
- `claudeAgent` — `maxTokens` удалён в v0.1.66 (claude CLI не принимает `--max-tokens`)

## Mobile

Разрешена в `dispatch()` mobile-guard (наряду с query/query-save) — фаза не использует `node:fs`.

## Связанные страницы

- [[wiki-controller]]
- [[format-utils]]
- [[llm-wiki-view]]
