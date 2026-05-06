---
wiki_sources: ["src/domain-map.ts"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[domain-map-ts]]"
  - "[[domain-entry]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["EntityType"]
---
# EntityType

TypeScript-интерфейс описания типа сущности, извлекаемой при ingest/init. Входит в состав `DomainEntry.entity_types` и определяет, какие понятия LLM должен находить в источниках и превращать в wiki-страницы.

## Определение

```typescript
interface EntityType {
  type: string;                    // kebab-case id типа (напр. "концепция", "инструмент")
  description: string;             // одно предложение, что это за тип
  extraction_cues: string[];       // ключевые слова для поиска сущностей
  min_mentions_for_page?: number;  // мин. упоминаний для CREATE (default: 1)
  wiki_subfolder?: string;         // vault-relative подпапка (напр. "ии/концепции")
}
```

## Применение

`EntityType` используется в промптах `ingest.md` и `init.md` — передаётся LLM как инструкция, какие сущности искать и как их классифицировать. Bootstrap-анализ в `runInit` генерирует черновик `entity_types` автоматически при первом запуске на ненастроенном домене.

## Связанные концепции

- [[domain-map-ts]] — модуль, определяющий этот интерфейс
- [[domain-entry]] — содержит массив `entity_types: EntityType[]`
