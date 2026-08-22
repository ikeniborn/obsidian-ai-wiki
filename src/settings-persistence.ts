import {
  DEFAULT_SETTINGS,
  normalizeLlmRuntimeControls,
  type LlmWikiPluginSettings,
  type OpKey,
  type RunHistoryEntry,
} from "./types";
import { normalizePersistedModelControls } from "./model-call-policy";

const OP_KEYS: readonly OpKey[] = ["ingest", "query", "lint", "init", "format"];
const NESTED_KEYS = new Set<keyof LlmWikiPluginSettings>([
  "timeouts",
  "history",
  "nativeAgent",
  "proxy",
  "vision",
  "devMode",
  "lintOptions",
]);

const NATIVE_OPTIONAL_KEYS = [
  "contextWindowTokens",
  "contextWindowTokensByModel",
  "inputBudgetTokens",
  "repairInputBudgetTokens",
  "maxTokens",
  "thinkingBudgetTokens",
  "embeddingModel",
  "embeddingDimensions",
  "relevantPagesTopK",
  "mergeDeleteWarnThreshold",
  "chunkMaxChars",
  "chunkOverlapChars",
  "chunkMinChars",
  "chunkMaxCount",
] as const;
const OPERATION_OPTIONAL_KEYS = [
  "inputBudgetTokens",
  "maxTokens",
  "thinkingBudgetTokens",
  "compressionProfile",
] as const;
const HISTORY_KEYS = [
  "id",
  "operation",
  "args",
  "domainId",
  "startedAt",
  "finishedAt",
  "status",
  "finalText",
] as const;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function copyKnown(
  value: unknown,
  keys: readonly string[],
): Record<string, unknown> {
  const raw = record(value);
  return Object.fromEntries(keys.flatMap((key) => key in raw ? [[key, raw[key]]] : []));
}

function mergeKnown<T extends object>(
  defaults: T,
  value: unknown,
  optionalKeys: readonly string[] = [],
): T {
  return {
    ...structuredClone(defaults),
    ...copyKnown(value, [...Object.keys(defaults), ...optionalKeys]),
  };
}

function hydrateHistory(value: unknown): RunHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = record(entry);
    const args = Array.isArray(raw.args)
      ? raw.args.filter((arg): arg is string => typeof arg === "string")
      : [];
    const steps = Array.isArray(raw.steps)
      ? raw.steps.map((step) => copyKnown(step, ["kind", "label"]))
      : [];
    return { ...copyKnown(raw, HISTORY_KEYS), args, steps } as unknown as RunHistoryEntry;
  });
}

export function hydrateSettings(value: unknown): LlmWikiPluginSettings {
  const stored = record(value);
  const settings = structuredClone(DEFAULT_SETTINGS);

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof LlmWikiPluginSettings>) {
    if (NESTED_KEYS.has(key) || !(key in stored)) continue;
    (settings as unknown as Record<string, unknown>)[key] = stored[key as string];
  }

  settings.timeouts = mergeKnown(DEFAULT_SETTINGS.timeouts, stored.timeouts);
  settings.history = hydrateHistory(stored.history);

  const storedNative = record(stored.nativeAgent);
  const storedOperations = record(storedNative.operations);
  settings.nativeAgent = {
    ...mergeKnown(DEFAULT_SETTINGS.nativeAgent, storedNative, NATIVE_OPTIONAL_KEYS),
    operations: Object.fromEntries(OP_KEYS.map((key) => [
      key,
      mergeKnown(
        DEFAULT_SETTINGS.nativeAgent.operations[key],
        storedOperations[key],
        OPERATION_OPTIONAL_KEYS,
      ),
    ])) as LlmWikiPluginSettings["nativeAgent"]["operations"],
  };
  settings.proxy = mergeKnown(DEFAULT_SETTINGS.proxy, stored.proxy, ["username", "noProxy"]);
  settings.vision = mergeKnown(DEFAULT_SETTINGS.vision, stored.vision, ["compressionProfile"]);
  settings.devMode = mergeKnown(DEFAULT_SETTINGS.devMode, stored.devMode);
  settings.lintOptions = mergeKnown(DEFAULT_SETTINGS.lintOptions, stored.lintOptions);

  normalizePersistedModelControls(settings);
  normalizeLlmRuntimeControls(settings);
  return settings;
}
