---
review:
  spec_hash: "16e312ee9f3ff1d4"
  last_run: "2026-07-10"
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    clarity: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: "n/a"
---
# OKF Integration — Design

Date: 2026-07-09
Status: approved (design)
Branch: `dev-okf-integration`

## Goal

Make obsidian-ai-wiki pages conformant with Google Cloud's **Open Knowledge Format (OKF v0.1)** — a
vendor-neutral markdown spec (directory of markdown files + YAML frontmatter; mandatory field `type`;
reserved-but-optional `title`/`description`/`resource`/`tags`/`timestamp`; optional `index.md` and
`log.md`; **standard Markdown links in the body** form the knowledge graph).

The plugin must (a) **converge wiki-page frontmatter to OKF-native names automatically**, (b) carry the
knowledge graph as **body markdown links** (OKF-native) rather than frontmatter arrays, (c) use a single
`description` overview that drives retrieval, and (d) export a fully-conformant, shareable OKF bundle.

Reference implementation studied: **iwiki-mcp** (`okf.py` governance, `export.py` bundle export). iwiki is a
**specification reference, not a runtime dependency** — the plugin is an Obsidian plugin (native / Claude
backends), not an MCP client, so the deterministic logic is re-implemented in TypeScript.

## Decisions

1. **OKF scope** = the generated **wiki pages** only. Source notes keep the `wiki_` prefix.
2. **Frontmatter is minimal + OKF-named.** Wiki-page frontmatter carries only `type`, `description`,
   `resource`, `timestamp`, `tags`, `status`. The `wiki_` prefix is dropped; `title` is derived at export
   (not stored); `wiki_type` is removed.
3. **The knowledge graph lives in the body, not frontmatter.** Outgoing wiki links and external links move
   OUT of frontmatter into two body sections (`## Related`, `## External links`). This is OKF-native (OKF
   builds the graph from body markdown links) and keeps the Obsidian graph (body `[[wikilinks]]` count).
4. **`resource` is an OKF source pointer, not a graph edge.** It stays in frontmatter for staleness / source
   tracking, but its value is the **plain source identifier** (bare stem, no `[[ ]]`) — OKF form, not a
   wikilink. `wiki_sources` → `resource` and `["[[stem]]"]` → `["stem"]`.
5. **`description` is the single overview.** It carries the rich retrieval-tuned summary (~600–800 chars,
   one line) formerly in `_index.md`; retrieval (embeddings, chunk prefixes, Jaccard, seeds) reads it from
   frontmatter; `_index.md` is generated from descriptions; the body intro paragraph is removed.
6. **`## Related` / `## External links` are excluded from retrieval** — the chunker skips them so link lists
   never pollute embeddings, the description, or the index.
7. **Source-note frontmatter** keeps the `wiki_` prefix and `wiki_articles`, but drops `wiki_added` /
   `wiki_updated` (freshness is a body-content hash, independent of these dates).
8. **Migration** = wiki pages are actively rewritten by a one-shot, idempotent auto-migration in the
   `main.ts` chain (hard cutover). Source-note date removal is lazy (next ingest/format via repair rules).
9. **Export destination** = a modal asks for the path; default outside the vault (desktop-only `fs`) so
   Obsidian never indexes the copies; an in-vault, Obsidian-ignored folder option is offered.
10. **Link syntax for the bundle is fixed by OKF.** OKF v0.1 requires `[text](path.md)` and does NOT support
    `[[wikilinks]]` (verified vs the Google Cloud OKF spec). On disk pages keep `[[wikilinks]]` in the body
    (Obsidian graph); the export bundle rewrites them to `[text](rel.md)`. The rewrite is mandatory.

## Field model

### Wiki pages (OKF-native, prefix dropped)

| Field | Was | Notes |
|---|---|---|
| `type` | *(none)* | **mandatory** OKF entity type; = the entity-type **subdirectory** segment (`!Wiki/<folder>/<type>/…`), lowercased; generic `entities` → `concept`. |
| `description` | annotation in `_index.md` | **single overview**, verbatim ~600–800 chars, one line; feeds embeddings / chunks / Jaccard / seeds + generated `_index.md`. |
| `resource` | `wiki_sources` | **plain source identifier(s)** (bare stem, NO `[[ ]]`); staleness + source-deletion. |
| `timestamp` | `wiki_updated` | YYYY-MM-DD. |
| `tags` | `tags` | Hierarchical `a/b` on disk; kebab (`a/b`→`a-b`) at export. |
| `status` | `wiki_status` | `stub`\|`developing`\|`mature`. |
| *(export only)* | — | `title` — H1/slug, derived into the bundle, NOT stored on disk. |
| *(removed)* | `wiki_outgoing_links` | → body `## Related` section. |
| *(removed)* | `wiki_external_links` | → body `## External links` section. |
| *(removed)* | `wiki_type` | page-role dropped; meta files keyed by `_` prefix. |

### Body structure

