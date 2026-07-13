---
review:
  plan_hash: a34638eef578bdd8
  last_run: 2026-07-12
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
result_check:
  verdict: OK
  plan_hash: a34638eef578bdd8
  last_run: 2026-07-12
  reviewed: true
  docs_checked: true
chain:
  intent: docs/superpowers/intents/2026-07-12-reranker-quality-pipeline-intent.md
  spec: docs/superpowers/specs/2026-07-12-reranker-quality-pipeline-design.md
---
# Reranker Quality Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add runtime reranker settings and a bounded optional reranker pipeline after candidate union, with explicit top-K controls and deterministic fallback.

**Architecture:** Keep lexical, description-vector, chunk-vector, and graph retrieval as recall inputs. Normalize reranker settings in one pure module, route Query candidates through a bounded reranker adapter when enabled, and fall back to current ordering on every adapter failure path. Replace hidden `seedTopK * 3` limits with explicit `rerankerTopN` and `contextTopN`.

**Tech Stack:** TypeScript, Obsidian settings API, OpenAI-compatible native-agent base URL/API key, Node test runner via `node --import tsx --test`, existing HLD eval harness, iwiki MCP for documentation.

---

## File Structure

- Create `src/reranker.ts`
  - Owns reranker config normalization, candidate/result types, bounded candidate selection, `/rerank` request/response parsing, timeout handling, and fallback reasons.
- Modify `src/types.ts`
  - Adds optional native-agent reranker settings and safe defaults.
- Modify `src/settings.ts`
  - Adds a native-agent `Reranker` settings block with toggle, model picker/text input, `rerankerTopN`, `contextTopN`, timeout, flow explanation, and validation notice.
- Modify `src/i18n.ts`
  - Adds English, Russian, and Spanish labels/descriptions for reranker settings.
- Modify `src/agent-runner.ts`
  - Normalizes reranker settings and passes them into single-domain and cross-domain Query.
- Modify `src/phases/query.ts`
  - Adds explicit candidate/context limits, reranker config, reranker adapter call, diagnostics, and fallback.
- Modify `src/phases/query-cross-domain.ts`
  - Removes `seedTopK * 3`, applies the same explicit limits and reranker fallback to cross-domain Query.
- Modify tests:
  - Create `tests/reranker.test.ts`.
  - Extend `tests/query-jsonl-index.test.ts` only if a focused runtime regression can be added without large fixture churn.
- Modify docs/wiki:
  - Update `docs/superpowers/specs/2026-07-12-reranker-quality-pipeline-design.md` only if implementation discovers a necessary design adjustment.
  - Update iwiki `jsonl-domain-storage`, heading `Retrieval`, after behavior changes.

## Task 1: Reranker Config and Pure Ordering Helpers

**Files:**
- Create: `src/reranker.ts`
- Create: `tests/reranker.test.ts`

- [ ] **Step 1.1: Add failing config tests**

Create `tests/reranker.test.ts` with:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RERANKER_SETTINGS,
  applyRerankerScores,
  buildRerankerCandidates,
  normalizeRerankerConfig,
} from "../src/reranker";
import type { SelectedChunk } from "../src/page-similarity";

function chunk(id: string, score: number): SelectedChunk {
  return {
    articleId: id,
    path: `!Wiki/demo/${id}.md`,
    heading: "## Section",
    body: `Body for ${id}`,
    score,
    source: "graph",
    ordinal: 0,
  };
}

test("normalizeRerankerConfig applies disabled legacy defaults", () => {
  assert.deepEqual(normalizeRerankerConfig(undefined), {
    enabled: false,
    model: "",
    rerankerTopN: DEFAULT_RERANKER_SETTINGS.rerankerTopN,
    contextTopN: DEFAULT_RERANKER_SETTINGS.contextTopN,
    timeoutMs: DEFAULT_RERANKER_SETTINGS.timeoutMs,
  });
});

test("normalizeRerankerConfig enforces rerankerTopN >= contextTopN", () => {
  assert.deepEqual(
    normalizeRerankerConfig({
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 3,
      contextTopN: 8,
      timeoutMs: 50,
    }),
    {
      enabled: true,
      model: "custom-reranker",
      rerankerTopN: 8,
      contextTopN: 8,
      timeoutMs: 100,
    },
  );
});

