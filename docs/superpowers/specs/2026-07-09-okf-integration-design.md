---
review:
  spec_hash: "98211f063cd430b9"
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
`log.md`; standard markdown links form the knowledge graph).

The plugin must (a) **converge its wiki-page frontmatter to OKF field names automatically**, dropping the
`wiki_` prefix so pages read as OKF-native in place while preserving the Obsidian experience, and (b)
produce a fully-conformant, shareable OKF bundle on demand with **minimal transformation** (frontmatter is
near-passthrough because it is already OKF-named on disk).

Reference implementation studied: **iwiki-mcp** (`okf.py` governance, `export.py` bundle export,
`wiki_migrate_okf`/`wiki_apply_okf`). iwiki keeps its native format and treats OKF as a governed layer plus
a non-destructive export. This design goes further per the owner's decision: the **internal wiki-page
frontmatter is renamed to OKF-native names**, so export is near-passthrough. iwiki is a **specification
reference, not a runtime dependency** — the plugin is an Obsidian plugin (native / Claude backends), not an
MCP client, so the deterministic logic is re-implemented in TypeScript.

## Decisions

1. **OKF scope** = the generated **wiki pages** only. Source notes (the user's own files) are *not* OKF; they
   keep the `wiki_` prefix.
2. **Wiki-page frontmatter** = converged to OKF-native names automatically, `wiki_` prefix dropped
   everywhere. `type` = the page's **entity-type subdirectory** (`!Wiki/<domain>/<type>/<Article>.md`) — the
   existing folder layout is unchanged, the subdirectory name is simply written into `type`. The old
   page-role field `wiki_type` (page/index/log/schema) is removed, not renamed. `title` is derived at
   export; `description` **is** stored on disk (owner's decision).
3. **Source-note frontmatter** = keeps the `wiki_` prefix, keeps `wiki_articles` (the backlink list), but
   the wiki-tracking dates `wiki_added` and `wiki_updated` are **removed**. Incremental freshness is a
   body-content hash (`incremental-sources.ts`), independent of these dates, so removing them is safe.
4. **Migration** = wiki pages are actively rewritten by a one-shot, idempotent auto-migration in the
   `main.ts` migration chain (hard cutover, matching `migrateIndexFormat` / `migrateDropSections`).
   Source-note date removal is **lazy** — applied on the next ingest/format of each note via the repair
   rules — to avoid mass-rewriting the user's own notes at startup.
5. **Export destination** = a modal asks for the path; default **outside the vault** (Node `fs`,
   desktop-only) so Obsidian never indexes the markdown-link copies as duplicate notes; an in-vault,
   Obsidian-ignored folder option is offered.
6. **Overview single source** = the page **`description`** frontmatter field is the ONE overview text.
   It carries the rich, retrieval-tuned summary (~600–800 chars, one line, covering every section + search
   terms) that today lives as the `annotation` line in `_config/_index.md`. Consequences: retrieval
   (embeddings, chunk prefixes, Jaccard corpus, query seeds) reads `description` from each page's
   frontmatter; `_index.md` becomes a **generated** OKF progressive-disclosure nav derived from those
   descriptions (no longer the hand-maintained store); the wiki body's lead **intro paragraph is removed**
   (the overview is not duplicated in the body). See [§ Overview & retrieval](#e-overview--retrieval-single-source).
7. **Link syntax is NOT negotiable for the bundle.** OKF v0.1 deliberately mandates standard Markdown links
   `[text](path.md)` and does **not** support `[[wikilinks]]` (verified against the Google Cloud OKF spec).
   So on-disk pages keep `[[wikilinks]]` for the Obsidian graph, and the export bundle **must** rewrite them
   to `[text](rel.md)` — the rewrite stays in scope, it cannot be skipped.

## Field model

### Wiki pages (OKF-native, prefix dropped)

| Before | After | Notes |
|---|---|---|
| *(none)* | `type` | **mandatory** OKF entity type (person/tool/concept/…). = the entity-type **subdirectory** segment of the page path (`!Wiki/<domain>/<type>/…`), normalized lowercase; generic `entities` folder → `concept`. |
| *(none)* | `description` | **stored on disk — the single overview source.** The rich, retrieval-tuned summary (~600–800 chars, one line) formerly written as the `annotation` line in `_index.md`. Feeds embeddings / chunks / Jaccard / seeds and the generated `_index.md`. See [§ Overview & retrieval](#e-overview--retrieval-single-source). |
| `wiki_sources` | `resource` | List kept; wikilinks stay for Obsidian, rewritten at export. |
| `wiki_updated` | `timestamp` | |
| `tags` | `tags` | Name already OKF. Hierarchical on disk; kebab (`a/b`→`a-b`) only at export. |
| `wiki_status` | `status` | |
| `wiki_outgoing_links` | `outgoing_links` | Obsidian backlink cache; wikilinks on disk. |
| `wiki_external_links` | `external_links` | |
| `wiki_type` (page/index/log/schema) | *(removed)* | Page-role field dropped, not renamed. The entity `type` comes from the subdirectory; meta files (`_index`/`_log`/`_schema`) are identified by their `_` prefix, not frontmatter. |
| *(derived at export)* | `title` | H1 / slug. Not stored on disk. |

### Source notes (keep `wiki_` prefix)

| Field | Change |
|---|---|
| `wiki_articles` | kept (backlink list) |
| `wiki_added` | **removed** |
| `wiki_updated` | **removed** |
| `tags` / `aliases` / `created` / `updated` / `external_links` / `related` | unchanged |

## Architecture — parts

### A. Rename primitive (single source of truth)

`src/utils/raw-frontmatter.ts` gains one alias map used everywhere the rename happens:

```
WIKI_FIELD_ALIASES = {
  wiki_sources:        "resource",
  wiki_updated:        "timestamp",
  wiki_status:         "status",
  wiki_outgoing_links: "outgoing_links",
  wiki_external_links: "external_links",
}
```

A helper renames these keys (last-wins if both present), **removes** the old `wiki_type` field, and injects
`type` (from the entity-type subdirectory) and `description` (from the annotation) when absent. It is applied
in two places so the rename logic lives in exactly one place:

- **per-write repair** — `validateAndRepairWikiPageFrontmatter` runs it, so even if the model emits legacy
  `wiki_*` names, the written page ends up OKF-named. `WIKI_PAGE_RULES` is rewritten to the new field names
  (`resource`, `timestamp`, `status`, `outgoing_links`, `external_links`, plus new `type` and
  `description`); `wiki_type` becomes a `remove` rule. Legacy names are accepted only as rename inputs.
- **auto-migration** — part C.

Hardcoded readers `parseWikiSourcesFromFm` / `ensureWikiSources` (raw-frontmatter) and `parsePageSources`
(incremental-sources) retarget to `resource`.

Source-side: `SOURCE_RULES` gains `wiki_added` / `wiki_updated` as `remove` rules; `upsertRawFrontmatter` /
`restoreSourceFrontmatter` stop injecting them and keep only `wiki_articles`.

### B. `type` / `description` governance (write path)

Ingest sets `type` deterministically from the page's entity-type subdirectory (the `<type>` path segment;
generic `entities` → `concept`) and `description` from the first 1–2 sentences of the `annotation` it already
produces. Guards prevent duplicate keys. The
ingest prompts (`ingest.md`, `ingest-merge.md`) and lint prompt (`lint.md`) are updated to emit the new
field names; the deterministic repair (part A) is the safety net for model drift.

### C. Auto-migration (wiki pages)

New `src/migrate-okf-frontmatter.ts`, wired into the `main.ts` startup chain. One-shot (guarded),
idempotent: walks every wiki page in every domain, applies the rename primitive, removes `wiki_type`, and
injects `type` (from the subdirectory) + `description`, rewrites the file only when changed, runs before any
reader. Source notes are **not** walked
here; their date removal is lazy (part A repair on next touch).

### D. OKF export (command)

New `src/okf-export.ts` — offline/deterministic TypeScript port of iwiki `export.py`, no LLM, no network,
sources never mutated. Because on-disk frontmatter is already OKF-named, the frontmatter step is
near-passthrough; the remaining work is inherent to the Obsidian↔OKF boundary:

`exportDomainOkf(pages, dest, opts) → { pages, dest, warnings }`:

- Enumerate wiki pages; skip `_*` meta files.
- Per page: pass OKF-named frontmatter through; **derive** `title` (H1/slug); keep the stored
  `description`; normalize `tags` (kebab + dedupe + cap; `a/b`→`a-b`).
- **Link rewrite** (unavoidable) — `[[stem]]` → `[stem](rel.md)`, `[[stem|alias]]` → `[alias](rel.md)`,
  via a pid→relative-path map from the domain page set. Dead links degrade to plain text and are counted in
  `warnings`. Applies to body links and wikilinks inside `resource` / `outgoing_links`.
- Generate `index.md` (progressive-disclosure nav from `_index.md` annotations) and `log.md` (from the
  domain log). Reserve `index.md` / `log.md` at the bundle root; a real page colliding with a reserved name
  → `warnings` (matches iwiki).

### UI

- Command `AI Wiki: Export OKF bundle` (desktop-only) + a sidebar button.
- Export modal: destination path; default outside the vault (Node `fs`); option for an in-vault,
  Obsidian-ignored folder.
- Mobile: export hidden (no `fs`).

### E. Overview & retrieval (single source)

Today the per-page overview is the `annotation`: emitted by the LLM in the ingest JSON, written as a single
line to `_config/_index.md` (never to frontmatter — a `remove` rule strips `annotation:` from pages), and
consumed by retrieval as (a) the standalone "summary" embedding vector, (b) the prefix prepended to every
body "section" chunk vector, (c) the Jaccard corpus text, and (d) the query-seed scoring text. The wiki body
also carries a separate 1–3 sentence intro paragraph, authored independently.

This design collapses that into the OKF `description` field:

- **Ingest** writes the rich annotation into the page's frontmatter `description` (deterministic injection of
  the JSON `annotation`, kept verbatim — NOT truncated). The `annotation:`-strip rule is replaced so
  `description` survives repair; the JSON `annotation` field stays a transport field only.
- **`_index.md` is generated** from frontmatter descriptions (`- [pid](path) — <description>`), the OKF
  progressive-disclosure nav. It is derived, not hand-maintained; it can be rebuilt from the pages at any time.
- **Retrieval reads `description` from frontmatter.** The `Map<pid, overview>` that today comes from
  `parseIndexAnnotations(_index.md)` is instead built from each page's frontmatter `description`
  (`collectDescriptions(pages)`), then fed unchanged into the existing consumers: `buildChunkInputs`
  (`page-similarity.ts`), `setJaccardCorpus`, and the query seeds (`wiki-seeds.ts`). No change to the
  embedding/chunk math — only the source of the overview map moves from the index file to the frontmatter.
- **The body intro paragraph is removed** from the mandatory section conventions (`wikiSections` in
  `llm-utils.ts` + `_wiki_schema.md`) — the overview lives once, in `description`. The mandatory
  characteristics section stays.
- **Fallback**: when the LLM omits the annotation, `deriveFallbackDescription(body)` (the current
  `deriveFallbackAnnotation` logic) supplies a `description` from the body H1 + first sentence.

This keeps a single authored overview, makes it OKF-native (frontmatter `description` → generated
`index.md`), and preserves retrieval quality by keeping the description rich (~600–800 chars).

## Blast radius (rename consumers)

Beyond `raw-frontmatter.ts` (rules + parse helpers) and `incremental-sources.ts` (`parsePageSources`):

- `src/phases/ingest.ts` — writes wiki-page frontmatter + new `type`/`description`; stops writing source
  dates.
- `src/source-deletion.ts` — wiki pages citing a deleted source (`wiki_sources` → `resource`).
- `src/wiki-link-validator.ts`, `src/phases/lint.ts` — `wiki_outgoing_links` → `outgoing_links`.
- `src/phases/query.ts` — display of `wiki_status`/`wiki_updated`/`wiki_sources` → `status`/`timestamp`/`resource`.
- `src/migrate-drop-sections.ts`, `src/strip-legacy-sections.ts` — `wiki_outgoing_links` → `outgoing_links`.
- Prompts: `prompts/ingest.md`, `prompts/ingest-merge.md`, `prompts/lint.md`.
- `src/phases/zod-schemas.ts` if it constrains page frontmatter field names.

Overview single-source consumers (part E):

- `src/wiki-index.ts` — `_index.md` generation now sources the overview from frontmatter `description`
  (`upsertIndexAnnotation` / `parseIndexAnnotations` callers); `deriveFallbackAnnotation` →
  `deriveFallbackDescription`.
- `src/page-similarity.ts` — `refreshCache` / `buildChunkInputs` / `setJaccardCorpus` read the overview map
  from frontmatter descriptions instead of `parseIndexAnnotations(_index.md)`.
- `src/wiki-seeds.ts` — seed scoring uses `description`.
- `src/phases/query.ts` — the overview map fed to seeds/context comes from frontmatter descriptions.
- `src/phases/llm-utils.ts` (`wikiSections`) + `templates/_wiki_schema.md` — drop the mandatory body intro
  paragraph.
- `src/utils/raw-frontmatter.ts` — replace the `annotation: remove` rule so `description` is preserved.

## Data flow

```
Plugin load    → auto-migration renames all wiki pages → OKF-native on disk
               → backfill description from _index.md annotation → regenerate _index.md from descriptions
Ingest         → write wiki page (type/description=overview/resource/timestamp/status/…); repair enforces names
               → source note: inject only wiki_articles (dates dropped)
Retrieval      → overview map = collectDescriptions(pages)  (frontmatter, not _index.md)
               → embeddings / chunk prefix / Jaccard / seeds  → _index.md regenerated as OKF nav
Export command → read wiki pages (already OKF-named)
               → derive title + keep description + normalize tags + rewrite [[links]]→[md](links)
               → write bundle (index.md, log.md, per-page files)
               → report { pages, dest, warnings }
```

## Edge cases / error handling

- Legacy `wiki_*` on a wiki page → renamed by migration and by per-write repair (idempotent).
- Both legacy and new key present → last-wins rename, single OKF key remains.
- Page without frontmatter → migration/repair injects `type` (from the subdirectory, or `concept` for the generic `entities` folder) + `description`; export derives `title`.
- Old `wiki_type` page-role value → dropped; `type` re-derived from the subdirectory. Meta files stay keyed by their `_` prefix.
- **Migration moves the overview**: for existing pages the annotation lives in `_index.md`, not frontmatter. The auto-migration backfills `description` from that page's `_index.md` annotation (already read for the pid → annotation map); if the page is absent from `_index.md`, `deriveFallbackDescription(body)`.
- After migration, `_index.md` is regenerated from the now-authoritative frontmatter descriptions, so the file and the pages agree.
- Source note still carrying `wiki_added`/`wiki_updated` → stripped on next ingest/format (lazy).
- Dead wikilink on export → plain text + `warnings` entry.
- Real page named `index.md` / `log.md` → reserved-slug collision `warnings` entry.
- Hierarchical tag `a/b` → `a-b` at export.
- Alias link `[[a|b]]` → `[b](a.md)`.
- Mobile → export command hidden.
- Migration failure → caught, surfaced as a Notice (existing pattern), does not block load.

## Testing

- Unit: rename primitive (all five aliases, both-present last-wins, idempotency), `wiki_type` removal,
  `type` derivation from the subdirectory (incl. `entities` → `concept`), `description` injection + guards,
  source-date `remove` rules, `rewriteLinks`, tag normalization, `title` derivation.
- `eval/okf-migrate/`: fixture domain with legacy `wiki_*` frontmatter → run migration → assert wiki pages
  are OKF-native and unchanged on a second pass; assert source notes keep `wiki_articles` and lose the dates
  after a simulated touch.
- `eval/okf-export/`: fixture domain → export → assert bundle structure, derived `title`, stored
  `description`, link rewrite, `index.md`/`log.md` present, warnings on collisions. Follows existing `eval/`.
- Overview single-source: `description` injected verbatim (not truncated) from the annotation; `_index.md`
  generated from frontmatter descriptions round-trips (`collectDescriptions` → generate → `parseIndexAnnotations`
  yields the same map); migration backfills `description` from a legacy `_index.md` annotation; body intro
  paragraph absent from the section conventions.
- Retrieval smoke (desktop/LLM): after ingest, `_embeddings.json` builds from frontmatter descriptions and a
  query returns the same top pages as before the change (no retrieval regression on a sample domain).

## Alternatives considered

| Option | Pro | Con | Verdict |
|---|---|---|---|
| Export-only (no page changes) | least code | pages not OKF on disk | rejected |
| B-minimum (`type` only, derive rest at export) | lowest risk | export not passthrough; keeps `wiki_*` | rejected by owner |
| **B-converge (drop `wiki_` prefix on wiki pages, auto-migrate; strip source dates)** | pages OKF-native, export near-passthrough, single rename primitive | wider rename blast radius + a migration | **chosen** |
| Full native OKF (markdown links on disk) | max conformance | breaks Obsidian graph / backlinks | rejected |
| Delegate to iwiki-mcp | reuse | plugin is not an MCP client; adds network + dependency | rejected — port to TS |

## Out of scope

- Renaming source-note fields off the `wiki_` prefix (source notes stay `wiki_`-prefixed).
- Storing `title` on disk (derived at export).
- Importing external OKF bundles into the vault.
- Switching the on-disk link syntax away from Obsidian wikilinks.

## Sources

- [How the Open Knowledge Format can improve data sharing — Google Cloud Blog](https://cloud.google.com/blog/products/data-analytics/how-the-open-knowledge-format-can-improve-data-sharing/)
- [Google Cloud Introduces Open Knowledge Format (OKF) — MarkTechPost](https://www.marktechpost.com/2026/06/16/google-cloud-introduces-open-knowledge-format-okf-a-vendor-neutral-markdown-spec-for-giving-ai-agents-curated-context/)
- iwiki-mcp domain pages `okf-governance`, `okf-export` (internal reference implementation).
