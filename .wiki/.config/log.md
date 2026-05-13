# Wiki Log

<!-- Append-only лог. Новые записи добавляются в конец. -->

## 2026-05-13 — init документация

**Операция:** init  
**Домен:** документация  
**Источники:** docs/ (8 md, 1 yaml — architecture + superpowers/specs + superpowers/plans)  
**Bootstrap:** entity_types сгенерированы и сохранены (5 типов: компонент, операция, паттерн, спецификация, план)

**Создано страниц:** 12
- документация/компоненты/wiki-controller.md (mature)
- документация/компоненты/agent-runner.md (mature)
- документация/компоненты/claude-cli-client.md (mature)
- документация/компоненты/llm-wiki-view.md (developing)
- документация/операции/format-operation.md (mature)
- документация/операции/поток-выполнения-операции.md (mature)
- документация/паттерны/single-flight-guard.md (mature)
- документация/паттерны/async-generator-events.md (mature)
- документация/паттерны/backend-strategy.md (mature)
- документация/спецификации/agent-base-contract.md (mature)
- документация/спецификации/format-operation-design.md (mature)
- документация/спецификации/claude-agent-backend-design.md (mature)

**Обновлено:** index.md, log.md

**Следующий шаг:** ingest оставшихся specs из docs/superpowers/specs/ и docs/superpowers/plans/ по мере необходимости

## 2026-05-13 — ingest (security: proxy, phases/fix, view)

**Операция:** ingest  
**Домен:** документация  
**Источники:** src/claude-cli-client.ts, src/phases/fix.ts, src/view.ts

**Обновлено страниц:** 2
- документация/компоненты/claude-cli-client.md — актуализирована `ClaudeCliConfig` (удалён `maxTokens`, добавлены `cwd`/`allowedTools`/`tmpDir`/`tmpWrite`/`tmpRemove`/`resumeSessionId`); расширено описание proxy-правила и spawn args
- документация/компоненты/llm-wiki-view.md — добавлен раздел XSS-защиты (`sanitizeLinks`) и `registerLinkHandler`

**Создано страниц:** 1
- документация/операции/fix-operation.md (developing) — описание операции fix с акцентом на path-блокировку (security)

**Обновлено:** index.md, log.md

## 2026-05-13 — ingest audit-fix-design spec + format-token-preservation plan

**Операция:** ingest  
**Домен:** документация  
**Источники:** docs/superpowers/specs/2026-05-13-audit-fix-design.md, docs/superpowers/plans/2026-05-13-format-token-preservation.md

**Создано страниц:** 1
- документация/спецификации/audit-fix-design.md (mature) — spec: 4 ошибки + ~21 предупреждение для Community Plugins (minAppVersion, sentence-case, window APIs, TypeScript any)

**Не создано (уже покрыто):** формат план → format-operation.md уже содержит token-retry и appendMissingLines

**Обновлено:** index.md (спецификации 3→4), log.md

## 2026-05-13 — ingest src/phases/format.ts

**Операция:** ingest  
**Домен:** документация  
**Источник:** src/phases/format.ts

**Обновлено страниц:** 1
- документация/операции/format-operation.md — добавлены: три LLM-вызова (основной / JSON-retry / token-restore), `callOnce()` inner generator (stream + fallback), `extractImagePaths`, `format_schema` загрузка из `!Wiki/_format_schema.md`, исправлен `tempPath` (`<dir>/<basename>` вместо `!Temp/`), `missingTokensWithContext` вместо `missingTokens`, `appendMissingLines` hard fallback, `looksTruncated` проверка до retry

**Обновлено:** log.md

## 2026-05-13 — ingest src/phases/format-utils.ts

**Операция:** ingest  
**Домен:** документация  
**Источник:** src/phases/format-utils.ts

**Создано страниц:** 1
- документация/компоненты/format-utils.md (stub) — публичный API: `FormatResponse`, `MissingToken`, `extractJsonObject`, `looksTruncated`, `significantTokens`, `missingTokens`, `missingTokensWithContext`, `appendMissingLines`; алгоритмы token-extraction и lemmatization; поток использования в runFormat

**Обновлено:** index.md (компоненты 4→5), log.md

## 2026-05-14T00:00:00

**Операция:** ingest
**Источник:** README.md
**Домен:** документация

**Затронуто страниц:** 6

- СОЗДАНА: `документация/операции/ingest-operation.md` (stub) — UX-поток, desktop-only
- СОЗДАНА: `документация/операции/query-operation.md` (stub) — query + query-save, desktop+mobile
- СОЗДАНА: `документация/операции/lint-operation.md` (stub) — проверка качества, desktop-only
- СОЗДАНА: `документация/операции/init-operation.md` (stub) — инициализация домена, desktop-only
- СОЗДАНА: `документация/операции/chat-operation.md` (stub) — интерактивный чат после Lint/Query
- СОЗДАНА: `документация/паттерны/per-device-settings.md` (stub) — local.json для machine-specific путей

**Примечание:** README.md вне source_paths["docs"], обработан по содержимому как документация домена

---
