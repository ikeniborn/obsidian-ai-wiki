---
review:
  plan_hash: b5a714d47f9af4e3
  last_run: 2026-08-22
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-08-21-agent-trace-release-guidelines-intent.md
  spec: docs/superpowers/specs/2026-08-21-agent-trace-release-guidelines-design.md
---
# OpenAI-Only Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Claude Code backend completely while keeping the OpenAI-compatible runtime and legacy vault startup safe.

**Architecture:** Settings hydration accepts only keys in the current OpenAI-only schema allowlist and never writes merely because legacy Claude fields exist. Runtime, controller, model policy, settings UI, translations, documentation, tests, and release validation collapse onto the existing OpenAI-compatible path; historical chain artifacts remain audit records.

**Tech Stack:** TypeScript, Node test runner, Obsidian Plugin API, OpenAI SDK, ESLint, esbuild, iwiki MCP

---

## Requirement Coverage

| Spec requirement | Plan tasks | Expected result |
|---|---|---|
| R1 Single runtime contract | 1, 3, 4, 5 | Production and active developer utilities expose only OpenAI-compatible transport |
| R2 Safe legacy loading | 1, 2 | Legacy Claude settings load without a write or startup failure |
| R3 User-triggered schema cleanup | 1, 2 | Ordinary saves emit only supported current fields |
| R4 No Claude UI or current documentation | 4, 5, 6 | UI, translations, README files, and active guides are OpenAI-only |
| R5 Release-bundle guard | 6 | Postbuild rejects Claude backend markers and Node subprocess transport |
| R6 OpenAI behavior preservation | 3, 4, 5, 7 | Focused and full verification preserve OpenAI behavior |
| R7 Scope and delivery boundaries | 6, 7 | Existing release work is preserved; no LM Studio or publication action occurs |

## File Map

| Path | Responsibility |
|---|---|
| `src/types.ts` | OpenAI-only persisted/runtime settings types and defaults |
| `src/settings-persistence.ts` | Pure whitelist hydration for current persisted settings |
| `src/main.ts` | Load hydrated settings without Claude migration writes |
| `src/local-config.ts` | Whitelist local secrets and opaque supported state |
| `src/effective-settings.ts` | Overlay local OpenAI/proxy secrets without backend selection |
| `src/model-call-policy.ts` | Resolve one OpenAI policy path |
| `src/auto-budget-notice.ts` | Keep automatic-budget helpers OpenAI-only |
| `src/agent-runner.ts` | Execute one OpenAI transport path |
| `src/phases/format.ts` | Use settings-based truncation guidance without backend parameter |
| `src/phases/structured-output.ts` | Keep output-ceiling behavior without Claude exceptions |
| `src/controller.ts` | OpenAI-only preflight and runner construction |
| `src/settings.ts` | Direct OpenAI connection/model controls |
| `src/i18n.ts` | Current OpenAI-only user strings |
| `src/modals.ts` | Remove shell-consent modal |
| `src/claude-cli-client.ts` | Delete Claude subprocess transport |
| `src/stream.ts` | Delete parser used only by the removed subprocess transport |
| `src/view.ts` | Use provider-neutral ingest confirmation copy |
| `eval/claude-probe/` | Delete out-of-vault probe for the removed CLI adapter |
| `scripts/dspy/lib/backend.py` | Retain only Ollama/OpenAI-compatible optimizer backends |
| `scripts/dspy/tests/test_backend.py` | Reject the removed Claude backend and preserve Ollama coverage |
| `scripts/dspy/.env.example` | Remove Claude CLI environment settings |
| `scripts/dspy/README.md` | Document only active optimizer backends |
| `scripts/audit-bounded-init-replay.ts` | Accept only remaining runtime transport diagnostics |
| `scripts/eval-isolated-reinit.ts` | Reuse OpenAI-only settings hydration |
| `scripts/loen-dynamic-budget-routing/eval-domain-queries.ts` | Remove legacy Claude local/runtime fixture fields |
| `tests/openai-only-settings.test.ts` | Persisted and local legacy compatibility |
| `tests/openai-only-load-settings.test.ts` | Plugin-load regression proving zero Claude-triggered writes |
| `tests/model-call-policy.test.ts` | Single policy-path behavior |
| `tests/runtime-budget-wiring.test.ts` | OpenAI context and budget wiring |
| `tests/query-parity.test.ts` | Shared query behavior on the sole runtime |
| `tests/init-force-retry.test.ts` | Shared retry behavior without Claude fixtures |
| `tests/per-model-context-window.test.ts` | OpenAI context discovery only |
| `tests/vision-budget.test.ts` | OpenAI vision budget and diagnostics |
| `tests/settings-model-controls.test.ts` | OpenAI-only settings UI and model controls |
| `tests/structured-output.test.ts` | Known-context output ceilings only |
| `tests/claude-chat-context.test.ts` | Delete Claude-only transport tests |
| `tests/claude-cli-packed-context.test.ts` | Delete Claude-only packing tests |
| `tests/release-validation.test.ts` | Bundle marker rejection and updated disclosures |
| `scripts/validate-release.mjs` | Release bundle forbidden-marker gate |
| `README.md` | Current English OpenAI-only usage and disclosures |
| `docs/README.ru.md` | Current Russian OpenAI-only usage and disclosures |
| `docs/rag-quality-recommendations.md` | Remove current Claude-agent workflow claim |
| `docs/optimize.md` | Remove Claude CLI optimization option |

### Task 1: Replace persisted settings with an OpenAI-only whitelist

**Closes:** R1, R2, R3

