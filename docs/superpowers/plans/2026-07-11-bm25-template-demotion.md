---
review:
  plan_hash: df6d57f4d24b4049
  last_run: 2026-07-11
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-11-bm25-template-demotion-intent.md
  spec: docs/superpowers/specs/2026-07-11-bm25-template-demotion-design.md
---
# BM25 Template Demotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eval-only controlled boilerplate/template demotion variants to the HLD retrieval harness and verify whether BM25/RRF can beat current `weighted-lexical` without guard regressions.

**Architecture:** Keep runtime Query and plugin settings unchanged. Extend `scripts/eval-jsonl-domain-storage.ts` with local demotion helpers, demoted variants, demotion metadata, guard reasons, and report sections. Use existing gold metrics and legacy-overlap gates as the acceptance surface.

**Tech Stack:** TypeScript, Node test runner via `node --import tsx --test`, existing BM25/RRF/eval helpers, iwiki MCP for docs.

---

## File Structure

- Modify `scripts/eval-jsonl-domain-storage.ts`
  - Add boilerplate detection helper.
  - Add deterministic rank-level demotion helper.
  - Extend `RetrievalVariantId`, `VariantMetrics`, and `QueryVariantResult`.
  - Add demoted variants and parameter sweep.
  - Add top-1 boilerplate guard and report sections.
- Modify `tests/eval-jsonl-domain-storage.test.ts`
  - Add helper-level tests through exported helper functions.
  - Add synthetic fixture assertion for demoted variant/report output.
- Modify `docs/superpowers/evals/jsonl-domain-storage-hld-eval.md`
  - Regenerate live HLD report after implementation.
- Modify `docs/rag-quality-recommendations.md`
  - Document demotion outcome and setting recommendation.
- Modify `docs/TODO.md`
  - Mark plan and result state through chain gate.
- Modify `docs/superpowers/plans/2026-07-11-bm25-template-demotion.md`
  - Add `result_check` after implementation.
- Create `docs/superpowers/reports/bm25-template-demotion-results.html`
  - Final chain result report.
- Update iwiki `jsonl-domain-storage`, heading `Eval`.

## Task 1: Demotion Helpers and Unit Coverage

**Files:**
- Modify: `scripts/eval-jsonl-domain-storage.ts`
- Modify: `tests/eval-jsonl-domain-storage.test.ts`

- [ ] **Step 1.1: Write failing helper tests**

Append to `tests/eval-jsonl-domain-storage.test.ts`:

```ts
import {
  demoteBoilerplateTopForEval,
  isBoilerplatePathForEval,
} from "../scripts/eval-jsonl-domain-storage";

test("isBoilerplatePathForEval only matches generated template pages", () => {
  assert.equal(isBoilerplatePathForEval("!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md"), true);
  assert.equal(isBoilerplatePathForEval("!Wiki/hld-jsonl-eval/pages/template-readme.md"), true);
  assert.equal(isBoilerplatePathForEval("!Wiki/hld-jsonl-eval/pages/normal-template-analysis.md"), false);
  assert.equal(isBoilerplatePathForEval("!Wiki/hld-jsonl-eval/pages/интеграция-систем-потребителей-с-етп-дата.md"), false);
});

test("demoteBoilerplateTopForEval moves boilerplate behind stable candidates", () => {
  const ranked = [
    "!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md",
    "!Wiki/hld-jsonl-eval/pages/primary.md",
    "!Wiki/hld-jsonl-eval/pages/template-readme.md",
    "!Wiki/hld-jsonl-eval/pages/direct.md",
    "!Wiki/hld-jsonl-eval/pages/supporting.md",
  ];

  const demoted = demoteBoilerplateTopForEval(ranked, 0.50, 5);

  assert.deepEqual(demoted, [
    "!Wiki/hld-jsonl-eval/pages/primary.md",
    "!Wiki/hld-jsonl-eval/pages/direct.md",
    "!Wiki/hld-jsonl-eval/pages/supporting.md",
    "!Wiki/hld-jsonl-eval/pages/template-hld-v2-standard.md",
    "!Wiki/hld-jsonl-eval/pages/template-readme.md",
  ]);
});
```

