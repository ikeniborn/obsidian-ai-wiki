---
review:
  plan_hash: 2170b83ff543ae41
  last_run: 2026-07-20
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-16-bounded-ingest-model-controls-intent.md
  spec: docs/superpowers/specs/2026-07-16-bounded-ingest-model-controls-design.md
---

# Bounded Ingest and Model Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every model request inside an explicit input budget, recover native OpenAI-compatible requests from bounded transient failures without replaying completed work, and preserve complete source evidence, non-destructive wiki updates, reusable embeddings, understandable model progress, and a complete full-Re-init domain rebuild.

**Architecture:** A shared model-call policy resolves backend-specific input/output budgets and semantic compression. A conservative prompt governor packs complete context units and repacks on provider context errors. Ingest becomes a Markdown-aware evidence map/reduce pipeline whose synthesis emits complete creates or hash-guarded section patches; Query, Chat, Lint, Format, and Vision receive preservation-aware budget adapters. A native request executor owns connection/idle timeouts and bounded retry of the identical HTTP request, while structured repair and context repacking retain separate budgets. A shared lifecycle emits human model states while preserving log-only diagnostics, and destructive Re-init transactionally removes and recreates the complete target domain tree. `index.jsonl` remains structured storage and never crosses a prompt boundary.

**Tech Stack:** TypeScript, OpenAI-compatible chat API, Claude CLI adapter, Zod, Obsidian plugin API, JSONL domain storage, Node test runner through `tsx`, ESLint, esbuild.

**Intent:** `docs/superpowers/intents/2026-07-16-bounded-ingest-model-controls-intent.md`

**Spec:** `docs/superpowers/specs/2026-07-16-bounded-ingest-model-controls-design.md`

---

## Baseline and Global Constraints

- Branch: `dev-bounded-ingest-model-controls`.
- Baseline on 2026-07-16: `185/185` executable tests pass; ESLint reports `0` errors and four existing Node-import warnings; production build succeeds.
- Preserve persisted `nativeAgent.maxTokens` and `nativeAgent.operations.*.maxTokens` keys. Only their UI labels change to `Output budget tokens`.
- Default input budget is `16384`; default semantic compression is `balanced`.
- Native owns input and output budgets. Claude owns plugin-side input packing only; its output cap remains external.
- Format uses numeric budgets but receives no semantic-compression instruction.
- No model-specific tokenizer dependency and no `index.jsonl` schema change.
- Do not run destructive acceptance checks against the working vault. The 22-source replay uses a separate copied vault.
- Each task follows red-green-refactor: add a focused failing test, confirm the expected failure, make the smallest implementation, rerun the focused suite, then commit.
- Tests that load prompt-bearing modules must register `tests/md-obsidian-loader.mjs` before dynamically importing those modules, matching `tests/structured-output.test.ts`.

## File Responsibility Map

- `src/model-call-policy.ts`: pure backend/operation policy resolution.
- `src/semantic-compression.ts`: shared profile fragments plus operation preservation invariants.
- `src/prompt-budget.ts`: conservative estimation, whole-unit packing, context-error classification, bounded repack, and budget telemetry.
- `src/content-hash.ts`: deterministic hashes shared by chunks, pages, and section guards.
- `src/markdown-chunks.ts`: lossless source chunks and complete wiki/format sections.
- `src/section-patches.ts`: parse, validate, and apply hash-guarded `add`/`append`/`replace` patches.
- `src/wiki-index-jsonl.ts`: pure page/chunk record transformations.
- `src/wiki-index-store.ts`: `VaultTools` I/O for structured page-record updates.
- `src/phases/ingest-evidence.ts`: source evidence mapping, validation, deduplication, and recursive reduction.
- `src/ingest-context.ts`: per-entity candidate sections, global packing, and synthesis batching.
- `src/phases/ingest-synthesis.ts`: structured create/patch generation and one bounded conflict regeneration.
- `src/phases/query-budget.ts`: whole-unit Query context and follow-up Chat history packing.
- `src/phases/lint-batches.ts`: complete Lint work coverage and deterministic finding merge.
- `src/phases/format-segments.ts`: preservation-oriented segmentation and ordered reassembly.
- `src/phases/vision-recognition.ts`: typed recognition records and PDF page batching.
- `src/vision-probe.ts`: pure native multimodal availability probe with injected transport.
- `src/native-request-retry.ts`: pure native error classification, retry-header parsing,
  deterministic delay calculation, and retry telemetry types.
- `src/native-llm-executor.ts`: stream/non-stream request attempts, meaningful-output
  guard, idle timing, cancellation, and lifecycle/event callbacks.
- `src/proxy.ts`: desktop direct/proxy DNS/TCP/TLS connection timeout wiring.
- Existing phase files remain orchestration owners and delegate to these focused modules.

## Requirement Traceability

| Requirement | Implemented by |
|---|---|
| R1 Raw Index Isolation | Tasks 6, 10, 17 |
| R2 Input and Output Budgets | Tasks 1, 3, 8-16 |
| R3 Safe Context Recovery | Tasks 3, 7-15 |
| R4 Complete Source Chunking | Tasks 4, 7, 17 |
| R5 Evidence Coverage | Tasks 7, 10, 17 |
| R6 Globally Bounded Wiki Context | Tasks 8, 10, 17 |
| R7 Non-Destructive Page Updates | Tasks 5, 9, 10, 12 |
| R8 Structured Index Integrity | Tasks 6, 10, 17 |
| R9 Honest Init Resume State | Task 10 |
| R10 Semantic Compression Invariants | Tasks 2, 7, 11-16 |
| R11 Settings Compatibility | Tasks 1, 16 |
| R12 Native Vision Availability Check | Task 16 |
| R13 Safe Diagnostics | Tasks 3, 17 |
| R14 Backend Boundaries | Tasks 1, 3, 11, 16 |
| R15 Documentation and Acceptance | Task 17 |
| R16 Bounded Non-Ingest Operations | Tasks 11-15, 17 |
| R17 Human-Readable Model Progress | Tasks 18-20, 22 |
| R18 Complete Destructive Re-init Wipe | Tasks 21-22 |
| R19 Native Request-Scoped Transient Recovery | Tasks 23-25, 27 |
| R20 Retry Safety and Error Precision | Tasks 23-25 |
| R21 Independent Native Timeout Controls | Tasks 26-27 |
| R22 Retry Lifecycle and Diagnostics | Tasks 24-27 |

## Phase 1: Shared Policy and Prompt Governance

### Task 1: Persist and Resolve Backend-Specific Model-Call Policies

**Requirements:** R2, R11, R14

**Files:**
- Create: `src/model-call-policy.ts`
- Create: `tests/model-call-policy.test.ts`
- Modify: `src/types.ts` (`LlmCallOptions`, settings interfaces, defaults, `RunRequest`)
- Modify: `src/main.ts` (`loadSettings` nested default merge and invalid persisted-value normalization)
- Modify: `src/agent-runner.ts` (`buildOptsFor` delegates to the pure resolver)
- Modify: `tests/init-force-retry.test.ts` (existing private resolver assertions)

- [ ] **Step 1: Write policy-resolution tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings } from "../src/types";
import { resolveModelCallPolicy } from "../src/model-call-policy";

function settings(): LlmWikiPluginSettings {
  return structuredClone(DEFAULT_SETTINGS);
}

test("native global policy keeps maxTokens as output and adds input budget", () => {
  const s = settings();
  s.nativeAgent.inputBudgetTokens = 20_000;
  s.nativeAgent.maxTokens = 3210;
  const resolved = resolveModelCallPolicy(s, "query");
  assert.equal(resolved.policy.inputBudgetTokens, 20_000);
  assert.equal(resolved.policy.outputBudgetTokens, 3210);
  assert.equal(resolved.opts.maxTokens, 3210);
  assert.equal(resolved.policy.compression, "balanced");
});

test("native per-operation values and global compression fallback resolve", () => {
  const s = settings();
  s.nativeAgent.perOperation = true;
  s.nativeAgent.operations.ingest.inputBudgetTokens = 9000;
  s.nativeAgent.operations.ingest.maxTokens = 2000;
  s.nativeAgent.operations.ingest.compressionProfile = "maximum";
  const resolved = resolveModelCallPolicy(s, "ingest");
  assert.deepEqual(resolved.policy, {
    inputBudgetTokens: 9000,
    outputBudgetTokens: 2000,
    compression: "maximum",
  });
});

test("claude resolves no plugin-owned output cap", () => {
  const s = settings();
  s.backend = "claude-agent";
  s.claudeAgent.inputBudgetTokens = 12_000;
  const resolved = resolveModelCallPolicy(s, "lint");
  assert.equal(resolved.policy.inputBudgetTokens, 12_000);
  assert.equal(resolved.policy.outputBudgetTokens, undefined);
  assert.equal(resolved.opts.maxTokens, undefined);
});

test("delete borrows ingest and a query follow-up borrows query", () => {
  const s = settings();
  s.nativeAgent.perOperation = true;
  s.nativeAgent.operations.ingest.inputBudgetTokens = 7000;
  s.nativeAgent.operations.query.inputBudgetTokens = 8000;
  assert.equal(resolveModelCallPolicy(s, "delete").policy.inputBudgetTokens, 7000);
  assert.equal(resolveModelCallPolicy(s, "chat", "query").policy.inputBudgetTokens, 8000);
});
```

- [ ] **Step 2: Run the focused test and confirm the missing resolver fails**

```bash
node --import tsx --test tests/model-call-policy.test.ts
```

Expected: FAIL because `model-call-policy.ts` and new settings fields do not exist.

- [ ] **Step 3: Add settings and call-option contracts**

Add these exact contracts to `src/types.ts`, preserving `maxTokens` names:

```ts
export type CompressionProfile = "maximum" | "balanced" | "minimum";
export type CompressionOperation = "ingest" | "query" | "lint" | "vision";

export interface SemanticCompression {
  profile: CompressionProfile;
  operation: CompressionOperation;
}

export interface ModelCallPolicy {
  inputBudgetTokens: number;
  outputBudgetTokens?: number;
  compression: CompressionProfile;
}

export interface ClaudeOperationConfig {
  model: string;
  effort?: "low" | "medium" | "high" | "xhigh" | "max";
  inputBudgetTokens: number;
  compressionProfile?: CompressionProfile;
}

export interface NativeOperationConfig {
  model: string;
  inputBudgetTokens: number;
  maxTokens: number;
  temperature: number;
  thinkingBudgetTokens?: number;
  compressionProfile?: CompressionProfile;
}
```

Add `inputBudgetTokens`, `compressionProfile`, and `semanticCompression` to the corresponding global settings and `LlmCallOptions`. Add `policyOperation?: OpKey` to `RunRequest`. Populate every global and per-operation default with `inputBudgetTokens: 16384`; populate only global profiles with `compressionProfile: "balanced"`.

- [ ] **Step 4: Implement the pure resolver**

```ts
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
  return operation as OpKey;
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
```

When `AgentRunner.buildOptsFor` merges non-policy options, spread this resolver's `opts` first, then append system/language/retry/dedup settings. Do not restore `maxTokens` on the Claude branch.

- [ ] **Step 5: Normalize loaded nested values without changing old output limits**

After the existing nested spreads in `loadSettings`, normalize only missing/invalid new fields:

```ts
const inputOrDefault = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 16_384;

this.settings.nativeAgent.inputBudgetTokens = inputOrDefault(this.settings.nativeAgent.inputBudgetTokens);
this.settings.claudeAgent.inputBudgetTokens = inputOrDefault(this.settings.claudeAgent.inputBudgetTokens);
for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
  this.settings.nativeAgent.operations[key].inputBudgetTokens =
    inputOrDefault(this.settings.nativeAgent.operations[key].inputBudgetTokens);
  this.settings.claudeAgent.operations[key].inputBudgetTokens =
    inputOrDefault(this.settings.claudeAgent.operations[key].inputBudgetTokens);
}
```

Do not assign to any `maxTokens` field in this normalization block.

- [ ] **Step 6: Run focused regression tests**

```bash
node --import tsx --test tests/model-call-policy.test.ts tests/init-force-retry.test.ts
npm run lint
```

Expected: policy tests PASS; existing runner tests PASS; ESLint has zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/main.ts src/agent-runner.ts src/model-call-policy.ts tests/model-call-policy.test.ts tests/init-force-retry.test.ts
git commit -m "feat(settings): add model call policies"
```

### Task 2: Add Semantic Compression Profiles and Preservation Invariants

**Requirements:** R10, R14

**Files:**
- Create: `src/semantic-compression.ts`
- Create: `prompts/compression-maximum.md`
- Create: `prompts/compression-balanced.md`
- Create: `prompts/compression-minimum.md`
- Create: `tests/semantic-compression.test.ts`
- Modify: `src/phases/llm-utils.ts` (`prepareChatMessages`, compression injection)

- [ ] **Step 1: Write profile and Format-exclusion tests**

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const { compressionInstruction } = await import("../src/semantic-compression");
const { prepareChatMessages } = await import("../src/phases/llm-utils");

test("profiles change density and keep ingest evidence invariant", () => {
  const maximum = compressionInstruction({ profile: "maximum", operation: "ingest" });
  const minimum = compressionInstruction({ profile: "minimum", operation: "ingest" });
  assert.notEqual(maximum, minimum);
  for (const text of [maximum, minimum]) {
    assert.match(text, /packet/i);
    assert.match(text, /source range/i);
    assert.match(text, /do not drop/i);
  }
});

test("query, lint, and vision preserve their governed fields", () => {
  assert.match(compressionInstruction({ profile: "balanced", operation: "query" }), /citation/i);
  assert.match(compressionInstruction({ profile: "balanced", operation: "lint" }), /severity/i);
  assert.match(compressionInstruction({ profile: "balanced", operation: "vision" }), /OCR/i);
});

test("messages without semanticCompression remain profile-independent", () => {
  const base = [{ role: "user" as const, content: "format this" }];
  assert.deepEqual(prepareChatMessages(base, {}), prepareChatMessages(base, { semanticCompression: undefined }));
});
```

- [ ] **Step 2: Run and confirm missing modules fail**

```bash
node --import tsx --test tests/semantic-compression.test.ts
```

Expected: FAIL because compression prompts and `prepareChatMessages` are absent.

- [ ] **Step 3: Add the three density fragments**

`prompts/compression-maximum.md`:

```markdown
Use maximum semantic compression. Remove repetition, framing prose, and redundant examples. Express each distinct fact once in the densest unambiguous form. Never omit governed evidence or fields named by the preservation rules below.
```

`prompts/compression-balanced.md`:

```markdown
Use balanced semantic compression. Keep concise context for facts and relationships while removing repetition and prose padding. Never omit governed evidence or fields named by the preservation rules below.
```

`prompts/compression-minimum.md`:

```markdown
Use minimum semantic compression. Retain detailed explanations and useful context, but do not repeat facts or invent details. Never omit governed evidence or fields named by the preservation rules below.
```

- [ ] **Step 4: Implement operation invariants and one message-preparation path**

```ts
import maximum from "../prompts/compression-maximum.md";
import balanced from "../prompts/compression-balanced.md";
import minimum from "../prompts/compression-minimum.md";
import type { SemanticCompression } from "./types";

const profiles = { maximum, balanced, minimum } as const;
const invariants = {
  ingest: "Preserve every evidence packet ID, exact source range, link, entity relationship, and generated knowledge fact. Do not drop any covered packet or range.",
  query: "Preserve every claim needed to answer the current question and every citation supporting those claims. Do not invent citations.",
  lint: "Preserve every finding, severity, file path, section location, and repair instruction. Do not merge distinct findings.",
  vision: "Preserve recognized OCR, objects, relationships, layout and structure, page identity, and uncertainty. Do not change recognized meaning.",
} as const;

export function compressionInstruction(value: SemanticCompression): string {
  return [
    "## Semantic compression",
    profiles[value.profile].trim(),
    "## Preservation rules",
    invariants[value.operation],
  ].join("\n");
}
```

Rename the internal message-transform chain in `llm-utils.ts` to exported `prepareChatMessages`. Inject `compressionInstruction(opts.semanticCompression)` into the first system message after language/reasoning/custom prompt injection. `buildChatParams` must call this function and must not inject a compression section when the option is absent.

- [ ] **Step 5: Verify the profile matrix**

```bash
node --import tsx --test tests/semantic-compression.test.ts tests/format-response-format.test.ts
npm run lint
```

Expected: all tests PASS; Format test captures no semantic-compression fragment.

- [ ] **Step 6: Commit**

```bash
git add prompts/compression-maximum.md prompts/compression-balanced.md prompts/compression-minimum.md src/semantic-compression.ts src/phases/llm-utils.ts tests/semantic-compression.test.ts
git commit -m "feat(prompts): add semantic compression profiles"
```

### Task 3: Enforce Full-Message Budgets and Bounded Context Recovery

**Requirements:** R2, R3, R13, R14

**Files:**
- Create: `src/prompt-budget.ts`
- Create: `tests/prompt-budget.test.ts`
- Modify: `src/types.ts` (`prompt_budget` event)
- Modify: `src/phases/llm-utils.ts` (final preflight guard)
- Modify: `src/phases/structured-output.ts` (context errors bypass stream fallback; usage returned)
- Modify: `tests/structured-output.test.ts` (identical oversized retry regression)

- [ ] **Step 1: Write estimator, packing, recovery, and redaction tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  PromptBudgetExceededError,
  classifyContextError,
  estimatePreparedMessages,
  packContextUnits,
  shrinkInputBudget,
} from "../src/prompt-budget";

test("UTF-8 text uses one byte as one conservative estimated token", () => {
  const ascii = estimatePreparedMessages([{ role: "user", content: "abc" }]);
  const cyrillic = estimatePreparedMessages([{ role: "user", content: "абв" }]);
  assert.ok(cyrillic > ascii);
});

test("image URL payload reserves media tokens without counting base64 text", () => {
  const short = estimatePreparedMessages([{ role: "user", content: [
    { type: "image_url", image_url: { url: "data:image/png;base64,a" } },
  ] }]);
  const long = estimatePreparedMessages([{ role: "user", content: [
    { type: "image_url", image_url: { url: `data:image/png;base64,${"a".repeat(50_000)}` } },
  ] }]);
  assert.equal(short, long);
  assert.ok(short >= 4096);
});

test("packer keeps required units whole and drops lower-priority optional units", () => {
  const packed = packContextUnits({
    inputBudgetTokens: 170,
    fixedMessages: [{ role: "system", content: "contract" }],
    opts: {},
    units: [
      { id: "required", source: "source", text: "r".repeat(40), required: true, priority: 0, estimatedTokens: 40 },
      { id: "high", source: "wiki", text: "h".repeat(40), required: false, priority: 10, estimatedTokens: 40 },
      { id: "low", source: "wiki", text: "l".repeat(80), required: false, priority: 1, estimatedTokens: 80 },
    ],
    render: (units) => [{ role: "system", content: "contract" }, { role: "user", content: units.map((u) => u.text).join("\n") }],
  });
  assert.deepEqual(packed.selected.map((unit) => unit.id), ["required", "high"]);
  assert.ok(packed.estimatedInputTokens <= 170);
});

test("required overflow fails instead of truncating", () => {
  assert.throws(() => packContextUnits({
    inputBudgetTokens: 10,
    fixedMessages: [],
    opts: {},
    units: [{ id: "q", source: "source", text: "question", required: true, priority: 1, estimatedTokens: 8 }],
    render: (units) => [{ role: "user", content: units[0].text }],
  }), PromptBudgetExceededError);
});

test("provider counts use ratio and safety factor; unknown counts use 75 percent", () => {
  const details = classifyContextError(new Error("prompt size 565000 exceeds maximum context 524288"));
  assert.deepEqual(details, { promptTokens: 565000, maxContextTokens: 524288 });
  assert.equal(shrinkInputBudget(16_384, details), Math.floor(16_384 * 524288 / 565000 * 0.9));
  assert.equal(shrinkInputBudget(16_384, {}), 12_288);
});
```

