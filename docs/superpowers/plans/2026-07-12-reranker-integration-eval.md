---
review:
  plan_hash: 494e77ccd93a3fb3
  last_run: 2026-07-12
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-12-reranker-integration-eval-intent.md
  spec: docs/superpowers/specs/2026-07-12-reranker-integration-eval-design.md
---
# Reranker Integration Eval Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an additive integration eval that calls a real `/rerank` endpoint, compares baseline and reranked HLD retrieval quality, and proves the current plugin runtime pipeline remains intact.

**Architecture:** Keep the accepted offline HLD eval unchanged as the baseline gate. Add a sibling Node script for model-on `/rerank` evidence, reuse existing gold labels and lexical/graph/chunk scoring helpers, and test the script with a mock local `/rerank` server. Runtime Query/settings files are rechecked but not rewritten unless a confirmed blocker is found and the chain artifacts are updated first.

**Tech Stack:** TypeScript, Node test runner via `node --import tsx --test`, local HTTP mock server, existing HLD gold set, `src/reranker.ts` helper functions, iwiki MCP for documentation.

---

## File Structure

- Modify `scripts/eval-jsonl-domain-storage.ts`
  - Export existing pure/build helpers needed by the integration script without changing CLI output or current eval behavior.
- Create `scripts/eval-reranker-integration.ts`
  - Owns CLI parsing, eval-domain build orchestration, candidate construction, Node-side rerank transport, metrics, verdict, and markdown report rendering.
- Create `tests/eval-reranker-integration.test.ts`
  - Owns deterministic mock `/rerank` tests and blocked/malformed endpoint coverage.
- Modify `docs/superpowers/evals/reranker-integration-hld-eval.md`
  - Generated only when the real or mock integration eval command is run.
- Modify iwiki `jsonl-domain-storage`, heading `Eval`
  - Documents the distinction between offline HLD gate and model-on `/rerank` integration gate.

Runtime files to re-read and verify, not change by default:

- `src/reranker.ts`
- `src/agent-runner.ts`
- `src/phases/query.ts`
- `src/phases/query-cross-domain.ts`
- `src/settings.ts`
- `src/types.ts`

## Task 1: Export Eval Helpers Without Changing Offline Eval Behavior

**Files:**
- Modify: `scripts/eval-jsonl-domain-storage.ts`
- Test: `tests/eval-jsonl-domain-storage.test.ts`

- [ ] **Step 1.1: Export existing helper types/functions**

Change existing declarations only by adding `export`:

```ts
export interface SourceMarkdownFile {
  sourcePath: string;
  relPath: string;
  vaultPath: string;
  content: string;
}

export async function buildEvalDomain(source: string, evalRoot: string): Promise<{
  domainRoot: string;
  metadataPath: string;
  indexPath: string;
  logPath: string;
  files: SourceMarkdownFile[];
}> {
  // existing body unchanged
}

export function splitEvalSections(body: string, chunking: EvalChunkingConfig = EVAL_CHUNKING): EvalSection[] {
  // existing body unchanged
}

export function evalQueryTokens(query: HldQuery): Set<string> {
  // existing body unchanged
}

export function uniqueTop(paths: string[], limit: number): string[] {
  // existing body unchanged
}

export function overlapRatio(a: string[], b: string[], limit: number): number {
  // existing body unchanged
}

export const CURRENT_OVERLAP_AT_5: Record<string, number> = {
  // existing values unchanged
};
```

- [ ] **Step 1.2: Run existing HLD eval tests**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: all existing tests pass. This proves the export-only change did not change offline eval behavior.

## Task 2: Add Integration Eval Script And Pure Verdict Logic

**Files:**
- Create: `scripts/eval-reranker-integration.ts`

- [ ] **Step 2.1: Add public types and defaults**

Create the file with these exported shapes:

