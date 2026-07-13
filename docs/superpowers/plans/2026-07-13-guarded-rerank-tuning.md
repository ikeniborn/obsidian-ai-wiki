---
review:
  plan_hash: 1a0a2a9fd62e7f3f
  last_run: 2026-07-13
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    executability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-13-guarded-rerank-tuning-intent.md
  spec: docs/superpowers/specs/2026-07-13-guarded-rerank-tuning-design.md
result_check:
  verdict: OK
  plan_hash: 1a0a2a9fd62e7f3f
  last_run: 2026-07-13
---
# Guarded Rerank Tuning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tune the reranker pipeline so enabled runtime reranking uses guarded baseline-preserving scoring and richer candidate text, with integration eval evidence against `/v1/rerank`.

**Architecture:** Keep `src/reranker.ts` as the runtime boundary. Add pure helpers for candidate text, guarded score blending, page-aware candidate hygiene, and promotion caps, then make the integration eval compare full-rerank and guarded variants. Reranker remains disabled unless the user enables it, but enabled runtime reranking now defaults to the accepted page-aware confidence gate.

**Final tuning result:** the accepted runtime/eval variant is `page-aware-alpha-0.60-cap-1-gap-0.20-base-0.95-top3`: page scope, alpha `0.60`, max promotion `1`, min normalized score gap `0.20`, min baseline score ratio `0.95`, max promotion target index `2`, candidate text cap `120`.

