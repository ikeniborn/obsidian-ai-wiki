// Config registry (Component 6). Tier 2 adds entries (dense+rrf, dense+rerank)
// as one record each; the orchestration dispatches on `mode` + future fields.

export interface ConfigRecord {
  name: string;
  mode: "embedding" | "jaccard"; // PageSimilarityService mode
  bfsDepth: number;
  topK: number;
}

// "dense" is the config name; "embedding" is its underlying mechanism (the
// embedding cache + selectRelevantScored). "jaccard" is keyless token overlap.
const NAME_TO_MODE: Record<string, ConfigRecord["mode"]> = {
  dense: "embedding",
  jaccard: "jaccard",
};

export function resolveConfigs(
  configFlag: string | undefined,
  bfsDepth: number,
  topK: number,
): ConfigRecord[] {
  const names = (configFlag ?? "dense,jaccard")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return names.map((name) => {
    const mode = NAME_TO_MODE[name];
    if (!mode) {
      throw new Error(`unknown --config "${name}" (expected: dense, jaccard)`);
    }
    return { name, mode, bfsDepth, topK };
  });
}
