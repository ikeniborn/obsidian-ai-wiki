import type {
  CompressionOperation,
  CompressionProfile,
  LlmCallOptions,
  LlmWikiPluginSettings,
  ModelCallPolicy,
  OpKey,
  WikiOperation,
} from "./types";
import type { ModelContextRecord } from "./model-context";
import { resolveBudget, type ResolvedBudget } from "./budget-resolver";

// Retained for `resolveModelCallPolicy` (the claude-agent-era resolver Task 8 removes),
// which still falls back to fixed literals when a stored value is invalid or absent.
// `resolveCallPolicy` below does not use these: an absent native budget now derives
// from the model context instead of inventing a constant.
const DEFAULT_INPUT_BUDGET = 16_384;
const DEFAULT_REPAIR_INPUT_BUDGET = 65_536;

export type ModelControlField =
  | "inputBudgetTokens"
  | "maxTokens"
  | "compressionProfile";

export interface BackendModelControlDescriptor {
  globalFields: readonly ModelControlField[];
  operations: Record<OpKey, readonly ModelControlField[]>;
  vision: {
    fields: readonly ModelControlField[];
    check: boolean;
  };
}

export function backendModelControlDescriptor(
  backend: LlmWikiPluginSettings["backend"],
): BackendModelControlDescriptor {
  if (backend === "claude-agent") {
    const fields = ["inputBudgetTokens", "compressionProfile"] as const;
    return {
      globalFields: fields,
      operations: {
        ingest: fields,
        query: fields,
        lint: fields,
        init: fields,
        format: ["inputBudgetTokens"],
      },
      vision: { fields: [], check: false },
    };
  }

  const fields = [
    "inputBudgetTokens",
    "maxTokens",
    "compressionProfile",
  ] as const;
  return {
    globalFields: fields,
    operations: {
      ingest: fields,
      query: fields,
      lint: fields,
      init: fields,
      format: ["inputBudgetTokens", "maxTokens"],
    },
    vision: { fields: [], check: true },
  };
}

export function renderModelControlFields(
  fields: readonly ModelControlField[],
  renderers: Record<ModelControlField, () => void>,
): void {
  for (const field of fields) renderers[field]();
}

export function createLiveModelControl(
  initialValue: string,
  commit: (value: string) => void | Promise<void>,
  saveOnTyping: boolean,
): {
  type: (value: string) => Promise<void>;
  select: (value: string) => Promise<void>;
  check: (run: (value: string) => void | Promise<void>) => Promise<void>;
} {
  let currentValue = initialValue;
  return {
    type: async (value) => {
      currentValue = value;
      if (saveOnTyping) await commit(value);
    },
    select: async (value) => {
      currentValue = value;
      await commit(value);
    },
    check: async (run) => {
      await run(currentValue);
    },
  };
}

function positiveInt(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    const floored = Math.floor(value);
    if (floored >= 1) return floored;
  }
  return fallback;
}

/** Like `positiveInt`, but an absent or invalid value stays absent instead of
 * inventing a fallback constant. Used for native budgets, which are now
 * derived from the model context when unset. */
function optionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const floored = Math.floor(value);
  return floored >= 1 ? floored : undefined;
}

function compressionProfile(value: unknown): CompressionProfile | undefined {
  return value === "maximum" || value === "balanced" || value === "minimum"
    ? value
    : undefined;
}

function normalizeLocalCompression(config: { compressionProfile?: CompressionProfile }): void {
  const normalized = compressionProfile(config.compressionProfile);
  if (normalized) config.compressionProfile = normalized;
  else delete config.compressionProfile;
}

export function parsePositiveBudgetInput(value: string, previous: number): number {
  const trimmed = value.trim();
  if (!/^[1-9]\d*$/.test(trimmed)) return previous;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) ? parsed : previous;
}