- [ ] **Step 2: Run and confirm the module is missing**

```bash
node --import tsx --test tests/prompt-budget.test.ts
```

Expected: FAIL because `prompt-budget.ts` does not exist.

- [ ] **Step 3: Implement the governor contracts and algorithms**

Use these public contracts:

```ts
export interface ContextUnit {
  id: string;
  source: "system" | "schema" | "source" | "evidence" | "wiki" | "registry";
  text: string;
  required: boolean;
  priority: number;
  estimatedTokens: number;
}

export interface PackedPrompt {
  messages: OpenAI.Chat.ChatCompletionMessageParam[];
  selected: ContextUnit[];
  omitted: ContextUnit[];
  estimatedInputTokens: number;
}

export class PromptBudgetExceededError extends Error {
  constructor(
    readonly budget: number,
    readonly estimated: number,
    readonly requiredIds: string[],
  ) {
    super(`Prompt requires ${estimated} estimated tokens but budget is ${budget}`);
    this.name = "PromptBudgetExceededError";
  }
}
```

Implementation rules:

1. Serialize role/name/text metadata through `TextEncoder`.
2. Replace every `image_url.url` with the literal `[media]` before text serialization and add `4096` per image/PDF-page part.
3. `packContextUnits` first renders fixed messages, then all required units, then optional units sorted by descending priority and stable ID. Re-render and re-estimate after every inclusion so separators and injected contracts count.
4. A unit is either included verbatim or omitted; never slice `text`.
5. `classifyContextError` accepts common provider codes/messages and extracts counts when present.
6. `runWithContextRepack` permits the initial call plus two repacks. It calls `build(effectiveBudget)` again after each context failure and emits one metadata-only event per attempt.

Add this event to `RunEvent`:

```ts
| {
    kind: "prompt_budget";
    callSite: string;
    configuredInputBudget: number;
    effectiveInputBudget: number;
    estimatedInputTokens: number;
    actualInputTokens?: number;
    outputBudget?: number;
    compressionProfile: CompressionProfile;
    contextUnits: number;
    sourceChunks?: number;
    reductionDepth?: number;
    retryReason?: string;
  }
```

Extend the existing structured `callSite` union at the same time with the planned bounded calls: `init.bootstrap-map`, `ingest.evidence-map`, `ingest.evidence-reduce`, `ingest.synthesize`, `lint.batch`, `lint-chat.patch`, `format.segment`, and `vision.analysis`. Later tasks must use these exact literals rather than widening call sites to arbitrary strings.

The telemetry constructor must accept only numeric/string metadata and return a fresh object. It must have no field capable of carrying messages, source text, evidence, image data, API keys, or headers.

- [ ] **Step 4: Put the final preflight guard in `buildChatParams`**

After `prepareChatMessages` and before returning params:

```ts
if (opts.inputBudgetTokens !== undefined) {
  const estimated = estimatePreparedMessages(msgs);
  if (estimated > opts.inputBudgetTokens) {
    throw new PromptBudgetExceededError(opts.inputBudgetTokens, estimated, []);
  }
}
```

This guard is a last line of defense. Operation adapters must still pack/split before reaching it.

- [ ] **Step 5: Prevent identical context retries in structured transport**

In `streamOnce`, rethrow context-length and preflight errors beside abort/JSON-mode errors:

```ts
if (
  signal.aborted
  || (e as Error).name === "AbortError"
  || isJsonModeError(e)
  || classifyContextError(e) !== null
  || e instanceof PromptBudgetExceededError
) throw e;
```

Extend `CallResult` and `RunStructuredResult` with `inputTokens?: number`; copy `statsEvent.inputTokens` or non-stream `usage.prompt_tokens` into the result. Add a regression where the streaming request throws a context error and assert the mock client receives exactly one request, not a second non-stream request.

- [ ] **Step 6: Verify shared governance**

```bash
node --import tsx --test tests/prompt-budget.test.ts tests/structured-output.test.ts
npm run lint
```

Expected: all tests PASS; context-error regression observes one transport attempt; ESLint has zero errors.

- [ ] **Step 7: Commit**

```bash
git add src/prompt-budget.ts src/types.ts src/phases/llm-utils.ts src/phases/structured-output.ts tests/prompt-budget.test.ts tests/structured-output.test.ts
git commit -m "feat(llm): enforce bounded prompt governance"
```

### Task 4: Add Lossless Markdown Source Chunking

**Requirements:** R4, R5, R16

**Files:**
- Create: `src/content-hash.ts`
- Create: `src/markdown-chunks.ts`
- Create: `tests/markdown-chunks.test.ts`

- [ ] **Step 1: Write complete-coverage and stability tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { assertCompleteSourceCoverage, chunkMarkdownSource } from "../src/markdown-chunks";

test("small source remains one stable chunk", () => {
  const source = "# A\n\nParagraph one.\n\n## B\nParagraph two.";
  const first = chunkMarkdownSource(source, { maxEstimatedTokens: 500, overlapLines: 2 });
  const second = chunkMarkdownSource(source, { maxEstimatedTokens: 500, overlapLines: 2 });
  assert.equal(first.length, 1);
  assert.deepEqual(first, second);
  assertCompleteSourceCoverage(source, first);
});

test("heading and paragraph splits cover every original line", () => {
  const source = ["# Root", "", ...Array.from({ length: 40 }, (_, i) => `line ${i}`), "", "## Tail", "done"].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 80, overlapLines: 1 });
  assert.ok(chunks.length > 1);
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
  assert.equal(chunks.every((chunk) => chunk.markdown.length > 0), true);
});

test("oversized fenced blocks retain fence language and source anchors", () => {
  const source = ["# Code", "```bash", ...Array.from({ length: 30 }, (_, i) => `echo ${i}`), "```"].join("\n");
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 60, overlapLines: 2 });
  assert.ok(chunks.length > 1);
  assert.equal(chunks.every((chunk) => chunk.markdown.includes("```bash") && chunk.markdown.includes("```")), true);
  assert.doesNotThrow(() => assertCompleteSourceCoverage(source, chunks));
});

test("coverage validation rejects a missing line", () => {
  const source = "one\ntwo\nthree";
  const chunks = chunkMarkdownSource(source, { maxEstimatedTokens: 100, overlapLines: 0 });
  chunks[0].endLine = 2;
  assert.throws(() => assertCompleteSourceCoverage(source, chunks), /line 3/);
});
```

- [ ] **Step 2: Run and confirm missing exports fail**

```bash
node --import tsx --test tests/markdown-chunks.test.ts
```

Expected: FAIL because the chunker does not exist.

- [ ] **Step 3: Implement deterministic hashing and chunk contracts**

`src/content-hash.ts`:

```ts
export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}
```

`src/markdown-chunks.ts` public shape:

```ts
export interface SourceChunk {
  id: string;
  headingPath: string[];
  ordinal: number;
  startLine: number;
  endLine: number;
  markdown: string;
  contentHash: string;
}

export interface MarkdownSection {
  heading: string;
  headingPath: string[];
  startLine: number;
  endLine: number;
  markdown: string;
  contentHash: string;
}
```

Implement a line scanner that tracks heading hierarchy and fenced-code state. Split in this order: complete heading sections, paragraphs separated by blank lines outside fences, then overlapping line windows. When a line window cuts a fence, wrap the copied source lines with the original opening fence and a closing fence while keeping `startLine`/`endLine` anchored only to original lines. IDs are `${ordinal}:${startLine}-${endLine}:${contentHash}`.

`assertCompleteSourceCoverage` must create a boolean slot per source line, mark every inclusive chunk range, and throw with the first uncovered one-based line. It must also reject ranges outside the source and hashes that no longer match `chunk.markdown` after removal of synthetic fence wrappers.

- [ ] **Step 4: Verify all split modes**

```bash
node --import tsx --test tests/markdown-chunks.test.ts
npm run lint
```

Expected: all tests PASS; normal, heading-heavy, paragraph-heavy, and fenced inputs have complete line coverage.

- [ ] **Step 5: Commit**

```bash
git add src/content-hash.ts src/markdown-chunks.ts tests/markdown-chunks.test.ts
git commit -m "feat(ingest): add lossless markdown chunking"
```

### Task 5: Apply Hash-Guarded Section Patches Without Rewriting Untouched Content

**Requirements:** R7

**Files:**
- Create: `src/section-patches.ts`
- Create: `tests/section-patches.test.ts`
- Modify: `src/phases/zod-schemas.ts` (shared create/patch action schemas)

- [ ] **Step 1: Write add, append, replace, and conflict tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyPagePatch,
  inspectPatchablePage,
  type PatchPage,
} from "../src/section-patches";

const page = `---
type: concept
resource: [source]
---
# Demo

Intro stays byte-stable.

## Facts
alpha

## Related
- [[wiki_d_existing]]
`;

function patch(sections: PatchPage["sections"]): PatchPage {
  const inspected = inspectPatchablePage(page);
  return {
    kind: "patch",
    path: "!Wiki/d/concept/wiki_d_demo.md",
    expectedPageHash: inspected.pageHash,
    sections,
  };
}

test("add preserves frontmatter, preamble, and every existing section byte", () => {
  const result = applyPagePatch(page, patch([
    { heading: "## Limits", operation: "add", content: "none" },
  ]), new Set());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.ok(result.content.startsWith(page.trimEnd()));
  assert.match(result.content, /## Limits\nnone/);
});

test("append keeps existing text and suppresses an exact duplicate", () => {
  const result = applyPagePatch(page, patch([
    { heading: "## Facts", operation: "append", content: "alpha\nbeta" },
  ]), new Set());
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal((result.content.match(/^alpha$/gm) ?? []).length, 1);
  assert.equal((result.content.match(/^beta$/gm) ?? []).length, 1);
});

test("replace requires the supplied full current section hash", () => {
  const inspected = inspectPatchablePage(page);
  const facts = inspected.sections.find((section) => section.heading === "## Facts")!;
  const allowed = new Set([facts.hash]);
  const result = applyPagePatch(page, patch([
    {
      heading: "## Facts",
      expectedSectionHash: facts.hash,
      operation: "replace",
      content: "gamma",
    },
  ]), allowed);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.match(result.content, /## Facts\ngamma/);
  assert.match(result.content, /## Related\n- \[\[wiki_d_existing\]\]/);
});

test("stale page and section hashes cannot overwrite content", () => {
  assert.deepEqual(applyPagePatch(page + "new edit\n", patch([]), new Set()), {
    ok: false,
    reason: "page_hash_mismatch",
  });
  const bad = patch([{ heading: "## Facts", expectedSectionHash: "stale", operation: "replace", content: "x" }]);
  assert.deepEqual(applyPagePatch(page, bad, new Set(["stale"])), {
    ok: false,
    reason: "section_hash_mismatch",
    heading: "## Facts",
  });
});
```

- [ ] **Step 2: Run and confirm the patch primitive is missing**

```bash
node --import tsx --test tests/section-patches.test.ts
```

Expected: FAIL because `section-patches.ts` does not exist.

- [ ] **Step 3: Add patch contracts and schemas**

```ts
export interface CreatePage {
  kind: "create";
  path: string;
  annotation: string;
  content: string;
}

export interface SectionPatch {
  heading: string;
  expectedSectionHash?: string;
  operation: "add" | "append" | "replace";
  content: string;
}

export interface PatchPage {
  kind: "patch";
  path: string;
  expectedPageHash: string;
  annotation?: string;
  sections: SectionPatch[];
}
```

Mirror the same discriminated union in Zod. Require `expectedSectionHash` for `replace`; reject it for `add`; reject empty headings/content; reject duplicate normalized headings in one patch.

- [ ] **Step 4: Implement byte-preserving page inspection and patch application**

`inspectPatchablePage` must split only on top-level `## ` headings outside fenced code. It returns the exact preamble and exact section spans, each with `contentHash(exactSpan)`. `applyPagePatch` follows these rules in input order:

```ts
export type PatchApplyResult =
  | { ok: true; content: string; changedHeadings: string[] }
  | { ok: false; reason: "page_hash_mismatch" }
  | { ok: false; reason: "section_hash_mismatch" | "replace_context_missing" | "heading_exists" | "heading_missing"; heading: string };
```

- Compare the whole current page hash before any mutation.
- `add`: append `heading + content` only when the normalized heading is absent.
- `append`: retain the exact current span, append only normalized non-empty lines/paragraphs not already present, and never rewrite the old bytes.
- `replace`: require both matching `expectedSectionHash` and membership in `allowedReplaceHashes`; replace only that section span.
- Never modify the preamble/frontmatter and never support deletion.
- Finish with exactly one trailing newline.

- [ ] **Step 5: Verify section stability and schema validation**

```bash
node --import tsx --test tests/section-patches.test.ts tests/merge-sections.test.ts
npm run lint
```

Expected: all tests PASS; untouched spans compare byte-for-byte; existing merge-section tests remain green.

- [ ] **Step 6: Commit**

```bash
git add src/section-patches.ts src/phases/zod-schemas.ts tests/section-patches.test.ts
git commit -m "feat(ingest): add guarded section patches"
```

### Task 6: Replace Runtime Markdown Index Operations with Structured JSONL Helpers

**Requirements:** R1, R8

**Files:**
- Create: `src/wiki-index-store.ts`
- Create: `tests/wiki-index-store.test.ts`
- Create: `tests/no-runtime-legacy-index.test.ts`
- Modify: `src/wiki-index-jsonl.ts` (page-record transformations)
- Modify: `src/wiki-index.ts` (retain legacy parsing only for migration; expose page metadata builder)
- Modify: `src/page-similarity.ts` (preserve page paths/records during chunk refresh)
- Modify: `src/phases/ingest.ts` (remove raw index prompt parameter; use typed descriptions)
- Modify: `src/phases/init.ts` (remove bootstrap `index_block`; use typed descriptions)
- Modify: `src/phases/query.ts` (`DomainCandidates` no longer carries raw index text)
- Modify: `src/phases/lint.ts` (structured descriptions and page reconciliation)
- Modify: `src/phases/lint-chat.ts` (structured page upsert)
- Modify: `src/phases/delete.ts` (structured page removal)
- Modify: `src/controller.ts` (remove runtime legacy export fallback)
- Modify: `tests/wiki-index-jsonl.test.ts`
- Modify: `tests/page-similarity-jsonl.test.ts`

- [ ] **Step 1: Write alternating page/chunk integrity tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  collectPageDescriptions,
  reconcilePageRecords,
  removeArticleRecords,
  removePageRecord,
  upsertPageRecord,
  type PageIndexRecord,
  type WikiIndexRecord,
} from "../src/wiki-index-jsonl";

const page = (id: string, description = id): PageIndexRecord => ({
  kind: "page",
  schemaVersion: 1,
  articleId: id,
  path: `!Wiki/d/concept/${id}.md`,
  type: "concept",
  description,
  resource: ["source"],
  bodyHash: `body-${id}`,
  descriptionHash: `desc-${id}`,
});

const chunk: WikiIndexRecord = {
  kind: "chunk",
  schemaVersion: 1,
  articleId: "a",
  path: "!Wiki/d/concept/a.md",
  heading: "## Facts",
  ordinal: 0,
  bodyHash: "body-a",
  embedTextHash: "embed-a",
  vector: [0.1, 0.2],
  vectorModel: "m",
  dimensions: 2,
  updatedAt: "2026-07-16T00:00:00.000Z",
};

test("page upsert and removal preserve every chunk and unknown record", () => {
  const unknown = { kind: "future", value: 1 };
  const records = upsertPageRecord([chunk, unknown], page("a"));
  assert.deepEqual(records.filter((record) => record.kind === "chunk"), [chunk]);
  assert.deepEqual(records.find((record) => record.kind === "future"), unknown);
  assert.deepEqual(removePageRecord(records, "a"), [chunk, unknown]);
});

test("reconcile replaces only page records and leaves chunk records unchanged", () => {
  const records = reconcilePageRecords([page("old"), chunk], [page("a", "new")]);
  assert.deepEqual(records.filter((record) => record.kind === "chunk"), [chunk]);
  assert.equal(collectPageDescriptions(records).get("a"), "new");
  assert.equal(collectPageDescriptions(records).has("old"), false);
});

