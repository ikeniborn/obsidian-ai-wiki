---
review:
  spec_hash: 38562598441a5c50
  last_run: 2026-07-03
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings:
    - id: F-001
      phase: clarity
      severity: INFO
      section: "Part 2 — Ingest integration"
      section_hash: e51d39cd214f85b3
      fragment: "Count thematic categories across the domain after the write; if a new category exceeded the limit, emit a warning"
      text: "The exact moment and scope of the category count (per written page vs once per run, before vs after all pages are written) is left to the implementation plan."
      fix: "Acceptable as-is: enforcement is soft (warning only). Pin the counting point in the implementation plan."
      verdict: accepted
      verdict_at: 2026-07-03
chain:
  intent: null
---

# Tag Standardization and Domain Tag Reuse — Design

Date: 2026-07-03
Status: approved (design), pending spec review

## Problem

Tags are produced free-form, with no engineered reuse of the existing vocabulary:

- **Ingest** (`prompts/ingest.md:21`, `src/phases/ingest.ts`): the prompt tells the LLM to
  "reuse tags from existing wiki pages (provided in the context)", but the context holds
  only the pages selected by entity similarity for this run — not the domain's tag
  vocabulary. Reuse is emergent and unreliable: the model routinely invents near-duplicate
  tags because it never sees the full set.
- **Format** (`src/phases/format.ts`): the rules table (`templates/_format_schema.md:7`)
  also says "reuse tags from existing pages", but `runFormat` injects **no vault context
  at all** — only the single source file. The instruction is inert.
- **No aggregation anywhere:** there is no domain- or vault-wide tag collection, taxonomy,
  or registry. The only deterministic tag logic is the `TAG_RE` validator
  (`src/utils/raw-frontmatter.ts:9`), which silently **drops** near-valid tags such as
  `#Category/Sub Topic` instead of normalizing them.

## Decision Summary

Resolved during brainstorming:

- **Dynamic registry, no manual taxonomy file.** The allowed vocabulary is whatever
  already exists in the domain, collected automatically per run.
- **Registry scope: the domain** — frontmatter `tags:` of the domain's wiki pages plus
  the source notes under the domain's `source_paths`.
- **Full registry in the prompt — no frequency cap.** Truncating by frequency hides rare
  but valid tags and breaks matching. Instead, the **vocabulary itself is bounded** (see
  the category limit below).
- **Tag model "entities + themes".** Top-level tag categories are of two kinds:
  - *Entity categories* — exactly the domain's `entity_types` type names. Synced
    deterministically (see Part 2); not counted against the limit.
  - *Thematic categories* — free-form but bounded: a new thematic category is allowed
    only when no existing one fits **and** the limit is not exhausted. Default limit
    **12**, per-domain override via a new optional `max_tag_categories` field on
    `DomainEntry`.
- **Soft enforcement.** Exceeding the category limit logs a warning; the tag is kept
  (never silently discard meaning).
- **Deterministic entity-tag sync.** Ingest post-processing adds the page's entity-type
  tag (derived from its `wiki_subfolder`) when the LLM omitted it.
