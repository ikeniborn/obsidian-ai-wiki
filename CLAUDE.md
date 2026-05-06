# CLAUDE.md

## Overview

Obsidian-плагин: запускает `llm-wiki` скилл через `iclaude.sh` как дочерний процесс, отображает прогресс в боковой панели в реальном времени.

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
  → IclaudeRunner.execute()    # spawn iclaude.sh, AsyncGenerator событий
  → parseStreamLine()          # парсинг stream-json строк с stdout
  → LlmWikiView.onEvent()      # рендер в боковой панели (live)
```

### Ключевые файлы

| Файл | Роль |
|---|---|
| `src/main.ts` | Точка входа, регистрация команд/view/настроек |
| `src/controller.ts` | WikiController — single-flight, валидация cwd/iclaudePath |
| `src/runner.ts` | IclaudeRunner — spawn процесса, abort/timeout, AsyncGenerator событий |
| `src/stream.ts` | `parseStreamLine()` — парсинг одной JSON-строки в RunEvent |
| `src/prompt.ts` | `buildPrompt()` — сборка строки команды `/llm-wiki` с safe-quoting |
| `src/view.ts` | LlmWikiView (ItemView) — живой рендер шагов, метрик, истории |
| `src/settings.ts` | Настройки + `autodetectCwd()` (обходит дерево вверх до 6 уровней) |
| `src/types.ts` | Все TypeScript-типы: WikiOperation, RunEvent, LlmWikiPluginSettings |

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
tests/stream.test.ts              # parseStreamLine() + fixture JSONL
tests/prompt.test.ts              # buildPrompt() — кириллица, пробелы, backslash
tests/settings.test.ts            # autodetectCwd() walk up
tests/runner.integration.test.ts  # IclaudeRunner с mock-iclaude.sh
tests/fixtures/
  stream-ingest.jsonl             # эталонный JSONL для stream-тестов
  mock-iclaude.sh                 # bash-mock: проигрывает JSONL с задержкой
```

Моки Obsidian API — `vitest.mock.ts` (корень проекта), подключаются автоматически через `vitest.config.ts`.

## Build & Versioning

esbuild (`esbuild.config.mjs`): entrypoint `src/main.ts` → `main.js` (CJS, ES2022).

Внешние зависимости (не бандлятся): `obsidian`, `electron`, `node:child_process`, `node:readline`, `node:path`, `node:fs`.

### Версионирование

Перед каждой сборкой автоматически поднимать patch-версию. Minor и major — только вручную.

1. Прочитать текущую версию из `package.json` (поле `version`)
2. Инкрементировать patch: `X.Y.Z` → `X.Y.(Z+1)`
3. Записать новую версию в `package.json` и `src/manifest.json`
4. Запустить `npm run build`

## Rules

- **`iclaude.sh -p` — флаг занят**: `iclaude.sh` резервирует `-p`/`--proxy` для proxy URL. При spawn передавай флаги через `--`: сначала флаги iclaude.sh (`--no-proxy`, `--model`), затем `--`, затем флаги claude (`-p <prompt>`, `--output-format`). Нарушение → `exit 1` без stderr.
- **`buildPrompt()`**: аргументы не должны содержать `\n` или `\` — newline разрывает argv при spawn, backslash ломает shell-экранирование. Функция бросает ошибку при нарушении.
- **single-flight**: `controller.ts` отклоняет параллельные запуски через `this._running` — `iclaude.sh` не реентерабелен, параллельный spawn испортит stdout-поток и cwd.
- **cwd**: файл для ingest/query должен находиться внутри cwd (проверка через `path.relative`).
- **history**: хранится в настройках Obsidian, лимит `historyLimit` (default 20) — компромисс между UX и размером settings.json; превышение замедляет сохранение Obsidian.
- **Домены**: единственный источник истины — union-тип `WikiDomain` в `src/types.ts` строка 8 (`"ии" | "ростелеком" | "базы-данных"`). При добавлении домена расширяй только его — все остальные места используют этот тип.
