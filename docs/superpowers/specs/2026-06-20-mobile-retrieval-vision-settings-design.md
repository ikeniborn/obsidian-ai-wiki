---
review:
  spec_hash: 232a25cb20a0da09
  last_run: 2026-06-20
  phases:
    structure:   { status: passed }
    coverage:    { status: passed }
    clarity:     { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: structure
      severity: INFO
      section: "(document) repeated subsection headings"
      section_hash: 232a25cb20a0da09
      text: "Subsection headings 'Verification' (×4), 'Behavior', 'Changes' repeat across Part 1–4. Benign — each is scoped to a distinct parent Part; common spec pattern."
      verdict: accepted
      verdict_at: 2026-06-20
chain:
  intent: null
---

# Mobile fixes: vector-retrieval gate, settings hiding, vision format, source-suggest

- **Date:** 2026-06-20
- **Status:** Draft — awaiting review
- **Branch:** `dev/mobile-retrieval-vision` (per project branch workflow)

## Context

A mobile query (session `1781951993383`, op=`query`, domain `ilya-health`,
backend `native-agent`, model `qwen3.5:397b-cloud`) was reported as not visibly
using vector search. Investigation of `_agent.jsonl` plus the live plugin config
(`.obsidian/plugins/ai-wiki/data.json`) found a **deterministic bug**, not a
mobile transport problem.

Live config: `hybridRetrieval: true` (mode `hybrid`), `seedSimilarityThreshold: 0.3`,
embedding `bge-m3` (1024 dims, keyless — by design), `agentLogEnabled: false`.

### Root cause (Part 1)

In hybrid mode `PageSimilarityService.selectRelevantScored` →
`selectHybridScored` returns **RRF-fused** scores
(`src/rrf.ts` `score = Σ 1/(k + rank + 1)`, `k = 60`). The maximum attainable
fused score — an item ranked first in both the dense and sparse lists — is
`2/61 ≈ 0.033`.

The seed-quality gate in `src/phases/query.ts` (around line 88–101) compares this
fused score against `seedSimilarityThreshold`, which is calibrated for **raw
cosine** (range 0–1). With any threshold above ~0.033 the condition
`maxSeedScore < seedSimilarityThreshold` is **always true**, so the embedding
ranking is discarded and seeding always falls back to Jaccard
(`graph_stats.seedFallback = "jaccard"`, observed in the log; `seedScores` all
`1.0` from the Jaccard pass).

The documented intent (`docs/wiki/retrieval.md#Fusion`,
`docs/wiki/operations.md#Tier 2 Features`) is "embedding/hybrid seeds **below the
threshold** are dropped in favor of Jaccard" — i.e. the threshold is meant to
measure embedding confidence (cosine), which the hybrid path violates.

### Observability gap (Part 1)

Two failure modes produce the identical `seedFallback: "jaccard"` and cannot be
distinguished from progress output:
1. embedding ran, cosine below threshold (the actual case here), vs.
2. embedding HTTP failed and `selectEmbeddingScored` silently degraded to Jaccard
   (`catch → selectJaccardScored`, no event emitted).

Worse, `formatGraphStatsLines` (`src/view.ts:16`) only prints the
`Seed fallback:` line in the **trace** form (`agentLogEnabled = true`). With the
default compact form the fallback is invisible — exactly "не было видно в
прогрессе".

## Goals

1. Make vector/hybrid retrieval actually contribute seeds when the embedding
   signal is strong; keep the Jaccard/LLM escalation for genuinely weak signals.
2. Make the retrieval path observable in the default (compact) progress view, and
   distinguish "embedding failed" from "embedding weak".
3. Hide settings that do not apply on mobile (mobile runs only `query` + `format`).
4. Allow `format` (with vision) to be triggered on mobile.
5. Stop the wiki output folder (`!Wiki`) from appearing as a selectable domain
   source.

## Non-goals

- No rework of the retrieval algorithm beyond the gate scale fix (chunking, RRF,
  BFS fusion stay as-is).
- No new vision rendering on mobile for PDF/Excalidraw (images only).
- No change to the `timeouts` settings field (kept as-is, per decision).
- No change to desktop behavior for Parts 3/4 beyond the shared code touched.

---

## Part 1 — Retrieval gate fix (approach A) + observability

### Behavior

Gate on the **true dense cosine confidence**, not the fused score. When the
embedding signal clears the threshold, hybrid-RRF seeds are used (vector works).
When it does not, the existing Jaccard → `llmSelectSeeds` escalation runs
unchanged.

### Changes

**`src/page-similarity.ts`**
- Have the scored selection expose retrieval diagnostics. Add a method (or extend
  the existing `selectRelevantScored` return) that yields:
  - `results: { path; score }[]` — the mode's ranking (hybrid RRF or embedding
    cosine or jaccard), as today;
  - `denseMax: number` — the maximum **cosine** similarity from the dense side
    (embedding query-vector vs page vectors). `0` in pure-jaccard mode.
  - `embedFailed: boolean` — true when the embedding HTTP call(s) threw and the
    dense side degraded to Jaccard internally.
