---
review:
  plan_hash: f41b711b2a968fa9
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
  spec: docs/superpowers/specs/2026-07-11-runtime-boilerplate-demotion-design.md
---
# Runtime Boilerplate Demotion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote the eval-winning boilerplate demotion factor `0.15` into runtime Query as a default-enabled advanced retrieval setting.

**Architecture:** Add one pure demotion helper module shared by runtime and eval. Apply demotion as a rank-level pass before top-K truncation; keep weighted lexical scores unchanged. Keep BM25/RRF as eval-only comparison variants, and require the rank-only HLD eval no-regression gate.

**Tech Stack:** TypeScript, Obsidian plugin settings API, Node test runner via `node --import tsx --test`, existing HLD eval harness, iwiki MCP for documentation.

---

## Revision After Eval Debug

The original plan explored score-plus-rank demotion, but live HLD eval showed a no-regression conflict: for `integrations-consumers-marts`, score-level demotion removed the gold-0 `template-hld-v2-standard` page from top-5 and improved semantic quality, but dropped legacy `Overlap@5` below the approved floor. The user chose the safe promotion path: **rank-only runtime demotion with factor `0.15`**.

This revision supersedes any older step text below that mentions score-level demotion, `weighted-lexical-score-rank-demoted`, or combined score-plus-rank runtime behavior. The final implementation must keep weighted lexical scores unchanged, apply only rank-level demotion in runtime, and use `weighted-lexical-demoted` factor `0.15` as the runtime-equivalent eval gate.

## File Structure

- Create `src/boilerplate-demotion.ts`
  - Owns narrow boilerplate path detection, config normalization, and rank demotion.
- Modify `src/lexical-retrieval.ts`
  - Keeps weighted lexical scoring unchanged; any score-level demotion from earlier commits must be removed.
- Modify `src/wiki-seeds.ts`
  - Keeps seed/page scoring unchanged and applies rank-level demotion after scoring.
- Modify `src/page-similarity.ts`
  - Stores demotion config in `PageSimilarityService` config and applies it to rank-level chunk ordering and sparse-side ordering.
- Modify `src/types.ts`
  - Adds `nativeAgent.boilerplateDemotionEnabled` and `nativeAgent.boilerplateDemotionFactor` with defaults.
- Modify `src/settings.ts`
  - Adds advanced Retrieval controls for toggle and factor.
- Modify `src/i18n.ts`
  - Adds English, Russian, and Spanish setting labels/descriptions.
- Modify `src/agent-runner.ts`
  - Normalizes settings and passes demotion config to single-domain and cross-domain Query.
- Modify `src/phases/query.ts`
  - Adds demotion config to `RetrieveCfg` and `runQuery`, then passes it into candidate retrieval and chunk similarity.
- Modify `src/phases/query-cross-domain.ts`
  - Uses `RetrieveCfg.boilerplateDemotion` for candidate merge and chunk similarity.
- Modify `scripts/eval-jsonl-domain-storage.ts`
  - Reuses runtime demotion helper and keeps `weighted-lexical-demoted` factor `0.15` as the runtime-equivalent gate.
- Modify tests:
  - `tests/lexical-retrieval.test.ts`
  - `tests/page-similarity-jsonl.test.ts`
  - `tests/eval-jsonl-domain-storage.test.ts`
  - add `tests/boilerplate-demotion.test.ts`
- Modify docs:
  - `docs/rag-quality-recommendations.md`
  - `docs/superpowers/evals/jsonl-domain-storage-hld-eval.md`
  - iwiki page `jsonl-domain-storage`, heading `Retrieval` or `Eval`

## Task 1: Pure Demotion Helper and Rank Demotion

**Files:**
- Create: `src/boilerplate-demotion.ts`
- Modify: `src/lexical-retrieval.ts`
- Create: `tests/boilerplate-demotion.test.ts`
- Modify: `tests/lexical-retrieval.test.ts`

- [ ] **Step 1.1: Add failing helper tests**

