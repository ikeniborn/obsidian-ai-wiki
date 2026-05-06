---
wiki_sources: [scripts/dspy/README.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [scripts, dspy, python, optimization]
aliases: [DSPy оптимизатор, optimize.py]
---

# DSPy Prompt Optimizer

Набор Python-скриптов для автоматической оптимизации системных промтов операций llm-wiki с помощью DSPy MIPROv2. Читает накопленные примеры из dev-лога и ищет улучшенные варианты инструкций через LLM-оценщик.

## Основные характеристики

Точка входа — `optimize.py` (CLI-скрипт, оркестрирует весь pipeline). Логика разделена на шесть модулей в `lib/`:

| Файл | Роль |
|---|---|
| `optimize.py` | CLI, парсинг аргументов, оркестрация |
| `lib/loader.py` | Чтение и фильтрация JSONL-лога |
| `lib/backend.py` | `make_lm()` + `ClaudeCodeLM` адаптер |
| `lib/signature.py` | DSPy Signature с полями `user_message → result` |
| `lib/optimizer.py` | `run_mipro()`, `call_evaluator()`, `restore_placeholders()` |
| `lib/writer.py` | Запись оптимизированного промта в файл |

`ClaudeCodeLM` (`lib/backend.py`) — DSPy-совместимый адаптер для Claude CLI: вызывает `claude --print --output-format json`, парсит последнюю JSON-строку из stdout.

MIPROv2 перебирает варианты инструкции через Optuna. Плейсхолдеры (`{{domain_name}}` и др.) восстанавливаются после оптимизации отдельным LLM-вызовом через `restore_placeholders()`.

## Запуск

```bash
cd scripts/dspy
uv sync
uv run optimize.py
```

## Формат dev-лога (вход)

Каждая строка JSONL — один пример выполнения операции. Обязательные поля: `operation`, `userMessage`, `result`, `eval.score`.

## Связанные концепции

- [[dspy-mipro-pipeline]] — поток данных от лога до записи результата
- [[dspy-env-config]] — переменные окружения и настройка бэкендов
