---
wiki_sources: [docs/superpowers/plans/2026-04-28-native-agent.md, docs/superpowers/plans/2026-05-04-wiki-init-root-files.md, docs/superpowers/plans/2026-05-05-source-path-auto-add.md, docs/superpowers/plans/2026-05-05-vault-relative-paths.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [phase-functions, фазы]
---
# src/phases/*.ts (Phase Functions)

Phase-функции реализуют логику отдельных wiki-операций как `async function*` генераторы RunEvent. Каждая фаза живёт в отдельном файле.

## Файлы

| Файл | Операция | Основная логика |
|---|---|---|
| `src/phases/ingest.ts` | ingest | Читает source-файл, вызывает LLM, записывает wiki-страницы, эмитирует `source_path_added` |
| `src/phases/query.ts` | query / query-save | Читает wiki-страницы домена, отвечает на вопрос LLM, опционально сохраняет ответ |
| `src/phases/lint.ts` | lint | Проверяет wiki-страницы, вызывает LLM дважды (отчёт + config), эмитирует `domain_updated` |
| `src/phases/fix.ts` | fix | Применяет исправления из lint-отчёта к отдельным страницам |
| `src/phases/init.ts` | init | Инициализирует домен, создаёт корневые файлы wiki, эмитирует `domain_created` |
| `src/phases/chat.ts` | chat | Обеспечивает чат-диалог с LLM на основе контекста операции |

## Сигнатура (unified после vault-relative рефакторинга)

```typescript
export async function* runIngest(
  args: string[],
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,      // vault-relative, не repoRoot
  signal: AbortSignal,
  opts?: LlmCallOptions,
): AsyncGenerator<RunEvent>
```

## Эволюция init.ts

`runInit` дополнен `ensureRootFiles(vaultTools, wikiRoot)` — создаёт `_schema.md`, `_index.md`, `_log.md` если отсутствуют. Шаблон `_schema.md` встраивается через esbuild text-loader.