- [ ] **Step 1.2: Run helper tests and confirm RED**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: fails because `isBoilerplatePathForEval` and `demoteBoilerplateTopForEval` are not exported.

- [ ] **Step 1.3: Implement helper exports**

Add near `uniqueTop` in `scripts/eval-jsonl-domain-storage.ts`:

```ts
export function isBoilerplatePathForEval(vaultPath: string): boolean {
  const name = path.basename(vaultPath, ".md").toLowerCase();
  return name === "template-readme" || name.startsWith("template-hld-");
}

export function demoteBoilerplateTopForEval(
  rankedPaths: string[],
  factor: number,
  limit: number,
): string[] {
  if (limit <= 0) return [];
  const strength = Math.max(0, Math.min(1, factor));
  const unique = uniqueTop(rankedPaths, rankedPaths.length);
  const penalty = Math.max(1, Math.ceil(strength * limit * 2));
  return unique
    .map((pathValue, index) => ({
      path: pathValue,
      index,
      adjusted: index + (isBoilerplatePathForEval(pathValue) ? penalty : 0),
    }))
    .sort((a, b) => (a.adjusted - b.adjusted) || (a.index - b.index))
    .map((item) => item.path)
    .slice(0, limit);
}
```

Implementation note: this helper demotes by rank position, not score. Stronger factors add a larger rank penalty. Do not use gold labels as replacement source.

- [ ] **Step 1.4: Run helper tests and commit**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
git add scripts/eval-jsonl-domain-storage.ts tests/eval-jsonl-domain-storage.test.ts
git commit -m "feat(eval): add boilerplate demotion helpers"
```

Expected: eval harness tests pass.

## Task 2: Demoted Variants, Guards, and Report Fields

**Files:**
- Modify: `scripts/eval-jsonl-domain-storage.ts`
- Modify: `tests/eval-jsonl-domain-storage.test.ts`

- [ ] **Step 2.1: Write failing report assertions**

In `tests/eval-jsonl-domain-storage.test.ts`, inside the synthetic HLD test after existing report assertions, add:

```ts
assert.match(report, /Demotion factor:/);
assert.match(report, /Top-1 boilerplate:/);
assert.match(report, /BM25 contribution:/);
assert.match(report, /Demotion contribution:/);
assert.match(report, /Setting recommendation:/);
assert.equal(result.variantMetrics.some((variant) => variant.id === "weighted-lexical-demoted"), true);
```

- [ ] **Step 2.2: Run test and confirm RED**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: fails because demoted variants and report sections do not exist.

- [ ] **Step 2.3: Extend types**

In `scripts/eval-jsonl-domain-storage.ts`, extend `RetrievalVariantId`:

```ts
export type RetrievalVariantId =
  | "weighted-lexical"
  | "bm25-page"
  | "bm25-chunk"
  | "rrf-weighted-bm25"
  | "rrf-weighted-bm25-legacy"
  | "weighted-lexical-demoted"
  | "rrf-weighted-bm25-demoted"
  | "rrf-weighted-bm25-legacy-demoted";
