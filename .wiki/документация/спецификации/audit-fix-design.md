---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-13-audit-fix-design.md
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [спецификация, audit, community-plugin, manifest, typescript]
---

# Audit Fix Design — Community Submission

Дата: 2026-05-13. Спецификация исправлений по результатам Obsidian plugin audit для подготовки к публикации в Community Plugins.

## Цель

Устранить 4 ошибки и ~20 actionable-предупреждений, выявленных аудитом, не нарушая архитектуру и мобильную поддержку.

## Раздел 1: manifest.json — minAppVersion

**Файлы:** `manifest.json`, `src/manifest.json`

Изменить `minAppVersion`: `"1.0.0"` → `"1.7.2"`.

Закрывает три API-ошибки одним изменением:
- `Workspace.revealLeaf` (requires 1.7.2)
- `Vault.getAllFolders` (requires 1.6.6)
- `ButtonComponent.setDisabled` (requires 1.2.3)

`isDesktopOnly` остаётся `false` — мобильный режим поддерживается (query-only через native backend).

## Раздел 2: ESLint sentence-case

**Файлы:** `src/main.ts:30-31`, `src/view.ts:85`

Заменить `"AI Wiki"` → `"AIWiki"` в двух местах:
- Ribbon icon label (`main.ts:31`)
- `getDisplayText()` (`view.ts:85`)

Удалить `// eslint-disable-next-line obsidianmd/ui/sentence-case`. Поле `name` в manifest не меняется.

## Раздел 3: Window API

**Файлы:** `src/claude-cli-client.ts`, `src/modals.ts`

Заменить `setTimeout` → `window.setTimeout`, `clearTimeout` → `window.clearTimeout` (7 мест). В `modals.ts` заменить `document.body` → `activeDocument.body` и добавить `activeDocument` в импорт.

Требуется для совместимости с popout windows.

## Раздел 4: TypeScript any fixes (~15 предупреждений)

| Подраздел | Файл | Изменение |
|---|---|---|
| 4a | `evaluator.ts`, `agent-runner.ts`, `ingest.ts`, `modals.ts` | `JSON.parse(...)` → `const x: unknown = JSON.parse(...)` + narrow |
| 4b | `stream.ts` | После `Array.isArray(content)` → `(content as unknown[])[0]` |
| 4c | `controller.ts` | `adapter as any` → `adapter as unknown as InternalAdapter` (interface с `getFullPath`, `remove`) |
| 4d | `llm-utils.ts:39,55` | `const existing: string = ...` явная аннотация |
| 4e | `template.ts:2` | regex callback: `(_, key: string)` |
| 4f | `main.ts:191` | Убрать избыточный cast `as Record<string, unknown> \| null` |

## Разделы 5–7: no-fix

- `setInterval` в `view.ts` — UI-таймеры, не network; статический анализ false positive.
- `node:child_process` — только в desktop-бэкенде; при `isDesktopOnly: false` — false positive.
- GitHub artifact attestation — CI/CD, вне скоупа.

## Итог

| Раздел | Файлов | Ошибок | Предупреждений |
|---|---|---|---|
| minAppVersion | 2 | 3 | 0 |
| sentence-case | 2 | 1 | 0 |
| window APIs | 2 | 0 | 6 |
| TypeScript any | 9 | 0 | ~15 |
| **Итого** | **12** | **4** | **~21** |

## Статус (2026-05-13)

Спецификация создана. Реализация — pending (задачи не начаты).

## Связанные страницы

- [[claude-cli-client]]
- [[llm-wiki-view]]
- [[wiki-controller]]
