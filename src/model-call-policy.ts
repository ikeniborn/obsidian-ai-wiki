import type {
  CompressionOperation,
  CompressionProfile,
  LlmCallOptions,
  LlmWikiPluginSettings,
  ModelCallPolicy,
  OpKey,
  WikiOperation,
} from "./types";

const DEFAULT_INPUT_BUDGET = 16_384;

export type ModelControlField =
  | "inputBudgetTokens"
  | "maxTokens"
  | "compressionProfile";

export interface BackendModelControlDescriptor {
  globalFields: readonly ModelControlField[];
  operations: Record<OpKey, readonly ModelControlField[]>;
  vision: {
    fields: readonly ["compressionProfile"];
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
      vision: { fields: ["compressionProfile"], check: false },
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
    vision: { fields: ["compressionProfile"], check: true },
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
  settings.nativeAgent.inputBudgetTokens = positiveInt(
    settings.nativeAgent.inputBudgetTokens,
    DEFAULT_INPUT_BUDGET,
  );
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
    native.inputBudgetTokens = positiveInt(native.inputBudgetTokens, DEFAULT_INPUT_BUDGET);
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
    const compression = (key === "format"
      ? compressionProfile(settings.vision.compressionProfile)
      : undefined)
      ?? compressionProfile(local?.compressionProfile)
      ?? compressionProfile(global.compressionProfile)
      ?? "balanced";
    const policy: ModelCallPolicy = {
      inputBudgetTokens: positiveInt(local?.inputBudgetTokens ?? global.inputBudgetTokens, DEFAULT_INPUT_BUDGET),
      compression,
    };
    return {
      model: local?.model ?? global.model,
      policy,
      opts: {
        inputBudgetTokens: policy.inputBudgetTokens,
        semanticCompression: compressionOperation(key)
          ? { profile: compression, operation: compressionOperation(key)! }
          : undefined,
      },
    };
  }

  const global = settings.nativeAgent;
  const local = global.perOperation ? global.operations[key] : undefined;
  const compression = (key === "format"
    ? compressionProfile(settings.vision.compressionProfile)
    : undefined)
    ?? compressionProfile(local?.compressionProfile)
    ?? compressionProfile(global.compressionProfile)
    ?? "balanced";
  const outputBudget = positiveInt(local?.maxTokens ?? global.maxTokens, 4096);
  const policy: ModelCallPolicy = {
    inputBudgetTokens: positiveInt(local?.inputBudgetTokens ?? global.inputBudgetTokens, DEFAULT_INPUT_BUDGET),
    outputBudgetTokens: outputBudget,
    compression,
  };
  return {
    model: local?.model ?? global.model,
    policy,
    opts: {
      inputBudgetTokens: policy.inputBudgetTokens,
      maxTokens: outputBudget,
      temperature: local?.temperature ?? global.temperature,
      topP: global.topP,
      thinkingBudgetTokens: local?.thinkingBudgetTokens ?? global.thinkingBudgetTokens,
      semanticCompression: compressionOperation(key)
        ? { profile: compression, operation: compressionOperation(key)! }
        : undefined,
    },
  };
}