```

Extend `VariantMetrics`:

```ts
export interface VariantMetrics {
  id: RetrievalVariantId;
  recallAt5: number;
  ndcgAt5: number;
  mrr: number;
  legacyOverlapAt5: number;
  accepted: boolean;
  demotionFactor?: number;
  top1Boilerplate: boolean;
  guardReasons: string[];
}
```

Extend `QueryVariantResult`:

```ts
export interface QueryVariantResult {
  id: RetrievalVariantId;
  top: string[];
  metrics: VariantMetrics;
  demotionFactor?: number;
  demotionMoved: Array<{ from: string; to: string }>;
}
```

- [ ] **Step 2.4: Update metric construction**

Replace `toVariantMetrics` with:

```ts
function toVariantMetrics(
  id: RetrievalVariantId,
  labels: GoldLabel[],
  top: string[],
  baselineTop: string[],
  currentFloor: number,
  demotionFactor?: number,
): VariantMetrics {
  const gold = scoreGoldRanking(labels, top, 5);
  const legacyOverlapAt5 = overlapRatio(baselineTop, top, 5);
  const top1Boilerplate = top.length > 0 && isBoilerplatePathForEval(top[0]);
  const guardReasons: string[] = [];
  if (legacyOverlapAt5 < currentFloor) {
    guardReasons.push(`legacy overlap ${legacyOverlapAt5.toFixed(2)} < floor ${currentFloor.toFixed(2)}`);
  }
  if (top1Boilerplate) guardReasons.push("top-1 boilerplate");
  return {
    id,
    recallAt5: gold.recallAtK,
    ndcgAt5: gold.ndcgAtK,
    mrr: gold.mrr,
    legacyOverlapAt5,
    accepted: guardReasons.length === 0,
    demotionFactor,
    top1Boilerplate,
    guardReasons,
  };
}
```

Update `aggregateVariantMetrics` so aggregate `accepted` also requires no per-query guard reasons and aggregate `mrr >= 0.90`:

```ts
accepted: variants.length === queries.length &&
  variants.every((variant) => variant.metrics.accepted) &&
  (variants.reduce((sum, item) => sum + item.metrics.mrr, 0) / variants.length) >= 0.90,
```

- [ ] **Step 2.5: Add demoted ranked lists**

Near existing variant list creation in `runQueries`, add:

```ts
const DEMOTION_FACTORS = [0.15, 0.25, 0.35, 0.50] as const;
function demotionMoved(before: string[], after: string[]): Array<{ from: string; to: string }> {
  const out: Array<{ from: string; to: string }> = [];
  before.slice(0, 5).forEach((from, index) => {
    const to = after[index];
    if (to && to !== from) out.push({ from, to });
  });
  return out;
}
```

Build demoted candidates:

```ts
const demotedVariantInputs: Array<{
  id: RetrievalVariantId;
  top: string[];
  demotionFactor?: number;
  demotionMoved: Array<{ from: string; to: string }>;
}> = [];

for (const factor of DEMOTION_FACTORS) {
  const weightedDemoted = demoteBoilerplateTopForEval(jsonlTop, factor, 10);
  demotedVariantInputs.push({
    id: "weighted-lexical-demoted",
    top: weightedDemoted,
    demotionFactor: factor,
    demotionMoved: demotionMoved(jsonlTop, weightedDemoted),
  });

  const rrfDemoted = demoteBoilerplateTopForEval(rrfWeightedBm25Top, factor, 10);
  demotedVariantInputs.push({
    id: "rrf-weighted-bm25-demoted",
    top: rrfDemoted,
    demotionFactor: factor,
    demotionMoved: demotionMoved(rrfWeightedBm25Top, rrfDemoted),
  });

  const rrfLegacyDemoted = demoteBoilerplateTopForEval(rrfWeightedBm25LegacyTop, factor, 10);
  demotedVariantInputs.push({
    id: "rrf-weighted-bm25-legacy-demoted",
    top: rrfLegacyDemoted,
    demotionFactor: factor,
    demotionMoved: demotionMoved(rrfWeightedBm25LegacyTop, rrfLegacyDemoted),
  });
}
```

Add them to `variants` after raw variants. When mapping, pass `demotionFactor` into `toVariantMetrics`.

- [ ] **Step 2.6: Update best variant selection**

Update `chooseBestVariant`:

```ts
const candidates = variants.filter((variant) =>
  variant.accepted &&
  variant.mrr >= 0.90 &&
  !variant.top1Boilerplate &&
  (variant.id === "weighted-lexical" || variant.ndcgAt5 > weighted.ndcgAt5 || variant.recallAt5 > weighted.recallAt5)
);
```

Sort by accepted status, `ndcgAt5`, `recallAt5`, `mrr`, then smaller `demotionFactor ?? 0`.

- [ ] **Step 2.7: Update report rendering**

In aggregate table, add columns:

```md
| Variant | Factor | Recall@5 | nDCG@5 | MRR | LegacyOverlap@5 | Top-1 boilerplate | Accepted |
```

In each query section after `Variants vs weighted-lexical`, add:

```ts
lines.push("BM25 contribution:");
const bestBm25 = query.variants
  .filter((variant) => variant.id.includes("bm25"))
  .sort((a, b) => b.metrics.ndcgAt5 - a.metrics.ndcgAt5)[0];