```ts
#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { buildWikiGraph, bfsExpandRanked, pageId } from "../src/wiki-graph";
import { demoteBoilerplateRankedItems, normalizeBoilerplateDemotionConfig } from "../src/boilerplate-demotion";
import { rankLexicalChunks, rankLexicalPages, fuseLexicalRanks } from "../src/lexical-retrieval";
import { scoreGoldRanking, validateGoldSet, type GoldMetrics, type GoldSet } from "../src/retrieval-eval-metrics";
import {
  normalizeRerankerConfig,
  parseRerankerResponseText,
  rerankChunks,
  type RerankerCandidate,
  type RerankerScore,
} from "../src/reranker";
import type { SelectedChunk } from "../src/page-similarity";
import {
  buildEvalDomain,
  buildHldQueries,
  CURRENT_OVERLAP_AT_5,
  evalQueryTokens,
  overlapRatio,
  splitEvalSections,
  uniqueTop,
  type HldQuery,
} from "./eval-jsonl-domain-storage";
import { parseWikiIndexJsonl, isPageIndexRecord } from "../src/wiki-index-jsonl";

export type RerankerIntegrationVerdict = "accepted" | "needs_tuning" | "blocked" | "rejected";

export interface RunRerankerIntegrationEvalOptions {
  source: string;
  outPath: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  evalRoot?: string;
  goldPath?: string;
  seedTopK?: number;
  graphDepth?: number;
  bfsTopK?: number;
  rerankerTopN?: number;
  contextTopN?: number;
  timeoutMs?: number;
}

export interface RerankerIntegrationQueryResult {
  id: string;
  theme: string;
  question: string;
  baselineTop: string[];
  rerankedTop: string[];
  baselineMetrics: GoldMetrics;
  rerankedMetrics: GoldMetrics;
  baselineLegacyOverlapAt5: number;
  rerankedLegacyOverlapAt5: number;
  floor: number;
  candidatesSent: number;
  rerankDurationMs: number;
  fallbackReason?: string;
  status: RerankerIntegrationVerdict;
  reason?: string;
}

export interface RerankerIntegrationEvalResult {
  source: string;
  evalRoot: string;
  outPath: string;
  baseUrl: string;
  model: string;
  markdownFiles: number;
  verdict: RerankerIntegrationVerdict;
  queries: RerankerIntegrationQueryResult[];
  aggregateBaseline: GoldMetrics;
  aggregateReranked: GoldMetrics;
  p95RerankLatencyMs: number;
  p95LatencyRegressionMs: number;
  rerankCalls: number;
  blockedReason?: string;
}

const DEFAULTS = {
  seedTopK: 8,
  graphDepth: 1,
  bfsTopK: 25,
  rerankerTopN: 30,
  contextTopN: 8,
  timeoutMs: 800,
  demotionFactor: 0.15,
} as const;
```

- [ ] **Step 2.2: Add CLI option resolution**

Implement these helpers:

```ts
function argValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function intArg(args: string[], flag: string, fallback: number): number {
  const raw = argValue(args, flag);
  const value = raw === undefined ? fallback : Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

export function optionsFromArgs(args: string[]): RunRerankerIntegrationEvalOptions {
  const source = argValue(args, "--source");
  const outPath = argValue(args, "--out");
  if (!source || !outPath) {
    throw new Error("Usage: npx tsx scripts/eval-reranker-integration.ts --source <HLD path> --out <report.md> --base-url <url> --model <model>");
  }
  return {
    source,
    outPath,
    baseUrl: argValue(args, "--base-url") ?? process.env.RERANK_BASE_URL,
    model: argValue(args, "--model") ?? process.env.RERANK_MODEL,
    apiKey: argValue(args, "--api-key") ?? process.env.RERANK_API_KEY ?? "",
    evalRoot: argValue(args, "--eval-root"),
    goldPath: argValue(args, "--gold"),
    seedTopK: intArg(args, "--seed-top-k", DEFAULTS.seedTopK),
    graphDepth: intArg(args, "--graph-depth", DEFAULTS.graphDepth),
    bfsTopK: intArg(args, "--bfs-top-k", DEFAULTS.bfsTopK),
    rerankerTopN: intArg(args, "--reranker-top-n", DEFAULTS.rerankerTopN),
    contextTopN: intArg(args, "--context-top-n", DEFAULTS.contextTopN),
    timeoutMs: intArg(args, "--timeout-ms", DEFAULTS.timeoutMs),
  };
}
```

- [ ] **Step 2.3: Add Node `/rerank` transport**