test("article deletion removes its page and chunk records but keeps other articles", () => {
  const records = removeArticleRecords([page("a"), page("b"), chunk], "a");
  assert.equal(records.some((record) => record.kind === "page" && record.articleId === "a"), false);
  assert.equal(records.some((record) => record.kind === "chunk" && record.articleId === "a"), false);
  assert.equal(records.some((record) => record.kind === "page" && record.articleId === "b"), true);
});
```

- [ ] **Step 2: Add a runtime-boundary source test**

`tests/no-runtime-legacy-index.test.ts` reads `src/**/*.ts`, excludes files whose basename starts with `migrate-`, and asserts runtime files do not import or call `parseIndexAnnotations`, `upsertIndexAnnotation`, `removeIndexAnnotation`, or Markdown `reconcileIndex`. It also asserts `src/phases/ingest.ts` contains neither `Wiki index (_index.md)` nor a `buildIngestMessages` parameter named `indexContent`.

- [ ] **Step 3: Run and confirm current JSONL/Markdown mixing fails**

```bash
node --import tsx --test tests/wiki-index-jsonl.test.ts tests/wiki-index-store.test.ts tests/no-runtime-legacy-index.test.ts
```

Expected: FAIL on missing structured helpers and active runtime legacy index calls.

- [ ] **Step 4: Implement pure structured record transformations**

Add stable, order-preserving helpers:

```ts
export function upsertPageRecord(records: WikiIndexRecord[], incoming: PageIndexRecord): WikiIndexRecord[] {
  let replaced = false;
  const next = records.map((record) => {
    if (isPageIndexRecord(record) && record.articleId === incoming.articleId) {
      replaced = true;
      return incoming;
    }
    return record;
  });
  if (!replaced) next.push(incoming);
  return next;
}

export function removePageRecord(records: WikiIndexRecord[], articleId: string): WikiIndexRecord[] {
  return records.filter((record) => !(isPageIndexRecord(record) && record.articleId === articleId));
}

export function removeArticleRecords(records: WikiIndexRecord[], articleId: string): WikiIndexRecord[] {
  return records.filter((record) => {
    if (isPageIndexRecord(record) || isChunkIndexRecord(record)) return record.articleId !== articleId;
    return true;
  });
}

export function reconcilePageRecords(records: WikiIndexRecord[], pages: PageIndexRecord[]): WikiIndexRecord[] {
  const nonPages = records.filter((record) => !isPageIndexRecord(record));
  return [...nonPages, ...[...pages].sort((a, b) => a.articleId.localeCompare(b.articleId))];
}
```

`pageIndexRecordFromMarkdown(domainRoot, path, content)` derives `articleId`, type, description, resource, timestamp, tags, `bodyHash`, and `descriptionHash` from governed on-disk Markdown. Use the shared `contentHash` and existing raw-frontmatter parsers.

- [ ] **Step 5: Implement structured index I/O**

`src/wiki-index-store.ts` exposes:

```ts
export async function readWikiIndexRecords(vaultTools: VaultTools, domainRoot: string): Promise<WikiIndexRecord[]>;
export async function readPageDescriptions(vaultTools: VaultTools, domainRoot: string): Promise<Map<string, string>>;
export async function upsertPageIndex(vaultTools: VaultTools, domainRoot: string, record: PageIndexRecord): Promise<void>;
export async function removePageIndex(vaultTools: VaultTools, domainRoot: string, articleId: string): Promise<void>;
export async function removeArticleIndex(vaultTools: VaultTools, domainRoot: string, articleId: string): Promise<void>;
export async function reconcilePageIndex(vaultTools: VaultTools, domainRoot: string, pages: Array<{ path: string; content: string }>): Promise<void>;
```

Missing files read as `[]`; malformed JSONL errors propagate with path/line; writes use `stringifyWikiIndexJsonl`. Each transform preserves all records of the opposite kind and all unknown future records.

- [ ] **Step 6: Move all normal runtime callers to structured helpers**

Apply this mapping:

| Current runtime call | Replacement |
|---|---|
| `parseIndexAnnotations(indexRaw)` | `collectPageDescriptions(parseWikiIndexJsonl(indexRaw, path))` or `readPageDescriptions` |
| `upsertIndexAnnotation(...)` | build governed page record after write, then `upsertPageIndex(...)` |
| annotation-only removal | `removePageIndex(...)` |
| on-disk article deletion | `removeArticleIndex(...)` |
| `reconcileIndex(...)` | `reconcilePageIndex(...)` |
| raw Init/Ingest index prompt blocks | remove completely |

Keep `parseIndexAnnotations` imports only in `migrate-index-format.ts`, `migrate-jsonl-domain-storage.ts`, and `migrate-okf-frontmatter.ts`. In `PageSimilarityService.refreshCache`, derive chunk-record paths from an existing page record when available and preserve page records exactly. If no page record exists, retain the current fallback path.

- [ ] **Step 7: Verify structured storage and unchanged embedding reuse**

```bash
node --import tsx --test tests/wiki-index-jsonl.test.ts tests/wiki-index-store.test.ts tests/no-runtime-legacy-index.test.ts tests/page-similarity-jsonl.test.ts tests/query-jsonl-index.test.ts
npm run lint
```

Expected: all tests PASS; alternating page/chunk updates retain both record kinds; runtime legacy-index scan is clean.

- [ ] **Step 8: Commit**

```bash
git add src/wiki-index-jsonl.ts src/wiki-index.ts src/wiki-index-store.ts src/page-similarity.ts src/phases/ingest.ts src/phases/init.ts src/phases/query.ts src/phases/lint.ts src/phases/lint-chat.ts src/phases/delete.ts src/controller.ts tests/wiki-index-jsonl.test.ts tests/wiki-index-store.test.ts tests/no-runtime-legacy-index.test.ts tests/page-similarity-jsonl.test.ts
git commit -m "fix(storage): isolate structured index records"
```

## Phase 2: Bounded Ingest Pipeline

### Task 7: Map Every Source Chunk to Validated Evidence and Reduce Without Loss

**Requirements:** R3, R4, R5, R10

**Files:**
- Create: `src/phases/ingest-evidence.ts`
- Create: `prompts/ingest-evidence-map.md`
- Create: `prompts/ingest-evidence-reduce.md`
- Create: `tests/ingest-evidence.test.ts`
- Modify: `src/phases/zod-schemas.ts` (evidence mapper/reducer schemas)

- [ ] **Step 1: Write validation and deterministic-reduction tests**

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const {
  buildEvidenceCoverage,
  dedupeEvidencePackets,
  validateEvidenceMap,
  validateReducedEvidence,
} = await import("../src/phases/ingest-evidence");
import type { EvidencePacket } from "../src/phases/ingest-evidence";

const packet = (id: string, chunkId: string, fact: string): EvidencePacket => ({
  id,
  chunkId,
  entityKey: "postgresql",
  entityType: "tool",
  facts: [fact],
  exactSourceRanges: [{ startLine: 2, endLine: 2 }],
  links: ["https://postgresql.org"],
  sourceAnchor: "source.md:2",
});

test("every source chunk requires packets or an explicit no-evidence result", () => {
  assert.throws(() => buildEvidenceCoverage(["c1", "c2"], [packet("p1", "c1", "fact")], []), /c2/);
  assert.deepEqual(buildEvidenceCoverage(
    ["c1", "c2"],
    [packet("p1", "c1", "fact")],
    [{ chunkId: "c2", reason: "No domain evidence" }],
  ), new Set(["c1", "c2"]));
});

test("invalid or out-of-chunk source ranges fail", () => {
  assert.throws(() => validateEvidenceMap({
    chunk: { id: "c1", startLine: 10, endLine: 20 },
    packets: [packet("p1", "c1", "fact")],
    noEvidence: [],
  }), /range/);
});

test("deterministic reducer removes exact duplicates but preserves IDs and ranges", () => {
  const reduced = dedupeEvidencePackets([
    packet("p1", "c1", "same"),
    packet("p2", "c2", "same"),
  ]);
  assert.deepEqual(reduced.packetIds, ["p1", "p2"]);
  assert.deepEqual(reduced.facts, ["same"]);
  assert.equal(reduced.exactSourceRanges.length, 1);
});

test("LLM reducer output must account for every consumed packet", () => {
  assert.throws(() => validateReducedEvidence(
    [packet("p1", "c1", "a"), packet("p2", "c2", "b")],
    { entityKey: "postgresql", packetIds: ["p1"], facts: ["a"], exactSourceRanges: [], links: [] },
  ), /p2/);
});
```

- [ ] **Step 2: Run and confirm the evidence module is missing**

```bash
node --import tsx --test tests/ingest-evidence.test.ts
```

Expected: FAIL because mapper/reducer contracts do not exist.

- [ ] **Step 3: Add mapper and reducer prompt contracts**

The mapper prompt must require exactly one structured result for its supplied chunk, with packet IDs, chunk ID, normalized entity key, optional configured entity type, atomic facts, exact one-based source ranges, links, and anchor. It must require one `noEvidence` item when no packet is emitted.

The reducer prompt must accept only validated packet JSON, preserve every input packet ID, exact range, link, and distinct fact, and return one entity record. It must explicitly forbid facts not supported by packet IDs.

- [ ] **Step 4: Implement evidence validation and exact-source copying**

Use these runtime shapes:

```ts
export interface EvidencePacket {
  id: string;
  chunkId: string;
  entityKey: string;
  entityType?: string;
  facts: string[];
  exactSourceRanges: Array<{ startLine: number; endLine: number }>;
  links: string[];
  sourceAnchor: string;
}

export interface VerifiedEvidencePacket extends EvidencePacket {
  exactSource: Array<{ startLine: number; endLine: number; text: string }>;
}

export interface EntityEvidence {
  entityKey: string;
  entityType?: string;
  packetIds: string[];
  facts: string[];
  exactSourceRanges: Array<{ startLine: number; endLine: number }>;
  exactSource: Array<{ startLine: number; endLine: number; text: string }>;
  links: string[];
}
```

Validate all IDs, ranges, and entity keys before reduction. Build `exactSource[].text` by slicing original source lines on the server; never accept an LLM-provided exact quote. Normalize/dedupe facts and links without changing first-seen order.

- [ ] **Step 5: Implement bounded map/reduce orchestration**

`prepareSourceEvidence` must:

1. call `chunkMarkdownSource` using available input budget after fixed mapper overhead;
2. map each chunk through `runWithContextRepack` and `runStructuredWithRetry`;
3. validate chunk/range coverage immediately;
4. group verified packets by normalized `entityKey`;
5. return deterministic groups directly when they fit a synthesis unit;
6. otherwise split packet lists into whole-packet batches, call the reducer, verify consumed IDs, and recursively reduce until one group fits;
7. stop with a typed coverage/reducer error after structured-repair exhaustion.

Every mapper/reducer call emits `prompt_budget` with `sourceChunks` and `reductionDepth`. No prompt event contains evidence text.

The same module exposes `prepareBootstrapEvidence(source, provisionalDomainId, policy, ...)`. It uses the identical chunk/range/packet coverage contract with no configured entity types, then returns bounded candidate entities, domain themes, and language evidence for Init bootstrap. It never sends the complete oversized first source to the bootstrap model call.

- [ ] **Step 6: Add a mocked recursive-reduction test**

Use a mock `LlmClient` that captures every request and returns valid mapper/reducer JSON. Feed a source whose chunks force two reducer levels. Assert every request estimate is within budget, every source chunk ID reaches final coverage, and final `packetIds` equals the complete mapped set.

- [ ] **Step 7: Verify evidence preservation**

```bash
node --import tsx --test tests/ingest-evidence.test.ts tests/markdown-chunks.test.ts tests/prompt-budget.test.ts
npm run lint
```

Expected: all tests PASS; missing chunk/range/packet coverage fails closed; valid recursive reduction preserves all IDs and exact source text.

- [ ] **Step 8: Commit**

```bash
git add prompts/ingest-evidence-map.md prompts/ingest-evidence-reduce.md src/phases/ingest-evidence.ts src/phases/zod-schemas.ts tests/ingest-evidence.test.ts
git commit -m "feat(ingest): add evidence map reduce pipeline"
```

### Task 8: Select Page-Diverse Wiki Sections Under One Global Budget

**Requirements:** R2, R6

**Files:**
- Create: `src/ingest-context.ts`
- Create: `tests/ingest-context.test.ts`
- Modify: `src/markdown-chunks.ts` (export complete H2 sections for wiki context)
- Modify: `src/page-similarity.ts` (candidate paths remain per-entity; final inclusion delegated)

- [ ] **Step 1: Write 1-page, 15-page, and 100-page context tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { buildEntityContext } from "../src/ingest-context";

function pages(count: number): Map<string, string> {
  return new Map(Array.from({ length: count }, (_, i) => [
    `!Wiki/d/concept/wiki_d_page_${i}.md`,
    `# Page ${i}\n\n## Facts\nentity shared fact ${i}\n\n## Details\ndetail ${"x".repeat(80)}`,
  ]));
}

for (const count of [1, 15, 100]) {
  test(`${count}-page domain stays globally bounded`, () => {
    const result = buildEntityContext({
      evidence: {
        entityKey: "entity",
        packetIds: ["p1"],
        facts: ["shared fact"],
        exactSourceRanges: [{ startLine: 1, endLine: 1 }],
        exactSource: [{ startLine: 1, endLine: 1, text: "shared fact" }],
        links: [],
      },
      candidatePages: pages(count),
      targetPath: count === 1 ? "!Wiki/d/concept/wiki_d_page_0.md" : undefined,
      inputBudgetTokens: 1200,
      fixedMessages: [{ role: "system", content: "contract" }],
      opts: {},
    });
    assert.ok(result.estimatedInputTokens <= 1200);
    assert.equal(result.units.every((unit) => !unit.text.includes('"vector"')), true);
    if (count === 1) assert.equal(result.units.some((unit) => unit.id.includes("## Facts")), true);
  });
}

test("optional selection includes more than one page before a second low-score section", () => {
  const result = buildEntityContext({
    evidence: {
      entityKey: "entity",
      packetIds: ["p1"],
      facts: ["shared"],
      exactSourceRanges: [],
      exactSource: [],
      links: [],
    },
    candidatePages: pages(4),
    inputBudgetTokens: 650,
    fixedMessages: [{ role: "system", content: "contract" }],
    opts: {},
  });
  assert.ok(new Set(result.units.filter((unit) => unit.source === "wiki").map((unit) => unit.pageId)).size >= 2);
});
```

- [ ] **Step 2: Run and confirm the context planner is missing**

```bash
node --import tsx --test tests/ingest-context.test.ts
```

Expected: FAIL because `ingest-context.ts` does not exist.

- [ ] **Step 3: Implement complete-section ranking and diversity ordering**

Create `WikiSectionUnit extends ContextUnit` with `pageId`, `path`, `heading`, `sectionHash`, and `score`. Split candidate Markdown into exact complete H2 spans, excluding `## Related` and `## External links` from evidence context unless a link section is specifically required for a duplicate merge. Score each section using `scoreLexicalChunk` against the entity evidence text.

Sort optional units by rounds: highest remaining section from each page first, then second sections, with score and stable path/ordinal tie-breakers. Deduplicate normalized exact section text before packing.

When `targetPath` identifies an existing page, include the full current target section as a required unit before optional related sections. Return its hash in `allowedReplaceHashes`.

- [ ] **Step 4: Batch entity bundles without splitting a bundle**

Add:

```ts
export interface EntityContextBundle {
  entityKey: string;
  evidence: EntityEvidence;
  units: WikiSectionUnit[];
  allowedReplaceHashes: Set<string>;
  estimatedInputTokens: number;
}

export function batchEntityContexts(
  bundles: EntityContextBundle[],
  inputBudgetTokens: number,
  renderBatch: (bundles: EntityContextBundle[]) => OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
): EntityContextBundle[][];
```

Order bundles by stable entity key. Add a bundle only when the fully rendered batch estimate remains within budget. A single oversized bundle returns a typed split-required error to the evidence reducer instead of truncating it.

- [ ] **Step 5: Verify global bounds and page diversity**

```bash
node --import tsx --test tests/ingest-context.test.ts tests/lexical-retrieval.test.ts
npm run lint
```

Expected: all tests PASS; each fixture is bounded; required target sections survive; optional context spans multiple pages where capacity permits.

- [ ] **Step 6: Commit**

```bash
git add src/ingest-context.ts src/markdown-chunks.ts src/page-similarity.ts tests/ingest-context.test.ts
git commit -m "feat(ingest): globally bound wiki section context"
```

### Task 9: Synthesize Complete Creates and Guarded Patches

**Requirements:** R3, R6, R7, R10

**Files:**
- Create: `src/phases/ingest-synthesis.ts`
- Create: `prompts/ingest-synthesis.md`
- Create: `tests/ingest-synthesis.test.ts`
- Modify: `src/phases/zod-schemas.ts` (synthesis action and skip schemas)

- [ ] **Step 1: Write create/update/skip coverage tests**

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(new URL("./md-obsidian-loader.mjs", import.meta.url));
const {
  validateSynthesisCoverage,
  validateSynthesisActions,
} = await import("../src/phases/ingest-synthesis");
import { inspectPatchablePage } from "../src/section-patches";

test("every entity bundle receives an action or explicit skip", () => {
  assert.throws(() => validateSynthesisCoverage(["a", "b"], {
    actions: [{ kind: "create", entityKey: "a", path: "!Wiki/d/concept/wiki_d_a.md", annotation: "a", content: "# A" }],
    skips: [],
  }), /b/);
});

test("existing paths reject complete-page create output", () => {
  assert.throws(() => validateSynthesisActions({
    existingPaths: new Set(["!Wiki/d/concept/wiki_d_a.md"]),
    allowedReplaceHashes: new Map(),
    actions: [{ kind: "create", entityKey: "a", path: "!Wiki/d/concept/wiki_d_a.md", annotation: "a", content: "# A" }],
  }), /existing page/);
});

