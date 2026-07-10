// src/eval-log.ts
// Per-run dev-mode eval dataset: one JSONL record per run in the plugin dir,
// updated in place by 👍/👎 clicks (matched by runId). Not synced (plugin dir
// is not vault content) — labels are per-device, by design.
import type { VaultAdapter } from "./vault-tools";
import type { WikiOperation } from "./types";

export type Rating = "up" | "down" | null;

export interface LlmError {
  kind: "error" | "structural_error";
  callSite?: string;
  errorType?: string;
  retryAttempt?: number;
  message: string;
}

export interface RetrievalConfigSnapshot {
  mode: "embedding" | "jaccard" | "hybrid";
  seedTopK: number;
  bfsTopK: number;
  bfsMinScoreRatio?: number;
  bfsFusion: boolean;
  seedSimilarityThreshold: number;
  hybridRetrieval: boolean;
  hierarchicalChunkRetrieval?: boolean;
  crossDomain?: boolean;      // cross-domain query marker
  domainsSearched?: number;   // domains iterated in stage 1
}

/** Provenance the phases attach via the `eval_meta` event. All optional. */
export interface EvalMetaFields {
  question?: string;
  found_pages?: string[];   // snake_case per spec §4 schema
  found_chunks?: { articleId: string; heading: string; score: number }[];
  answer?: string;
  promptVersion?: string;
  retrievalConfig?: RetrievalConfigSnapshot;
  source_path?: string;     // snake_case per spec §4 schema
  vision?: "on" | "off";
  visionCount?: number;
  visionModel?: string;
  visionPromptVersion?: string;
  created_pages?: string[];   // ingest
  updated_pages?: string[];   // ingest
  source_paths?: string[];    // ingest (sources fed to the run)
  files_processed?: number;   // init
  domain?: string;            // init
  articles?: string[];        // lint / lint-chat (article paths touched)
  instruction?: string;       // lint-chat (user message)
  deleted_source?: string;    // delete
  rebuilt_pages?: string[];   // delete
}

export interface EvalRecord extends EvalMetaFields {
  runId: string;
  ts: string;
  operation: string;
  model: string;
  llmErrors: LlmError[];
  ruleFirings: Record<string, number>;
  ratings: Record<string, Rating>;
  comment?: string;
}

/** Canonical axis id (see OPERATION_AXES): answer | retrieval | formatting |
 *  recognition | page | links | coverage | fix | rebuild. */
export type RatingAxis = string;

/** A rating axis shown for an operation. `labelKey` indexes `i18n().view`;
 *  `gate: "vision"` means render only when the run actually ran vision. */
export interface AxisDef { id: string; labelKey: string; gate?: "vision"; }

/** Single source of truth for which 👍/👎 axes each operation exposes.
 *  Consumed by view.ts (render) and, later, eval.ts / dspy. */
export const OPERATION_AXES: Record<WikiOperation, AxisDef[]> = {
  query:       [{ id: "answer", labelKey: "ratingAnswer" }, { id: "retrieval", labelKey: "ratingRetrieval" }],
  chat:        [{ id: "answer", labelKey: "ratingAnswer" }],
  format:      [{ id: "formatting", labelKey: "ratingFormatting" }, { id: "recognition", labelKey: "ratingRecognition", gate: "vision" }],
  ingest:      [{ id: "page", labelKey: "ratingPage" }, { id: "links", labelKey: "ratingLinks" }],
  init:        [{ id: "coverage", labelKey: "ratingCoverage" }, { id: "page", labelKey: "ratingPage" }],
  lint:        [{ id: "fix", labelKey: "ratingFix" }],
  "lint-chat": [{ id: "fix", labelKey: "ratingFix" }],
  delete:      [{ id: "rebuild", labelKey: "ratingRebuild" }],
};

export function evalLogPath(pluginDir: string): string {
  return `${pluginDir}/eval.jsonl`;
}

/** Append one record at run end. Never throws (logging must not break a run). */
export async function writeEvalRecord(
  adapter: VaultAdapter,
  pluginDir: string,
  record: EvalRecord,
): Promise<void> {
  const path = evalLogPath(pluginDir);
  try {
    const line = JSON.stringify(record) + "\n";
    if (await adapter.exists(path)) await adapter.append(path, line);
    else await adapter.write(path, line);
  } catch { /* never block the run */ }
}

/**
 * Update one record's rating in place, matched by runId. Re-clicking flips the
 * value (a second identical click clears it back to null). No duplicate rows.
 * Returns the resulting Rating, or undefined when no record matched / the write
 * failed (so the caller can avoid showing a state that was not persisted).
 */
export async function updateEvalRating(
  adapter: VaultAdapter,
  pluginDir: string,
  runId: string,
  axis: RatingAxis,
  rating: "up" | "down",
): Promise<Rating | undefined> {
  const path = evalLogPath(pluginDir);
  try {
    if (!(await adapter.exists(path))) return undefined;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      if (!rec.ratings) rec.ratings = {}; // tolerate legacy lines
      const next: Rating = rec.ratings[axis] === rating ? null : rating; // flip / toggle off
      rec.ratings[axis] = next;
      lines[i] = JSON.stringify(rec);
      await adapter.write(path, lines.join("\n"));
      return next;
    }
    return undefined; // no record matched runId
  } catch { return undefined; /* never block the UI */ }
}

/**
 * Read one record's ratings + comment, matched by runId (last match wins, like
 * updateEvalRating). Returns undefined when the file/record is absent or on any
 * failure, so the caller renders no rating/comment rows. Tolerates legacy lines.
 */
export async function readEvalRecord(
  adapter: VaultAdapter,
  pluginDir: string,
  runId: string,
): Promise<{ ratings: Record<string, Rating>; comment: string } | undefined> {
  const path = evalLogPath(pluginDir);
  try {
    if (!(await adapter.exists(path))) return undefined;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      return { ratings: rec.ratings ?? {}, comment: rec.comment ?? "" };
    }
    return undefined;
  } catch { return undefined; }
}

/**
 * Set one record's comment in place, matched by runId. Returns the persisted
 * comment, or undefined when no record matched / the write failed (so the caller
 * can avoid showing a state that was not persisted). Never throws.
 */
export async function updateEvalComment(
  adapter: VaultAdapter,
  pluginDir: string,
  runId: string,
  comment: string,
): Promise<string | undefined> {
  const path = evalLogPath(pluginDir);
  try {
    if (!(await adapter.exists(path))) return undefined;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      rec.comment = comment;
      lines[i] = JSON.stringify(rec);
      await adapter.write(path, lines.join("\n"));
      return comment;
    }
    return undefined;
  } catch { return undefined; }
}
