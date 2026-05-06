---
wiki_sources:
  - "docs/superpowers/specs/2026-04-30-domain-map-in-vault-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - pattern
  - architecture
  - events
aliases:
  - "domain_created RunEvent"
  - "Event-Driven Domain Persistence"
---

# domain_created Event (паттерн сохранения через события)

Паттерн для сохранения данных из фаз через RunEvent поток в контроллер. Фаза не вызывает файловый I/O напрямую — вместо этого выдаёт `{ kind: "domain_created", entry }`, контроллер перехватывает и сохраняет через `saveSettings()`.

## Основные характеристики

- **Назначение**: разделить фазовую логику (LLM-вызовы) от персистентности (Obsidian API `saveData`)
- **Применение**: `init.ts` при создании нового домена заменяет `addDomain()` на `yield { kind: "domain_created", entry }`
- **Контроллер**: в `dispatch()` — `if (ev.kind === "domain_created") { settings.domains.push(ev.entry); void saveSettings(); }`
- **Трио событий**: перед `domain_created` фаза выдаёт `{ kind: "tool_use", name: "SaveDomain" }` и после — `{ kind: "tool_result", ok: true }` для согласованности потока
- **Преимущества**: фаза тестируется без моков Obsidian API; контроллер управляет всей персистентностью централизованно

## Связанные концепции

- [[domain-map-in-vault]]
- [[agent-runner-ts]]