test("buildRerankerCandidates bounds candidates before adapter call", () => {
  const candidates = buildRerankerCandidates([chunk("a", 3), chunk("b", 2), chunk("c", 1)], {
    enabled: true,
    model: "custom-reranker",
    rerankerTopN: 2,
    contextTopN: 1,
    timeoutMs: 800,
  });

  assert.deepEqual(candidates.map((item) => item.id), ["a::0", "b::0"]);
  assert.equal(candidates[0].text, "## Section\nBody for a");
});

test("applyRerankerScores orders scored candidates and preserves fallback tail order", () => {
  const ranked = applyRerankerScores(
    [chunk("a", 3), chunk("b", 2), chunk("c", 1)],
    [
      { id: "b::0", score: 0.9 },
      { id: "a::0", score: 0.4 },
    ],
    3,
  );

  assert.deepEqual(ranked.map((item) => item.articleId), ["b", "a", "c"]);
});
```

- [ ] **Step 1.2: Run test and confirm RED**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: FAIL with module not found for `../src/reranker`.

- [ ] **Step 1.3: Implement config and pure helper module**

Create `src/reranker.ts` with these exported shapes and helpers:

```ts
import type { SelectedChunk } from "./page-similarity";

export const DEFAULT_RERANKER_SETTINGS = {
  enabled: false,
  model: "",
  rerankerTopN: 30,
  contextTopN: 8,
  timeoutMs: 800,
} as const;

export interface RerankerConfigInput {
  enabled?: boolean;
  model?: string;
  rerankerTopN?: number;
  contextTopN?: number;
  timeoutMs?: number;
}

export interface RerankerConfig {
  enabled: boolean;
  model: string;
  rerankerTopN: number;
  contextTopN: number;
  timeoutMs: number;
}

export interface RerankerCandidate {
  id: string;
  text: string;
  chunk: SelectedChunk;
}

export interface RerankerScore {
  id: string;
  score: number;
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.floor(n))) : fallback;
}

export function normalizeRerankerConfig(input?: RerankerConfigInput): RerankerConfig {
  const contextTopN = clampInt(input?.contextTopN, DEFAULT_RERANKER_SETTINGS.contextTopN, 1, 50);
  const requestedRerankerTopN = clampInt(input?.rerankerTopN, DEFAULT_RERANKER_SETTINGS.rerankerTopN, 1, 100);
  return {
    enabled: input?.enabled ?? DEFAULT_RERANKER_SETTINGS.enabled,
    model: (input?.model ?? DEFAULT_RERANKER_SETTINGS.model).trim(),
    rerankerTopN: Math.max(requestedRerankerTopN, contextTopN),
    contextTopN,
    timeoutMs: clampInt(input?.timeoutMs, DEFAULT_RERANKER_SETTINGS.timeoutMs, 100, 5000),
  };
}

export function rerankerChunkId(chunk: SelectedChunk): string {
  return `${chunk.articleId}::${chunk.ordinal}`;
}

export function buildRerankerCandidates(chunks: SelectedChunk[], config: RerankerConfig): RerankerCandidate[] {
  return chunks.slice(0, config.rerankerTopN).map((chunk) => ({
    id: rerankerChunkId(chunk),
    text: `${chunk.heading}\n${chunk.body}`.trim(),
    chunk,
  }));
}

export function applyRerankerScores(
  original: SelectedChunk[],
  scores: RerankerScore[],
  limit: number,
): SelectedChunk[] {
  const scoreById = new Map(scores.map((score) => [score.id, score.score]));
  return original
    .map((chunk, index) => ({ chunk, index, score: scoreById.get(rerankerChunkId(chunk)) }))
    .sort((a, b) => {
      const aScored = a.score !== undefined;
      const bScored = b.score !== undefined;
      if (aScored && bScored) return (b.score! - a.score!) || (a.index - b.index);
      if (aScored) return -1;
      if (bScored) return 1;
      return a.index - b.index;
    })
    .map((item) => item.chunk)
    .slice(0, Math.max(0, limit));
}
```

- [ ] **Step 1.4: Run test and confirm GREEN**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: PASS.

## Task 2: Reranker HTTP Adapter With Fallback Reasons

**Files:**
- Modify: `src/reranker.ts`
- Modify: `tests/reranker.test.ts`

- [ ] **Step 2.1: Add adapter tests with injectable transport**

Append tests to `tests/reranker.test.ts`:

```ts
import { rerankChunks } from "../src/reranker";

