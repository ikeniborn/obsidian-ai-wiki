---
wiki_sources: [docs/superpowers/plans/2026-05-04-wiki-init-root-files.md, docs/superpowers/plans/2026-05-04-dev-mode-prompt-management.md]
wiki_updated: 2026-05-05
wiki_status: stub
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [md-text-loader, esbuild-loader]
---
# esbuild Text Loader для .md файлов

Паттерн встраивания `.md` файлов как строк в `main.js` при сборке через esbuild. Используется для шаблонов (`templates/_schema.md`) и промптов (`prompts/*.md`).

## Основные характеристики

- Конфигурация esbuild: `loader: { ".md": "text" }` в `esbuild.config.mjs`
- Vitest требует отдельного плагина (esbuild loader не применяется в Vitest по умолчанию):
  ```typescript
  { name: "md-text", transform(code, id) {
      if (id.endsWith(".md")) return { code: `export default ${JSON.stringify(code)}`, map: null };
  }}
  ```
- TypeScript-декларация `src/md-modules.d.ts`: `declare module "*.md" { const content: string; export default content; }`
- Импорт в TypeScript: `import schemaTemplate from "../../templates/_schema.md"`

## Применение

| Файл | Используется в |
|---|---|
| `templates/_schema.md` | `src/phases/init.ts` (`ensureRootFiles`) |
| `prompts/ingest.md` | `src/phases/ingest.ts` |
| `prompts/query.md` | `src/phases/query.ts` |
| `prompts/lint.md` | `src/phases/lint.ts` |
| `prompts/chat.md` | `src/phases/chat.ts` |
| `prompts/base.md` | `src/llm-utils.ts` (`prependBaseContract`) |
