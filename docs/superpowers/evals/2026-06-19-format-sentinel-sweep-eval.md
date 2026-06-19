# Eval — Format Vision Sentinel-Marker Sweep

**Date:** 2026-06-19
**Branch:** `dev/format-sentinel-sweep`
**Spec:** `docs/superpowers/specs/2026-06-19-format-vision-sentinel-sweep-design.md`
**Plan:** `docs/superpowers/plans/2026-06-19-format-vision-sentinel-sweep.md`

## Purpose & scope

Validate the sentinel-marker fix **outside any Obsidian vault** and **without an LLM**, by
exercising the real pure functions from `src/phases/format-utils.ts` against synthetic
LLM-output fixtures that reproduce the spec's leak.

Covers the **deterministic logic** the fix depends on:
- Component 1 — `parseSentinelOutput` order-robust body slice (stray `<<<END>>>` before `<<<VISION_COUNT>>>`).
- Component 2 — `stripSentinelMarkers` final sweep (line drop, inline splice, blank-run collapse, no-op).

**Out of scope** (requires the Obsidian runtime / a live LLM, checked via `npm run build`):
the `format.ts` integration gate firing inside the `runFormat` generator and the actual
`vaultTools.write`.

## How to run

```bash
# from repo root
node_modules/.bin/esbuild eval/format-sentinel-sweep/run.ts \
  --bundle --platform=node --format=cjs \
  --outfile=eval/format-sentinel-sweep/run.cjs
node eval/format-sentinel-sweep/run.cjs
```

`src/phases/format-utils.ts` is dependency-free, so no `obsidian` stub/alias is needed
(unlike the frontmatter eval). The harness imports the real `parseSentinelOutput` and
`stripSentinelMarkers`.

## Fixtures

| Case | Checks | Input shape | What it models |
|------|:------:|-------------|----------------|
| PARSE-1 | 3 | vision output with `<<<END>>>` before `<<<VISION_COUNT>>>` | Spec's named reproduction — body must not contain `<<<END>>>` |
| PARSE-2 | 4 | well-formed vision output (FORMATTED<VISION_COUNT<EMBEDS<END) | Positive control — body/visionCount/embeds/truncated intact |
| PARSE-3 | 2 | vision output with no `<<<END>>>` | Positive control — `truncated === true`, body sliced at `<<<VISION_COUNT>>>` |
| STRIP-1 | 3 | text ending in a stray `<<<END>>>` line | The on-disk repro — marker removed, content intact, `removed === ["<<<END>>>"]` |
| STRIP-2 | 2 | `<<<END>>>` inline mid-line | Inline residue spliced; inline whitespace not collapsed (by design) |
| STRIP-3 | 3 | several distinct markers on own lines | All removed, body intact, `removed.length === 3` |
| STRIP-4 | 2 | no markers | Exact-bytes no-op, nothing removed |
| STRIP-5 | 1 | marker line between blank lines | Orphaned blank-line run collapsed |

Component 1 = 9 checks, Component 2 = 11 checks → **20 total**. (The implementation plan's
prose said "18"; that was an arithmetic slip — the harness asserts 20.)

## Results (current)

`TOTAL: 20 passed, 0 failed`