test("rerankChunks falls back when disabled or model is empty", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1)];
  const disabled = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({ enabled: false, model: "custom-reranker" }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    signal: new AbortController().signal,
  });
  const missingModel = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({ enabled: true, model: "" }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    signal: new AbortController().signal,
  });

  assert.equal(disabled.fallbackReason, "disabled");
  assert.deepEqual(disabled.chunks.map((item) => item.articleId), ["a", "b"]);
  assert.equal(missingModel.fallbackReason, "missing-model");
});

test("rerankChunks applies transport scores when adapter succeeds", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({ enabled: true, model: "custom-reranker", rerankerTopN: 2, contextTopN: 2 }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    signal: new AbortController().signal,
    transport: async () => [
      { id: "b::0", score: 0.99 },
      { id: "a::0", score: 0.10 },
    ],
  });

  assert.equal(result.fallbackReason, undefined);
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["b", "a"]);
});

test("rerankChunks falls back on transport error", async () => {
  const chunks = [chunk("a", 2), chunk("b", 1)];
  const result = await rerankChunks("question", chunks, {
    config: normalizeRerankerConfig({ enabled: true, model: "custom-reranker", contextTopN: 1 }),
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    signal: new AbortController().signal,
    transport: async () => {
      throw new Error("adapter failed");
    },
  });

  assert.equal(result.fallbackReason, "error");
  assert.deepEqual(result.chunks.map((item) => item.articleId), ["a"]);
});
```

- [ ] **Step 2.2: Run adapter tests and confirm RED**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: FAIL because `rerankChunks` is not exported.

- [ ] **Step 2.3: Implement adapter API**

Extend `src/reranker.ts` with:

```ts
export type RerankerFallbackReason =
  | "disabled"
  | "missing-model"
  | "empty-candidates"
  | "timeout"
  | "error"
  | "malformed-response";

export type RerankerTransport = (input: {
  query: string;
  candidates: RerankerCandidate[];
  config: RerankerConfig;
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
}) => Promise<RerankerScore[]>;

export interface RerankChunksOptions {
  config: RerankerConfig;
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
  transport?: RerankerTransport;
}

export interface RerankerRuntime {
  config: RerankerConfig;
  baseUrl: string;
  apiKey: string;
}

export interface RerankChunksResult {
  chunks: SelectedChunk[];
  durationMs: number;
  candidates: number;
  fallbackReason?: RerankerFallbackReason;
}

