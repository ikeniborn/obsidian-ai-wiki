# Design: ingest entity-driven retrieval (no graph)

**Date:** 2026-05-28
**Intent:** [docs/superpowers/intents/2026-05-28-ingest-entity-driven-retrieval-intent.md](../intents/2026-05-28-ingest-entity-driven-retrieval-intent.md)
**Status:** draft

## Summary

Replace the current `source → similarity → BFS → LLM` ingest flow with a two-LLM-call entity-driven flow:

1. **LLM #1 (`ingest.entities`)** reads the source file and returns the entities it contains: `{name, type?, context_snippet?}[]`.
2. For each entity, `PageSimilarityService.selectByEntities` performs vector top-K (with Jaccard fallback) over `_index.md` annotations.
3. The union of per-entity top-K paths is loaded.
4. **LLM #2 (`ingest.pages`)** receives the union and the entity list, then emits `pages` (create/update), optional `deletes` (merge targets), and optional `entity_types_delta` — same `WikiPagesOutputSchema` extended with `deletes[]`.

No BFS in ingest. `wiki-graph` and `graphCache` remain available to `lint`, `query`, `format`, `init`. `PageSimilarityService.selectRelevant` is preserved for non-ingest phases.

## Architecture

```
read source → ensure config → load _index annotations
  ↓
[LLM #1: extract entities]                  ← prompts/ingest-entities.md
  → EntitiesOutputSchema { reasoning, entities: [{name, type?, context_snippet?}] }
  ↓
similarity.selectByEntities(entities, annotations, allPaths)
  → Map<entityKey, string[]>   (top-K paths per entity; vector default, Jaccard fallback)
  ↓
union top-K paths → read those pages → existingPages: Map<path, content>
  ↓
[LLM #2: write/update/merge]                ← prompts/ingest.md (extended)
  → WikiPagesOutputSchema { reasoning, pages, deletes?, entity_types_delta? }
  ↓
apply: create / update + delete (merge) + index cleanup + backlink rewrite (scope-local)
  ↓
result summary: создано N, обновлено M, объединено K
```

**Files touched:**

| File | Change |
|---|---|
| `src/phases/ingest.ts` | Two-call orchestration. BFS / `graphCache` removed from ingest path. Delete loop. |
| `src/page-similarity.ts` | New `selectByEntities` method. `selectRelevant` unchanged. |
| `src/phases/zod-schemas.ts` | New `EntitiesOutputSchema`. `WikiPagesOutputSchema += deletes?`. |
| `src/wiki-index.ts` | New `removeIndexAnnotation`. |
| `src/types.ts` | `CallSite` union `+ "ingest.entities"`. |
| `src/structural-error-counter.ts` | Register `"ingest.entities"`. |
| `src/local-config.ts` | `nativeAgent.mergeDeleteWarnThreshold?: number`. |
| `src/settings.ts` | Slider for `mergeDeleteWarnThreshold`. |
| `src/i18n.ts` | RU/EN labels for the new knob. |
| `src/wiki-log.ts` | `IngestLogEntry.action += "УДАЛЕНА"`. |
| `prompts/ingest-entities.md` | **New.** System prompt for LLM #1. |
| `prompts/ingest.md` | Extended: instruct LLM that merge = `pages[new]` + `deletes[olds]`. |
| `tests/page-similarity.test.ts` | New cases for `selectByEntities`. |
| `tests/wiki-index.test.ts` | New cases for `removeIndexAnnotation`. |
| `tests/ingest.test.ts` (and/or new `tests/ingest-entity-flow.test.ts`) | End-to-end two-call flow, merge, halts. |
| `tests/zod-schemas.test.ts` | New schemas. |
| `lat.md/operations.md` | Update `Ingest` section. New subsections for entity extraction and per-entity retrieval. |
| `lat.md/architecture.md` | Update `PageSimilarityService` section to mention `selectByEntities`. |
| `lat.md/llm-pipeline.md` | Add `ingest.entities` call site. |
| `lat.md/tests.md` (new) | Spec sections referenced by `// @lat:` in tests. |

