// Obsidian-free retrieval diagnostics — shared by the query seed gate and the
// progress view, kept dependency-light so the out-of-vault eval can import it.

export type RetrievalMode = "jaccard" | "embedding" | "hybrid";
export type SeedFallbackReason = "low-similarity" | "embed-failed";

export interface SeedDiag {
  /** Final ranked seeds for the mode (hybrid RRF, embedding cosine, or jaccard). */
  results: { path: string; score: number }[];
  /** Max raw cosine of the dense side. 0 in jaccard mode or when embedding failed. */
  denseMax: number;
  /** True when the embedding HTTP call threw and the dense side degraded to jaccard. */
  embedFailed: boolean;
  /** Raw cosine per pageId for EVERY scored page with a dense vector. Empty in jaccard
   *  mode / on embed failure. Used by the relevance floor (src/retrieval-prune.ts). */
  denseByPid: Record<string, number>;
}

/**
 * Seed-quality gate. Returns true when the dense embedding signal is strong enough
 * to trust the embedding/hybrid ranking. Compares against the raw cosine `denseMax`,
 * NOT the RRF-fused score (whose max is ~2/(k+1) ≈ 0.033 and never clears a
 * cosine-scaled threshold — the bug this fixes).
 */
export function seedPassesGate(denseMax: number, threshold: number): boolean {
  return denseMax >= threshold;
}

/**
 * Short retrieval tag for the progress view, e.g. `vector`, `jaccard (low 0.21)`,
 * `jaccard (embed failed)`, `llm seeds`, `jaccard`.
 */
export function retrievalTag(
  mode: RetrievalMode,
  seedFallback: "none" | "jaccard" | "llm",
  reason: SeedFallbackReason | undefined,
  denseMax: number | undefined,
): string {
  if (mode === "jaccard") return "jaccard";
  if (seedFallback === "llm") return "llm seeds";
  if (seedFallback === "jaccard") {
    return reason === "embed-failed"
      ? "jaccard (embed failed)"
      : `jaccard (low ${(denseMax ?? 0).toFixed(2)})`;
  }
  return "vector";
}

/** Longest provider-supplied reason shown in the sidebar; the rest is dropped. */
const DEGRADE_VALUE_MAX_CHARS = 240;

export interface QueryDegradeLine {
  label: string;
  value: string;
}

interface QueryDegradeLabels {
  statsRerankerFallback: string;
  statsRetrievalDegraded: string;
  rerankerFallbackReason: (reason: string) => string;
}

interface QueryDegradeInput {
  reranker?: { fallbackReason?: string };
  retrievalDegraded?: string;
}

/**
 * Rows describing why a query answered on a degraded path. Both signals were
 * produced and then dropped before reaching the user: the reranker fallback
 * reached `query_stats` and the view never read it, and the retrieval degrade
 * was swallowed by a bare catch. The reranker reason is a closed enum and is
 * translated; the retrieval reason is provider text, so it is only bounded.
 */
export function queryDegradeLines(
  stats: QueryDegradeInput,
  labels: QueryDegradeLabels,
): QueryDegradeLine[] {
  const lines: QueryDegradeLine[] = [];
  const fallbackReason = stats.reranker?.fallbackReason;
  if (fallbackReason) {
    lines.push({ label: labels.statsRerankerFallback, value: labels.rerankerFallbackReason(fallbackReason) });
  }
  const degraded = stats.retrievalDegraded?.replace(/\s+/g, " ").trim();
  if (degraded) {
    lines.push({ label: labels.statsRetrievalDegraded, value: degraded.slice(0, DEGRADE_VALUE_MAX_CHARS) });
  }
  return lines;
}