export async function rerankChunks(
  query: string,
  chunks: SelectedChunk[],
  options: RerankChunksOptions,
): Promise<RerankChunksResult> {
  const started = Date.now();
  const contextLimit = options.config.contextTopN;
  if (!options.config.enabled) {
    return { chunks: chunks.slice(0, contextLimit), durationMs: Date.now() - started, candidates: 0, fallbackReason: "disabled" };
  }
  if (!options.config.model) {
    return { chunks: chunks.slice(0, contextLimit), durationMs: Date.now() - started, candidates: 0, fallbackReason: "missing-model" };
  }

  const candidates = buildRerankerCandidates(chunks, options.config);
  if (candidates.length === 0) {
    return { chunks: [], durationMs: Date.now() - started, candidates: 0, fallbackReason: "empty-candidates" };
  }

  try {
    const transport = options.transport ?? fetchRerankerScores;
    const scores = await transport({
      query,
      candidates,
      config: options.config,
      baseUrl: options.baseUrl,
      apiKey: options.apiKey,
      signal: options.signal,
    });
    if (!scores.every((score) => score.id && Number.isFinite(score.score))) {
      return { chunks: chunks.slice(0, contextLimit), durationMs: Date.now() - started, candidates: candidates.length, fallbackReason: "malformed-response" };
    }
    return {
      chunks: applyRerankerScores(chunks, scores, contextLimit),
      durationMs: Date.now() - started,
      candidates: candidates.length,
    };
  } catch (err) {
    const fallbackReason = err instanceof DOMException && err.name === "AbortError" ? "timeout" : "error";
    return { chunks: chunks.slice(0, contextLimit), durationMs: Date.now() - started, candidates: candidates.length, fallbackReason };
  }
}
```

- [ ] **Step 2.4: Implement default `/rerank` transport**

Add `fetchRerankerScores` in `src/reranker.ts`:

```ts
export async function fetchRerankerScores(input: {
  query: string;
  candidates: RerankerCandidate[];
  config: RerankerConfig;
  baseUrl: string;
  apiKey: string;
  signal: AbortSignal;
}): Promise<RerankerScore[]> {
  const { requestUrl } = await import("obsidian");
  if (input.signal.aborted) throw new DOMException("Reranker aborted", "AbortError");
  const timeout = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new DOMException("Reranker timeout", "AbortError")), input.config.timeoutMs);
  });
  const resp = await Promise.race([
    requestUrl({
      url: `${input.baseUrl.replace(/\/$/, "")}/rerank`,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
      },
      body: JSON.stringify({
        model: input.config.model,
        query: input.query,
        documents: input.candidates.map((candidate) => candidate.text),
      }),
      throw: true,
    }),
    timeout,
  ]);
  const json = JSON.parse(resp.text) as { results?: Array<{ index?: number; relevance_score?: number; score?: number }> };
  return (json.results ?? []).flatMap((item) => {
    const index = item.index;
    const score = item.relevance_score ?? item.score;
    if (index === undefined || !Number.isInteger(index) || index < 0 || index >= input.candidates.length || !Number.isFinite(score)) return [];
    return [{ id: input.candidates[index].id, score }];
  });
}
```

- [ ] **Step 2.5: Run adapter tests and confirm GREEN**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: PASS.

## Task 3: Settings, Defaults, and Validation

**Files:**
- Modify: `src/types.ts`
- Modify: `src/settings.ts`
- Modify: `src/i18n.ts`

- [ ] **Step 3.1: Add settings fields and defaults**

Modify `src/types.ts`:

```ts
nativeAgent: {
  // existing fields stay unchanged
  rerankerEnabled?: boolean;
  rerankerModel?: string;
  rerankerTopN?: number;
  contextTopN?: number;
  rerankerTimeoutMs?: number;
};
```

Add defaults inside `DEFAULT_SETTINGS.nativeAgent`:

```ts
rerankerEnabled: false,
rerankerModel: "",
rerankerTopN: 30,
contextTopN: 8,
rerankerTimeoutMs: 800,
```

- [ ] **Step 3.2: Add i18n keys**

Add keys to English, Russian, and Spanish settings objects in `src/i18n.ts`. English values:

```ts
reranker_heading: "Reranker",
rerankerEnabled_name: "Enable reranker",
rerankerEnabled_desc: "Rerank bounded Query candidates before final context selection. Disabled by default until eval approves default-on behavior.",
rerankerModel_name: "Reranker model",
rerankerModel_desc: "Model name for rerank calls. No default model is recommended; use a model supported by your native endpoint.",
rerankerTopN_name: "Reranker input top-N",
rerankerTopN_desc: "Candidate chunks/pages sent to the reranker. Default 30. Must be greater than or equal to final context top-N.",
contextTopN_name: "Final context top-N",
contextTopN_desc: "Chunks sent to the answer LLM after rerank or fallback. Default 8.",
rerankerTimeoutMs_name: "Reranker timeout (ms)",
rerankerTimeoutMs_desc: "Timeout for rerank calls. Default 800 ms. On timeout Query falls back to pre-rerank order.",
rerankerFlow_desc: "Flow: seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN.",
rerankerInvalidTopN: "Reranker input top-N must be greater than or equal to final context top-N.",
```

- [ ] **Step 3.3: Add settings UI block**

In `src/settings.ts`, add the `Reranker` block after `Retrieval` controls in the native-agent area:

```ts
new Setting(containerEl).setName(T.settings.reranker_heading).setHeading();
new Setting(containerEl).setName(T.settings.rerankerFlow_desc);
new Setting(containerEl)
  .setName(T.settings.rerankerEnabled_name)
  .setDesc(T.settings.rerankerEnabled_desc)
  .addToggle((t) =>
    t.setValue(s.nativeAgent.rerankerEnabled ?? false)
      .onChange(async (v) => { s.nativeAgent.rerankerEnabled = v; await this.plugin.saveSettings(); this.display(); }),
  );
