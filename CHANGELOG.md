# Changelog

## 0.1.141 — 2026-05-25

### Новое
- feat(storage-migration): авто-миграция `.config/` → `_config/` при запуске
- feat(lint-chat): чтение `_wiki_schema.md`, передача `schema_block` в промпт
- feat(lint): слияние assess+fix в единый CoT+Structured вызов; прогресс по страницам в UI
- feat(ingest): обогащение лога — СОЗДАНА/ОБНОВЛЕНА, status transitions
- feat(schemas): WikiPageSchema, WikiPagesOutputSchema, LintOutputSchema, FormatOutputSchema
- feat(wiki-index): перезапись в сгруппированный Markdown; путь и wikilink в записях `_index.md`
- feat(view): кнопки Open `_log` / Open `_index` в строке домена
- feat(view): сохранение/восстановление последнего выбранного домена
- feat(view): кнопка повтора запроса в истории
- feat(view): live-status секция; таймлейблы шагов; индикатор ожидания; copy-to-clipboard
- feat(view): auto-collapse секции Progress после завершения операции
- feat(consent): lazy ShellConsentModal + миграция `shellConsentGiven` из `data.json` в `local.json`
- feat(reinit): показ количества файлов вики в диалоге подтверждения
- feat: IngestScopeModal, ManageSourcesModal, addSourceBtn / openManageSources
- feat: ensureDomainConfig — создание `.config/`, миграция legacy index/log
- feat: перемещение `_domain.json`, `agent.jsonl`, `dev.jsonl` в `!Wiki/.config/`
- feat(security): ShellConsentModal и guard операций (F-2c)

### Исправления
- fix(i18n): путь `agent.jsonl` → `_config/` во всех локалях
- fix(vault-tools): fallback `adapter.write` для скрытых директорий; рекурсивный mkdir
- fix(view): таймлейблы шагов с правым выравниванием; capture chatBubble перед async render
- fix(security): validateIclaudePath, fs.access probe, folder-scoped collectMdInPaths
- fix(lint): дедупликация dead-link отчётов по файлу
- fix(ingest): отклонение системных файлов из LLM-вывода
- fix: замена `wiki_keywords` → `tags` в промптах и схемах

### Прочее
- refactor(wiki-path): переименование `.config/` → `_config/`, глобальные константы
- refactor: удаление `query-save` из всех слоёв (agent-runner, controller, view, command)
- refactor: extract vault-walk utilities в `src/utils/vault-walk.ts`
- refactor(consent): ShellConsentModal без прямой зависимости от plugin

---

## 0.1.108 — 2026-05-18

### Новое
- feat(index): parseIndexAnnotations + upsertIndexAnnotation — хранение аннотаций в индексе
- feat(seeds): skip frontmatter, add wiki_keywords + annotation scoring
- feat(prompts): add wiki_keywords + annotation to ingest/lint/init prompts
- feat(query): pass indexAnnotations to selectSeeds, simplify LLM seed prompt
- feat(ingest): upsertIndexAnnotation per page, parseJsonPages includes annotation
- feat(lint): upsertIndexAnnotation per fixed page
- feat(lint-chat): implement runLintFixChat phase — интерактивный чат-режим lint
- feat(types): add lint-chat WikiOperation
- feat(settings): add effort dropdown + thinkingBudgetTokens for claude/native-agent
- feat(settings): add availability check buttons for claude-agent and native-agent
- feat(claude-cli-client): add effort field, pass --effort arg to iclaude.sh
- feat(controller): resolve per-op effort; add lintApplyFromChat dispatch route
- feat(view): route lint chat submissions through lintApplyFromChat

### Исправления
- fix(query): recall-based seeds, strip thinking params for seedLLM, cap context pages
- fix(query): add Read/SelectSeeds progress events and signal checks before blocking ops
- fix(controller): add timeout abort and surface error on silent abort in dispatch
- fix(mobile): AbortSignal via Promise.race in mobileFetch
- fix(lint): return markdown analysis instead of JSON in lint report
- fix(lint-chat): handle possibly-undefined pages from Zod inference
- fix(view): show elapsed time in progress after operation completes
- fix(settings): show agentLog toggle on mobile
- fix(review): normalize chat opKey, static child_process import, expose global effort

### Прочее
- refactor(agent-runner): plumb seedTopK/seedMinScore into runQuery

---