- **Normalization instead of dropping.** Near-valid tags are normalized (strip `#`,
  lowercase, spaces→`-`, `\`→`/`) before `TAG_RE` validation.

## Design

### Part 1 — Tag registry module (`src/utils/tag-registry.ts`, new)

`collectDomainTags(vaultTools, wikiFolder, sourcePaths)`:

- List `.md` files under the domain wiki folder and under each of the domain's
  `source_paths`.
- Parse each file's frontmatter `tags:` list (reuse the existing frontmatter parsing
  helpers from `src/utils/raw-frontmatter.ts`).
- Normalize each tag (Part 4) and validate with `TAG_RE`; invalid entries are excluded
  from the registry.
- Aggregate into unique tags with occurrence counts, grouped by top-level category.

`renderTagRegistryBlock(registry, entityTypes, maxCategories)` → the prompt block:

```
EXISTING DOMAIN TAGS (reuse these; do not invent near-duplicates):
Entity categories: person, project, tool
Thematic categories (7/12 used):
- topic-ai: topic-ai/rag (5), topic-ai/agents (3)
- workflow: workflow/review (2)
```

- Entity categories = the domain's `entity_types` type names, normalized to tag form.
- Thematic categories = all remaining top-level categories found in the registry.
- When the thematic count has reached `maxCategories`, the block states explicitly:
  `no new thematic categories allowed — reuse only`.
- The **entire** registry is rendered; no truncation.

### Part 2 — Ingest integration

- `runIngest`: after domain detection, call `collectDomainTags(...)`.
- `buildIngestMessages`: new parameter; the rendered registry block is appended to the
  user message (alongside the existing pages / entities / index blocks).
- `prompts/ingest.md:21`: rewrite the tags rule — order of preference:
  1. the page's entity-type tag (matching its subfolder / entity type);
  2. thematic tags reused from the `EXISTING DOMAIN TAGS` block;
  3. a new thematic tag only when nothing fits and the category limit is not exhausted,
     following the same `category/subtopic` scheme.
- **Post-processing (deterministic), after the existing frontmatter repair step:**
  - Determine the page's entity type from its wiki subfolder (`wiki_subfolder` mapping);
    add the `<entity_type>` tag when missing. Pages whose type has no `wiki_subfolder`
    are skipped.
  - Count thematic categories across the domain after the write; if a new category
    exceeded the limit, emit a warning (run event / log). The tag is kept.

### Part 3 — Format integration

- `src/agent-runner.ts` already resolves `formatDomain` (line 137) when `req.domainId`
  is set; add a fallback via `detectDomain` on the file path when it is not. Pass the
  domain (its `wiki_folder` + `source_paths` + `entity_types` + `max_tag_categories`)
  into `runFormat`.
- `runFormat`: collect the same domain registry and append the registry block to the
  user message (`userInitial`).
- `templates/_format_schema.md:7` (tags row): reuse strictly from the provided
  `EXISTING DOMAIN TAGS` block; a new tag only when nothing fits. Sources are not entity
  pages, so only thematic reuse applies there.
- **Degradation:** when no domain can be resolved, no block is added and format behaves
  exactly as today.

### Part 4 — Tag normalization (`src/utils/raw-frontmatter.ts`)

`normalizeTag(raw)`: trim → strip leading `#` → lowercase → spaces→`-` → `\`→`/`.
Applied in the `list-tags` rule **before** the `TAG_RE` check, for both `SOURCE_RULES`
and `WIKI_PAGE_RULES`. Tags that still fail after normalization are dropped with a
warning, as today. This salvages tags like `#Category/Sub Topic` → `category/sub-topic`
instead of losing them.

### Part 5 — Configuration

- `DomainEntry` (`src/domain.ts`): new optional field `max_tag_categories?: number`.
  Absent → default `12`. Stored in `!Wiki/_config/_domain.json` like the rest of the
  domain config; edited as JSON (no settings UI in this iteration).

## Out of Scope

- Wiring the registry block into `lint` / `init` prompts (the module makes this a small
  follow-up).
- Retagging / migrating already-existing pages to the standard.
- A persistent tag cache (`_tags.json`) — the per-run frontmatter scan is cheap.
- Similarity-based remapping of new tags onto existing ones.
- Settings UI for `max_tag_categories`.

## Verification

- `npm run lint`, `npm run build` (no unit-test framework in the project).
- Manual, ingest: ingest a note into a domain with existing tags → new pages reuse
  registry tags; each page carries its entity-type tag; a warning appears when the
  category limit is exceeded.
- Manual, format: format a note inside a domain → the registry block is present in the
  LLM context (visible in logs); the note's existing valid tags survive.
- Manual, normalization: a source tag `#Category/Sub Topic` survives formatting as
  `category/sub-topic` instead of being dropped.

## Touched Files

| File | Change |
|------|--------|
| `src/utils/tag-registry.ts` (new) | domain tag collection + prompt block rendering |
| `src/utils/raw-frontmatter.ts` | `normalizeTag()` applied before `TAG_RE` in `list-tags` |
| `src/phases/ingest.ts` | collect registry; pass block into `buildIngestMessages`; entity-tag auto-add + category-limit warning in post-processing |
| `src/phases/format.ts` | accept domain; collect registry; append block to user message |
| `src/agent-runner.ts` | resolve/fallback domain for format; pass into `runFormat` |
| `src/domain.ts` | `max_tag_categories?: number` on `DomainEntry` |
| `prompts/ingest.md` | rewritten tags rule (entity tag → reuse → bounded new) |
| `templates/_format_schema.md` | tags row: reuse from provided block |

## Related

- `docs/rag-quality-recommendations.md` — general RAG quality notes (tags feed retrieval).