```
# <H1 title>

<no lead intro paragraph — the overview is `description`>

## Key characteristics          ← mandatory, embedded/searchable
...other content sections...    ← embedded/searchable

## Related                      ← outgoing wiki links; [[wikilink]] on disk; EXCLUDED from retrieval
- [[wiki_fin_stripe]]

## External links               ← [text](url); EXCLUDED from retrieval
- [Stripe webhooks](https://stripe.com/docs/webhooks)
```

### Source notes (keep `wiki_` prefix)

| Field | Change |
|---|---|
| `wiki_articles` | kept (backlink list) |
| `wiki_added` / `wiki_updated` | **removed** |
| `tags` / `aliases` / `created` / `updated` / `external_links` / `related` | unchanged |

## Architecture — parts

### A. Rename primitive (single source of truth)

`src/utils/raw-frontmatter.ts` gains one alias map:

```
WIKI_FIELD_ALIASES = {
  wiki_sources: "resource",
  wiki_updated: "timestamp",
  wiki_status:  "status",
}
```

`renameWikiPageFields(content)` renames these keys (last-wins if both present), **removes** `wiki_type`,
`wiki_outgoing_links`, `wiki_external_links` from frontmatter (their content is relocated to the body by the
migration, not here), and **converts `resource` values `["[[stem]]"]` → `["stem"]`** (plain). Idempotent;
body untouched. Applied at the start of `validateAndRepairWikiPageFrontmatter` and by the migration.

`WIKI_PAGE_RULES` becomes: `resource` (list of plain strings — new `kind`), `timestamp` (date-scalar),
`status` (warn-enum), `tags` (list-tags), `aliases`. No `outgoing_links` / `external_links` / `type` /
`description` rules (unknown fields pass through; the two link fields no longer exist in frontmatter).
`ensureResource` writes `resource: ["stem"]` (plain); `parseResourceFromFm` reads plain strings.

### B. `type` / `description` governance (write path)

Ingest sets `type` from the entity-type subdirectory (`entities` → `concept`) and `description` from the
JSON `annotation` verbatim (one line, not truncated). Prompts (`ingest.md`, `ingest-merge.md`, `lint.md`)
emit `type`/`resource`(plain)/`timestamp`/`status` in frontmatter and put outgoing/external links in the
`## Related` / `## External links` body sections instead of frontmatter arrays.

### C. Body-section link management

Outgoing links are authored in `## Related` as `[[wikilinks]]` (Obsidian graph + OKF graph after rewrite);
external links in `## External links` as `[text](url)`. `wiki-link-validator` / `lint` /
`strip-legacy-sections` stop syncing a frontmatter `outgoing_links` array — the `## Related` section is the
canonical outgoing-link list. Dead-link detection over body `[[links]]` stays.

### D. Overview & retrieval (single source)

The `Map<pid, overview>` that today comes from `parseIndexAnnotations(_index.md)` is instead built from each
page's frontmatter `description` (`collectDescriptions(pages)`), fed unchanged into `buildChunkInputs`
(`page-similarity.ts`), `setJaccardCorpus`, and the query seeds (`wiki-seeds.ts`). The chunker
(`splitSections`) **excludes the `## Related` and `## External links` sections** from embedding. `_index.md`
is generated from descriptions. The body intro paragraph is dropped from `wikiSections` / `_wiki_schema.md`.
Fallback: `deriveFallbackDescription(body)` when the annotation is absent.

### E. Auto-migration (wiki pages)

New `src/migrate-okf-frontmatter.ts`, wired into the `main.ts` startup chain (flag-guarded, idempotent).
Per page: rename fields + convert `resource` to plain + inject `type` (subdir) + backfill `description`
(from `_index.md` annotation, else `deriveFallbackDescription`); **relocate** `wiki_outgoing_links` →
`## Related` (as `[[links]]`) and `wiki_external_links` → `## External links` (as `[text](url)`) in the body,
removing them from frontmatter. Then `_index.md` is regenerated from descriptions. Source notes are not
walked (their date removal is lazy).

### F. OKF export (command)

New `src/okf-export.ts` + helpers — offline/deterministic, no LLM, no network, sources never mutated.
Per page: frontmatter passthrough (already OKF-named) + derive `title` + keep `description` + normalize
`tags` (kebab). Rewrite body `[[stem]]`/`[[stem|alias]]` → `[text](rel.md)` (covers `## Related`); dead
links degrade to text + `warnings`. `## External links` are already markdown. Generate `index.md`
(progressive-disclosure nav from descriptions) and `log.md`; reserved-slug collisions → `warnings`.
Destination modal (default outside vault); desktop-only.

## Blast radius

Rename / resource-format / link-relocation / retrieval consumers:

- `src/utils/raw-frontmatter.ts` — alias map (3), `renameWikiPageFields` (removes link fields, plain
  resource), `WIKI_PAGE_RULES`, `parseResourceFromFm`/`ensureResource` (plain), replace `annotation: remove`
  so `description` survives.
- `src/phases/ingest.ts` — write `type`/`description`/`resource`(plain); emit body link sections; the
  page-deletion guard (`~194-208`) must check `resource`, not `wiki_sources` (found during Task 2 — pages
  with only `resource` must not be deleted as "no sources").
