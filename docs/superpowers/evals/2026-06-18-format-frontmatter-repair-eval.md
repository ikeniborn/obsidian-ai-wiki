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
- Bug 3 — `recoverSourceFrontmatter` + the `runIngest` backlink-write sequence (source `wiki_*` recovery).

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
| H | D/E/F shapes, recovery applied twice | Bug 3 idempotency |
| I | page with no frontmatter | Bug 3 leaves non-frontmatter pages untouched |
| J | prose whose first line is a frontmatter-like key with no `wiki_*` | Bug 3 does not fabricate a fence around body prose |
| P1–P14 | — | Bug 2 language resolution + bundle contents |

## Results (current)

`TOTAL: 42 passed, 0 failed`

| Bug | Verdict | Cases |
|-----|---------|-------|
| Bug 1 — preview frontmatter restore | ✅ PASS | A1–A5, B1, C1 |
| Bug 2 — progress language | ✅ PASS | P1–P14 |
| Bug 3 — re-ingest source backlinks | ✅ PASS | D1–D5, E1–E5, F1–F3, G1–G5, H1, I1, J1 |

## History — the original `repairSourceFence` failed (motivated the redesign)

The first Bug 3 implementation, `repairSourceFence`, only wrapped a **leading run of scalar `key:`
lines** in a fence. Running this eval against it produced `34 passed, 5 failed` — it failed every
realistic broken shape:

1. **D — duplicate keys defeat `upsertRawFrontmatter`.** Fencing the two `wiki_updated` lines produced
   a block with duplicate keys; `upsertRawFrontmatter`'s `yaml.parse` **throws** `"Map keys must be
   unique"`, its `try/catch` sets `existing = {}`, and `wiki_added` is lost before the downstream
   dedup ever runs.
2. **E — block-list items stranded.** `FM_KEY_LINE` matched `wiki_articles:` but not its indented
   `- "[[…]]"` items, so the closing `---` split the key from its items and `parseWikiArticlesFromFm`
   returned `[]` — dropping the existing backlink.
3. **F — `FM_RE.test()` short-circuited recovery.** A valid leading fence made `repairSourceFence`
   return unchanged, so body-stranded `wiki_*` were never recovered: `wiki_added` reset to today, the
   backlink was lost, and orphan lines stayed in the body.

## Fix — `recoverSourceFrontmatter`

`repairSourceFence` was replaced by `recoverSourceFrontmatter`, which:

- seeds from the leading fenced YAML (if any);
- peels the leading run of frontmatter-key lines from the body, **including** indented block-list
  items and continuations, skipping leading blanks;
- merges seed + stray run and parses with `yaml.parse(..., { uniqueKeys: false })` (last-wins dedup),
  so duplicate keys no longer crash the parse and `wiki_added` survives;
- re-serialises a single `---` block and strips the stray lines from the body;
- returns content unchanged when there is a valid leading fence with no stray frontmatter, or no
  frontmatter at all (idempotent), and when the collected frontmatter is unparseable;
- only recovers when the stray run carries a `wiki_*` field, so body prose whose first line merely
  looks like a frontmatter key (e.g. `updated: see the appendix below`) is left untouched (case J).

With this function the eval moved from `34/5` to `42/0`: D/E/F now pass, the positive control G still
passes, and the new idempotency (H), frontmatter-less (I), and prose-guard (J) cases pass.

## Verdict

All three bugs are correct and verified by this out-of-vault eval. Manual in-vault checks (sidebar
preview render, live-LLM frontmatter rebuild, full ingest pipeline) remain as the only steps this
harness cannot cover — see the spec's verification criteria.
