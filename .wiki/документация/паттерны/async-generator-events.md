---
wiki_status: mature
wiki_sources:
  - docs/architecture/README.md
  - docs/architecture/overview.yaml
wiki_updated: 2026-05-13
wiki_domain: документация
tags: [паттерн, async, generator, event-driven]
---

# AsyncGenerator Event Stream

Операции возвращают `AsyncGenerator<RunEvent>`. Это позволяет передавать события в реальном времени в UI без колбэков и SharedState.

## Принцип

Каждая фаза (`src/phases/*.ts`) — чистый AsyncGenerator:

```ts
export async function* runIngest(
  args: string[], vaultTools: VaultTools, llm: LlmClient,
  model: string, domains: DomainEntry[], vaultRoot: string,
  signal: AbortSignal, opts: LlmCallOptions
): AsyncGenerator<RunEvent> {
  // ...
  yield { kind: "assistant_text", delta: "..." };
  // ...
  yield { kind: "result", durationMs: ..., text: ... };
}
```

`AgentRunner.run()` делегирует `yield*` в нужную фазу. `WikiController` итерирует генератор через `for await` и передаёт каждый `RunEvent` в `View.appendEvent()`.

## Типы RunEvent

| kind | Содержимое |
|---|---|
| `assistant_text` | `{ delta: string; isReasoning?: boolean }` |
| `result` | `{ durationMs: number; text: string; isError?: boolean }` |
| `error` | `{ message: string }` |
| `domain_created` | `{ entry: DomainEntry }` |
| `source_path_added` | `{ domainId: string; paths: string[] }` |
| `format_preview` | `{ tempPath: string; report: string; missingTokens: string[] }` |
| `format_applied` | `{ path: string }` |
| `format_cancelled` | `{}` |

## Нет глобального состояния

Фазы не имеют мутируемого состояния модуля. Все данные передаются через параметры. Это позволяет легко тестировать — фаза = чистая функция с side effects через `vaultTools`.

## Связанные страницы

- [[agent-runner]]
- [[поток-выполнения-операции]]
