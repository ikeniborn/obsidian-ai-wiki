---
wiki_sources:
  - "scripts/dspy/README.md"
  - "scripts/dspy/pyproject.toml"
  - "scripts/dspy/optimize.py"
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[dspy-optimizer]]"
  - "[[dspy-mipro-pipeline]]"
wiki_external_links: []
tags:
  - scripts
  - dspy
  - python
  - optimization
aliases:
  - "DSPy .env"
  - "dspy-optimizer config"
---

# Конфигурация DSPy оптимизатора (.env)

Набор переменных окружения для управления поведением `scripts/dspy/optimize.py`. Загружаются через `python-dotenv` из файла `.env` в рабочей директории. Все переменные можно переопределить через одноимённые CLI-аргументы.

## Основные характеристики

| Переменная | Обязательная | Описание |
|---|:---:|---|
| `DSPY_BACKEND` | да | `ollama` или `claude-code` |
| `DEV_LOG_PATH` | да | Путь к JSONL-логу dev-режима |
| `PROMPTS_DIR` | да | Папка с шаблонами промптов (`{op}.md` + `evaluator.md`) |
| `OUTPUT_DIR` | да | Куда писать оптимизированные промпты |
| `OPERATIONS` | нет | Операции через запятую; если пусто — все из лога |
| `MIN_EXAMPLES` | нет | Минимум примеров на операцию (default: `5`) |
| `OLLAMA_MODEL` | ollama | Имя модели в Ollama (`llama3.2`, `qwen2.5`, ...) |
| `OLLAMA_BASE_URL` | нет | Base URL Ollama (default: `http://localhost:11434`) |
| `CLAUDE_PATH` | claude-code | Путь к бинарнику `claude` CLI |
| `CLAUDE_MODEL` | claude-code | Модель Claude (`claude-sonnet-4-6`, `haiku`, ...) |

### Бэкенд ollama

Использует локальную модель через Ollama. Не требует API-ключей, подходит для экспериментов:

```env
DSPY_BACKEND=ollama
OLLAMA_MODEL=llama3.2
```

### Бэкенд claude-code

Использует установленный `claude` CLI — работает через существующую сессию Claude Code:

```env
DSPY_BACKEND=claude-code
CLAUDE_PATH=/usr/local/bin/claude
CLAUDE_MODEL=claude-sonnet-4-6
```

### Требования к PROMPTS_DIR

В директории `PROMPTS_DIR` должны находиться:
- `evaluator.md` — промпт LLM-судьи с плейсхолдерами `{{operation}}`, `{{task_input}}`, `{{result}}`; возвращает JSON `{"score": 0–10, "reasoning": "..."}`
- `{operation}.md` — текущий промпт каждой операции (например, `ingest.md`, `query.md`)

Плейсхолдеры вида `{{имя}}` в промптах операций автоматически восстанавливаются после оптимизации.
