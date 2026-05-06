---
wiki_sources: ["tests/", "vitest.config.ts", "vitest.mock.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[vault-tools]]"
  - "[[llm-client]]"
  - "[[run-event]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["vitest", "тестирование", "mock infrastructure"]
---
# Vitest инфраструктура тестирования

Тестовая инфраструктура проекта: Vitest как test runner, моки Obsidian API и общие паттерны для тестирования фазовых функций.

## Основные характеристики

- **Test runner:** Vitest (one-shot через `npm test`, watch через `npm run test:watch`)
- **Конфигурация:** `vitest.config.ts`
- **Obsidian API mock:** `vitest.mock.ts` — глобальный mock, автоматически подключаемый

### Структура тестов

```
tests/
├── stream.test.ts           # parseStreamLine() + fixture JSONL
├── domain-map.test.ts       # validateDomainId()
├── source-paths.test.ts     # consolidateSourcePaths()
├── vault-tools.test.ts      # VaultTools
├── modals.test.ts           # Modal компоненты
├── claude-cli-client.test.ts
├── agent-runner.integration.test.ts
├── phases/
│   ├── ingest.test.ts
│   ├── init.test.ts
│   ├── lint.test.ts
│   └── query.test.ts
└── fixtures/
    ├── stream-ingest.jsonl  # эталонный JSONL для stream-тестов
    └── mock-iclaude.sh      # bash-mock для integration-тестов
```

### Паттерн mockAdapter

Стандартный способ создания VaultAdapter для тестов:

```typescript
function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
```

### Паттерн makeLlm

```typescript
function makeLlm(responseText: string): LlmClient {
  const fakeStream = {
    [Symbol.asyncIterator]: async function* () {
      yield { choices: [{ delta: { content: responseText } }] };
    },
  };
  return { chat: { completions: { create: vi.fn().mockResolvedValue(fakeStream) } } } as unknown as LlmClient;
}
```

### Паттерн collect

```typescript
async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}
```

Применяется во всех тестах фазовых функций для сбора событий из AsyncGenerator.

### Fixtures

- **stream-ingest.jsonl** — эталонный поток событий iclaude для проверки `parseStreamLine()`
- **mock-iclaude.sh** — bash-скрипт, воспроизводящий JSONL с задержкой для integration-тестов `AgentRunner`

## Связанные концепции

- [[vault-tools]] — мокируется через mockAdapter в тестах фаз
- [[llm-client]] — мокируется через makeLlm