**Tech Stack:** TypeScript, Node test runner, existing LiteLLM-compatible `/rerank` endpoint, existing HLD eval harness.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/reranker.ts` | Runtime config, candidate text building, guarded score blending, transport fallback. |
| `tests/reranker.test.ts` | Unit tests for guarded scoring, query-aware candidate text, and unchanged fallback semantics. |
| `scripts/eval-reranker-integration.ts` | Model-on HLD eval, variant sweep, report rendering. |
| `tests/eval-reranker-integration.test.ts` | Mock `/rerank` integration tests for variants and report shape. |
| `docs/superpowers/evals/reranker-integration-hld-eval.md` | Generated model-on evidence report. |
| `docs/TODO.md` | Chain task tracking row for `guarded-rerank-tuning`. |
| iWiki `jsonl-domain-storage` | Runtime/eval documentation after behavior changes. |

## Task 1: Guarded Runtime Rerank

**Files:**
- Modify: `tests/reranker.test.ts`
- Modify: `src/reranker.ts`

- [ ] **Step 1: Add failing tests for guarded score blending**

Add tests showing:

```ts
test("applyRerankerScores uses guarded blending over baseline order", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 5), chunk("b", 4), chunk("c", 3), chunk("d", 2)],
    [
      { id: "d::0", score: 1.0 },
      { id: "a::0", score: 0.1 },
      { id: "b::0", score: 0.1 },
      { id: "c::0", score: 0.1 },
    ],
    4,
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["a", "b", "c", "d"]);
});
```

And:

```ts
test("applyRerankerScores lets strong nearby reranker evidence move within guarded bounds", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 5), chunk("b", 4), chunk("c", 3)],
    [
      { id: "b::0", score: 1.0 },
      { id: "a::0", score: 0.0 },
      { id: "c::0", score: 0.0 },
    ],
    3,
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["b", "a", "c"]);
});
```

- [ ] **Step 2: Run the focused test and confirm RED**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: the first guarded test fails because current full rerank puts `d` first.

- [ ] **Step 3: Implement guarded blending**

In `src/reranker.ts`, add fixed constants:

```ts
export const DEFAULT_RERANKER_BLEND_ALPHA = 0.60;
export const DEFAULT_RERANKER_MAX_PROMOTION = 1;
export const DEFAULT_RERANKER_PROMOTION_SCOPE = "page";
export const DEFAULT_RERANKER_MIN_PROMOTION_SCORE_GAP = 0.20;
export const DEFAULT_RERANKER_MIN_PROMOTION_BASELINE_RATIO = 0.95;
export const DEFAULT_RERANKER_MAX_PROMOTION_TARGET_INDEX = 2;
export const DEFAULT_RERANKER_CANDIDATE_TEXT_CHARS = 120;
```

Update `applyRerankerScores` to normalize finite scores and sort by:

```text
1 / (index + 1) + DEFAULT_RERANKER_BLEND_ALPHA * normalizedScore
```

Tie-break by original index.

For page-aware runtime defaults, group candidates by page, apply promotion gates at page level, and emit chunks in page-order round-robin. A promoted page can move up by one slot only when:

- reranker normalized score gap against the displaced page is at least `0.20`;
- promoted page baseline score is at least `0.95` of the displaced page baseline score;
- target page index is `<= 2`.

- [ ] **Step 4: Run focused test and confirm GREEN**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: pass.

## Task 2: Query-Aware Candidate Text

**Files:**
- Modify: `tests/reranker.test.ts`
- Modify: `src/reranker.ts`

- [ ] **Step 1: Add failing candidate text tests**

Cover:

```ts
test("buildRerankerCandidates includes title path heading and query-aware excerpt", () => {
  const source = chunk("orders", 1);
  source.path = "!Wiki/demo/Orders Flow.md";
  source.heading = "## Export";
  source.body = "Intro text. The export endpoint sends orders to ClickHouse consumers. Tail text.";

  const [candidate] = buildRerankerCandidates("How does export work?", [source], {
    enabled: true,
    model: "custom-reranker",
    rerankerTopN: 1,
    contextTopN: 1,
    timeoutMs: 800,
  });

  assert.match(candidate.text, /Title: Orders Flow/);
  assert.match(candidate.text, /Path: !Wiki\/demo\/Orders Flow\.md/);
  assert.match(candidate.text, /Heading: ## Export/);
  assert.match(candidate.text, /Text: .*export endpoint sends orders/);
});
```

Also cover fallback excerpt and cap length.

- [ ] **Step 2: Run focused test and confirm RED**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: compile or assertion failure because `buildRerankerCandidates` does not accept query and does not emit structured text.

- [ ] **Step 3: Implement query-aware candidate text**

Change signature:

```ts
buildRerankerCandidates(query: string, chunks: SelectedChunk[], config: RerankerConfig): RerankerCandidate[]
```

Update `rerankChunks` to pass `query`.

Use helpers for whitespace normalization, title extraction, query token extraction, and excerpt selection.

- [ ] **Step 4: Run focused test and confirm GREEN**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: pass.

## Task 3: Eval Variants

**Files:**
- Modify: `scripts/eval-reranker-integration.ts`
- Modify: `tests/eval-reranker-integration.test.ts`

- [ ] **Step 1: Add failing eval tests**

Add or update tests so mock eval verifies:

- report includes `full-rerank`;
- report includes `guarded-alpha-0.25-cap-1`;
- final verdict is based on best guarded accepted variant;
- zero successful calls remains blocked;
- API keys are absent from report.

- [ ] **Step 2: Run eval test and confirm RED**

```bash
node --import tsx --test tests/eval-reranker-integration.test.ts
```

Expected: failure because current report has only one reranked result.

- [ ] **Step 3: Implement variant sweep**

Add internal variant config for:

```ts
full-rerank
guarded-alpha-0.15
guarded-alpha-0.25
guarded-alpha-0.35
```

Also include promotion-cap variants:

```text
guarded-alpha-0.05-cap-0
guarded-alpha-0.05-cap-1
guarded-alpha-0.10-cap-2
page-aware-alpha-0.60-cap-1-gap-0.20-base-0.95-top3
```

Reuse one endpoint call per query when possible: call reranker once for candidate scores, then compute full and guarded orders locally from the same scores.

- [ ] **Step 4: Render variant report**

Report baseline once, then variant table with aggregate metrics, deltas, p95 latency, rerank calls, and verdict. Keep per-query detail concise but include top lists for the best variant and any regressed variants.

- [ ] **Step 5: Run eval tests and confirm GREEN**

```bash
node --import tsx --test tests/eval-reranker-integration.test.ts
```

Expected: pass.

## Task 4: Verification And Real Eval

**Files:**
- Modify: `docs/superpowers/evals/reranker-integration-hld-eval.md`
- Modify: iWiki `jsonl-domain-storage`

- [ ] **Step 1: Run unit/integration tests**

```bash
node --import tsx --test tests/reranker.test.ts tests/eval-reranker-integration.test.ts tests/eval-jsonl-domain-storage.test.ts
```

Expected: pass.

- [ ] **Step 2: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: pass. Existing lint warnings unrelated to this change may remain.

- [ ] **Step 3: Run real LiteLLM eval**

Load `tests/.env.reranker` without printing secrets, use endpoint path `/rerank`, and run:

```bash
npx tsx scripts/eval-reranker-integration.ts --source "<HLD path>" --out docs/superpowers/evals/reranker-integration-hld-eval.md --endpoint-path /rerank
```

Expected: report records real successful rerank calls and a final verdict.

- [ ] **Step 4: Update iWiki and lint**

Update `jsonl-domain-storage` retrieval/eval sections with guarded rerank behavior and latest LiteLLM evidence, then run:

```text
wiki_lint(domain="obsidian-ai-wiki")
```

Expected: no new broken/stale pages.

- [ ] **Step 5: Run result reconciliation**

Run `$check-chain result docs/superpowers/plans/2026-07-13-guarded-rerank-tuning.md`.

Expected: `OK` only if tests, build, eval, docs, and wiki evidence match this plan.