```

For the model row, reuse `this.addModelControl` with `s.nativeAgent.rerankerModel ?? ""`. The description must not name a concrete model.

For numeric fields, use text inputs and a local `saveRerankerLimits` helper in `display()`:

```ts
const saveRerankerLimits = async (patch: Partial<Pick<NonNullable<LlmWikiPluginSettings["nativeAgent"]>, "rerankerTopN" | "contextTopN" | "rerankerTimeoutMs">>) => {
  Object.assign(s.nativeAgent, patch);
  const rerankerTopN = s.nativeAgent.rerankerTopN ?? 30;
  const contextTopN = s.nativeAgent.contextTopN ?? 8;
  if (rerankerTopN < contextTopN) {
    s.nativeAgent.rerankerTopN = contextTopN;
    new Notice(T.settings.rerankerInvalidTopN);
  }
  await this.plugin.saveSettings();
};
```

- [ ] **Step 3.4: Verify settings compile**

```bash
npm run lint
npm run build
```

Expected: both commands exit `0`.

## Task 4: Query Wiring and Explicit Top-K Limits

**Files:**
- Modify: `src/agent-runner.ts`
- Modify: `src/phases/query.ts`
- Modify: `src/phases/query-cross-domain.ts`
- Modify: `src/types.ts`
  - Adds optional diagnostics/eval metadata fields only when the existing types require them for reranker telemetry.

- [ ] **Step 4.1: Thread normalized config from agent runner**

In `src/agent-runner.ts`, import `normalizeRerankerConfig` and construct:

```ts
const reranker = normalizeRerankerConfig({
  enabled: this.settings.nativeAgent.rerankerEnabled,
  model: this.settings.nativeAgent.rerankerModel,
  rerankerTopN: this.settings.nativeAgent.rerankerTopN,
  contextTopN: this.settings.nativeAgent.contextTopN,
  timeoutMs: this.settings.nativeAgent.rerankerTimeoutMs,
});
const rerankerRuntime = {
  config: reranker,
  baseUrl: this.settings.nativeAgent.baseUrl,
  apiKey: this.settings.nativeAgent.apiKey,
};
```

Pass `rerankerRuntime` into both `runQuery` and `runCrossDomainQuery`.

- [ ] **Step 4.2: Replace hidden single-domain multiplier**

In `src/phases/query.ts`, add `rerankerRuntime: RerankerRuntime` to `runQuery`.

Replace:

```ts
const topK = Math.max(1, Math.min(50, Math.floor(seedTopK)));
// ...
topK * 3
// ...
const chunkLimit = topK * 3;
```

with explicit limits:

```ts
const seedLimit = Math.max(1, Math.min(50, Math.floor(seedTopK)));
const candidateLimit = rerankerRuntime.config.rerankerTopN;
const contextLimit = rerankerRuntime.config.contextTopN;
```

Use `seedLimit` for page seed behavior, `candidateLimit` for chunk candidate gathering, and `contextLimit` only for final context chunks.

- [ ] **Step 4.3: Apply reranker before context rendering**

In `src/phases/query.ts`, after `selectRelevantChunks` and before `renderContextChunks`, call:

```ts
const reranked = await rerankChunks(question, selectedChunks, {
  config: rerankerRuntime.config,
  baseUrl: rerankerRuntime.baseUrl,
  apiKey: rerankerRuntime.apiKey,
  signal,
});
const contextChunks = reranked.chunks;
```

Use `contextChunks` for `renderContextChunks`, `finalSelectedIds`, diagnostics, and eval metadata.

- [ ] **Step 4.4: Replace hidden cross-domain multiplier**

In `src/phases/query-cross-domain.ts`, add `rerankerRuntime: RerankerRuntime` to config.

Replace:

```ts
topK: cfg.seedTopK * 3
Math.max(1, Math.min(50, Math.floor(cfg.seedTopK))) * 3
```

with:

```ts
topK: cfg.rerankerRuntime.config.rerankerTopN
cfg.rerankerRuntime.config.rerankerTopN
```

Then apply `rerankChunks` before `renderContextChunks`, using `cfg.rerankerRuntime.config.contextTopN` for final context.

- [ ] **Step 4.5: Add diagnostics**

Add fields to query diagnostics/eval metadata where the existing structures already carry retrieval configuration and counters:

```ts
reranker: {
  enabled: rerankerRuntime.config.enabled,
  candidates: reranked.candidates,
  selected: contextChunks.length,
  durationMs: reranked.durationMs,
  fallbackReason: reranked.fallbackReason,
}
```

Expected behavior:

- disabled reranker reports `fallbackReason: "disabled"`;
- missing model reports `fallbackReason: "missing-model"`;
- timeout/error preserves pre-rerank order.

- [ ] **Step 4.6: Verify hidden multiplier removal**

```bash
rg -n "seedTopK \\* 3|topK \\* 3|cfg\\.seedTopK\\)\\) \\* 3" src/phases/query.ts src/phases/query-cross-domain.ts
```

Expected: no matches.

## Task 5: Focused Tests and Build Verification

**Files:**
- Modify: `tests/reranker.test.ts`
- Modify: `tests/query-jsonl-index.test.ts`

- [ ] **Step 5.1: Add runtime limit regression test when fixture scope is small**

Add a focused regression test in `tests/query-jsonl-index.test.ts` that configures:

```ts
rerankerTopN: 3,
contextTopN: 2,
rerankerEnabled: false,
```

Expected assertion:

```ts
assert.equal(evalMeta.retrievalConfig.rerankerTopN, 3);
assert.equal(evalMeta.retrievalConfig.contextTopN, 2);
assert.equal(evalMeta.found_chunks.length <= 2, true);
```

If the existing fixture cannot expose `evalMeta` without broad unrelated rewrite, replace this step with an `rg`-based regression check committed in the plan result evidence, and document the fixture limitation in the final result report.

- [ ] **Step 5.2: Run focused tests**

```bash
node --import tsx --test tests/reranker.test.ts tests/query-jsonl-index.test.ts
```

Expected: PASS.

- [ ] **Step 5.3: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: both commands exit `0`.

## Task 6: No-Regression Eval, Docs, and Wiki

**Files:**
- Modify: `scripts/eval-jsonl-domain-storage.ts`
  - Passes explicit top-K/reranker config into runtime-equivalent runs when the current harness uses runtime Query paths.
- Modify: `docs/superpowers/evals/jsonl-domain-storage-hld-eval.md` with the new run evidence.
- Modify: iwiki `jsonl-domain-storage`, heading `Retrieval`.
- Modify: `docs/TODO.md` through check-chain result after implementation.

- [ ] **Step 6.1: Run HLD no-regression eval**

```bash
tsx scripts/eval-jsonl-domain-storage.ts
```

Expected:

- `Recall@5` does not fall below baseline.
- `nDCG@5` improves or does not regress.
- aggregate `MRR >= 0.90`.
- no per-query legacy-overlap floor regresses.
- p95 Query latency regression is at most `+500 ms`; above `+1 sec` stops the branch.

- [ ] **Step 6.2: Update docs with eval evidence**

Update `docs/superpowers/evals/jsonl-domain-storage-hld-eval.md` with:

```md
Runtime reranker settings eval:
- seedTopK = 8
- graphDepth = 1
- bfsTopK = 25
- rerankerTopN = 30
- contextTopN = 8
- rerankerTimeoutMs = 800
- reranker default state = disabled unless explicitly enabled for the eval variant
```

Record accepted/rejected verdicts and latency numbers from the actual run.

- [ ] **Step 6.3: Update iwiki**

Use iwiki MCP:

```text
wiki_update_page(domain="obsidian-ai-wiki", slug="jsonl-domain-storage", heading="Retrieval", ...)
wiki_lint(domain="obsidian-ai-wiki")
```

Expected: no broken refs, no stale pages for changed retrieval docs. Existing unrelated advisory-only section length warnings do not block this task.

- [ ] **Step 6.4: Final verification before result gate**

```bash
node --import tsx --test tests/reranker.test.ts tests/query-jsonl-index.test.ts
npm run lint
npm run build
tsx scripts/eval-jsonl-domain-storage.ts
rg -n "seedTopK \\* 3|topK \\* 3|cfg\\.seedTopK\\)\\) \\* 3" src/phases/query.ts src/phases/query-cross-domain.ts
```

Expected:

- tests PASS;
- lint PASS;
- build PASS;
- eval accepted or branch stops for user decision;
- final `rg` command prints no matches.

## Human Checkpoints

- Stop before enabling reranker by default in runtime settings.
- Stop if p95 Query latency regression exceeds `+1 sec`.
- Stop if eval requires changing gold labels or legacy floors.
- Stop if a separate paid/cloud reranker provider is required.

## Out Of Scope For This Plan

- Query expansion runtime implementation.
- Answer-grounding/citation gate runtime implementation.
- Automatic dedup/merge behavior changes.
- Recommending a concrete reranker model in settings.
- Adding `graphChunkTopN` before eval evidence shows graph chunks are too noisy or too narrow.
