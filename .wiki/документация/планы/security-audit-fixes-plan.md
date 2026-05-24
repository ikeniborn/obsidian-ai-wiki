---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-18-security-audit-fixes.md
  - docs/superpowers/specs/2026-05-18-security-audit-fixes-design.md
wiki_updated: 2026-05-18
wiki_domain: документация
tags: [plan, security, tdd, vault, spawn, consent, community-plugin]
---

# Security Audit Fixes — Implementation Plan

Реализационный план [[security-audit-fixes-design]]: устранить два замечания Obsidian community review bot — vault enumeration через `getFiles()` и избыточный spawn в settings.ts — с валидацией пути и first-run consent modal.

**Архитектура:** заменить `vault.getFiles()` на folder-scoped хелперы (`getFolderByPath` + рекурсивный обход); убрать probe-spawn из settings.ts → `fs.access`; добавить `validateIclaudePath()` перед каждым spawn; запретить операции до получения согласия пользователя (modal + guard).

**Tech Stack:** TypeScript, Obsidian API (`TFile`, `TFolder`, `Vault`, `Modal`), `node:fs/promises`, `path-browserify`.

## Карта файлов

| Файл | Изменение |
|---|---|
| `src/view.ts` | Экспорт `collectMdInPaths` + `walkFolder`; замена 2 call site; импорты `TFile`, `TFolder`, `Vault` |
| `src/settings.ts` | `checkClaudeAvailability` через `fs.access`; убрать `child_process` import |
| `src/claude-cli-client.ts` | Экспорт `validateIclaudePath`; вызов перед `spawn()` |
| `src/types.ts` | `shellConsentGiven: boolean` в `LlmWikiPluginSettings` + `DEFAULT_SETTINGS` |
| `src/i18n.ts` | `shellConsentRequired` в `ctrl`; строки `ShellConsentModal` в `modal` (en + ru) |
| `src/modals.ts` | `ShellConsentModal` |
| `src/main.ts` | `onLayoutReady` consent check |
| `src/controller.ts` | Consent guard в `dispatch()` и `dispatchChat()` |
| `tests/collect-md-in-paths.test.ts` | Unit-тесты `collectMdInPaths` / `walkFolder` (6 тестов) |
| `tests/no-fs-imports.test.ts` | Проверка: `settings.ts` не импортирует `child_process` |
| `tests/claude-cli-client.test.ts` | Тесты `validateIclaudePath` (5 тестов) |
| `tests/shell-consent.test.ts` | Тесты `ShellConsentModal` и consent guard (4 теста) |
| `README.md` | `## Security` раздел |

## Task 1: Vault Enumeration — folder-scoped helpers (F-1)

**Файлы:** `src/view.ts`, `tests/collect-md-in-paths.test.ts`

TDD: создать тест-файл с 6 тестами (`walkFolder`: flat / recurse / non-md; `collectMdInPaths`: by path / missing folder / empty paths) → убедиться в провале → добавить импорты `TFile`, `TFolder`, `Vault` → добавить экспортируемые хелперы после блока импортов → заменить два call site в `runInit` и `runReinit` → зелёные тесты + `npm test`.

Commit: `fix(security): replace vault.getFiles() with folder-scoped collectMdInPaths (F-1)`

## Task 2: Remove spawn probe from settings.ts (F-2a)

**Файлы:** `src/settings.ts`, `tests/no-fs-imports.test.ts`

TDD: добавить тест в `no-fs-imports.test.ts` (проверка отсутствия `child_process` import в settings.ts) → убедиться в провале → заменить строку 1 (`import { spawn } from "child_process"` → `import { access, constants } from "node:fs/promises"`) → заменить тело `checkClaudeAvailability` на однострочный вызов `await access(iclaudePath, constants.X_OK)` → зелёные тесты.

Commit: `fix(security): replace spawn probe in settings.ts with fs.access (F-2a)`

## Task 3: Path validation before spawn (F-2b)

**Файлы:** `src/claude-cli-client.ts`, `tests/claude-cli-client.test.ts`

TDD: добавить импорт `validateIclaudePath` и 5 тестов (empty / relative / traversal / valid absolute / home path) → убедиться в провале → добавить `isAbsolute` к импорту из `path-browserify` → добавить экспортируемую `validateIclaudePath` после константы `SIGTERM_GRACE_MS` → добавить вызов `validateIclaudePath(this.cfg.iclaudePath)` в начало `_generate()` → зелёные тесты.

Commit: `fix(security): add validateIclaudePath before spawn in ClaudeCliClient (F-2b)`

## Task 4: Shell consent modal и operation guard (F-2c)

**Файлы:** `src/types.ts`, `src/i18n.ts`, `src/modals.ts`, `src/main.ts`, `src/controller.ts`, `tests/shell-consent.test.ts`

TDD: создать `tests/shell-consent.test.ts` с 4 тестами (`DEFAULT_SETTINGS.shellConsentGiven === false`; `ShellConsentModal` экспортируется; `enable()` устанавливает флаг и вызывает `saveSettings`; `cancel()` не меняет флаг) → убедиться в провале.

Реализация последовательно:

1. `src/types.ts` — добавить `shellConsentGiven: boolean` в интерфейс и `DEFAULT_SETTINGS`.
2. `src/i18n.ts` — в `ctrl`: `shellConsentRequired` (en/ru); в `modal`: `shellConsentTitle`, `shellConsentBody(iclaudePath)`, `shellConsentEnable` (en/ru).
3. `src/modals.ts` — класс `ShellConsentModal extends Modal` с методами `onOpen`, `cancel`, `enable` (async), `onClose`.
4. `src/main.ts` — добавить `ShellConsentModal` в импорт; добавить `onLayoutReady` callback с проверкой `backend === "claude-agent" && !shellConsentGiven`.
5. `src/controller.ts` — добавить `ShellConsentModal` в импорт; в существующий `const local = ...` блок обоих методов добавить consent guard после `requireClaudeAgent`.

Зелёные тесты + `npm test`.

Commit: `feat(security): add shell consent modal and operation guard (F-2c)`

**Важно:** `backend` value — `"claude-agent"` (не `"claude-cli"`). Consent guard интегрируется в существующий блок load local config, не создаёт отдельного блока.

## Task 5: README Security section (F-2d)

**Файлы:** `README.md`

Добавить раздел `## Security` перед Quick Start: что запускается (абсолютный путь из настроек), почему необходим spawn, права процесса, как изменить путь, first-run consent и как отозвать (`shellConsentGiven` из `data.json`). Плюс `### Vault Access` — плагин читает только настроенные source paths.

Commit: `docs: add Security section to README (F-2d)`

## Покрытие спецификации

| Требование | Task |
|---|---|
| `vault.getFiles()` — ноль вхождений в `view.ts` | Task 1 |
| `child_process` только в `claude-cli-client.ts` | Task 2 |
| `validateIclaudePath` бросает на пустом / relative / traversal | Task 3 |
| Consent modal при первом запуске с `claude-agent` | Task 4 |
| Операции без consent → Notice + early return | Task 4 |
| README имеет Security раздел | Task 5 |

## Связанные страницы

- [[security-audit-fixes-design]] — спецификация
- [[claude-cli-client]] — `validateIclaudePath` + spawn
- [[wiki-controller]] — consent guard в `dispatch` / `dispatchChat`
- [[llm-wiki-view]] — folder-scoped helpers
- [[audit-fix-design]] — предыдущий аудит (manifest, ESLint, window APIs)
- [[single-flight-guard]] — защита от параллельных запусков