Create `tests/boilerplate-demotion.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_BOILERPLATE_DEMOTION_FACTOR,
  demoteBoilerplateRankedItems,
  isBoilerplatePath,
  normalizeBoilerplateDemotionConfig,
} from "../src/boilerplate-demotion";

test("isBoilerplatePath only matches generated template pages", () => {
  assert.equal(isBoilerplatePath("!Wiki/hld/pages/template-readme.md"), true);
  assert.equal(isBoilerplatePath("!Wiki/hld/pages/template-hld-v2-standard.md"), true);
  assert.equal(isBoilerplatePath("!Wiki/hld/pages/normal-template-analysis.md"), false);
  assert.equal(isBoilerplatePath("!Wiki/hld/pages/template-not-hld.md"), false);
  assert.equal(isBoilerplatePath(""), false);
});

test("normalizeBoilerplateDemotionConfig defaults and clamps values", () => {
  assert.deepEqual(normalizeBoilerplateDemotionConfig(undefined), {
    enabled: true,
    factor: DEFAULT_BOILERPLATE_DEMOTION_FACTOR,
  });
  assert.deepEqual(normalizeBoilerplateDemotionConfig({ enabled: false, factor: 0.8 }), {
    enabled: false,
    factor: 0.8,
  });
  assert.deepEqual(normalizeBoilerplateDemotionConfig({ enabled: true, factor: -1 }), {
    enabled: true,
    factor: 0,
  });
  assert.deepEqual(normalizeBoilerplateDemotionConfig({ enabled: true, factor: 2 }), {
    enabled: true,
    factor: 1,
  });
  assert.deepEqual(normalizeBoilerplateDemotionConfig({ enabled: true, factor: Number.NaN }), {
    enabled: true,
    factor: DEFAULT_BOILERPLATE_DEMOTION_FACTOR,
  });
});

test("demoteBoilerplateRankedItems preserves non-boilerplate order", () => {
  const ranked = [
    { id: "template-hld-v2-standard", path: "!Wiki/hld/pages/template-hld-v2-standard.md", score: 10 },
    { id: "primary", path: "!Wiki/hld/pages/primary.md", score: 9 },
    { id: "template-readme", path: "!Wiki/hld/pages/template-readme.md", score: 8 },
    { id: "direct", path: "!Wiki/hld/pages/direct.md", score: 7 },
    { id: "supporting", path: "!Wiki/hld/pages/supporting.md", score: 6 },
  ];

  const demoted = demoteBoilerplateRankedItems(ranked, { enabled: true, factor: 0.5 }, 5);

  assert.deepEqual(demoted.map((item) => item.id), [
    "primary",
    "direct",
    "supporting",
    "template-hld-v2-standard",
    "template-readme",
  ]);
});
```

- [ ] **Step 1.2: Run helper tests and confirm RED**

```bash
node --import tsx --test tests/boilerplate-demotion.test.ts
```

Expected: FAIL with module not found for `../src/boilerplate-demotion`.

- [ ] **Step 1.3: Create pure helper module**

Create `src/boilerplate-demotion.ts`:

```ts
import path from "path-browserify";

export const DEFAULT_BOILERPLATE_DEMOTION_FACTOR = 0.15;

export interface BoilerplateDemotionConfig {
  enabled: boolean;
  factor: number;
}

export interface BoilerplateDemotionInput {
  enabled?: boolean;
  factor?: number;
}

export interface RankedBoilerplateItem {
  path?: string;
  score?: number;
}

export function isBoilerplatePath(vaultPath: string | undefined): boolean {
  if (!vaultPath) return false;
  const name = path.basename(vaultPath, ".md").toLowerCase();
  return name === "template-readme" || name.startsWith("template-hld-");
}

export function normalizeBoilerplateDemotionConfig(
  input?: BoilerplateDemotionInput,
): BoilerplateDemotionConfig {
  const enabled = input?.enabled ?? true;
  const rawFactor = input?.factor ?? DEFAULT_BOILERPLATE_DEMOTION_FACTOR;
  const factor = Number.isFinite(rawFactor)
    ? Math.max(0, Math.min(1, rawFactor))
    : DEFAULT_BOILERPLATE_DEMOTION_FACTOR;
  return { enabled, factor };
}

export function demoteBoilerplateRankedItems<T extends RankedBoilerplateItem>(
  rankedItems: T[],
  config: BoilerplateDemotionConfig,
  limit: number,
): T[] {
  if (limit <= 0) return [];
  if (!config.enabled || config.factor <= 0) return rankedItems.slice(0, limit);
  const penalty = Math.max(1, Math.ceil(config.factor * Math.max(limit, rankedItems.length) * 2));
  return rankedItems
    .map((item, index) => ({
      item,
      index,
      adjusted: index + (isBoilerplatePath(item.path) ? penalty : 0),
    }))
    .sort((a, b) => (a.adjusted - b.adjusted) || (a.index - b.index))
    .map(({ item }) => item)
    .slice(0, limit);
}
```

