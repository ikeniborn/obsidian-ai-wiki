---
review:
  plan_hash: 60650aae4563760b
  spec_hash: 391e0bd315589b1e
  last_run: 2026-06-29
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: consistency
      severity: WARNING
      section: "Task 4 Step 3"
      fragment: "widen its type in src/eval-log.ts to allow the two optional keys"
      text: "RetrievalConfigSnapshot is strictly typed; cross-domain retrievalConfig would not compile without widening"
      fix: "Widen the type as an explicit Task 4 sub-step; orchestrator fills all required + the two optional fields"
      verdict: fixed
      verdict_at: 2026-06-29
    - id: F-002
      phase: structure
      severity: WARNING
      section: "Task 6 Step 3"
      fragment: "const saved = this.plugin.localConfigStore ? undefined : undefined;"
      text: "Dead placeholder lines in syncScope, deletion deferred to Step 5"
      fix: "Remove dead lines directly in Step 3"
      verdict: fixed
      verdict_at: 2026-06-29
    - id: F-003
      phase: clarity
      severity: WARNING
      section: "Task 6 Step 3"
      fragment: "Persisted lastQueryScope is read on initial build (Step 4)"
      text: "Spec requires reading lastQueryScope on init, but no step actually read it"
      fix: "Read lastQueryScope via localConfigStore.load() and apply to scopeToggle on build"
      verdict: fixed
      verdict_at: 2026-06-29
    - id: F-004
      phase: dependencies
      severity: WARNING
      section: "Task 3 Step 1"
      fragment: "import { mergeCandidates } from ../../src/phases/query-cross-domain"
      text: "Task 3 dependency on Task 1 (DomainCandidates) not explicitly stated"
      fix: "Add a depends-on note to the Task 3 header"
      verdict: fixed
      verdict_at: 2026-06-29
    - id: F-005
      phase: consistency
      severity: INFO
      section: "Task 1"
      fragment: "seedOutputTokens: number"
      text: "Plan's DomainCandidates adds seedOutputTokens, absent from the spec's type"
      fix: "Intentional (llm-seed-fallback token reporting); optionally reflect in spec"
      verdict: accepted
      verdict_at: 2026-06-29
    - id: F-006
      phase: coverage
      severity: INFO
      section: "File Structure"
      fragment: "src/controller.ts | (no change)"
      text: "Spec lists controller.ts in Files Touched; plan marks it unchanged"
      fix: "Justified — query(q, '*') already flows through dispatch unchanged"
      verdict: accepted
      verdict_at: 2026-06-29
chain:
  intent: null
  spec: docs/superpowers/specs/2026-06-29-cross-domain-search-design.md
---

# Cross-Domain Wiki Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the sidebar is on `(all)`, run a real cross-domain query — gather candidate pages from every domain (vector + graph), re-rank the merged pool, and send one final set to the LLM.

**Architecture:** Approach A. Extract the retrieval half of `runQuery` into a reusable `retrieveDomainCandidates()` generator and the answer half into `answerFromContext()`. A new `runCrossDomainQuery()` orchestrator loops domains sequentially (stage 1), merges + fuses the pool with the existing `fuseVectorGraph` (stage 2), then calls `answerFromContext()` once. Routing uses a `"*"` `domainId` sentinel. No new settings.

**Tech Stack:** TypeScript, esbuild, Obsidian plugin API, OpenAI-compatible embeddings. Tests are out-of-vault `tsx` eval scripts (no Obsidian runtime), following `eval/legacy-sections/run.ts`.

**Spec:** `docs/superpowers/specs/2026-06-29-cross-domain-search-design.md`
**Branch:** `dev-cross-domain-search` (already created, in place).

