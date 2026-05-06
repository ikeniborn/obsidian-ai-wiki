# DSPy Prompt Optimizer

Автоматически улучшает системные промты операций llm-wiki с помощью [DSPy MIPROv2](https://dspy.ai) на основе накопленных примеров из dev-лога.

## Как это работает

```
dev-лог (JSONL)
  → loader.py        # читает примеры, фильтрует по операции и min_examples
  → optimizer.py     # запускает MIPROv2 с LLM-оценщиком
  → writer.py        # пишет улучшенный промт в OUTPUT_DIR/{operation}.md
```

MIPROv2 перебирает варианты инструкции через Optuna, оценивая каждый вариант LLM-судьёй (`evaluator.md`). Плейсхолдеры (`{{domain_name}}` и др.) восстанавливаются после оптимизации отдельным LLM-вызовом, если MIPROv2 их потерял.

## Быстрый старт

```bash
cd scripts/dspy
uv sync

cp .env.example .env
# отредактировать .env

uv run optimize.py
```

Или через аргументы без `.env`:

```bash
uv run optimize.py \
  --log /path/to/dev.jsonl \
  --operations ingest,query \
  --prompts-dir /path/to/prompts \
  --output-dir /path/to/prompts/optimized
```

## Конфигурация (.env)

| Переменная       | Обязательная | Описание |
|------------------|:---:|---|
| `DSPY_BACKEND`   | да | `ollama` или `claude-code` |
| `DEV_LOG_PATH`   | да | Путь к JSONL-логу dev-режима |
| `PROMPTS_DIR`    | да | Папка с шаблонами промтов (`{op}.md` + `evaluator.md`) |
| `OUTPUT_DIR`     | да | Куда писать оптимизированные промты |
| `OPERATIONS`     | нет | Операции через запятую; если пусто — все из лога |
| `MIN_EXAMPLES`   | нет | Минимум примеров на операцию (default: `5`) |
| `OLLAMA_MODEL`   | ollama | Имя модели в Ollama (`llama3.2`, `qwen2.5`, ...) |
| `OLLAMA_BASE_URL`| нет | Base URL Ollama (default: `http://localhost:11434`) |
| `CLAUDE_PATH`    | claude-code | Путь к бинарнику `claude` CLI |
| `CLAUDE_MODEL`   | claude-code | Модель Claude (`claude-sonnet-4-6`, `haiku`, ...) |

## Бэкенды

### ollama (default)

Использует локальную модель через Ollama. Подходит для экспериментов без API-ключей.

```env
DSPY_BACKEND=ollama
OLLAMA_MODEL=llama3.2
```

### claude-code

Использует установленный `claude` CLI — никаких API-ключей, запускает существующую сессию Claude Code.

```env
DSPY_BACKEND=claude-code
CLAUDE_PATH=/usr/local/bin/claude
CLAUDE_MODEL=claude-sonnet-4-6
```

`ClaudeCodeLM` (`lib/backend.py`) — DSPy-совместимый адаптер: вызывает `claude --print --output-format json`, парсит последнюю JSON-строку из stdout.

## Формат dev-лога (JSONL)

Каждая строка — один пример выполнения операции:

```json
{
  "operation": "ingest",
  "userMessage": "Добавь статью про трансформеры",
  "result": "Создана страница transformer.md в домене ии",
  "eval": { "score": 8.5, "reasoning": "Верно определил домен" }
}
```

Поля `operation`, `userMessage`, `result`, `eval.score` обязательны — строки без них пропускаются.

## Шаблоны промтов

В `PROMPTS_DIR` должны лежать:

- `evaluator.md` — промт LLM-судьи с плейсхолдерами `{{operation}}`, `{{task_input}}`, `{{result}}`; возвращает JSON `{"score": 0–10, "reasoning": "..."}`.
- `{operation}.md` — текущий промт каждой операции (например, `ingest.md`, `query.md`).

Плейсхолдеры вида `{{имя}}` в промтах операций автоматически восстанавливаются после оптимизации.

## Компоненты

| Файл | Роль |
|---|---|
| `optimize.py` | Точка входа — CLI, оркестрация pipeline |
| `lib/loader.py` | Чтение и фильтрация JSONL-лога |
| `lib/backend.py` | `make_lm()` + `ClaudeCodeLM` адаптер |
| `lib/signature.py` | DSPy Signature с полями `user_message → result` |
| `lib/optimizer.py` | `run_mipro()`, `call_evaluator()`, `restore_placeholders()` |
| `lib/writer.py` | Запись результата в файл |

## Тесты

```bash
uv run pytest
```

Тесты покрывают: парсинг score из JSON-ответа оценщика, clamping (max 10), рендеринг переменных в evaluator-промт, восстановление плейсхолдеров, `run_mipro` end-to-end с mock MIPROv2.
