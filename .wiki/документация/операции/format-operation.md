---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
  - docs/architecture/diagrams/data-flow.md
  - docs/superpowers/specs/2026-05-08-format-operation-design.md
  - docs/superpowers/plans/2026-05-08-format-operation.md
  - src/phases/format.ts
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
4. Preview записывается в `<dir>/<basename>.formatted.md` (та же директория что и источник).
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
  → загрузить format_schema из !Wiki/_format_schema.md (или default из prompts)
  → extractImagePaths(original) если hasVision
  → callOnce(): stream LLM → JSON { report, formatted }
    → если parse fail + не truncated → retry с усиленной инструкцией
  → missingTokensWithContext() validator
    → если missing → token-restore call (multi-turn)
    → если всё ещё missing → appendMissingLines() (hard fallback)
  → write <dir>/<basename>.formatted.md
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

`missingTokensWithContext(orig, formatted)` — возвращает токены с контекстом (не просто список строк, а объекты с позицией). Используется для token-restore retry и `appendMissingLines`.

Начиная с v0.1.64 Apply **не дисейблится** при `missingTokens > 0` — только warning с раскрываемым списком токенов (`<details>` с `<ul>`, max-height 160px, monospace 11px).

## JSON-устойчивость (v0.1.63+)

- Запрос с `response_format: { type: "json_object" }`
- `extractJsonObject` снимает ` ```json ``` ` обёртку; `repairJson` исправляет trailing-commas и экранирует control-chars внутри строк
- При первом провале parse — 1 авто-retry с явной инструкцией «верни ТОЛЬКО валидный JSON»
- `finish_reason === "length"` или `looksTruncated(text)` → ошибка «ответ обрезан, увеличьте maxTokens» (без retry); проверяется **до** retry
- `stripCodeFence` привязан к началу/концу ответа (`^\s*\`\`\`…\`\`\`\s*$`) — иначе внутренние ` ```sql ` / ` ```bash ` блоки ловились как обёртка (баг v0.1.67)

## Три LLM-вызова (максимум)

`runFormat` может выполнить до 3 последовательных вызовов:

1. **Основной** (`callOnce(baseParams)`) — первый запрос с `response_format: json_object`.
2. **JSON-retry** — если `extractJsonObject` не смог распарсить результат и ответ не обрезан.  
   System prompt усиливается явным требованием «ТОЛЬКО JSON без markdown-обёртки».
3. **Token-restore** — если после шагов 1–2 `missingTokensWithContext` находит пропущенные токены.  
   Multi-turn: добавляется предыдущий assistant-ответ + user-сообщение «ВОССТАНОВИ ТОКЕНЫ: <список>».  
   После ответа — повторная проверка; если токены всё ещё отсутствуют → `appendMissingLines` (жёсткий fallback).

Каждый вызов использует `callOnce()` — внутренний async-generator с потоковой передачей (stream: true) и fallback на `stream: false` при ошибке стриминга.

## format_schema

При запуске `runFormat` загружает схему форматирования из `!Wiki/_format_schema.md`:
- Если файл существует — читает из vault
- Если не существует — использует встроенный default из `templates/_format_schema.md` и пытается записать его в vault
Схема передаётся в системный промпт через `render(formatTemplate, { format_schema, has_vision })`.

## Vision-режим

При `backend === "claude-agent"` → `hasVision=true` → `extractImagePaths(original)` извлекает локальные image refs (`![...](<path>)`, исключая `http`-URL) и добавляет их как `image_url` content blocks в user-message (OpenAI multipart format).

## tempPath (расположение preview)

Preview записывается в ту же директорию, что и исходный файл:
```
<dir>/<basename>.formatted.md
```
Если файл в корне vault (`lastIndexOf("/") === -1`) — `<basename>.formatted.md` без префикса директории.

**Внимание:** Wiki-страница ранее указывала `!Temp/<basename>.formatted.md` — это неверно. Реальный путь определяется `format.ts` строками 144–147.

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