- `selectHybridScored` already computes the dense list (`selectEmbeddingScored`);
  surface its max cosine and failure flag instead of swallowing them.
- `selectEmbeddingScored`: capture the query-vector / batch failures into
  `embedFailed` rather than only returning the degraded list.

**`src/phases/query.ts`** (seed block, ~80–106)
- Replace `maxSeedScore` (fused) in the gate with `denseMax` from the diagnostics.
- Gate stays `if (denseMax < seedSimilarityThreshold) → Jaccard → (empty) llm`.
- Record `retrievalMode` (`config.mode`), `denseMax`, and a refined fallback
  reason: `"low-similarity"` vs `"embed-failed"`.

**`src/types.ts`** (`graph_stats` event)
- Add `retrievalMode?: "jaccard" | "embedding" | "hybrid"`, `denseMax?: number`,
  and widen the fallback reason (e.g. keep `seedFallback` and add
  `seedFallbackReason?: "low-similarity" | "embed-failed"`).

**`src/view.ts`** (`formatGraphStatsLines`)
- Compact form: append a retrieval tag to the `Граф:` line, e.g.
  `· vector` (embedding/hybrid seeds used), `· jaccard (low 0.21)`,
  or `· jaccard (embed failed)`. Trace form: add the same detail near the existing
  `Seed fallback:` line.

### Verification

- Eval harness (out-of-vault, esbuild `--alias:obsidian=stub`; see
  `eval/format-frontmatter/` as the template): unit the gate — feed a dense list
  whose `denseMax ≥ threshold` and assert hybrid-RRF seeds are used; feed
  `denseMax < threshold` and assert Jaccard fallback with reason `low-similarity`;
  simulate an embed throw and assert reason `embed-failed`.
- Replay the logged query ("График закаливания?") against
  `homelab.ikeniborn.ru/v1` and confirm `graph_stats` now reports
  `retrievalMode: hybrid`, vector seeds, no spurious Jaccard fallback.

---

## Part 2 — Hide mobile-irrelevant settings

Mobile executes only `query` + `format`. Wrap the following in
`!Platform.isMobile` in `src/settings.ts`:

- **"Graph health" subsection** (`~797–837`): Dedup on ingest, Dedup threshold,
  Lint near-duplicate report, Near-duplicate threshold, Merge-delete warn
  threshold — all ingest/lint-only.
- **Chunking fields** (`~746–765`): Chunk size / overlap / min / max — used only
  when building the embedding cache at ingest; mobile has no ingest, and query
  embeds annotations un-chunked.

Kept visible on mobile (used by query/format): General (system prompt, languages,
idle timeout/retries, history limit, agent log), Domains, native-agent base,
Semantic Search (enable / top-K / model / dimensions), Retrieval (hybrid / rrfK /
bfsFusion / seedSimilarityThreshold), Graph, Jaccard, Vision. Already hidden:
backend selector, claude-agent settings, per-operation models, proxy, dev mode.