lines.push(bestBm25
  ? `- best BM25-family variant \`${bestBm25.id}\`: ΔnDCG@5 ${signed(bestBm25.metrics.ndcgAt5 - weighted.metrics.ndcgAt5)}, ΔRecall@5 ${signed(bestBm25.metrics.recallAt5 - weighted.metrics.recallAt5)}`
  : "- no BM25-family variant available");
lines.push("Demotion contribution:");
for (const variant of query.variants.filter((item) => item.demotionFactor !== undefined)) {
  const moved = variant.demotionMoved.length === 0
    ? "no top-5 movement"
    : variant.demotionMoved.map((item) => `\`${item.from}\` -> \`${item.to}\``).join("; ");
  lines.push(`- \`${variant.id}\` factor ${variant.demotionFactor}: ${moved}`);
}
```

At top-level after aggregate metrics:

```ts
const recommended = result.bestVariant.includes("demoted")
  ? `candidate: ${result.variantMetrics.find((variant) => variant.id === result.bestVariant)?.demotionFactor ?? "unknown"}`
  : "none";
lines.push(`Setting recommendation: \`${recommended}\``);
```

- [ ] **Step 2.8: Run tests and commit**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
git add scripts/eval-jsonl-domain-storage.ts tests/eval-jsonl-domain-storage.test.ts
git commit -m "feat(eval): compare demoted retrieval variants"
```

Expected: eval harness tests pass and report assertions pass.

## Task 3: Live Eval, Documentation, and Wiki

**Files:**
- Modify: `docs/superpowers/evals/jsonl-domain-storage-hld-eval.md`
- Modify: `docs/rag-quality-recommendations.md`
- Update: iwiki `jsonl-domain-storage`

- [ ] **Step 3.1: Run live HLD eval**

```bash
node --import tsx scripts/eval-jsonl-domain-storage.ts --source "/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD" --out docs/superpowers/evals/jsonl-domain-storage-hld-eval.md --eval-root .jsonl-domain-storage-hld-eval
node -e "require('node:fs').rmSync('.jsonl-domain-storage-hld-eval', { recursive: true, force: true })"
```

Expected:

- report includes demoted variants;
- report includes `Setting recommendation:`;
- if accepted, best variant passes all intent guards;
- if `needs_tuning`, report explains guard failures without changing runtime.

- [ ] **Step 3.2: Inspect live metrics**

```bash
sed -n '10,40p' docs/superpowers/evals/jsonl-domain-storage-hld-eval.md
grep -n "Setting recommendation:\\|Top-1 boilerplate:\\|Demotion contribution:\\|Regressions:" docs/superpowers/evals/jsonl-domain-storage-hld-eval.md
```

Expected: enough evidence to decide whether a setting candidate exists.

- [ ] **Step 3.3: Update `docs/rag-quality-recommendations.md`**

Update the "Без метрик — тюнинг вслепую" section with final live outcome:

- whether demotion beat `weighted-lexical`;
- winning factor or `none`;
- whether a plugin setting is recommended for a follow-up;
- reminder that runtime Query did not change.

