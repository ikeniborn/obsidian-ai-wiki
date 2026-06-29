import type { DomainCandidates } from "./query";
import { fuseVectorGraph } from "../fusion";
import type { DomainEntry } from "../domain";
import type { LlmCallOptions, RunEvent, LlmClient } from "../types";
import type { VaultTools } from "../vault-tools";
import type { PageSimilarityService } from "../page-similarity";
import { retrieveDomainCandidates, buildContextBlock, type RetrieveCfg } from "./query";
import { answerFromContext } from "./query-answer";
import { render } from "./template";
import queryTemplate from "../../prompts/query.md";
import { promptVersionOf } from "../prompt-version";

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
  const poolList: DomainCandidates[] = [];
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

  const contextBlock = buildContextBlock(merged.mergedPages, merged.mergedSeedSet, finalSet, cfg.seedTopK, merged.fusedOrder);

  // Domains whose candidates survive into the final capped set (robust to underscores in domain ids).
  const finalDomains = [...new Set(
    poolList
      .filter((c) => [...c.candidateIds].some((id) => finalSet.has(id)))
      .map((c) => c.domainId)
  )];
  const finalNames = finalDomains.map((id) => domains.find((d) => d.id === id)?.name ?? id);
  const domainName = `All domains (${finalDomains.length}): ${finalNames.join(", ")}`;

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
        bfsFusion: true,
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
    const notes = d.language_notes ? `\nLanguage rules: ${d.language_notes}` : "";
    blocks.push(`Entity types of "${d.name}":\n${types}${notes}`);
  }
  return blocks.join("\n");
}

function buildCrossDomainIndexBlock(annotations: Map<string, string>, finalIds: string[]): string {
  return finalIds
    .map((id) => { const a = annotations.get(id); return a ? `${id}: ${a}` : null; })
    .filter((x): x is string => x !== null)
    .join("\n");
}
