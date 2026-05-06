---
wiki_sources: [docs/superpowers/plans/2026-05-05-source-path-auto-add.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [consolidate-source-paths, автодобавление-путей]
---
# Source Path Auto-Add с Consolidation

Фича обновляет логику автодобавления `source_paths`: при ingest добавляется прямой родитель файла, а более глубокие уже существующие пути заменяются новым предком.

## Основные характеристики

- Новый файл `src/source-paths.ts` с чистой функцией `consolidateSourcePaths(existing, newPath, vaultRoot)`
- `extractTopLevelSourcePath` → `extractParentSourcePath(absSource, vaultRoot)`: возвращает vault-relative путь прямого родителя
- Верхняя граница clamping: нельзя выйти выше vault root (возвращается `"./"`  )
- `controller.ts` заменяет простой `push` на вызов `consolidateSourcePaths`

## Алгоритм consolidateSourcePaths

1. Если `newPath` уже покрыт существующим предком → возвращает список без изменений
2. Удаляет из списка пути, которые являются потомками `newPath`
3. Добавляет `newPath`

```typescript
// Пример:
consolidateSourcePaths(["notes/sub/", "docs/"], "notes/", "/vault")
// → ["docs/", "notes/"]   (notes/sub/ заменена на notes/)
```

## VaultTools getter

`src/vault-tools.ts` получает getter `vaultRoot: string` — возвращает `this.basePath`.
