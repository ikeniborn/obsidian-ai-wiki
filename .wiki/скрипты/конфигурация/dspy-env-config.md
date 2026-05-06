---
wiki_sources: [scripts/dspy/README.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [scripts, dspy, python, optimization, config]
aliases: [DSPy .env, конфигурация DSPy оптимизатора]
---

# Конфигурация DSPy оптимизатора (.env)

Настройка DSPy Prompt Optimizer через переменные окружения в файле `.env` (корень `scripts/dspy/`). Поддерживает два бэкенда: `ollama` и `claude-code`.

## Основные характеристики

| Переменная | Обязательная | Описание |
|---|:---:|---|
| `DSPY_BACKEND` | да | `ollama` или `claude-code` |
| `DEV_LOG_PATH` | да | Путь к JSONL-логу dev-режима |
| `PROMPTS_DIR` | да | Папка с шаблонами промтов (`{op}.md` + `evaluator.md`) |
| `OUTPUT_DIR` | да | Куда записывать оптимизированные промты |
| `OPERATIONS` | нет | Операции через запятую; если пусто — все из лога |
| `MIN_EXAMPLES` | нет | Минимум примеров на операцию (default: `5`) |
| `OLLAMA_MODEL` | ollama | Имя модели в Ollama (`llama3.2`, `qwen2.5`, ...) |
| `OLLAMA_BASE_URL` | нет | Base URL Ollama (default: `http://localhost:11434`) |
| `CLAUDE_PATH` | claude-code | Путь к бинарнику `claude` CLI |
| `CLAUDE_MODEL` | claude-code | Модель Claude (`claude-sonnet-4-6`, `haiku`, ...) |

### Бэкенд: ollama

Использует локальную модель через Ollama. Подходит для экспериментов без API-ключей.

```env
DSPY_BACKEND=ollama
OLLAMA_MODEL=llama3.2
```

### Бэкенд: claude-code

Использует установленный `claude` CLI — запускает существующую сессию Claude Code, API-ключи не нужны.

```env
DSPY_BACKEND=claude-code
CLAUDE_PATH=/usr/local/bin/claude
CLAUDE_MODEL=claude-sonnet-4-6
```

Все переменные можно передать напрямую через аргументы CLI (`--log`, `--operations`, `--prompts-dir`, `--output-dir`) без создания `.env`.

## Связанные концепции

- [[dspy-optimizer]] — модули оптимизатора
- [[dspy-mipro-pipeline]] — пайплайн, использующий эту конфигурацию