## Components

### `PageSimilarityService.selectByEntities`

```ts
interface ExtractedEntity {
  name: string;
  type?: string;
  context_snippet?: string;
}

interface EntityRetrievalResult {
  results: Map<string, string[]>;   // key = `${name}::${type ?? ""}`
  allFailed: boolean;               // true only when retrieval *mechanism* failed for every entity
}

async selectByEntities(
  entities: ExtractedEntity[],
  indexAnnotations: Map<string, string>,
  allPaths: string[],
): Promise<EntityRetrievalResult>
```

Behavior:

- Build query string per entity: `[name, type, context_snippet].filter(Boolean).join(" — ")`.
- `mode === "embedding"`:
  - One batched `fetchEmbeddings` POST for all N entity queries.
  - Page vectors taken from `this.cache` (loaded via existing `loadCache`); cache misses embedded on-the-fly in additional batches as `selectRelevant` already does.
  - On HTTP error → per-entity Jaccard fallback via `scoreSeed`.
- `mode === "jaccard"`:
  - Tokenize each entity query, score every annotated page via `scoreSeed`, take top-K.
- Top-K = `this.config.topK` (reused `relevantPagesTopK`).
- `results` contains one entry per input entity. An entity with no matches gets an empty array — caller treats this as a "no existing page" signal for LLM #2.
- `allFailed = true` only when the retrieval mechanism (vector AND Jaccard fallback) threw for every entity — e.g. annotation map empty plus embedding endpoint dead. This distinguishes a mechanical failure from the legitimate case of "all entities are novel and have no existing pages". Implementation: track a per-entity success boolean and AND-reduce.

### `wiki-index.ts` — `removeIndexAnnotation`

```ts
export async function removeIndexAnnotation(
  vaultTools: VaultTools,
  wikiFolder: string,
  pid: string,
): Promise<void>
```

Strips the line `- [[pid]] ...` from `_index.md`. If the host section ends up empty (no remaining `- ` entries), removes the `## section` header line too. No-op when `pid` is absent. Wrapped in try/catch by callers — non-critical.

### `zod-schemas.ts`

```ts
export const EntitiesOutputSchema = z.object({
  reasoning: z.string(),
  entities: z.array(z.object({
    name: z.string().min(1),
    type: z.string().optional(),
    context_snippet: z.string().optional(),
  })).max(50),
});

export const WikiPagesOutputSchema = z.object({
  reasoning: z.string(),
  pages: z.array(WikiPageSchema),
  deletes: z.array(z.object({ path: z.string() })).optional(),
  entity_types_delta: z.array(EntityTypeSchema).optional(),
});
```

`max(50)` caps explosive extraction. `deletes` uses minimal `{path}` shape — no `redirect_to` (LintOutputSchema keeps it for lint duplicate merges; ingest semantics are simpler).

### `types.ts`

```ts
export type CallSite =
  | "init.bootstrap"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds"
  | "ingest.entities"  // NEW
  | "ingest.pages"
  | "format.output";
```

### `structural-error-counter.ts`

Add `"ingest.entities"` to the counter map. No behavioral change beyond registration.

### Config

```ts
// local-config.ts
interface NativeAgentLocalConfig {
  // existing
  embeddingModel?: string;
  embeddingDimensions?: number;
  relevantPagesTopK?: number;
  mergeDeleteWarnThreshold?: number;  // NEW — default 5
}
```

Settings UI: slider 1–20, default 5. RU label "Порог предупреждения о merge-удалениях", EN label "Merge delete warning threshold".

### `prompts/ingest-entities.md` (new)

Reuses the template variables already exposed to ingest:

```
Ты — извлекатель сущностей из источника для домена «{{domain_name}}».

ТИПЫ СУЩНОСТЕЙ ДОМЕНА:
{{entity_types_block}}
{{lang_notes}}

ЗАДАЧА:
- Прочитай источник.
- Верни список сущностей, которые встречаются в источнике и соответствуют ТИПАМ выше.
- Для каждой сущности:
  - name: каноническое имя сущности (без кавычек, как заголовок будущей страницы)
  - type: тип из списка выше (опционально, если не подходит ни один — пропусти)
  - context_snippet: одна фраза из источника, поясняющая зачем сущность нужна (опционально)

Не дублируй: один name → одна запись. Не извлекай сущности с min_mentions_for_page > 1, если они упомянуты только раз.

Верни ТОЛЬКО JSON:
{"reasoning":"...","entities":[{"name":"...","type":"...","context_snippet":"..."}]}
```

### `prompts/ingest.md` (extended)

Add a block before the JSON example:

```
ОБЪЕДИНЕНИЕ ДУБЛИКАТОВ (merge):
Если среди существующих wiki-страниц нашлись несколько, описывающих одну и ту же сущность:
- эмить одну новую страницу в pages (с объединённым контентом и каноническим путём)
- перечислить старые пути в поле deletes: [{path}, ...]
Старые страницы будут удалены, индекс почищен, backlinks в текущем источнике обновлены автоматически.
```

## Data Flow

### Step 1 — preamble

Unchanged: `domain` detection, `wikiVaultPath`, `schemaContent`, `indexContent`, `existingPaths`, `nonMetaPaths`, `cachedAnnotations` (or `parseIndexAnnotations(indexContent)`).

`similarity.loadCache(domainRoot, vaultTools)` invoked before step 2 — needed for `selectByEntities` in step 3.

### Step 2 — extract entities

```ts
const messages_extract = buildExtractMessages(
  sourceVaultPath, sourceContent, domain, today,
);
yield { kind: "tool_use", name: "Extracting entities", input: {} };

const entitiesResult = await parseWithRetry({
  llm, model, baseMessages: messages_extract, opts,
  schema: EntitiesOutputSchema,
  maxRetries: opts.structuredRetries ?? 1,
  callSite: "ingest.entities",
  signal,
  onEvent: (ev) => pwtEvents.push(ev),
});
yield { kind: "tool_result", ok: true, preview: `${entitiesResult.value.entities.length} entities` };
```

On retries exhausted: yield `tool_result ok:false`, yield buffered `pwtEvents`, yield `error`, yield empty `result`, return.

### Step 3 — per-entity retrieval

```ts
const { results: entityMap, allFailed } = await similarity.selectByEntities(
  entitiesResult.value.entities, annotations, nonMetaPaths,
);

if (allFailed && entitiesResult.value.entities.length > 0) {
  yield { kind: "error", message: "ingest: per-entity retrieval failed for all entities" };
  yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: 0 };
  return;
}

const union = new Set<string>();
const details: string[] = [];
for (let i = 0; i < entitiesResult.value.entities.length; i++) {
  const e = entitiesResult.value.entities[i];
  const key = `${e.name}::${e.type ?? ""}`;
  const paths = entityMap.get(key) ?? [];
  details.push(
    `${i + 1}/${entitiesResult.value.entities.length} ${e.name}` +
    `${e.type ? ` (${e.type})` : ""} → ${paths.length ? paths.join(", ") : "—"}`,
  );
  for (const p of paths) union.add(p);
}

yield {
  kind: "info_text",
  icon: similarity.config.mode === "embedding" ? "🔍" : "📋",
  summary: `${union.size}/${nonMetaPaths.length} pages retrieved (${similarity.config.mode}, ${entitiesResult.value.entities.length} entities)`,
  details,
};
```

The "every entity has empty top-K" halt is distinguished from the legitimate "entity has no existing page" case via the `allFailed` flag returned by `selectByEntities`. Default path when retrieval mechanically succeeds but returns empty for some entities: **not** an error — the entity simply goes to LLM #2 as a create signal.