**Files:**
- Create: `src/settings-persistence.ts`
- Create: `tests/openai-only-settings.test.ts`
- Create: `tests/openai-only-load-settings.test.ts`
- Modify: `src/types.ts`
- Modify: `src/main.ts`
- Modify: `src/model-call-policy.ts`

- [ ] **Step 1: Write failing hydration tests**

Create `tests/openai-only-settings.test.ts` with the legacy fixture and current-value assertions:

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { hydrateSettings } from "../src/settings-persistence";

test("legacy Claude selection loads as OpenAI without retaining Claude fields", () => {
  const loaded = hydrateSettings({
    backend: "claude-agent",
    claudeAgent: { model: "sonnet", allowedTools: "Read" },
    nativeAgent: {
      baseUrl: "https://llm.example/v1",
      model: "gpt-compatible",
      maxTokens: 4096,
      operations: { query: { model: "query-model", temperature: 0.4 } },
      obsoleteNestedField: true,
    },
    historyLimit: 37,
    unknownFutureField: "ignored",
  });

  assert.equal("backend" in loaded, false);
  assert.equal("claudeAgent" in loaded, false);
  assert.equal("unknownFutureField" in loaded, false);
  assert.equal(loaded.nativeAgent.baseUrl, "https://llm.example/v1");
  assert.equal(loaded.nativeAgent.model, "gpt-compatible");
  assert.equal(loaded.nativeAgent.maxTokens, 4096);
  assert.equal("obsoleteNestedField" in loaded.nativeAgent, false);
  assert.equal(loaded.nativeAgent.operations.query.model, "query-model");
  assert.equal(loaded.nativeAgent.operations.query.temperature, 0.4);
  assert.equal(loaded.historyLimit, 37);
});

test("serializing hydrated settings removes legacy fields at the later save boundary", () => {
  const loaded = hydrateSettings({
    backend: "claude-agent",
    claudeAgent: { model: "sonnet" },
    nativeAgent: { baseUrl: "http://localhost:11434/v1", model: "local" },
  });
  const saved = JSON.parse(JSON.stringify(loaded)) as Record<string, unknown>;

  assert.equal(saved.backend, undefined);
  assert.equal(saved.claudeAgent, undefined);
  assert.equal((saved.nativeAgent as { model: string }).model, "local");
});
```

- [ ] **Step 2: Run the hydration test and verify RED**

Run:

```bash
node --import tsx --test tests/openai-only-settings.test.ts
```

Expected: FAIL because `src/settings-persistence.ts` does not exist.

- [ ] **Step 3: Remove Claude settings types and defaults**

In `src/types.ts`, delete `ClaudeOperationConfig`, remove `backend` and `claudeAgent` from `LlmWikiPluginSettings`, and remove the `claudeAgent` object from `DEFAULT_SETTINGS`. Keep `NativeOperationConfig` and the current `nativeAgent` shape unchanged.

Delete these exact Claude-only declarations and members:

```typescript
export interface ClaudeOperationConfig {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  inputBudgetTokens: number;
  compressionProfile?: CompressionProfile;
}

backend: "claude-agent" | "native-agent";

