import type OpenAI from "openai";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import { buildChatParams, extractStreamDeltas, extractUsage, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
import { parseWithRetry } from "./parse-with-retry";
import { SeedsSchema, makeQueryAnswerSchema } from "./zod-schemas";
import queryTemplate from "../../prompts/query.md";
import querySeedsTemplate from "../../prompts/query-seeds.md";
import { render } from "./template";
import { domainWikiFolder, domainIndexPath } from "../wiki-path";
import { ensureDomainConfig } from "../domain-config";
import { pageId, bfsExpandRanked } from "../wiki-graph";
import { fuseVectorGraph } from "../fusion";
import { graphCache } from "../wiki-graph-cache";
import { selectSeeds } from "../wiki-seeds";
import { parseIndexAnnotations } from "../wiki-index";
import type { PageSimilarityService } from "../page-similarity";
import { seedPassesGate } from "../retrieval-diag";
import type { RetrievalMode, SeedFallbackReason } from "../retrieval-diag";
import { extractAnswerLinks, findBrokenLinks, annotateBroken } from "./query-link-validator";
import { resolveLink } from "./link-resolver";
import { promptVersionOf } from "../prompt-version";

const META_FILES = ["_index.md", "_log.md"];

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
  indexContent: string;              // raw _index.md content
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
    seedScores, expandedScores, graph: graphResult.graph, annotations, indexContent,
    retrievalMode, denseMax, seedFallback, seedFallbackReason, seedOutputTokens,
  };
}