test("replace accepts only a section supplied in full", () => {
  const current = "# A\n\n## Facts\nold\n";
  const inspected = inspectPatchablePage(current);
  const section = inspected.sections[0];
  assert.doesNotThrow(() => validateSynthesisActions({
    existingPaths: new Set(["!Wiki/d/concept/wiki_d_a.md"]),
    allowedReplaceHashes: new Map([["!Wiki/d/concept/wiki_d_a.md", new Set([section.hash])]]),
    actions: [{
      kind: "patch",
      entityKey: "a",
      path: "!Wiki/d/concept/wiki_d_a.md",
      expectedPageHash: inspected.pageHash,
      sections: [{ heading: "## Facts", expectedSectionHash: section.hash, operation: "replace", content: "new" }],
    }],
  }));
});
```

- [ ] **Step 2: Run and confirm synthesis helpers are missing**

```bash
node --import tsx --test tests/ingest-synthesis.test.ts
```

Expected: FAIL because the bounded synthesis module does not exist.

- [ ] **Step 3: Define the structured synthesis output**

Extend create/patch actions with `entityKey`. Add `{ entityKey: string; reason: string }` skips. The top-level output contains `reasoning`, `actions`, `skips`, and optional `entity_types_delta`. Use the existing JSON-Zod structured runner. Zod must reject duplicate entity coverage, duplicate action paths, creates targeting known existing paths, patches targeting absent paths, and replace patches without approved current section hashes.

The prompt receives only:

- domain/schema/path contracts;
- one or more complete entity evidence bundles;
- typed page descriptions;
- selected complete wiki sections;
- tag registry units that survived packing.

It never receives serialized `WikiIndexRecord` data.

- [ ] **Step 4: Implement bounded synthesis and one conflict regeneration**

`synthesizeEntityBatch` wraps `runStructuredWithRetry` in `runWithContextRepack`. On a context failure, rebuild the batch with the new effective budget; if the batch no longer fits, halve the entity-bundle count and retry each half. On output truncation, retry with one entity bundle and the same preservation profile; never accept cut JSON/frames.

`regenerateConflictedPatch` receives only the conflicted entity evidence plus freshly read target sections. Permit one regenerated patch. A second page/section hash conflict returns a typed failure and performs no write.

- [ ] **Step 5: Verify stable decisions with captured prompts**

Add fixtures for a new entity, an existing entity, a no-change entity, and a stale-page conflict. The mocked model must return a create, patch, skip, then regenerated patch. Assert all prompts are under budget, the existing entity never becomes a create, and only one regeneration request occurs.

```bash
node --import tsx --test tests/ingest-synthesis.test.ts tests/section-patches.test.ts tests/structured-output.test.ts
npm run lint
```

Expected: all tests PASS; create/update/skip decisions are stable; stale content is never overwritten.

- [ ] **Step 6: Commit**

```bash
git add prompts/ingest-synthesis.md src/phases/ingest-synthesis.ts src/phases/zod-schemas.ts tests/ingest-synthesis.test.ts
git commit -m "feat(ingest): synthesize creates and section patches"
```

### Task 10: Integrate Bounded Ingest and Make Init Success Honest

**Requirements:** R1-R9, R13

**Files:**
- Create: `tests/ingest-bounded.test.ts`
- Create: `tests/init-ingest-outcome.test.ts`
- Modify: `src/phases/ingest.ts` (orchestration, writes, reconciliation, typed outcome)
- Modify: `src/phases/init.ts` (capture outcome before analyzed hash)
- Modify: `src/phases/delete.ts` (capture rebuild outcomes)
- Modify: `src/page-similarity.ts` (surface failed required embedding refresh)
- Modify: `src/types.ts` (optional typed ingest outcome shared by callers)
- Modify: existing focused ingest/init tests as required by the changed return contract

- [ ] **Step 1: Write a synthetic raw-vector isolation regression**

Build an in-memory `VaultTools` fixture with one source, one existing page, and a generated `index.jsonl` larger than 1.27 MB containing a sentinel vector value such as `987654321.125`. Use a capturing mock LLM for mapper/synthesis. Assert:

```ts
assert.equal(capturedPrompts.some((prompt) => prompt.includes("987654321.125")), false);
assert.equal(capturedPrompts.some((prompt) => prompt.includes('"kind":"chunk"')), false);
assert.equal(events.filter((event) => event.kind === "prompt_budget").length > 0, true);
assert.equal(events.filter((event) => event.kind === "prompt_budget").every(
  (event) => event.estimatedInputTokens <= event.effectiveInputBudget,
), true);
```

- [ ] **Step 2: Write the Init failure matrix before changing orchestration**

`tests/init-ingest-outcome.test.ts` parameterizes `llm`, coverage, patch, write, index, and embedding failures. For each case, drain `runInitWithSources` and assert no `domain_updated.patch.analyzed_sources` contains the failed source. Add one success case and assert the hash appears exactly once.

- [ ] **Step 3: Run and confirm current false-success behavior fails**

```bash
node --import tsx --test tests/ingest-bounded.test.ts tests/init-ingest-outcome.test.ts
```

Expected: FAIL because current Ingest sends raw index content and Init marks a normally returned error source analyzed.

- [ ] **Step 4: Give `runIngest` a typed result**

```ts
export type IngestOutcome =
  | {
      ok: true;
      sourcePath: string;
      created: string[];
      updated: string[];
      deleted: string[];
      outputTokens: number;
    }
  | {
      ok: false;
      sourcePath?: string;
      stage: "read" | "evidence" | "context" | "synthesis" | "patch" | "write" | "index" | "embedding" | "backlink";
      message: string;
      retryable: boolean;
    };
```

Change the generator signature to `AsyncGenerator<RunEvent, IngestOutcome>`. Every controlled failure emits existing user-visible events and returns `{ ok: false, ... }`; success returns only after all governed work finishes.

- [ ] **Step 5: Replace the two unbounded Ingest calls with the new pipeline**

The orchestration sequence is exact:

1. read source and resolve domain;
2. read typed page descriptions and page paths, never raw index serialization;
3. `prepareSourceEvidence` for complete source coverage;
4. per-entity candidate generation through existing similarity service;
5. read only candidate Markdown and call `buildEntityContext`;
6. batch and call `synthesizeEntityBatch`;
7. run existing strict path, source-collision, type-routing, tag, resource, WikiLink, and duplicate guards;
8. apply complete creates and hash-guarded patches; regenerate one conflict at most;
9. reconcile structured page records with actual on-disk pages;
10. refresh changed-page chunk vectors and require all pending vectors to succeed when embeddings are configured;
11. reconcile source backlinks from actual successful paths;
12. append operation log/eval metadata and return success.

Do not keep the old full-source entity extraction call, full-page union, complete existing-page overwrite, raw `indexContent`, or general LLM deletion output. Duplicate deletion remains only in the validated canonical-merge path with the existing large-delete warning.

- [ ] **Step 6: Make embedding refresh report incomplete batches**

Return `{ updated, failed }` from `PageSimilarityService.refreshCache`. Reused hashes count as neither. When pending embeddings exist and any required batch fails, leave existing records intact and throw `EmbeddingUnavailableError` before Ingest success. Add a test where unchanged page chunks cause zero embedding requests and `{ updated: 0, failed: 0 }`.

- [ ] **Step 7: Capture async-generator return values in Init and Delete**

Before the first non-resume Init bootstrap call, run `prepareBootstrapEvidence` with the provisional domain ID and Init policy. Pack complete bootstrap evidence units under the effective budget, then derive `DomainEntrySchema` from those units. Add an oversized-first-source fixture and assert every source chunk is covered while no bootstrap prompt exceeds budget. A fixed prompt that cannot fit returns a configuration error before domain creation.

Add a small forwarding helper local to `init.ts`:

```ts
async function* forwardIngest(
  generator: AsyncGenerator<RunEvent, IngestOutcome>,
  onDomainUpdate: (event: Extract<RunEvent, { kind: "domain_updated" }>) => void,
): AsyncGenerator<RunEvent, IngestOutcome> {
  while (true) {
    const next = await generator.next();
    if (next.done) return next.value;
    if (next.value.kind === "domain_updated") onDomainUpdate(next.value);
    yield next.value;
  }
}
```

Drive this generator manually where its return value is needed. Write the analyzed-source hash and emit `file_done` only when `outcome.ok`. Failed/skipped sources remain absent and resumable. Delete rebuild records each failed source from the typed outcome, not by scanning error events.

- [ ] **Step 8: Verify bounded Ingest and honest resume behavior**

```bash
node --import tsx --test tests/ingest-bounded.test.ts tests/init-ingest-outcome.test.ts tests/init-bootstrap-fail-loud.test.ts tests/init-embedding-stop.test.ts tests/init-force-retry.test.ts tests/page-similarity-jsonl.test.ts tests/entity-routing.test.ts tests/page-similarity-guard.test.ts tests/ensure-sources-section.test.ts
npm run lint
```

Expected: all tests PASS; synthetic vectors never enter prompts; every failure leaves source state resumable; success records one hash; unchanged embeddings are reused.

- [ ] **Step 9: Commit**

```bash
git add src/phases/ingest.ts src/phases/init.ts src/phases/delete.ts src/page-similarity.ts src/types.ts tests/ingest-bounded.test.ts tests/init-ingest-outcome.test.ts tests/init-bootstrap-fail-loud.test.ts tests/init-embedding-stop.test.ts tests/init-force-retry.test.ts tests/page-similarity-jsonl.test.ts
git commit -m "feat(ingest): integrate bounded evidence synthesis"
```

## Phase 3: Bounded Non-Ingest Operations

### Task 11: Bound Query and Follow-Up Chat Without Truncating the Current Question

**Requirements:** R2, R3, R10, R14, R16

**Files:**
- Create: `src/phases/query-budget.ts`
- Create: `tests/query-budget.test.ts`
- Modify: `src/phases/query.ts` (pack selected chunks under budget)
- Modify: `src/phases/query-cross-domain.ts` (same packer after domain fusion)
- Modify: `src/phases/query-answer.ts` (context repack; safe direct-stream fallback)
- Modify: `src/phases/chat.ts` (whole-turn history packing and context recovery)
- Modify: `src/controller.ts` (carry parent Query/Lint policy into follow-up Chat)
- Modify: `src/agent-runner.ts` (resolve `req.policyOperation`)
- Modify: `tests/query-parity.test.ts`

- [ ] **Step 1: Write whole-unit Query/Chat packing tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { packChatHistory, packQueryChunks } from "../src/phases/query-budget";

test("query keeps the current question and complete high-score chunks", () => {
  const result = packQueryChunks({
    question: "What is the failover procedure?",
    systemPrompt: "Answer with citations.",
    chunks: Array.from({ length: 20 }, (_, i) => ({
      articleId: `wiki_d_${i}`,
      path: `!Wiki/d/concept/wiki_d_${i}.md`,
      heading: `## Section ${i}`,
      body: `complete chunk ${i} ${"x".repeat(80)}`,
      score: 20 - i,
      source: "seed" as const,
      ordinal: i,
    })),
    inputBudgetTokens: 1000,
    opts: {},
  });
  assert.match(JSON.stringify(result.messages), /What is the failover procedure/);
  assert.ok(result.estimatedInputTokens <= 1000);
  assert.equal(result.selected.every((chunk) => chunk.body.startsWith("complete chunk")), true);
});

test("chat keeps newest user turn and drops older turns as whole messages", () => {
  const newest = "Current instruction must survive";
  const result = packChatHistory({
    systemPrompt: "Follow-up",
    context: "citation context",
    history: [
      { role: "user", content: "old question ".repeat(80) },
      { role: "assistant", content: "old answer ".repeat(80) },
      { role: "user", content: newest },
    ],
    inputBudgetTokens: 700,
    opts: {},
  });
  const serialized = JSON.stringify(result.messages);
  assert.match(serialized, /Current instruction must survive/);
  assert.doesNotMatch(serialized, /old answer old answer old answer/);
  assert.ok(result.estimatedInputTokens <= 700);
});

test("oversized current question fails visibly", () => {
  assert.throws(() => packQueryChunks({
    question: "q".repeat(5000),
    systemPrompt: "contract",
    chunks: [],
    inputBudgetTokens: 100,
    opts: {},
  }), /budget/i);
});
```

- [ ] **Step 2: Run and confirm missing adapters fail**

```bash
node --import tsx --test tests/query-budget.test.ts
```

Expected: FAIL because `query-budget.ts` does not exist.

- [ ] **Step 3: Implement Query chunk and Chat history packers**

`packQueryChunks` builds required units for current question and system contract, then optional complete `SelectedChunk` units ordered by score/source/stable ID. `packChatHistory` requires the latest user message, keeps assistant/user pairs whole where possible, orders older pairs newest-first, and treats prior context as lower-priority complete units. Neither function slices a message or chunk.

Both functions call `packContextUnits` with fully rendered messages so base contract, language, reasoning, custom prompt, and semantic-compression overhead are included.

- [ ] **Step 4: Use one builder for single- and cross-domain answers**

Change `answerFromContext` to receive `SelectedChunk[]`, not a pre-rendered unbounded string. Wrap packing plus the streaming call in `runWithContextRepack`. On a provider context error, rebuild using the shrunken effective budget and fewer optional chunks. The current question remains required on every attempt.

In direct streaming catch blocks in `query-answer.ts` and `chat.ts`, rethrow context/preflight errors rather than sending identical non-stream requests. Keep non-stream fallback only for unrelated stream transport failures.

- [ ] **Step 5: Propagate the parent operation into follow-up Chat**

In `dispatchChat`, map parent `query` to `policyOperation: "query"`; map `lint` and `ingest` follow-ups to `policyOperation: "lint"`. Pass that key both to `buildAgentRunner` so Claude model/effort resolve correctly and to `AgentRunner.run` so input/compression policy resolves correctly.

This replaces the current unconditional Chat-to-Lint mapping without changing the visible `operationHeader`.

- [ ] **Step 6: Verify Query, cross-domain Query, and follow-up parity**

```bash
node --import tsx --test tests/query-budget.test.ts tests/query-parity.test.ts tests/query-jsonl-index.test.ts tests/chunk-dedup.test.ts tests/reranker.test.ts
npm run lint
```

Expected: all tests PASS; current question survives every fixture; captured prompts remain under budget; Query follow-up resolves Query policy.

- [ ] **Step 7: Commit**

```bash
git add src/phases/query-budget.ts src/phases/query.ts src/phases/query-cross-domain.ts src/phases/query-answer.ts src/phases/chat.ts src/controller.ts src/agent-runner.ts tests/query-budget.test.ts tests/query-parity.test.ts
git commit -m "feat(query): bound answer and chat context"
```

### Task 12: Batch Lint and Lint Chat with Complete Finding Coverage

**Requirements:** R2, R3, R7, R10, R16

**Files:**
- Create: `src/phases/lint-batches.ts`
- Create: `tests/lint-budget.test.ts`
- Modify: `src/phases/lint.ts` (work-item batching, finding merge, section patches)
- Modify: `src/phases/lint-chat.ts` (finding/page selection, whole-turn packing, section patches)
- Modify: `src/phases/zod-schemas.ts` (typed findings and patch output)
- Modify: `prompts/lint.md`
- Modify: `prompts/lint-chat.md`

- [ ] **Step 1: Write work coverage and deterministic merge tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildLintWorkItems,
  mergeLintFindings,
  validateLintCoverage,
  type LintFinding,
} from "../src/phases/lint-batches";

test("normal and oversized pages produce complete work-item coverage", () => {
  const pages = new Map([
    ["!Wiki/d/concept/a.md", "# A\n\n## Facts\nshort"],
    ["!Wiki/d/concept/b.md", `# B\n\n## Facts\n${"long line\n".repeat(300)}`],
  ]);
  const items = buildLintWorkItems(pages, 500);
  assert.ok(items.length > 2);
  assert.doesNotThrow(() => validateLintCoverage(pages, items));
  assert.deepEqual(new Set(items.map((item) => item.path)), new Set(pages.keys()));
});

test("findings merge once by page, section, rule, severity, and text", () => {
  const finding: LintFinding = {
    path: "!Wiki/d/concept/a.md",
    heading: "## Facts",
    rule: "missing-limit",
    severity: "warning",
    text: "Limit is absent",
    repairInstruction: "Add the documented limit",
  };
  assert.deepEqual(mergeLintFindings([[finding], [finding]]), [finding]);
});

test("missing work IDs fail before reporting success", () => {
  assert.throws(() => validateLintCoverage(
    new Map([["a.md", "# A\n\n## One\na\n\n## Two\nb"]]),
    [{ id: "a:one", path: "a.md", heading: "## One", markdown: "## One\na", sectionHash: "h" }],
  ), /Two/);
});
```

- [ ] **Step 2: Run and confirm current Lint cannot cover an oversized page**

```bash
node --import tsx --test tests/lint-budget.test.ts
```

Expected: FAIL because work-item and finding contracts do not exist.

- [ ] **Step 3: Define typed Lint batches**

```ts
export interface LintWorkItem {
  id: string;
  path: string;
  heading: string;
  markdown: string;
  sectionHash: string;
}

export interface LintFinding {
  path: string;
  heading: string;
  rule: string;
  severity: "info" | "warning" | "error";
  text: string;
  repairInstruction: string;
}

export interface LintBatchOutput {
  coveredWorkIds: string[];
  findings: LintFinding[];
  patches: PatchPage[];
  deletes: Array<{ path: string; redirect_to?: string }>;
}
```

Zod requires every submitted work ID exactly once in `coveredWorkIds`. Patch targets must be among submitted page paths and pass the same section-hash rules as Ingest. Keep existing validated duplicate deletion and redirect rules.

- [ ] **Step 4: Replace per-page one-shot prompts with budgeted work batches**

Use a full page as one work item when it fits with fixed Lint overhead. Split an oversized page into complete H2 sections and then source-style line windows. Pack whole work items and optional related sections under the Lint input budget. Run each batch through bounded context recovery.

Merge findings with this stable key:

```ts
const key = [finding.path, finding.heading, finding.rule, finding.severity, finding.text]
  .map((part) => part.trim().toLowerCase())
  .join("\u0000");
