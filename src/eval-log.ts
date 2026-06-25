// src/eval-log.ts
// Per-run dev-mode eval dataset: one JSONL record per run in the plugin dir,
// updated in place by 👍/👎 clicks (matched by runId). Not synced (plugin dir
// is not vault content) — labels are per-device, by design.
import type { DataAdapter } from "obsidian";

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
  bfsFusion: boolean;
  seedSimilarityThreshold: number;
  hybridRetrieval: boolean;
}

/** Provenance the phases attach via the `eval_meta` event. All optional. */
export interface EvalMetaFields {
  question?: string;
  found_pages?: string[];   // snake_case per spec §4 schema
  answer?: string;
  promptVersion?: string;
  retrievalConfig?: RetrievalConfigSnapshot;
  source_path?: string;     // snake_case per spec §4 schema
  vision?: "on" | "off";
  visionCount?: number;
  visionModel?: string;
  visionPromptVersion?: string;
}

export interface EvalRecord extends EvalMetaFields {
  runId: string;
  ts: string;
  operation: string;
  model: string;
  llmErrors: LlmError[];
  ruleFirings: Record<string, number>;
  rating: Rating;
  recognitionRating?: Rating;
}

/** Rating axes a click can set. "answer"/"formatting" → `rating`; "recognition" → `recognitionRating`. */
export type RatingAxis = "answer" | "formatting" | "recognition";

export function evalLogPath(pluginDir: string): string {
  return `${pluginDir}/eval.jsonl`;
}

/** Append one record at run end. Never throws (logging must not break a run). */
export async function writeEvalRecord(
  adapter: DataAdapter,
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
 */
export async function updateEvalRating(
  adapter: DataAdapter,
  pluginDir: string,
  runId: string,
  axis: RatingAxis,
  rating: "up" | "down",
): Promise<void> {
  const path = evalLogPath(pluginDir);
  try {
    if (!(await adapter.exists(path))) return;
    const content = await adapter.read(path);
    const lines = content.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const raw = lines[i].trim();
      if (!raw) continue;
      let rec: EvalRecord;
      try { rec = JSON.parse(raw) as EvalRecord; } catch { continue; }
      if (rec.runId !== runId) continue;
      const field = axis === "recognition" ? "recognitionRating" : "rating";
      rec[field] = rec[field] === rating ? null : rating; // flip / toggle off
      lines[i] = JSON.stringify(rec);
      await adapter.write(path, lines.join("\n"));
      return;
    }
  } catch { /* never block the UI */ }
}