Implement:

```ts
async function fetchRerankScoresNode(input: {
  baseUrl: string;
  apiKey: string;
  query: string;
  model: string;
  candidates: RerankerCandidate[];
  signal: AbortSignal;
}): Promise<RerankerScore[]> {
  const response = await fetch(`${input.baseUrl.replace(/\/$/, "")}/rerank`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
    },
    body: JSON.stringify({
      model: input.model,
      query: input.query,
      documents: input.candidates.map((candidate) => candidate.text),
    }),
    signal: input.signal,
  });
  if (!response.ok) throw new Error(`rerank HTTP ${response.status}`);
  return parseRerankerResponseText(await response.text(), input.candidates);
}
```

- [ ] **Step 2.4: Add candidate builder that follows the fixed order**

Implement a function with this behavior:

```ts
function selectedChunkId(chunk: SelectedChunk): string {
  return `${chunk.articleId}::${chunk.ordinal}`;
}
```

Candidate construction must:

1. Rank lexical pages with `rankLexicalPages(queryTokens, pages, seedTopK)`.
2. Build `Map<vaultPath, content>`, build graph with `buildWikiGraph`, expand seeds with `bfsExpandRanked(seeds, graph, graphDepth, pages, question, bfsTopK)`.
3. Rank lexical chunks from expanded page IDs with `rankLexicalChunks(..., rerankerTopN)`.
4. Fuse page and chunk ranks with `fuseLexicalRanks`.
5. Apply `demoteBoilerplateRankedItems` with factor `0.15`.
6. Convert top chunk records to `SelectedChunk[]`.
7. Return no more than `rerankerTopN` chunks.

The script must include `seedTopK`, `graphDepth`, `bfsTopK`, `rerankerTopN`, and `contextTopN` in the report even when the graph has no edges.

- [ ] **Step 2.5: Add query runner and verdict logic**

Implement `runRerankerIntegrationEval(options)`:

```ts
export async function runRerankerIntegrationEval(
  options: RunRerankerIntegrationEvalOptions,
): Promise<RerankerIntegrationEvalResult> {
  const baseUrl = options.baseUrl?.trim() ?? "";
  const model = options.model?.trim() ?? "";
  const evalRoot = options.evalRoot ?? path.join(path.dirname(options.outPath), ".reranker-integration-hld-eval");

  if (!baseUrl || !model) {
    const result = blockedResult(options, evalRoot, baseUrl, model, "missing baseUrl or model");
    await writeReport(result);
    return result;
  }

  const built = await buildEvalDomain(options.source, evalRoot);
  const goldPath = options.goldPath ?? path.join(process.cwd(), "docs/superpowers/evals/hld-gold-set.json");
  const gold = JSON.parse(await readFile(goldPath, "utf8")) as GoldSet;
  const index = parseWikiIndexJsonl(await readFile(built.indexPath, "utf8"), built.indexPath);
  const pageRecords = index.filter(isPageIndexRecord);
  validateGoldSet(
    gold,
    buildHldQueries().map((query) => query.id),
    new Set(pageRecords.map((record) => record.path)),
    new Set(built.files.map((file) => file.relPath)),
  );

  // For each query: build candidates, call rerankChunks with injected Node transport,
  // score baseline and reranked top paths, collect latency and fallback reasons.
}
```

Verdict rules must match the spec:

- `blocked` for missing inputs, endpoint errors for all queries, malformed responses, or zero successful calls.
- `rejected` when p95 latency regression is at or above `1000`.
- `needs_tuning` when quality regresses but endpoint evidence exists.
- `accepted` only when all quality and latency gates pass.

- [ ] **Step 2.6: Add markdown report renderer**

Render these sections:

```md
# Reranker Integration HLD Eval

Source: `<source>`
Eval root: `<evalRoot>`
Endpoint: `<baseUrl-without-key>`
Model: `<model>`
Top-K flow: `seedTopK -> graphDepth/bfsTopK -> rerankerTopN -> contextTopN`
Reranker top N: `<n>`
Context top N: `<n>`
Timeout: `<ms>`
Verdict: `<accepted|needs_tuning|blocked|rejected>`

## Aggregate
...

## Queries
...

## Decision
...
```