**Conventions in this repo:**
- Run a single eval: `npx tsx eval/<name>/run.ts`
- Build: `npm run build` · Lint/typecheck: `npm run lint`
- Wiki page stems are globally unique (`wiki_<domain>_<slug>`), so merging graphs/score maps across domains is collision-free.

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/phases/query.ts` | Single-domain query; now also exports `retrieveDomainCandidates` + `DomainCandidates` | Modify (extract retrieval) |
| `src/phases/query-answer.ts` | Shared "context → streamed answer + link validation" tail | **Create** |
| `src/phases/query-cross-domain.ts` | `runCrossDomainQuery` orchestrator + `mergeCandidates` | **Create** |
| `src/agent-runner.ts` | Route `domainId === "*"` to `runCrossDomainQuery` | Modify |
| `src/eval-log.ts` | Two optional `RetrievalConfigSnapshot` fields (`crossDomain`, `domainsSearched`) | Modify |
| `src/controller.ts` | (no change — `query(q, "*")` already flows through `dispatch`) | — |
| `src/view.ts` | Scope toggle UI + `submitQuery` routing | Modify |
| `src/local-config.ts` | `lastQueryScope` persistence | Modify |
| `src/i18n.ts` | Scope labels (en/ru/es) | Modify |
| `eval/cross-domain/run.ts` | Out-of-vault eval: fakes + 7 assertions | **Create** |

---

## Task 1: Extract `retrieveDomainCandidates()` from `runQuery`

Behavior-preserving refactor: lift `query.ts` phases 1–4 into a reusable generator. `runQuery` keeps the answer half.

**Files:**
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Add the `DomainCandidates` + `RetrieveCfg` types and the `retrieveDomainCandidates` generator**

Insert just above `export async function* runQuery(` in `src/phases/query.ts`:

```ts
export interface RetrieveCfg {
  graphDepth: number;
  seedTopK: number;
  seedMinScore: number;
  bfsTopK: number;
  seedSimilarityThreshold: number;
}

export interface DomainCandidates {
  domainId: string;
  pages: Map<string, string>;        // ONLY candidate page content (seeds ∪ bfs)
  seeds: string[];
  candidateIds: Set<string>;         // seeds ∪ bfsTopK-expanded
  seedScores: Record<string, number>;
  expandedScores: Record<string, number>;
  graph: Map<string, Set<string>>;
  annotations: Map<string, string>;  // index annotations of candidates
  retrievalMode: RetrievalMode;
  denseMax: number;
  seedFallback: "none" | "jaccard" | "llm";
  seedFallbackReason?: SeedFallbackReason;
  seedOutputTokens: number;          // tokens spent if the llm-seed fallback ran
}

/**
 * Read index → select seeds (vector gate → jaccard → optional llm) → glob → read
 * pages → build graph → BFS-rank. Yields the existing progress events; returns the
 * candidate set (seeds ∪ bfs) or null when the domain has no usable seeds.
 *
 * `llmSeedFallback` is provided only by single-domain runQuery; cross-domain omits it
 * so an empty domain is skipped instead of costing one LLM call per domain.
 */
export async function* retrieveDomainCandidates(
  domain: DomainEntry,
  question: string,
  vaultTools: VaultTools,
  similarity: PageSimilarityService | undefined,
  signal: AbortSignal,
  cfg: RetrieveCfg,
  llmSeedFallback?: { llm: LlmClient; model: string; opts: LlmCallOptions },
): AsyncGenerator<RunEvent, DomainCandidates | null> {
  if (!domain.wiki_folder || domain.wiki_folder.includes("..")) {
    yield { kind: "error", message: `Wiki folder ${domain.wiki_folder} is outside the vault.` };
    return null;
  }
  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);

  yield { kind: "tool_use", name: "Read", input: { path: domainIndexPath(wikiVaultPath) } };
  await ensureDomainConfig(vaultTools, wikiVaultPath);
  const indexContent = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
  if (signal.aborted) return null;
  const indexAnnotations = parseIndexAnnotations(indexContent);
  yield { kind: "tool_result", ok: true, preview: `${indexAnnotations.size} annotations` };

  const topK = Math.max(1, Math.min(50, Math.floor(cfg.seedTopK)));
  const minScore = Math.max(0, Math.min(1, cfg.seedMinScore));
  let seedOutputTokens = 0;

  let seeds: string[];
  let seedScores: Record<string, number> = {};
  let seedFallback: "none" | "jaccard" | "llm" = "none";
  let retrievalMode: RetrievalMode = "jaccard";
  let denseMax = 0;
  let seedFallbackReason: SeedFallbackReason | undefined;
  const syntheticPages = new Map<string, string>(
    [...indexAnnotations.keys()].map((id) => [`${wikiVaultPath}/${id}.md`, ""]),
  );
  if (similarity && (similarity.config.mode === "embedding" || similarity.config.mode === "hybrid")) {
    retrievalMode = similarity.config.mode;
    await similarity.loadCache(wikiVaultPath, vaultTools);
    const allAnnotatedPaths = [...indexAnnotations.keys()].map((id) => `${wikiVaultPath}/${id}.md`);
    const diag = await similarity.selectRelevantScoredDiag(question, indexAnnotations, allAnnotatedPaths);
    denseMax = diag.denseMax;
    const topSelected = diag.results.slice(0, topK);
    seeds = topSelected.map((x) => pageId(x.path));
    seedScores = Object.fromEntries(topSelected.map((x) => [pageId(x.path), x.score]));
    if (!seedPassesGate(denseMax, cfg.seedSimilarityThreshold)) {
      seedFallbackReason = diag.embedFailed ? "embed-failed" : "low-similarity";
      const jaccardSeeds = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
      if (jaccardSeeds.length > 0) {
        seeds = jaccardSeeds.map((x) => x.id);
        seedScores = Object.fromEntries(jaccardSeeds.map((x) => [x.id, x.score]));
        seedFallback = "jaccard";
      } else {
        seeds = [];
        seedScores = {};
        seedFallback = "llm";
      }
    }
  } else {
    const seedResults = selectSeeds(question, syntheticPages, topK, minScore, indexAnnotations);
    seeds = seedResults.map((x) => x.id);
    seedScores = Object.fromEntries(seedResults.map((x) => [x.id, x.score]));
  }

  if (seeds.length === 0 && indexAnnotations.size > 0 && llmSeedFallback) {
    if (signal.aborted) return null;
    const allAnnotatedIds = [...indexAnnotations.keys()];
    yield { kind: "tool_use", name: "SelectSeeds", input: { pages: allAnnotatedIds.length } };
    const seedOpts = { ...llmSeedFallback.opts, thinkingBudgetTokens: undefined };
    const seedRes = await llmSelectSeeds(question, indexAnnotations, allAnnotatedIds, llmSeedFallback.llm, llmSeedFallback.model, seedOpts, signal);
    seeds = seedRes.seeds;
    seedOutputTokens += seedRes.outputTokens;
    yield { kind: "tool_result", ok: seeds.length > 0, preview: `${seeds.length} seeds` };
  }
  if (signal.aborted) return null;

  yield { kind: "tool_use", name: "Glob", input: { pattern: `${wikiVaultPath}/**/*.md` } };
  const allFiles = await vaultTools.listFiles(wikiVaultPath);
  const files = allFiles.filter(
    (f) => !META_FILES.some((m) => f.endsWith(m)) && !f.includes("/_config/"),
  );
  yield { kind: "tool_result", ok: true, preview: `${files.length} pages` };
  if (signal.aborted) return null;

  if (seeds.length === 0) return null;   // empty domain → caller decides

  yield { kind: "tool_use", name: "Read", input: { files: files.length } };
  const pages = await vaultTools.readAll(files);
  yield { kind: "tool_result", ok: true, preview: `${pages.size} loaded` };
  if (signal.aborted) return null;

  const graphResult = graphCache.get(domain.id, pages);
  const { selectedIds, expandedScores } = await bfsExpandRanked(
    seeds, graphResult.graph, cfg.graphDepth, pages, question, cfg.bfsTopK, indexAnnotations, similarity,
  );
  const seedSet = new Set(seeds);
  const expandedPages = [...selectedIds].filter((id) => !seedSet.has(id));
  yield { kind: "graph_stats", seeds, expanded: selectedIds.size, total: files.length, fromCache: graphResult.fromCache, seedScores, expandedPages, expandedScores, seedFallback, retrievalMode, denseMax, seedFallbackReason };

  // Keep only candidate content; let the rest be GC'd (memory bound).
  const candidatePages = new Map<string, string>();
  for (const [path, content] of pages) {
    if (selectedIds.has(pageId(path))) candidatePages.set(path, content);
  }
  const annotations = new Map<string, string>();
  for (const id of selectedIds) { const a = indexAnnotations.get(id); if (a) annotations.set(id, a); }

  return {
    domainId: domain.id, pages: candidatePages, seeds, candidateIds: selectedIds,
    seedScores, expandedScores, graph: graphResult.graph, annotations,
    retrievalMode, denseMax, seedFallback, seedFallbackReason, seedOutputTokens,
  };
}
```

- [ ] **Step 2: Replace `runQuery` phases 1–4 with a call to the new function**

In `src/phases/query.ts`, replace the body from `const domain = domains[0];` (line ~53) down to and including the `graph_stats` yield (line ~165) with:

```ts
  const domain = domains[0];
  if (!domain) {
    yield { kind: "error", message: "No domain configured. Add a domain in settings." };
    return;
  }
  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);
  const start = Date.now();
  let outputTokens = 0;

  const cfg = {
    graphDepth, seedTopK, seedMinScore, bfsTopK, seedSimilarityThreshold,
  };
  const cand = yield* retrieveDomainCandidates(
    domain, question, vaultTools, similarity, signal, cfg,
    { llm, model, opts },
  );
  if (signal.aborted) return;
  if (!cand) {
    yield { kind: "error", message: "No relevant pages found for this query." };
    return;
  }
  outputTokens += cand.seedOutputTokens;

  const indexContent = await tryRead(vaultTools, domainIndexPath(wikiVaultPath));
  const seeds = cand.seeds;
  const seedScores = cand.seedScores;
  const expandedScores = cand.expandedScores;
  const selectedIds = cand.candidateIds;
  const pages = cand.pages;
  const seedSet = new Set(seeds);
  const expandedPages = [...selectedIds].filter((id) => !seedSet.has(id));
