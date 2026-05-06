---
wiki_sources: [docs/superpowers/plans/2026-05-05-vault-relative-paths.md, docs/superpowers/plans/2026-05-05-source-path-auto-add.md]
wiki_updated: 2026-05-05
wiki_status: developing
tags: [planning, implementation, obsidian-llm-wiki, typescript]
aliases: [vault-relative, path-resolution]
---
# Vault-Relative Path Pattern

Архитектурный паттерн хранения и разрешения путей: все пути (`wiki_folder`, `source_paths`) хранятся относительно vault root, `vaultRoot` — единственная точка привязки.

## Основные характеристики

- `vaultRoot = app.vault.adapter.getBasePath()` — абсолютный путь к vault
- Пути в `DomainEntry` (vault-relative): `"!Wiki/ии"`, `"notes/ai/"`, `"docs/plans/"`
- Разрешение в абсолютный путь: `join(vaultRoot, relativePath)`
- Ни `repoRoot`, ни `vaultSuffix` не используются

## Эволюция

До этого паттерна пути хранились с префиксом `vaults/<VaultName>/` (например, `vaults/Work/!Wiki/ии`), что требовало вычисления `repoRoot` через стрипинг суффикса:

```typescript
// Старый подход (удалён):
const vaultSuffix = `/vaults/${vaultName}`;
const repoRoot = vaultBasePath.endsWith(vaultSuffix)
  ? vaultBasePath.slice(0, vaultBasePath.length - vaultSuffix.length)
  : vaultBasePath;

// Новый подход:
const vaultRoot = app.vault.adapter.getBasePath();
```

## consolidateSourcePaths

Функция `consolidateSourcePaths(existing, newPath, vaultRoot)` работает с vault-relative путями, нормализует через `join(vaultRoot, path)` для сравнения.

## Clamping при extractParentSourcePath

Прямой родитель файла не может быть выше vault root: результат всегда vault-relative с минимумом `"./"`.
