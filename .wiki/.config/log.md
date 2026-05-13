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
