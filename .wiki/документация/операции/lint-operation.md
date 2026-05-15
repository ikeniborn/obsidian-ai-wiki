---
wiki_status: developing
wiki_sources:
  - README.md
  - prompts/lint.md
wiki_updated: 2026-05-15
wiki_domain: документация
wiki_outgoing_links:
  - "[[fix-operation]]"
  - "[[поток-выполнения-операции]]"
  - "[[wiki-controller]]"
  - "[[reasoning-first-json]]"
tags: [операция, lint, качество, аудит]
aliases: ["lint operation", "аудит вики"]
---

# Lint Operation

Проверяет качество и актуальность wiki-домена: находит неполные, устаревшие и несвязанные страницы.

## Назначение

Обеспечивает поддержание wiki в актуальном состоянии. Результат — отчёт о проблемах в боковой панели, на основе которого можно запустить [[fix-operation]].

## UX-поток

1. `Command Palette` → `AI Wiki: Lint домена`.
2. Агент проверяет все страницы домена.
3. Отчёт отображается в боковой панели.
4. Кнопка **Fix** в панели запускает [[fix-operation]] для автоматического исправления найденных проблем.

## LLM-промпт (lint.md)

Промпт выступает в роли рецензента wiki-домена. Фокус: дублирование страниц, пробелы в покрытии, размытые определения, устаревший контент.

Входные данные:
- `{{domain_name}}` — название домена
- `{{entity_types_block}}` — текущие entity_types из domain-map

Выходной JSON (поле `reasoning` первым):
```json
{
  "reasoning": "...",
  "entity_types": [...],
  "language_notes": "..."
}
```

Результат используется для уточнения `entity_types` домена по итогам lint-анализа. Паттерн ответа: [[reasoning-first-json]].

## Ограничения платформы

Только desktop.

## Связанные страницы

- [[fix-operation]]
- [[поток-выполнения-операции]]
- [[wiki-controller]]
- [[reasoning-first-json]]
