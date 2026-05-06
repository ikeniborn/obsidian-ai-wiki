---
wiki_sources: ["src/domain-map.ts"]
wiki_updated: 2026-05-06
wiki_status: developing
wiki_outgoing_links:
  - "[[domain-entry]]"
  - "[[entity-type]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["domain-map.ts", "DomainEntry", "EntityType", "validateDomainId"]
---
# domain-map.ts

Типы и валидация для конфигурации доменов wiki. Содержит интерфейсы `DomainEntry`, `EntityType`, `AddDomainInput` и функцию `validateDomainId`.

## Основные характеристики

- **Расположение:** `src/domain-map.ts`
- **Экспорты:** `DomainEntry`, `EntityType`, `AddDomainInput`, `validateDomainId()`

### DomainEntry

```typescript
interface DomainEntry {
  id: string;           // kebab-case идентификатор
  name: string;         // человекочитаемое название
  wiki_folder: string;  // vault-relative путь к wiki-папке домена
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

Возвращает `null` при валидном id или строку с ошибкой. Допускает только буквы Unicode, цифры, `_`, `-`.

### AddDomainInput

Входные данные формы добавления домена. Поле `wikiFolder` — vault-relative путь (по умолчанию `!Wiki/<id>`).

## Связанные концепции

- [[domain-entry]] — основной тип конфигурации домена
- [[entity-type]] — описание типа извлекаемых сущностей