- `src/source-deletion.ts`, `src/incremental-sources.ts` (`parsePageSources`), `src/utils/vault-walk.ts`
  (`parseWikiSources`) — parse **plain** `resource` values (no `[[ ]]`).
- `src/wiki-link-validator.ts`, `src/phases/lint.ts`, `src/strip-legacy-sections.ts` — drop frontmatter
  `outgoing_links` sync; `## Related` body section is canonical; keep dead-link detection.
- `src/page-similarity.ts`, `src/wiki-index.ts`, `src/wiki-seeds.ts`, `src/phases/query.ts` — overview from
  frontmatter descriptions; `splitSections` excludes `## Related`/`## External links`;
  `deriveFallbackAnnotation` → `deriveFallbackDescription`; `_index.md` generated from descriptions.
- `src/phases/llm-utils.ts` (`wikiSections`) + `templates/_wiki_schema.md` — drop the intro paragraph; add
  `## Related` / `## External links` conventions; frontmatter table → OKF fields.
- `src/phases/query.ts` (saved-query page write), `src/phases/zod-schemas.ts` — OKF field names.
- Prompts: `prompts/ingest.md`, `prompts/ingest-merge.md`, `prompts/lint.md`.

## Data flow

```
Plugin load    → migration: rename fields + plain resource + type + description backfill
               → relocate frontmatter links → ## Related / ## External links body sections
               → regenerate _index.md from descriptions
Ingest         → write page (type/description/resource-plain/timestamp/status) + body link sections
               → source note: inject only wiki_articles (dates dropped)
Retrieval      → overview map = collectDescriptions(pages); chunker excludes Related/External sections
Export         → passthrough frontmatter + derive title + kebab tags + rewrite body [[links]]→[md](links)
               → bundle (index.md, log.md, per-page) → { pages, dest, warnings }
```

## Edge cases / error handling

- Legacy `wiki_*` on a wiki page → renamed by migration + per-write repair (idempotent).
- `resource: ["[[stem]]"]` → `["stem"]` (migration + repair); already-plain values untouched.
- Page missing `resource` (only legacy `wiki_sources`) → the deletion guard reads `resource` after repair, so a migrated page is not mis-deleted.
- Frontmatter `wiki_outgoing_links`/`wiki_external_links` → moved to body sections; if a `## Related` / `## External links` section already exists, entries are merged (deduped), not duplicated.
- Page without frontmatter → migration injects `type` (subdir/`concept`) + `description`; export derives `title`.
- Dead wikilink in `## Related` on export → plain text + `warnings`.
- Reserved-slug collision (`index.md`/`log.md`) → `warnings`.
- Retrieval must not embed `## Related` / `## External links` (assert in tests).
- Mobile → export command hidden. Migration failure → Notice, does not block load.

## Testing

- Unit: rename primitive (3 aliases, plain-resource conversion, wiki_type/outgoing/external removal,
  idempotency, last-wins); `entityTypeFromPath`; `ensureType`/`ensureDescription` (verbatim); source-date
  removal; `parseResourceFromFm` plain; body-section relocation (`wiki_outgoing_links` → `## Related`,
  `wiki_external_links` → `## External links`); `collectDescriptions` from frontmatter;
  `splitSections` excludes Related/External; export link rewrite / tag normalize / title derive.
- `eval/okf-migrate/`: legacy fixture → migrate → assert OKF frontmatter, plain resource, links relocated to
  body, description backfilled; idempotent on a 2nd pass.
- `eval/okf-export/`: fixture → export → bundle structure, derived title, link rewrite (incl. `## Related`),
  `index.md`/`log.md`, collision warnings.
- Retrieval smoke (desktop/LLM): embeddings build from descriptions, `## Related`/`## External links`
  excluded, query returns the same top pages as before.

## Alternatives considered

| Option | Pro | Con | Verdict |
|---|---|---|---|
| Export-only (no page changes) | least code | pages not OKF on disk | rejected |
| Keep links in frontmatter arrays | least churn | not OKF-native (OKF graph = body links); pollutes nothing but is non-conformant | rejected by owner |
| **Body-section links + OKF-plain resource + description overview** | OKF-native graph, clean frontmatter, single overview | wider blast radius (validator/lint/retrieval) | **chosen** |
| Full native OKF (md links on disk) | max conformance | breaks Obsidian graph editing | rejected — rewrite at export instead |
| Delegate to iwiki-mcp | reuse | plugin is not an MCP client | rejected — port to TS |

## Out of scope

- Renaming source-note fields off the `wiki_` prefix.
- Storing `title` on disk (derived at export).
- Importing external OKF bundles.
- Changing on-disk body link syntax away from `[[wikilinks]]` (rewrite happens only in the bundle).

## Sources

- [How the Open Knowledge Format can improve data sharing — Google Cloud Blog](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)
- [Google Cloud OKF SPEC.md](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md)
- [okf.md/spec — annotated guide](https://okf.md/spec/)
- iwiki-mcp domain pages `okf-governance`, `okf-export` (internal reference implementation).