```

> The `topK` constant is still needed below (`buildContextBlock(..., topK * 3, ...)`). Re-add it right after the block above: `const topK = Math.max(1, Math.min(50, Math.floor(seedTopK)));`
> Everything from the original `const fusedOrder = bfsFusion ? ...` line onward stays unchanged (it already references `seeds`, `selectedIds`, `seedScores`, `expandedScores`, `pages`).

- [ ] **Step 3: Build to verify the refactor compiles**

Run: `npm run build`
Expected: builds with no TypeScript errors. (`LlmClient`, `LlmCallOptions`, `DomainEntry`, `VaultTools` are already imported in this file.)

- [ ] **Step 4: Lint**

Run: `npm run lint`
Expected: no errors. If `tryRead` is now called twice (inside the generator and in `runQuery`), that is fine — it is a tiny helper.

- [ ] **Step 5: Commit**

```bash
git add src/phases/query.ts
git commit -m "refactor(query): extract retrieveDomainCandidates from runQuery"
```

---

## Task 2: Extract the shared answer tail `answerFromContext()`

DRY the "context block → streamed answer → link validation → eval_meta" half so both `runQuery` and `runCrossDomainQuery` reuse it.

**Files:**
- Create: `src/phases/query-answer.ts`
- Modify: `src/phases/query.ts`

- [ ] **Step 1: Create `src/phases/query-answer.ts`**

Move the answer half of `runQuery` (current lines ~188–316, the `messages`/stream/ValidateLinks/FixingLinks block) into this function verbatim, parameterized:

```ts
import type OpenAI from "openai";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas, extractUsage, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
import { parseWithRetry } from "./parse-with-retry";
import { makeQueryAnswerSchema } from "./zod-schemas";
import { pageId } from "../wiki-graph";
import { extractAnswerLinks, findBrokenLinks, annotateBroken } from "./query-link-validator";
import { resolveLink } from "./link-resolver";

/**
 * Stream one answer for a prepared system prompt + context block, then run the
 * deterministic→llm WikiLink validation/repair tail. Yields the same events the
 * inline runQuery tail used to yield. Returns the final answer text + output tokens.
 */
export async function* answerFromContext(args: {
  llm: LlmClient;
  model: string;
  opts: LlmCallOptions;
  signal: AbortSignal;
  vaultTools: VaultTools;
  systemPrompt: string;
  question: string;
  contextBlock: string;
  selectedIds: Set<string>;
  wikiLinkValidationRetries: number;
}): AsyncGenerator<RunEvent, { answer: string; outputTokens: number }> {
  const { llm, model, opts, signal, vaultTools, systemPrompt, question, contextBlock, selectedIds, wikiLinkValidationRetries } = args;
  let outputTokens = 0;

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    { role: "user", content: `Question: ${question}\n\nWiki pages:\n${contextBlock}` },
  ];
  const params = buildChatParams(model, messages, opts, true);
  let answer = "";
  let streamStats: import("./llm-utils").LlmStreamStats | undefined;
  yield { kind: "tool_use", name: "Answering", input: {} };
  try {
    const requestStartMs = Date.now();
    const rawStream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { answer += content; yield { kind: "assistant_text", delta: content }; }
      if (tok !== undefined) outputTokens += tok;
    }
    streamStats = getStats();
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return { answer: "", outputTokens };
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    answer = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (answer) yield { kind: "assistant_text", delta: answer };
  }

  if (signal.aborted) return { answer, outputTokens };
  yield { kind: "tool_result", ok: !!answer, preview: answer ? `${answer.length} chars` : "no response" };

  if (answer && !signal.aborted) {
    yield { kind: "tool_use", name: "ValidateLinks", input: {} };
    let skipValidation = false;
    let knownStems = new Set<string>();
    try {
      const allVaultFiles = await vaultTools.listFiles("");
      knownStems = new Set(allVaultFiles.filter((f) => f.endsWith(".md")).map((f) => pageId(f)));
    } catch {
      console.warn("[ai-wiki] ValidateLinks: listFiles failed, skipping");
      skipValidation = true;
      yield { kind: "tool_result", ok: false, preview: "listFiles failed — skipped" };
    }
    if (!skipValidation) {
      const links = extractAnswerLinks(answer);
      const broken = findBrokenLinks(links, knownStems);
      yield { kind: "tool_result", ok: broken.length === 0, preview: broken.length === 0 ? "all valid" : `${broken.length} broken` };
      if (broken.length > 0) {
        yield { kind: "tool_use", name: "FixingLinks", input: { broken: broken.length } };
        const candidates = [...new Set([...selectedIds, ...knownStems])];
        const resolvedPairs: string[] = [];
        const stripped: string[] = [];
        for (const b of broken) {
          const r = resolveLink(b, candidates);
          if (r.kind === "resolved" && r.stem !== b) {
            answer = answer.split(`[[${b}]]`).join(`[[${r.stem}]]`);
            resolvedPairs.push(`${b}→${r.stem}`);
          } else { stripped.push(b); }
        }
        if (resolvedPairs.length > 0) yield { kind: "rule_fired", ruleId: "resolveLink", count: resolvedPairs.length };
        let llmFixed = 0;
        if (stripped.length > 0 && wikiLinkValidationRetries > 0) {
          const validList = candidates.filter((s) => s.startsWith("wiki_")).join(", ");
          const baseMessages: OpenAI.Chat.ChatCompletionMessageParam[] = [
            { role: "system", content:
              `Rewrite the answer so every WikiLink points to a valid stem. ` +
              `Broken stems: ${stripped.join(", ")}. Valid stems: ${validList}. ` +
              `Return JSON {reasoning, answer_markdown, citations}.` },
            { role: "user", content: `Question: ${question}\n\nAnswer to fix:\n${answer}` },
          ];
          try {
            const r = await parseWithRetry({
              llm, model, baseMessages,
              opts: { ...opts, jsonMode: "json_object", thinkingBudgetTokens: undefined },
              schema: makeQueryAnswerSchema(knownStems),
              maxRetries: wikiLinkValidationRetries,
              callSite: "query.answer",
              signal,
              onEvent: () => {},
            });
            outputTokens += r.outputTokens;
            const stillBroken = findBrokenLinks(extractAnswerLinks(r.value.answer_markdown), knownStems);
            if (stillBroken.length === 0) { answer = r.value.answer_markdown; llmFixed = stripped.length; stripped.length = 0; }
          } catch (e) {
            if (signal.aborted || (e as Error).name === "AbortError") return { answer, outputTokens };
          }
        }
        if (stripped.length > 0) {
          answer = annotateBroken(answer, new Set(stripped));
          yield { kind: "rule_fired", ruleId: "annotateBroken", count: stripped.length };
        }
        const parts: string[] = [];
        if (resolvedPairs.length) parts.push(`resolved ${resolvedPairs.length} (det): ${resolvedPairs.join(", ")}`);
        if (llmFixed) parts.push(`llm-fixed ${llmFixed}`);
        if (stripped.length) parts.push(`annotated ${stripped.length}: ${stripped.join(", ")}`);
        yield { kind: "tool_result", ok: stripped.length === 0, preview: parts.join("; ") };
        yield { kind: "assistant_replace", text: answer };
      }
    }
  }
  if (streamStats) yield buildLlmCallStatsEvent(streamStats);
  return { answer, outputTokens };
}
```

> The original repo line `if (REDACTEDnd === "resolved" ...)` is the redacted form of `if (r.kind === "resolved" ...)` and `callSite: "REDACTEDswer"` is `"query.answer"`; use the readable forms above.

- [ ] **Step 2: Make `runQuery` call `answerFromContext`**

In `src/phases/query.ts`, replace the inline block from `const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [` (the system+user messages) through the `if (streamStats) yield buildLlmCallStatsEvent(streamStats);` line with:

```ts
  const ans = yield* answerFromContext({
    llm, model, opts, signal, vaultTools,
    systemPrompt, question, contextBlock, selectedIds,
    wikiLinkValidationRetries,
  });
  let answer = ans.answer;
  outputTokens += ans.outputTokens;
```

Add the import at the top of `query.ts`: `import { answerFromContext } from "./query-answer";`
Remove now-unused imports from `query.ts` if lint flags them (`buildChatParams`, `extractStreamDeltas`, `extractUsage`, `wrapStreamWithStats`, `buildLlmCallStatsEvent`, `makeQueryAnswerSchema`, `extractAnswerLinks`, `findBrokenLinks`, `annotateBroken`, `resolveLink`) — only remove ones no longer referenced in `query.ts`.

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean. The `eval_meta` and `save` blocks at the end of `runQuery` are unchanged and still reference `answer`.

- [ ] **Step 4: Commit**

```bash
git add src/phases/query.ts src/phases/query-answer.ts
git commit -m "refactor(query): extract shared answerFromContext tail"
```

---

## Task 3: `mergeCandidates()` — pure stage-2 merge + fusion

> **Depends on:** Task 1 (`DomainCandidates`, `retrieveDomainCandidates`) and Task 2 (`answerFromContext`, used later by Task 4). The eval harness imports `DomainCandidates` from `./query`, which exists after Task 1.

**Files:**
- Create: `src/phases/query-cross-domain.ts` (partial — `mergeCandidates` only)
- Create: `eval/cross-domain/run.ts` (harness + first assertions)

- [ ] **Step 1: Write the failing test (harness + merge assertions)**

Create `eval/cross-domain/run.ts`:

```ts
/**
 * Out-of-vault eval for cross-domain wiki search (no Obsidian, no API key).
 * Deterministic: drives the REAL retrieveDomainCandidates / mergeCandidates /
 * runCrossDomainQuery in Jaccard mode (similarity = undefined) over inlined fixtures.
 * Run: npx tsx eval/cross-domain/run.ts
 */
import { mergeCandidates } from "../../src/phases/query-cross-domain";
import type { DomainCandidates } from "../../src/phases/query";

let pass = 0, fail = 0;
const failures: string[] = [];
function check(name: string, cond: boolean, detail = ""): void {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(name); console.log(`  FAIL  ${name}${detail ? `\n        → ${detail}` : ""}`); }
}
function section(t: string): void { console.log(`\n=== ${t} ===`); }

