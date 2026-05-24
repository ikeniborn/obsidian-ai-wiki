---
wiki_status: developing
wiki_sources:
  - README.md
  - "[[prompts/lint.md]]"
  - docs/TODO.md
  - "[[docs/superpowers/specs/2026-05-19-agent-stability-audit-design.md]]"
  - "[[docs/superpowers/plans/2026-05-19-agent-stability-audit.md]]"
wiki_updated: 2026-05-23
wiki_domain: документация
wiki_keywords: [lint, audit, quality, LintOutputSchema, parseWithRetry, upsertIndexAnnotation, annotation, reasoning-first-json, fix]
wiki_outgoing_links:
  - "[[fix-operation]]"
  - "[[поток-выполнения-операции]]"
  - "[[wiki-controller]]"
  - "[[reasoning-first-json]]"
  - "[[wiki-index]]"
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

Промпт выступает в роли рецензента wiki-домена. Фокус: дублирование страниц, пробелы в покрытии, размытые определения, устаревший контент, битые ссылки.

Входные данные:
- `{{domain_name}}` — название домена
- `{{entity_types_block}}` — текущие entity_types из domain-map

Выходной JSON (после [[agent-stability-audit-design]], combined assess+fix):
```json
{
  "reasoning": "цепочка рассуждений",
  "report": "## Отчёт lint\n\nАнализ качества в формате Markdown...",
  "fixes": [{"path": "!Wiki/domain/type/Entity.md", "content": "полный контент исправленной страницы", "annotation": "краткое описание"}]
}
```

- `report` — полный markdown-отчёт для пользователя (выводится в боковую панель)
- `fixes` — только изменённые страницы (пустой массив если правок нет)
- `annotation` — одно предложение, описание сущности для поиска

Валидируется через `parseWithRetry(LintOutputSchema)` (`callSite: "lint.fix"`). Паттерн ответа: [[reasoning-first-json]].

## Обновление индекса

После каждой исправленной страницы вызывается `upsertIndexAnnotation` ([[wiki-index]]) — добавляет/обновляет `PageId: annotation` в `_index.md`. Ранее `lint.ts` перезаписывал `_index.md` плоским списком `- [[...]]`; этот блок удалён.

LLM возвращает JSON-массив с полями `path`, `content`, `annotation`:
- `wiki_keywords` — добавлять/обновлять во frontmatter.
- `annotation` — одно предложение, описание для поиска.

## Ограничения платформы

Только desktop.

## Известные проблемы (docs/TODO.md, 2026-05-18)

| # | Статус | Описание |
|---|---|---|
| 13 | `[>]` в работе | В боковой панели при lint отображается неполная информация в прогрессе — показывает ответ от предыдущего шага, не сигнализирует об ожидании ответа от LLM. Нужно отображать индикатор ожидания между `tool_result` и следующим LLM-событием. |
| 14 | `[>]` в работе | Операция lint не дописывает записи в `log.md` и не обновляет `index.md`. Нужно проверить фазу lint и добавить вызовы append-to-log и update-index после завершения. |
| 9 | `[v]` исправлено | После lint в результате дублировались ссылки на wiki-страницы. Исправлено (дедупликация dead-link отчётов per file в `checkStructure`, коммит cddfb51). |
| 10 | `[!]` | После lint при отправке запроса через чат получена ошибка. Требует диагностики в chat-фазе после lint-контекста. |
| 21 | `[]` | Проверить пайплайн чата после lint: после lint и ответа пользователя запускается lint-chat — неверно. Должен продолжать обсуждение в режиме чата без нового процесса. Скрытые результаты, возможное ограничение max tokens. |
| 22 | `[]` | Проверить корректность записи в лог после lint: "Исправлено страниц: 0" при наличии изменений. |

## Agent Stability Audit: Merge assess+fix (реализовано)

По [[agent-stability-audit-design]]: lint выполняет assess и fix в одном CoT+Structured вызове вместо двух раздельных. `LintOutputSchema`:
- `reasoning` — пошаговое обоснование
- `report` — markdown-отчёт для пользователя (заменяет free-text assess)
- `fixes` — JSON-массив страниц `WikiPageSchema[]` (заменяет второй вызов buildFixMessages)

Итого: 3 LLM-вызова → 2. UI-прогресс в fix-loop: перед записью каждой страницы отдаётся `assistant_text` с именем файла. Промпт `prompts/lint.md` обновлён для возврата `{reasoning, report, fixes}`.

Функция `buildFixMessages` удалена из `src/phases/lint.ts`.

## История изменений

- **2026-05-15** — создана страница (README.md, prompts/lint.md).
- **2026-05-17** — обновлено по [[mobile-query-seed-design]]: upsertIndexAnnotation per fixed page, удалён flat index rewrite, добавлено описание annotation в промпте.
- **2026-05-19** — добавлен раздел agent-stability-audit (планируемый merge assess+fix).
- **2026-05-20** — обновлено по [[agent-stability-audit-design]]: промпт lint.md обновлён для возврата `{reasoning, report, fixes}`, merge assess+fix реализован через `parseWithRetry(LintOutputSchema)`.

## Связанные страницы

- [[fix-operation]]
- [[поток-выполнения-операции]]
- [[wiki-controller]]
- [[reasoning-first-json]]
- [[wiki-index]]
- [[mobile-query-seed-design]]
- [[agent-stability-audit-design]]