```

Apply accepted changes through `applyPagePatch`, never full-page overwrite. Existing programmatic checks still run over the full domain and merge with LLM findings. Entity-type actualization receives compact merged findings, not concatenated page bodies.

- [ ] **Step 5: Bound Lint Chat by selected findings and referenced pages**

Parse the current Lint report into complete finding units. Require the newest user instruction. Select findings by explicit page/section references first, then lexical score. Read and pack only pages referenced by selected findings or current instruction. Pack older chat turns as whole optional pairs. Return/apply `PatchPage[]`; do not send or overwrite the entire domain.

- [ ] **Step 6: Add a 100-page mocked regression**

Generate 100 pages, one oversized page, and duplicated mock findings across batches. Assert every page/section work ID is covered, merged findings contain each unique key once, every prompt estimate is within budget, and untouched sections remain byte-stable after patches.

- [ ] **Step 7: Verify Lint and Lint Chat**

```bash
node --import tsx --test tests/lint-budget.test.ts tests/section-patches.test.ts tests/page-similarity-jsonl.test.ts tests/ensure-sources-section.test.ts
npm run lint
```

Expected: all tests PASS; every work item is covered; duplicate findings merge once; no existing page is replaced wholesale.

- [ ] **Step 8: Commit**

```bash
git add src/phases/lint-batches.ts src/phases/lint.ts src/phases/lint-chat.ts src/phases/zod-schemas.ts prompts/lint.md prompts/lint-chat.md tests/lint-budget.test.ts
git commit -m "feat(lint): batch findings within prompt budgets"
```

### Task 13: Segment Oversized Format Requests Without Semantic Compression

**Requirements:** R2, R3, R10, R16

**Files:**
- Create: `src/phases/format-segments.ts`
- Create: `prompts/format-segment.md`
- Create: `tests/format-segments.test.ts`
- Modify: `src/phases/format.ts` (single-call fast path, segment calls, reassembly)
- Modify: `src/phases/zod-schemas.ts` (segment response schema)
- Modify: `tests/format-response-format.test.ts`

- [ ] **Step 1: Write ordered reassembly and Vision routing tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  reassembleFormatSegments,
  segmentFormatInput,
} from "../src/phases/format-segments";

const source = `---
tags: [a]
---
# Title

## One
text ![[one.png]]

## Two
${"detail\n".repeat(100)}
`;

test("small note retains one-call shape", () => {
  const result = segmentFormatInput(source, new Map(), 10_000);
  assert.equal(result.length, 1);
  assert.equal(result[0].markdown, source);
});

test("oversized note segments in source order and routes each Vision description once", () => {
  const segments = segmentFormatInput(source, new Map([["one.png", "recognized one"]]), 300);
  assert.ok(segments.length > 1);
  assert.equal(segments.filter((segment) => segment.visionDescriptions.has("one.png")).length, 1);
  const formatted = segments.map((segment) => ({
    id: segment.id,
    report: `report ${segment.ordinal}`,
    formatted: segment.markdown,
  }));
  const rebuilt = reassembleFormatSegments(source, segments, formatted);
  assert.equal(rebuilt.formatted, source);
  assert.equal(rebuilt.report.split("\n").length, segments.length);
});

test("missing or duplicate segment IDs fail reassembly", () => {
  const segments = segmentFormatInput(source, new Map(), 300);
  assert.throws(() => reassembleFormatSegments(source, segments, []), /missing/i);
});
```

- [ ] **Step 2: Run and confirm segmentation helpers are missing**

```bash
node --import tsx --test tests/format-segments.test.ts
```

Expected: FAIL because `format-segments.ts` does not exist.

- [ ] **Step 3: Implement preservation-oriented segments**

```ts
export interface FormatSegment {
  id: string;
  ordinal: number;
  headingPath: string[];
  startLine: number;
  endLine: number;
  markdown: string;
  contentHash: string;
  visionDescriptions: Map<string, string>;
}
```

Extract frontmatter as an immutable preamble. Split body by complete sections, paragraphs, then line windows using `markdown-chunks.ts`. Keep segments in original ordinal order. Attach each Vision description only to the segment containing its exact embed token. `reassembleFormatSegments` requires one output per ID, verifies original content hashes, rejoins formatted bodies in ordinal order, restores original frontmatter, and joins reports in ordinal order.

- [ ] **Step 4: Keep the current fast path and add segmented calls only on overflow**

Build the current full Format messages first and estimate their prepared size. If they fit, execute the existing single-call path byte-for-byte. If they exceed input budget, format each segment with fixed format schema, neighboring heading path, and a rule forbidding movement across boundaries. Use `FormatSegmentOutputSchema` with `segmentId`, `report`, and `formatted`.

Pass `opts` with `semanticCompression: undefined` to every Format and repair call. A test must compare captured messages for all three global profiles and find no profile fragment.

- [ ] **Step 5: Handle output length by narrower segment recursion**

When a segment response has `finish_reason === "length"` or incomplete framing, split that source segment one level narrower and retry its children. Stop when a single source line plus fixed overhead cannot fit, then emit a visible configuration/output-budget error. Never accept partial segment output as complete.

After full reassembly, run the existing full-note guards exactly once: missing tokens, embeds, frontmatter restoration, WikiLink repair, sentinel removal, preview creation, and final missing-token report.

- [ ] **Step 6: Verify fast and segmented Format paths**

```bash
node --import tsx --test tests/format-segments.test.ts tests/format-response-format.test.ts tests/framed-output.test.ts
npm run lint
```

Expected: all tests PASS; small note uses one request; oversized note reassembles every segment in order; full-note guards pass; no compression fragment appears.

- [ ] **Step 7: Commit**

```bash
git add src/phases/format-segments.ts src/phases/format.ts src/phases/zod-schemas.ts prompts/format-segment.md tests/format-segments.test.ts tests/format-response-format.test.ts
git commit -m "feat(format): segment oversized notes safely"
```

### Task 14: Batch Vision Recognition and Preserve Every PDF Page

**Requirements:** R2, R3, R10, R16

**Files:**
- Create: `src/phases/vision-recognition.ts`
- Create: `tests/vision-budget.test.ts`
- Modify: `src/phases/attachment-analyzer.ts` (structured calls, page batching, one resize retry)
- Modify: `src/phases/zod-schemas.ts` (recognition record schema)
- Modify: `prompts/vision-image.md`
- Modify: `prompts/vision-pdf.md`
- Modify: `prompts/vision-excalidraw.md`

- [ ] **Step 1: Write media reservation and field-preservation tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  batchPdfPages,
  mergeRecognitionRecords,
  type VisionRecognitionRecord,
} from "../src/phases/vision-recognition";

const record = (pageId: string): VisionRecognitionRecord => ({
  pageId,
  ocr: [`text ${pageId}`],
  objects: [`object ${pageId}`],
  relationships: [`relation ${pageId}`],
  layout: [`layout ${pageId}`],
  uncertainty: [`uncertain ${pageId}`],
});

test("PDF pages batch by fixed media reservation", () => {
  const batches = batchPdfPages(Array.from({ length: 7 }, (_, i) => ({ pageId: `p${i + 1}`, dataUrl: `data:${i}` })), {
    inputBudgetTokens: 10_000,
    fixedEstimatedTokens: 1000,
    mediaReservationTokens: 4096,
  });
  assert.deepEqual(batches.map((batch) => batch.length), [2, 2, 2, 1]);
});

test("record merge covers every page and governed field", () => {
  const records = [record("p1"), record("p2")];
  const merged = mergeRecognitionRecords(records, "maximum");
  for (const page of records) {
    assert.match(merged, new RegExp(page.pageId));
    for (const value of [...page.ocr, ...page.objects, ...page.relationships, ...page.layout, ...page.uncertainty]) {
      assert.match(merged, new RegExp(value));
    }
  }
});
```

- [ ] **Step 2: Run and confirm recognition batching is missing**

```bash
node --import tsx --test tests/vision-budget.test.ts
```

Expected: FAIL because typed Vision records and PDF batching do not exist.

- [ ] **Step 3: Define and validate recognition records**

```ts
export interface VisionRecognitionRecord {
  pageId: string;
  ocr: string[];
  objects: string[];
  relationships: string[];
  layout: string[];
  uncertainty: string[];
}
```

Prompts must return this schema and repeat the Vision preservation invariant. `mergeRecognitionRecords` may change prose density/order according to profile, but it must retain every page ID and every non-empty array item. Validation rejects a missing page or field before a description is returned.

- [ ] **Step 4: Route all native Vision calls through prepared bounded messages**

Pass Format's resolved `inputBudgetTokens` and native output cap into attachment analysis. Replace direct `chat.completions.create` message construction with `buildChatParams`, using `semanticCompression: { profile: visionOverride ?? formatProfile, operation: "vision" }`.

Raster images and Excalidraw renders remain one media unit per call. PDF rendering produces page objects and calls `batchPdfPages` so each prepared request fits the input reservation. Merge validated records programmatically after all batches.

- [ ] **Step 5: Add one context-triggered resize retry**

If one rendered PDF page still gets a provider context error, render that page once at lower scale/quality within the existing readable bounds, rebuild the request, and retry. Mark the page attempted so it cannot resize twice. A second context failure returns the existing visible attachment warning and no invented record.

- [ ] **Step 6: Verify multi-page and failure behavior**

Use mocked render/call dependencies for seven pages, a provider-count context error, and a second failure. Assert every successful page appears once, one page resizes once, no request exceeds effective budget, and the failed attachment returns no description.

```bash
node --import tsx --test tests/vision-budget.test.ts tests/format-segments.test.ts
npm run lint
```

Expected: all tests PASS; every PDF page is covered or visibly skipped; OCR/objects/relationships/layout/uncertainty survive profile changes.

- [ ] **Step 7: Commit**

```bash
git add src/phases/vision-recognition.ts src/phases/attachment-analyzer.ts src/phases/zod-schemas.ts prompts/vision-image.md prompts/vision-pdf.md prompts/vision-excalidraw.md tests/vision-budget.test.ts
git commit -m "feat(vision): batch bounded recognition records"
```

## Phase 4: Settings and Native Vision Probe

### Task 15: Expose Budgets, Compression, and a Read-Only Native Vision Check

**Requirements:** R11, R12, R14

**Files:**
- Create: `src/vision-probe.ts`
- Create: `tests/vision-probe.test.ts`
- Create: `tests/settings-model-controls.test.ts`
- Modify: `src/settings.ts` (global/per-operation controls and Vision Check)
- Modify: `src/i18n.ts` (shape-identical EN/RU/ES labels/descriptions/notices)
- Modify: `src/model-call-policy.ts` (pure persisted-value normalization and numeric input parser)
- Modify: `src/types.ts` (`vision.compressionProfile?`)

- [ ] **Step 1: Write the native multimodal request contract tests**

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { probeNativeVisionModel } from "../src/vision-probe";

test("probe sends selected model, auth, inline PNG, and small output cap", async () => {
  const seen: Array<Record<string, unknown>> = [];
  const result = await probeNativeVisionModel({
    baseUrl: "https://provider.example/v1",
    apiKey: "secret",
    model: "vision-model",
    request: async (request) => {
      seen.push(request);
      return { status: 200, text: JSON.stringify({ choices: [{ message: { content: "pixel" } }] }) };
    },
    timeoutMs: 100,
  });
  assert.equal(result.ok, true);
  assert.equal(seen.length, 1);
  assert.equal((seen[0].headers as Record<string, string>).Authorization, "Bearer secret");
  const body = JSON.parse(String(seen[0].body));
  assert.equal(body.model, "vision-model");
  assert.ok(body.max_tokens <= 32);
  assert.match(JSON.stringify(body.messages), /data:image\/png;base64/);
});

test("HTTP, malformed, and empty responses are distinct failures", async () => {
  const cases = [
    { response: { status: 401, text: "denied" }, code: "http" },
    { response: { status: 200, text: "not-json" }, code: "malformed" },
    { response: { status: 200, text: JSON.stringify({ choices: [{ message: { content: "" } }] }) }, code: "empty" },
  ] as const;
  for (const item of cases) {
    const result = await probeNativeVisionModel({
      baseUrl: "https://provider.example/v1",
      apiKey: "k",
      model: "m",
      request: async () => item.response,
      timeoutMs: 100,
    });
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, item.code);
  }
});

test("probe timeout is reported separately", async () => {
  const result = await probeNativeVisionModel({
    baseUrl: "https://provider.example/v1",
    apiKey: "k",
    model: "m",
    request: async () => new Promise<never>(() => undefined),
    timeoutMs: 1,
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.code, "timeout");
});
```

- [ ] **Step 2: Write settings compatibility and i18n-shape tests**

Test the pure `normalizePersistedModelControls` and `parsePositiveBudgetInput` exports: an old settings object with `maxTokens: 7777` retains that value, missing input/profile fields receive `16384`/`balanced`, per-operation profile `undefined` means Use global, and invalid input text returns the prior number. Compare the settings keys returned through `i18nFor("en"|"ru"|"es")` and require equal sets.

- [ ] **Step 3: Run and confirm controls/probe are absent**

```bash
node --import tsx --test tests/vision-probe.test.ts tests/settings-model-controls.test.ts
```

Expected: FAIL because probe and UI strings do not exist.

- [ ] **Step 4: Implement the pure Vision probe**

Use a fixed 1x1 PNG constant and an injected request transport:

```ts
const PROBE_PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

export type VisionProbeResult =
  | { ok: true; content: string }
  | { ok: false; code: "timeout" | "http" | "malformed" | "empty"; message: string };
```

POST to `${baseUrlWithoutSlash}/chat/completions` with one text part, one inline `image_url`, `stream: false`, and `max_tokens: 16`. Race the request against timeout, require HTTP below 400, valid JSON, and non-empty assistant content. Never return or log API key/image payload.

- [ ] **Step 5: Add global and per-operation settings controls**

Use text inputs for token budgets and dropdowns for compression:

- Native global: `Input budget tokens`, `Output budget tokens`, compression profile.
- Native per-operation: input, output, and `Use global`/Maximum/Balanced/Minimum for Ingest, Query, Lint, Init; Format has input/output only.
- Claude global: input and compression.
- Claude per-operation: input and compression except Format; no output field.
- Vision section: `Use global`/Maximum/Balanced/Minimum override.

Numeric handlers save only finite positive integers. Invalid edits preserve the last saved value. Existing `maxTokens` handlers remain wired to the same fields.

- [ ] **Step 6: Add Vision Check only for native backend**

Pass the existing `addModelControl` check option in the Vision section only when `eff.backend === "native-agent"`. `checkVisionModel` reads Base URL, local API key, and the current model value, calls `probeNativeVisionModel`, and emits localized success/failure Notice. It performs no settings save and no vault operation. Claude renders the model control with no Check button.

- [ ] **Step 7: Synchronize EN/RU/ES keys and verify UI contracts**

Add localized keys for input/output budgets, compression/profile values, Vision check states, and validation descriptions. Keep every locale object shape-identical. Update old `maxTokens` descriptions to state that this is the response/output cap.

```bash
node --import tsx --test tests/vision-probe.test.ts tests/settings-model-controls.test.ts tests/model-call-policy.test.ts
npm run lint
npm run build
```

Expected: all tests PASS; ESLint has zero errors; build succeeds; Claude fixture has no Vision Check; native request is read-only.

- [ ] **Step 8: Commit**

```bash
git add src/vision-probe.ts src/settings.ts src/i18n.ts src/model-call-policy.ts src/types.ts tests/vision-probe.test.ts tests/settings-model-controls.test.ts
git commit -m "feat(settings): expose budgets and vision check"
```

## Phase 5: Acceptance, Documentation, and Replay

### Task 16: Add Cross-Operation Acceptance Fixtures and Safe Diagnostics Checks

**Requirements:** R1-R14, R16

**Files:**
- Create: `tests/bounded-operations-acceptance.test.ts`
- Create: `tests/prompt-budget-diagnostics.test.ts`

- [ ] **Step 1: Build a deterministic captured-request harness**

Create one mock OpenAI-compatible client that records prepared requests, can return structured fixtures by call site, can emit actual usage, and can inject provider-count/no-count context errors. It must expose only captured in-memory test data and never read local provider settings.

- [ ] **Step 2: Add the accepted matrix**

| Fixture | Required assertion |
|---|---|
| 1-page Ingest | all relevant sections fit; create/update result stable |
| 15-page Ingest | global budget holds; no duplicate action paths |
| 100-page Ingest | global budget holds; page-diverse section selection |
| 1.27 MB vector index | vector sentinel and raw records absent from every request |
| oversized source | every chunk and packet ID reaches synthesis |
| existing-page update | every untouched section is byte-identical |
| context errors | ratio/75% shrink, at most two repacks, no identical transport retry |
| Query/Chat | current question/instruction retained as whole units |
| Lint/Lint Chat | every work ID/finding covered exactly once |
| Format | every segment reassembled; no compression fragment |
| Vision/PDF | every successful page and recognition field retained |
| embeddings | unchanged chunk hashes issue zero embedding requests |

For every captured request:

```ts
assert.ok(request.estimatedInputTokens <= request.effectiveInputBudget);
assert.equal(request.serialized.includes('"vector"'), false);
```

- [ ] **Step 3: Verify diagnostics contain metadata only**

Construct `prompt_budget` events using marker strings for source text, evidence, image base64, API key, and Authorization. Serialize events and assert none of those markers occurs. Assert every approved metadata field is present and numeric where required.

- [ ] **Step 4: Run the acceptance and full executable suites**

```bash
node --import tsx --test tests/bounded-operations-acceptance.test.ts tests/prompt-budget-diagnostics.test.ts
node --import tsx --test tests/*.test.ts
npm run lint
npm run build
git diff --check
```

Expected: focused and full suites have zero failures; ESLint has zero errors and only the four known Node-import warnings; build and whitespace checks succeed.

- [ ] **Step 5: Commit**