function fakeCandidates(domainId: string, ids: string[], scores: number[]): DomainCandidates {
  const seedScores: Record<string, number> = {};
  ids.forEach((id, i) => { seedScores[id] = scores[i]; });
  const graph = new Map<string, Set<string>>(ids.map((id) => [id, new Set<string>()]));
  const pages = new Map<string, string>(ids.map((id) => [`!Wiki/${domainId}/${id}.md`, `# ${id}`]));
  const annotations = new Map<string, string>(ids.map((id) => [id, `${id} annotation`]));
  return {
    domainId, pages, seeds: ids, candidateIds: new Set(ids),
    seedScores, expandedScores: {}, graph, annotations,
    retrievalMode: "jaccard", denseMax: 0, seedFallback: "none", seedOutputTokens: 0,
  };
}

section("mergeCandidates");
{
  const a = fakeCandidates("work", ["wiki_work_a", "wiki_work_b"], [0.9, 0.3]);
  const b = fakeCandidates("home", ["wiki_home_x", "wiki_home_y"], [0.8, 0.2]);
  const merged = mergeCandidates([a, b], 3, 1, 60);

  // Assertion 1: pool union loses nothing.
  check("pool = union of all candidates",
    merged.allCandidates.size === 4 &&
    ["wiki_work_a", "wiki_work_b", "wiki_home_x", "wiki_home_y"].every((id) => merged.allCandidates.has(id)),
    `got ${[...merged.allCandidates].join(",")}`);

  // Assertion 2: finalIds capped at seedTopK and ordered by fused rank.
  check("finalIds length <= seedTopK", merged.finalIds.length === 3, `got ${merged.finalIds.length}`);

  // Assertion 3: cross-domain final spans more than one domain.
  const domainsInFinal = new Set(merged.finalIds.map((id) => id.split("_")[1]));
  check("final spans >1 domain", domainsInFinal.size > 1, `domains: ${[...domainsInFinal].join(",")}`);

  // mergedPages / mergedSeeds / mergedSeedSet are well-formed.
  check("mergedPages has 4 entries", merged.mergedPages.size === 4);
  check("mergedSeedSet has all seeds", merged.mergedSeedSet.size === 4);
}

console.log(`\n${fail === 0 ? "OK" : "FAILED"} — ${pass} passed, ${fail} failed`);
if (fail > 0) { console.log("Failures:\n" + failures.map((f) => "  - " + f).join("\n")); process.exit(1); }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: FAIL — `Cannot find module .../query-cross-domain` (or `mergeCandidates is not exported`).

- [ ] **Step 3: Implement `mergeCandidates` in `src/phases/query-cross-domain.ts`**

