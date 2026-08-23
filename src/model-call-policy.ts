import type {
  CompressionOperation,
  CompressionProfile,
  LlmCallOptions,
  LlmWikiPluginSettings,
  ModelCallPolicy,
  OpKey,
  WikiOperation,
} from "./types";
import { MIN_CONTEXT_WINDOW, type ModelContextRecord } from "./model-context";
import { resolveBudget, type ResolvedBudget } from "./budget-resolver";

export type ModelControlField =
  | "inputBudgetTokens"
  | "maxTokens"
  | "compressionProfile";

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

/** An absent or invalid value stays absent instead of inventing a fallback
 * constant. Used for OpenAI budgets derived from model context when unset. */
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

/**
 * Pure: computes what an automatic native-budget text control shows for each field in
 * `values`. An absent (`undefined`) value still produces an entry — value `""` — so the
 * field is never hidden; its placeholder carries the resolved automatic number when the
 * caller has one, or `automaticPlaceholder` (default "Automatic") when it does not. Lives
 * here, not in settings.ts, so it is importable — and testable — without pulling in
 * Obsidian (settings.ts imports the `obsidian` module at the top level).
 */
export function renderNativeBudgetControls(
  values: Readonly<Record<string, number | undefined>>,
  automaticPlaceholder = "Automatic",
): Array<{ field: string; value: string; placeholder: string }> {
  return Object.keys(values).map((field) => {
    const value = values[field];
    return {
      field,
      value: value === undefined ? "" : String(value),
      placeholder: value === undefined ? automaticPlaceholder : String(value),
    };
  });
}

/**
 * Pure: applies one budget-field edit to a settings holder in place. An empty/whitespace
 * input deletes the key — that is how a stored override returns to automatic, never a
 * written 0 or default. An invalid non-empty entry is ignored, keeping the previous
 * value. A valid strictly-positive integer overwrites it.
 */
export function applyBudgetInput<K extends string>(
  holder: Partial<Record<K, number>>,
  key: K,
  raw: string,
  min = 1,
): void {
  const trimmed = raw.trim();
  if (trimmed === "") { delete holder[key]; return; }
  if (!/^[1-9]\d*$/.test(trimmed)) return;
  const parsed = Number(trimmed);
  if (Number.isSafeInteger(parsed) && parsed >= min) holder[key] = parsed;
}

type NativeAgentSettings = LlmWikiPluginSettings["nativeAgent"];

/** The window the user configured for one model, or undefined for "ask the backend". */
export function configuredContextWindowFor(
  nativeAgent: NativeAgentSettings,
  model: string,
): number | undefined {
  return nativeAgent.contextWindowTokensByModel?.[model];
}

/**
 * Writes one model's window in place. `undefined` clears it — and the last entry
 * going away takes the map with it, so a settings file that never used the feature
 * keeps the shape it had.
 */
export function setConfiguredContextWindow(
  nativeAgent: NativeAgentSettings,
  model: string,
  next: number | undefined,
): void {
  if (!model) return;
  const map = nativeAgent.contextWindowTokensByModel;
  if (next === undefined) {
    if (!map) return;
    delete map[model];
    if (Object.keys(map).length === 0) delete nativeAgent.contextWindowTokensByModel;
    return;
  }
  if (map) map[model] = next;
  else nativeAgent.contextWindowTokensByModel = { [model]: next };
}

/**
 * Every native chat model the ONE global window used to be applied to. Vision is
 * absent on purpose: nothing ever resolved a context record for `vision.model`, so
 * the old number was never that model's window and inheriting it would be a guess.
 */
function legacyWindowModels(settings: LlmWikiPluginSettings): string[] {
  const models = [
    settings.nativeAgent.model,
    ...(["ingest", "query", "lint", "init", "format"] as const)
      .map((key) => settings.nativeAgent.operations[key].model),
  ];
  return [...new Set(models.filter((model) => typeof model === "string" && model !== ""))];
}