- [ ] **Step 3.4: Update iwiki**

Use MCP:

1. `wiki_status`
2. `wiki_bind(read=["obsidian-ai-wiki"], write="obsidian-ai-wiki")`
3. `wiki_update_page(domain="obsidian-ai-wiki", slug="jsonl-domain-storage", heading="Eval", ...)`
4. `wiki_lint(domain="obsidian-ai-wiki")`

The wiki update must include the live demotion outcome and setting recommendation.

- [ ] **Step 3.5: Commit docs and live report**

```bash
git add docs/superpowers/evals/jsonl-domain-storage-hld-eval.md docs/rag-quality-recommendations.md
git commit -m "docs(eval): record template demotion eval"
```

Expected: live report and repo docs committed.

## Task 4: Verification, Result Gate, Push

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/superpowers/plans/2026-07-11-bm25-template-demotion.md`
- Create: `docs/superpowers/reports/bm25-template-demotion-results.html`

- [ ] **Step 4.1: Run focused tests**

```bash
node --import tsx --test tests/bm25.test.ts tests/retrieval-eval-metrics.test.ts tests/eval-jsonl-domain-storage.test.ts tests/lexical-retrieval.test.ts tests/wiki-index-jsonl.test.ts
```

Expected: all pass.

- [ ] **Step 4.2: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: lint has no errors; existing unrelated warnings may remain. Build passes.

- [ ] **Step 4.3: Record result check**

Compute plan body hash:

```bash
awk 'BEGIN{fm=0} /^---$/{fm++; next} fm>=2{print}' docs/superpowers/plans/2026-07-11-bm25-template-demotion.md | sha256sum | cut -c1-16
```

Add to plan frontmatter:

```yaml
result_check:
  verdict: OK
  plan_hash: <computed>
  last_run: 2026-07-11
```

Update `docs/TODO.md` row:

```md
| bm25-template-demotion | done | ✓ | ✓ | ✓ | OK | 2026-07-11 | 2026-07-11 | BM25 retest plus controlled boilerplate/template demotion; <live outcome> |
```

- [ ] **Step 4.4: Create final HTML report**

Create `docs/superpowers/reports/bm25-template-demotion-results.html` as one self-contained HTML report with:

- intent/spec/plan/result summary;
- changed files;
- live metrics;
- demotion factor outcome;
- setting recommendation;
- verification evidence;
- wiki lint evidence.

- [ ] **Step 4.5: Commit result artifacts**

```bash
git add docs/TODO.md docs/superpowers/plans/2026-07-11-bm25-template-demotion.md docs/superpowers/reports/bm25-template-demotion-results.html
git commit -m "docs(eval): document template demotion result"
```

- [ ] **Step 4.6: Push and open PR**

```bash
git status --short --branch
git push -u origin dev-bm25-template-demotion
gh pr create --draft --base master --head dev-bm25-template-demotion --title "feat(eval): add template demotion variants" --body-file /tmp/bm25-template-demotion-pr.md
```

Expected: draft PR opened, branch mergeable.

## Acceptance Checklist

- [ ] Demotion is eval-only; runtime Query and plugin settings unchanged.
- [ ] Existing BM25/RRF variants remain visible.
- [ ] Demoted variants include factor metadata.
- [ ] Report includes top-1 boilerplate guard.
- [ ] Report includes BM25 contribution and demotion contribution.
- [ ] Report includes setting recommendation: `none` or `candidate: <factor>`.
- [ ] Live HLD eval verifies whether `nDCG@5 > 0.91` or `Recall@5 > 0.76`.
- [ ] Live HLD eval keeps `avg Overlap@5 >= 0.65`.
- [ ] Live HLD eval keeps `MRR >= 0.90`.
- [ ] Live HLD eval has no top-1 boilerplate/template result in accepted variant.
- [ ] Focused tests, lint, build, and `wiki_lint` pass or documented unrelated warnings only.
