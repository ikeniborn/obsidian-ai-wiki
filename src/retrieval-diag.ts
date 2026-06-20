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
