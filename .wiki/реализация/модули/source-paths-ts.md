---
wiki_sources: ["src/source-paths.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links: []
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["source-paths.ts", "consolidateSourcePaths"]
---
# source-paths.ts (consolidateSourcePaths)

Утилита консолидации source_paths при добавлении нового пути в домен. Реализует паттерн покрытия: если новый путь уже покрыт существующим предком — ничего не меняется; если новый путь является предком существующих — они удаляются как избыточные.

## Основные характеристики

- **Расположение:** `src/source-paths.ts`
- **Экспорт:** `consolidateSourcePaths(existing, newPath, vaultRoot): string[]`

### Алгоритм

```
normed(p) = toAbs(p) + "/"   // нормализация: абсолютный путь + trailing slash

1. Если newNormed покрыт существующим предком → вернуть existing без изменений
2. Отфильтровать existing: убрать пути, которые начинаются с newNormed (они стали избыточны)
3. Добавить newPath
```

Относительные пути (`isAbsolute(p)` = false) разворачиваются через `join(vaultRoot, p)` перед сравнением, но хранятся в исходном виде.

### Примеры

| existing | newPath | Результат |
|---------|---------|---------|
| `["src/"]` | `"src/phases/"` | `["src/"]` (уже покрыт) |
| `["src/phases/"]` | `"src/"` | `["src/"]` (заменяет более узкий путь) |
| `["docs/", "tests/"]` | `"src/"` | `["docs/", "tests/", "src/"]` |

## Применение

Вызывается при автодобавлении source_path после успешного ingest (`source_path_added` event). Гарантирует, что список source_paths остаётся минимальным и не содержит избыточных записей.
