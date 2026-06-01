---
chain:
  intent: null
review:
  spec_hash: null
  last_run: null
  phases:
    structure:   { status: pending }
    coverage:    { status: pending }
    clarity:     { status: pending }
    consistency: { status: pending }
  findings: []
---

# Design: Ingest pipeline fixes — alias prohibition, entity extraction, domain_updated ordering

**Date:** 2026-06-01

## Problem

Three defects found via session log analysis (session `1780335138078`):

### 1. WikiLink alias syntax causes schema_validate failure on every first attempt

`zod-schemas.ts:53` rejects `[[link|alias]]` in wiki page body. The synthesis prompt (`prompts/ingest.md`) has no explicit prohibition, so `deepseek-v4-flash` consistently generates aliases on attempt 0. Every synthesis run for a batch of pages costs one full retry (+34 s in the observed session).

### 2. Entity extraction returns 0 for files that introduce new concept types

`ingest-entities.md` line 9: _"Верни список сущностей, которые встречаются в источнике и **соответствуют ТИПАМ выше**."_

Files whose content doesn't match any known domain entity type (e.g. `Исследования криптовалюты.md`, `Трендовые линии.md`) return 0 entities. Consequences:
- Embedding retrieval runs with 0 entity anchors → `0/N pages retrieved`
- Synthesis runs "blind" — no entity context, no relevant existing pages surfaced
- `entity_types_delta` may still be emitted by synthesis, but too late to inform retrieval
- Domain entity type registry grows inconsistently (new types discovered by synthesis but not by extraction)

### 3. `domain_updated` emitted before source frontmatter write

In `ingest.ts`, the `entity_types_delta` block (line 383–387) emits `domain_updated` before the source frontmatter write (line 440) and `source_path_added` (line 449). In the native-agent log the event order is:
```
DOMAIN_UPD → Update source → source_path_added
```
Expected:
```
Update source → source_path_added → DOMAIN_UPD
```

## Scope

- `prompts/ingest.md` — add alias prohibition rule
- `prompts/ingest-entities.md` — relax entity type constraint
- `src/phases/ingest.ts` — reorder `entity_types_delta` block

No new files. No schema changes. No test changes required (prompt fixes are not unit-tested; ordering fix is observable via log).

## Design

### Fix 1 — Alias prohibition in synthesis prompt

**File:** `prompts/ingest.md`

Add one rule in the ПРАВИЛА block, after the `wiki_outgoing_links` rule:

```
- В теле статей: ТОЛЬКО [[stem]] — никогда [[stem|алиас]]. Синтаксис [[A|B]] запрещён.
```

This prevents the LLM from generating aliased wikilinks before schema validation, eliminating the systematic retryAttempt=0 failure.

### Fix 2 — Entity extraction allows new concept types

**File:** `prompts/ingest-entities.md`

Replace line 9 and surrounding task description:

**Before:**
```
ЗАДАЧА:
- Прочитай источник.
- Верни список сущностей, которые встречаются в источнике и соответствуют ТИПАМ выше.
- Для каждой сущности:
  - name: каноническое имя сущности (без кавычек, как заголовок будущей страницы)
  - type: тип из списка выше (опционально, если не подходит ни один — пропусти)
  - context_snippet: одна фраза из источника, поясняющая зачем сущность нужна (опционально)

Не дублируй: один name → одна запись. Не извлекай сущности с min_mentions_for_page > 1, если они упомянуты только раз.
```

**After:**
```
ЗАДАЧА:
- Прочитай источник.
- Верни все сущности, достойные отдельной wiki-страницы:
  - Если сущность соответствует типу выше → укажи type.
  - Если не соответствует ни одному типу, но концепция значима → верни без type (новый тип, будет определён при синтезе).
  - Не возвращай пустой список, если источник содержит значимые концепции.
- Для каждой сущности:
  - name: каноническое имя сущности (без кавычек, как заголовок будущей страницы)
  - type: тип из списка выше (опционально)
  - context_snippet: одна фраза из источника, поясняющая зачем сущность нужна (опционально)

Не дублируй: один name → одна запись. Не извлекай сущности с min_mentions_for_page > 1, если они упомянуты только раз.
```

**Effect:** Files like `Исследования криптовалюты.md` now return entities (e.g. `CryptoDeveloperActivity` without type). Synthesis receives entity anchors → embedding retrieval surfaces relevant existing pages → `entity_types_delta` enriches domain correctly.

### Fix 3 — `domain_updated` ordering in ingest.ts

**File:** `src/phases/ingest.ts`

Move the `entity_types_delta` block from after `buildIngestSummary` (current line ~383) to after `source_path_added` (current line ~449).

**Before (lines 380–387):**
```typescript
const resultText = buildIngestSummary(...);
yield { kind: "assistant_text", delta: resultText };

const delta = parseResult.value.entity_types_delta;
if (delta?.length) {
  const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
  yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
}

const deletedStems = new Set(...);
if (written.length > 0 || deletedPaths.length > 0) {
  // ... backlink write block ...
  yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
}
```

**After:**
```typescript
const resultText = buildIngestSummary(...);
yield { kind: "assistant_text", delta: resultText };

const deletedStems = new Set(...);
if (written.length > 0 || deletedPaths.length > 0) {
  // ... backlink write block ...
  yield { kind: "source_path_added", domainId: domain.id, path: parentPath };
}

const delta = parseResult.value.entity_types_delta;
if (delta?.length) {
  const merged = mergeEntityTypes(domain.entity_types ?? [], delta);
  yield { kind: "domain_updated", domainId: domain.id, patch: { entity_types: merged } };
}
```

Event order becomes: `Update source` → `source_path_added` → `domain_updated`. Consistent with all other files.

## Out of scope

- 0-entity fallback re-run (redundant — domain init already ran; see analysis)
- Coverage check for stale link removal (separate spec: `source-wiki-articles-stale-link-cleanup-design.md`)
- Retry budget changes for `ingest.entities` callSite