- [ ] **Step 1.4: Run helper tests and confirm GREEN**

```bash
node --import tsx --test tests/boilerplate-demotion.test.ts
```

Expected: PASS for all helper tests.

- [ ] **Step 1.5: Verify lexical scoring remains unchanged**

Do not add `boilerplateDemotion` to `LexicalPageInput` or `LexicalChunkInput`. The weighted lexical scorer must stay a pure score calculator; rank demotion is tested through `demoteBoilerplateRankedItems` and runtime/eval ordering tests.

- [ ] **Step 1.6: Run lexical tests**

```bash
node --import tsx --test tests/lexical-retrieval.test.ts
```

Expected: PASS; no lexical score penalty is introduced.

- [ ] **Step 1.7: Keep lexical scoring unchanged**

Verify `src/lexical-retrieval.ts` has no boilerplate-demotion inputs and no score penalty. Boilerplate handling belongs only to ranked-list helpers that run after score computation.

- [ ] **Step 1.8: Run focused tests and commit**

```bash
node --import tsx --test tests/boilerplate-demotion.test.ts tests/lexical-retrieval.test.ts
git add src/boilerplate-demotion.ts src/lexical-retrieval.ts tests/boilerplate-demotion.test.ts tests/lexical-retrieval.test.ts
git commit -m "feat(retrieval): add boilerplate rank demotion"
```

Expected: tests pass and commit succeeds.

## Task 2: Runtime Settings and Query Threading

**Files:**
- Modify: `src/types.ts`
- Modify: `src/settings.ts`
- Modify: `src/i18n.ts`
- Modify: `src/wiki-seeds.ts`
- Modify: `src/page-similarity.ts`
- Modify: `src/agent-runner.ts`
- Modify: `src/phases/query.ts`
- Modify: `src/phases/query-cross-domain.ts`
- Modify: `tests/page-similarity-jsonl.test.ts`

- [ ] **Step 2.1: Add failing runtime threading tests**

Append to `tests/page-similarity-jsonl.test.ts`:

```ts
test("jaccard chunk fallback applies boilerplate demotion config", async () => {
  const pages = new Map([
    ["!Wiki/hld/pages/template-readme.md", "# Template\n\n## Компоненты\nзоны ответственности проектов"],
    ["!Wiki/hld/pages/owner.md", "# Owner\n\n## Компоненты\nзоны ответственности проектов"],
  ]);
  const ids = new Set(["template-readme", "owner"]);
  const service = new PageSimilarityService({
    mode: "jaccard",
    topK: 2,
    chunking: DEFAULT_CHUNKING,
    boilerplateDemotion: { enabled: true, factor: 0.15 },
  });

  const chunks = await service.selectRelevantChunks(
    "компоненты ответственность",
    pages,
    ids,
    ids,
    { "template-readme": 1, owner: 1 },
    2,
  );

  assert.equal(chunks[0].articleId, "owner");
});
```

- [ ] **Step 2.2: Run runtime test and confirm RED**

```bash
node --import tsx --test tests/page-similarity-jsonl.test.ts
```

Expected: FAIL because `PageSimilarityService` config has no `boilerplateDemotion`.

- [ ] **Step 2.3: Add settings types and defaults**

Modify `src/types.ts`:

```ts
nativeAgent: {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  topP: number | null;
  perOperation: boolean;
  operations: OpMap<NativeOperationConfig>;
  structuredRetries: number;
  thinkingBudgetTokens?: number;
  embeddingModel?: string;
  embeddingDimensions?: number;
  relevantPagesTopK?: number;
  mergeDeleteWarnThreshold?: number;
  chunkMaxChars?: number;
  chunkOverlapChars?: number;
  chunkMinChars?: number;
  chunkMaxCount?: number;
  hybridRetrieval?: boolean;
  rrfK?: number;
  bfsFusion?: boolean;
  bfsMinScoreRatio?: number;
  seedSimilarityThreshold?: number;
  boilerplateDemotionEnabled?: boolean;
  boilerplateDemotionFactor?: number;
  dedupOnIngest?: boolean;
  dedupThreshold?: number;
  lintNearDuplicate?: boolean;
  nearDupThreshold?: number;
};
```

