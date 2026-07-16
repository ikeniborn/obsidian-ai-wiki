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

export function normalizeModelCallPolicySettings(settings: LlmWikiPluginSettings): void {
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
    normalizeLocalCompression(native);
    normalizeLocalCompression(claude);
  }
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
    const compression = compressionProfile(local?.compressionProfile)
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
  const compression = compressionProfile(local?.compressionProfile)
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
