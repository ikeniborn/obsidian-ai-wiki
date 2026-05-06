---
wiki_sources: [docs/superpowers/plans/2026-05-04-dspy-prompt-optimization.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [mipro, dspy, prompt-optimization]
---
# DSPy / MIPROv2 Оптимизация промптов

Фича добавляет Python-скрипты для автоматической оптимизации phase-промптов через DSPy framework с алгоритмом MIPROv2.

## Основные характеристики

- Структура: `scripts/dspy/` — самодостаточный Python пакет, не зависит от основного TypeScript-кода
- `loader.py` — загружает примеры из `dev.jsonl` (сгенерированного в dev-режиме)
- `backend.py` — поддерживает Ollama (через `dspy.OllamaLocal`) и ClaudeCode (`dspy.Claude`)
- `signature.py` — DSPy Signature для задачи (входной контекст → wiki-страница)
- `optimizer.py` — функции: `call_evaluator()`, `restore_placeholders()`, `run_mipro()`
- `writer.py` — записывает оптимизированный промпт обратно в `prompts/*.md`
- `optimize.py` — CLI entrypoint: `python -m scripts.dspy.optimize --phase ingest --trials 20`

## Поток оптимизации

```
dev.jsonl → loader.py → DSPy примеры
  → MIPROv2.compile() → оптимизированные инструкции
  → restore_placeholders() → writer.py → prompts/ingest.md (обновлён)
```

## Ограничения

- `restore_placeholders()` необходим: MIPROv2 может удалить `{{wiki_path}}` из промпта при оптимизации
- Требует отдельного Python-окружения с `dspy-ai` и `ollama`/`anthropic` пакетами
