---
wiki_status: developing
wiki_sources:
  - "[[src/wiki-log.ts]]"
  - "[[docs/superpowers/specs/2026-05-20-wiki-config-schema-log-index-design.md]]"
wiki_updated: 2026-05-20
wiki_domain: документация
wiki_keywords: [wiki-log, appendWikiLog, LogOperation, IngestLogEntry, lог, инgest, lint, fix]
tags: [компонент, wiki-log, logging]
---

# wiki-log

Shared модуль для append-only логирования wiki-операций в per-domain `_log.md`.

## Назначение

Централизует формирование и запись лог-записей для всех операций (ingest/lint/fix). До `wiki-log.ts` каждая фаза писала лог по-своему; теперь единый модуль обеспечивает консистентный формат.

## API

```typescript
export interface IngestLogEntry {
  path: string;
  action: "СОЗДАНА" | "ОБНОВЛЕНА";
  statusFrom?: string;   // undefined когда СОЗДАНА
  statusTo: string;
}

export type LogOperation =
  | { op: "ingest"; sourcePath: string; entries: IngestLogEntry[]; outputTokens: number }
  | { op: "lint";   domainId: string;  fixed: string[]; checkedCount: number; outputTokens: number }
  | { op: "fix";    filePath: string;  fixed: string[]; outputTokens: number };

export async function appendWikiLog(
  vaultTools: VaultTools,
  logPath: string,       // абсолютный path к лог-файлу домена: wikiDomainPath + "/_log.md"
  domainId: string,
  event: LogOperation,
): Promise<void>
```

## Формат записей

### ingest

```markdown
## 2026-05-20T14:32:00 — ingest — документация
**Источник:** docs/spec.md
**Токены:** 1247

- СОЗДАНА: компоненты/wiki-controller.md (stub)
- ОБНОВЛЕНА: операции/ingest-operation.md (stub→developing)

---
```

### lint

```markdown
## 2026-05-20T14:35:00 — lint — документация
**Токены:** 892
**Проверено:** 12 | **Исправлено:** 3

- ИСПРАВЛЕНА: компоненты/wiki-controller.md

---
```

## Как используется

- `ingest.ts` — после записи wiki-страниц вызывает `appendWikiLog` с `op: "ingest"` и массивом `IngestLogEntry`
- `lint.ts` — после исправления страниц вызывает с `op: "lint"` и счётчиком `checkedCount`
- Вызовы обёрнуты в `try/catch` — ошибки лога не критичны для основного потока

## Источник СОЗДАНА/ОБНОВЛЕНА

`ingest.ts` читает текущий контент страницы перед записью (`vaultTools.read(path)`):
- Throws → страница новая → `action: "СОЗДАНА"`
- Ok → страница существует → `action: "ОБНОВЛЕНА"`, парсится `wiki_status` из старого frontmatter

## История изменений

- **2026-05-20** — создан по [[wiki-config-schema-log-index-design]].

## Связанные страницы

- [[wiki-config-schema-log-index-design]]
- [[wiki-index]]
- [[ingest-operation]]
- [[lint-operation]]
