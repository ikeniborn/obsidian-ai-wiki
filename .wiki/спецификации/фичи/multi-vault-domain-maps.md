---
wiki_sources:
  - "docs/superpowers/specs/2026-04-27-multi-vault-domain-maps-design.md"
wiki_updated: 2026-05-05
wiki_status: stub
tags:
  - specs
  - design
  - domain-map
aliases:
  - "Vault-specific domain maps"
  - "Мульти-волт"
---

# Multi-Vault Domain Maps (Vault-специфичные карты доменов)

Фича решает три проблемы: отсутствие `source_paths` при создании домена, смешение доменов разных волтов в одном файле, и хардкод конкретных доменов в коде. Подход A — минимальные изменения с раздельными файлами по маске `domain-map-<vaultName>.json`.

## Основные характеристики

- **Vault-specific файлы**: каждый волт получает `shared/domain-map-<vaultName>.json`; имя волта из `app.vault.getName()`
- **Auto-create**: если файл для волта не существует, `addDomain` создаёт минимальную структуру с `vault`, `wiki_root`, `domains: []`
- **Source paths default**: при создании домена `source_paths` автоматически заполняется значением `wiki_folder`; флаг `sourcePathsTouched` предотвращает перезапись при ручном вводе
- **Dynamic domain list**: `WikiDomain` тип меняется с `"ии" | "ростелеком" | "базы-данных"` на `string`; `DomainModal` получает список доменов динамически через `controller.loadDomains()`

## Затронутые файлы

| Файл | Изменение |
|---|---|
| `src/domain-map.ts` | `domainMapPath(skillPath, vaultName)`, auto-create |
| `src/types.ts` | `WikiDomain = string` |
| `src/controller.ts` | Передача `app.vault.getName()` в domain-map функции |
| `src/modals.ts` | `DomainModal` принимает `domains: DomainEntry[]`; sync `source_paths` |
| `src/main.ts` | Обновление вызовов `DomainModal` |

## Связанные концепции

- [[domain-map-in-vault]]
- [[vault-relative-paths]]
