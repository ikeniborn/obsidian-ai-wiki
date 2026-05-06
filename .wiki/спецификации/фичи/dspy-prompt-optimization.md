---
wiki_sources:
  - "docs/superpowers/specs/2026-05-04-dspy-prompt-optimization-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - dspy
  - optimization
  - python
aliases:
  - "MIPROv2"
  - "DSPy оптимизация"
---

# DSPy / MIPROv2 Оптимизация промптов

Автономный Python-скрипт для оптимизации системных промптов агента на основе JSONL-логов dev-режима. Использует DSPy MIPROv2 для генерации улучшенных инструкций и сохраняет результат в `prompts/optimized/`.

## Основные характеристики

- **Расположение**: `scripts/dspy/` — uv-проект с зависимостями `dspy-ai`, `python-dotenv`; Python 3.11
- **Конфигурация**: `.env` файл с параметрами backend, путями, операциями, порогом примеров; CLI аргументы имеют приоритет
- **Бэкенды**: Ollama (`dspy.LM` с OpenAI-compatible endpoint) и Claude Code CLI (`ClaudeCodeLM` — subprocess с `--print --dangerously-skip-permissions --tools ""`)
- **DSPy Signature**: `WikiOperation` с полями `user_message` (input) и `result` (output); инструкция задаётся из `prompts/<op>.md`
- **Trainset**: из JSONL-лога плагина; ключи camelCase (`userMessage`, `systemPrompt`, `result`, `eval.score`)
- **MIPROv2**: `auto="light"`, `num_threads=1`, `max_bootstrapped_demos=0` — оптимизируется только текст инструкции без few-shot
- **Метрика**: `score / 10.0` из evaluator-фазы плагина
- **Восстановление плейсхолдеров**: после оптимизации MIPROv2 удаляет `{{placeholders}}`; LLM-вызов восстанавливает их в семантически подходящие места; валидация полноты

## Поток выполнения

```
loader.py → backend.py → для каждой операции:
  optimizer.py (load template → trainset → MIPROv2 → restore placeholders) →
  writer.py (write prompts/optimized/<op>.md)
```

## Связанные концепции

- [[dev-mode-prompt-management]]