export async function* runQuery(
  args: string[],
  save: boolean,
  vaultTools: VaultTools,
  llm: LlmClient,
  model: string,
  domains: DomainEntry[],
  vaultRoot: string,
  signal: AbortSignal,
  graphDepth: number = 1,
  opts: LlmCallOptions = {},
  seedTopK: number = 5,
  seedMinScore: number = 0.1,
  bfsTopK: number = 10,
  similarity?: PageSimilarityService,
  wikiLinkValidationRetries: number = 3,
  seedSimilarityThreshold: number = 0,
  bfsFusion: boolean = false,
  rrfK: number = 60,
): AsyncGenerator<RunEvent> {
  const question = args[0]?.trim();
  if (!question) {
    yield { kind: "error", message: "query: question required" };
    return;
  }

  const domain = domains[0];
  if (!domain) {
    yield { kind: "error", message: "No domain configured. Add a domain in settings." };
    return;
  }
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
  const wikiVaultPath = domainWikiFolder(domain.wiki_folder);
  outputTokens += cand.seedOutputTokens;

  const indexContent = cand.indexContent;
  const seeds = cand.seeds;
  const seedScores = cand.seedScores;
  const expandedScores = cand.expandedScores;
  const selectedIds = cand.candidateIds;
  const pages = cand.pages;
  const seedSet = new Set(seeds);
  const expandedPages = [...selectedIds].filter((id) => !seedSet.has(id));
  const topK = Math.max(1, Math.min(50, Math.floor(seedTopK)));
  const fusedOrder = bfsFusion
    ? fuseVectorGraph(seeds, selectedIds, seedScores, expandedScores, cand.graph, graphDepth, rrfK)
    : undefined;
  const contextBlock = buildContextBlock(pages, seedSet, selectedIds, topK * 3, fusedOrder);

  const entityTypesBlock = buildEntityTypesBlock(domain);

  const wikiFirst = [...selectedIds].sort((a, b) =>
    Number(b.startsWith("wiki_")) - Number(a.startsWith("wiki_")));
  const availableLinksBlock = wikiFirst.length === 0 ? "" : [
    "Valid WikiLink targets (use EXACTLY these, copy verbatim):",
    ...wikiFirst.map((s) => `- ${s}`),
    "ONLY link to a target from this list. Never invent or abbreviate stems.",
  ].join("\n");

  const systemPrompt = render(queryTemplate, {
    domain_name: domain.name,
    available_links_block: availableLinksBlock,
    entity_types_block: entityTypesBlock,
    index_block: indexContent ? `\nWiki index (_index.md):\n${indexContent}` : "",
  });

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
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    answer = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (answer) yield { kind: "assistant_text", delta: answer };
  }

  if (signal.aborted) return;
  yield { kind: "tool_result", ok: !!answer, preview: answer ? `${answer.length} chars` : "no response" };

  if (answer && !signal.aborted) {
    yield { kind: "tool_use", name: "ValidateLinks", input: {} };
    let skipValidation = false;
    let knownStems = new Set<string>();
    try {
      const allVaultFiles = await vaultTools.listFiles("");
      knownStems = new Set(
        allVaultFiles.filter((f) => f.endsWith(".md")).map((f) => pageId(f)),
      );
    } catch {
      console.warn("[ai-wiki] ValidateLinks: listFiles failed, skipping");
      skipValidation = true;
      yield { kind: "tool_result", ok: false, preview: "listFiles failed — skipped" };
    }

    if (!skipValidation) {
      const links = extractAnswerLinks(answer);
      const broken = findBrokenLinks(links, knownStems);
      yield {
        kind: "tool_result",
        ok: broken.length === 0,
        preview: broken.length === 0 ? "all valid" : `${broken.length} broken`,
      };

      if (broken.length > 0) {
        yield { kind: "tool_use", name: "FixingLinks", input: { broken: broken.length } };

        // Deterministic resolve first — no LLM.
        const candidates = [...new Set([...selectedIds, ...knownStems])];
        const resolvedPairs: string[] = [];
        const stripped: string[] = [];
        for (const b of broken) {
          const r = resolveLink(b, candidates);
          if (r.kind === "resolved" && r.stem !== b) {
            answer = answer.split(`[[${b}]]`).join(`[[${r.stem}]]`);
            resolvedPairs.push(`${b}→${r.stem}`);
          } else {
            stripped.push(b);
          }
        }
        if (resolvedPairs.length > 0) yield { kind: "rule_fired", ruleId: "resolveLink", count: resolvedPairs.length };

        // Unresolved stems → one structured LLM repair pass (zod-validated), then annotate.
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
              // Retry/structural-error events are intentionally not surfaced here:
              // the FixingLinks tool_result preview already reports the outcome
              // (llm-fixed/annotated); structuralErrorCounter still records metrics.
              onEvent: () => {},
            });
            outputTokens += r.outputTokens;
            const stillBroken = findBrokenLinks(extractAnswerLinks(r.value.answer_markdown), knownStems);
            if (stillBroken.length === 0) {
              answer = r.value.answer_markdown;
              llmFixed = stripped.length;
              stripped.length = 0;
            }
          } catch (e) {
            if (signal.aborted || (e as Error).name === "AbortError") return;
            // fall through to annotation
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

  yield {
    kind: "eval_meta",
    fields: {
      question,
      answer,
      found_pages: [...new Set([...seeds, ...expandedPages])],
      promptVersion: promptVersionOf(queryTemplate),
      retrievalConfig: {
        mode: similarity?.config.mode === "hybrid" ? "hybrid" : similarity?.config.mode === "embedding" ? "embedding" : "jaccard",
        seedTopK,
        bfsTopK,
        bfsFusion,
        seedSimilarityThreshold,
        hybridRetrieval: similarity?.config.mode === "hybrid",
      },
    },
  };

  if (save && answer) {
    const slug = question.slice(0, 40).replace(/[^a-zA-Z0-9а-яёА-ЯЁ\s]/g, "").trim().replace(/\s+/g, "-");
    const savePath = `${wikiVaultPath}/Q-${slug}.md`;
    const today = new Date().toISOString().slice(0, 10);
    const pageContent = [
      `---`,
      `wiki_sources: []`,
      `wiki_updated: ${today}`,
      `wiki_status: mature`,
      `tags: []`,
      `---`,
      ``,
      `# ${question}`,
      ``,
      answer,
    ].join("\n");
    yield { kind: "tool_use", name: "Write", input: { path: savePath } };
    try {
      await vaultTools.write(savePath, pageContent);
      yield { kind: "tool_result", ok: true };
      yield { kind: "result", durationMs: Date.now() - start, text: `Создана страница: ${savePath}\n\n${answer}`, outputTokens: outputTokens || undefined };
    } catch (e) {
      yield { kind: "tool_result", ok: false, preview: (e as Error).message };
      yield { kind: "result", durationMs: Date.now() - start, text: answer, outputTokens: outputTokens || undefined };
    }
  } else {
    yield { kind: "result", durationMs: Date.now() - start, text: answer, outputTokens: outputTokens || undefined };
  }
}

