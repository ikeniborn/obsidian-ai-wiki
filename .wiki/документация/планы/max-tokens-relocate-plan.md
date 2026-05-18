---
wiki_status: mature
wiki_sources:
  - docs/superpowers/plans/2026-05-15-max-tokens-relocate-numctx-drop.md
wiki_updated: 2026-05-15
wiki_domain: документация
wiki_outgoing_links:
  - "[[max-tokens-relocate-design]]"
  - "[[agent-runner]]"
tags: [план, schema-v3, max-tokens, num-ctx, миграция, tdd]
aliases: ["max_tokens relocate plan", "schema v3 plan"]
---

# План: max_tokens Relocate + numCtx Drop

TDD-декомпозиция реализации Schema v3: перенос `maxTokens` в `nativeAgent.maxTokens` и удаление `numCtx`. Спека — [[max-tokens-relocate-design]].

## Цель

`LlmWikiPluginSettings.maxTokens` (top-level) → `nativeAgent.maxTokens` (native-only); `nativeAgent.numCtx` / `LlmCallOptions.numCtx` / `params.num_ctx` удалены. UI-поле "Max tokens" перемещается под "Model" в Backend-секции (native, non-perOperation).

## File Map

| Действие | Файл | Что меняется |
|---|---|---|
| Modify | `src/types.ts` | drop top `maxTokens` + `LlmCallOptions.numCtx`; add `nativeAgent.maxTokens`; update `DEFAULT_SETTINGS` |
| Modify | `src/local-config.ts` | drop `nativeAgent.numCtx`; silent cleanup в `load()` |
| Modify | `src/phases/llm-utils.ts` | удалить `num_ctx` из `buildChatParams` |
| Modify | `src/agent-runner.ts` | `buildOptsFor` native: `na.maxTokens`, без `numCtx` |
| Modify | `src/i18n.ts` | удалить `numCtx_name`/`numCtx_desc` из en/ru/es |
| Modify | `src/settings.ts` | убрать General `maxTokens` и `numCtx` UI; добавить "Max tokens" под "Model" |
| Modify | `src/main.ts` | v2 → v3 миграция; drop `numCtx` в `migrateToLocalV1` |
| Modify | `tests/effective-settings.test.ts` | drop `numCtx` из fixture |
| Modify | `tests/main-migration.test.ts` | drop `numCtx` из fixture |
| Create | `tests/max-tokens-migration.test.ts` | 5 кейсов миграции schema v3 |
| Modify | `package.json`, `src/manifest.json` | bump `0.1.99 → 0.1.100` |

## Последовательность задач (9)

1. **Update Types** — `src/types.ts`: интерфейсы и `DEFAULT_SETTINGS`. Ожидаемо ломает `tsc --noEmit` в зависимых файлах (фиксится в task 2-7).
2. **Update local-config** — типы + silent drop `numCtx` в `load()`.
3. **Update llm-utils** — удалить `num_ctx` plumbing в `buildChatParams`.
4. **Update agent-runner** — `buildOptsFor`: `na.maxTokens`, удалить `numCtx`.
5. **Remove numCtx i18n keys** — en/ru/es; верификация `grep -n "numCtx" src/i18n.ts` пустой.
6. **Update settings UI** — удалить General `maxTokens` и `numCtx` UI; добавить "Max tokens" под "Model" в native non-perOperation; `patchLocalNative` fallback без `numCtx`.
7. **Schema v3 migration в main.ts** — TDD: сначала `tests/max-tokens-migration.test.ts` (5 кейсов), затем замена v2-блока + `migrateToLocalV1` без `numCtx`. Флаг `schemaV3Dirty` подключается к финальному `saveData`.
8. **Update existing tests** — `effective-settings.test.ts` и `main-migration.test.ts`: drop `numCtx`.
9. **Version bump + build** — `0.1.99 → 0.1.100` в `package.json` и `src/manifest.json`; `npm run build`; финальная верификация: пустые `grep -rn "numCtx\|num_ctx" src/ tests/` и `grep -rn "s\.maxTokens" src/`.

## Final Verification

- `npm run build` — green
- `npm test` — all green
- `npx tsc --noEmit` — без ошибок
- Smoke (dev vault):
  - `data.json` c top-level `maxTokens: 8192` → после load: `nativeAgent.maxTokens === 8192`, top-level отсутствует
  - `data.json` c `nativeAgent.numCtx: 16384` → после load: поле удалено
  - UI: `backend=native`, `perOperation=false` → "Max tokens" под "Model"
  - UI: `backend=claude` → "Max tokens" отсутствует
  - UI: "Context window" / numCtx отсутствует
  - Runtime: native request → `params.max_tokens` присутствует, `params.num_ctx` отсутствует

## Связанные страницы

- [[max-tokens-relocate-design]] — спецификация
- [[agent-runner]] — компонент `buildOptsFor`
