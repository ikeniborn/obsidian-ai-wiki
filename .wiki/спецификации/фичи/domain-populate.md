---
wiki_sources:
  - "docs/superpowers/specs/2026-05-05-domain-populate-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - populate
  - ingest
aliases:
  - "runPopulate"
  - "Source Path Auto-Add"
---

# Domain Populate (наполнение домена при создании)

Добавляет автоматическое наполнение домена (bulk ingest всех файлов + lint) сразу после его создания. Форма `AddDomainModal` расширяется полями для папок-источников с FolderSuggest. Новая фаза `runPopulate` обрабатывает файлы пакетно с обработкой ошибок через диалоговое окно.

## Основные характеристики

- **Форма AddDomainModal**: поля для source_paths с `FolderSuggest` (autocomplete из `app.vault.getAllFolders()`); кнопка «+ Добавить путь»; `[×]` удаляет
- **Флоу после создания**: если source_paths пустой → `controller.init()`; если непустой → `ConfirmModal` с подсчётом файлов → `controller.populate()`
- **`runPopulate`**: glob файлов → emit `populate_start { totalFiles }` → для каждого файла emit `file_start/file_done` → вызов `runIngest` → в конце `runLint`
- **Обработка ошибок**: `OnFileError` callback (skip / retry / stop); `FileErrorModal` — модальное окно с тремя кнопками (кнопка Повторить скрыта если `canRetry: false`)
- **Новые RunEvent**: `populate_start { totalFiles }`, `file_start { file, index, total }`, `file_done { file }`
- **Прогресс в UI**: прогресс-бар `████░░  17 / 47 файлов` + текущий файл
- **Single-flight**: не нарушается — populate одна операция

## Фикс wikiFolder placeholder

`AddDomainModal` плейсхолдер показывает `!Wiki/id` (vault-relative), а не `vaults/work/!Wiki/id`.

## Связанные концепции

- [[domain-map-in-vault]]
- [[vault-relative-paths]]
- [[modals-ts]]
- [[agent-runner-ts]]