In `DEFAULT_SETTINGS.nativeAgent` add:

```ts
boilerplateDemotionEnabled: true,
boilerplateDemotionFactor: 0.15,
```

- [ ] **Step 2.4: Add i18n strings**

Modify each language block in `src/i18n.ts`.

English:

```ts
boilerplateDemotion_name: "Boilerplate demotion",
boilerplateDemotion_desc: "Demote generated template/readme pages in lexical retrieval. Default on; only template-readme and template-hld-* are affected.",
boilerplateDemotionFactor_name: "Boilerplate demotion factor",
boilerplateDemotionFactor_desc: "Rank demotion factor, 0..1. Default 0.15 from the accepted HLD eval. BM25 remains eval-only.",
```

Russian:

```ts
boilerplateDemotion_name: "Демот boilerplate",
boilerplateDemotion_desc: "Понижает generated template/readme pages в lexical retrieval. По умолчанию включено; затрагивает только template-readme и template-hld-*.",
boilerplateDemotionFactor_name: "Фактор demotion boilerplate",
boilerplateDemotionFactor_desc: "Фактор понижения rank, 0..1. По умолчанию 0.15 из accepted HLD eval. BM25 остаётся только в eval.",
```

Spanish:

```ts
boilerplateDemotion_name: "Democión de boilerplate",
boilerplateDemotion_desc: "Baja páginas generadas template/readme en lexical retrieval. Activado por defecto; solo afecta template-readme y template-hld-*.",
boilerplateDemotionFactor_name: "Factor de democión boilerplate",
boilerplateDemotionFactor_desc: "Factor de democión de rank, 0..1. Por defecto 0.15 desde el HLD eval aceptado. BM25 sigue solo en eval.",
```

- [ ] **Step 2.5: Add settings UI controls**

Modify `src/settings.ts` under the existing `Retrieval` section after `Seed similarity threshold`:

```ts
new Setting(containerEl)
  .setName(T.settings.boilerplateDemotion_name)
  .setDesc(T.settings.boilerplateDemotion_desc)
  .addToggle((t) =>
    t.setValue(s.nativeAgent.boilerplateDemotionEnabled ?? true)
      .onChange(async (v) => {
        s.nativeAgent.boilerplateDemotionEnabled = v;
        await this.plugin.saveSettings();
      }),
  );

new Setting(containerEl)
  .setName(T.settings.boilerplateDemotionFactor_name)
  .setDesc(T.settings.boilerplateDemotionFactor_desc)
  .addSlider((sl) =>
    sl.setLimits(0, 1, 0.05)
      .setDynamicTooltip()
      .setValue(s.nativeAgent.boilerplateDemotionFactor ?? 0.15)
      .onChange(async (v) => {
        s.nativeAgent.boilerplateDemotionFactor = v;
        await this.plugin.saveSettings();
      }),
  );
```

- [ ] **Step 2.6: Thread demotion through seed scoring**

Modify `src/wiki-seeds.ts` imports:

```ts
import type { BoilerplateDemotionConfig } from "./boilerplate-demotion";
```

Change function signatures and scorer call:

```ts
export function scoreSeed(
  questionTokens: Set<string>,
  pageIdValue: string,
  content: string,
  annotation?: string,
  boilerplateDemotion?: BoilerplateDemotionConfig,
): number {
  const keywords = [...parseFmKeywords(content)].join(" ");
  return normalizeLexicalPageScore(scoreLexicalPage(questionTokens, {
    id: pageIdValue,
    path: pageIdValue,
    title: pageIdValue,
    description: [annotation, keywords].filter(Boolean).join("\n"),
    content: bodyContent(content),
    boilerplateDemotion,
  }).score);
}
```