function normalizeConfiguredContextWindows(settings: LlmWikiPluginSettings): void {
  const na = settings.nativeAgent;
  const stored = na.contextWindowTokensByModel;
  const normalized: Record<string, number> = {};
  if (stored !== null && typeof stored === "object") {
    for (const [model, value] of Object.entries(stored)) {
      // Floored, not just positive: a persisted 512 would be displayed while the
      // engine refused it and probed instead.
      const window = optionalPositiveInt(value);
      if (model !== "" && window !== undefined && window >= MIN_CONTEXT_WINDOW) {
        normalized[model] = window;
      }
    }
  }
  // The pre-per-model setting: one window for every native model. Moved onto each
  // model it covered, then consumed, so the migration runs exactly once and an
  // explicit per-model entry always wins. Reached through a cast because this is the
  // one place allowed to read the retired key.
  //
  // The key was added and retired inside the same unreleased range, so no released
  // version ever wrote it: this protects a settings file from a development build,
  // not a user upgrade path, and is documented nowhere user-facing for that reason.
  const legacyHolder = na as { contextWindowTokens?: unknown };
  const legacy = optionalPositiveInt(legacyHolder.contextWindowTokens);
  if (legacy !== undefined && legacy >= MIN_CONTEXT_WINDOW) {
    for (const model of legacyWindowModels(settings)) normalized[model] ??= legacy;
  }
  delete legacyHolder.contextWindowTokens;
  if (Object.keys(normalized).length === 0) delete na.contextWindowTokensByModel;
  else na.contextWindowTokensByModel = normalized;
}

export function normalizePersistedModelControls(settings: LlmWikiPluginSettings): void {
  normalizeConfiguredContextWindows(settings);
  settings.nativeAgent.inputBudgetTokens = optionalPositiveInt(settings.nativeAgent.inputBudgetTokens);
  settings.nativeAgent.repairInputBudgetTokens = optionalPositiveInt(settings.nativeAgent.repairInputBudgetTokens);
  settings.nativeAgent.compressionProfile =
    compressionProfile(settings.nativeAgent.compressionProfile) ?? "balanced";

  for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
    const native = settings.nativeAgent.operations[key];
    native.inputBudgetTokens = optionalPositiveInt(native.inputBudgetTokens);
    if (key === "format") {
      delete native.compressionProfile;
    } else {
      normalizeLocalCompression(native);
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

export interface ResolvedModelCall {
  model: string;
  policy: ModelCallPolicy;
  opts: LlmCallOptions;
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
  const global = settings.nativeAgent;
  const local = global.perOperation ? global.operations[key] : undefined;
  return local?.model ?? global.model;
}

/**
 * The explicit input/output caps that bind one native operation: the per-operation
 * value when per-operation controls are on, otherwise the global one. Absent means
 * "derive from the window".
 *
 * Exported because vision resolves its budget from the VISION model's own window but
 * under the FORMAT operation's caps: a number the user typed is a cost decision, and
 * changing which window a request is measured against does not repeal it.
 */
export function nativeBudgetOverrides(
  settings: LlmWikiPluginSettings,
  key: OpKey,
): { input?: number; output?: number } {
  const global = settings.nativeAgent;
  const local = global.perOperation ? global.operations[key] : undefined;
  return {
    input: local?.inputBudgetTokens ?? global.inputBudgetTokens,
    output: local?.maxTokens ?? global.maxTokens,
  };
}

/**
 * The record-aware model-call resolver. Input and output budgets are derived
 * from the model's context window
 * (`resolveBudget`) instead of falling back to fixed constants; a stored budget still
 * acts as an explicit override.
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

  const global = settings.nativeAgent;
  const local = global.perOperation ? global.operations[key] : undefined;
  const compression = key === "format"
    ? undefined
    : compressionProfile(local?.compressionProfile)
      ?? compressionProfile(global.compressionProfile)
      ?? "balanced";
  const budget = resolveBudget(record, key, nativeBudgetOverrides(settings, key));
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