### Step 4 — read union + write call

```ts
const existingPages = await vaultTools.readAll([...union]);
const messages_write = buildIngestMessages(
  sourceVaultPath, sourceContent, domain, wikiVaultPath,
  existingPages, schemaContent, indexContent,
  entitiesResult.value.entities,  // NEW: passed for context
);

yield { kind: "tool_use", name: "Synthesising pages", input: {} };
const parseResult = await parseWithRetry({
  llm, model, baseMessages: messages_write, opts,
  schema: WikiPagesOutputSchema,
  maxRetries: opts.structuredRetries ?? 1,
  callSite: "ingest.pages",
  signal,
  onEvent: (ev) => pwtEvents.push(ev),
});
```

`buildIngestMessages` is extended to append a section listing the extracted entities and which had empty top-K (`→ "no existing page, create new"`). Format inside the user role message:

```
Извлечённые сущности:
- name (type) — context_snippet [existing: pathA, pathB]
- name (type) — context_snippet [existing: —]
```

### Step 5 — apply

**Pages write loop:** existing path validation, `fixWikiLinks`, and Create/Update emit loop preserved as-is.

**Delete loop (new):**

```ts
const deletes = parseResult.value.deletes ?? [];
const threshold = settings.nativeAgent.mergeDeleteWarnThreshold ?? 5;
if (deletes.length > threshold) {
  yield {
    kind: "info_text",
    icon: "⚠️",
    summary: `Large merge: ${deletes.length} deletions`,
    details: deletes.map((d) => d.path),
  };
}

const deletedPaths: string[] = [];
for (const d of deletes) {
  if (!d.path.startsWith(wikiVaultPath + "/")) {
    yield { kind: "tool_use", name: "Delete", input: { path: d.path } };
    yield { kind: "tool_result", ok: false, preview: `outside wiki folder (${wikiVaultPath})` };
    continue;
  }
  yield { kind: "tool_use", name: "Delete", input: { path: d.path } };
  try {
    await vaultTools.remove(d.path);
    try {
      await removeIndexAnnotation(vaultTools, wikiVaultPath, pageId(d.path));
    } catch { /* non-critical */ }
    deletedPaths.push(d.path);
    const relPath = d.path.slice(wikiVaultPath.length + 1);
    logEntries.push({ path: relPath, action: "УДАЛЕНА" });
    yield { kind: "tool_result", ok: true };
  } catch (e) {
    yield { kind: "tool_result", ok: false, preview: (e as Error).message };
  }
}
```

`vaultTools.remove(vaultPath): Promise<void>` already exists (`src/vault-tools.ts:92`) and forwards to the Obsidian `DataAdapter.remove` hook — same mechanism lint uses.

### Step 6 — result summary

```ts
const createdCount = logEntries.filter((e) => e.action === "СОЗДАНА").length;
const updatedCount = logEntries.filter((e) => e.action === "ОБНОВЛЕНА").length;
const mergedCount = logEntries.filter((e) => e.action === "УДАЛЕНА").length;
```

`buildIngestSummary` extended to handle the three-action case. Format:

- `0,0,0` → `новых или изменённых страниц нет.`
- only created → `создано N стр.`
- only updated → `обновлено N стр.`
- only merged (no new pages) → `объединено N стр.`
- two or three non-zero → `создано C, обновлено U, объединено M` (omit zero terms)

### Step 7 — backlinks (scope-local)

Single source file is updated. Build `writtenLinks` from `written` paths as today, but first drop any link in `wiki_articles` whose stem matches a deleted page:

```ts
const deletedStems = new Set(deletedPaths.map((p) => p.split("/").pop()!.replace(/\.md$/, "")));
const existingArticles = parseWikiArticlesFromFm(sourceContent)
  .filter((link) => {
    const stem = link.replace(/^\[\[/, "").replace(/\]\]$/, "");
    return !deletedStems.has(stem);
  });
```