```ts
export function selectSeeds(
  question: string,
  pages: Map<string, string>,
  topK: number,
  minScore: number,
  indexAnnotations?: Map<string, string>,
  boilerplateDemotion?: BoilerplateDemotionConfig,
): { id: string; score: number }[] {
  const q = tokenize(question);
  if (q.size === 0) return [];
  const scored: { id: string; score: number }[] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    const annotation = indexAnnotations?.get(id);
    const score = scoreSeed(q, id, content, annotation, boilerplateDemotion);
    if (score >= minScore && score > 0) scored.push({ id, score });
  }
  scored.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, topK);
}
```

- [ ] **Step 2.7: Thread demotion through `PageSimilarityService`**

Modify `src/page-similarity.ts` imports:

```ts
import type { BoilerplateDemotionConfig } from "./boilerplate-demotion";
import { demoteBoilerplateRankedItems } from "./boilerplate-demotion";
```

Extend its config interface with:

```ts
boilerplateDemotion?: BoilerplateDemotionConfig;
```

In `rankChunksJaccard`, add a config parameter:

```ts
function rankChunksJaccard(
  queryTokens: Set<string>,
  sections: CandidateSection[],
  limit: number,
  boilerplateDemotion?: BoilerplateDemotionConfig,
): SelectedChunk[] {
  const scored: SelectedChunk[] = [];
  for (const section of sections) {
    const score = scoreLexicalChunk(queryTokens, {
      articleId: section.articleId,
      path: section.path,
      heading: section.heading,
      body: section.body,
      embedText: section.embedText,
      ordinal: section.ordinal,
      boilerplateDemotion,
    }).score;
    if (score <= 0) continue;
    scored.push({
      articleId: section.articleId,
      path: section.path,
      heading: section.heading,
      body: section.body,
      score,
      source: section.source,
      articleScore: section.articleScore,
      ordinal: section.ordinal,
    });
  }
  return demoteBoilerplateRankedItems(sortSelectedChunks(scored), boilerplateDemotion ?? { enabled: false, factor: 0 }, limit);
}
```

Update every `rankChunksJaccard(queryTokens, sections, limit)` call to:

```ts
rankChunksJaccard(queryTokens, sections, limit, this.config.boilerplateDemotion)
```

For hybrid sparse page scoring, pass `this.config.boilerplateDemotion` into the weighted lexical scorer call.

- [ ] **Step 2.8: Thread normalized config through Query paths**

Modify `src/phases/query.ts` import:

```ts
import type { BoilerplateDemotionConfig } from "../boilerplate-demotion";
```

Extend `RetrieveCfg`:

```ts
boilerplateDemotion?: BoilerplateDemotionConfig;
```

Pass `cfg.boilerplateDemotion` to `selectSeeds` in both jaccard fallback and non-embedding paths.

Change fallback similarity construction:

```ts
const fallbackSimilarity = new PageSimilarityService({
  mode: "jaccard",
  topK: chunkLimit,
  boilerplateDemotion: cfg.boilerplateDemotion,
});
```

If `similarity` exists, create a query-local service preserving its config with demotion:

```ts
const chunkSimilarity = similarity
  ? similarity.withBoilerplateDemotion(cfg.boilerplateDemotion)
  : fallbackSimilarity;
```

Add `withBoilerplateDemotion` to `PageSimilarityService`:

```ts
withBoilerplateDemotion(boilerplateDemotion?: BoilerplateDemotionConfig): PageSimilarityService {
  return new PageSimilarityService({ ...this.config, boilerplateDemotion });
}
```

Modify `src/phases/query-cross-domain.ts` fallback similarity:

```ts
const fallbackSimilarity = new PageSimilarityService({
  mode: "jaccard",
  topK: cfg.seedTopK * 3,
  boilerplateDemotion: cfg.boilerplateDemotion,
});
const chunkSimilarity = similarity
  ? similarity.withBoilerplateDemotion(cfg.boilerplateDemotion)
  : fallbackSimilarity;
```

- [ ] **Step 2.9: Normalize settings in AgentRunner**

Modify `src/agent-runner.ts` imports:

```ts
import { normalizeBoilerplateDemotionConfig } from "./boilerplate-demotion";
```

Create config before `switch (req.operation)`:

```ts
const boilerplateDemotion = normalizeBoilerplateDemotionConfig({
  enabled: this.settings.nativeAgent.boilerplateDemotionEnabled,
  factor: this.settings.nativeAgent.boilerplateDemotionFactor,
});
```

Add to single-domain and cross-domain `RetrieveCfg` objects:

```ts
boilerplateDemotion,
```

For single-domain `runQuery`, pass the config as the final optional argument:

```ts
this.settings.nativeAgent.bfsMinScoreRatio ?? 0.6,
boilerplateDemotion,
```

Update `runQuery` signature:

```ts
boilerplateDemotion: BoilerplateDemotionConfig = { enabled: true, factor: 0.15 },
```

and include it in `cfg`.

- [ ] **Step 2.10: Run runtime focused tests and commit**

```bash
node --import tsx --test tests/boilerplate-demotion.test.ts tests/lexical-retrieval.test.ts tests/page-similarity-jsonl.test.ts
npm run lint
git add src/types.ts src/settings.ts src/i18n.ts src/wiki-seeds.ts src/page-similarity.ts src/agent-runner.ts src/phases/query.ts src/phases/query-cross-domain.ts tests/page-similarity-jsonl.test.ts
git commit -m "feat(query): enable runtime boilerplate demotion"
```

Expected: focused tests and lint pass; commit succeeds.

## Task 3: Runtime-Equivalent Eval Variant

**Files:**
- Modify: `scripts/eval-jsonl-domain-storage.ts`
- Modify: `tests/eval-jsonl-domain-storage.test.ts`
- Modify: `docs/superpowers/evals/jsonl-domain-storage-hld-eval.md`

- [ ] **Step 3.1: Add failing eval assertions**

In `tests/eval-jsonl-domain-storage.test.ts`, add one assertion inside the synthetic HLD test:

```ts
assert.equal(result.variantMetrics.some((variant) => variant.id === "weighted-lexical-demoted" && variant.demotionFactor === 0.15), true);
assert.match(report, /weighted-lexical-demoted/);
```

- [ ] **Step 3.2: Run eval test and confirm RED**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: FAIL because the runtime-equivalent variant is absent.

- [ ] **Step 3.3: Reuse runtime demotion helpers in eval**

Modify imports in `scripts/eval-jsonl-domain-storage.ts`:

```ts
import {
  DEFAULT_BOILERPLATE_DEMOTION_FACTOR,
  demoteBoilerplateRankedItems,
  isBoilerplatePath,
  normalizeBoilerplateDemotionConfig,
} from "../src/boilerplate-demotion";
```

Replace helper exports:

```ts
export function isBoilerplatePathForEval(vaultPath: string): boolean {
  return isBoilerplatePath(vaultPath);
}

export function demoteBoilerplateTopForEval(
  rankedPaths: string[],
  factor: number,
  limit: number,
): string[] {
  return demoteBoilerplateRankedItems(
    rankedPaths.map((pathValue) => ({ path: pathValue })),
    normalizeBoilerplateDemotionConfig({ enabled: true, factor }),
    limit,
  ).map((item) => item.path ?? "");
}
```

- [ ] **Step 3.4: Add runtime-equivalent variant id and construction**

Extend `RetrievalVariantId`:

```ts
| "weighted-lexical-demoted"
```

When scoring improved page/chunk ranks for the eval query, build demotion config:

```ts
const runtimeDemotion = normalizeBoilerplateDemotionConfig({
  enabled: true,
  factor: DEFAULT_BOILERPLATE_DEMOTION_FACTOR,
});
```

Use the same config for rank-level demotion after weighted lexical ranking. Then add:

```ts
const runtimeEquivalentTop = demoteBoilerplateTopForEval(
  runtimeWeightedTop,
  DEFAULT_BOILERPLATE_DEMOTION_FACTOR,
  10,
);
variantInputs.push({
  id: "weighted-lexical-demoted",
  top: runtimeEquivalentTop,
  demotionFactor: DEFAULT_BOILERPLATE_DEMOTION_FACTOR,
  demotionMoved: demotionMoved(runtimeWeightedTop, runtimeEquivalentTop),
});
```

The runtime-equivalent top must come from rank-demoted weighted lexical ranks and must keep lexical scores unchanged.

