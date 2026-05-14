---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-14-remove-content-truncation-design.md
wiki_updated: 2026-05-14
wiki_domain: документация
tags: [спецификация, дизайн, phases, init, ingest, lint, query, context-window]
---

# Remove Content Truncation — Design Spec

Дата: 2026-05-14. Спецификация удаления жёстких ограничений на длину контента в LLM-фазах плагина.

## Проблема

Все четыре LLM-фазы (`init`, `ingest`, `lint`, `query`) усекают содержимое файлов перед отправкой в LLM. Основной лимит — 8 000 символов. Это уничтожает контекст для больших файлов: пример — 94 948 символов → 8 000 символов (91% потери). Контекстное окно Claude (~200k токенов ≈ 800k символов) делает эти лимиты излишними.

## Цель

Удалить все жёстко-заданные ограничения содержимого из построения LLM-промптов. Заменить предупреждение о truncation в `init` на информационный лог размера файла. UI-усечение в `stream.ts` и `view.ts` — только для отображения, к LLM не относится и остаётся.

## Изменения по файлам

### `src/phases/init.ts`

**Начальный системный промпт (строки 73–92, до основного цикла):**
- Удалить `schemaContent.slice(0, 1500)` → `schemaContent` (строка 76)
- Удалить `indexContent.slice(0, 1000)` → `indexContent` (строка 77)
- Удалить `c.slice(0, 400)` на содержимое sample-файлов → `c` (строка 89)

**Основной цикл по файлам:**
- Удалить строки 232–235: блок `if (fileContent.length > 8_000)` с предупреждением и `const truncated = fileContent.slice(0, 8_000)`
- Добавить информационный лог (всегда, не условно): `yield { kind: "assistant_text", delta: \`ℹ ${file}: ${fileContent.length} chars\n\` }`
- Заменить все ссылки на `truncated` → `fileContent`
- Удалить `schemaContent.slice(0, 1500)` → `schemaContent` (строка 242)
- Удалить `indexContent.slice(0, 1000)` → `indexContent` (строка 243)

### `src/phases/ingest.ts`

- Удалить `sourceContent.slice(0, 8000)` → `sourceContent`
- Удалить `schemaContent.slice(0, 2000)` → `schemaContent`
- Удалить `indexContent.slice(0, 2000)` → `indexContent`
- Удалить `c.slice(0, 400)` на содержимое существующих страниц → `c`

### `src/phases/lint.ts`

- Удалить `.slice(0, 8_000)` на результат `checkGraphStructure(...)`
- Удалить `c.slice(0, 500)` и `c.slice(0, 300)` на содержимое wiki-страниц

### `src/phases/query.ts`

- Удалить `schemaContent.slice(0, 2000)` → `schemaContent`
- Удалить `indexContent.slice(0, 3000)` → `indexContent`
- **Рефактор** `buildContextBlock` (строки 193–219): полностью убрать параметр `maxChars`. Убрать `break` на строке 211 и `.slice(0, maxChars)` fallback на строке 216. Все выбранные wiki-страницы включаются без ограничений. Обновить call site — убрать аргумент `maxChars`.

## Вне скоупа

- UI-усечение в `stream.ts` (`truncate(trimmed, 120)`) и `view.ts` — только для отображения, не отправляется в LLM
- Chunking для файлов >800k символов — не нужен для текущих use case; отдельная задача при необходимости
- Настраиваемые лимиты — не нужны

## Критерии успеха

- Нет `.slice(0, N)` вызовов в коде построения LLM-промптов в четырёх phase-файлах
- `buildContextBlock` в `query.ts` не имеет параметра `maxChars` и логики усечения
- Фаза `init` логирует размер файла информационно для каждого обработанного файла
- Тесты проходят: `npm test`
- Ручная верификация: большой файл (>8k символов), обработанный init/ingest, отправляет полное содержимое в LLM без предупреждений об усечении

## Связанные страницы

- [[init-operation]]
- [[ingest-operation]]
- [[lint-operation]]
- [[query-operation]]
