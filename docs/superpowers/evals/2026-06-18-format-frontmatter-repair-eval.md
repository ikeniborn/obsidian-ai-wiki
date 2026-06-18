# Eval — Format Frontmatter Repair + Progress Language

**Date:** 2026-06-18
**Branch:** `dev/format-fm-repair-progress-lang`
**Spec:** `docs/superpowers/specs/2026-06-18-format-frontmatter-repair-and-progress-language-design.md`
**Plan:** `docs/superpowers/plans/2026-06-18-format-frontmatter-repair-and-progress-language.md`

## Purpose & scope

Validate the three bug fixes **outside any production Obsidian vault** and **without an LLM**, by
exercising the real pure functions from `src/` against synthetic broken-frontmatter fixtures that
reproduce the spec's corruption cases.

This eval covers the **deterministic logic** the fixes depend on:
- Bug 1 — `restoreSourceFrontmatter` (preview == apply, idempotent).
- Bug 2 — `resolveProgressLang` / `i18nFor` (progress language resolution).
- Bug 3 — `repairSourceFence` + the `runIngest` backlink-write sequence (source `wiki_*` recovery).

**Out of scope** (requires the Obsidian runtime / a live LLM, must be checked manually in a throwaway vault):
the actual `format_preview` sidebar render, the LLM rebuilding broken frontmatter (Task 6 prompt
change), and the full `runIngest` pipeline around the backlink block.

## How to run

```bash
# from repo root
node_modules/.bin/esbuild eval/format-frontmatter/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/format-frontmatter/obsidian-stub.ts \
  --outfile=eval/format-frontmatter/run.cjs
node eval/format-frontmatter/run.cjs
```

`obsidian-stub.ts` provides the only `obsidian` symbol `i18n.ts` uses — `moment.locale()` — driven by
`globalThis.__MOMENT_LOCALE__` so the `auto` fallback is testable. The harness imports the real
functions from `src/utils/raw-frontmatter.ts` and `src/i18n.ts`; `simulateIngestBacklink` replicates
the `src/phases/ingest.ts` backlink-write block verbatim.

## Fixtures

| Case | Source shape | What it models |
|------|--------------|----------------|
| A | fenced source with `wiki_*`; LLM output dropped `wiki_*` | Bug 1 preview restore |
| B | same, restore applied twice | Bug 1 idempotency (preview == apply) |
| C | fenced source with no `wiki_updated` | Bug 1 always-normalize, no crash |
| D | **unfenced, scalar, duplicate `wiki_updated`** | Spec's named reproduction (`Шакшука…`) |
| E | **unfenced, block-list `wiki_articles`** | The shape `upsertRawFrontmatter` writes |
| F | **valid leading fence (title) + `wiki_*` stranded in body** | The real on-disk artifact (spec §Root cause) |
| G | already-valid fenced source | Positive control (normal re-ingest) |
| P1–P14 | — | Bug 2 language resolution + bundle contents |

## Results

`TOTAL: 34 passed, 5 failed`

| Bug | Verdict | Cases |
|-----|---------|-------|
| Bug 1 — preview frontmatter restore | ✅ PASS | A1–A5, B1, C1 |
| Bug 2 — progress language | ✅ PASS | P1–P14 |
| Bug 3 — re-ingest source backlinks | ❌ FAIL | D1, E2, F1, F2, F3 fail; only G (control) passes |

### Failing assertions

- **D1** — `wiki_added` is dropped entirely (not preserved) on the spec's exact reproduction shape.
- **E2** — the existing block-list `wiki_articles` backlink is lost (not unioned).
- **F1** — `wiki_added` is reset to today.
- **F2** — the existing backlink is lost.
- **F3** — orphaned `wiki_*` lines remain in the body.

## Root-cause analysis (Bug 3)

`repairSourceFence` only re-fences a **fully unfenced, leading run of scalar `key:` lines**. The three
realistic corruption shapes each defeat it:

1. **D — duplicate keys defeat `upsertRawFrontmatter`, not just the fence.**
   `repairSourceFence` fences the three leading lines (including the two `wiki_updated`), producing a
   fenced block with duplicate keys. `upsertRawFrontmatter` then calls `yaml.parse`, which **throws**
   `"Map keys must be unique"`; its `try/catch` swallows the error and sets `existing = {}`, so the
   existing `wiki_added` is lost before `validateAndRepairSourceFrontmatter` (the dedup pass) ever runs.
   The spec assumed the downstream dedup would rescue duplicates — but `upsertRawFrontmatter` runs
   first and discards the recovered fields on a parse failure.

2. **E — block-list items are stranded.**
   `FM_KEY_LINE` matches the `wiki_articles:` parent line but not its indented `  - "[[…]]"` items, so
   the closing `---` is inserted between the key and its items. `parseWikiArticlesFromFm` then finds no
   items inside the fence → returns `[]` → the existing backlink drops out of the union. Since
   `upsertRawFrontmatter` always serialises `wiki_articles` as a block list (`yamlStringify`), this is
   the *common* shape, not an edge case.

3. **F — `FM_RE.test()` short-circuits recovery.**
   A valid leading fence (even one holding only `title`) makes `FM_RE.test()` return `true`, so
   `repairSourceFence` returns the content unchanged. The `wiki_*` fields stranded in the body below the
   fence are never read: `wiki_added` resets to today, the backlink is lost, and the orphan lines
   persist in the output. This is the artifact the spec itself describes as the corruption's origin.

`G` (an already-valid fenced source) passes — but that case never needed repair.

## Verdict

- **Bug 1 and Bug 2 are correct, integrated, and verified** by this eval and can ship.
- **Bug 3's fix does not satisfy its spec for any realistic broken source.** `repairSourceFence` as
  implemented (leading scalar run only) handles a shape that does not occur in practice. A correct fix
  must additionally: dedup duplicate keys *before* `upsertRawFrontmatter` reads them; recover block-list
  list-item lines; and recover `wiki_*` keys stranded in the body after a valid leading fence
  (i.e. not gate the whole repair on `FM_RE.test()`).

## Recommendation

Hold the Bug 3 commit (`fix(ingest): re-fence broken source frontmatter …`). Either redesign the
recovery to handle shapes D/E/F, or re-scope Bug 3 explicitly (with corrected verification criteria)
and get user sign-off. Bug 1 + Bug 2 may proceed independently.
