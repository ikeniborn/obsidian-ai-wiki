---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [паттерн, concurrency, guard]
---

# Single-Flight Guard

Архитектурное ограничение: одновременно разрешена только одна активная операция. Причина — `iclaude.sh` не реентерабелен; параллельный spawn испортит stdout-поток.

## Реализация

`WikiController` хранит `this.current: AbortController | null`. При `dispatch()`:
- Если `this.current != null` → `isBusy()` возвращает `true` → Notice пользователю, операция отклоняется.
- Иначе → `this.current = new AbortController()`, операция запускается.
- По завершении (успех/ошибка/отмена) → `this.current = null`.

## Прерывание

`AbortController.signal` передаётся в `AgentRunner.run()` и далее в фазы → `llm.chat.completions.create(params, { signal })`. При прерывании:
- `native-agent`: `AbortController` обрывает HTTPS-запрос.
- `claude-agent`: `ClaudeCliClient` получает abort → SIGTERM → 3000ms grace → SIGKILL.

## Связанные страницы

- [[wiki-controller]]
- [[поток-выполнения-операции]]
