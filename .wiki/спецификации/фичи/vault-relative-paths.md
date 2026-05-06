---
wiki_sources:
  - "docs/superpowers/specs/2026-05-05-vault-relative-paths-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - paths
  - vault
aliases:
  - "vaultRoot vs repoRoot"
  - "Vault-Relative Paths"
---

# Vault-Relative Paths (пути относительно vault)

Переход с путей относительно `repoRoot` (родитель `vaults/`) на пути относительно `vaultRoot` (`app.vault.adapter.getBasePath()`). Убирает избыточный префикс `vaults/VaultName/` из `wiki_folder` и `source_paths`, устраняет хрупкую строковую эвристику вычисления `repoRoot`.

## Основные характеристики

- **Проблема**: `wiki_folder: "vaults/Work/!Wiki/ии"` — префикс избыточен; `repoRoot` вычисляется через `vaultBasePath.endsWith("/vaults/${vaultName}")` — ломается при нестандартном расположении
- **Решение**: `wiki_folder: "!Wiki/ии"`, `source_paths: ["notes/ai/"]`; `vaultRoot = app.vault.adapter.getBasePath()`
- **Инвариант**: `DomainEntry.wiki_folder` всегда vault-relative, никогда абсолютный, никогда не начинается с `vaults/`
- **`controller.ts`**: убирается `vaultSuffix` / `repoRoot` вычисление; `cwd: vaultRoot` при запуске агента
- **Все фазы**: `join(repoRoot, ...)` → `join(vaultRoot, ...)`; параметры `repoRoot` переименованы в `vaultRoot`; проверка `isAbsolute` убирается
- **`extractParentSourcePath`**: сигнатура упрощается — параметр `repoRoot` удалён, возвращает vault-relative путь
- **`registerDomain()`**: убирается добавление `vaultPrefix` при сохранении `wiki_folder`
- **`init.ts`**: нормализация LLM-ответа — стрипнуть `vaults/${vaultName}/` если присутствует (защита от старого поведения LLM)

## Связанные концепции

- [[domain-map-in-vault]]
- [[multi-vault-domain-maps]]
