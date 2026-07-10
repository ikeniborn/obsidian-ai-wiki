---
review:
  spec_hash: "25c320acf4396e93"
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

## Field model

### Wiki pages (OKF-native, prefix dropped)

| Before | After | Notes |
|---|---|---|
| *(none)* | `type` | **mandatory** OKF entity type (person/tool/concept/…). = the entity-type **subdirectory** segment of the page path (`!Wiki/<domain>/<type>/…`), normalized lowercase; generic `entities` folder → `concept`. |
| *(derived)* | `description` | **stored on disk.** First 1–2 sentences of the ingest `annotation`. Regenerated with the page, so it stays in sync with `_index.md`. |
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

## Data flow

```
Plugin load    → auto-migration renames all wiki pages → OKF-native on disk
Ingest         → write wiki page (type/description/resource/timestamp/status/…); repair enforces names
               → source note: inject only wiki_articles (dates dropped)
Export command → read wiki pages (already OKF-named)
               → derive title + keep description + normalize tags + rewrite links
               → write bundle (index.md, log.md, per-page files)
               → report { pages, dest, warnings }
```

## Edge cases / error handling

- Legacy `wiki_*` on a wiki page → renamed by migration and by per-write repair (idempotent).
- Both legacy and new key present → last-wins rename, single OKF key remains.
- Page without frontmatter → migration/repair injects `type` (from the subdirectory, or `concept` for the generic `entities` folder) + `description`; export derives `title`.
- Old `wiki_type` page-role value → dropped; `type` re-derived from the subdirectory. Meta files stay keyed by their `_` prefix.
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