```ts
import type { DomainCandidates } from "./query";
import { fuseVectorGraph } from "../fusion";

export interface MergedPool {
  mergedPages: Map<string, string>;
  mergedSeeds: string[];
  mergedSeedSet: Set<string>;
  mergedSeedScores: Record<string, number>;
  mergedExpandedScores: Record<string, number>;
  allCandidates: Set<string>;
  mergedGraph: Map<string, Set<string>>;
  mergedAnnotations: Map<string, string>;
  fusedOrder: string[];
  finalIds: string[];
}

/**
 * Stage 2: union the per-domain candidate sets (stems are globally unique, so the
 * merge is collision-free), RRF-fuse vector + graph over the union, and take the
 * top-`seedTopK`. No new pages are introduced — only the stage-1 pool is re-ranked.
 */
export function mergeCandidates(
  pool: DomainCandidates[],
  seedTopK: number,
  graphDepth: number,
  rrfK: number,
): MergedPool {
  const mergedPages = new Map<string, string>();
  const mergedSeeds: string[] = [];
  const mergedSeedScores: Record<string, number> = {};
  const mergedExpandedScores: Record<string, number> = {};
  const allCandidates = new Set<string>();
  const mergedGraph = new Map<string, Set<string>>();
  const mergedAnnotations = new Map<string, string>();

  for (const c of pool) {
    for (const [p, body] of c.pages) mergedPages.set(p, body);
    for (const s of c.seeds) mergedSeeds.push(s);
    for (const [k, v] of Object.entries(c.seedScores)) mergedSeedScores[k] = v;
    for (const [k, v] of Object.entries(c.expandedScores)) mergedExpandedScores[k] = v;
    for (const id of c.candidateIds) allCandidates.add(id);
    for (const [k, v] of c.annotations) mergedAnnotations.set(k, v);
    for (const [node, edges] of c.graph) {
      const cur = mergedGraph.get(node);
      if (cur) { for (const e of edges) cur.add(e); }      // defensive: duplicate stem (broken mask)
      else mergedGraph.set(node, new Set(edges));
    }
  }

  const mergedSeedSet = new Set(mergedSeeds);
  const fusedOrder = fuseVectorGraph(
    mergedSeeds, allCandidates, mergedSeedScores, mergedExpandedScores, mergedGraph, graphDepth, rrfK,
  );
  const cap = Math.max(1, Math.min(50, Math.floor(seedTopK)));
  const finalIds = fusedOrder.slice(0, cap);

  return {
    mergedPages, mergedSeeds, mergedSeedSet, mergedSeedScores, mergedExpandedScores,
    allCandidates, mergedGraph, mergedAnnotations, fusedOrder, finalIds,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: PASS — `OK — 5 passed, 0 failed`.

- [ ] **Step 5: Commit**

```bash
git add src/phases/query-cross-domain.ts eval/cross-domain/run.ts
git commit -m "feat(query): mergeCandidates stage-2 fusion + eval"
```

---

## Task 4: `runCrossDomainQuery()` orchestrator

**Files:**
- Modify: `src/phases/query-cross-domain.ts` (add the orchestrator)
- Modify: `eval/cross-domain/run.ts` (add orchestrator assertions with a fake LLM + fake VaultTools)

- [ ] **Step 1: Write the failing test (fake VaultTools + fake LLM)**

Append to `eval/cross-domain/run.ts` (before the final summary lines):

```ts
import { runCrossDomainQuery } from "../../src/phases/query-cross-domain";
import type { VaultTools } from "../../src/vault-tools";
import type { LlmClient, RunEvent } from "../../src/types";
import type { DomainEntry } from "../../src/domain";

// Minimal in-memory VaultTools: two domains, jaccard mode (no embeddings).
function fakeVault(files: Record<string, string>): VaultTools {
  const map = new Map(Object.entries(files));
  return {
    read: async (p: string) => { const v = map.get(p); if (v === undefined) throw new Error("ENOENT " + p); return v; },
    write: async () => {},
    exists: async (p: string) => map.has(p),
    mkdir: async () => {},
    remove: async () => {},
    listFiles: async (dir: string) => [...map.keys()].filter((p) => p.startsWith(dir)),
    readAll: async (paths: string[]) => new Map(paths.map((p) => [p, map.get(p) ?? ""])),
  } as unknown as VaultTools;
}

// Fake LLM: records call count; streaming returns one canned content chunk.
function fakeLlm(answer: string): { llm: LlmClient; calls: () => number } {
  let calls = 0;
  const llm = {
    chat: { completions: { create: async (params: { stream?: boolean }) => {
      calls++;
      if (params.stream) {
        return (async function* () { yield { choices: [{ delta: { content: answer } }] }; })();
      }
      return { choices: [{ message: { content: answer } }] };
    } } },
  } as unknown as LlmClient;
  return { llm, calls: () => calls };
}

async function drive(gen: AsyncGenerator<RunEvent, void>): Promise<RunEvent[]> {
  const evs: RunEvent[] = [];
  for await (const e of gen) evs.push(e);
  return evs;
}

const dom = (id: string): DomainEntry => ({
  id, name: id, wiki_folder: id, source_paths: [], entity_types: [], analyzed_sources: {},
} as DomainEntry);

section("runCrossDomainQuery");
{
  // Each domain: an _index.md with one annotated page + that page file.
  const files = {
    "!Wiki/work/_config/_index.md": "- [[wiki_work_neural]] — neural networks deep learning",
    "!Wiki/work/EntityType/wiki_work_neural.md": "# Neural\nneural networks deep learning models",
    "!Wiki/home/_config/_index.md": "- [[wiki_home_garden]] — neural pruning of garden plants",
    "!Wiki/home/EntityType/wiki_home_garden.md": "# Garden\nneural pruning garden plants",
  };
  const vault = fakeVault(files);
  const { llm, calls } = fakeLlm("Answer about [[wiki_work_neural]].");
  const signal = new AbortController().signal;
  const cfg = { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0 };

  const evs = await drive(runCrossDomainQuery(
    "neural", vault, llm, "fake-model", [dom("work"), dom("home")], signal, cfg, 60, 3, {},
  ));

  const evalMeta = evs.find((e) => e.kind === "eval_meta") as Extract<RunEvent, { kind: "eval_meta" }> | undefined;
  const result = evs.find((e) => e.kind === "result") as Extract<RunEvent, { kind: "result" }> | undefined;

  check("exactly one LLM completion call", calls() === 1, `calls=${calls()}`);
  check("emits a result with the answer", !!result && result.text.includes("wiki_work_neural"));
  check("eval_meta.crossDomain true", !!evalMeta && (evalMeta.fields.retrievalConfig as { crossDomain?: boolean })?.crossDomain === true);
  check("found_pages non-empty", !!evalMeta && Array.isArray(evalMeta.fields.found_pages) && (evalMeta.fields.found_pages as string[]).length > 0);
  check("per-domain progress emitted", evs.some((e) => e.kind === "tool_use" && (e as { name: string }).name.startsWith("Domain:")));
}

