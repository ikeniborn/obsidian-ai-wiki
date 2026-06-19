---
review:
  spec_hash: 61c8f31eaa420b97
  last_run: 2026-06-19
  phases:
    structure:    { status: passed }
    coverage:     { status: passed }
    clarity:      { status: passed }
    consistency:  { status: passed }
  findings: []
chain:
  intent: null
---
# Format vision: sentinel-marker sweep

**Date:** 2026-06-19
**Branch:** `dev/format-sentinel-sweep`
**Status:** approved design

## Problem

After a `format` run with the vision operation, a technical sentinel marker
(`<<<END>>>`) leaked into the written note and was never stripped.

Reproduction file (already corrupted, left untouched per decision):
`notes/vaults/Work/Ростелеком/Архитектура модели данных/ДМД/Процесс работы с логическими объектами.md`
— its last line is the literal `<<<END>>>`.

### Root cause

`parseSentinelOutput` (`src/phases/format-utils.ts`) extracts the `formatted`
body. In the vision branch it hardcodes `formattedEnd = visionIdx` — i.e. it
assumes the marker order `FORMATTED ... VISION_COUNT ... EMBEDS ... END`. When
the LLM emits `<<<END>>>` out of that order (e.g. before `<<<VISION_COUNT>>>`),
the slice from `<<<FORMATTED>>>` up to `visionIdx` swallows the stray `<<<END>>>`
marker, which then survives all the way to disk.

There is no final defensive cleanup: `formatted` is only `.trim()`-ed, and the
Zod schemas (`FormatWithVisionSchema`, `FormatBaseSchema`) validate frontmatter
start and embed preservation but never check for residual `<<<...>>>` markers.

## Decisions

- **Scope:** only sentinel markers `<<<...>>>` (REPORT/FORMATTED/VISION_COUNT/
  EMBEDS/END and any unknown `<<<NAME>>>`). No broader artifact stripping.
- **Behavior on detection:** tighten parsing + always run a final sanitize pass +
  emit a warning if anything was removed. No retry-on-detection path (rejected).
- **Existing corrupted file:** not touched — code-only fix.

## Design (Approach 1: robust parse + final sanitize gate)

### Component 1 — `parseSentinelOutput` (modify, `src/phases/format-utils.ts`)

Make the vision branch order-independent. Instead of `formattedEnd = visionIdx`,
compute the end of the formatted body as the earliest trailing marker that
actually appears after `<<<FORMATTED>>>`:

```
const tail = [visionIdx, embedsIdx, endIdx].filter((i) => i > formattedIdx);
formattedEnd = tail.length ? Math.min(...tail) : text.length;
```

`formatted` is sliced up to the first encountered trailing marker, so a stray
`<<<END>>>` placed anywhere after the content can no longer fall inside the
`formatted` slice. The existing `truncated` semantics (no `<<<END>>>` present)
and `visionCount` / `embeds` parsing are preserved.

### Component 2 — `stripSentinelMarkers(text): { clean, removed }` (new, `src/phases/format-utils.ts`)

Pure function. Removes any token of the form `<<<[A-Z_]+>>>` — both whole
marker lines and inline residues — collapses the blank lines orphaned by a
removed marker line, and `trimEnd`s the result. Returns the cleaned text plus the
list of removed marker strings (for the warning). The pattern is narrow (only
our uppercase sentinel shape), so legitimate markdown is not affected.

### Integration — `src/phases/format.ts`

Single choke point just before the write (after `restoreSourceFrontmatter`,
before `vaultTools.write`, around lines 346–349):

```
const swept = stripSentinelMarkers(finalFormatted);
finalFormatted = swept.clean;
if (swept.removed.length) {
  yield { kind: "info_text", icon: "⚠️", summary: <markers stripped>, details: swept.removed };
}
```

This covers every path that produces `finalFormatted` (base, vision, and the
token-restore `parsed2` path) with one gate.

### Data flow

LLM output → `parseSentinelOutput` (order-robust parse) → transforms
(token restore, embeds, wiki links, frontmatter) → `stripSentinelMarkers`
(final gate) → `vaultTools.write`. A sentinel marker physically cannot reach
the note.

## Out of scope (explicitly not touched)

- Zod schemas — the retry-on-detection path was rejected.
- The `format.md` prompt.
- The already-corrupted example file.
- Other phases (ingest, lint, etc.) — only the format/vision flow is in scope.

## Verification

- Inline check of `stripSentinelMarkers` on input ending with `<<<END>>>` →
  marker removed, surrounding content intact.
- Inline check of `parseSentinelOutput` on a vision output where `<<<END>>>`
  precedes `<<<VISION_COUNT>>>` → `formatted` does not contain `<<<END>>>`.
- `npm run build` passes.
- `lat check` passes (update `lat.md/` if format-flow docs reference this).

No automated test suites exist in this project (see memory `no-functional-tests`);
verification is via build plus inline runs of the pure functions.

## Size

~2 functions + a small integration block, under ~50 lines. Fits a single
implementation plan.
