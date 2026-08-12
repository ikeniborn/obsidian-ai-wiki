import type { ModelContextRecord, ModelContextStore } from "../src/model-context";

/**
 * A `ModelContextStore` that resolves one fixed record without probing. Runner tests
 * that are not about budget resolution need a store because the native path always
 * resolves a record before it builds options.
 */
export function stubModelContextStore(
  over: Partial<ModelContextRecord> = {},
): ModelContextStore {
  const record: ModelContextRecord = {
    contextWindow: 131_072,
    source: "discovered",
    calibration: 1,
    samples: 0,
    ...over,
  };
  const store: Pick<ModelContextStore, "get" | "resolve" | "observeUsage" | "observeContextError"> = {
    get: () => record,
    resolve: async () => record,
    observeUsage: () => ({ ratio: 1, applied: true, clamped: false }),
    observeContextError: () => {},
  };
  return store as ModelContextStore;
}
