---
wiki_sources: [scripts/dspy/README.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [scripts, dspy, python, optimization, pipeline]
aliases: [MIPROv2 пайплайн, DSPy pipeline]
---

# DSPy MIPROv2 Оптимизационный пайплайн

Поток данных от dev-лога до записи улучшенного промта. Использует DSPy MIPROv2 с LLM-оценщиком для автоматического улучшения инструкций операций llm-wiki.

## Основные характеристики

```
dev-лог (JSONL)
  → loader.py        # читает примеры, фильтрует по операции и min_examples
  → optimizer.py     # запускает MIPROv2 с LLM-оценщиком
  → writer.py        # записывает улучшенный промт в OUTPUT_DIR/{operation}.md
```

**Шаги:**

1. `loader.py` читает JSONL-лог, отбирает строки с нужной операцией и `eval.score ≥ порога`, отбрасывает строки без обязательных полей.
2. `optimizer.py` запускает `run_mipro()` — MIPROv2 перебирает варианты инструкции через Optuna. Каждый вариант оценивается `call_evaluator()` (LLM-судья по `evaluator.md`). После оптимизации `restore_placeholders()` возвращает потерянные `{{имя}}` плейсхолдеры через отдельный LLM-вызов.
3. `writer.py` записывает финальный промт в `OUTPUT_DIR/{operation}.md`.

## Шаблоны промтов

В `PROMPTS_DIR` должны находиться:
- `evaluator.md` — промт LLM-судьи с плейсхолдерами `{{operation}}`, `{{task_input}}`, `{{result}}`; возвращает JSON `{"score": 0–10, "reasoning": "..."}`.
- `{operation}.md` — текущий промт каждой операции (например, `ingest.md`, `query.md`).

## Покрытие тестами

`uv run pytest` покрывает: парсинг score из JSON-ответа, clamping (max 10), рендеринг переменных в evaluator-промт, восстановление плейсхолдеров, `run_mipro` end-to-end с mock MIPROv2.

## Связанные концепции

- [[dspy-optimizer]] — модули, реализующие пайплайн
- [[dspy-env-config]] — конфигурация пайплайна
