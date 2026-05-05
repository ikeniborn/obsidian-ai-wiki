# Design: devMode.logPath → logDir

**Date:** 2026-05-05  
**Scope:** Dev mode settings — изменить поле пути к лог-файлу на путь к директории; имя файла `dev.jsonl` фиксировано.

## Problem

Поле `devMode.logPath` требовало указывать полный путь с именем файла (например `/tmp/llm-wiki-dev.jsonl`). Имя файла не несёт пользовательской ценности — оно всегда должно быть `dev.jsonl`.

## Solution

Переименовать поле `logPath → logDir`. Пользователь указывает только директорию. Фактический путь к файлу конструируется в коде: `path.join(logDir, "dev.jsonl")`.

## Affected Files

| Файл | Изменение |
|---|---|
| `src/types.ts` | `devMode.logPath: string` → `devMode.logDir: string` в интерфейсе и `DEFAULT_SETTINGS` |
| `src/agent-runner.ts` | Читать `devMode.logDir`, строить путь через `path.join(logDir, "dev.jsonl")` |
| `src/settings.ts` | Привязка к `s.devMode.logDir`; placeholder `/tmp/llm-wiki-dev.jsonl` → `/tmp` |
| `src/i18n.ts` | Описания во всех трёх локалях: указать что вводится директория, а файл — `dev.jsonl` |
| `src/main.ts` | Миграция при loadSettings: если есть `devMode.logPath` но нет `devMode.logDir`, присвоить `path.dirname(logPath)` (или `""` если logPath был пустым) |

## Behaviour

```
User input:  /tmp
Actual file: /tmp/dev.jsonl
```

Пустое значение `logDir` → логирование отключено (поведение не меняется).

## Migration

При загрузке настроек:
```ts
if (saved.devMode?.logPath !== undefined && saved.devMode?.logDir === undefined) {
  saved.devMode.logDir = saved.devMode.logPath
    ? path.dirname(saved.devMode.logPath)
    : "";
  delete saved.devMode.logPath;
}
```

## Out of Scope

- `agentLogPath` в controller.ts — отдельное поле, не затрагивается.
- Изменение имени файла `dev.jsonl` — оно фиксировано и не настраивается.
