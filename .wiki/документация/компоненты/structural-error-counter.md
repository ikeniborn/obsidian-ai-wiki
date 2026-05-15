---
wiki_status: developing
wiki_sources:
  - docs/superpowers/plans/2026-05-15-structured-output-resilience.md
  - docs/superpowers/specs/2026-05-15-structured-output-resilience-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
tags: [компонент, telemetry, singleton, status-bar]
---

# structuralErrorCounter

Singleton-счётчик структурных ошибок LLM (`src/structural-error-counter.ts`). Агрегирует исходы валидации по всем call-sites; уведомляет подписчиков (статус-бар Obsidian).

## Назначение

Глобальная telemetry-точка для [[parse-with-retry]]: после каждого вызова orchestrator вызывает `record(succeeded, retryAttempt)`. Подписчик в `main.ts` (через `addStatusBarItem`) рендерит «ok/retried/failed».

## API

```ts
interface StructuralErrorStats {
  failed: number;
  retried: number;
  ok: number;
}

class Counter {
  record(succeeded: boolean | null, retryAttempt: number): void;
  subscribe(fn: (s: StructuralErrorStats) => void): () => void;  // returns unsubscribe
  get(): StructuralErrorStats;
  reset(): void;
}

export const structuralErrorCounter: Counter;
```

## Семантика record

| Параметры | Эффект |
|---|---|
| `succeeded === null` | noop |
| `!succeeded` | `failed++` |
| `succeeded && retryAttempt > 0` | `retried++` |
| `succeeded && retryAttempt === 0` | `ok++` |

После каждого `record()` подписчики получают **копию** snapshot (`{ ...stats }`), а не внутренний объект — это исключает mutation-leak.

## Интеграция

- `parse-with-retry.ts` → `structuralErrorCounter.record(...)` на финальном исходе.
- `main.ts:onload()` → `const el = this.addStatusBarItem()` + `const unsub = structuralErrorCounter.subscribe(s => el.setText(...))` + `this.register(unsub)`.

## Тесты

Покрытие — 9 vitest-кейсов (`tests/structural-error-counter.test.ts`): нулевое состояние, ok-first-attempt, retried, failed, noop-null, subscribe/unsubscribe, reset, snapshot-copy.

## Связанные страницы

- [[parse-with-retry]] — единственный writer
- [[structured-output-retry]] — паттерн
- [[structured-output-resilience-plan]] — implementation plan