Other source files in the vault are not scanned by ingest; the lint phase already does a vault-wide backlink rewrite when it removes pages.

### Step 8 — cache refresh + log

`similarity.refreshCache` invoked when `written.length > 0` (today's gate). Deletions alone do not trigger refresh. Side-effect: cache entries for deleted pages become orphans inside `_embeddings.json` — they are never read again because `selectByEntities` iterates `indexAnnotations` (already cleaned by `removeIndexAnnotation`). Orphan entries are evicted on the next manual `refreshCache` rebuild or accepted as harmless until cache rotation; spec does not introduce an extra delete-cache step to keep the change surgical.

`appendWikiLog` emits the per-source log entry as today; the new `"УДАЛЕНА"` action flows through unchanged.

## Error Handling

### Halt conditions

| Trigger | Behavior |
|---|---|
| LLM #1 (`parseWithRetry` exhausted) | `tool_result ok:false`, replay `pwtEvents`, `error`, empty `result`. No `entity_types_delta` applied. No backlinks written. |
| Both vector + Jaccard mechanically fail for every entity | `error`, empty `result`. |
| LLM #2 (`parseWithRetry` exhausted) | Same shape as today's ingest LLM failure. |
| Abort signal | Early return identical to today. |

### Continue conditions

| Trigger | Behavior |
|---|---|
| Single entity: vector + Jaccard both empty (no annotation matches) | Empty `top-K` for that entity, `—` in details line. Entity passed to LLM #2 as create signal. Not an error. |
| Vector HTTP fails for one batch | Fall through to Jaccard per `selectByEntities` fallback — identical to current `selectRelevant`. |
| LLM #2 invalid path | Existing path-validation retry path unchanged. |
| `deletes[].path` outside wiki folder | `tool_result ok:false`, skip, continue. |
| `deletes[].path` non-existent | `vaultTools.remove` throws → `tool_result ok:false`, no log entry, continue. |
| `removeIndexAnnotation` failure | try/catch, non-critical, continue. |
| `deletes.length > mergeDeleteWarnThreshold` | Warning `info_text`, still execute deletions (ingest non-interactive). |

### Structural error events

LLM #1 retries surface as `structural_error { callSite: "ingest.entities" }`. LLM #2 retries unchanged (`ingest.pages`).

## Testing

### `tests/page-similarity.test.ts` — new cases

- `selectByEntities returns top-K per entity (embedding mode)` — mock `fetch` to return deterministic vectors, assert per-entity map shape + ordering.
- `selectByEntities returns top-K per entity (jaccard mode)` — no fetch, reuse `scoreSeed`, assert ranking.
- `selectByEntities falls back to jaccard on embedding HTTP error` — fetch throws, assert non-empty Jaccard results.
- `selectByEntities returns empty array for entities with no annotation matches` — key present, value `[]`.
- `selectByEntities batches all entity queries in one HTTP call` — spy on `fetch`, assert single POST.

### `tests/wiki-index.test.ts` — new cases

- `removeIndexAnnotation strips entry line`.
- `removeIndexAnnotation removes empty section header when last entry deleted`.
- `removeIndexAnnotation is no-op for missing pid`.

### `tests/ingest.test.ts` (or new `tests/ingest-entity-flow.test.ts`)

- `entity extraction call uses ingest-entities prompt + ingest.entities call site`.
- `union of per-entity top-K becomes existingPages for LLM #2`.
- `entity with empty top-K passes "no existing page" signal to LLM #2 → create new page`.
- `LLM #2 deletes field triggers vault.remove + removeIndexAnnotation`.
- `merge path: pages emits new + deletes emits olds → result summary "создано N, обновлено M, объединено K"`.
- `deletes.length > mergeDeleteWarnThreshold yields warning info_text`.
- `deletes path outside wiki folder rejected with ok:false`.
- `backlinks: deleted page stems removed from wiki_articles in current source only`.
- `extract LLM failure → halt, no entity_types_delta, no writes`.
- `all-entity mechanical retrieval failure → halt with error`.
- `BFS not invoked: graphCache.get not called from ingest path` — spy assertion on `graphCache.get`.

### `tests/zod-schemas.test.ts`

- `EntitiesOutputSchema accepts {reasoning, entities: [{name}]}`.
- `EntitiesOutputSchema rejects entities array longer than 50`.
- `WikiPagesOutputSchema accepts optional deletes[]`.

### `lat.md/tests.md` (new)

Section structure per project convention. Sections: `Entity Extraction`, `Per-Entity Retrieval`, `Merge Handling`, `Stop Rules`. Each leaf section has a one-sentence description and is referenced from test code via `// @lat:` comments.

## Migration

- No data migration. `_embeddings.json` schema unchanged (`model`/`dimensions`/`entries`). Existing cache entries are reused; entity-query vectors are not cached (one-shot per run).
- No domain config schema change.
- `_index.md` format unchanged. `removeIndexAnnotation` parses the same line format as `parseIndexAnnotations`.
- `mergeDeleteWarnThreshold` is optional; default `5` via `?? 5` at call site. Pre-existing settings files load without migration.
- `IngestLogEntry.action` gains `"УДАЛЕНА"` (additive — existing logs remain readable).
- Other phases (`lint`, `query`, `format`, `init`) untouched. `wiki-graph`, `graphCache`, `bfsExpand`, `selectRelevant` remain in the codebase.

## Observability

| Surface | Event | Content |
|---|---|---|
| Sidebar progress | `tool_use { name: "Extracting entities" }` → `tool_result` | `${N} entities` preview |
| Sidebar progress | `info_text { icon: 🔍/📋 }` | `${union.size}/${total} pages retrieved (${mode}, ${N} entities)` + `details` lines |
| Sidebar progress | `tool_use { name: "Synthesising pages" }` → `tool_result` | unchanged — `N pages · ~Xk tokens sent` |
| Per-page | `tool_use { name: "Create" \| "Update" }` | unchanged |
| Per-merge | `tool_use { name: "Delete" }` → `tool_result` | new — per deleted path |
| Warning | `info_text { icon: ⚠️ }` | `Large merge: K deletions` if `K > threshold` |
| Result | `assistant_text` | `создано C, обновлено U, объединено M` |
| Metrics | `llm_call_stats` × 2 | one per LLM call — Grafana sees two ingest rows per source |
| Metrics | `structural_error { callSite: "ingest.entities" }` | new — counted in `structuralErrorCounter` |
| Domain | `domain_updated` | unchanged (from LLM #2 `entity_types_delta`) |
| Log | `_log.md` append | actions `СОЗДАНА` / `ОБНОВЛЕНА` / `УДАЛЕНА`; `outputTokens` from LLM #2 only |

### Token reduction verification

- LLM #1 input ≈ source + entity_types_block + lang_notes (no wiki pages) — small.
- LLM #2 input ≈ system + source + union of per-entity top-K pages (no BFS) — bounded by `topK × N_entities` minus duplicates.
- Current baseline: full BFS expansion at `graphDepth=1` from `topK` seeds typically expands to 2–5× the seed count. Net: sum of two ingest LLM input tokens is expected to be below the current single-call input.

Verify via Grafana token-usage panel after merge — compare ingest input tokens against the BFS baseline.

## Out of Scope

- `lint`, `query`, `format`, `init` phases — they continue using `selectRelevant` + BFS.
- Vault-wide backlink rewrite on merge — lint already does this.
- Graph removal — `wiki-graph.ts`, `graphCache`, `bfsExpand` stay in the codebase.
- New top-K knob — `relevantPagesTopK` is reused.
- Embedding cache for entity queries — one-shot per run, not persisted.
