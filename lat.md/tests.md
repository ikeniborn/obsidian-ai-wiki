---
lat:
  require-code-mention: true
---
# Tests

Spec sections that map to test code via `// @lat:` comments. Every leaf section is referenced from at least one test in `tests/`.

## Entity Extraction

Tests that validate LLM #1 extracts entities from the source via `ingest.entities` and `EntitiesOutputSchema`.

### Entities schema accepts minimal entity

The `EntitiesOutputSchema` accepts `{reasoning, entities: [{name}]}` and rejects entities longer than 50.

### Entity extraction halt on parse failure

When `parseWithRetry` exhausts retries on the entity call, ingest yields an error result and writes nothing.

## Per-Entity Retrieval

Tests that validate `PageSimilarityService.selectByEntities` returns per-entity top-K paths.

### Top-K per entity in embedding mode

A single batched POST to `/embeddings` carries all entity queries, cosine similarity ranks pages, top-K is returned per entity.

### Jaccard fallback on HTTP error

When the embeddings endpoint throws, retrieval falls back to per-entity Jaccard scoring over annotations.

### Empty top-K is not an error

An entity with no annotation matches receives `[]` and is treated by LLM #2 as a create signal — `allFailed` stays false unless the retrieval mechanism itself failed for every entity.

## Merge Handling

Tests that validate `deletes[]` on `WikiPagesOutputSchema` and the delete loop.

### Deletes trigger vault.remove + index cleanup

LLM #2 emitting `deletes` removes the listed pages and strips their lines from `_index.md` via `removeIndexAnnotation`.

### Large-merge warning

When `deletes.length` exceeds `mergeDeleteWarnThreshold`, ingest yields a `Large merge: K deletions` warning `info_text` event.

### Backlinks drop deleted stems

The current source's `wiki_articles` frontmatter list is filtered to remove links pointing at deleted page stems.

## Stop Rules

Tests that validate halt conditions.

### Halt on entity extraction failure

`parseWithRetry` exhaustion on `ingest.entities` halts the run with an error event and an empty result.

### Halt on all-entity retrieval failure

When `selectByEntities` returns `allFailed: true` and entities is non-empty, ingest halts before invoking LLM #2.

### BFS not invoked

`graphCache.get` is never called from the ingest path — the test spies on the cache and asserts zero calls.
