# CLAUDE.md

## Overview

Obsidian-плагин: выполняет wiki-операции (ingest/query/lint/fix/init/chat) через TypeScript-фазы с LLM-backend (`ClaudeCliClient` → `claude`/`iclaude.sh`), отображает прогресс в боковой панели в реальном времени.

## Commands

```bash
npm run build        # production build → main.js
npm run dev          # watch mode (esbuild)
npm test             # vitest (one-shot)
npm run test:watch   # vitest watch
```

### Install

```bash
ln -s $(pwd)/dist ~/.config/obsidian/Plugins/obsidian-llm-wiki
```

### Run single test

```bash
npx vitest run tests/stream.test.ts
```

## Architecture

### Поток выполнения

```
Команда Obsidian / UI
  → WikiController.run()       # single-flight guard, валидация путей
  → AgentRunner.run()          # маршрутизация по операции в нужную фазу
  → phase (ingest/query/…)     # TypeScript-фаза вызывает LlmClient
                               # (query/lint используют graphCache.get; query вызывает selectSeeds и эмитит graph_stats)
  → ClaudeCliClient.chat       # spawn iclaude.sh, stream-json stdout
  → parseStreamLine()          # парсинг одной JSON-строки в RunEvent
  → LlmWikiView.onEvent()      # рендер в боковой панели (live)
```

### Ключевые файлы

| Файл | Роль |
|---|---|
| `src/main.ts` | Точка входа, регистрация команд/view/настроек |
| `src/controller.ts` | WikiController — single-flight, валидация cwd/iclaudePath |
| `src/agent-runner.ts` | AgentRunner — маршрутизирует операцию в нужную фазу, dev-лог, evaluator |
| `src/claude-cli-client.ts` | ClaudeCliClient — spawn iclaude.sh, OpenAI-совместимый LlmClient |
| `src/stream.ts` | `parseStreamLine()` — парсинг одной JSON-строки в RunEvent |
| `src/view.ts` | LlmWikiView (ItemView) — живой рендер шагов, метрик, истории |
| `src/settings.ts` | Настройки + `autodetectCwd()` (обходит дерево вверх до 6 уровней) |
| `src/types.ts` | Все TypeScript-типы: WikiOperation, RunEvent, LlmWikiPluginSettings |
| `src/wiki-graph-cache.ts` | GraphCache — in-memory, per-domain, hash-keyed; invalidated controller-ом после writes |
| `src/wiki-seeds.ts` | `selectSeeds()` — Jaccard на токенах pageId + первые 200 символов контента |

### Протокол stream-json (stdout iclaude)

Каждая строка stdout — один JSON-объект:

```
{ "type": "system",    "subtype": "init|error", "model": "...", "cwd": "..." }
{ "type": "assistant", "message": { "content": [{ "type": "tool_use"|"text", ... }] } }
{ "type": "user",      "message": { "content": [{ "type": "tool_result", "is_error": bool }] } }
{ "type": "result",    "duration_ms": N, "total_cost_usd": N, "result": "...", "is_error": bool }
```

Не-JSON строки (баннеры iclaude) игнорируются.

### Управление процессом

- `stdio: ["ignore", "pipe", "pipe"]` — stdin закрыт, stdout/stderr захвачены
- Прерывание: SIGTERM → 3000ms grace → SIGKILL
- Timeout: настраивается отдельно для каждой операции (ingest/query/lint/init)
- Single-flight: одновременно только одна операция, остальные получают Notice

## Testing

```
tests/stream.test.ts                    # parseStreamLine() + fixture JSONL
tests/settings.test.ts                  # autodetectCwd() walk up
tests/claude-cli-client.test.ts         # ClaudeCliClient — streaming, abort, large payload, session resume
tests/agent-runner.integration.test.ts  # AgentRunner с mock-адаптером
tests/phases/                           # unit-тесты каждой фазы
tests/fixtures/
  stream-ingest.jsonl                   # эталонный JSONL для stream-тестов
  mock-iclaude.sh                       # bash-mock: проигрывает JSONL с задержкой
```

Моки Obsidian API — `vitest.mock.ts` (корень проекта), подключаются автоматически через `vitest.config.ts`.

## Build & Versioning

esbuild (`esbuild.config.mjs`): entrypoint `src/main.ts` → `main.js` (CJS, ES2022).

Внешние зависимости (не бандлятся): `obsidian`, `electron`, `node:child_process`, `node:readline`. `path-browserify` бандлится; `node:path` и `node:fs` удалены из external.

### Версионирование

Перед каждой сборкой автоматически поднимать patch-версию. Minor и major — только вручную.

1. Прочитать текущую версию из `package.json` (поле `version`)
2. Инкрементировать patch: `X.Y.Z` → `X.Y.(Z+1)`
3. Записать новую версию в `package.json` и `src/manifest.json`
4. Запустить `npm run build`

## Rules

- **`iclaude.sh -p` — флаг занят**: `iclaude.sh` резервирует `-p`/`--proxy` для proxy URL. При spawn передавай флаги через `--`: сначала флаги iclaude.sh (`--no-proxy`, `--model`), затем `--`, затем флаги claude (`-p <prompt>`, `--output-format`). Нарушение → `exit 1` без stderr.
- **single-flight**: `controller.ts` отклоняет параллельные запуски через `this._running` — параллельный spawn испортит stdout-поток.
- **cwd**: файл для ingest/query должен находиться внутри cwd (проверка через `path.relative`).
- **history**: хранится в настройках Obsidian, лимит `historyLimit` (default 20) — компромисс между UX и размером settings.json; превышение замедляет сохранение Obsidian.
- **Домены**: единственный источник истины — union-тип `WikiDomain` в `src/types.ts` строка 8 (`"ии" | "ростелеком" | "базы-данных"`). При добавлении домена расширяй только его — все остальные места используют этот тип.
