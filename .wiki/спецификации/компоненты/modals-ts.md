---
wiki_sources:
  - "docs/superpowers/specs/2026-04-27-interactive-mode-design.md"
  - "docs/superpowers/specs/2026-04-27-multi-vault-domain-maps-design.md"
  - "docs/superpowers/specs/2026-04-30-domain-map-in-vault-design.md"
  - "docs/superpowers/specs/2026-05-05-domain-form-ux-design.md"
  - "docs/superpowers/specs/2026-05-05-domain-populate-design.md"
wiki_updated: 2026-05-05
wiki_status: developing
tags:
  - specs
  - component
  - typescript
  - ui
aliases:
  - "WikiQuestionModal"
  - "EditDomainModal"
  - "src/modals.ts"
---

# src/modals.ts

Obsidian Modal компоненты плагина: диалоговые окна для взаимодействия с пользователем.

## Ключевые изменения по спекам

- **`WikiQuestionModal`** (Interactive Mode): вопрос с вариантами-кнопками или текстовым полем; resolve через выбор, reject через Отмену → SIGTERM
- **`DomainModal`** (Multi-Vault): принимает `domains: DomainEntry[]` динамически вместо хардкода; при пустом списке — текстовый input с подсказкой
- **`AddDomainModal`** (Multi-Vault + Domain Populate): синхронизация `source_paths` с `wiki_folder` через флаг `sourcePathsTouched`; поля для source_paths с `FolderSuggest`; фикс wikiFolder placeholder
- **`EditDomainModal`** (Domain Map in Vault + Domain Form UX): поля name, wiki_folder, source_paths (per-item список с `[×]`), entity_types (карточки + JSON fallback), language_notes (textarea)
- **`ConfirmModal`** (Domain Populate): диалог ошибки при обработке файла; кнопки Skip/Retry/Stop; `canRetry` управляет видимостью Retry
- **`FileErrorModal`**: Promise-based; `waitForClose()` → `'skip' | 'retry' | 'stop'`

## Связанные концепции

- [[interactive-mode]]
- [[domain-form-ux]]
- [[domain-populate]]
- [[domain-map-in-vault]]
