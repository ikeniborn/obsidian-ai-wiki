import type {
  CompressionOperation,
  LlmCallOptions,
  LlmWikiPluginSettings,
  ModelCallPolicy,
  OpKey,
  WikiOperation,
} from "./types";

const DEFAULT_INPUT_BUDGET = 16_384;

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : fallback;
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
    const compression = local?.compressionProfile ?? global.compressionProfile ?? "balanced";
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
  const compression = local?.compressionProfile ?? global.compressionProfile ?? "balanced";
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