```bash
git add tests/bounded-operations-acceptance.test.ts tests/prompt-budget-diagnostics.test.ts
git commit -m "test: cover bounded model operations"
```

### Task 17: Document Behavior, Update iwiki, and Replay the 22 Sources on a Safe Copy

**Requirements:** R15

**Files:**
- Create: `scripts/audit-bounded-init-replay.ts`
- Create: `tests/audit-bounded-init-replay.test.ts`
- Modify: `README.md` (backend settings, bounded Ingest, Vision Check)
- Modify: `docs/README.ru.md` (matching user documentation)
- Modify: `docs/rag-quality-recommendations.md` (bounded evidence/context/index architecture)
- Modify through iwiki MCP: `overview`, `jsonl-domain-storage`, and `architecture/structured-output-runner` sections that describe runtime behavior

- [ ] **Step 1: Write and test a read-only replay auditor**

The script accepts `--vault`, `--session`, and `--expected-sources`. It reads only the copied vault's plugin `agent.jsonl` and domain `index.jsonl`, then exits non-zero unless:

- the selected Init session has the expected distinct successful source count;
- no event contains a context-length error;
- every `prompt_budget` estimate is within its effective budget;
- no source is marked complete after a failure event;
- page/chunk JSONL records parse and article IDs are unique by record kind;
- no `prompt_budget` event contains content-bearing fields.

Unit tests use temporary fixture files for success, overflow, failed-source, duplicate-record, and leaked-content cases.

```bash
node --import tsx --test tests/audit-bounded-init-replay.test.ts
```

Expected: all auditor fixtures PASS.

- [ ] **Step 2: Update repository documentation**

Document:

- Input budget vs Output budget vs Thinking budget;
- native/Claude output ownership;
- global/per-operation compression and Format exclusion;
- bounded Markdown evidence map/reduce and section patches;
- structured `index.jsonl` boundary and embedding reuse;
- native-only Vision Check and its real tiny image request;
- extra calls/cost for oversized sources in exchange for complete processing.

Keep README setting tables synchronized and do not claim automatic model context-window discovery.

- [ ] **Step 3: Update bound iwiki pages before final response**

Use `wiki_update_page` on existing headings in `overview`, `jsonl-domain-storage`, and `architecture/structured-output-runner`. The wiki must state that serialized vectors never enter prompts, page/chunk records preserve each other, Ingest uses complete evidence coverage and section patches, every operation has an input governor, and Format has no semantic compression. Run `wiki_lint` after writes. No changed-source wiki page may remain stale or contradict runtime behavior.

- [ ] **Step 4: Create two protected vault copies**

```bash
REPLAY_ROOT=$(mktemp -d /tmp/ai-wiki-bounded-ingest-replay.XXXXXX)
chmod 700 "$REPLAY_ROOT"
SOURCE_VAULT=/home/ikeniborn/Documents/Project/notes/vaults/Work
SOURCE_VAULT=$(realpath -e "$SOURCE_VAULT")
cp -a --reflink=auto "$SOURCE_VAULT" "$REPLAY_ROOT/before"
cp -a --reflink=auto "$SOURCE_VAULT" "$REPLAY_ROOT/run"
printf 'source=%s\ncreated_epoch=%s\nroot=%s\n' "$SOURCE_VAULT" "$(date +%s)" "$REPLAY_ROOT" > "$REPLAY_ROOT/.replay-provenance"
chmod 600 "$REPLAY_ROOT/.replay-provenance"
test "$REPLAY_ROOT/run" != /home/ikeniborn/Documents/Project/notes/vaults/Work
printf '%s\n' "$REPLAY_ROOT"
```

Expected: command prints a unique private temporary directory; both copies exist; source vault path differs from replay vault path.

- [ ] **Step 5: Human checkpoint - run Init/Re-init only in the copied `run` vault**

Open `$REPLAY_ROOT/run` as a separate Obsidian vault, load the branch build, select the same native backend/model, and run the same 22-source Init/Re-init. Before clicking Re-init, visibly confirm the vault path ends in `/run`, not the working `Work` vault. Do not proceed without that path confirmation.

Expected UI result: all 22 sources finish; no context-length error; failed-source count is zero.

- [ ] **Step 6: Audit the replay and inspect quality**

```bash
node --import tsx scripts/audit-bounded-init-replay.ts --vault "$REPLAY_ROOT/run" --session latest-init --expected-sources 22
```

Expected: exit `0` with source count `22`, context errors `0`, budget violations `0`, leaked prompt fields `0`, and duplicate record IDs `0`.

Compare a focused sample of create/update decisions against `$REPLAY_ROOT/before`: at least one unchanged page, every updated page reported by the session, and every created page. Confirm no unrelated section loss, no duplicate entity page, and all source anchors represented. Record model/backend, configured budget/profile, call count, elapsed time, and any quality discrepancy in implementation notes; never record API keys or prompt content.

- [ ] **Step 7: Run final local gates**

```bash
node --import tsx --test tests/*.test.ts
npm run lint
npm run build
git diff --check
git status --short
```

Expected: all tests pass; ESLint has zero errors; build succeeds; diff check is clean; status lists only planned source/test/doc changes before the final commit.

- [ ] **Step 8: Commit documentation and replay evidence tooling**

```bash
git add scripts/audit-bounded-init-replay.ts tests/audit-bounded-init-replay.test.ts README.md docs/README.ru.md docs/rag-quality-recommendations.md
git commit -m "docs: document bounded ingest controls"
```

- [ ] **Step 9: Run result reconciliation**

Invoke `$check-chain result docs/superpowers/plans/2026-07-16-bounded-ingest-model-controls-plan.md`. Resolve every confirmed code-review finding, rerun affected checks, update the final result report, and close the task only when the result verdict is `OK`.

## Phase 6: Live Replay Hardening

### Task 18: Add the Shared Human-Readable LLM Lifecycle and Sidebar Renderer

**Requirements:** R17

**Files:**
- Create: `src/llm-lifecycle.ts`
- Create: `tests/llm-lifecycle.test.ts`
- Create: `tests/view-llm-lifecycle.test.ts`
- Modify: `src/types.ts`
- Modify: `src/view.ts`
- Modify: `src/i18n.ts`
- Modify: `src/styles.css`
- Modify: `src/controller.ts`
- Modify: `tests/settings-model-controls.test.ts`

- [ ] **Step 1: Write failing lifecycle state-machine tests**

Define fixtures that require one stable lifecycle ID, ordered phases, one terminal phase,
and retry close/reopen behavior:

```ts
const phases: LlmLifecyclePhase[] = [
  "preparing", "sent", "waiting", "producing",
  "validating", "applying", "completed",
];
const state = phases.reduce(
  (current, phase) => reduceLlmLifecycle(current, lifecycleEvent("call-1", phase)),
  emptyLlmLifecycleState(),
);
assert.equal(state.calls["call-1"].phase, "completed");
assert.throws(
  () => reduceLlmLifecycle(state, lifecycleEvent("call-1", "waiting")),
  /terminal lifecycle/i,
);
```

Add separate cases for `retrying`, `failed`, `cancelled`, and a second lifecycle ID after
retry. Require human state/action labels to contain none of these hostile technical values:

```ts
const hidden = ["ingest.synthesize", "stream", "attempt=3", "32768", "provider secret"];
for (const marker of hidden) assert.equal(renderedHumanText.includes(marker), false);
```

- [ ] **Step 2: Run the lifecycle tests and confirm RED**

```bash
node --import tsx --test tests/llm-lifecycle.test.ts tests/view-llm-lifecycle.test.ts
```

Expected: FAIL because `llm_lifecycle`, reducer, and human renderer do not exist.

- [ ] **Step 3: Add the typed lifecycle event and pure reducer**

Add exact contracts:

```ts
export type LlmLifecyclePhase =
  | "preparing" | "sent" | "waiting" | "producing"
  | "validating" | "applying"
  | "completed" | "retrying" | "failed" | "cancelled";

export type LlmLifecycleAction =
  | "bootstrap_domain" | "extract_source_facts" | "reduce_source_evidence"
  | "synthesize_wiki_pages" | "select_relevant_pages" | "answer_question"
  | "check_wiki_quality" | "apply_lint_fixes" | "format_note"
  | "analyze_attachments";

export interface LlmLifecycleDiagnostics {
  callSite?: StructuredCallSite;
  transport?: "stream" | "non-stream" | "claude";
  attempt?: number;
  configuredInputBudget?: number;
  effectiveInputBudget?: number;
}
```

Extend `RunEvent` with:

```ts
{
  kind: "llm_lifecycle";
  id: string;
  action: LlmLifecycleAction;
  phase: LlmLifecyclePhase;
  atMs: number;
  diagnostics?: LlmLifecycleDiagnostics;
}
```

`src/llm-lifecycle.ts` must export the pure reducer, terminal guard, lifecycle-event
factory, and a pure `humanLifecycleText(event, labels)` that consumes only `action` and
`phase`. Diagnostics must never enter the human renderer.

- [ ] **Step 4: Render one in-place lifecycle scale in the sidebar**

In `WikiView.appendEvent`, route `llm_lifecycle` before generic `tool_use` rendering.
Create one row per lifecycle ID with all lifecycle phases, mark completed/current/pending
states, and update the waiting duration from the view's existing local timer. Do not emit
timer events. Remove `startWaiting()` from unrelated `tool_result`; start/stop waiting only
from lifecycle `waiting`/later phases.

Keep the existing expandable reasoning block. `assistant_text{isReasoning:true}` updates
that block while lifecycle `producing` remains the active state. Suppress the old
Evidence mapping/reduction model-tool rows once their call sites emit lifecycle events.
Generic filesystem/domain tool rows remain unchanged.

- [ ] **Step 5: Add EN/RU/ES labels and minimal styles**

Add shape-identical locale keys for every phase and action. Russian labels include:

```ts
llmPreparing: "Подготавливаем запрос",
llmSent: "Запрос передан модели",
llmWaiting: "Ожидаем ответ модели",
llmProducing: "Модель формирует ответ",
llmValidating: "Проверяем ответ",
llmApplying: "Применяем результат",
llmCompleted: "Готово",
llmRetrying: "Повторяем запрос",
llmFailed: "Ошибка",
llmCancelled: "Отменено",
```

Use CSS state classes only for current/completed/failed/pending presentation. Do not add a
second progress panel or expose diagnostics in DOM attributes.

- [ ] **Step 6: Preserve technical diagnostics in logs only**

`controller.logEvent` continues serializing the complete lifecycle event to `agent.jsonl`.
`collectStep` must not convert lifecycle events into history `tool_use` text. Before a
lifecycle phase following reasoning, flush the existing buffered reasoning record so log
ordering remains deterministic.

- [ ] **Step 7: Verify lifecycle, locale, and view contracts**

```bash
node --import tsx --test tests/llm-lifecycle.test.ts tests/view-llm-lifecycle.test.ts tests/settings-model-controls.test.ts
npx tsc --noEmit --pretty false
npm run lint
```

Expected: lifecycle sequence tests PASS; EN/RU/ES shapes match; rendered text contains no
technical markers; TypeScript passes; ESLint has zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/llm-lifecycle.ts src/types.ts src/view.ts src/i18n.ts src/styles.css src/controller.ts tests/llm-lifecycle.test.ts tests/view-llm-lifecycle.test.ts tests/settings-model-controls.test.ts
git commit -m "feat(progress): show human model lifecycle"
```

### Task 19: Instrument Native Model Calls and Use Non-Stream Background Transport

**Requirements:** R17

**Files:**
- Modify: `src/phases/structured-output.ts`
- Modify: `src/phases/llm-utils.ts`
- Modify: `src/phases/parse-with-retry.ts`
- Modify: `src/prompt-budget.ts`
- Modify: `src/phases/init.ts`
- Modify: `src/phases/ingest-evidence.ts`
- Modify: `src/phases/ingest-synthesis.ts`
- Modify: `src/phases/lint.ts`
- Modify: `src/phases/lint-chat.ts`
- Modify: `src/phases/query.ts`
- Modify: `src/phases/query-answer.ts`
- Modify: `src/phases/chat.ts`
- Modify: `src/phases/format.ts`
- Modify: `src/phases/attachment-analyzer.ts`
- Modify: `src/agent-runner.ts`
- Modify: `tests/structured-output.test.ts`
- Modify: `tests/ingest-evidence.test.ts`
- Modify: `tests/ingest-bounded.test.ts`
- Modify: `tests/lint-budget.test.ts`
- Modify: `tests/query-budget.test.ts`
- Modify: `tests/format-budget.test.ts`
- Modify: `tests/vision-budget.test.ts`
- Modify: `tests/init-force-retry.test.ts`

- [ ] **Step 1: Write failing structured-runner lifecycle tests**

Require the exact streamed runner sequence:

```ts
assert.deepEqual(lifecyclePhases(events), [
  "preparing", "sent", "waiting", "producing",
  "validating",
]);
```

An empty role/usage chunk must not produce `producing`; first non-empty reasoning/content
must. Non-stream completion must emit prepare/sent/wait, preserve provider
`reasoning`/`reasoning_content`, then validate and return. Response-format fallback,
structured repair, and context repack must close with `retrying` before a new lifecycle
ID. Operation integration tests append `applying` and `completed` after the runner returns.
Abort must close with `cancelled`; validation exhaustion with `failed`.

- [ ] **Step 2: Write failing operation transport tests**

Capture request parameters and require:

| Call family | Required transport |
|---|---|
| Init bootstrap/evidence/reduce | `stream:false` |
| Ingest synthesis/regeneration | `stream:false` |
| Lint batch/config/lint-chat patch | `stream:false` |
| Query seed/link repair | `stream:false` |
| Vision attachment/PDF batch | `stream:false` |
| Chat, Query answer, Format output | `stream:true` |

For every family, assert an ordered lifecycle and the expected human action key.

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
node --import tsx --test tests/structured-output.test.ts tests/ingest-evidence.test.ts tests/ingest-bounded.test.ts tests/lint-budget.test.ts tests/query-budget.test.ts tests/format-budget.test.ts tests/vision-budget.test.ts tests/init-force-retry.test.ts
```

Expected: FAIL on missing lifecycle events and streaming Ingest synthesis/Lint calls.

- [ ] **Step 4: Instrument the shared structured runner**

Add a required lifecycle descriptor to `RunStructuredArgs`:

```ts
lifecycle: {
  id: string;
  action: LlmLifecycleAction;
}
```

Emit `preparing` before parameter construction, `sent` immediately before invoking the
client, `waiting` after invocation starts, and `producing` only on the first non-empty
reasoning/content chunk. Emit `validating` before profile parsing/Zod validation. On a
valid response, return control with the lifecycle still non-terminal; the operation call
site then emits `applying` and `completed` at its actual render/mutation boundary. Retry
paths emit `retrying`; terminal exceptions emit `failed` or `cancelled`.
`runStructuredStreaming` forwards lifecycle events live through its existing queue.

Add a non-stream reasoning extractor:

```ts
export function completionReasoning(message: unknown): string {
  const value = message as { reasoning?: unknown; reasoning_content?: unknown };
  return typeof value.reasoning === "string" ? value.reasoning
    : typeof value.reasoning_content === "string" ? value.reasoning_content
    : "";
}
```

- [ ] **Step 5: Convert atomic background calls to non-stream**

Set `transport: "non-stream"` in both Ingest synthesis paths, Lint batch/config/chat-patch,
Query seed/link-repair, and all existing atomic structured background calls. Keep the
current direct non-stream Evidence and Init bootstrap behavior. Route lifecycle events
through `RunEventBridge` where Promise-based helpers previously buffered or discarded
events.

Do not change Chat, primary Query answer, or Format to non-stream. Their direct SSE loops
emit `sent`/`waiting` before await, `producing` on first non-empty reasoning/content, and
`validating`/`applying`/terminal at their existing boundaries.

- [ ] **Step 6: Replace technical Evidence tool rows**

Delete `startEvidenceOperation`/`finishEvidenceOperation` tool-event emission. Map and
reduce use the shared actions `extract_source_facts` and `reduce_source_evidence`.
Context repack/structured repair use lifecycle `retrying`; technical reason and depth stay
in diagnostics/logs.

- [ ] **Step 7: Instrument Vision and result application**

Each bounded Vision image/PDF batch emits `analyze_attachments` lifecycle around its
non-stream call. Ingest page writes, Lint patch application, Query answer display, and
Format preview application emit `applying` immediately before their existing mutation or
render boundary, then `completed`.

- [ ] **Step 8: Prove lifecycle UI cannot keep a hung call alive**

In `AgentRunner`, do not add `llm_lifecycle` to the idle-reset filter. Add a fake operation
that emits lifecycle prepare/sent/waiting and then hangs. Assert idle abort occurs at the
configured deadline. A real reasoning/content `assistant_text` still resets the timer;
local sidebar waiting ticks create no event.

- [ ] **Step 9: Run focused and full native checks**

```bash
node --import tsx --test tests/structured-output.test.ts tests/ingest-evidence.test.ts tests/ingest-bounded.test.ts tests/lint-budget.test.ts tests/query-budget.test.ts tests/format-budget.test.ts tests/vision-budget.test.ts tests/init-force-retry.test.ts
node --import tsx --test tests/*.test.ts
npx tsc --noEmit --pretty false
npm run lint
npm run build
git diff --check
```

Expected: focused and full suites pass; background calls are non-stream; interactive calls
remain SSE; idle deadline is unchanged; TypeScript/build pass; lint has zero errors.

- [ ] **Step 10: Commit**

```bash
git add src/phases/structured-output.ts src/phases/llm-utils.ts src/phases/parse-with-retry.ts src/prompt-budget.ts src/phases/init.ts src/phases/ingest-evidence.ts src/phases/ingest-synthesis.ts src/phases/lint.ts src/phases/lint-chat.ts src/phases/query.ts src/phases/query-answer.ts src/phases/chat.ts src/phases/format.ts src/phases/attachment-analyzer.ts src/agent-runner.ts tests/structured-output.test.ts tests/ingest-evidence.test.ts tests/ingest-bounded.test.ts tests/lint-budget.test.ts tests/query-budget.test.ts tests/format-budget.test.ts tests/vision-budget.test.ts tests/init-force-retry.test.ts
git commit -m "fix(llm): expose lifecycle and bound background calls"
```