async function tryRead(vaultTools: VaultTools, path: string): Promise<string> {
  try { return await vaultTools.read(path); } catch { return ""; }
}

async function llmSelectSeeds(
  question: string,
  indexAnnotations: Map<string, string>,
  allPageIds: string[],
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ seeds: string[]; outputTokens: number }> {
  const example = JSON.stringify({
    reasoning: "PageA matches keyword X; PageB referenced by index.",
    seeds: ["PageA", "PageB"],
  }, null, 2);
  const annotatedLines: string[] = [];
  const unindexedIds: string[] = [];
  for (const id of allPageIds) {
    const ann = indexAnnotations?.get(id);
    if (ann) annotatedLines.push(`${id}: ${ann}`);
    else unindexedIds.push(id);
  }
  const prompt = render(querySeedsTemplate, {
    question,
    annotated: annotatedLines.join("\n"),
    unindexed: unindexedIds.length ? `\nPages not yet indexed: ${unindexedIds.join(", ")}` : "",
    example,
  });

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: prompt },
  ];

  try {
    const r = await parseWithRetry({
      llm, model, baseMessages: messages, opts,
      schema: SeedsSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "query.seeds",
      signal,
      onEvent: () => { /* helper has no yield channel; counter still fires */ },
    });
    return { seeds: r.value.seeds, outputTokens: r.outputTokens };
  } catch {
    return { seeds: [], outputTokens: 0 };
  }
}

export function buildContextBlock(
  pages: Map<string, string>,
  seeds: Set<string>,
  selectedIds: Set<string>,
  maxPages: number,
  order?: string[],
): string {
  // Fused ordering (Tier 2): emit pages in `order`, capped at maxPages.
  if (order && order.length > 0) {
    const pidToPath = new Map<string, string>();
    for (const path of pages.keys()) pidToPath.set(pageId(path), path);
    let block = "";
    let count = 0;
    for (const id of order) {
      if (count >= maxPages) break;
      if (!selectedIds.has(id)) continue;
      const path = pidToPath.get(id);
      if (path === undefined) continue;
      block += `--- ${path} ---\n${pages.get(path) ?? ""}\n\n`;
      count++;
    }
    return block;
  }

  // Default: seeds first, then BFS-expanded pages (unchanged behavior).
  const seedPages: [string, string][] = [];
  const bfsPages: [string, string][] = [];
  for (const [path, content] of pages) {
    const id = pageId(path);
    if (!selectedIds.has(id)) continue;
    if (seeds.has(id)) seedPages.push([path, content]);
    else bfsPages.push([path, content]);
  }
  const bfsCap = Math.max(0, maxPages - seedPages.length);
  const ordered = [...seedPages, ...bfsPages.slice(0, bfsCap)];
  let block = "";
  for (const [p, c] of ordered) {
    block += `--- ${p} ---\n${c}\n\n`;
  }
  return block;
}

function buildEntityTypesBlock(domain: DomainEntry): string {
  if (!domain.entity_types?.length) return "";
  const types = domain.entity_types
    .map((et) => `  - ${et.type}: ${et.description}`)
    .join("\n");
  const notes = domain.language_notes ? `\nLanguage rules: ${domain.language_notes}` : "";
  return `Entity types of the domain "${domain.name}":\n${types}${notes}`;
}
