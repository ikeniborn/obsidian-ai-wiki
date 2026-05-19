---
wiki_status: developing
wiki_sources:
  - README.md
wiki_updated: 2026-05-18
wiki_domain: документация
tags: [компонент, settings, настройки, конфигурация]
aliases: ["настройки плагина", "plugin settings", "settings reference"]
---

# Settings

Справочник всех настроек плагина AI Wiki. Настройки хранятся в `data.json` Obsidian, за исключением machine-specific параметров (см. [[per-device-settings]]).

## General (оба бэкенда)

| Настройка | Описание | По умолчанию |
|---|---|---|
| User prompt | Добавляется к системному промпту каждой операции | пусто |
| Max tokens | Макс. токенов в ответе. Рекомендовано ≥ 4096. Показывается когда per-operation выключен и бэкенд — native-agent | `4096` |
| Timeouts (seconds) | `ingest/query/lint/init/format`, через косую черту | `300/300/900/3600/600` |
| History limit | Макс. операций в истории боковой панели | `20` |
| Agent log (JSONL) | Лог событий агента в `<vault>/!Logs/agent.jsonl` (только desktop) | выключен |

## Domains

Список созданных доменов с кнопками **Edit** / **Delete**. Карта доменов хранится в `!Wiki/_domain.json`.

## Backend selector

| Настройка | Описание | По умолчанию |
|---|---|---|
| Backend | `claude-agent` или `native-agent` (desktop). Mobile принудительно native-agent | `claude-agent` |

## Claude Agent

| Настройка | Описание | По умолчанию |
|---|---|---|
| Path to Claude Code | Полный абсолютный путь к `iclaude.sh` / `iclaude` / `claude` | — |
| Model | Пресет (`opus`/`sonnet`/`haiku`) или явный ID (`claude-opus-4-7`). Показывается когда per-operation выключен | claude default |
| Allowed tools | Список через запятую, передаётся в `--tools`. Пусто = без ограничений | `Read,Edit,Write,Glob,Grep` |
| Per-operation models | Переключатель. Когда включён — настраивается модель для каждой операции | выключен |
| Per-operation: Model | Название модели для конкретной операции | — |

Первый запуск с `claude-agent` backend показывает модальный диалог согласия перед выполнением операции. Отозвать согласие: удалить `shellConsentGiven` из `data.json` плагина. Подробнее: [[shell-consent]].

## Native Agent

| Настройка | Описание | По умолчанию |
|---|---|---|
| Base URL | OpenAI-совместимый endpoint. Ollama: `http://localhost:11434/v1` | `http://localhost:11434/v1` |
| API key | `ollama` для Ollama; `sk-...` для OpenAI | `ollama` |
| Model | Название модели (`llama3.2`, `mistral`, `gpt-4o`, …). Показывается когда per-operation выключен | `llama3.2` |
| Context window (num_ctx) | Размер контекста (только Ollama). Пусто = дефолт модели | — |
| Temperature | `0.0`–`1.0`. Низкая (`0.1`–`0.3`) = точные факты | `0.2` |
| Per-operation models | Переключатель (только desktop). Когда включён — настраивается `model`/`maxTokens`/`temperature` для каждой операции | выключен |
| Per-operation: Max tokens | Макс. токенов для операции. Дефолты: ingest/query `4096`, lint/init `8192`, format `32768` | — |
| Per-operation: Temperature | Температура для операции (0–2) | `0.2` |
| Structured output retries | Повторы при ошибке валидации схемы (0–3). Выше = лучший результат на слабых моделях ценой задержки/токенов | `1` |

## Proxy (только native-agent)

| Настройка | Описание | По умолчанию |
|---|---|---|
| Use proxy | Маршрутизировать трафик native-agent через HTTP/HTTPS прокси. Не поддерживается на mobile | выключен |
| Proxy URL | `http://proxy.example.com:8080` или `https://…` | — |
| Username | Опционально, для basic-auth прокси | — |
| Password | Опционально, хранится локально в `local.json` | — |
| No-proxy hosts | CSV; поддерживает точный хост и `*.suffix`. Пример: `localhost,127.0.0.1,*.internal` | — |

Proxy применяется только к native-agent. Claude Agent использует собственную конфигурацию.

## Graph

| Настройка | Описание | По умолчанию |
|---|---|---|
| BFS depth (graphDepth) | Query: переходов от seed-страниц. `0` = только seeds, разумный максимум `3` | `1` |
| Hub threshold (hubThreshold) | Lint: страницы с количеством исходящих ссылок больше этого порога помечаются как хабы | `20` |

## Dev mode (только desktop)

| Настройка | Описание | По умолчанию |
|---|---|---|
| Dev mode | Включить dev-логгер и evaluator после каждой операции | выключен |
| Evaluator model | Название модели для evaluator (тот же бэкенд) | — |

## Связанные страницы

- [[per-device-settings]]
- [[shell-consent]]
- [[backend-strategy]]
- [[wiki-controller]]