`timeouts` field is **left unchanged** (shows all five ops).

### Verification

- Code review of the new `!Platform.isMobile` guards; confirm desktop layout
  unchanged and no kept setting is accidentally wrapped.

---

## Part 3 — Vision formatting on mobile

### Trigger

Add a `Format` button to the mobile branch of `src/view.ts` (`~160–173`), beside
the query section. Enable only when `activeFile && !path.startsWith("!Wiki/")`
(same `canFormat` rule as desktop, `~382`). Click → `controller.format()`.
`controller.ts:582` already permits `format` on mobile. Subscribe the mobile
button to active-leaf changes so its enabled state tracks the open file.

### Vision path

Native-agent already supports vision via `vision.enabled` +
`analyzeSingleAttachment` (a separate `vision.model`, producing text descriptions
injected into the format prompt). Images (png/jpg/webp) are mobile-safe:
`readBinary` via the Obsidian adapter, `btoa`, and a non-streaming LLM call
(`wrapMobileNoStream`). `hasVision` (multimodal `image_url`) stays
`backend === "claude-agent"` → false on mobile; that is correct — mobile uses the
description path.

### Graceful skip (images only)

Thread an `imageOnly` flag (= `Platform.isMobile`) from `controller` →
`AgentRunner` (new constructor param) → `runFormat` → `analyzeSingleAttachment`.
When set, PDF and Excalidraw embeds are skipped cleanly with an explicit
"unsupported on mobile" note, instead of relying on an `OffscreenCanvas` /
`pdfjsLib` throw. Carry the flag on the existing `visionSettings` object so
`src/phases/` stays obsidian-free (a plain boolean).

### Verification

- On mobile (or an emulated `Platform.isMobile`): format a note embedding an
  image → a `Vision` event fires and the description is integrated under the
  embed. Format a note embedding a PDF → a single "Vision skipped (unsupported on
  mobile)" note, no crash.
- Confirm the format preview → apply/keep flow (adapter `rename`) works on mobile;
  if not, capture as a follow-up (out of scope unless trivially adjacent).

---

## Part 4 — Exclude `!Wiki` from source-path suggestions

In `FolderInputSuggest.getSuggestions` (`src/modals.ts:180`), filter out the wiki
output tree: drop folders where `path === WIKI_ROOT` or
`path.startsWith(WIKI_ROOT + "/")` (import `WIKI_ROOT` from `src/wiki-path.ts`).

All three `FolderInputSuggest` call sites (`modals.ts:282, 489, 620`) are source-
path inputs — none select the wiki folder — so the exclusion is safe globally.
This also closes a latent feedback loop where the wiki could ingest its own output
(`!Wiki/sar/dags/`, `!Wiki/sar/storage/`).

### Verification

- Unit `getSuggestions` (or the underlying filter) excludes any `!Wiki`-prefixed
  folder while still returning ordinary folders matching the query.

---

## Cross-cutting

- **Branch workflow:** all work in `dev/mobile-retrieval-vision`, PR into
  `master` (per `CLAUDE.md`).
- **Docs:** after implementation, run `iwiki:iwiki-ingest` on the changed sources
  and `iwiki:iwiki-lint`. Update:
  - `docs/wiki/retrieval.md#Fusion` and `docs/wiki/operations.md#Tier 2 Features`
    — clarify the threshold now gates on dense cosine in both embedding and hybrid
    modes.
  - `docs/wiki/backends-and-config.md` (or the settings doc) — mobile-hidden
    settings.
  - `docs/wiki/operations.md#Format` — mobile format trigger + image-only vision.
  - `docs/wiki/index.md#Source layout` — `!Wiki` excluded from source suggestions.
- **Build:** rebuild `dist` bundle as part of the change (matches repo convention).
- **Lint/typecheck:** `npm run lint`; gate on **new** tsc errors in touched files
  only (baseline is not clean).

## Open questions

None outstanding — approach A, timeouts untouched, all four parts in one spec
(confirmed).