section("edge cases");
{
  // All domains empty (no index) → single error event, no result text.
  const vault = fakeVault({});
  const { llm } = fakeLlm("x");
  const signal = new AbortController().signal;
  const cfg = { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0 };
  const evs = await drive(runCrossDomainQuery("q", vault, llm, "m", [dom("work"), dom("home")], signal, cfg, 60, 3, {}));
  check("all-empty → error event", evs.some((e) => e.kind === "error" && /across domains/i.test((e as { message: string }).message)));
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: FAIL — `runCrossDomainQuery is not exported`.

- [ ] **Step 3: Implement `runCrossDomainQuery` in `src/phases/query-cross-domain.ts`**

Add imports at the top and the orchestrator below `mergeCandidates`:

```ts
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import type { PageSimilarityService } from "../page-similarity";
import { retrieveDomainCandidates, buildContextBlock, type RetrieveCfg } from "./query";
import { answerFromContext } from "./query-answer";
import { render } from "./template";
import queryTemplate from "../../prompts/query.md";
import { promptVersionOf } from "../prompt-version";

export async function* runCrossDomainQuery(
  question: string,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  signal: AbortSignal,
  cfg: RetrieveCfg,
  rrfK: number,
  wikiLinkValidationRetries: number,
  opts: LlmCallOptions,
  similarity?: PageSimilarityService,
): AsyncGenerator<RunEvent, void> {
  const q = question.trim();
  if (!q) { yield { kind: "error", message: "query: question required" }; return; }
  if (domains.length === 0) { yield { kind: "error", message: "No domains configured. Add a domain in settings." }; return; }

  const start = Date.now();
  let outputTokens = 0;

  // Stage 1 — gather candidates per domain, sequentially.
  const poolList: import("./query").DomainCandidates[] = [];
  for (const domain of domains) {
    if (signal.aborted) return;
    yield { kind: "tool_use", name: `Domain: ${domain.name}`, input: {} };
    const cand = yield* retrieveDomainCandidates(domain, q, vaultTools, similarity, signal, cfg);
    yield { kind: "tool_result", ok: !!cand, preview: cand ? `${cand.candidateIds.size} candidates` : "skipped" };
    if (cand) poolList.push(cand);
  }
  if (signal.aborted) return;
  if (poolList.length === 0) { yield { kind: "error", message: "No relevant pages found across domains." }; return; }

  // Stage 2 — merge + fuse + cap.
  const merged = mergeCandidates(poolList, cfg.seedTopK, cfg.graphDepth, rrfK);
  const finalSet = new Set(merged.finalIds);

  // Context + prompt assembly (cross-domain placeholders).
  const contextBlock = buildContextBlock(merged.mergedPages, merged.mergedSeedSet, finalSet, cfg.seedTopK, merged.fusedOrder);

  const finalDomains = [...new Set([...finalSet].map((id) => id.split("_")[1]).filter(Boolean))];
  const domainName = `All domains (${finalDomains.length}): ${finalDomains.join(", ")}`;

  const wikiFirst = [...finalSet].sort((a, b) => Number(b.startsWith("wiki_")) - Number(a.startsWith("wiki_")));
  const availableLinksBlock = wikiFirst.length === 0 ? "" : [
    "Valid WikiLink targets (use EXACTLY these, copy verbatim):",
    ...wikiFirst.map((s) => `- ${s}`),
    "ONLY link to a target from this list. Never invent or abbreviate stems.",
  ].join("\n");

  const entityTypesBlock = buildCrossDomainEntityTypes(domains, finalDomains);
  const indexBlock = buildCrossDomainIndexBlock(merged.mergedAnnotations, merged.finalIds);

  const systemPrompt = render(queryTemplate, {
    domain_name: domainName,
    available_links_block: availableLinksBlock,
    entity_types_block: entityTypesBlock,
    index_block: indexBlock ? `\nWiki index (candidates):\n${indexBlock}` : "",
  });

  // Single LLM call + shared validation tail.
  const ans = yield* answerFromContext({
    llm, model, opts, signal, vaultTools, systemPrompt, question: q,
    contextBlock, selectedIds: finalSet, wikiLinkValidationRetries,
  });
  outputTokens += ans.outputTokens;
  if (signal.aborted) return;

  yield {
    kind: "eval_meta",
    fields: {
      question: q,
      answer: ans.answer,
      found_pages: merged.finalIds,
      promptVersion: promptVersionOf(queryTemplate),
      retrievalConfig: {
        mode: similarity?.config.mode === "hybrid" ? "hybrid" : similarity?.config.mode === "embedding" ? "embedding" : "jaccard",
        seedTopK: cfg.seedTopK,
        bfsTopK: cfg.bfsTopK,
        bfsFusion: false,
        seedSimilarityThreshold: cfg.seedSimilarityThreshold,
        hybridRetrieval: similarity?.config.mode === "hybrid",
        crossDomain: true,
        domainsSearched: domains.length,
      },
    },
  };

  yield { kind: "result", durationMs: Date.now() - start, text: ans.answer, outputTokens: outputTokens || undefined };
}

function buildCrossDomainEntityTypes(domains: DomainEntry[], domainIds: string[]): string {
  const blocks: string[] = [];
  for (const d of domains) {
    if (!domainIds.includes(d.id) || !d.entity_types?.length) continue;
    const types = d.entity_types.map((et) => `  - ${et.type}: ${et.description}`).join("\n");
    blocks.push(`Entity types of "${d.name}":\n${types}`);
  }
  return blocks.join("\n");
}

function buildCrossDomainIndexBlock(annotations: Map<string, string>, finalIds: string[]): string {
  return finalIds
    .map((id) => { const a = annotations.get(id); return a ? `${id}: ${a}` : null; })
    .filter((x): x is string => x !== null)
    .join("\n");
}
```

> **Required first edit in this step (before the orchestrator compiles):** `RetrievalConfigSnapshot` (`src/eval-log.ts:18`) is strictly typed — it has required `mode`, `seedTopK`, `bfsTopK`, `bfsFusion`, `seedSimilarityThreshold`, `hybridRetrieval` and no extra-key index. Add two optional fields so the cross-domain `retrievalConfig` type-checks:
>
> ```ts
> export interface RetrievalConfigSnapshot {
>   mode: "embedding" | "jaccard" | "hybrid";
>   seedTopK: number;
>   bfsTopK: number;
>   bfsFusion: boolean;
>   seedSimilarityThreshold: number;
>   hybridRetrieval: boolean;
>   crossDomain?: boolean;      // cross-domain query marker
>   domainsSearched?: number;   // domains iterated in stage 1
> }
> ```
>
> The orchestrator's `retrievalConfig` object above fills every required field plus these two optionals, so it matches the widened type exactly.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: PASS — all assertions green (`OK — N passed, 0 failed`).

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/phases/query-cross-domain.ts eval/cross-domain/run.ts
git commit -m "feat(query): runCrossDomainQuery orchestrator + eval"
```

---

## Task 5: Route the `"*"` sentinel in `agent-runner`

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Branch on `domainId === "*"` in `run()`**

In `src/agent-runner.ts`, the domain-resolution at lines ~159–161 currently is:

```ts
    const domains = req.domainId
      ? this.domains.filter((d) => d.id === req.domainId)
      : this.domains;
```

Change to keep all domains for the `"*"` sentinel:

```ts
    const domains = req.domainId && req.domainId !== "*"
      ? this.domains.filter((d) => d.id === req.domainId)
      : this.domains;
```

- [ ] **Step 2: Dispatch to `runCrossDomainQuery` in `runOperation`'s `query` case**

In the `case "query":` of `runOperation` (line ~97), branch on the sentinel:

```ts
      case "query":
        if (req.domainId === "*") {
          yield* runCrossDomainQuery(
            req.args[0] ?? "", this.vaultTools, this.llm, model, domains, req.signal,
            { graphDepth: this.settings.graphDepth, seedTopK: this.settings.seedTopK,
              seedMinScore: this.settings.seedMinScore, bfsTopK: this.settings.bfsTopK,
              seedSimilarityThreshold: this.settings.nativeAgent.seedSimilarityThreshold ?? 0 },
            this.settings.nativeAgent.rrfK ?? 60,
            this.settings.nativeAgent.wikiLinkValidationRetries ?? 3,
            opts, similarity,
          );
        } else {
          yield* runQuery(req.args, false, this.vaultTools, this.llm, model, domains, vaultRoot, req.signal, this.settings.graphDepth, opts, this.settings.seedTopK, this.settings.seedMinScore, this.settings.bfsTopK, similarity, this.settings.nativeAgent.wikiLinkValidationRetries ?? 3, this.settings.nativeAgent.seedSimilarityThreshold ?? 0, this.settings.nativeAgent.bfsFusion ?? false, this.settings.nativeAgent.rrfK ?? 60);
        }
        break;
```

Add the import near the top of `src/agent-runner.ts`: `import { runCrossDomainQuery } from "./phases/query-cross-domain";`

> Confirm the exact settings field names against the existing single-domain `runQuery` call (some are `this.settings.X`, some `this.settings.nativeAgent.X`) — copy them verbatim from that call so the cross-domain path uses identical knobs.

- [ ] **Step 3: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(query): route '*' domain sentinel to cross-domain query"
```

---

## Task 6: Scope toggle UI + persistence + i18n

**Files:**
- Modify: `src/local-config.ts`, `src/i18n.ts`, `src/view.ts`

- [ ] **Step 1: Add `lastQueryScope` to `LocalConfig`**

In `src/local-config.ts`, add to the `LocalConfig` interface (after `lastDomain?: string;`):

```ts
  lastQueryScope?: "all" | "domain";
```

- [ ] **Step 2: Add i18n labels (en/ru/es)**

In `src/i18n.ts`, add to each locale's `view` block (next to `allDomains`):

```ts
    // en (line ~169 block)
    scopeAll: "All",
    scopeDomain: "Domain",
    scopeHint: "Search all domains or the selected one",
```
```ts
    // ru (line ~516 block)
    scopeAll: "Все",
    scopeDomain: "Домен",
    scopeHint: "Искать по всем доменам или по выбранному",
```
```ts
    // es (line ~841 block)
    scopeAll: "Todos",
    scopeDomain: "Dominio",
    scopeHint: "Buscar en todos los dominios o en el seleccionado",
```

- [ ] **Step 3: Render the scope toggle next to the query input**

In `src/view.ts`, add a field near `private queryInput!` (line ~94):

```ts
  private scopeToggle?: HTMLSelectElement;
```

In the query section (right after the `this.queryInput = ask.createEl(...)` block, line ~203), insert:

```ts
    const T2 = i18n().view;
    const scopeRow = ask.createDiv("ai-wiki-scope-row");
    scopeRow.createSpan({ cls: "muted", text: "Scope:" });
    this.scopeToggle = scopeRow.createEl("select", { cls: "ai-wiki-scope-select", attr: { title: T2.scopeHint } });
    this.scopeToggle.createEl("option", { value: "all", text: T2.scopeAll });
    this.scopeToggle.createEl("option", { value: "domain", text: T2.scopeDomain });

    const syncScope = () => {
      const hasDomain = !!(this.domainSelect?.value);
      const domainOpt = this.scopeToggle!.querySelector('option[value="domain"]') as HTMLOptionElement;
      domainOpt.disabled = !hasDomain;
      // Default mirrors the sidebar: concrete domain → "domain", (all) → "all".
      this.scopeToggle!.value = hasDomain ? "domain" : "all";
    };
    this.scopeToggle.addEventListener("change", () => {
      void this.plugin.localConfigStore.save({ lastQueryScope: this.scopeToggle!.value as "all" | "domain" });
    });
    this.domainSelect?.addEventListener("change", syncScope);
    syncScope();

    // Restore the persisted scope choice on initial build (only when a concrete domain is selected).
    void this.plugin.localConfigStore.load().then((c) => {
      if (c.lastQueryScope === "all") this.scopeToggle!.value = "all";
      else if (c.lastQueryScope === "domain" && this.domainSelect?.value) this.scopeToggle!.value = "domain";
    });
```

> The toggle is a 2-option `<select>` (consistent with the existing `domainSelect`). The `domain` option is disabled while the sidebar is on `(all)`. On sidebar change, `syncScope` resets the default. The persisted `lastQueryScope` is read once on initial build and applied to the toggle.

- [ ] **Step 4: Route `submitQuery` by scope**

Replace `submitQuery` (line ~571) with:

```ts
  private submitQuery(): void {
    const q = this.queryInput.value.trim();
    if (!q) { new Notice(i18n().view.enterQuestion); return; }
    if (this.state === "running") { new Notice(i18n().view.operationInProgress); return; }
    const sidebarDomain = this.domainSelect?.value || "";
    const scope = this.scopeToggle?.value || (sidebarDomain ? "domain" : "all");
    const domainArg = scope === "all" ? "*" : (sidebarDomain || "*");
    void this.plugin.controller.query(q, domainArg);
    this.queryInput.value = "";
  }
```

> When scope is `domain` but no concrete domain is selected (shouldn't happen — option is disabled), fall back to `"*"` for safety.

- [ ] **Step 5: Build + lint**

Run: `npm run build && npm run lint`
Expected: clean. (`syncScope` has no dead/unused locals; if lint flags the `localConfigStore.load().then(...)` floating promise, the leading `void` already suppresses it.)

- [ ] **Step 6: Manual verification (HUMAN checkpoint — Obsidian)**

Load the plugin in a vault with ≥2 domains, native-agent backend, embeddings configured.
- Sidebar `(all)` → Scope select shows `All` selected, `Domain` disabled. Ask a question → progress shows `Domain: <name>` for each domain, one answer combining pages from multiple domains.
- Sidebar a concrete domain → Scope defaults to `Domain`; switching to `All` runs cross-domain; switching back runs single-domain.
Expected: cross-domain answer cites pages from more than one domain when relevant.

- [ ] **Step 7: Commit**

```bash
git add src/local-config.ts src/i18n.ts src/view.ts
git commit -m "feat(view): cross-domain scope toggle + lastQueryScope persistence"
```

---

## Task 7: Finalize eval — refactor equivalence + jaccard assertions

**Files:**
- Modify: `eval/cross-domain/run.ts`

- [ ] **Step 1: Add the refactor-equivalence + jaccard assertions**

Append to `eval/cross-domain/run.ts` (before the summary). This drives the REAL `retrieveDomainCandidates` directly to confirm single-domain retrieval is unchanged and Jaccard mode yields a non-empty pool:

```ts
import { retrieveDomainCandidates } from "../../src/phases/query";

section("retrieveDomainCandidates (jaccard, single domain)");
{
  const files = {
    "!Wiki/work/_config/_index.md": "- [[wiki_work_neural]] — neural networks deep learning",
    "!Wiki/work/EntityType/wiki_work_neural.md": "# Neural\nneural networks deep learning models",
    "!Wiki/work/EntityType/wiki_work_garden.md": "# Garden\ncompletely unrelated gardening text",
  };
  const vault = fakeVault(files);
  const signal = new AbortController().signal;
  const cfg = { graphDepth: 1, seedTopK: 5, seedMinScore: 0, bfsTopK: 10, seedSimilarityThreshold: 0 };
  const gen = retrieveDomainCandidates(dom("work"), "neural networks", vault, undefined, signal, cfg);
  let r = await gen.next();
  while (!r.done) r = await gen.next();
  const cand = r.value;

  check("jaccard pool non-empty", !!cand && cand.candidateIds.size > 0);
  check("relevant seed selected", !!cand && cand.seeds.includes("wiki_work_neural"));
  check("retrievalMode jaccard", !!cand && cand.retrievalMode === "jaccard");
  check("empty domain returns null", await (async () => {
    const g = retrieveDomainCandidates(dom("empty"), "x", fakeVault({}), undefined, signal, cfg);
    let rr = await g.next(); while (!rr.done) rr = await g.next(); return rr.value === null;
  })());
}
```

- [ ] **Step 2: Run the full eval**

Run: `npx tsx eval/cross-domain/run.ts`
Expected: PASS — all assertions across all `section`s green; `OK — N passed, 0 failed`.

- [ ] **Step 3: Final build + lint**

Run: `npm run build && npm run lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add eval/cross-domain/run.ts
git commit -m "test(query): cross-domain eval — refactor equivalence + jaccard"
```

---

## Task 8: Docs (iwiki) + lint

**Files:**
- Modify: `docs/wiki/retrieval.md`, `docs/wiki/operations.md` (via iwiki skill)

- [ ] **Step 1: Ingest the new source into the wiki**

Run the iwiki ingest skill on the new orchestrator:
`iwiki:iwiki-ingest src/phases/query-cross-domain.ts`
Expected: a "Cross-Domain Query" section appears/updates in `docs/wiki/retrieval.md`; cross-links from `operations.md#Query`.

- [ ] **Step 2: Lint the wiki**

Run the iwiki lint skill: `/iwiki-lint`
Expected: no broken `[[refs]]`, no orphan/stale pages introduced.

- [ ] **Step 3: Commit**

```bash
git add docs/wiki
git commit -m "docs(wiki): cross-domain query retrieval section"
```

---

## Self-Review

**1. Spec coverage:**
- §UX → Task 6 (toggle, enable/disable, override, `lastQueryScope`, i18n). ✓
- §Routing → Task 5 (`"*"` sentinel; legacy `undefined` untouched). ✓
- §Arch1 `retrieveDomainCandidates` → Task 1. ✓
- §Arch2 `runCrossDomainQuery` stage-1/stage-2 → Tasks 3 (merge) + 4 (orchestrator). ✓
- §Retrieval knobs (incl. `seedMinScore`) → cfg threaded in Tasks 1/4/5. ✓
- §Prompt/Context → Task 4 (`buildCrossDomainEntityTypes`, `buildCrossDomainIndexBlock`, `domainName`). ✓
- §Telemetry → Task 4 (per-domain `Domain:` events, forwarded `graph_stats` from Task 1, `eval_meta` + `crossDomain`). ✓
- §Error Handling → Task 1 (empty→null, abort, wiki_folder guard), Task 3 (dup-stem guard), Task 4 (all-empty error). ✓
- §Testing → Tasks 3/4/7 (7 assertions across pool union, cap, multi-domain, single LLM call, found_pages, empty skip, jaccard, refactor equivalence). ✓
- §Files Touched → all 9 files have a task. ✓ (Note: spec listed `controller.ts`; it needs no change because `query(q, "*")` already flows through `dispatch` — recorded here so the diff-vs-spec reconciliation does not flag it as missing.)

**2. Placeholder scan:** No TBD/TODO; every code step has real code. No dead/illustrative lines in any code block.

**3. Type consistency:** `DomainCandidates` (Task 1) is consumed unchanged by `mergeCandidates` (Task 3) and `runCrossDomainQuery` (Task 4). `RetrieveCfg` fields match the `cfg` objects built in Tasks 4/5. `answerFromContext` return `{ answer, outputTokens }` matches both call sites. `MergedPool.finalIds`/`fusedOrder`/`mergedSeedSet` names match their uses in Task 4. `RetrievalConfigSnapshot` is widened with `crossDomain?`/`domainsSearched?` in Task 4 Step 3 before the orchestrator's `retrievalConfig` (which fills all required + the two optional fields) is compiled.

**check-plan findings resolved:** F-001 (widen `RetrievalConfigSnapshot` — now an explicit Task 4 sub-step, orchestrator fills all required fields), F-002 (dead `saved` lines removed from Task 6 Step 3), F-003 (persisted `lastQueryScope` now read on initial build in Task 6 Step 3), F-004 (Task 3 dependency note added) — all fixed inline. F-005 (`seedOutputTokens` extends the spec's `DomainCandidates` — intentional, for llm-seed-fallback token reporting) and F-006 (`controller.ts` needs no change) accepted.
