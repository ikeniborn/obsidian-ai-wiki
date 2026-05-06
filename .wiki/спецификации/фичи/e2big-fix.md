---
wiki_sources:
  - "docs/superpowers/specs/2026-05-05-e2big-fix-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - bugfix
  - e2big
  - spawn
aliases:
  - "E2BIG Spawn Fix"
  - "Temp Files для больших промптов"
---

# E2BIG Fix — Temp Files для больших промптов

Исправление ошибки `spawn E2BIG` при запуске claude CLI с большими аргументами (> ~2 MB `ARG_MAX`). Решение: при превышении порога 32 KB — запись в временный файл и передача через `--system-prompt-file` / `--append-system-prompt-file`.

## Основные характеристики

- **Причина**: `claude-cli-client.ts` передаёт `userText` (контент wiki) и `systemContent` (системный промпт) как CLI-аргументы; для большого домена (100+ страниц) легко превышает `ARG_MAX` (~2 MB)
- **Порог**: 32 768 байт (32 KB) — консервативно; типичный lint > 100 KB
- **Стратегия**: если `userText > 32 KB` → temp file + `--append-system-prompt-file` + dummy `-p "."`; если `systemContent > 32 KB` → temp file + `--system-prompt-file`
- **Расположение temp-файлов**: `<vault>/.obsidian/plugins/obsidian-llm-wiki/tmp/`; имена `llm-wiki-usr-<id>.txt` и `llm-wiki-sys-<id>.txt`
- **Cleanup**: в `finally`-блоке `_generate()` через `unlinkSync`; если writeFileSync падает на втором файле — первый очищается в catch-блоке
- **`tmpDir`**: новое поле в `ClaudeCliConfig`; вычисляется в `controller.ts` из `plugin.manifest.dir`

## Ограничения Claude Code CLI

- `-p -` (stdin как промпт) не поддерживается
- `--system-prompt-file` и `--append-system-prompt-file` — поддерживаются
- `-p "."` — минимальный dummy для активации non-interactive режима

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/claude-cli-client.ts` | Temp-файловая логика, новое поле `tmpDir` |
| `src/controller.ts` | Вычисление `tmpDir`, передача в `ClaudeCliClient` |

## Связанные концепции

- [[claude-agent-backend]]
- [[claude-cli-client-ts]]