claudeAgent: {
  model: string;
  inputBudgetTokens: number;
  compressionProfile: CompressionProfile;
  allowedTools: string;
  perOperation: boolean;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  operations: OpMap<ClaudeOperationConfig>;
};
```

Do not rewrite the remaining interface: retain every existing non-Claude member and `NativeOperationConfig` unchanged. Remove the matching `backend` and `claudeAgent` values from `DEFAULT_SETTINGS`.

Also narrow lifecycle diagnostics to transports that still exist and remove Claude-path comments from the remaining shared types:

```typescript
export interface LlmLifecycleDiagnostics {
  callSite?: StructuredCallSite;
  transport?: "stream" | "non-stream";
  attempt?: number;
  configuredInputBudget?: number;
  effectiveInputBudget?: number;
  provider?: string;
}
```

- [ ] **Step 4: Implement pure whitelist hydration**

Create `src/settings-persistence.ts`:

```typescript
import {
  DEFAULT_SETTINGS,
  normalizeLlmRuntimeControls,
  type LlmWikiPluginSettings,
  type OpKey,
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

function mergeKnown<T extends object>(
  defaults: T,
  value: unknown,
  optionalKeys: readonly string[] = [],
): T {
  const raw = record(value);
  const result = structuredClone(defaults) as T & Record<string, unknown>;
  const keys = new Set([...Object.keys(defaults), ...optionalKeys]);
  for (const key of keys) {
    if (key in raw) result[key] = raw[key];
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function hydrateSettings(value: unknown): LlmWikiPluginSettings {
  const stored = record(value);
  const settings = structuredClone(DEFAULT_SETTINGS);

  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof LlmWikiPluginSettings>) {
    if (NESTED_KEYS.has(key) || !(key in stored)) continue;
    (settings as unknown as Record<string, unknown>)[key] = stored[key as string];
  }

  const storedTimeouts = record(stored.timeouts);
  settings.timeouts = { ...DEFAULT_SETTINGS.timeouts, ...storedTimeouts };
  settings.history = Array.isArray(stored.history)
    ? stored.history as LlmWikiPluginSettings["history"]
    : [];

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
```

- [ ] **Step 5: Route plugin loading through hydration without a Claude migration write**

In `src/main.ts`, replace the defaults/spread/Claude merge at the start of `loadSettings` with:

```typescript
import { hydrateSettings } from "./settings-persistence";

async loadSettings(): Promise<void> {
  const data = await this.loadData() as Record<string, unknown> | null;
  this.settings = hydrateSettings(data);
```

Keep current non-Claude migrations below this boundary. Remove the `claude-code` migration, mobile backend forcing, Claude cleanup, and any save condition whose only cause is a Claude field. Preserve current migrations for output language, model controls, log enablement, dev mode, and other non-Claude schema changes.

In the exported local-file migration in `src/main.ts`, retain native-agent, proxy, and general migration behavior, but remove `lc`, the Claude-agent field copy, local backend copy, `iclaudePath`, and `shellConsentGiven` from `newLocal`. In `offerAutoBudgetMigration`, remove the obsolete backend guard and rewrite its comment for the sole OpenAI-compatible path.

Before `hydrateSettings` calls it, make `normalizePersistedModelControls` in `src/model-call-policy.ts` native-only: delete all reads and writes of `settings.claudeAgent`, while preserving native global/per-operation normalization exactly. Task 3 later removes the remaining runtime policy branch.

- [ ] **Step 6: Prove legacy plugin load performs no Claude-triggered write**

Create `tests/openai-only-load-settings.test.ts`. Reuse `tests/md-obsidian-loader.mjs`, import the default plugin class, invoke `loadSettings` on an object created from its prototype, and spy on `loadData`/`saveData`:

```typescript
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));

const { default: LlmWikiPlugin } = await import("../src/main");

test("legacy Claude fields do not cause a write during plugin load", async () => {
  let writes = 0;
  const plugin = Object.create(LlmWikiPlugin.prototype) as InstanceType<typeof LlmWikiPlugin> & {
    loadData(): Promise<unknown>;
    saveData(value: unknown): Promise<void>;
  };
  plugin.loadData = async () => ({
    backend: "claude-agent",
    claudeAgent: { model: "sonnet", allowedTools: "Read" },
    nativeAgent: {
      baseUrl: "https://llm.example/v1",
      apiKey: "test-key",
      model: "gpt-compatible",
      maxTokens: 4096,
      operations: { format: { model: "gpt-compatible", temperature: 0.2, maxTokens: 4096 } },
    },
  });
  plugin.saveData = async () => { writes++; };

  await plugin.loadSettings();

  assert.equal(writes, 0);
  assert.equal(plugin.settings.nativeAgent.model, "gpt-compatible");
  assert.equal("backend" in plugin.settings, false);
  assert.equal("claudeAgent" in plugin.settings, false);
});
```

If importing `src/main.ts` requires the fuller Obsidian stub already used by controller tests, copy that test-only loader setup unchanged; do not weaken the assertion to source-text matching.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run:

```bash
node --import tsx --test tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts tests/settings-model-controls.test.ts
```

Expected: PASS after Claude-only assertions in `tests/settings-model-controls.test.ts` are removed or converted to the sole OpenAI path.

- [ ] **Step 8: Commit Task 1**

```bash
git add src/types.ts src/settings-persistence.ts src/main.ts src/model-call-policy.ts tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts tests/settings-model-controls.test.ts
git commit -m "refactor(settings): hydrate openai-only configuration"
```

### Task 2: Sanitize local configuration without automatic writes

**Closes:** R2, R3

**Files:**
- Modify: `src/local-config.ts`
- Modify: `src/effective-settings.ts`
- Modify: `tests/openai-only-settings.test.ts`

- [ ] **Step 1: Add failing local-config preservation tests**

Append to `tests/openai-only-settings.test.ts`:

```typescript
import { sanitizeLocalConfig } from "../src/local-config";

test("local legacy fields are ignored while supported opaque state survives", () => {
  const loaded = sanitizeLocalConfig({
    iclaudePath: "/usr/bin/claude",
    backend: "claude-agent",
    shellConsentGiven: true,
    agentLogEnabled: true,
    nativeAgent: { apiKey: "secret" },
    proxy: { password: "proxy-secret" },
    lastDomain: "work",
    migrated_auto_budget: true,
    modelContext: {
      "https://llm.example/v1::model": {
        contextWindow: 32768,
        source: "configured",
        calibration: 1,
        samples: 0,
      },
    },
  });

  assert.equal("iclaudePath" in loaded, false);
  assert.equal("backend" in loaded, false);
  assert.equal("shellConsentGiven" in loaded, false);
  assert.equal(loaded.nativeAgent?.apiKey, "secret");
  assert.equal(loaded.proxy?.password, "proxy-secret");
  assert.equal(loaded.lastDomain, "work");
  assert.equal(loaded.migrated_auto_budget, true);
  assert.equal(loaded.modelContext?.["https://llm.example/v1::model"].contextWindow, 32768);
});
```

- [ ] **Step 2: Run the local test and verify RED**

```bash
node --import tsx --test tests/openai-only-settings.test.ts
```

Expected: FAIL because `sanitizeLocalConfig` is not exported.

- [ ] **Step 3: Implement the supported local shape**

In `src/local-config.ts`, remove `iclaudePath`, `backend`, and `shellConsentGiven` from `LocalConfig`; replace `DEFAULTS` with `{}`; and export:

```typescript
export function sanitizeLocalConfig(value: unknown): LocalConfig {
  const raw = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
  const result: LocalConfig = {};
  if (typeof raw.agentLogEnabled === "boolean") result.agentLogEnabled = raw.agentLogEnabled;
  if (raw.nativeAgent && typeof raw.nativeAgent === "object") {
    const apiKey = (raw.nativeAgent as { apiKey?: unknown }).apiKey;
    if (typeof apiKey === "string") result.nativeAgent = { apiKey };
  }
  if (raw.proxy && typeof raw.proxy === "object") {
    const password = (raw.proxy as { password?: unknown }).password;
    if (typeof password === "string") result.proxy = { password };
  }
  for (const key of [
    "migrated_v1",
    "migrated_v2",
    "migrated_drop_sections",
    "migrated_okf_frontmatter",
    "migrated_auto_budget",
  ] as const) {
    if (typeof raw[key] === "boolean") result[key] = raw[key];
  }
  if (typeof raw.lastDomain === "string") result.lastDomain = raw.lastDomain;
  if (raw.modelContext && typeof raw.modelContext === "object" && !Array.isArray(raw.modelContext)) {
    result.modelContext = raw.modelContext as NonNullable<LocalConfig["modelContext"]>;
  }
  return result;
}
```

Change `LocalConfigStore.load()` to parse JSON and cache `sanitizeLocalConfig(parsed)`. Keep the existing malformed-JSON fallback. Because the cache is sanitized, the next normal `save()` emits only supported fields.

- [ ] **Step 4: Remove backend selection from effective settings**

Replace `resolveEffective` in `src/effective-settings.ts` with:

```typescript
export function resolveEffective(
  settings: LlmWikiPluginSettings,
  local: LocalConfig,
): EffectiveSettings {
  const proxyBase = settings.proxy ?? { enabled: false, url: "" };
  return {
    ...settings,
    agentLogEnabled: local.agentLogEnabled ?? settings.agentLogEnabled,
    nativeAgent: {
      ...settings.nativeAgent,
      apiKey: local.nativeAgent?.apiKey ?? settings.nativeAgent.apiKey,
    },
    proxy: { ...proxyBase, password: local.proxy?.password },
  };
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

```bash
node --import tsx --test tests/openai-only-settings.test.ts
npm run typecheck
```

Expected: focused tests PASS; typecheck may still report only downstream Claude references scheduled for Tasks 3–4.

- [ ] **Step 6: Commit Task 2**

```bash
git add src/local-config.ts src/effective-settings.ts tests/openai-only-settings.test.ts
git commit -m "refactor(settings): sanitize legacy local configuration"
```

### Task 3: Collapse policy, runner, and phases onto OpenAI

**Closes:** R1, R6

**Files:**
- Modify: `src/model-call-policy.ts`
- Modify: `src/auto-budget-notice.ts`
- Modify: `src/agent-runner.ts`
- Modify: `src/phases/format.ts`
- Modify: `src/phases/structured-output.ts`
- Modify: `tests/model-call-policy.test.ts`
- Modify: `tests/runtime-budget-wiring.test.ts`
- Modify: `tests/query-parity.test.ts`
- Modify: `tests/init-force-retry.test.ts`
- Modify: `tests/per-model-context-window.test.ts`
- Modify: `tests/vision-budget.test.ts`
- Modify: `tests/structured-output.test.ts`

- [ ] **Step 1: Convert shared tests to OpenAI-only expectations**

Delete Claude-only cases and replace dual-backend loops with direct OpenAI assertions. The runner settings fixture must become:

```typescript
function runnerSettings(): LlmWikiPluginSettings {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.nativeAgent.baseUrl = "https://llm.example/v1";
  settings.nativeAgent.apiKey = "test-key";
  settings.nativeAgent.model = "chat-model";
  return settings;
}
```

Keep all shared query, retry, structured-output, context-window, vision, and budget expectations. Remove assertions whose subject is specifically “Claude does not consult the context store” or “unknown Claude context”.

- [ ] **Step 2: Run focused runtime tests and verify RED**

```bash
node --import tsx --test tests/model-call-policy.test.ts tests/runtime-budget-wiring.test.ts tests/query-parity.test.ts tests/init-force-retry.test.ts tests/per-model-context-window.test.ts tests/vision-budget.test.ts tests/structured-output.test.ts
```

Expected: FAIL because production policy and runner still reference removed settings fields.

- [ ] **Step 3: Make model-call policy OpenAI-only**

In `src/model-call-policy.ts`, remove Claude defaults and every `settings.backend` / `settings.claudeAgent` branch. Preserve the existing public signatures. `effectiveModel` becomes:

```typescript
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
```

In the existing `resolveCallPolicy(settings, operation, record, parent?)`, delete the complete `if (settings.backend === "claude-agent")` block and retain the current native body beginning with:

```typescript
const global = settings.nativeAgent;
const local = global.perOperation ? global.operations[key] : undefined;
const compression = key === "format"
  ? undefined
  : compressionProfile(local?.compressionProfile)
    ?? compressionProfile(global.compressionProfile)
    ?? "balanced";
const budget = resolveBudget(record, key, nativeBudgetOverrides(settings, key));
```

Delete only Claude-specific normalization and descriptors; retain OpenAI model-control parsing, automatic budgets, compression profiles, repair budgets, and the existing `ResolvedModelCall` return type.

In `src/auto-budget-notice.ts`, remove only Claude-specific comment clauses; keep `hasStoredNativeBudget` and `clearNativeBudgets` behavior unchanged.

- [ ] **Step 4: Make vision budget resolution unconditional for configured OpenAI vision**

In `src/agent-runner.ts`, delete `CLAUDE_PLACEHOLDER_RECORD` and remove the backend guard from `resolveVisionBudget`:

```typescript
export async function resolveVisionBudget(
  store: ModelContextStore,
  settings: LlmWikiPluginSettings,
  model: string,
  signal?: AbortSignal,
): Promise<{ budget?: ResolvedBudget; record?: ModelContextRecord; events: RunEvent[] }> {
  const events: RunEvent[] = [];
  if (!model) return { events };
  const baseUrl = settings.nativeAgent.baseUrl;
  // Keep the existing store.resolve, default-record, override, and resolveBudget logic unchanged.
}
```

Replace backend-specific policy selection, client construction, retry/watchdog selection, model label, base-URL hint, and format call with the current native branch as the sole branch. The system event must be:

```typescript
yield {
  kind: "system",
  message: `openai-compatible / ${model} / ${this.settings.nativeAgent.baseUrl}`,
};
```

Use `llmIdleRetries` for request retries through the existing OpenAI transport and do not retain the Claude operation watchdog.

- [ ] **Step 5: Remove backend parameters from format and structured output**

In `src/phases/format.ts`, delete `truncationHint`, remove the `backend` parameter from `runFormat`, and use:

```typescript
const hint = progress.truncationHintSettings;
```

Update the only `runFormat` caller accordingly. In `src/phases/structured-output.ts`, remove Claude-specific comments and keep `withOutputCeiling` dependent only on whether `contextWindowTokens` is available.

- [ ] **Step 6: Run focused runtime tests and verify GREEN**

```bash
node --import tsx --test tests/model-call-policy.test.ts tests/runtime-budget-wiring.test.ts tests/query-parity.test.ts tests/init-force-retry.test.ts tests/per-model-context-window.test.ts tests/vision-budget.test.ts tests/structured-output.test.ts
npm run typecheck
```

Expected: all focused tests PASS; remaining typecheck errors, if any, are limited to controller/settings Claude references scheduled for Task 4.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/model-call-policy.ts src/auto-budget-notice.ts src/agent-runner.ts src/phases/format.ts src/phases/structured-output.ts tests/model-call-policy.test.ts tests/runtime-budget-wiring.test.ts tests/query-parity.test.ts tests/init-force-retry.test.ts tests/per-model-context-window.test.ts tests/vision-budget.test.ts tests/structured-output.test.ts
git commit -m "refactor(runtime): use one openai-compatible path"
```

### Task 4: Remove Claude controller, subprocess, settings UI, and translations

**Closes:** R1, R4, R6

**Files:**
- Delete: `src/claude-cli-client.ts`
- Delete: `src/stream.ts`
- Delete: `tests/claude-chat-context.test.ts`
- Delete: `tests/claude-cli-packed-context.test.ts`
- Modify: `src/controller.ts`
- Modify: `src/settings.ts`
- Modify: `src/modals.ts`
- Modify: `src/i18n.ts`
- Modify: `src/view.ts`
- Modify: `tests/settings-model-controls.test.ts`
- Modify: `tests/controller-run-status.test.ts`
- Modify: `tests/controller-agent-log.test.ts`

- [ ] **Step 1: Add failing source-boundary assertions**

In `tests/settings-model-controls.test.ts`, add:

```typescript
test("current product surfaces expose no Claude backend controls", () => {
  for (const [name, source] of [
    ["settings", settingsSource],
    ["main", mainSource],
    ["modals", modalsSource],
  ] as const) {
    assert.doesNotMatch(source, /claude-agent|Claude Code|iclaudePath|shellConsentGiven|probeClaudeBinary/, name);
  }
  assert.doesNotMatch(settingsSource, /backendModelControlDescriptor/);
});
```

Add controller source coverage in `tests/controller-run-status.test.ts`:

```typescript
test("controller has only OpenAI preflight", () => {
  assert.doesNotMatch(controllerSource, /ClaudeCliClient|requireClaudeAgent|ShellConsentModal/);
  assert.match(controllerSource, /requireNativeAgent/);
});
```

- [ ] **Step 2: Run UI/controller tests and verify RED**

```bash
node --import tsx --test tests/settings-model-controls.test.ts tests/controller-run-status.test.ts tests/controller-agent-log.test.ts
```

Expected: FAIL because Claude controller and UI symbols still exist.

- [ ] **Step 3: Remove Claude controller construction and preflight**

In `src/controller.ts`, remove `ClaudeCliClient`, `_currentClaudeClient`, `requireClaudeAgent`, both shell-consent branches, and the Claude branch in `buildAgentRunner`. Keep the existing OpenAI client construction as the sole path:

```typescript
const llm = createNativeOpenAiClient({
  baseURL: s.nativeAgent.baseUrl,
  apiKey: s.nativeAgent.apiKey,
  connectionTimeoutMs: s.llmConnectionTimeoutSec * 1000,
  idleTimeoutMs: s.llmIdleTimeoutSec * 1000,
  nativeTransportDiagnosticMode: s.devMode.enabled
    ? s.devMode.nativeTransportDiagnosticMode
    : "off",
  isMobile: Platform.isMobile,
  proxyConfig: s.proxy,
  mobileFetch,
  onProxySelected: (config) => {
    console.debug(`[ai-wiki] using proxy ${maskProxyUrl(config.url)}`);
  },
  onProxyError: (error) => {
    new Notice(i18n().settings.proxy_invalid((error as Error).message));
  },
});

this._currentNativeTransportDiagnostic = llm.nativeTransportDiagnostic;
return new AgentRunner(
  llm,
  s,
  vaultTools,
  vaultName,
  domains,
  this.plugin.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.plugin.manifest.id}`,
  Platform.isMobile,
  this.modelContextStore,
);
```

Retain the existing mobile proxy warning immediately before client construction. Both command entry points must call only `requireNativeAgent(eff)` before creating a runner. Keep the agent-log envelope schema stable and set `_currentLogMeta.backend` to the constant `"openai-compatible"`; select only the native per-operation/global model:

```typescript
this._currentLogMeta = {
  backend: "openai-compatible",
  model: eff.nativeAgent.perOperation
    ? eff.nativeAgent.operations[opKey].model
    : eff.nativeAgent.model,
  agentLogEnabled: eff.agentLogEnabled,
};
```

- [ ] **Step 4: Delete subprocess transport, its parser, and shell-consent modal**

Delete `src/claude-cli-client.ts`, its now-unreferenced `src/stream.ts` parser, `tests/claude-chat-context.test.ts`, and `tests/claude-cli-packed-context.test.ts`. Remove `ShellConsentModal` and its imports/callers from `src/modals.ts`, `src/settings.ts`, and `src/controller.ts`.

- [ ] **Step 5: Render OpenAI settings directly**

In `src/settings.ts`, remove `probeClaudeBinary`, the backend dropdown, the Claude block, backend-dependent timeout labels, and backend guards. The connection section begins directly with:

```typescript
new Setting(containerEl).setName(T.settings.h3_backendConnection).setHeading();

new Setting(containerEl)
  .setName(T.settings.baseUrl_name)
  .setDesc(T.settings.baseUrl_desc)
  .addText((text) =>
    text
      .setPlaceholder("")
      .setValue(eff.nativeAgent.baseUrl)
      .onChange(async (value) => {
        s.nativeAgent.baseUrl = value.trim();
        await this.plugin.saveSettings();
      }),
  );
```

Keep all current OpenAI model, operation, retrieval, embedding, reranker, vision, proxy, and developer controls. Proxy controls remain desktop-guarded only.

- [ ] **Step 6: Remove Claude-only translation keys**

Delete the same Claude-only keys from every language object in `src/i18n.ts`: backend selection labels, `claudeCodeAgent`, `iclaudePath_*`, shell-consent text, Claude-specific retry labels, and `setClaudeCodePath`. Keep shared and OpenAI labels identical across English, Russian, and Spanish.

In `src/view.ts`, replace the ingest confirmation sentence with provider-neutral copy:

```typescript
"AI Wiki will read the file, extract entities and update domain wiki pages."
```

- [ ] **Step 7: Run focused UI/controller tests and verify GREEN**

```bash
node --import tsx --test tests/settings-model-controls.test.ts tests/controller-run-status.test.ts tests/controller-agent-log.test.ts
npm run typecheck
npm run lint
```

Expected: focused tests, typecheck, and lint PASS with no production `node:child_process` import.

- [ ] **Step 8: Commit Task 4**

```bash
git add src/controller.ts src/settings.ts src/modals.ts src/i18n.ts src/view.ts src/claude-cli-client.ts src/stream.ts tests/claude-chat-context.test.ts tests/claude-cli-packed-context.test.ts tests/settings-model-controls.test.ts tests/controller-run-status.test.ts tests/controller-agent-log.test.ts
git commit -m "refactor(ui): remove Claude backend controls"
```

### Task 5: Remove executable Claude adapters from developer utilities

**Closes:** R1, R4, R6

**Files:**
- Delete: `eval/claude-probe/.gitignore`
- Delete: `eval/claude-probe/obsidian-stub.ts`
- Delete: `eval/claude-probe/run.ts`
- Modify: `scripts/dspy/lib/backend.py`
- Modify: `scripts/dspy/tests/test_backend.py`
- Modify: `scripts/dspy/.env.example`
- Modify: `scripts/dspy/README.md`
- Modify: `scripts/audit-bounded-init-replay.ts`
- Modify: `scripts/eval-isolated-reinit.ts`
- Modify: `scripts/loen-dynamic-budget-routing/eval-domain-queries.ts`

- [ ] **Step 1: Make DSPy tests reject the removed backend**

In `scripts/dspy/tests/test_backend.py`, remove JSON/subprocess mocks, `ClaudeCodeLM` imports, and its three adapter tests. Keep the Ollama test and replace the Claude factory test with:

```python
from lib.backend import make_lm


def test_make_lm_rejects_removed_claude_code_backend(monkeypatch):
    monkeypatch.setenv("DSPY_BACKEND", "claude-code")
    monkeypatch.setenv("CLAUDE_PATH", "/usr/bin/claude")
    monkeypatch.setenv("CLAUDE_MODEL", "claude-sonnet-4-6")
    with pytest.raises(ValueError, match="ollama, ollama-openai"):
        make_lm()
```

- [ ] **Step 2: Run the DSPy test and verify RED**

```bash
cd scripts/dspy && uv run pytest tests/test_backend.py
```

Expected: the new rejection test FAILS because `make_lm()` still constructs `ClaudeCodeLM`.

- [ ] **Step 3: Remove the DSPy subprocess backend**

In `scripts/dspy/lib/backend.py`, delete `json`, `subprocess`, `SimpleNamespace`, the complete `ClaudeCodeLM` class, and the `backend == "claude-code"` branch. Keep both existing Ollama branches unchanged and make the terminal error exact:

```python
raise ValueError(
    f"DSPY_BACKEND='{backend}' не поддерживается. Допустимые значения: ollama, ollama-openai"
)
```

Remove `CLAUDE_PATH`/`CLAUDE_MODEL` from `scripts/dspy/.env.example`. In `scripts/dspy/README.md`, make the backend table list `ollama` and `ollama-openai`, delete the Claude section, and describe `lib/backend.py` as the `make_lm()` factory for those two modes. Repository agent instructions and historical audit artifacts remain unchanged.

- [ ] **Step 4: Delete the obsolete probe and update active eval fixtures**

Delete the three tracked files under `eval/claude-probe/`. In `scripts/audit-bounded-init-replay.ts`, remove `claude` from `TECHNICAL_LABEL_MARKER` and from the accepted diagnostics transports:

```typescript
const TECHNICAL_LABEL_MARKER =
  /\b(?:call[\s_-]*site|transport|attempt|(?:configured|effective|input|output|thinking)[\s_-]*budget|provider|stream|non-stream)\b/i;

if (
  typeof diagnostics.transport !== "string"
  || !["stream", "non-stream"].includes(diagnostics.transport)
) {
  failures.push(`lifecycle ${id} has invalid diagnostics.transport`);
}
```

In `scripts/eval-isolated-reinit.ts`, replace its duplicate dual-backend `mergeSettings` body with the production whitelist:

```typescript
import { hydrateSettings } from "../src/settings-persistence";

export function mergeSettings(data: Record<string, unknown> | null): LlmWikiPluginSettings {
  return hydrateSettings(data);
}
```

The import path is `../src/settings-persistence` from `scripts/eval-isolated-reinit.ts`. In `scripts/loen-dynamic-budget-routing/eval-domain-queries.ts`, remove the `iclaudePath` fixture default and the `settings.backend` assertion; keep the native API-key preflight.

- [ ] **Step 5: Verify developer utilities are OpenAI-only**

```bash
cd scripts/dspy && uv run pytest
cd ../.. && npm run typecheck
rg -n "ClaudeCodeLM|DSPY_BACKEND=claude-code|CLAUDE_PATH|probeClaudeBinary|diagnostics\.transport.*claude" scripts/dspy/lib/backend.py scripts/dspy/tests/test_backend.py scripts/dspy/.env.example scripts/dspy/README.md scripts/audit-bounded-init-replay.ts scripts/eval-isolated-reinit.ts scripts/loen-dynamic-budget-routing/eval-domain-queries.ts
```

Expected: DSPy tests and typecheck PASS; scoped scan returns no matches. `scripts/dspy/CLAUDE.md` is excluded because it is a repository agent instruction, not an executable backend or current user guide.

- [ ] **Step 6: Commit Task 5**

```bash
git add eval/claude-probe scripts/dspy/lib/backend.py scripts/dspy/tests/test_backend.py scripts/dspy/.env.example scripts/dspy/README.md scripts/audit-bounded-init-replay.ts scripts/eval-isolated-reinit.ts scripts/loen-dynamic-budget-routing/eval-domain-queries.ts
git commit -m "refactor(tooling): remove Claude CLI adapters"
```

### Task 6: Update current documentation and enforce release-bundle removal

**Closes:** R4, R5, R7

**Files:**
- Modify: `README.md`
- Modify: `docs/README.ru.md`
- Modify: `docs/rag-quality-recommendations.md`
- Modify: `docs/optimize.md`
- Modify: `scripts/validate-release.mjs`
- Modify: `tests/release-validation.test.ts`

- [ ] **Step 1: Add failing bundle-marker tests**

Append to `tests/release-validation.test.ts`:

```typescript
test("postbuild validation rejects Claude backend markers", async (t) => {
  const root = await createPostbuildFixture({
    "dist/main.js": "const backend = 'claude-agent';\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[dist\/main\.js\] forbidden Claude backend marker/);
});

test("postbuild validation rejects Node subprocess transport", async (t) => {
  const root = await createPostbuildFixture({
    "dist/main.js": "import('node:child_process');\n",
  });
  t.after(() => rm(root, { recursive: true, force: true }));

  const result = validate(root, "postbuild");

  assert.equal(result.status, 1);
  assert.match(result.stderr, /\[dist\/main\.js\] forbidden Node subprocess transport/);
});
```

Update `README_TEXT` so its external-file disclosure states that the plugin does not execute a user-configured AI CLI.

- [ ] **Step 2: Run release tests and verify RED**

```bash
node --import tsx --test tests/release-validation.test.ts
```

Expected: the two new postbuild tests FAIL because the validator lacks marker checks.

- [ ] **Step 3: Add postbuild forbidden-marker validation**

Inside the existing `dist/main.js` read block in `scripts/validate-release.mjs`, add:

```javascript
if (/claude-agent|ClaudeCliClient|iclaudePath/.test(main)) {
  errors.push("[dist/main.js] forbidden Claude backend marker");
}
if (/(?:node:)?child_process/.test(main)) {
  errors.push("[dist/main.js] forbidden Node subprocess transport");
}
```

Keep the inline-source-map check and every existing release validation unchanged.

- [ ] **Step 4: Rewrite current user documentation as OpenAI-only**

In `README.md` and `docs/README.ru.md`:

- state that OpenAI-compatible transport is the only runtime;
- retain Ollama and remote OpenAI-compatible setup;
- remove Claude quick start, backend selector, CLI path, consent, Claude budgets, and dual-backend comparisons;
- describe `local.json` as storing OpenAI API key, proxy password, model-context records, and machine-local state;
- keep Community directory disclosures, replacing subprocess disclosure with the fact that no user-configured AI CLI is executed.

Use these canonical disclosure statements, retaining the surrounding headings and existing vault-access/license text:

```markdown
AI Wiki sends selected note content and prompts only to the OpenAI-compatible service configured by the user. The endpoint may be local, such as Ollama, or remote. Network access is used only for AI operations and optional model probes the user starts.

AI Wiki does not execute a user-configured AI CLI or another external AI process.
```

```markdown
AI Wiki отправляет выбранное содержимое заметок и промты только в настроенный пользователем OpenAI-совместимый сервис. Endpoint может быть локальным, например Ollama, или удалённым. Сеть используется только для запущенных пользователем AI-операций и опциональных проверок модели.

AI Wiki не запускает пользовательский AI CLI или другой внешний AI-процесс.
```

In `docs/rag-quality-recommendations.md`, replace its opening context with:

```markdown
Контекст: плагин использует vector seed selection, graph BFS и optional reranking через единый OpenAI-совместимый runtime. Граф вики служит индексом для BFS и seed-выбора. Рекомендации состыковывают эти сигналы и поддерживают граф здоровым.
```

In `docs/optimize.md`, delete the complete `Вариант 2 — claude-code` section and keep the Ollama configuration as the only documented optimizer setup. Do not edit historical `docs/superpowers/` artifacts or repository agent instruction files.

- [ ] **Step 5: Add a scoped current-surface scan**

Run:

```bash
rg -n "claude-agent|Claude Code|Claude Agent|iclaudePath|shellConsentGiven|ClaudeCliClient" src README.md docs/README.ru.md docs/rag-quality-recommendations.md docs/optimize.md
```

Expected: no matches.

- [ ] **Step 6: Run release tests and validation**

```bash
node --import tsx --test tests/release-validation.test.ts
npm run release:validate:pre
```

Expected: release tests and prebuild validation PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add README.md docs/README.ru.md docs/rag-quality-recommendations.md docs/optimize.md scripts/validate-release.mjs tests/release-validation.test.ts
git commit -m "fix(release): reject Claude backend bundle markers"
```

### Task 7: Complete verification and documentation reconciliation

**Closes:** R6, R7 and every intent outcome

**Files:**
- Modify: bound iwiki page `architecture/openai-only-runtime`
- Modify: bound iwiki page `architecture/community-release-validation`
- Modify: bound iwiki task page `reference/tasks/agent-trace-release-guidelines`
- Generated by build: `dist/main.js`
- Generated by build: `dist/manifest.json`
- Generated by build: `dist/styles.css`

- [ ] **Step 1: Verify production and current docs contain no removed path**

```bash
rg -n "claude-agent|Claude Code|Claude Agent|iclaudePath|shellConsentGiven|ClaudeCliClient|ClaudeCodeLM|DSPY_BACKEND=claude-code|CLAUDE_PATH|probeClaudeBinary" src scripts/dspy/lib/backend.py scripts/dspy/tests/test_backend.py scripts/dspy/.env.example scripts/dspy/README.md scripts/audit-bounded-init-replay.ts scripts/eval-isolated-reinit.ts scripts/loen-dynamic-budget-routing/eval-domain-queries.ts README.md docs/README.ru.md docs/rag-quality-recommendations.md docs/optimize.md
rg -n "node:child_process|from ['\"]child_process['\"]" src
```

Expected: both commands return no matches.

- [ ] **Step 2: Run focused affected tests**

```bash
node --import tsx --test tests/openai-only-settings.test.ts tests/openai-only-load-settings.test.ts tests/settings-model-controls.test.ts tests/model-call-policy.test.ts tests/runtime-budget-wiring.test.ts tests/query-parity.test.ts tests/init-force-retry.test.ts tests/per-model-context-window.test.ts tests/vision-budget.test.ts tests/structured-output.test.ts tests/controller-run-status.test.ts tests/controller-agent-log.test.ts tests/release-validation.test.ts
cd scripts/dspy && uv run pytest
cd ../..
```

Expected: all focused tests PASS.

- [ ] **Step 3: Run complete static and test gates**

```bash
npm test
npm run lint
npm run typecheck
```

Expected: complete tests, lint, and typecheck PASS without a new warning or failure.

- [ ] **Step 4: Build and run both release phases**

```bash
npm run release:validate:pre
npm run build
npm run release:validate:post
git diff --check
```

Expected: prebuild, build, postbuild, and diff checks PASS; the built bundle passes the new marker gate.

- [ ] **Step 5: Reconcile documentation through iwiki MCP**

Update `architecture/openai-only-runtime` from planned to implemented behavior, update `architecture/community-release-validation` with the forbidden-marker gate, append verification evidence to `reference/tasks/agent-trace-release-guidelines`, and run `wiki_lint`.

Expected: hosted writes succeed, task lifecycle remains `in-progress` until result reconciliation, and lint reports no new broken, stale-source, or task-page finding.

- [ ] **Step 6: Run full chain result reconciliation**

```text
$check-chain result docs/superpowers/plans/2026-08-22-agent-trace-release-guidelines.md --since=75743d5d
```

Expected: every R1–R7 commitment maps to implementation/test/documentation evidence across the full post-spec branch diff; no LM Studio or publication change is present; verdict `OK` is required before branch finishing.

- [ ] **Step 7: Commit Task 7 after result approval**

```bash
git add dist/main.js dist/manifest.json dist/styles.css
git commit -m "chore(build): refresh openai-only plugin bundle"
```

## Pre-Execution Gate

This plan must not be executed in the current planning session. Before Task 1, a human must explicitly authorize implementation and select an execution method. Publishing, pushing, PR creation, Community directory submission, LM Studio work, and automatic destructive migration remain outside that authorization.

## Expected Final Outcome

After later authorized execution, AI Wiki has one OpenAI-compatible runtime, legacy Claude-selected vaults start without an automatic migration write, ordinary saves emit only the current schema, active developer utilities contain no executable Claude adapter, current product surfaces contain no Claude backend, release validation rejects reintroduction, and all focused/full gates pass.
