---
wiki_status: mature
wiki_sources:
  - docs/superpowers/specs/2026-05-15-max-tokens-relocate-numctx-drop-design.md
wiki_updated: 2026-05-15
wiki_domain: документация
wiki_outgoing_links:
  - "[[agent-runner]]"
  - "[[claude-agent-backend-design]]"
  - "[[max-tokens-relocate-plan]]"
tags: [спецификация, settings, schema-v3, max-tokens, num-ctx, миграция, native-agent]
aliases: ["max_tokens relocate", "numCtx drop", "schema v3 maxTokens"]
---

# max_tokens перенос + numCtx удаление (schema v3)

Спецификация Schema v3: top-level `LlmWikiPluginSettings.maxTokens` переезжает в `nativeAgent.maxTokens` (native-only), а `nativeAgent.numCtx` удаляется полностью (Ollama OpenAI-route игнорирует параметр).

## Мотивация

- `s.maxTokens` исторически жил на top-level и шарился между бэкендами. После v0.1.66 Claude Agent его не использует — `iclaude.sh` берёт лимит из env `CLAUDE_CODE_MAX_OUTPUT_TOKENS`. Логически поле — native-only.
- `num_ctx` — нестандартный OpenAI-параметр (Ollama-специфика). Через OpenAI-совместимый endpoint Ollama его игнорирует, UI вводит пользователя в заблуждение.
- UX: `maxTokens` в General-секции отделён от модели. Логичнее показывать его прямо под полем "Model" в Backend-блоке (только native, без per-operation).

## Проверенные факты

| Параметр | Backend | Передаётся? | Источник |
|---|---|---|---|
| `max_tokens` | native-agent | Да | `agent-runner.ts` → `llm-utils.ts:buildChatParams` → `params.max_tokens` |
| `max_tokens` | claude-agent | Нет | omitted в `buildOptsFor`; env `CLAUDE_CODE_MAX_OUTPUT_TOKENS` в iclaude.sh |
| `num_ctx` | native-agent | Передаётся, но Ollama OpenAI-route игнорирует | `params.num_ctx` |
| `num_ctx` | claude-agent | Нет | не передаётся |

## Изменения по файлам

- **`src/types.ts`** — из `LlmCallOptions` убрать `numCtx`; из `LlmWikiPluginSettings` убрать top-level `maxTokens`; из `nativeAgent` убрать `numCtx`, добавить `maxTokens: number`. `DEFAULT_SETTINGS.nativeAgent.maxTokens = 4096`.
- **`src/main.ts`** (миграция) — заменить блок v2 на v3:
  - Schema v2 оставить только для `systemPrompt`.
  - Schema v3: легаси `data.maxTokens` или `claudeAgent.maxTokens` → `nativeAgent.maxTokens` (если последний не задан явно).
  - Силент-удаление top-level `maxTokens` и `nativeAgent.numCtx` через `delete` после spread.
  - Флаг `schemaV3Dirty` включается в общий `if (... || schemaV3Dirty) await this.saveData(this.settings)`.
- **`src/main.ts:migrateToLocalV1`** — убрать `numCtx: s.nativeAgent.numCtx`.
- **`src/local-config.ts`** — из `LocalConfig.nativeAgent` убрать `numCtx`; в `load()` — silent cleanup поля при чтении legacy `local.json`.
- **`src/agent-runner.ts:buildOptsFor`** — в native-ветке: `maxTokens: na.maxTokens` (без per-op) или `c.maxTokens` (per-op); опция `numCtx` удалена.
- **`src/phases/llm-utils.ts:buildChatParams`** — удалить `if (opts.numCtx != null) params.num_ctx = opts.numCtx`.
- **`src/settings.ts`** —
  - удалить General-блок `maxTokens` (~строки 100-112) и UI-блок `numCtx` (~строки 307-319);
  - убрать `numCtx` из fallback в `patchLocalNative`;
  - добавить новый Setting "Max tokens" под "Model" в native non-perOperation ветке. Порядок: Model → Max tokens → Temperature.
- **`src/i18n.ts`** — удалить ключи `numCtx_name`/`numCtx_desc` во всех локалях (en/ru/es). Ключи `maxTokens_*` сохраняются.
- **Тесты:** убрать `numCtx` из `tests/effective-settings.test.ts` и `tests/main-migration.test.ts`; создать `tests/max-tokens-migration.test.ts` — 5 кейсов миграции (top-level → nativeAgent, claudeAgent legacy → nativeAgent, drop nativeAgent.numCtx, default-fallback, preservation of existing).
- **Версия:** `0.1.99 → 0.1.100` (patch). См. [[max-tokens-relocate-plan]].

## Контракт миграции (data.json → settings)

| Вход | Поведение |
|---|---|
| `data.maxTokens: 8192` (top-level) | `nativeAgent.maxTokens = 8192`, top-level удалён |
| `data.claudeAgent.maxTokens: 12000` + top-level отсутствует | `nativeAgent.maxTokens = 12000` |
| `data.nativeAgent.maxTokens: 10000` + top-level `8192` | приоритет у nativeAgent: `10000` |
| `data.nativeAgent.numCtx: 16384` | поле удалено, не сохраняется |
| Пустой объект | `nativeAgent.maxTokens = 4096` (default) |

## Риски

- **Сброс пользовательских настроек.** Если миграция не сработает — пользователь увидит default `4096`. Mitigation: миграция ищет легаси-значения в трёх местах (`data.maxTokens`, `claudeAgent.maxTokens`, `nativeAgent.maxTokens` уже-присутствующее).
- **Stale numCtx в local.json.** Не критично — поле просто игнорируется. Silent drop в `LocalConfigStore.load()`.
- **i18n missing keys.** TypeScript падает при использовании удалённых ключей — это страховка от UI-регрессии.

## Связанные страницы

- [[max-tokens-relocate-plan]] — TDD-реализация (9 задач)
- [[agent-runner]] — `buildOptsFor` native branch
- [[claude-agent-backend-design]] — почему `maxTokens` ушёл из claude-агента
