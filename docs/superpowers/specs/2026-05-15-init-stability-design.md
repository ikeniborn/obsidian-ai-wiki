# Init Stability Design

Date: 2026-05-15

## Overview

Three independent fixes addressing reliability and UX of the `init` operation with native OpenAI-compatible backends (Qwen, DeepSeek, Ollama, etc.):

1. **Structured output auto-fallback** — remove user-facing mode setting; auto-degrade `json_object → none` on unsupported models.
2. **Article subfolder placement** — articles land in entity-type subfolders, not domain root.
3. **Per-file sequential pipeline** — articles written to vault immediately after each source file is processed, not at end of all init.

---

## Block 1: Structured Output Auto-Fallback

### Problem

`structuredOutput` setting has three values (`json_schema / json_object / none`). Users cannot determine which to use for a given model. Open models (Qwen, DeepSeek) often reject `json_schema` with `strict: true` at API level (400/422). `json_object` is broadly supported but not universal.

### Solution

Remove `structuredOutput` from `LlmWikiPluginSettings.nativeAgent` and from settings UI entirely. Replace with automatic behavior:

- Native backend always attempts `json_object` mode first.
- If API returns error indicating unsupported `response_format` → retry same request without `response_format`.
- All parsing uses `parseStructured` (robust mode, no API-level guarantee).

### Implementation

**`src/llm-utils.ts`** — extend `parseStructured`:
- Strip markdown fences (` ```json…``` `, ` ```…``` `) before regex search.
- Current chain: `JSON.parse` → strip `<think>` → `\{[\s\S]*\}`. New chain prepends fence stripping.

**`src/llm-utils.ts`** — add `wrapWithJsonFallback(llm: LlmClient): LlmClient`:
- Returns proxy `LlmClient` wrapping `chat.completions.create`.
- On call: if params include `response_format` → try; on error matching `isJsonModeError(e)` → retry without `response_format`.
- `isJsonModeError`: checks HTTP 400/422 or error message containing "response_format" / "json_object" / "unsupported".
- Works for both streaming and non-streaming overloads (error is thrown at `create()` time, not during iteration, for unsupported mode).

**`src/agent-runner.ts`** — `buildOptsFor`:
- Remove `na.structuredOutput` logic.
- Always pass `jsonMode: "json_object"` in opts for native backend.
- Wrap `this.llm` with `wrapWithJsonFallback` before passing to phases.

**`src/types.ts`**:
- `LlmCallOptions.jsonMode`: remove `"json_schema"` variant → `"json_object" | false`.
- `LlmWikiPluginSettings.nativeAgent`: remove `structuredOutput` field.

**`src/settings.ts`**:
- Remove `structuredOutput` dropdown from settings UI.
- Remove from `DEFAULT_SETTINGS`.

**`src/phases/init.ts`**:
- Remove `opts.jsonMode === "json_schema" ? DOMAIN_ENTRY_SCHEMA : undefined` branches.
- `bootstrapSchema` and `deltaSchema` → always `undefined` (schema unused for native).

**`src/phases/llm-utils.ts` / `buildChatParams`**:
- Remove `json_schema` branch entirely.
- Keep only `json_object` branch.

**Migration**: existing settings with `structuredOutput` field are ignored on load (field absent from new type). No active migration needed.

---

## Block 2: Article Subfolder Placement

### Problem

Ingest prompt instructs LLM to use `wiki_path/` prefix but doesn't provide explicit per-entity-type path templates. LLM places all articles in domain root, ignoring `wiki_subfolder` fields from entity types.

### Solution

Prompt-level fix using domain entity_types data: generate explicit path templates per entity type and inject into ingest system prompt. Since Block 3 ensures entity_types are updated before ingest of each file, templates are always current.

### Implementation

**`src/phases/ingest.ts`** — `buildEntityTypesBlock(domain, wikiVaultPath)`:
- Add `wikiVaultPath` parameter.
- For each entity type with `wiki_subfolder`, add line:
  ```
  Путь: {{wikiVaultPath}}/{{wiki_subfolder}}/EntityName.md
  ```
- For entity types without `wiki_subfolder`, add line:
  ```
  Путь: {{wikiVaultPath}}/EntityName.md
  ```

