# Bounded Ingest and Model Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep every model request inside an explicit input budget while preserving complete source evidence, non-destructive wiki updates, reusable embeddings, and operation-specific response quality controls.

**Architecture:** A shared model-call policy resolves backend-specific input/output budgets and semantic compression. A conservative prompt governor packs complete context units and repacks on provider context errors. Ingest becomes a Markdown-aware evidence map/reduce pipeline whose synthesis emits complete creates or hash-guarded section patches; Query, Chat, Lint, Format, and Vision receive preservation-aware budget adapters. `index.jsonl` remains structured storage and never crosses a prompt boundary.

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
cp -a --reflink=auto /home/ikeniborn/Documents/Project/notes/vaults/Work "$REPLAY_ROOT/before"
cp -a --reflink=auto /home/ikeniborn/Documents/Project/notes/vaults/Work "$REPLAY_ROOT/run"
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

## Final Evidence Checklist

- [ ] Every R1-R16 row maps to passing test or replay evidence.
- [ ] Every prepared request estimate is within its effective input budget.
- [ ] No serialized vector/raw index record appears in captured prompts.
- [ ] Oversized source chunk and reducer packet coverage is complete.
- [ ] Existing-page untouched sections remain byte-stable.
- [ ] Failed Init sources remain resumable; successful sources hash once.
- [ ] Unchanged chunk embeddings produce zero embedding requests.
- [ ] Query/Chat, Lint, Format, and Vision preservation invariants pass.
- [ ] Native Vision Check succeeds/fails read-only; Claude exposes no Check.
- [ ] Full tests, lint, build, diff check, safe replay audit, iwiki update, and `wiki_lint` pass.