Never print the API key.

- [ ] **Step 2.7: Add CLI entrypoint**

```ts
async function main(args: string[]): Promise<void> {
  const result = await runRerankerIntegrationEval(optionsFromArgs(args));
  console.log(`wrote ${result.outPath}`);
  if (result.verdict === "blocked" || result.verdict === "rejected") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(`[eval-reranker-integration] ${(err as Error).message}`);
    process.exit(1);
  });
}
```

## Task 3: Add Mock Endpoint Tests

**Files:**
- Create: `tests/eval-reranker-integration.test.ts`

- [ ] **Step 3.1: Add fixture and mock server helpers**

Create helpers:

```ts
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { runRerankerIntegrationEval } from "../scripts/eval-reranker-integration";

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function withRerankServer(
  handler: (body: unknown, res: ServerResponse) => void | Promise<void>,
  fn: (baseUrl: string, calls: unknown[]) => Promise<void>,
): Promise<void> {
  const calls: unknown[] = [];
  const server = createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/v1/rerank") {
      res.writeHead(404).end();
      return;
    }
    const body = await readJson(req);
    calls.push(body);
    await handler(body, res);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.equal(typeof address, "object");
  try {
    await fn(`http://127.0.0.1:${address!.port}/v1`, calls);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
```

- [ ] **Step 3.2: Add fixture domain helper**

Use five small source files and matching gold labels, one per HLD query, like the existing HLD eval test. The helper must return `{ source, out, evalRoot, goldPath }`.

- [ ] **Step 3.3: Add accepted mock rerank test**

Test:

```ts
test("reranker integration eval calls /rerank and records reranked order", async () => {
  await withRerankServer(async (body, res) => {
    const payload = body as { documents: string[] };
    assert.ok(payload.documents.length <= 4);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({
      results: payload.documents.map((_, index) => ({
        index,
        score: payload.documents.length - index,
      })),
    }));
  }, async (baseUrl, calls) => {
    const fixture = await createFixture();
    try {
      const result = await runRerankerIntegrationEval({
        ...fixture,
        baseUrl,
        model: "mock-reranker",
        rerankerTopN: 4,
        contextTopN: 2,
        timeoutMs: 800,
      });

      assert.equal(calls.length, 5);
      assert.notEqual(result.verdict, "blocked");
      assert.equal(result.queries.every((query) => query.candidatesSent <= 4), true);
      assert.equal(result.queries.every((query) => query.rerankedTop.length <= 2), true);
      const report = await readFile(fixture.outPath, "utf8");
      assert.match(report, /Reranker Integration HLD Eval/);
      assert.match(report, /Verdict:/);
      assert.doesNotMatch(report, /test-secret-key/);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3.4: Add missing model blocked test**

Expected: `result.verdict === "blocked"` and report contains `missing baseUrl or model`.

- [ ] **Step 3.5: Add malformed response blocked test**

Mock returns `{}`. Expected: result is not `accepted`, query fallback reasons include `malformed-response` or blocked reason includes malformed endpoint evidence.

- [ ] **Step 3.6: Run focused test**

```bash
node --import tsx --test tests/eval-reranker-integration.test.ts
```

Expected: all new tests pass.

## Task 4: Runtime Recheck And Existing Gates

**Files:**
- Read-only by default:
  - `src/reranker.ts`
  - `src/agent-runner.ts`
  - `src/phases/query.ts`
  - `src/phases/query-cross-domain.ts`
  - `src/settings.ts`
  - `src/types.ts`

- [ ] **Step 4.1: Recheck runtime reranker surfaces**

Verify by inspection:

- `DEFAULT_RERANKER_SETTINGS.enabled` remains `false`.
- `DEFAULT_SETTINGS.nativeAgent.rerankerEnabled` remains `false`.
- `fetchRerankerScores` still posts to `<baseUrl>/rerank` with `{ model, query, documents }`.
- `runQuery` calls `rerankChunks` after `selectRelevantChunks` and before `renderContextChunks`.
- `runCrossDomainQuery` merges candidates before rerank.
- Settings text does not recommend `BAAI/bge-reranker-v2-m3`.

- [ ] **Step 4.2: Run old pattern check**

```bash
rg -n "seedTopK \\* 3|topK \\* 3|cfg\\.seedTopK\\)\\) \\* 3|chunkLimit" src/phases/query.ts src/phases/query-cross-domain.ts
```

Expected: no matches. `rg` exit code `1` is success for this check.

- [ ] **Step 4.3: Run existing reranker tests**

```bash
node --import tsx --test tests/reranker.test.ts
```

Expected: all tests pass.

- [ ] **Step 4.4: Run existing HLD eval tests**

```bash
node --import tsx --test tests/eval-jsonl-domain-storage.test.ts
```

Expected: all tests pass.

- [ ] **Step 4.5: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: lint has `0 errors` and only the known pre-existing Node builtin warnings; build exits `0`.

- [ ] **Step 4.6: Run offline HLD retrieval eval**

```bash
npx tsx scripts/eval-jsonl-domain-storage.ts --source "/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD" --out docs/superpowers/evals/jsonl-domain-storage-hld-eval.md --gold docs/superpowers/evals/hld-gold-set.json
```

Expected: report says `Aggregate verdict: accepted`.

## Task 5: Real Endpoint Command And Documentation

**Files:**
- Modify: `docs/superpowers/evals/reranker-integration-hld-eval.md`
- Update iwiki: `jsonl-domain-storage`, heading `Eval`

- [ ] **Step 5.1: Run real integration eval when endpoint settings are available**

If the current shell has `RERANK_BASE_URL` and `RERANK_MODEL`, run:

```bash
npx tsx scripts/eval-reranker-integration.ts --source "/home/ikeniborn/Documents/Project/notes/vaults/Work/Ростелеком/Системная архитектура/HLD" --out docs/superpowers/evals/reranker-integration-hld-eval.md --gold docs/superpowers/evals/hld-gold-set.json
```

Expected: report is written and verdict is one of `accepted`, `needs_tuning`, `blocked`, or `rejected`.

If endpoint settings are unavailable, run a blocked smoke command with an empty model into a temporary output and record the blocker in the result report. Do not fabricate an accepted report.

- [ ] **Step 5.2: Update iwiki Eval section**

Update `jsonl-domain-storage`, heading `Eval`, to state:

- offline HLD retrieval eval remains the no-regression gate for retrieval baseline;
- `reranker-integration-hld-eval.md` is model-on evidence for a specific rerank endpoint path and model;
- accepted model-on evidence does not enable reranker by default;
- unavailable endpoint/model means blocked, not accepted.

- [ ] **Step 5.3: Run wiki lint**

```bash
wiki_lint(domain="obsidian-ai-wiki")
```

Expected: no broken refs, no orphan pages, no stale pages. Pre-existing advisory `long_lead` findings are not blockers.

## Task 6: Final Result Review

**Files:**
- Modify: `docs/TODO.md`
- Modify: `docs/superpowers/plans/2026-07-12-reranker-integration-eval.md`
- Create: `docs/superpowers/reports/reranker-integration-eval-results.html`

- [ ] **Step 6.1: Run final diff review**

Review all changed files for:

- no runtime default or Query behavior drift;
- no secret in reports;
- no changed gold labels or floors;
- integration eval fails or blocks honestly when endpoint/model are unavailable;
- reports distinguish offline baseline and model-on rerank evidence.

- [ ] **Step 6.2: Run result chain gate**

Update plan frontmatter with:

```yaml
result_check:
  verdict: OK
  plan_hash: <current plan body hash>
  last_run: 2026-07-12
  reviewed: true
  docs_checked: true
```

Only write `OK` if every required verification command passed and docs/wiki are current.

- [ ] **Step 6.3: Close task log row**

Update `docs/TODO.md` row:

```md
| reranker-integration-eval | done | ✓ | ✓ | ✓ | OK | 2026-07-12 | 2026-07-12 | Real /rerank endpoint integration eval for selected model |
```

- [ ] **Step 6.4: Generate final HTML report**

Create `docs/superpowers/reports/reranker-integration-eval-results.html` with Russian result summary, changed files, verification evidence, docs/wiki evidence, and final verdict.
