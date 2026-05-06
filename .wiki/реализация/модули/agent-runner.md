---
wiki_sources: ["src/agent-runner.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[claude-cli-client]]"
  - "[[vault-tools]]"
  - "[[run-event]]"
  - "[[llm-client]]"
  - "[[run-ingest]]"
  - "[[run-query]]"
  - "[[run-lint]]"
  - "[[run-init]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["AgentRunner"]
---
# AgentRunner (agent-runner.ts)

Центральный оркестратор выполнения wiki-операций. Принимает `RunRequest`, выбирает нужную фазовую функцию и транслирует поток `RunEvent` вызывающему коду. Не содержит бизнес-логики — только маршрутизация и сборка параметров.

## Основные характеристики

- **Расположение:** `src/agent-runner.ts`
- **Класс:** `AgentRunner`
- **Конструктор принимает:** `LlmClient`, `LlmWikiPluginSettings`, `VaultTools`, `vaultName: string`, `domains: DomainEntry[]`
- **Главный метод:** `async *run(req: RunRequest): AsyncGenerator<RunEvent>`

### Маршрутизация операций

| Операция | Фазовая функция |
|----------|----------------|
| `ingest` | `runIngest()` |
| `query` | `runQuery(false)` |
| `query-save` | `runQuery(true)` |
| `lint` | `runLint()` |
| `fix` | `runFix()` |
| `chat` | `runLintChat()` |
| `init` | `runInit()` |

### buildOptsFor()

Вычисляет параметры LLM для данной операции с учётом настроек:
- Если `perOperation` включён — берёт model/maxTokens из `operations[key]`
- Иначе — использует глобальные `model` / `maxTokens`
- Для `fix` и `chat` использует `lint`-настройки

### DevMode интеграция

При `devMode.enabled` — записывает лог операции в `dev.jsonl` и запускает `runEvaluator` для автооценки результата.

## Связанные концепции

- [[claude-cli-client]] — реализация LlmClient для claude-agent backend
- [[vault-tools]] — абстракция доступа к файлам vault
- [[run-event]] — тип события потока