### Task 20: Preserve Lifecycle and Reasoning Through the Claude Backend

**Requirements:** R17, R14

**Files:**
- Modify: `src/claude-cli-client.ts`
- Modify: `src/stream.ts`
- Modify: `tests/claude-cli-packed-context.test.ts`
- Modify: `tests/claude-chat-context.test.ts`
- Modify: `tests/bounded-operations-acceptance.test.ts`

- [ ] **Step 1: Write failing Claude reasoning/lifecycle tests**

Feed a Claude stream containing `thinking` plus final text. Streaming must expose thinking
as `assistant_text{isReasoning:true}` and transition to `producing`. Non-stream collection
must retain reasoning separately from content and pass it to the structured runner.
Lifecycle labels remain backend-independent and contain no CLI command/arguments.

- [ ] **Step 2: Run and confirm RED**

```bash
node --import tsx --test tests/claude-cli-packed-context.test.ts tests/claude-chat-context.test.ts tests/bounded-operations-acceptance.test.ts
```

Expected: FAIL because non-stream Claude collection drops reasoning and lifecycle coverage
is absent.

- [ ] **Step 3: Preserve Claude reasoning without backend-specific UI**

Map Claude thinking blocks to OpenAI-compatible `delta.reasoning` in streaming output.
Extend `_collect` to concatenate reasoning independently and expose it on the returned
completion message. Keep lifecycle ownership at the operation/structured-runner boundary;
the Claude client supplies transport diagnostics only.

- [ ] **Step 4: Verify both backends share human semantics**

```bash
node --import tsx --test tests/claude-cli-packed-context.test.ts tests/claude-chat-context.test.ts tests/bounded-operations-acceptance.test.ts tests/llm-lifecycle.test.ts
npx tsc --noEmit --pretty false
npm run lint
```

Expected: Claude reasoning survives stream and non-stream paths; native/Claude fixtures use
the same action/phase labels; technical CLI data appears only in captured diagnostics.

- [ ] **Step 5: Commit**

```bash
git add src/claude-cli-client.ts src/stream.ts tests/claude-cli-packed-context.test.ts tests/claude-chat-context.test.ts tests/bounded-operations-acceptance.test.ts
git commit -m "fix(claude): preserve reasoning lifecycle"
```

### Task 21: Make Full Re-init Delete and Recreate the Complete Domain Tree

**Requirements:** R18

**Files:**
- Modify: `src/phases/init.ts`
- Delete: `tests/wipe-domain-preserves-metadata.test.ts`
- Create: `tests/init-force-domain-wipe.test.ts`
- Modify: `tests/init-bootstrap-fail-loud.test.ts`
- Modify: `tests/init-force-retry.test.ts`
- Modify: `tests/init-ingest-outcome.test.ts`

- [ ] **Step 1: Write failing complete-wipe tests**

Seed a target domain with `metadata.jsonl`, `index.jsonl`, `log.jsonl`, `.tmp`, pages,
nested entity directories, and empty obsolete directories. Seed another domain and record
its exact files. Require:

```ts
const removed = await wipeDomainFolder(vaultTools, "target");
assert.equal(await vaultTools.exists("!Wiki/target"), false);
assert.deepEqual(await snapshotTree(vaultTools, "!Wiki/other"), otherBefore);
assert.ok(removed.includes("!Wiki/target/metadata.jsonl"));
```

Integration event order must be bootstrap success → one `WipeDomain` → target absence →
`domain_created` → fresh metadata/index. No old descendant may reappear.

- [ ] **Step 2: Add failing path, rollback, and fail-closed tests**

Reject empty, traversal, slash-containing, `!Wiki`, and foreign-root targets before any
read/remove. Inject file removal failure, recursive `rmdir` failure, and false-success
`rmdir` that leaves the root present. Every case must restore exact prior file bytes and
empty-folder inventory, emit terminal wipe failure, and perform zero source ingest.

- [ ] **Step 3: Run and confirm RED**

```bash
node --import tsx --test tests/init-force-domain-wipe.test.ts tests/init-bootstrap-fail-loud.test.ts tests/init-force-retry.test.ts tests/init-ingest-outcome.test.ts
```

Expected: FAIL because metadata and empty folders survive and the old domain is updated
rather than recreated.

- [ ] **Step 4: Implement a transactional full-tree wipe**

Validate that `wikiFolder` is one safe path segment and that
`domainWikiFolder(wikiFolder)` is exactly `!Wiki/${wikiFolder}`. Inventory exact file
images plus every nested folder, including empty folders. Remove all files conditionally,
including metadata. Call `vaultTools.rmdir(root, true)` and require
`await vaultTools.exists(root) === false`.

On any failure, recreate the recorded folder tree and restore exact file bytes through the
existing rollback helpers. If rollback or transaction trust fails, surface that error.
Do not reuse `removeDomainFolder`; it is best-effort and intentionally swallows errors.

- [ ] **Step 5: Recreate the domain from bootstrap state**

Remove the intermediate empty `domain_updated` event after wipe. Force mode passes the
prepared bootstrap into `runInitWithSources` as a recreation: emit `domain_created`, create
fresh metadata/index, then ingest sources. Keep bootstrap and prepared-source rechecks
before mutation. Preserve the existing one-`WipeDomain` operation-level replay guard.

- [ ] **Step 6: Verify full wipe and regression boundaries**

```bash
node --import tsx --test tests/init-force-domain-wipe.test.ts tests/init-bootstrap-fail-loud.test.ts tests/init-force-retry.test.ts tests/init-ingest-outcome.test.ts tests/remove-domain-folder.test.ts
node --import tsx --test tests/*.test.ts
npx tsc --noEmit --pretty false
npm run lint
npm run build
git diff --check
```

Expected: target tree is absent before recreation; fresh files appear in correct order;
other domain is byte-identical; rollback fixtures restore files and empty folders; one
explicit run emits one wipe; full suite/build pass.

- [ ] **Step 7: Commit**

```bash
git add src/phases/init.ts tests/init-force-domain-wipe.test.ts tests/init-bootstrap-fail-loud.test.ts tests/init-force-retry.test.ts tests/init-ingest-outcome.test.ts tests/wipe-domain-preserves-metadata.test.ts
git commit -m "fix(init): fully recreate domain on reinit"
```

### Task 22: Document, Review, and Replay the Human Lifecycle and Full Wipe

**Requirements:** R15, R17, R18

**Files:**
- Modify: `README.md`
- Modify: `docs/README.ru.md`
- Modify: `docs/rag-quality-recommendations.md`
- Modify: `scripts/audit-bounded-init-replay.ts`
- Modify: `tests/audit-bounded-init-replay.test.ts`
- Modify through iwiki MCP: `architecture/structured-output-runner`

- [ ] **Step 1: Extend the read-only replay auditor**

Require every model request in the selected Init session to have an ordered lifecycle,
terminal state, and no silent dispatch-to-response gap. Require one `WipeDomain`, no stale
pre-wipe domain descendant after recreation, 22 successful sources, zero context errors,
and zero budget violations. Reject technical fields found in persisted human-label fields;
retain them in lifecycle diagnostics.

- [ ] **Step 2: Write and verify failing auditor fixtures**

Add fixtures for missing `waiting`, missing terminal, lifecycle extending beyond idle
deadline, two wipes, stale empty directory manifest, and successful full lifecycle.

```bash
node --import tsx --test tests/audit-bounded-init-replay.test.ts
```

Expected before auditor changes: FAIL on the new negative fixtures.

- [ ] **Step 3: Update user and architecture documentation**

Document the sidebar lifecycle, expandable reasoning, log-only diagnostics, background
non-stream vs interactive SSE policy, and full-tree Re-init behavior. Update
`architecture/structured-output-runner` through iwiki MCP and run `wiki_lint`. Do not claim
that UI timers are provider heartbeats.

- [ ] **Step 4: Run two-stage code review**

Use one spec-compliance reviewer for R17/R18, then one code-quality reviewer. Resolve every
confirmed finding with the original implementer, rerun affected tests, and repeat review
until PASS/APPROVED.

- [ ] **Step 5: Build, install, and run the protected replay**

```bash
npm run build
sha256sum dist/main.js
: "${REPLAY_ROOT:?Set REPLAY_ROOT to the protected replay root created in Task 17 Step 4}"
RAW_REPLAY_ROOT=$REPLAY_ROOT
test ! -L "$RAW_REPLAY_ROOT"
test ! -L "$RAW_REPLAY_ROOT/run"
REPLAY_ROOT=$(realpath -e "$RAW_REPLAY_ROOT")
RUN_VAULT=$(realpath -e "$REPLAY_ROOT/run")
test -d "$RUN_VAULT/.obsidian/plugins/ai-wiki"
test "$RUN_VAULT" != /home/ikeniborn/Documents/Project/notes/vaults/Work
case "$RUN_VAULT" in /tmp/ai-wiki-bounded-ingest-replay.*/run) ;; *) exit 1 ;; esac
MARKER="$REPLAY_ROOT/.replay-provenance"
test -f "$MARKER"
test -O "$MARKER"
grep -Fx "source=/home/ikeniborn/Documents/Project/notes/vaults/Work" "$MARKER"
grep -Fx "root=$REPLAY_ROOT" "$MARKER"
CREATED_EPOCH=$(sed -n 's/^created_epoch=//p' "$MARKER")
test "$CREATED_EPOCH" -le "$(date +%s)"
test "$CREATED_EPOCH" -ge "$(( $(date +%s) - 604800 ))"
cp dist/main.js dist/manifest.json dist/styles.css "$RUN_VAULT/.obsidian/plugins/ai-wiki/"
```

Fully restart Obsidian, open exactly `$RUN_VAULT`, run Re-init, and monitor
`$RUN_VAULT/.obsidian/plugins/ai-wiki/agent.jsonl` until terminal success/error. Never
write the original working vault.

- [ ] **Step 6: Audit and close only on live success**

```bash
: "${RUN_VAULT:?Set RUN_VAULT from Task 22 Step 5}"
node --import tsx scripts/audit-bounded-init-replay.ts --vault "$RUN_VAULT" --session latest-init --expected-sources 22
node --import tsx --test tests/*.test.ts
npx tsc --noEmit --pretty false
npm run lint
npm run build
git diff --check
```

Expected: replay audit exits zero; 22/22 sources complete; lifecycle is visible and human;
no stale domain descendants survive wipe; all local gates and `wiki_lint` pass.

- [ ] **Step 7: Run final chain reconciliation**

Invoke `$check-chain result docs/superpowers/plans/2026-07-16-bounded-ingest-model-controls-plan.md`.
Close `docs/TODO.md` only when result is `OK`.

## Phase 7: Native Request-Scoped Transient Recovery

### Task 23: Classify Retryable Native Failures and Calculate Bounded Delays

**Requirements:** R19, R20

**Files:**
- Create: `src/native-request-retry.ts`
- Create: `tests/native-request-retry.test.ts`
- Modify: `src/types.ts` (`RunEvent` retry diagnostics only; Task 26 owns persisted timeout settings)

- [ ] **Step 1: Write the failing retry-classification table**

Cover `APIConnectionError`, `APIConnectionTimeoutError`, temporary socket/DNS errors,
permanent TLS errors, HTTP 408/409/429/500/502/503/504, HTTP
400/401/403/404/422, unknown errors, context errors, and `x-should-retry` precedence.
Construct fixtures with the real OpenAI SDK error APIs (`APIConnectionError`,
`APIConnectionTimeoutError`, and `APIError.generate`) rather than structural lookalikes.
Include wrapped socket/TLS failures at multiple `cause` depths, plus a cyclic cause graph,
and require bounded cycle-safe traversal.

```ts
for (const [status, expected] of [
  [408, true], [409, true], [429, true], [500, true], [502, true],
  [400, false], [401, false], [403, false], [404, false], [422, false],
] as const) {
  test(`HTTP ${status} retryable=${expected}`, () => {
    assert.equal(classifyNativeRetry(apiError(status)).retryable, expected);
  });
}

test("x-should-retry false overrides HTTP 502", () => {
  assert.equal(classifyNativeRetry(apiError(502, { "x-should-retry": "false" })).retryable, false);
});
```

- [ ] **Step 2: Write failing delay and retry-header tests**

Inject `now` and `random` so tests prove `retry-after-ms`, numeric/date `Retry-After`,
exponential backoff, jitter, and the eight-second cap without sleeping.

```ts
assert.deepEqual(retryDelay(headers({ "retry-after-ms": "1250" }), 1, fixedClock), {
  delayMs: 1250,
  source: "retry-after-ms",
});
assert.ok(retryDelay(new Headers(), 20, fixedClock).delayMs <= 8000);
```

- [ ] **Step 3: Run focused tests and confirm RED**

```bash
node --import tsx --test tests/native-request-retry.test.ts
```

Expected: FAIL because `src/native-request-retry.ts` and retry diagnostic event variants
do not exist.

- [ ] **Step 4: Implement the pure policy**

Create explicit results; unknown and permanent-certificate failures default to fail-closed.

```ts
export interface NativeRetryDecision {
  retryable: boolean;
  errorClass: string;
  status?: number;
  providerRequestId?: string;
}

export function classifyNativeRetry(error: unknown): NativeRetryDecision;
export function retryDelay(
  headers: Headers | undefined,
  retryOrdinal: number,
  env?: { now: () => number; random: () => number },
): { delayMs: number; source: "retry-after-ms" | "retry-after" | "backoff" };
```

The classifier may inspect OpenAI SDK errors and their nested `cause` chain only through a
cycle-safe bounded walk. It must not classify by message substring when a typed status,
header override, socket code, or TLS code is available.

Add metadata-only `transport_retry_scheduled`, `transport_retry_recovered`, and
`transport_retry_exhausted` `RunEvent` variants. Do not include prompt, source, body,
authorization, or API key fields.

- [ ] **Step 5: Verify policy tests**

```bash
node --import tsx --test tests/native-request-retry.test.ts tests/prompt-budget.test.ts
npx tsc --noEmit --pretty false
```

Expected: PASS; context-limit fixtures remain non-transport-retryable.

- [ ] **Step 6: Commit**

```bash
git add src/native-request-retry.ts src/types.ts tests/native-request-retry.test.ts
git commit -m "feat(llm): classify transient native request failures"
```

### Task 24: Execute Stream and Non-Stream Attempts Without Replaying Output

**Requirements:** R19, R20, R22

**Files:**
- Create: `src/native-llm-executor.ts`
- Create: `tests/native-llm-executor.test.ts`
- Modify: `src/types.ts` (`NativeRequestRetryContext` and native create options)
- Modify: `src/llm-lifecycle.ts` (replacement-attempt helper)

- [ ] **Step 1: Write failing non-stream attempt tests**

Use a fake completion client and fake delay. Prove `502 -> success`, exhaustion,
zero-retry mode, identical request params, user cancellation during request/backoff, and
one returned completion.

```ts
const result = await executeNativeLlmRequest({
  create: sequence([apiError(502), completion("ok")]),
  params,
  retry: retryContext({ maxRetries: 3 }),
});
assert.equal("choices" in result, true);
assert.equal((result as OpenAI.Chat.ChatCompletion).choices[0]?.message.content, "ok");
assert.equal(seenParams.length, 2);
assert.deepEqual(seenParams[0], seenParams[1]);
```

- [ ] **Step 2: Write failing stream safety tests**

Cover connection failure before the first chunk, role/usage-only chunks, retry before
meaningful output, and fail-closed after nonblank reasoning/content.

```ts
await consume(executeNativeLlmRequest({
  create: sequence([streamThatFailsBeforeContent(), streamOf("ok")]),
  params: { ...params, stream: true },
  retry: retryContext({ maxRetries: 1 }),
}));
assert.equal(requests, 2);

await assert.rejects(consume(executeNativeLlmRequest({
  create: sequence([streamThenFail("partial"), streamOf("must-not-run")]),
  params: { ...params, stream: true },
  retry: retryContext({ maxRetries: 1 }),
})));
assert.equal(requests, 1);
```

- [ ] **Step 3: Write failing lifecycle and telemetry tests**

Require one stable logical request ID, a fresh lifecycle ID per attempt, localized action key
`retry_model_request`, ordered retry/sent/waiting states, log-only counters/status, and
scheduled/recovered/exhausted diagnostics. Include an `x-request-id` fixture and assert
`providerRequestId` is extracted and logged when present.

- [ ] **Step 4: Run executor tests and confirm RED**

```bash
node --import tsx --test tests/native-llm-executor.test.ts
```

Expected: FAIL because the executor is absent.

- [ ] **Step 5: Implement one logical request over bounded attempts**

Use one immutable params object and attempt-local abort/timer state.

```ts
export interface NativeRequestRetryContext {
  logicalRequestId: string;
  callSite: string;
  maxRetries: number;
  idleTimeoutMs: number;
  signal: AbortSignal;
  onEvent: (event: RunEvent) => void;
  lifecycle: NativeRequestLifecycle;
  delay: (ms: number, signal: AbortSignal) => Promise<void>;
}

export interface NativeRequestLifecycle {
  begin(attempt: number, transport: "stream" | "non-stream"): void;
  phase(phase: "sent" | "waiting" | "producing" | "validating"): void;
  close(phase: "retrying" | "failed" | "cancelled"): void;
  current(): { id: string; action: LlmLifecycleAction };
}

export function executeNativeLlmRequest(
  input: NativeLlmExecutionInput,
): Promise<OpenAI.Chat.ChatCompletion | AsyncIterable<OpenAI.Chat.ChatCompletionChunk>>;
```

For streams, return a wrapped async iterable that retries only before a nonblank
`reasoning`, `reasoning_content`, or `content` delta. Any valid OpenAI chunk may reset the
idle timer, but role/usage-only chunks do not set the meaningful-output retry guard. The
executor drives the call site's supplied lifecycle controller; it must not create a second
parallel lifecycle. Ensure iterator cancellation clears the attempt timer and propagates
user abort.

