---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-18-security-audit-fixes-design.md
wiki_updated: 2026-05-18
wiki_domain: документация
tags: [спецификация, security, community-plugin, vault, spawn, consent]
---

# Security Audit Fixes — Design Spec

Дата: 2026-05-18. Спецификация устранения двух замечаний Obsidian Community Plugin review bot: предупреждения о Shell Execution и рекомендации по Vault Enumeration.

## Цель

Пройти community review и снизить реальные риски: ограничить scope vault-доступа до настроенных папок, убрать лишний spawn-вызов из settings.ts, добавить валидацию пути перед каждым spawn, запросить явное согласие пользователя на первом запуске.

## Finding 1: Vault Enumeration

**Проблема:** `view.ts:269` и `view.ts:311` вызывают `this.app.vault.getFiles()` — загружают полный список файлов vault, затем фильтруют по `sourcePaths`. Review bot помечает это как full vault enumeration.

**Решение — folder-scoped iteration:**

Два module-level хелпера в `view.ts`:

- `collectMdInPaths(vault, sourcePaths)` — итерирует только настроенные папки через `vault.getFolderByPath(p)`, вызывает `walkFolder`.
- `walkFolder(folder, out)` — рекурсивно обходит `folder.children`, добавляет `TFile` с `extension === "md"`.

Если source path не существует как папка — `getFolderByPath` возвращает `null`, результат пустой (поведение идентично старому при отсутствии файлов).

**Импорты `view.ts`:** добавить `TFile`, `TFolder`, `Vault` из `"obsidian"`.

## Finding 2: Shell Execution

`child_process.spawn` архитектурно необходим для Claude CLI. Митигация по трём направлениям.

### 2a. Убрать probe-spawn из settings.ts

`settings.ts:checkClaudeAvailability` сейчас запускает subprocess с LLM-промптом для проверки доступности. Заменить на `fs.access(iclaudePath, constants.X_OK)` из `node:fs/promises` — проверяет наличие и исполняемость файла без spawn.

Убрать `import { spawn } from "child_process"` из `settings.ts`. После изменения `child_process` импортируется только в `claude-cli-client.ts`.

**Trade-off:** ошибки обнаруживаются при первой реальной операции, не при открытии настроек.

### 2b. Валидация пути перед spawn

Функция `validateIclaudePath(p)`, экспортируемая из `claude-cli-client.ts`. Проверки:

- путь непустой;
- путь абсолютный (`isAbsolute`);
- путь не содержит `".."`.

Вызывается в начале `_generate()` перед `spawn()`.

### 2c. Shell Consent Modal

**Настройки** — добавить в `LlmWikiPluginSettings` и `DEFAULT_SETTINGS`:

```ts
shellConsentGiven: boolean  // default: false
```

**ShellConsentModal** в `modals.ts` — заголовок "⚠ Shell Execution Notice", текст с объяснением что именно запускается и почему, кнопки [Cancel] / [I understand, enable]. При "enable" устанавливает `shellConsentGiven = true` и вызывает `saveSettings()`.

**Trigger в `main.ts`** — внутри `onLayoutReady()`: показывает модал если `backend === "claude-agent"` и `!shellConsentGiven`.

**Guard в `controller.ts`** — в `dispatch()` и `dispatchChat()`, в существующем блоке с `requireClaudeAgent`, добавить проверку:

```ts
if (eff.backend === "claude-agent" && !this.plugin.settings.shellConsentGiven) {
  new Notice(i18n().ctrl.shellConsentRequired);
  return;
}
```

### 2d. README Security section

Добавить раздел `## Security` в `README.md`: что запускается, почему необходим spawn, как изменить путь, как работает first-run consent.

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/view.ts` | Хелперы `collectMdInPaths` + `walkFolder`; 2 call site заменены |
| `src/settings.ts` | `checkClaudeAvailability` через `fs.access`; убран `child_process` import |
| `src/claude-cli-client.ts` | `validateIclaudePath()` перед `spawn()` |
| `src/modals.ts` | `ShellConsentModal` |
| `src/main.ts` | `onLayoutReady` consent check |
| `src/controller.ts` | Consent guard в `dispatch` и `dispatchChat` |
| `src/types.ts` | `shellConsentGiven: boolean` в `LlmWikiPluginSettings` |
| `src/i18n.ts` | `shellConsentRequired` + строки модала (en/ru) |
| `README.md` | `## Security` раздел |

## Критерии успеха

- `vault.getFiles()` — ноль вхождений в `view.ts`
- `child_process` import — только в `claude-cli-client.ts`
- `validateIclaudePath` бросает на пустом / относительном / traversal-пути
- При первом запуске с `claude-agent` backend показывается consent modal
- Операции без consent возвращают Notice и завершаются
- README содержит раздел Security

## Связанные страницы

- [[security-audit-fixes-plan]] — реализационный план
- [[claude-cli-client]] — spawn и валидация пути
- [[wiki-controller]] — consent guard
- [[llm-wiki-view]] — замена `getFiles()`
- [[audit-fix-design]] — предыдущий аудит (manifest, ESLint, window APIs)
