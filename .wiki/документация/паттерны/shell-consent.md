---
wiki_status: stub
wiki_sources:
  - README.md
  - docs/superpowers/specs/2026-05-23-ux-cleanup-design.md
wiki_updated: 2026-05-24
wiki_domain: документация
tags: [паттерн, безопасность, security, consent, shell]
aliases: ["shellConsentGiven", "first-run consent", "согласие на shell"]
---

# Shell Consent (Per-Switch)

Паттерн явного согласия пользователя при каждом переключении бэкенда на `claude-agent` (spawn внешнего процесса).

## Назначение

Плагин запускает внешний процесс (`iclaude.sh` / `claude`) через `child_process.spawn`. Это требует явного согласия пользователя — особенно для Community Plugin, где выполнение shell-команд чувствительно.

## Механизм

При **каждом** переключении dropdown бэкенда в `claude-agent` (`settings.ts`) отображается `ShellConsentModal` до применения выбора.

- Пользователь подтверждает → `shellConsentGiven: true` в `LocalConfig`; выбор применяется.
- `shellConsentGiven` используется `WikiController` как guard: отклоняет запуск операции если флаг не выставлен.
- При переключении обратно на `native-agent` и повторном выборе `claude-agent` — модал появляется снова.

**До Task 29 (изменение 2026-05-24):** условие содержало `&& !this.localCache.shellConsentGiven`, из-за чего модал показывался только один раз за сессию. Убранный guard сделал consent per-switch.

## Что выполняется

- Абсолютный путь из настроек: Settings → Backend → "Path to Claude Code" (например `/home/user/iclaude.sh`)
- Путь валидируется: должен быть абсолютным и не содержать traversal-последовательностей (`../`)
- Подпроцесс наследует OS-права текущего пользователя

## Отзыв согласия

Удалить ключ `shellConsentGiven` из `data.json` плагина (файл в папке плагина внутри `.obsidian/plugins/obsidian-llm-wiki/`).

## Vault access

Плагин читает только папки, настроенные как "Source paths" для каждого домена. Полный перебор vault не производится.

## Связанные страницы

- [[settings]]
- [[wiki-controller]]
- [[per-device-settings]]
- [[ux-cleanup-design]]
