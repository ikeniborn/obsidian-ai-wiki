---
wiki_sources: ["src/domain-map.ts"]
wiki_updated: 2026-05-06
wiki_status: stub
wiki_outgoing_links:
  - "[[domain-map-ts]]"
  - "[[entity-type]]"
  - "[[llm-wiki-plugin-settings]]"
tags: ["implementation", "typescript", "obsidian-llm-wiki"]
aliases: ["DomainEntry"]
---
# DomainEntry

TypeScript-интерфейс конфигурации одного домена wiki. Хранится в массиве `settings.domains` и является центральной структурой данных всего плагина.

## Определение

```typescript
interface DomainEntry {
  id: string;              // kebab-case идентификатор (напр. "ии", "ростелеком")
  name: string;            // человекочитаемое название
  wiki_folder: string;     // vault-relative путь к wiki-папке домена
  source_paths?: string[]; // пути к источникам (папки с raw-заметками)
  entity_types?: EntityType[];    // типы извлекаемых сущностей
  language_notes?: string; // языковые подсказки для LLM (напр. "русский язык")
}
```

## Применение

`DomainEntry` используется во всех фазовых функциях (`runIngest`, `runQuery`, `runLint`, `runFix`, `runInit`) как параметр конфигурации. `WikiController` передаёт нужные домены из `plugin.settings.domains`.

Поле `id` валидируется через `validateDomainId()` — допускает только буквы Unicode, цифры, `_`, `-`.

## Связанные концепции

- [[domain-map-ts]] — модуль, определяющий этот интерфейс
- [[entity-type]] — тип элементов массива `entity_types`
- [[llm-wiki-plugin-settings]] — содержит массив `domains: DomainEntry[]`