- [ ] **Step 3.5: Run eval test and live HLD eval**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
npx tsx scripts/eval-jsonl-domain-storage.ts --source /home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная\ архитектура/HLD --out docs/superpowers/evals/jsonl-domain-storage-hld-eval.md
```

Expected:
- test passes;
- command prints `wrote docs/superpowers/evals/jsonl-domain-storage-hld-eval.md`;
- report includes `Aggregate verdict: \`accepted\``;
- report includes `weighted-lexical-demoted`;
- runtime-equivalent variant with factor `0.15` passes all no-regression guards.

- [ ] **Step 3.6: Commit eval variant**

```bash
git add scripts/eval-jsonl-domain-storage.ts tests/eval-jsonl-domain-storage.test.ts docs/superpowers/evals/jsonl-domain-storage-hld-eval.md
git commit -m "feat(eval): add runtime-equivalent demotion gate"
```

Expected: commit succeeds.

## Task 4: Documentation, Build, and Chain Result

**Files:**
- Modify: `docs/rag-quality-recommendations.md`
- Modify: `docs/superpowers/plans/2026-07-11-runtime-boilerplate-demotion.md`
- Create: `docs/superpowers/reports/runtime-boilerplate-demotion-results.html`
- Update iwiki page: `jsonl-domain-storage`

- [ ] **Step 4.1: Update repository docs**

In `docs/rag-quality-recommendations.md`, replace the current candidate setting sentence:

```md
Candidate runtime setting, if implemented later: boilerplate demotion factor `0.15`; stronger factors reduce legacy overlap and fail guards.
```

with:

```md
Runtime Query now enables boilerplate demotion by default with factor `0.15`, the accepted HLD eval value. The runtime applies the factor as a final rank-level demotion pass for the narrow generated-page set: `template-readme` and `template-hld-*`. Raw BM25 and BM25/RRF variants remain eval-only because they did not beat weighted lexical in the accepted harness.
```

- [ ] **Step 4.2: Update iwiki**

Use iwiki MCP:

```text
wiki_update_page(domain="obsidian-ai-wiki", slug="jsonl-domain-storage", heading="Retrieval", new_body=<English markdown summary>, source="docs/rag-quality-recommendations.md")
wiki_lint(domain="obsidian-ai-wiki")
```

The new body must mention:
- runtime demotion default enabled;
- factor `0.15`;
- rank-only application;
- BM25/RRF remain eval-only;
- no-regression gate from the live HLD eval.

- [ ] **Step 4.3: Run full verification**

```bash
node --import tsx --test tests/boilerplate-demotion.test.ts tests/lexical-retrieval.test.ts tests/eval-jsonl-domain-storage.test.ts tests/page-similarity-jsonl.test.ts
npm run lint
npm run build
npx tsx scripts/eval-jsonl-domain-storage.ts --source /home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная\ архитектура/HLD --out docs/superpowers/evals/jsonl-domain-storage-hld-eval.md
```

Expected:
- node tests pass;
- lint passes;
- build passes;
- live eval writes the HLD report;
- live eval report shows accepted verdict and runtime-equivalent variant no-regression.

- [ ] **Step 4.4: Commit docs and build artifacts**

```bash
git add docs/rag-quality-recommendations.md docs/superpowers/evals/jsonl-domain-storage-hld-eval.md dist/main.js
git commit -m "docs(retrieval): document runtime boilerplate demotion"
```

Expected: commit succeeds. If `dist/main.js` is unchanged after `npm run build`, omit it from `git add`.

- [ ] **Step 4.5: Run result gate**

```text
$check-chain result docs/superpowers/plans/2026-07-11-runtime-boilerplate-demotion.md
```

Expected:
- result verdict `OK`;
- task log row `runtime-boilerplate-demotion` closes with `Result: OK`;
- final report exists at `docs/superpowers/reports/runtime-boilerplate-demotion-results.html`.

## Final Acceptance

- Runtime Query has default-enabled boilerplate demotion with factor `0.15`.
- Demotion applies as rank-level pass only.
- Single-domain and cross-domain Query use the same config.
- BM25/RRF stay out of runtime Query.
- Live HLD eval passes no-regression gate for the runtime-equivalent variant.
- Tests, lint, build, docs, iwiki lint, and result gate pass.
