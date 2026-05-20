# Wiki Config: Schema Centralization, Grouped Index, Enriched Log

**Date:** 2026-05-20  
**Status:** Approved  
**Scope:** Config layout, `wiki-index.ts`, `appendLog` in ingest/lint/fix, schema path in format/ingest

---

## Problem

Three independent issues compound into poor observability and fragile config:

1. **Schema files scattered at wiki root** — `!Wiki/_wiki_schema.md` and `!Wiki/_format_schema.md` live alongside domain folders. No dedicated config space.
2. **Index format is machine-only** — flat `pid: [[pid]] path | annotation` lines are unreadable to humans and give LLM weak structural context about existing pages.
3. **Log is too sparse** — current ingest log omits CREATE vs UPDATE distinction, wiki_status transitions, token counts, and non-ingest operations (lint/fix).

---

## Solution

### 1. Config Layout

Move both schema files into `!Wiki/.config/`:

```
!Wiki/.config/
  _wiki_schema.md      ← wiki page conventions (ingest reads this)
  _format_schema.md    ← formatting rules (format reads this)
```

**Auto-create behavior** (preserved from current format.ts):
- On startup, if `.config/_wiki_schema.md` or `.config/_format_schema.md` missing → write from bundled template
- `init` operation explicitly creates `.config/` and both files as first step

**Code changes:**
- `ingest.ts`: `${schemaRoot}/_wiki_schema.md` → `${schemaRoot}/.config/_wiki_schema.md`
- `format.ts`: `${WIKI_ROOT}/_format_schema.md` → `${WIKI_ROOT}/.config/_format_schema.md`
- `init.ts`: scaffold `.config/` with both schema files

---

### 2. Index Format — Grouped Markdown

Per-domain `_index.md` changes from flat key-value to grouped Markdown.

**New format:**
```markdown
# Wiki Index

## компоненты
- [[wiki-controller]] компоненты/wiki-controller.md — WikiController: single-flight guard, валидация cwd
- [[agent-runner]] компоненты/agent-runner.md — AgentRunner: маршрутизация операций, evaluator

## операции
- [[ingest-operation]] операции/ingest-operation.md — Ingest: извлечение сущностей из источника
- [[format-operation]] операции/format-operation.md — Format: приведение страницы к схеме
```

**Format rules:**
- Section header: `## <subfolder-name>` (subfolder within domain folder)
- Entry line: `- [[pid]] subfolder/filename.md — annotation`
- `pid` = filename without `.md`
- Pages directly in domain root (no subfolder) → section `## general`
- Sections sorted by first-write order; entries within section sorted by first-write order

**Migration:** clean break. Existing flat `_index.md` ignored — entries overwritten to new format as ingest runs. No migration script.

**`wiki-index.ts` rewrite:**

`parseIndexAnnotations(content: string): Map<string, string>`
- Parse `## section` headers to track current group
- Parse `- [[pid]] path — annotation` lines → `map.set(pid, annotation)`
- Skip all other lines (title, blank lines)
- Same return type → zero changes to callers (`wiki-seeds.ts`, ingest)

`upsertIndexAnnotation(vaultTools, wikiFolder, pid, annotation, fullPath?): Promise<void>`
- Derive section from `fullPath`: extract subfolder between `wikiFolder/` and filename; fallback `general`
- Find `## <section>` block in content; insert if missing (alphabetical section order not required)
- Within section: replace line matching `[[pid]]`; append if not found
- Write back atomically

---

### 3. Log Format — Enriched, All Operations

All operations append to `!Wiki/<domain>/_log.md`.

#### ingest entry

```markdown
## 2026-05-20T14:32:00 — ingest — документация
**Источник:** docs/superpowers/specs/2026-05-20-foo.md
**Токены:** 1247

- СОЗДАНА: компоненты/wiki-controller.md (stub)
- ОБНОВЛЕНА: операции/ingest-operation.md (stub→developing)
- ОБНОВЛЕНА: компоненты/agent-runner.md (developing)

---
```

#### lint entry

```markdown
## 2026-05-20T14:35:00 — lint — документация
**Токены:** 892
**Проверено:** 12 | **Исправлено:** 3

- ИСПРАВЛЕНА: компоненты/wiki-controller.md
- ИСПРАВЛЕНА: паттерны/single-flight-guard.md
- ИСПРАВЛЕНА: операции/format-operation.md

---
```

#### fix entry

```markdown
## 2026-05-20T14:37:00 — fix — документация
**Файл:** компоненты/wiki-controller.md
**Токены:** 542

- ИСПРАВЛЕНА: компоненты/wiki-controller.md

---
```

**Data sources:**

| Field | Source |
|---|---|
| СОЗДАНА vs ОБНОВЛЕНА | `vaultTools.read(path)` before write: throws → СОЗДАНА, else ОБНОВЛЕНА |
| `stub→developing` | Parse `wiki_status` from old frontmatter before write; read from new content after write |
| Токены | `outputTokens` from `result` event |
| Проверено/Исправлено | Existing lint counters |

**`appendLog` extracted to `src/wiki-log.ts`** (new shared module):

```typescript
type LogOperation =
  | { op: "ingest"; sourcePath: string; entries: IngestLogEntry[]; outputTokens: number }
  | { op: "lint";   domainId: string;  fixed: string[]; checkedCount: number; outputTokens: number }
  | { op: "fix";    filePath: string;  fixed: string[]; outputTokens: number };

interface IngestLogEntry {
  path: string;
  action: "СОЗДАНА" | "ОБНОВЛЕНА";
  statusFrom?: string;   // undefined when СОЗДАНА
  statusTo: string;
}

export async function appendWikiLog(
  vaultTools: VaultTools,
  logPath: string,       // absolute: wikiVaultPath + "/_log.md"
  domainId: string,
  event: LogOperation,
): Promise<void>
```

`ingest.ts`, `lint.ts`, `fix.ts` each call `appendWikiLog` with their respective `LogOperation` variant.

---

## Affected Files

| File | Change |
|---|---|
| `src/wiki-log.ts` | New shared module: `appendWikiLog`, log format builders |
| `src/phases/ingest.ts` | Schema path, call `appendWikiLog`, detect СОЗДАНА/ОБНОВЛЕНА + status |
| `src/phases/format.ts` | Schema path `.config/_format_schema.md` |
| `src/phases/init.ts` | Scaffold `.config/` + both schema files |
| `src/phases/lint.ts` | Call `appendWikiLog` with lint variant |
| `src/phases/fix.ts` | Call `appendWikiLog` with fix variant |
| `src/wiki-index.ts` | Full rewrite: grouped Markdown parser + writer |

---

## Out of Scope

- ПРОПУЩЕНА tracking in ingest (requires `WikiPagesOutputSchema` change — separate task)
- Cost (`~$X`) in log (requires model price table — separate task)
- Index rebuild command (`init --rebuild-index`)
