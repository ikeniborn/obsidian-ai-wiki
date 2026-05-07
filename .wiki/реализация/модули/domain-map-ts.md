---
wiki_sources: ["src/domain.ts"]
wiki_updated: 2026-05-07
wiki_status: developing
wiki_outgoing_links:
  - "[[domain-entry]]"
  - "[[entity-type]]"
  - "[[source-paths-ts]]"
  - "[[wiki-controller]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["domain.ts", "DomainEntry", "EntityType", "validateDomainId", "applyDomainEvent"]
---
# domain.ts

Типы и pure-функции для конфигурации доменов wiki. Содержит `DomainEntry`, `EntityType`, `AddDomainInput`, `validateDomainId()`, и pure-reducer `applyDomainEvent()` для применения событий потока к массиву доменов.

> Файл переименован с `domain-map.ts` → `domain.ts`. Хранение карты доменов вынесено в [[domain-store]].

## Основные характеристики

- **Расположение:** `src/domain.ts`
- **Экспорты:** `DomainEntry`, `EntityType`, `AddDomainInput`, `validateDomainId()`, `applyDomainEvent()`

### DomainEntry

```typescript
interface DomainEntry {
  id: string;           // kebab-case
  name: string;
  wiki_folder: string;  // субпапка внутри !Wiki/, например "os" (без префикса !Wiki/)
  source_paths?: string[];
  entity_types?: EntityType[];
  language_notes?: string;
}
```

### EntityType

```typescript
interface EntityType {
  type: string;
  description: string;
  extraction_cues: string[];
  min_mentions_for_page?: number;
  wiki_subfolder?: string;
}
```

### validateDomainId

Возвращает `null` при валидном id или строку с ошибкой. Допускает Unicode-буквы, цифры, `_`, `-`.

### applyDomainEvent(domains, ev, opts?)

Pure reducer. Принимает текущий массив, событие из потока (`domain_created` | `domain_updated` | `source_path_added`), опционально `{ vaultRoot }`. Возвращает новый массив (или ту же ссылку, если изменений нет).

| Событие | Логика |
|---------|--------|
| `domain_created` | Push новой записи; no-op если id уже есть |
| `domain_updated` | Patch entity_types/language_notes по `domainId` |
| `source_path_added` | Если `opts.vaultRoot` задан → `consolidateSourcePaths(existing, ev.path, vaultRoot)` (предок поглощает потомков); иначе — Set-дедуп. |

Возврат той же ссылки = "ничего не изменилось" → `WikiController` пропускает `domainStore.save()`.

### AddDomainInput

```typescript
interface AddDomainInput {
  id: string;
  name: string;
  wikiFolder: string;
  sourcePaths: string[];
}
```

## Связанные концепции

- [[domain-store]] — персистентное хранение массива
- [[domain-entry]] — основной тип
- [[entity-type]] — тип сущности
- [[source-paths-ts]] — `consolidateSourcePaths()` для `vaultRoot`-варианта
- [[wiki-controller]] — потребитель `applyDomainEvent`
