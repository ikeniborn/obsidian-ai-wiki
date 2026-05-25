---
title: Embedding UI fix + Ingest progress entity breakdown
date: 2026-05-25
status: approved
review:
  spec_hash: b095cedc581f9fdf
  last_run: 2026-05-25
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: coverage
      severity: WARNING
      section: "Block 1: Toggle fix + UI grouping (`src/settings.ts`)"
      section_hash: 2e639512b0ab83c6
      text: >
        "No changes to `types.ts`" в §Block 1 (строка 34) противоречит §Block 2,
        который добавляет `info_text` в `types.ts`. Формулировка должна уточнять,
        что ограничение относится только к toggle-фиксу.
      verdict: accepted
      verdict_at: 2026-05-25
    - id: F-002
      phase: clarity
      severity: INFO
      section: "Block 2: New `info_text` event kind (`src/types.ts`, `src/view.ts`)"
      section_hash: b2bb6afd9a0239fd
      text: >
        Нет DoD для CSS-класса и HTML-элемента step-item в view.ts.
        Детали рендеринга оставлены на план — допустимо для спеки.
      verdict: wontfix
      verdict_at: 2026-05-25
    - id: F-003
      phase: clarity
      severity: INFO
      section: "Block 3: Entity breakdown in ingest progress (`src/phases/ingest.ts`, `src/phases/init.ts`)"
      section_hash: bb5e2cbff4cc892a
      text: >
        Нет определённого поведения при topK > 15 (длинный список details).
        Спека говорит «entity list is short» как обоснование no-collapsible,
        но не задаёт fallback при большом K.
      verdict: accepted
      verdict_at: 2026-05-25
---

# Embedding UI fix + Ingest progress entity breakdown

## Problem

Three bugs in the embedding settings UI and ingest progress display:

1. **Toggle broken** — enabling "Enable semantic similarity" toggle does nothing. Child fields (embedding model, dimensions) never appear because `embeddingModel` stays `undefined` after toggle ON.
2. **No UI grouping** — toggle and sub-fields are visually disconnected, no section heading.
3. **Similarity step missing** — `ingest.ts` emits a "Relevant pages" message as `assistant_text`, but `view.ts` doesn't render non-reasoning `assistant_text` as a visible step item. The message is lost.

## Solution

### Block 1: Toggle fix + UI grouping (`src/settings.ts`)

**Toggle ON logic:** Set `embeddingModel: ""` (empty string sentinel) so `embeddingModel !== undefined` becomes true and child fields appear. The empty string is falsy, so `buildSimilarity` falls back to jaccard mode until user types a model name — correct behavior.

**Toggle OFF logic:** unchanged — clears `embeddingModel: undefined, embeddingDimensions: undefined`.

**UI grouping:** Add `new Setting(containerEl).setName("Semantic Search").setHeading()` before the toggle. Settings order:

```
[Heading] Semantic Search
[Toggle]  Enable semantic similarity (embeddings)
[Text]    Embedding model            ← only when embeddingModel !== undefined
[Text]    Embedding dimensions       ← only when embeddingModel !== undefined
```

No changes to `types.ts`, `buildSimilarity`, or any settings migration required.

### Block 2: New `info_text` event kind (`src/types.ts`, `src/view.ts`)

Add to `RunEvent` union in `types.ts`:

```typescript
| { kind: "info_text"; icon: string; summary: string; details?: string[] }
```

In `view.ts`, new case in `handleEvent`:
- Create a step-item div
- Head: icon span + summary text + elapsed time
- Body (always visible): `details` list, each item as `· entityName` line
- Increment `stepCount`

### Block 3: Entity breakdown in ingest progress (`src/phases/ingest.ts`, `src/phases/init.ts`)

In `ingest.ts`, replace the `assistant_text` yield after `selectRelevant` with `info_text`:

```typescript
const entityNames = filteredPaths.map(p => pageId(p));
yield {
  kind: "info_text",
  icon: similarity.config.mode === "embedding" ? "🔍" : "📋",
  summary: `${filteredPaths.length}/${existingPaths.length} wiki-pages loaded (${similarity.config.mode})`,
  details: entityNames,
};
```

`init.ts` delegates per-file processing to `runIngest` — no separate `selectRelevant` call. The `info_text` event propagates automatically via `yield* runIngest(...)`. No changes needed in `init.ts`.

Details list is always expanded (no collapsible) — entity list is short (topK ≤ 15 by default).

## Files changed

| File | Change |
|------|--------|
| `src/settings.ts` | Toggle ON sets `embeddingModel: ""`, add Heading before toggle |
| `src/types.ts` | Add `info_text` to `RunEvent` union |
| `src/view.ts` | Render `info_text` as step-item with icon + summary + details |
| `src/phases/ingest.ts` | Replace `assistant_text` with `info_text`, add `pageId` import from `../wiki-graph` |
| `src/phases/init.ts` | No changes — delegates to `runIngest` which already emits `info_text` |

## Out of scope

- Per-entity similarity scoring (current architecture scores whole document, not per entity)
- Collapsible details list
- Changes to `PageSimilarityService.selectRelevant` interface
