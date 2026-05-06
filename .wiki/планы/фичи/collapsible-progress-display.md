---
wiki_sources: [docs/superpowers/plans/2026-04-26-progress-display.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [progress-display, прогресс-панель]
---
# Collapsible Progress Display

Фича обновляет отображение прогресса в боковой панели: вместо метрик добавляется кнопка-переключатель, позволяющая сворачивать и разворачивать список шагов операции.

## Основные характеристики

- Изменяет только `src/view.ts`: заменяет `metricsEl` на `progressToggle` и `progressCount`
- Добавляет метод `toggleSteps()` для переключения видимости списка шагов
- Метод `translateSystemEvent()` преобразует системные события в читаемые метки
- При старте операции панель разворачивается автоматически; при завершении — сворачивается
- Счётчик шагов (`progressCount`) показывает количество завершённых шагов в свёрнутом виде

## Основные характеристики

| Параметр | Значение |
|---|---|
| Затрагиваемый файл | `src/view.ts` |
| Версия | 0.1.x (первая фича в серии) |
| Режим | auto-expand при старте, auto-collapse при завершении |