- [ ] **Step 6: Verify executor and lifecycle**

```bash
node --import tsx --test tests/native-llm-executor.test.ts tests/llm-lifecycle.test.ts tests/structured-output.test.ts
npx tsc --noEmit --pretty false
```

Expected: PASS; no delayed abort fires after success, cancellation, exhaustion, or early
iterator close.

- [ ] **Step 7: Commit**

```bash
git add src/native-llm-executor.ts src/types.ts src/llm-lifecycle.ts tests/native-llm-executor.test.ts tests/llm-lifecycle.test.ts
git commit -m "feat(llm): add request-scoped native retry executor"
```

### Task 25: Route Every Native Chat Completion Through the Executor

**Requirements:** R19, R20, R22

**Files:**
- Modify: `src/controller.ts` (construct retry-aware native client only)
- Create: `src/native-openai-client.ts` (Node-safe production client/transport factory)
- Modify: `src/agent-runner.ts` (disable native operation replay; retain Claude path)
- Modify: `src/phases/structured-output.ts`
- Modify: `src/phases/ingest-evidence.ts`
- Modify: `src/phases/ingest-synthesis.ts`
- Modify: `src/phases/query-answer.ts`
- Modify: `src/phases/chat.ts`
- Modify: `src/phases/format.ts`
- Modify: `src/phases/attachment-analyzer.ts`
- Modify: `src/mobile-llm-wrap.ts`
- Test: `tests/native-request-callsite-coverage.test.ts`
- Test: `tests/init-force-retry.test.ts`
- Test: existing phase lifecycle suites

- [ ] **Step 1: Write a failing static call-site coverage test**

Use the TypeScript AST, not a text search. Require every production completion call,
including `completions.create`, destructured aliases, bound methods, and wrappers, to occur
inside `native-llm-executor.ts` or an explicit adapter that supplies
`NativeRequestRetryContext`. Seed the test with the current 13 direct/wrapper sites and
make it fail if a raw OpenAI client escapes the controller/executor boundary. The test
lists every ungoverned file/line.

- [ ] **Step 2: Write failing backend-split watchdog tests**

Add fixtures proving native idle recovery retries only the current request and never
re-enters `runOperation`; Claude retains one guarded operation replay before destructive
or visible output.

```ts
assert.equal(nativeRunOperationCalls, 1);
assert.equal(nativeCompletionAttempts, 2);
assert.equal(claudeRunOperationCalls, 2);
```

- [ ] **Step 3: Write the Re-init exactly-once regression**

Inject first-synthesis HTTP 502 followed by success. Assert one `WipeDomain`, one source
read/evidence application, one page/index application, and two synthesis HTTP attempts.

- [ ] **Step 4: Run focused tests and confirm RED**

```bash
node --import tsx --test tests/native-request-callsite-coverage.test.ts tests/init-force-retry.test.ts tests/structured-output.test.ts
```

Expected: FAIL on direct calls and native operation replay.

- [ ] **Step 5: Integrate the executor at shared request boundaries**

Pass immutable request params plus `callSite`, human action, signal, retry limit, idle
timeout, and `onEvent`. Keep response-format fallback, structured repair, context repack,
and conflict regeneration outside the transport attempt loop. Keep OpenAI SDK
`maxRetries: 0`. Move `preparing/sent/waiting/producing/retrying/failed/cancelled`
ownership into the executor-driven supplied lifecycle controller and remove duplicate
transport-phase emissions from phase call sites. Phase owners retain only
`validating/applying/completed`.

Extract OpenAI client and Undici transport construction from the Obsidian-dependent
controller into `native-openai-client.ts`. Both the controller and Node live-eval script
must import this production factory; the module must not import `obsidian`.

This ownership move is backend-specific: the native executor emits native transport
phases, while the Claude adapter retains its existing lifecycle driver for the same shared
phase functions. Do not remove backend-neutral phase transitions until both adapters have
explicit owners. Add parity tests proving one lifecycle sequence per backend.

- [ ] **Step 6: Split native and Claude operation watchdog behavior**

For native, timeout closes the active request and propagates exhaustion; never `continue`
the outer `runOperation` loop. Preserve the existing destructive/visible-output guards and
operation replay only in the Claude branch.

- [ ] **Step 7: Verify all native operation families**

```bash
node --import tsx --test tests/native-request-callsite-coverage.test.ts tests/init-force-retry.test.ts tests/structured-output.test.ts tests/query-parity.test.ts tests/format-budget.test.ts tests/vision-budget.test.ts
node --import tsx --test tests/*.test.ts
npx tsc --noEmit --pretty false
```

Expected: all native call sites governed; structured/context budgets remain independent;
Claude behavior unchanged.

- [ ] **Step 8: Commit**

```bash
git add src/controller.ts src/native-openai-client.ts src/agent-runner.ts src/phases/structured-output.ts src/phases/ingest-evidence.ts src/phases/ingest-synthesis.ts src/phases/query-answer.ts src/phases/chat.ts src/phases/format.ts src/phases/attachment-analyzer.ts src/mobile-llm-wrap.ts tests/native-request-callsite-coverage.test.ts tests/init-force-retry.test.ts
git commit -m "feat(llm): route native calls through request retries"
```

### Task 26: Separate Connection and Model-Idle Settings

**Requirements:** R21, R22

**Files:**
- Modify: `src/types.ts` (top-level `llmConnectionTimeoutSec` default 15)
- Modify: `src/main.ts` (preserve existing top-level values)
- Modify: `src/proxy.ts` (direct/proxy connect timeout)
- Modify: `src/controller.ts` (native transport construction)
- Modify: `src/settings.ts`
- Modify: `src/i18n.ts`
- Test: `tests/native-openai-transport.test.ts`
- Modify: `tests/settings-model-controls.test.ts` (defaults, persisted round-trip, and UI)

- [ ] **Step 1: Write failing persistence and UI tests**

Prove old top-level `llmIdleRetries`/`llmIdleTimeoutSec` remain in place, missing
connection timeout becomes 15, saved idle 600 survives, native labels request retries,
Claude labels idle retries, and EN/RU/ES key shapes match.

- [ ] **Step 2: Write failing desktop transport tests**

Use local servers/sockets to prove DNS/TCP/TLS establishment receives the 15-second
connect policy while a healthy non-stream response delayed beyond 15 seconds is not
aborted. Verify direct `connectTimeout` and both ProxyAgent connector layers:
top-level `connectTimeout`, `proxyTls.timeout`, and `requestTls.timeout`. Include separate
stalled-proxy and stalled-target TLS fixtures. Mobile keeps its current transport path and
emits no false desktop guarantee.

- [ ] **Step 3: Run settings/transport tests and confirm RED**

```bash
node --import tsx --test tests/native-openai-transport.test.ts tests/settings-model-controls.test.ts
```

Expected: FAIL because one timeout currently controls headers/non-stream request duration.

- [ ] **Step 4: Add independent top-level settings**

Keep persisted keys at root:

```ts
llmConnectionTimeoutSec: 15,
llmIdleTimeoutSec: 300,
llmIdleRetries: 3,
```

Do not move old values under `nativeAgent`. Validate retries as integer `>= 0`,
connection timeout as integer `>= 1`, and idle timeout as `0` or integer from `1` through
`2_146_999` seconds. Define `MAX_SAFE_TIMER_MS = 2_147_000_000`; enabled idle uses its
deadline plus a 1,000 ms SDK margin, while idle `0` sets SDK timeout exactly to
`MAX_SAFE_TIMER_MS`.
Configure OpenAI SDK `timeout` above every enabled executor idle deadline. When idle is
`0`, use that explicit maximum safe timer instead of the SDK ten-minute default.
Add fake-timer fixtures for idle `0`, idle above 600 seconds, and executor deadline winning
when enabled. Reject values above the timer-safe maximum in load validation and Settings.

- [ ] **Step 5: Wire desktop connection establishment only**

Configure Undici direct/proxy connection establishment from
`llmConnectionTimeoutSec`. Do not use 15 seconds as headers/body/OpenAI whole-request
timeout. Direct uses `connectTimeout`; ProxyAgent configures `connectTimeout`,
`proxyTls.timeout`, and `requestTls.timeout`. The executor owns model idle. Keep the
Mobile limitation explicit in localized description and diagnostics.

- [ ] **Step 6: Verify settings, transport, types, and build**

```bash
node --import tsx --test tests/native-openai-transport.test.ts tests/settings-model-controls.test.ts
npx tsc --noEmit --pretty false
npm run build
```

Expected: defaults 3/15/300; saved 600 preserved; delayed healthy generation survives;
EN/RU/ES compile.

- [ ] **Step 7: Commit**

```bash
git add src/types.ts src/main.ts src/proxy.ts src/controller.ts src/settings.ts src/i18n.ts tests/native-openai-transport.test.ts tests/settings-model-controls.test.ts
git commit -m "feat(settings): separate connection and model idle timeouts"
```

### Task 27: Audit, Document, and Replay Transient Recovery

**Requirements:** R15, R19, R20, R21, R22

**Files:**
- Create: `scripts/eval-native-request-retry.ts`
- Create: `tests/eval-native-request-retry.test.ts`
- Create at live verification: `docs/superpowers/evals/native-request-retry-live.json`
- Modify: `scripts/audit-bounded-init-replay.ts`
- Modify: `tests/audit-bounded-init-replay.test.ts`
- Modify: `README.md`
- Modify: `docs/README.ru.md`
- Modify through iwiki MCP: `architecture/structured-output-runner`
- Modify through iwiki MCP: `architecture/llm-lifecycle`

- [ ] **Step 1: Write failing replay-auditor fixtures**

Add valid `502 -> scheduled -> replacement lifecycle -> recovered -> next step`, retry
exhaustion, retry after content, duplicate wipe, duplicate source/page application,
missing terminal diagnostic, and timeout-value mismatch fixtures.

- [ ] **Step 2: Run auditor tests and confirm RED**

```bash
node --import tsx --test tests/audit-bounded-init-replay.test.ts
```

Expected: FAIL because retry evidence and exactly-once recovery are not audited.

- [ ] **Step 3: Extend the read-only auditor**

Require attempt ordering, one lifecycle ID per attempt, approved status classification,
configured retry bound, exactly one wipe, no duplicate effects, and continuation after
recovery. Reject retry after meaningful output.

- [ ] **Step 4: Update repository docs and iwiki**

Document native-only request retry, status matrix, top-level global settings, 3/15/300
defaults, Claude unchanged behavior, Mobile connection-timeout limitation, sidebar human
states, and log-only diagnostics. Update iwiki only after runtime code exists, then run
`wiki_lint`.

- [ ] **Step 5: Write and test the metadata-only live eval script**

The script accepts `--base-url`, `--model`, `--api-key-file`, and `--out`. It sends one
small non-stream synthesis-shaped request through `/v1/chat/completions` with the
`reasoning/actions/skips` JSON schema, records no request body, response content, or
credential, and writes:

```json
{
  "endpointPath": "/v1/chat/completions",
  "model": "configured-model",
  "httpStatus": 200,
  "durationMs": 9000,
  "completed": true,
  "exceededConnectionTimeoutMs": false,
  "connectionTimeoutMs": 15000,
  "idleTimeoutMs": 300000,
  "transport": "direct",
  "attempts": 1,
  "retryEvents": [],
  "logicalRequestId": "eval-...",
  "lifecycleIds": ["eval-attempt-1"]
}
```

Tests use a local delayed server and assert the JSON contains no `apiKey`,
`authorization`, `messages`, `prompt`, or response content.
The script must import the production native client factory, production transport, retry
classifier, and `executeNativeLlmRequest`; it must not construct a bypass client or call
bare `fetch`. Evidence also records `attempts`, retry event kinds, connection/idle timeout
values, transport kind, `logicalRequestId`, and lifecycle IDs.

```bash
node --import tsx --test tests/eval-native-request-retry.test.ts
```

Expected: PASS; a local delayed response longer than 15 seconds produces metadata-only
evidence through the production factory and proves connection timeout does not cap body
duration.

- [ ] **Step 6: Run deterministic integration and live endpoint eval**

Run injected 502 fixtures first. Then send a non-destructive synthesis-like request to the
configured live endpoint and record status/duration without logging API keys or prompt
content. The deterministic local delayed-server test proves a healthy response longer
than 15 seconds completes; the live endpoint gate proves connectivity and schema handling
without imposing a minimum provider latency.

```bash
node --import tsx --test tests/native-request-retry.test.ts tests/native-llm-executor.test.ts tests/init-force-retry.test.ts tests/audit-bounded-init-replay.test.ts
node --import tsx scripts/eval-native-request-retry.ts --base-url https://homelab.ikeniborn.ru/v1 --model ollama-deepseek-v4-pro-cloud --api-key-file tmp/api.txt --out docs/superpowers/evals/native-request-retry-live.json
node -e "const e=require('./docs/superpowers/evals/native-request-retry-live.json'); if(!e.completed || e.httpStatus!==200 || e.connectionTimeoutMs!==15000) process.exit(1); console.log({httpStatus:e.httpStatus,durationMs:e.durationMs,completed:e.completed,attempts:e.attempts})"
```

Expected: injected retry recovers; non-retryable matrix fails closed; live request returns
normally; evidence contains metadata only and no request body, response content,
credential, or authorization header.

- [ ] **Step 7: Build and install the protected replay**

```bash
npm run build
: "${REPLAY_ROOT:?Set REPLAY_ROOT to the protected replay root created in Task 17 Step 4}"
RAW_REPLAY_ROOT=$REPLAY_ROOT
test ! -L "$RAW_REPLAY_ROOT"
test ! -L "$RAW_REPLAY_ROOT/run"
REPLAY_ROOT=$(realpath -e "$REPLAY_ROOT")
RUN_VAULT=$(realpath -e "$REPLAY_ROOT/run")
BEFORE_VAULT=$(realpath -e "$REPLAY_ROOT/before")
test -d "$RUN_VAULT/.obsidian/plugins/ai-wiki"
test -d "$BEFORE_VAULT/.obsidian"
test "$RUN_VAULT" = "$REPLAY_ROOT/run"
test "$BEFORE_VAULT" = "$REPLAY_ROOT/before"
case "$REPLAY_ROOT" in /tmp/ai-wiki-bounded-ingest-replay.*) ;; *) exit 1 ;; esac
MARKER="$REPLAY_ROOT/.replay-provenance"
test -f "$MARKER"
test -O "$MARKER"
grep -Fx "source=/home/ikeniborn/Documents/Project/notes/vaults/Work" "$MARKER"
grep -Fx "root=$REPLAY_ROOT" "$MARKER"
CREATED_EPOCH=$(sed -n 's/^created_epoch=//p' "$MARKER")
test "$CREATED_EPOCH" -le "$(date +%s)"
test "$CREATED_EPOCH" -ge "$(( $(date +%s) - 604800 ))"
cp dist/main.js dist/manifest.json dist/styles.css "$RUN_VAULT/.obsidian/plugins/ai-wiki/"
```

Restart Obsidian and run Re-init only in the protected replay vault.

- [ ] **Step 8: Audit live Re-init and final gates**

```bash
node --import tsx scripts/audit-bounded-init-replay.ts --vault "$RUN_VAULT" --session latest-init --expected-sources 22
node --import tsx --test tests/*.test.ts
npx tsc --noEmit --pretty false
npm run lint
npm run build
git diff --check
```

Expected: 22/22 sources; one wipe; no duplicate effects; any transient recovery remains
within the configured limit; zero retry after content; tests/build pass; lint has zero
errors; `wiki_lint` has no new broken/stale finding from changed sources.

- [ ] **Step 9: Commit documentation, eval evidence, and audit tooling**

```bash
git add scripts/audit-bounded-init-replay.ts scripts/eval-native-request-retry.ts tests/audit-bounded-init-replay.test.ts tests/eval-native-request-retry.test.ts docs/superpowers/evals/native-request-retry-live.json README.md docs/README.ru.md
git commit -m "docs(llm): document native transient request recovery"
```

- [ ] **Step 10: Run chain result reconciliation**

Invoke `$check-chain result docs/superpowers/plans/2026-07-16-bounded-ingest-model-controls-plan.md`.
Close `docs/TODO.md` only when R1-R22 and the protected replay produce verdict `OK`.

## Final Evidence Checklist

- [ ] Every R1-R22 row maps to passing test or replay evidence.
- [ ] Every prepared request estimate is within its effective input budget.
- [ ] No serialized vector/raw index record appears in captured prompts.
- [ ] Oversized source chunk and reducer packet coverage is complete.
- [ ] Existing-page untouched sections remain byte-stable.
- [ ] Failed Init sources remain resumable; successful sources hash once.
- [ ] Unchanged chunk embeddings produce zero embedding requests.
- [ ] Query/Chat, Lint, Format, and Vision preservation invariants pass.
- [ ] Native Vision Check succeeds/fails read-only; Claude exposes no Check.
- [ ] Every model-backed operation shows the full human lifecycle; reasoning stays expandable.
- [ ] Sidebar contains no call site, transport, attempt, budget, or provider diagnostics.
- [ ] Background structured calls are non-stream; Chat, Query answer, and Format remain SSE.
- [ ] Waiting timers do not extend the LLM watchdog.
- [ ] Full Re-init removes the prior domain tree, recreates fresh state, and wipes exactly once.
- [ ] Native transient failures retry only the current identical request; native operation replay is disabled.
- [ ] Claude retains its existing guarded operation-level idle retry and never uses the native executor.
- [ ] Retry stops after meaningful reasoning/content and after the configured additional-attempt limit.
- [ ] Existing top-level retry/idle values round-trip; missing settings resolve to 3/15/300.
- [ ] A healthy native generation longer than 15 seconds is not treated as a connection timeout.
- [ ] Retry scheduled/recovered/exhausted evidence is complete in `agent.jsonl` and technical details stay out of sidebar labels.
- [ ] Full tests, lint, build, diff check, safe replay audit, iwiki update, and `wiki_lint` pass.
