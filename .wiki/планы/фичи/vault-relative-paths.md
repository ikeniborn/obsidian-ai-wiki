---
wiki_sources: [docs/superpowers/plans/2026-05-05-vault-relative-paths.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [vault-relative, repo-root-removal]
---
# Vault-Relative Paths

Масштабный рефакторинг: замена `repoRoot`-relative путей на vault-relative во всём кодовой базе. Единственная точка привязки — `vaultRoot = app.vault.adapter.getBasePath()`.

## Основные характеристики

- `wiki_folder` и `source_paths` в `DomainEntry` хранятся как vault-relative строки (например, `"!Wiki/ии"`, `"notes/ai/"`)
- Параметр `repoRoot` удаляется из всех phase-функций, заменяется на `vaultRoot`
- `controller.ts`: вычисление `repoRoot` через `vaultSuffix` стрипинг → просто `vaultBasePath`
- `registerDomain()` убирает добавление `vaults/<vaultName>/` prefix к `wiki_folder`
- `runInit()` нормализует `wiki_folder` из LLM-ответа: стрипает `vaults/<vaultName>/` если присутствует

## Затронутые файлы (12)

`src/source-paths.ts`, `src/phases/ingest.ts`, `src/phases/query.ts`, `src/phases/lint.ts`, `src/phases/fix.ts`, `src/phases/init.ts`, `src/agent-runner.ts`, `src/controller.ts`, `src/view.ts`, `src/domain-map.ts`, и соответствующие тесты.

## Инвариант после рефакторинга

```bash
grep -r "repoRoot" src/   # ожидается: пустой вывод
```

`view.ts` — вычисление `wikiRoot`:
```typescript
// Было:
const vaultPrefix = `vaults/${vaultName}/`;
const rel = sample.startsWith(vaultPrefix) ? sample.slice(vaultPrefix.length) : sample;
// Стало:
const sample = domains[0]?.wiki_folder ?? "!Wiki/x";
return sample.replace(/\/[^/]+$/, "") || "!Wiki";
```
