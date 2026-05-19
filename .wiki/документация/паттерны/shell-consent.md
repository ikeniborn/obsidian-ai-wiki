---
wiki_status: stub
wiki_sources:
  - README.md
wiki_updated: 2026-05-18
wiki_domain: документация
tags: [паттерн, безопасность, security, consent, shell]
aliases: ["shellConsentGiven", "first-run consent", "согласие на shell"]
---

# Shell Consent (First-Run)

Паттерн явного согласия пользователя перед первым выполнением shell-операции (spawn внешнего процесса).

## Назначение

Плагин запускает внешний процесс (`iclaude.sh` / `claude`) через `child_process.spawn`. Это требует явного согласия пользователя — особенно для Community Plugin, где выполнение shell-команд чувствительно.

## Механизм

При первом запуске с бэкендом `claude-agent` (поле `shellConsentGiven` отсутствует в `data.json` плагина) отображается модальный диалог до выполнения любой операции.

- Пользователь подтверждает → `shellConsentGiven: true` записывается в `data.json`
- Дальнейшие запуски — диалог не показывается

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
