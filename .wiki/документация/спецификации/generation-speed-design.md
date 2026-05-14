---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-14-generation-speed-design.md
wiki_updated: 2026-05-14
wiki_domain: документация
tags: [спецификация, view, stream, controller, дизайн]
---

# Generation Speed Display — Design Spec

Дата: 2026-05-14. Спецификация отображения скорости генерации LLM (tok/s) в боковой панели после завершения операции.

## Цель

Показать скорость генерации (`tok/s`) в двух местах сайдбара:
1. **Progress header** (`progressCount`) — после завершения операции
2. **Result section header** — рядом с меткой «Result»

## Источник данных

Событие `result` в stream-json формате содержит поле `usage.output_tokens`:

```json
{
  "type": "result",
  "duration_ms": 42000,
  "total_cost_usd": 0.012,
  "usage": { "output_tokens": 580 }
}
```

Формула: `tokPerSec = Math.round(output_tokens / (duration_ms / 1000))`

Защита: если `duration_ms === 0` или `usage.output_tokens` отсутствует — скорость не отображается.

## Изменения по файлам

### `src/types.ts`

Добавить `outputTokens?: number` к variant `result` типа `RunEvent`:

```ts
| { kind: "result"; durationMs: number; usdCost?: number; text: string; outputTokens?: number }
```

### `src/stream.ts` — `mapResult()`

Извлекать `output_tokens` из `obj.usage` с помощью `isRecord()`:

```ts
const usage = isRecord(obj.usage) ? obj.usage : null;
const outputTokens = typeof usage?.output_tokens === "number" ? usage.output_tokens : undefined;
```

### `src/view.ts` — два места отображения

Новые приватные поля:
- `lastTokPerSec: number | undefined` — хранит вычисленное значение
- `resultSpeedEl: HTMLElement | null = null` — span в заголовке Result

**Поток данных:**
1. `appendEvent({ kind: "result", outputTokens, durationMs })` → вычислить и сохранить `this.lastTokPerSec`
2. `finish()` → обновить `progressCount` и `resultSpeedEl`
3. `setRunning()` → сбросить `this.lastTokPerSec = undefined` и очистить `resultSpeedEl`

**Progress header** (после `updateMetrics()` в `finish()`):
```ts
if (this.lastTokPerSec !== undefined) {
  const dur = ((entry.finishedAt - entry.startedAt) / 1000).toFixed(1);
  this.progressCount.setText(
    i18n().view.stepsCount(this.stepCount, dur) + ` · ${this.lastTokPerSec} tok/s`
  );
}
```

**Result section header** — создать span в `onOpen()`, заполнить в `finish()`:
```ts
this.resultSpeedEl?.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "");
```

### `src/controller.ts` — backend/model в лог

Новое приватное поле:
```ts
private _currentLogMeta: { backend: string; model: string } | null = null;
```

Устанавливается в блоке настроек `dispatch()` после прохождения guard-проверок, сбрасывается в `finally`. В `logEvent()` включается в каждую JSONL-строку + `tokPerSec` для `result`-событий.

## Форматирование

| Место | Формат |
|---|---|
| Progress header | `steps N, 42.1s · 150 tok/s` |
| Result header | ` 150 tok/s` (пробел + значение) |
| Единица | `tok/s` — не i18n, аналогично `s` для секунд |
| Точность | Integer, `Math.round()` |

## Ограничения дизайна

- `RunHistoryEntry` намеренно НЕ получает `outputTokens` — хранение в истории не даёт пользы, т.к. скорость показывается только для текущего запуска
- Live-скорость во время генерации невозможна — в stream-протоколе нет per-chunk счётчиков токенов
- `backend`/`model` будут `undefined` для log-строк вне `dispatch()` (chat flow) — допустимо, расширить отдельно

## Вне скоупа

- Live скорость в процессе генерации
- `input_tokens` или total tokens
- Сохранение скорости в истории запусков

## Связанные страницы

- [[llm-wiki-view]]
- [[generation-speed-plan]]
- [[async-generator-events]]
- [[wiki-controller]]
