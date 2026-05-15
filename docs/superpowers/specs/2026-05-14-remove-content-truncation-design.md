# Spec: Remove Content Truncation in LLM Phases

## Problem

All four LLM phases (`init`, `ingest`, `lint`, `query`) truncate file content before sending it to the LLM. The primary limit is 8 000 chars, which destroys context for large files (example: 94 948 chars → 8 000 chars, losing 91% of the content). Claude's context window (~200k tokens ≈ 800k chars) makes these limits unnecessary.

## Goal

Remove all hard-coded content truncation from LLM prompt construction. Replace the truncation warning in `init` with an informational size log. UI-level truncation in `stream.ts` and `view.ts` is unrelated and stays.

## Changes

### `src/phases/init.ts`

**Initial system prompt (lines 73–92, before main loop):**
- **Remove** `schemaContent.slice(0, 1500)` → `schemaContent` (line 76).
- **Remove** `indexContent.slice(0, 1000)` → `indexContent` (line 77).
- **Remove** `c.slice(0, 400)` on sample files content → `c` (line 89).

**Main per-file loop:**
- **Remove** lines 232–235: the `if (fileContent.length > 8_000)` warning block and `const truncated = fileContent.slice(0, 8_000)`.
- **Add** informational log (always, not conditional): `yield { kind: "assistant_text", delta: \`ℹ ${file}: ${fileContent.length} chars\n\` }`.
- **Replace** all `truncated` references with `fileContent`.
- **Remove** `schemaContent.slice(0, 1500)` → `schemaContent` (line 242).
- **Remove** `indexContent.slice(0, 1000)` → `indexContent` (line 243).

### `src/phases/ingest.ts`

- **Remove** `sourceContent.slice(0, 8000)` → `sourceContent`.
- **Remove** `schemaContent.slice(0, 2000)` → `schemaContent`.
- **Remove** `indexContent.slice(0, 2000)` → `indexContent`.
- **Remove** `c.slice(0, 400)` on existing pages → `c`.

### `src/phases/lint.ts`

- **Remove** `.slice(0, 8_000)` on `checkGraphStructure(...)` result.
- **Remove** `c.slice(0, 500)` and `c.slice(0, 300)` on wiki page content.

### `src/phases/query.ts`

- **Remove** `schemaContent.slice(0, 2000)` → `schemaContent`.
- **Remove** `indexContent.slice(0, 3000)` → `indexContent`.
- **Refactor** `buildContextBlock` (lines 193–219): remove `maxChars` parameter entirely. Remove the `break` on line 211 and the `.slice(0, maxChars)` fallback on line 216. All selected wiki pages are included without limit. Update the call site to drop the `maxChars` argument.

## Out of Scope

- UI truncation in `stream.ts` (`truncate(trimmed, 120)`) and `view.ts` — display only, not sent to LLM.
- Chunking for files >800k chars — not needed for current use cases; separate task if required.
- Configurable limits — not needed.

## Success Criteria

- No content-slicing `.slice(0, N)` calls remain in LLM prompt construction code in the four phase files.
- `query.ts` `buildContextBlock` has no `maxChars` parameter and no truncation logic.
- `init` phase logs file size informationally for every file processed.
- Tests pass: `npm test`.
- Manual verification: large file (>8k chars) processed by init/ingest shows full content sent to LLM (no truncation warning).