**`prompts/ingest.md`**:
- Replace vague mention of subfolders with explicit rule:
  ```
  - Путь статьи определяется типом сущности: используй точный шаблон из блока типов выше
  - Если тип сущности не определён → путь: {{wiki_path}}/EntityName.md
  ```

**Call site**: `buildIngestMessages` passes `wikiVaultPath` to `buildEntityTypesBlock`.

---

## Block 3: Per-File Sequential Pipeline in Init

### Problem

`runInitWithSources` has two sequential phases:
- Phase 1: analyze all N source files → build entity_types (no vault writes).
- Phase 2: ingest all N source files → write articles.

Articles appear in vault only when Phase 2 begins. Phase 1 for many files is long; vault remains empty throughout.

### Solution

Merge phases into a single per-file loop. For each source file:
1. **Analyze**: call LLM (bootstrap or incremental template) → update `currentDomain` in memory → persist via `domain_updated` event.
2. **Ingest**: call `runIngest(file, currentDomain)` → articles written to vault immediately.
3. Emit `file_done` → proceed to next file.

### Implementation

**`src/phases/init.ts`** — rewrite `runInitWithSources`:

```
yield { kind: "init_start", totalFiles: toAnalyze.length }

currentDomain = existing ?? null

for each file in toAnalyze:
  yield file_start

  read file content

  // Step 1: Analyze
  if i === 0 && !isResuming:
    LLM call with initTemplate → parse DomainEntry → currentDomain
    yield domain_created / domain_updated
  else:
    LLM call with initIncrementalTemplate → parse EntityTypesDelta
    merge entity_types into currentDomain
    yield domain_updated

  if signal.aborted → save progress → return

  // Step 2: Ingest (immediate write)
  for await ev of runIngest([file], vaultTools, llm, model, [currentDomain], ...):
    yield ev

  currentDomain.analyzed_sources = [..., file]
  yield domain_updated (analyzed_sources)

  yield file_done

// Finalize: clear analyzed_sources progress marker
yield domain_updated({ analyzed_sources: undefined })

yield result
```

**Key points**:
- `runIngest` receives `currentDomain` with entity_types known at that point (grows with each file).
- Resume logic: `analyzed_sources` updated only after BOTH steps complete for a file. On resume, files in `analyzed_sources` are fully skipped (no analysis, no ingest). `toProcess = sourceFiles.filter(f => !alreadyAnalyzed.has(f))`.
- `init_start` emits once with `totalFiles`; `phase` field removed (single phase now).
- `onFileError` callback preserved for ingest step.
- Abort handling: if aborted mid-file (after Step 1 or during Step 2) → `analyzed_sources` NOT updated for that file → safe to resume from that file.
- Migration note: settings saved by old 2-phase pipeline may have `analyzed_sources` reflecting only Phase 1 completion. On resume with new code these files will be re-ingested (acceptable — ingest is idempotent via upsert).

**`src/types.ts`** — `RunEvent.init_start`: make `phase` optional or remove (single phase).

---

## Affected Files Summary

| File | Change |
|---|---|
| `src/types.ts` | Remove `json_schema` from `LlmCallOptions.jsonMode`; remove `structuredOutput` from `nativeAgent` settings |
| `src/settings.ts` | Remove `structuredOutput` from UI and `DEFAULT_SETTINGS` |
| `src/phases/llm-utils.ts` | Extend `parseStructured` (fence stripping); add `wrapWithJsonFallback`; remove `json_schema` branch from `buildChatParams` |
| `src/agent-runner.ts` | Always `jsonMode: "json_object"` for native; wrap llm with `wrapWithJsonFallback` |
| `src/phases/init.ts` | Rewrite `runInitWithSources` as per-file loop; remove `json_schema` schema branches |
| `src/phases/ingest.ts` | `buildEntityTypesBlock` adds explicit path templates; accepts `wikiVaultPath` |
| `prompts/ingest.md` | Explicit subfolder path rule |

## Out of Scope

- `json_schema` removal for claude-agent backend (not applicable — uses iclaude.sh, not OpenAI API directly).
- Changing ingest behaviour outside of init context (standalone ingest already writes per-file).
- Evaluator, format, query phases (don't parse structured JSON responses in the same way).
