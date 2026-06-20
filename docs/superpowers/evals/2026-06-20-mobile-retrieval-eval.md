# Mobile retrieval eval (gate + observability)

## Deterministic (no key)

```bash
node_modules/.bin/esbuild eval/mobile-fixes/run.ts \
  --bundle --platform=node --format=cjs \
  --alias:obsidian=./eval/mobile-fixes/obsidian-stub.ts \
  --loader:.md=text \
  --outfile=eval/mobile-fixes/run.cjs
node eval/mobile-fixes/run.cjs
```
(`--loader:.md=text` is required because the vision helper lives in
`attachment-analyzer.ts`, whose import tree pulls `.md` prompt files — the same
text-loader the plugin bundle uses.)
Expected: `ALL PASS`. Covers seed gate (dense cosine vs RRF-scale), retrieval tag,
cosine→denseMax, mobile-vision ext, source-folder filter.

## Live replay (homelab, native-agent hybrid)

Reproduces session `1781951993383`. With `hybridRetrieval: true`,
`seedSimilarityThreshold: 0.3`, `bge-m3`, run the query "График закаливания?" against
`https://homelab.ikeniborn.ru/v1`. Confirm `graph_stats` reports
`retrievalMode: hybrid`, a non-zero `denseMax ≥ 0.3`, NO `seedFallback`, and the
compact progress line ends with `· vector`. Before the fix the same query showed
`seedFallback: "jaccard"` and no vector tag.
