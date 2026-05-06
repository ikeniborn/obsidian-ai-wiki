---
wiki_sources:
  - "docs/superpowers/specs/2026-05-04-wiki-init-root-files-design.md"
  - "docs/superpowers/specs/2026-05-04-dev-mode-prompt-management-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - pattern
  - build
  - esbuild
aliases:
  - "esbuild text loader"
  - "MD loader plugin"
---

# esbuild MD Loader (встраивание Markdown при сборке)

Паттерн встраивания `.md` файлов как строковых констант в `main.js` через esbuild. Используется для промпт-шаблонов (`prompts/*.md`), шаблона схемы (`templates/_schema.md`), базового контракта (`prompts/base.md`).

## Основные характеристики

- **Конфигурация**: `loader: { ".md": "text" }` в `esbuild.context()` — встроенный механизм
- **Альтернативный вариант**: inline-плагин `md-loader` для `prompts/` директории (перехватывает импорты через `build.onLoad`)
- **TypeScript**: `src/md-modules.d.ts` с `declare module "*.md" { const content: string; export default content; }`
- **Применение**: `import schemaTemplate from "../../templates/_schema.md"` → `schemaTemplate` содержит полный текст файла
- **Преимущества vs TS-строки**: файл редактируется с Markdown подсветкой, версионируется в git, виден в Obsidian; нет generated файлов
- **Runtime**: никакого disk read — контент встроен в bundle на этапе сборки

## Связанные концепции

- [[wiki-init-root-files]]
- [[agent-base-contract]]
- [[dev-mode-prompt-management]]