export function normalizePersistedModelControls(settings: LlmWikiPluginSettings): void {
  settings.nativeAgent.inputBudgetTokens = optionalPositiveInt(settings.nativeAgent.inputBudgetTokens);
  settings.nativeAgent.repairInputBudgetTokens = optionalPositiveInt(settings.nativeAgent.repairInputBudgetTokens);
  settings.claudeAgent.inputBudgetTokens = positiveInt(
    settings.claudeAgent.inputBudgetTokens,
    DEFAULT_INPUT_BUDGET,
  );
  settings.nativeAgent.compressionProfile =
    compressionProfile(settings.nativeAgent.compressionProfile) ?? "balanced";
  settings.claudeAgent.compressionProfile =
    compressionProfile(settings.claudeAgent.compressionProfile) ?? "balanced";

  for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
    const native = settings.nativeAgent.operations[key];
    const claude = settings.claudeAgent.operations[key];
    native.inputBudgetTokens = optionalPositiveInt(native.inputBudgetTokens);
    claude.inputBudgetTokens = positiveInt(claude.inputBudgetTokens, DEFAULT_INPUT_BUDGET);
    if (key === "format") {
      delete native.compressionProfile;
      delete claude.compressionProfile;
    } else {
      normalizeLocalCompression(native);
      normalizeLocalCompression(claude);
    }
  }
  normalizeLocalCompression(settings.vision);
}

export function normalizeModelCallPolicySettings(settings: LlmWikiPluginSettings): void {
  normalizePersistedModelControls(settings);
}

export function policyKey(operation: WikiOperation, parent?: OpKey): OpKey {
  if (operation === "chat") return parent === "query" ? "query" : "lint";
  if (operation === "lint-chat") return "lint";
  if (operation === "delete") return "ingest";
  return operation;
}

function compressionOperation(key: OpKey): CompressionOperation | undefined {
  if (key === "format") return undefined;
  if (key === "init" || key === "ingest") return "ingest";
  return key;
}

export function resolveModelCallPolicy(
  settings: LlmWikiPluginSettings,
  operation: WikiOperation,
  parent?: OpKey,
): { model: string; policy: ModelCallPolicy; opts: LlmCallOptions } {
  const key = policyKey(operation, parent);
  if (settings.backend === "claude-agent") {
    const global = settings.claudeAgent;
    const local = global.perOperation ? global.operations[key] : undefined;
    const compressionOp = compressionOperation(key);
    const compression = key === "format"
      ? undefined
      : compressionProfile(local?.compressionProfile)
        ?? compressionProfile(global.compressionProfile)
        ?? "balanced";
    const policy: ModelCallPolicy = {
      inputBudgetTokens: positiveInt(local?.inputBudgetTokens ?? global.inputBudgetTokens, DEFAULT_INPUT_BUDGET),
      ...(compression ? { compression } : {}),
    };
    return {
      model: local?.model ?? global.model,
      policy,
      opts: {
        inputBudgetTokens: policy.inputBudgetTokens,
        semanticCompression: compression && compressionOp
          ? { profile: compression, operation: compressionOp }
          : undefined,
      },
    };
  }

  const global = settings.nativeAgent;
  const local = global.perOperation ? global.operations[key] : undefined;
  const compressionOp = compressionOperation(key);
  const compression = key === "format"
    ? undefined
    : compressionProfile(local?.compressionProfile)
      ?? compressionProfile(global.compressionProfile)
      ?? "balanced";
  const globalOutputBudget = positiveInt(global.maxTokens, 4096);
  const outputBudget = positiveInt(local?.maxTokens ?? globalOutputBudget, globalOutputBudget);
  const outputRetryBudget = Math.max(outputBudget, globalOutputBudget);
  const inputBudget = positiveInt(local?.inputBudgetTokens ?? global.inputBudgetTokens, DEFAULT_INPUT_BUDGET);
  const repairInputBudget = key === "init" || key === "ingest"
    ? Math.max(inputBudget, positiveInt(global.repairInputBudgetTokens, DEFAULT_REPAIR_INPUT_BUDGET))
    : undefined;
  const policy: ModelCallPolicy = {
    inputBudgetTokens: inputBudget,
    ...(repairInputBudget === undefined ? {} : { repairInputBudgetTokens: repairInputBudget }),
    outputBudgetTokens: outputBudget,
    outputRetryBudgetTokens: outputRetryBudget,
    ...(compression ? { compression } : {}),
  };
  return {
    model: local?.model ?? global.model,
    policy,
    opts: {
      inputBudgetTokens: policy.inputBudgetTokens,
      repairInputBudgetTokens: policy.repairInputBudgetTokens,
      maxTokens: outputBudget,
      outputRetryBudgetTokens: outputRetryBudget,
      temperature: local?.temperature ?? global.temperature,
      topP: global.topP,
      semanticCompression: compression && compressionOp
        ? { profile: compression, operation: compressionOp }
        : undefined,
    },
  };
}

