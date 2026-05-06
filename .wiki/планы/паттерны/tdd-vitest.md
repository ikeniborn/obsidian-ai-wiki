---
wiki_sources: [docs/superpowers/plans/2026-04-28-native-agent.md, docs/superpowers/plans/2026-05-04-wiki-init-root-files.md, docs/superpowers/plans/2026-05-05-chat-session-resume.md, docs/superpowers/plans/2026-05-05-e2big-fix.md, docs/superpowers/plans/2026-05-05-source-path-auto-add.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [test-driven-development, vitest-tdd]
---
# TDD с Vitest

Все планы реализации следуют TDD-циклу (Red-Green-Refactor). Тесты пишутся до реализации, проверяются через Vitest.

## Основные характеристики

- Тестовый фреймворк: Vitest (одно-разовый и watch-режимы)
- Моки Obsidian API: `vitest.mock.ts` в корне, подключаются автоматически через `vitest.config.ts`
- Тест-файлы: `tests/*.test.ts` (unit) и `tests/phases/*.test.ts` (phase integration)
- Phase-тесты используют `VaultAdapter` mock и `LlmClient` mock (vi.fn())

## Структура падающего теста

Каждый план содержит: Шаг 1 — написать падающий тест, Шаг 2 — запустить и убедиться в FAIL, Шаг 3 — реализовать, Шаг 4 — убедиться в PASS.

## Типичный mock VaultAdapter

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

## Покрытие

| Файл | Что тестируется |
|---|---|
| `tests/stream.test.ts` | `parseStreamLine()` + fixture JSONL |
| `tests/prompt.test.ts` | `buildPrompt()` — кириллица, пробелы, backslash |
| `tests/settings.test.ts` | `autodetectCwd()` walk up |
| `tests/source-paths.test.ts` | `consolidateSourcePaths()` |
| `tests/ingest.test.ts` | `extractParentSourcePath()`, `detectDomain()` |
| `tests/phases/ingest.test.ts` | `runIngest()` end-to-end |
| `tests/claude-cli-client.test.ts` | spawn args, temp files, --resume |
| `tests/init.test.ts` | `ensureRootFiles()` |
| `tests/modals.test.ts` | `EditDomainModal.handleSave()` |
