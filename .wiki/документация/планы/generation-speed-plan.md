---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-14-generation-speed.md
wiki_updated: 2026-05-14
wiki_domain: документация
tags: [план, view, stream, controller, typescript]
---

# Generation Speed Display — Implementation Plan

Дата: 2026-05-14. Реализационный план для отображения скорости генерации LLM (`tok/s`) в сайдбаре.

## Цель

Извлечь `output_tokens` из `result`-события stream-json, провести через `RunEvent`, вычислить `tok/s` в `LlmWikiView` и отобразить в двух DOM-местах после завершения операции. Обогатить лог-строки в `controller.ts` полями `backend`, `model`, `tokPerSec`.

## Карта изменений

| Файл | Что меняется |
|---|---|
| `src/types.ts` | `outputTokens?: number` в variant `result` |
| `src/stream.ts` | Извлечение `usage.output_tokens` в `mapResult()` |
| `src/view.ts` | Новые поля `lastTokPerSec`, `resultSpeedEl`; обновления `onOpen()`, `appendEvent()`, `finish()`, `setRunning()` |
| `src/controller.ts` | Поле `_currentLogMeta`; обновление `dispatch()` и `logEvent()` |
| `tests/stream.test.ts` | 2 новых тест-кейса для `outputTokens` |
| `tests/fixtures/stream-ingest.jsonl` | Добавить `usage` в последнюю строку |

## Задачи

### Task 1: Тип `RunEvent` (types.ts)

Добавить `outputTokens?: number` к variant `result`. Проверить компиляцию. Коммит.

### Task 2: Парсинг `outputTokens` (stream.ts) — TDD

1. Написать 2 падающих теста: с `usage.output_tokens: 580` и без `usage`
2. Реализовать в `mapResult()`: извлечь через `isRecord(obj.usage)`
3. Проверить прохождение тестов. Коммит.

### Task 3: Фикстура stream-ingest.jsonl

Обновить последнюю строку файла: добавить `"usage":{"output_tokens":580}`.
Дополнить существующий тест `"maps full ingest fixture"` проверкой `result.outputTokens === 580`. Коммит.

### Task 4: Отображение tok/s в view.ts (4 под-изменения)

a. Новые поля `lastTokPerSec` и `resultSpeedEl`
b. Создать span `resultSpeedEl` в `onOpen()` после заголовка "Result"
c. В `appendEvent()` для `result`-событий: вычислить `lastTokPerSec = Math.round(outputTokens / (durationMs/1000))`
d. В `setRunning()`: сбросить `lastTokPerSec = undefined`, очистить `resultSpeedEl`
e. В `finish()` после `updateMetrics()`: обновить `progressCount` и `resultSpeedEl`

Сборка. Коммит.

### Task 5: Обогащение лога (controller.ts)

a. Добавить поле `_currentLogMeta: { backend, model } | null`
b. В `dispatch()`: после прохождения guard-проверок вычислить `_currentLogMeta` (с учётом `perOperation`-флага)
c. В `finally`: сбросить `_currentLogMeta = null`
d. В `logEvent()`: включить `backend`, `model`, `tokPerSec` (только для `result` с `outputTokens > 0`)

Сборка + все тесты. Коммит.

### Task 6: Финальная сборка и bump версии

1. Прочитать текущую версию из `package.json`
2. Инкрементировать patch в `package.json` и `src/manifest.json`
3. `npm run build` + `npm test`
4. Коммит: `main.js`, `package.json`, `src/manifest.json`

## Технические детали

**Вычисление `tokPerSec`:** Одинаковая формула в двух местах — в `view.ts` (`appendEvent`) и в `controller.ts` (`logEvent`):
```ts
Math.round(outputTokens / (durationMs / 1000))
```

**Импорт `OpKey` в контроллере:** Использовать `import("./types").OpKey` внутри блока, т.к. `eff` block-scoped.

**`updateMetrics()` vs прямая запись:** `updateMetrics()` очищает `progressCount` при state !== "running". После её вызова в `finish()` — сразу перезаписать текст с `tok/s` напрямую.

## Связанные страницы

- [[generation-speed-design]]
- [[llm-wiki-view]]
- [[wiki-controller]]
- [[async-generator-events]]