export interface ResolvedModelCall {
  model: string;
  policy: ModelCallPolicy;
  opts: LlmCallOptions;
  /** Undefined on the claude-agent path, which does not consult the record. */
  budget?: ResolvedBudget;
}

/**
 * The model that will serve this operation, without resolving its context window or
 * budgets. Callers resolve the model first, look up its `ModelContextRecord`, then
 * call `resolveCallPolicy` with that record.
 */
export function effectiveModel(
  settings: LlmWikiPluginSettings,
  operation: WikiOperation,
  parent?: OpKey,
): string {
  const key = policyKey(operation, parent);
  const global = settings.backend === "claude-agent" ? settings.claudeAgent : settings.nativeAgent;
  const local = global.perOperation ? global.operations[key] : undefined;
  return local?.model ?? global.model;
}

/**
 * The record-aware successor to `resolveModelCallPolicy`. On the native-agent path,
 * input and output budgets are derived from the model's context window
 * (`resolveBudget`) instead of falling back to fixed constants; a stored budget still
 * acts as an explicit override. The claude-agent path is unchanged: it does not read
 * `record` and keeps its fixed 16_384 input-budget default. Task 8 switches every
 * caller to this function and removes `resolveModelCallPolicy`.
 */
export function resolveCallPolicy(
  settings: LlmWikiPluginSettings,
  operation: WikiOperation,
  record: ModelContextRecord,
  parent?: OpKey,
): ResolvedModelCall {
  const key = policyKey(operation, parent);
  const compressionOp = compressionOperation(key);
  const model = effectiveModel(settings, operation, parent);

  if (settings.backend === "claude-agent") {
    // Byte-for-byte the body `resolveModelCallPolicy` has today, returned without a
    // `budget` field. `record` is not read on this path.
    const global = settings.claudeAgent;
    const local = global.perOperation ? global.operations[key] : undefined;
    const compression = key === "format"
      ? undefined
      : compressionProfile(local?.compressionProfile)
        ?? compressionProfile(global.compressionProfile)
        ?? "balanced";
    const policy: ModelCallPolicy = {
      inputBudgetTokens: positiveInt(local?.inputBudgetTokens ?? global.inputBudgetTokens, DEFAULT_INPUT_BUDGET),
      ...(compression ? { compression } : {}),
    };
    return {
      model,
      policy,
      opts: {
        inputBudgetTokens: policy.inputBudgetTokens,
        semanticCompression: compression && compressionOp
          ? { profile: compression, operation: compressionOp }
          : undefined,
      },
    };
  }

  const global = settings.nativeAgent;
  const local = global.perOperation ? global.operations[key] : undefined;
  const compression = key === "format"
    ? undefined
    : compressionProfile(local?.compressionProfile)
      ?? compressionProfile(global.compressionProfile)
      ?? "balanced";
  const budget = resolveBudget(record, key, {
    input: local?.inputBudgetTokens ?? global.inputBudgetTokens,
    output: local?.maxTokens ?? global.maxTokens,
  });
  // A stored repair budget is still clamped by the window: `resolveBudget`'s
  // `maxInput` bounds both the derived value AND an override, and a repair prompt
  // must not exceed the input budget it is repairing.
  const repairInputBudgetTokens = key === "init" || key === "ingest"
    ? Math.min(optionalPositiveInt(global.repairInputBudgetTokens) ?? budget.inputBudgetTokens, budget.inputBudgetTokens)
    : undefined;
  const policy: ModelCallPolicy = {
    inputBudgetTokens: budget.inputBudgetTokens,
    ...(repairInputBudgetTokens === undefined ? {} : { repairInputBudgetTokens }),
    outputBudgetTokens: budget.outputBudgetTokens,
    ...(compression ? { compression } : {}),
  };
  return {
    model,
    policy,
    budget,
    opts: {
      inputBudgetTokens: budget.inputBudgetTokens,
      repairInputBudgetTokens,
      maxTokens: budget.outputBudgetTokens,
      tokenCalibration: budget.calibration,
      contextWindowTokens: budget.contextWindow,
      temperature: local?.temperature ?? global.temperature,
      topP: global.topP,
      semanticCompression: compression && compressionOp
        ? { profile: compression, operation: compressionOp }
        : undefined,
      budgetTelemetry: {
        contextWindow: budget.contextWindow,
        inputSource: budget.inputSource,
        outputSource: budget.outputSource,
        calibration: budget.calibration,
      },
    },
  };
}
