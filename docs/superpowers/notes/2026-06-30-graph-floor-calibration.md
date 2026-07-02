# Graph Floor — Deferred Calibration & Wrap-up (Task 6)

Branch: `dev-graph-floor-formula`. Tasks 1–5 are implemented, reviewed, and
READY-TO-MERGE. Two steps are **deferred** because they need network/endpoint
access not available in the build sandbox. Run them later, in order.

## State at hand-off

- Formula shipped: `bar = loRef + bfsMinScoreRatio·(denseMax − loRef)`,
  `loRef = robustLow(domainCosines, FLOOR_LO_PCT)` (`src/retrieval-prune.ts`).
- **Uncalibrated defaults** currently in code: `FLOOR_LO_PCT = 0.05` (p5,
  `src/retrieval-prune.ts`) and `bfsMinScoreRatio = 0.6` (`src/types.ts`,
  `src/settings.ts`). These are placeholders until the sweep below picks real values.
- Deterministic tests green: `npx tsx eval/retrieval-prune/run.ts` (15),
  `npx tsx eval/graph-floor/analyze.test.ts` (5). `npm run build` + `npm run lint` clean.

## Step 1 — Live capture (needs the deepseek embedding endpoint)

Prereqs: a vault with a built embedding cache at
`<vault>/!Wiki/<domain>/_config/_embeddings.json`, and a real gold set.

1. Replace the placeholder entries in `eval/graph-floor/queries.json` with ~10–15
   real queries: `{ "id", "question", "domain", "goldPages": ["pageid-without-.md"] }`.
   `domain` is the folder name under `!Wiki/`; `goldPages` are the pages that MUST
   appear in the answer.
2. From the repo root, set the env and run the headless capture:

```bash
export WIKI_VAULT="/abs/path/to/vault"
export EMBED_BASE_URL="https://your-deepseek/v1"
export EMBED_MODEL="<embedding-model>"
export EMBED_DIM="<dim or empty>"
export EMBED_API_KEY="<key>"
npx tsx eval/graph-floor/run.ts
```

Expected: one `captured <id>: denseMax=… cands=…` line per query, then
`Wrote N records to eval/graph-floor/capture.json` (`capture.json` is gitignored).
Required env: `WIKI_VAULT`, `EMBED_BASE_URL`, `EMBED_MODEL` (guard exits 2 otherwise).

## Step 2 — Sweep & pick constants

```bash
npx tsx eval/graph-floor/analyze.ts
```

Read the table (`ratio  tokenCut%  minRecall  failing`). Pick the `Recommended
default ratio` line — the largest token cut with `failing = 0` (no gold page
pruned). If every non-zero ratio has `failing > 0`, raise `FLOOR_LO_PCT` (e.g.
`0.10`) in `src/retrieval-prune.ts` and rerun.

## Step 3 — Set the calibrated constants

- `FLOOR_LO_PCT` → `src/retrieval-prune.ts` (if the sweep changed it).
- default `ratio` → `src/types.ts` (`bfsMinScoreRatio: <value>`) and
  `src/settings.ts` (`?? <value>`), if it differs from `0.6`.

## Step 4 — Re-verify & commit

```bash
npx tsx eval/graph-floor/analyze.ts        # tokenCut% > 0 at the chosen default, minRecall = 1.00
npx tsx eval/graph-floor/analyze.test.ts   # OK — 5 passed
npx tsx eval/retrieval-prune/run.ts        # OK — 15 passed
npm run lint && npm run build
git add src/retrieval-prune.ts src/types.ts src/settings.ts dist/main.js
git commit -m "chore(retrieval): calibrate graph-floor constants on live deepseek cosines"
```

## Step 5 — iwiki index re-embed (also network-blocked in the sandbox)

The wiki pages were edited (`docs/wiki/retrieval.md`, `docs/wiki/operations.md`) but
the embedding index could not refresh (`HALT: embedding backend unreachable`). When
the iwiki embedding backend is reachable:

```bash
ENG="$(ls -d "$CLAUDE_CONFIG_DIR"/plugins/cache/*/iwiki/*/engine 2>/dev/null | sort -V | tail -1)"
"$(command -v uv)" run --project "$ENG" python3 -m iwiki_engine --wiki-dir docs/wiki index
```

Then `/iwiki-lint` should still report `broken=0, orphans=0` (it already does;
the `stale` flags on `operations.md`/`backends-and-config.md` clear on re-index).

## Step 6 — Finish the branch

After calibration: optionally run `/check-result` (IDD Result tab), then open the PR
(`dev-graph-floor-formula` → `master`) via the git-workflow / finishing-a-development-branch
skill. PR was intentionally NOT opened at hand-off (constants still uncalibrated).
