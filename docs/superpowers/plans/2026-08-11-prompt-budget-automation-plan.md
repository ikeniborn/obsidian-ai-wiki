# Prompt Budget Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the byte-based, user-tuned prompt budget with a computed one — a per-script token estimator calibrated against the provider's reported usage, a lazily probed model context window, and a pure budget resolver — so Init and Ingest stop failing with `domain was not created`.

**Architecture:** Three new pure-ish modules (`token-estimate`, `model-context`, `budget-resolver`) feed `LlmCallOptions` through `model-call-policy`. Nothing below `LlmCallOptions` changes: the twelve consumers of `estimatePreparedMessages` keep the same signature. Two structural fixes remove the hard failure: the chunk budget is bound to the bootstrap payload budget, and an oversized bootstrap payload is split across calls and merged instead of erroring.

**Tech Stack:** TypeScript 5.4, ESM, `node --import tsx --test` (node:test + node:assert/strict), esbuild bundle, Obsidian plugin API, OpenAI SDK v6, undici.

## Global Constraints

Copied verbatim from the spec and intent; every task's requirements include this section.

- `SAFETY` = `0.9`. `defaultOutput` = `8192`. `BACKEND_DEFAULT` context = `16384` real tokens. Calibration window `N` = `8` samples. Probe timeout = `2000` ms. Calibration clamp = `[0.5, 3.0]`.
- Budget formulas are evaluated strictly in this order, so no value depends on one defined after it:
  ```
  outputBudget  = override.output ?? defaultOutput                                   (1)
  inputBudget   = override.input  ?? floor((contextWindow − outputBudget) × SAFETY)   (2)
  outputCeiling = contextWindow − estimatedInput                                     (3)
  payloadBudget = inputBudget − fixedPromptEstimate                                  (4)
  chunkBudget   = min(mapperRequestBudget, payloadBudget)                            (5)
  ```
- No operation may end with `configuration error` / `domain was not created` because of input size. The only acceptable size-related failure is a provider rejection after the repack loop is exhausted.
- No silent truncation. Nothing in this plan truncates content: splitting carries no data loss and the oversized-single-range case is removed structurally by Task 8.
- Source coverage completeness (`assertCompleteSourceCoverage`) stays a hard invariant.
- Migration never rewrites a user-chosen value. Only values exactly equal to the old defaults are cleared.
- Existing domains are NOT re-indexed automatically. The user re-runs `Init --force` manually.
- The `claude-agent` backend is not changed: no transport change, and the external CLI keeps owning the output limit.
- All technical numbers go to `agent.jsonl`, never into sidebar progress text.
- Documentation, code comments and commit messages are in English.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/token-estimate.ts` | Pure token estimation from message content. No I/O. |
| `src/model-context.ts` | What is known about a `(baseUrl, model)`: context window, its source, the calibration factor. Owns the probe and the persisted cache. |
| `src/budget-resolver.ts` | Pure arithmetic: a `ModelContextRecord` plus overrides becomes concrete budgets. |
| `tests/token-estimate.test.ts` | Estimator accuracy, the never-underestimate-by-15% invariant. |
| `tests/model-context.test.ts` | Probe chain, cache, calibration clamping. |
| `tests/budget-resolver.test.ts` | Formula order, overrides, ceiling > budget regression. |
| `docs/superpowers/evals/prompt-budget-automation-baseline.md` | Pre-change health-metric baseline. |

**Modified:**

| File | Change |
|---|---|
| `src/prompt-budget.ts` | `estimatePreparedMessages` becomes a wrapper over `estimateMessages`. |
| `src/markdown-chunks.ts` | `estimateTokens` delegates to `estimateText`. |
| `src/local-config.ts` | `LocalConfig` gains `modelContext` and `migrated_auto_budget`. |
| `src/types.ts` | Settings budgets become optional; three new `RunEvent` kinds; `prompt_budget` gains three fields. |
| `src/model-call-policy.ts` | Budgets come from `resolveBudget`, not from `positiveInt(..., DEFAULT_INPUT_BUDGET)`. |
| `src/phases/structured-output.ts` | Output ceiling from `outputCeilingTokens`; report usage back for calibration. |
| `src/phases/ingest-evidence.ts` | `boundBootstrapPayload` → `splitBootstrapPayload`. |
| `src/phases/init.ts` | Bind the chunk budget; merge K bootstrap entries; drop the size-based hard failure. |
| `src/settings.ts`, `src/i18n.ts` | Budget fields move to Advanced, empty means automatic. |
| `src/main.ts` | One-shot migration clearing default-valued budgets. |

---

### Task 1: Capture the health-metric baseline

The intent's health metrics say "no worse than before". Without a recorded pre-change number they are unverifiable. This task changes no product code.

**Files:**
- Create: `docs/superpowers/evals/prompt-budget-automation-baseline.md`
- Test: `tests/bounded-operations-acceptance.test.ts` (read only, temporarily instrumented)

**Interfaces:**
- Consumes: nothing.
- Produces: the file `docs/superpowers/evals/prompt-budget-automation-baseline.md`, read by Task 10.

- [ ] **Step 1: Confirm the tree is clean and on the feature branch**

Run:
```bash
git status --short && git rev-parse --abbrev-ref HEAD
```
Expected: no output from `git status --short`, and the branch is `dev-prompt-budget-automation`.

- [ ] **Step 2: Record the full suite result**

Run:
```bash
npm test 2>&1 | tail -20
```
Expected: a node:test summary. Record the exact `pass`, `fail` and `tests` numbers — they are the regression baseline for every later task.

- [ ] **Step 3: Record the LLM call count on the acceptance fixture**

`tests/bounded-operations-acceptance.test.ts:98` already pushes every request into `capturedRequests`. Add a temporary reporting line directly after that push:

```ts
  capturedRequests.push({ entryPoint, effectiveInputBudget, params: typed });
  if (process.env.BUDGET_BASELINE) console.error(`BASELINE_CALL ${entryPoint} ${effectiveInputBudget}`);
```

Run:
```bash
BUDGET_BASELINE=1 node --import tsx --test tests/bounded-operations-acceptance.test.ts 2>&1 | grep -c BASELINE_CALL
```
Expected: an integer — the number of LLM calls the acceptance fixture makes today.

- [ ] **Step 4: Record the same count for the bounded ingest fixture**

Run:
```bash
node --import tsx --test tests/ingest-bounded.test.ts 2>&1 | tail -12
```
Expected: a node:test summary. Record `pass` and `fail`.

- [ ] **Step 5: Revert the temporary instrumentation**

Run:
```bash
git checkout -- tests/bounded-operations-acceptance.test.ts && git status --short
```
Expected: no output.

- [ ] **Step 6: Write the baseline file**

Create `docs/superpowers/evals/prompt-budget-automation-baseline.md` with the numbers recorded above, substituting the real values for `<...>`:

```markdown
# Baseline: prompt-budget-automation

Captured on 2026-08-11 at commit <git rev-parse --short HEAD> before any change,
so the intent's health metrics are verifiable after the work.

## Full suite

- tests: <N>
- pass: <N>
- fail: <N>

## LLM calls per operation

- `bounded-operations-acceptance`: <N> calls
- `ingest-bounded`: pass <N>, fail <N>

## Meaning

The intent allows extra calls caused by splitting an unreachable payload, recorded in
`agent.jsonl`. Any other increase against these numbers is a regression.
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/evals/prompt-budget-automation-baseline.md
git commit -m "test: record prompt budget health-metric baseline"
```

---

### Task 2: Token estimator

**Files:**
- Create: `src/token-estimate.ts`
- Test: `tests/token-estimate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `estimateText(text: string): number`
  - `estimateMessages(messages: readonly OpenAI.Chat.ChatCompletionMessageParam[], calibration?: number): number`
  - `MEDIA_TOKENS: number` (4096, moved here from `prompt-budget.ts`)

Counting rules, fixed here so later tasks do not reinvent them: characters are classified by script (Cyrillic ÷2, CJK ×1, everything else ÷3.5); every message costs a flat 4 tokens for its role and separators; every `image_url` part costs `MEDIA_TOKENS` and its URL is not counted; all other string-valued fields of a message (`name`, `tool_calls[].function.arguments`, `tool_call_id`) are counted as text, which preserves the existing "metadata is counted" behaviour without the double-JSON inflation.

- [ ] **Step 1: Write the failing test**

Create `tests/token-estimate.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { estimateMessages, estimateText } from "../src/token-estimate";

test("Cyrillic costs more tokens per character than Latin", () => {
  assert.ok(estimateText("абвгдеёжзи") > estimateText("abcdefghij"));
});

test("estimate is within 15% of the provider count for a mixed prompt", () => {
  // Recorded from agent.jsonl: system 4181 chars + payload 2168 chars => 1809 real tokens.
  const system = "x".repeat(4181);
  const payload = "я".repeat(2168);
  const estimated = estimateMessages([
    { role: "system", content: system },
    { role: "user", content: payload },
  ]);
  const actual = 1809;
  assert.ok(estimated >= actual * 0.85, `underestimated: ${estimated} < ${actual * 0.85}`);
  assert.ok(estimated <= actual * 1.15, `overestimated: ${estimated} > ${actual * 1.15}`);
});

test("image parts cost a flat media allowance and ignore the URL length", () => {
  const short = estimateMessages([{ role: "user", content: [
    { type: "image_url", image_url: { url: "data:image/png;base64,a" } },
  ] }]);
  const long = estimateMessages([{ role: "user", content: [
    { type: "image_url", image_url: { url: `data:image/png;base64,${"a".repeat(50_000)}` } },
  ] }]);
  assert.equal(short, long);
  assert.ok(short >= 4096);
});

test("tool-call metadata is counted as text", () => {
  const bare = estimateMessages([{ role: "assistant", content: null }]);
  const withCall = estimateMessages([{
    role: "assistant",
    content: null,
    tool_calls: [{
      id: "call_1",
      type: "function",
      function: { name: "search", arguments: JSON.stringify({ query: "a".repeat(200) }) },
    }],
  }]);
  assert.ok(withCall > bare);
});

test("calibration scales the result", () => {
  const base = estimateMessages([{ role: "user", content: "abcdefgh" }]);
  const scaled = estimateMessages([{ role: "user", content: "abcdefgh" }], 2);
  assert.equal(scaled, base * 2);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/token-estimate.test.ts`
Expected: FAIL — `Cannot find module '../src/token-estimate'`.

- [ ] **Step 3: Write the implementation**

Create `src/token-estimate.ts`:

```ts
import type OpenAI from "openai";

/** A single image part costs this much regardless of its encoded length. */
export const MEDIA_TOKENS = 4_096;

/** Flat allowance per message for its role and the separators around it. */
const MESSAGE_OVERHEAD_TOKENS = 4;

const CHARS_PER_TOKEN_CYRILLIC = 2;
const CHARS_PER_TOKEN_DEFAULT = 3.5;

function isCyrillic(code: number): boolean {
  return (code >= 0x0400 && code <= 0x04ff) || (code >= 0x0500 && code <= 0x052f);
}

function isCjk(code: number): boolean {
  return (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xac00 && code <= 0xd7af);
}

/**
 * Approximate token count for a plain string.
 *
 * Deliberately biased upward: underestimating produces real provider
 * context-length errors, overestimating only wastes budget.
 */
export function estimateText(text: string): number {
  let cyrillic = 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isCyrillic(code)) cyrillic++;
    else if (isCjk(code)) cjk++;
    else other++;
  }
  return Math.ceil(cyrillic / CHARS_PER_TOKEN_CYRILLIC + cjk + other / CHARS_PER_TOKEN_DEFAULT);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Walks a message, summing text and counting image parts, without serializing anything. */
function estimateValue(value: unknown): number {
  if (typeof value === "string") return estimateText(value);
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + estimateValue(item), 0);
  if (!isRecord(value)) return 0;
  if (value.type === "image_url") return MEDIA_TOKENS;
  let total = 0;
  for (const item of Object.values(value)) total += estimateValue(item);
  return total;
}

export function estimateMessages(
  messages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
  calibration = 1,
): number {
  let total = 0;
  for (const message of messages) {
    total += MESSAGE_OVERHEAD_TOKENS + estimateValue(message);
  }
  return Math.ceil(total * calibration);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/token-estimate.test.ts`
Expected: PASS, 5 tests.

If the 15% test fails, adjust `CHARS_PER_TOKEN_DEFAULT` and `CHARS_PER_TOKEN_CYRILLIC` — never the assertion. The assertion is the intent's health metric.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/token-estimate.ts tests/token-estimate.test.ts
git commit -m "feat: add per-script token estimator"
```

---

### Task 3: Route the existing estimators through the new one

This is where the ×3.6–4.1 overshoot disappears. Existing tests that assert absolute sizes will move; they are rescaled here, not silently deleted.

**Files:**
- Modify: `src/prompt-budget.ts:9`, `src/prompt-budget.ts:75-81`
- Modify: `src/markdown-chunks.ts:186`
- Test: `tests/prompt-budget.test.ts`, and any suite that fails in Step 4

**Interfaces:**
- Consumes: `estimateText`, `estimateMessages`, `MEDIA_TOKENS` from Task 2.
- Produces: `estimatePreparedMessages(messages)` with an unchanged signature but a token-accurate result. Twelve call sites are untouched.

- [ ] **Step 1: Rewrite the estimator body**

In `src/prompt-budget.ts`, delete `const MEDIA_TOKENS = 4_096;` (line 9), the `SanitizedValue` interface, `sanitizeMedia`, and the body of `estimatePreparedMessages`. Add the import and the wrapper:

```ts
import { MEDIA_TOKENS, estimateMessages } from "./token-estimate";

export { MEDIA_TOKENS };

export function estimatePreparedMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
): number {
  return estimateMessages(messages);
}
```

Keep `isRecord` — `classifyContextError` still uses it.

- [ ] **Step 2: Route the chunk estimator**

In `src/markdown-chunks.ts:186`, replace the byte count:

```ts
import { estimateText } from "./token-estimate";

function estimateTokens(markdown: string): number {
  return estimateText(markdown);
}
```

- [ ] **Step 3: Run the full suite and collect the damage**

Run: `npm test 2>&1 | tail -40`
Expected: FAIL. The failures are the tests that assert absolute sizes at a given budget, because a budget of 20 000 now means 20 000 tokens instead of 20 000 bytes.

- [ ] **Step 4: Rescale each failing assertion**

For every failure, apply exactly one of these, in this order of preference:

1. If the test asserts a **relationship** ("required units packed, optional omitted", "coverage is complete"), it should already pass. If it does not, that is a real regression — stop and fix the code, not the test.
2. If the test asserts an **absolute count** (number of chunks, number of calls), rewrite the assertion as a relationship against a value computed from the same estimator, for example `assert.ok(chunks.every((c) => estimateText(c.text) <= budget))`.
3. Only if neither is possible, divide the test's budget constant by 3.5 and round down, and add a comment naming this task so the next reader knows why the constant is what it is.

Never tune a constant until the assertion goes green without understanding which of the three cases applies.

- [ ] **Step 5: Verify against the baseline**

Run: `npm test 2>&1 | tail -20`
Expected: `pass` and `fail` equal to the numbers recorded in `docs/superpowers/evals/prompt-budget-automation-baseline.md`.

- [ ] **Step 6: Commit**

```bash
git add src/prompt-budget.ts src/markdown-chunks.ts tests/
git commit -m "fix: measure prompt budgets in tokens instead of serialized bytes"
```

---

### Task 4: Model context store

**Files:**
- Create: `src/model-context.ts`
- Modify: `src/local-config.ts:4-16`
- Test: `tests/model-context.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `interface ModelContextRecord { contextWindow: number; source: "discovered" | "learned" | "default"; calibration: number; samples: number }`
  - `BACKEND_DEFAULT_CONTEXT = 16_384`
  - `PROBE_TIMEOUT_MS = 2_000`
  - `class ModelContextStore` with `get`, `resolve`, `observeUsage`, `observeContextError`
  - `probeContextWindow(fetchFn, baseUrl, apiKey, model, timeoutMs): Promise<number | null>`

- [ ] **Step 1: Extend the local config shape**

In `src/local-config.ts`, add two fields to `LocalConfig` after `lastDomain`:

```ts
  lastDomain?: string;
  migrated_auto_budget?: boolean;
  /** Keyed by `${baseUrl}::${model}`. */
  modelContext?: Record<string, {
    contextWindow: number;
    source: "discovered" | "learned" | "default";
    calibration: number;
    samples: number;
  }>;
```

- [ ] **Step 2: Write the failing test**

Create `tests/model-context.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  BACKEND_DEFAULT_CONTEXT,
  ModelContextStore,
  probeContextWindow,
} from "../src/model-context";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

test("probe reads context_length from /v1/models", async () => {
  const fetchFn = async (input: string | URL | Request) => {
    assert.ok(String(input).endsWith("/models"));
    return jsonResponse({ data: [{ id: "m1", context_length: 131072 }] });
  };
  assert.equal(await probeContextWindow(fetchFn as typeof fetch, "http://x/v1", "", "m1", 2000), 131072);
});

test("probe falls through to /api/show when /v1/models has no context length", async () => {
  const fetchFn = async (input: string | URL | Request) => {
    if (String(input).endsWith("/models")) return jsonResponse({ data: [{ id: "m1" }] });
    return jsonResponse({ model_info: { "llama.context_length": 32768 } });
  };
  assert.equal(await probeContextWindow(fetchFn as typeof fetch, "http://x/v1", "", "m1", 2000), 32768);
});

test("probe rejects implausible values", async () => {
  const fetchFn = async () => jsonResponse({ data: [{ id: "m1", context_length: 12 }] });
  assert.equal(await probeContextWindow(fetchFn as typeof fetch, "http://x/v1", "", "m1", 2000), null);
});

test("probe returns null when every endpoint throws", async () => {
  const fetchFn = async () => { throw new Error("offline"); };
  assert.equal(await probeContextWindow(fetchFn as typeof fetch, "http://x/v1", "", "m1", 2000), null);
});

test("resolve falls back to the backend default and caches it", async () => {
  const saved: Record<string, unknown>[] = [];
  const store = new ModelContextStore({
    read: async () => ({}),
    write: async (next) => { saved.push(next); },
    fetchFn: (async () => { throw new Error("offline"); }) as typeof fetch,
  });
  const record = await store.resolve("http://x/v1", "m1", "");
  assert.equal(record.contextWindow, BACKEND_DEFAULT_CONTEXT);
  assert.equal(record.source, "default");
  assert.equal(saved.length, 1);
});

test("a context error shrinks the window and marks it learned", async () => {
  const store = new ModelContextStore({
    read: async () => ({ "http://x/v1::m1": { contextWindow: 131072, source: "discovered", calibration: 1, samples: 0 } }),
    write: async () => {},
    fetchFn: (async () => { throw new Error("unused"); }) as typeof fetch,
  });
  await store.resolve("http://x/v1", "m1", "");
  store.observeContextError("http://x/v1", "m1", 8192);
  const record = store.get("http://x/v1", "m1")!;
  assert.equal(record.contextWindow, 8192);
  assert.equal(record.source, "learned");
});

test("calibration is a moving average clamped to [0.5, 3]", async () => {
  const store = new ModelContextStore({
    read: async () => ({}),
    write: async () => {},
    fetchFn: (async () => { throw new Error("offline"); }) as typeof fetch,
  });
  await store.resolve("http://x/v1", "m1", "");
  store.observeUsage("http://x/v1", "m1", 1000, 2000);   // ratio 2.0, accepted
  assert.ok(store.get("http://x/v1", "m1")!.calibration > 1);
  store.observeUsage("http://x/v1", "m1", 1000, 100000); // ratio 100, discarded
  assert.ok(store.get("http://x/v1", "m1")!.calibration <= 3);
  assert.equal(store.get("http://x/v1", "m1")!.samples, 1);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --import tsx --test tests/model-context.test.ts`
Expected: FAIL — `Cannot find module '../src/model-context'`.

- [ ] **Step 4: Write the implementation**

Create `src/model-context.ts`:

```ts
export const BACKEND_DEFAULT_CONTEXT = 16_384;
export const PROBE_TIMEOUT_MS = 2_000;

const MIN_PLAUSIBLE_CONTEXT = 1_024;
const MAX_PLAUSIBLE_CONTEXT = 2_000_000;
const CALIBRATION_WINDOW = 8;
const CALIBRATION_MIN = 0.5;
const CALIBRATION_MAX = 3;

export interface ModelContextRecord {
  contextWindow: number;
  source: "discovered" | "learned" | "default";
  calibration: number;
  samples: number;
}

export type ModelContextMap = Record<string, ModelContextRecord>;

export interface ModelContextStoreDeps {
  read: () => Promise<ModelContextMap>;
  write: (next: ModelContextMap) => Promise<void>;
  fetchFn: typeof fetch;
}

function cacheKey(baseUrl: string, model: string): string {
  return `${baseUrl}::${model}`;
}

function plausible(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (value < MIN_PLAUSIBLE_CONTEXT || value > MAX_PLAUSIBLE_CONTEXT) return null;
  return value;
}

/** Finds the first plausible integer under any key whose name ends in `context_length`. */
function findContextLength(value: unknown): number | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findContextLength(item);
      if (found !== null) return found;
    }
    return null;
  }
  if (value === null || typeof value !== "object") return null;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (key.endsWith("context_length") || key === "max_context_length" || key === "n_ctx") {
      const direct = plausible(item);
      if (direct !== null) return direct;
    }
    const nested = findContextLength(item);
    if (nested !== null) return nested;
  }
  return null;
}

async function getJson(
  fetchFn: typeof fetch,
  url: string,
  apiKey: string,
  timeoutMs: number,
  body?: unknown,
): Promise<unknown | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, {
      method: body === undefined ? "GET" : "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort. Returns null when nothing reports a plausible context window. */
export async function probeContextWindow(
  fetchFn: typeof fetch,
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<number | null> {
  const root = baseUrl.replace(/\/+$/, "");
  const models = await getJson(fetchFn, `${root}/models`, apiKey, timeoutMs);
  const fromModels = models === null ? null : findContextLength(models);
  if (fromModels !== null) return fromModels;

  const ollamaRoot = root.replace(/\/v1$/, "");
  const show = await getJson(fetchFn, `${ollamaRoot}/api/show`, apiKey, timeoutMs, { model });
  return show === null ? null : findContextLength(show);
}

export class ModelContextStore {
  private cache: ModelContextMap | null = null;

  constructor(private deps: ModelContextStoreDeps) {}

  get(baseUrl: string, model: string): ModelContextRecord | undefined {
    return this.cache?.[cacheKey(baseUrl, model)];
  }

  async resolve(baseUrl: string, model: string, apiKey: string): Promise<ModelContextRecord> {
    if (this.cache === null) this.cache = await this.deps.read();
    const key = cacheKey(baseUrl, model);
    const cached = this.cache[key];
    if (cached) return cached;

    const probed = await probeContextWindow(this.deps.fetchFn, baseUrl, apiKey, model);
    const record: ModelContextRecord = {
      contextWindow: probed ?? BACKEND_DEFAULT_CONTEXT,
      source: probed === null ? "default" : "discovered",
      calibration: 1,
      samples: 0,
    };
    this.cache[key] = record;
    await this.deps.write(this.cache);
    return record;
  }

  observeUsage(baseUrl: string, model: string, estimated: number, actual: number): void {
    const record = this.get(baseUrl, model);
    if (!record || estimated <= 0 || actual <= 0) return;
    const ratio = actual / estimated;
    if (ratio < CALIBRATION_MIN || ratio > CALIBRATION_MAX) return;
    const weight = Math.min(record.samples, CALIBRATION_WINDOW - 1);
    record.calibration = (record.calibration * weight + ratio) / (weight + 1);
    record.samples = Math.min(record.samples + 1, CALIBRATION_WINDOW);
    void this.persist();
  }

  observeContextError(baseUrl: string, model: string, maxContextTokens?: number): void {
    const record = this.get(baseUrl, model);
    if (!record) return;
    const next = plausible(maxContextTokens) ?? Math.floor(record.contextWindow * 0.75);
    if (next >= record.contextWindow) return;
    record.contextWindow = Math.max(MIN_PLAUSIBLE_CONTEXT, next);
    record.source = "learned";
    void this.persist();
  }

  private async persist(): Promise<void> {
    if (this.cache) await this.deps.write(this.cache);
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test tests/model-context.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Typecheck, lint, full suite**

Run: `npm run typecheck && npm run lint && npm test 2>&1 | tail -6`
Expected: no errors; `pass`/`fail` match the baseline.

- [ ] **Step 7: Commit**

```bash
git add src/model-context.ts src/local-config.ts tests/model-context.test.ts
git commit -m "feat: discover and cache the model context window"
```

---

### Task 5: Budget resolver

**Files:**
- Create: `src/budget-resolver.ts`
- Test: `tests/budget-resolver.test.ts`

**Interfaces:**
- Consumes: `ModelContextRecord` from Task 4.
- Produces:
  - `interface ResolvedBudget { inputBudgetTokens: number; outputBudgetTokens: number; outputCeilingTokens: number; contextWindow: number; source: "override" | "discovered" | "learned" | "default"; calibration: number }`
  - `resolveBudget(record: ModelContextRecord, overrides: { input?: number; output?: number }): ResolvedBudget`
  - `outputCeiling(record: ModelContextRecord, estimatedInput: number): number`
  - `SAFETY = 0.9`, `DEFAULT_OUTPUT = 8_192`

- [ ] **Step 1: Write the failing test**

Create `tests/budget-resolver.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelContextRecord } from "../src/model-context";
import { DEFAULT_OUTPUT, outputCeiling, resolveBudget } from "../src/budget-resolver";

const record = (over: Partial<ModelContextRecord> = {}): ModelContextRecord => ({
  contextWindow: 131_072,
  source: "discovered",
  calibration: 1,
  samples: 0,
  ...over,
});

test("input budget is the context minus the output reserve, times the safety factor", () => {
  const budget = resolveBudget(record(), {});
  assert.equal(budget.outputBudgetTokens, DEFAULT_OUTPUT);
  assert.equal(budget.inputBudgetTokens, Math.floor((131_072 - DEFAULT_OUTPUT) * 0.9));
});

test("a 128k model yields at least 16k input tokens", () => {
  assert.ok(resolveBudget(record(), {}).inputBudgetTokens >= 16_384);
});

test("an override wins and marks the source", () => {
  const budget = resolveBudget(record(), { input: 24_000, output: 2_048 });
  assert.equal(budget.inputBudgetTokens, 24_000);
  assert.equal(budget.outputBudgetTokens, 2_048);
  assert.equal(budget.source, "override");
});

test("an override larger than the context window is clamped", () => {
  const budget = resolveBudget(record({ contextWindow: 8_192 }), { input: 999_999 });
  assert.ok(budget.inputBudgetTokens <= 8_192);
});

test("the output ceiling exceeds the output budget, so a retry can grow", () => {
  const budget = resolveBudget(record(), {});
  const ceiling = outputCeiling(record(), 20_000);
  assert.ok(
    ceiling > budget.outputBudgetTokens,
    "regression: the ceiling must not equal the budget it is meant to raise",
  );
});

test("the fallback default still leaves a usable input budget", () => {
  const budget = resolveBudget(record({ contextWindow: 16_384, source: "default" }), {});
  assert.ok(budget.inputBudgetTokens > 0);
  assert.equal(budget.source, "default");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --import tsx --test tests/budget-resolver.test.ts`
Expected: FAIL — `Cannot find module '../src/budget-resolver'`.

- [ ] **Step 3: Write the implementation**

Create `src/budget-resolver.ts`:

```ts
import type { ModelContextRecord } from "./model-context";

export const SAFETY = 0.9;
export const DEFAULT_OUTPUT = 8_192;

export interface ResolvedBudget {
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  outputCeilingTokens: number;
  contextWindow: number;
  source: "override" | "discovered" | "learned" | "default";
  calibration: number;
}

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * The formulas are evaluated in a fixed order so no value depends on one
 * defined after it: output first, then input, then the per-request ceiling.
 */
export function resolveBudget(
  record: ModelContextRecord,
  overrides: { input?: number; output?: number },
): ResolvedBudget {
  const outputOverride = positive(overrides.output);
  const inputOverride = positive(overrides.input);

  const outputBudgetTokens = Math.min(
    outputOverride ?? DEFAULT_OUTPUT,
    Math.max(1, record.contextWindow - 1),
  );
  const derivedInput = Math.floor((record.contextWindow - outputBudgetTokens) * SAFETY);
  const inputBudgetTokens = Math.max(
    1,
    Math.min(inputOverride ?? derivedInput, record.contextWindow),
  );

  return {
    inputBudgetTokens,
    outputBudgetTokens,
    outputCeilingTokens: outputCeiling(record, inputBudgetTokens),
    contextWindow: record.contextWindow,
    source: inputOverride !== undefined || outputOverride !== undefined ? "override" : record.source,
    calibration: record.calibration,
  };
}

/** Computed per request, after the prompt is packed, so a retry has room to grow. */
export function outputCeiling(record: ModelContextRecord, estimatedInput: number): number {
  return Math.max(1, record.contextWindow - Math.max(0, estimatedInput));
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --import tsx --test tests/budget-resolver.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/budget-resolver.ts tests/budget-resolver.test.ts
git commit -m "feat: derive input and output budgets from the model context window"
```

---

### Task 6: Diagnostic events

The three new events must exist before the wiring tasks emit them.

**Files:**
- Modify: `src/types.ts:325-338` (the `prompt_budget` member of `RunEvent`)
- Test: `tests/prompt-budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: three `RunEvent` members — `budget_resolved`, `context_probe`, `calibration_sample` — plus three optional fields on `prompt_budget`.

- [ ] **Step 1: Extend `prompt_budget`**

In `src/types.ts`, add three optional fields to the `prompt_budget` member, after `retryReason?: string;`:

```ts
      retryReason?: string;
      contextWindow?: number;
      budgetSource?: "override" | "discovered" | "learned" | "default";
      calibration?: number;
    }
```

- [ ] **Step 2: Add the three new members**

In the same `RunEvent` union, directly after the `prompt_budget` member:

```ts
  | {
      kind: "budget_resolved";
      model: string;
      contextWindow: number;
      source: "override" | "discovered" | "learned" | "default";
      calibration: number;
      samples: number;
      inputBudget: number;
      outputBudget: number;
      outputCeiling: number;
      override: boolean;
    }
  | {
      kind: "context_probe";
      baseUrl: string;
      model: string;
      endpoint: string;
      ok: boolean;
      ms: number;
      contextLength?: number;
    }
  | {
      kind: "calibration_sample";
      model: string;
      estimated: number;
      actual: number;
      ratio: number;
      applied: boolean;
      clamped: boolean;
    }
```

- [ ] **Step 3: Extend the prompt-budget event builder**

In `src/prompt-budget.ts`, add the three fields to `PromptBudgetMetadata` and copy them in `createPromptBudgetEvent` alongside the existing optional copies:

```ts
  contextWindow?: number;
  budgetSource?: "override" | "discovered" | "learned" | "default";
  calibration?: number;
```

```ts
  if (metadata.contextWindow !== undefined) event.contextWindow = metadata.contextWindow;
  if (metadata.budgetSource !== undefined) event.budgetSource = metadata.budgetSource;
  if (metadata.calibration !== undefined) event.calibration = metadata.calibration;
```

- [ ] **Step 4: Write the test**

Append to `tests/prompt-budget.test.ts`:

```ts
test("budget metadata carries the context window and its source", () => {
  const event = createPromptBudgetEvent({
    requestId: "r1",
    callSite: "init.bootstrap",
    configuredInputBudget: 100,
    effectiveInputBudget: 100,
    estimatedInputTokens: 50,
    contextUnits: 1,
    contextWindow: 131072,
    budgetSource: "discovered",
    calibration: 1.1,
  });
  assert.equal(event.contextWindow, 131072);
  assert.equal(event.budgetSource, "discovered");
  assert.equal(event.calibration, 1.1);
});
```

- [ ] **Step 5: Run the test and typecheck**

Run: `node --import tsx --test tests/prompt-budget.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/types.ts src/prompt-budget.ts tests/prompt-budget.test.ts
git commit -m "feat: add budget resolution diagnostics to the run event stream"
```

---

### Task 7: Wire the resolver into the call policy

**Files:**
- Modify: `src/model-call-policy.ts:11-12`, `src/model-call-policy.ts:123-159`, `src/model-call-policy.ts:174-242`
- Modify: `src/types.ts` (settings budget fields become optional)
- Test: `tests/model-call-policy.test.ts`

**Interfaces:**
- Consumes: `ModelContextStore`, `ModelContextRecord` (Task 4); `resolveBudget`, `ResolvedBudget` (Task 5).
- Produces: `resolveModelCallPolicy(settings, operation, record, parent?)` — the same return shape as today (`{ model, policy, opts }`), with a `ModelContextRecord` added as the third positional parameter. Every caller must pass a record obtained from `ModelContextStore.resolve`.

- [ ] **Step 1: Make the settings budgets optional**

In `src/types.ts`, change `inputBudgetTokens: number` to `inputBudgetTokens?: number` in the claude-agent and native-agent settings interfaces and in their per-operation shapes (lines 656, 662, 692, 703). Delete the `inputBudgetTokens: 16384` literals from the defaults at lines 832, 837-841, 848, 856-860, and delete `repairInputBudgetTokens: 65536` at line 849. Leave `maxTokens` defaults in place: they remain a meaningful user-visible output preference.

- [ ] **Step 2: Stop inventing budgets during normalization**

In `src/model-call-policy.ts`, delete `DEFAULT_INPUT_BUDGET` and `DEFAULT_REPAIR_INPUT_BUDGET` and rewrite the budget half of `normalizePersistedModelControls` so an absent value stays absent:

```ts
function optionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const floored = Math.floor(value);
  return floored >= 1 ? floored : undefined;
}

export function normalizePersistedModelControls(settings: LlmWikiPluginSettings): void {
  settings.nativeAgent.inputBudgetTokens = optionalPositiveInt(settings.nativeAgent.inputBudgetTokens);
  settings.nativeAgent.repairInputBudgetTokens = optionalPositiveInt(settings.nativeAgent.repairInputBudgetTokens);
  settings.claudeAgent.inputBudgetTokens = optionalPositiveInt(settings.claudeAgent.inputBudgetTokens);
  // compression normalization below is unchanged
```

Apply the same change to the per-operation loop: `native.inputBudgetTokens = optionalPositiveInt(native.inputBudgetTokens);` and the claude equivalent.

- [ ] **Step 3: Take the record as a parameter and resolve through it**

Rewrite the native branch of `resolveModelCallPolicy` (the `claude-agent` branch keeps its current shape, only reading the optional override):

```ts
export function resolveModelCallPolicy(
  settings: LlmWikiPluginSettings,
  operation: WikiOperation,
  record: ModelContextRecord,
  parent?: OpKey,
): { model: string; policy: ModelCallPolicy; opts: LlmCallOptions } {
  const key = policyKey(operation, parent);
  const global = settings.backend === "claude-agent" ? settings.claudeAgent : settings.nativeAgent;
  const local = global.perOperation ? global.operations[key] : undefined;
  const budget = resolveBudget(record, {
    input: local?.inputBudgetTokens ?? global.inputBudgetTokens,
    output: settings.backend === "claude-agent"
      ? undefined
      : (local as { maxTokens?: number } | undefined)?.maxTokens
        ?? (global as { maxTokens?: number }).maxTokens,
  });
  // compression resolution is unchanged
  const policy: ModelCallPolicy = {
    inputBudgetTokens: budget.inputBudgetTokens,
    outputBudgetTokens: budget.outputBudgetTokens,
    outputRetryBudgetTokens: budget.outputCeilingTokens,
    ...(compression ? { compression } : {}),
  };
  ...
}
```

`repairInputBudgetTokens` keeps its meaning but is now derived: for `init` and `ingest` it is `budget.inputBudgetTokens` when no override is set, because the input budget is already the whole usable context.

- [ ] **Step 4: Update every caller**

Run:
```bash
grep -rn "resolveModelCallPolicy(" src/ | grep -v "export function"
```
Expected: a list of call sites. At each one, obtain the record first:

```ts
const record = await this.modelContextStore.resolve(
  settings.nativeAgent.baseUrl,
  settings.nativeAgent.model,
  apiKey,
);
const { model, policy, opts } = resolveModelCallPolicy(settings, operation, record);
```

Emit `budget_resolved` immediately after resolving, with the fields from Task 6.

- [ ] **Step 5: Add the policy tests**

Append to `tests/model-call-policy.test.ts`:

```ts
test("an absent budget setting yields a context-derived budget, not 16384", () => {
  const settings = defaultSettings();
  delete (settings.nativeAgent as { inputBudgetTokens?: number }).inputBudgetTokens;
  const record = { contextWindow: 131_072, source: "discovered" as const, calibration: 1, samples: 0 };
  const { policy } = resolveModelCallPolicy(settings, "init", record);
  assert.ok(policy.inputBudgetTokens > 16_384);
});

test("a stored budget still acts as an explicit override", () => {
  const settings = defaultSettings();
  settings.nativeAgent.inputBudgetTokens = 24_000;
  const record = { contextWindow: 131_072, source: "discovered" as const, calibration: 1, samples: 0 };
  const { policy } = resolveModelCallPolicy(settings, "init", record);
  assert.equal(policy.inputBudgetTokens, 24_000);
});

test("the output retry ceiling is larger than the output budget", () => {
  const settings = defaultSettings();
  const record = { contextWindow: 131_072, source: "discovered" as const, calibration: 1, samples: 0 };
  const { policy } = resolveModelCallPolicy(settings, "init", record);
  assert.ok((policy.outputRetryBudgetTokens ?? 0) > (policy.outputBudgetTokens ?? 0));
});
```

Reuse the file's existing settings factory; if it has none, build one from `DEFAULT_SETTINGS` in `src/types.ts`.

- [ ] **Step 6: Run the suite**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: `pass`/`fail` match the baseline plus the three new tests.

- [ ] **Step 7: Commit**

```bash
git add src/model-call-policy.ts src/types.ts tests/model-call-policy.test.ts
git commit -m "feat: resolve call budgets from the model context instead of settings"
```

---

### Task 8: Bind the chunk budget and split the bootstrap payload

This is the task that removes the hard failure. It has two halves that must land together: the chunk budget binding makes the split sufficient, and the split makes the bounder unnecessary.

**Files:**
- Modify: `src/phases/ingest-evidence.ts:139-172` (replace `boundBootstrapPayload`), `src/phases/ingest-evidence.ts:983`, `src/phases/ingest-evidence.ts:1862-1899`
- Modify: `src/phases/init.ts:237-296`
- Test: `tests/ingest-evidence.test.ts`, `tests/init-bootstrap-fail-loud.test.ts`

**Interfaces:**
- Consumes: `estimateMessages` (Task 2) through the existing `estimateBootstrapPayload`.
- Produces:
  - `splitBootstrapPayload(value: BootstrapEvidence, budget: number): BootstrapEvidence[]`
  - `mergeBootstrapEntries(entries: DomainEntry[]): DomainEntry` (exported from `src/phases/init.ts`)
  - `EvidencePolicy` gains `chunkBudgetTokens?: number`.

- [ ] **Step 1: Write the failing split test**

Append to `tests/ingest-evidence.test.ts`:

```ts
test("an oversized bootstrap payload splits into groups instead of throwing", () => {
  const candidate = (key: string) => ({
    entityKey: key,
    packetIds: [`${key}-p`],
    facts: [`fact about ${key}`.repeat(20)],
    exactSource: [{ startLine: 1, endLine: 2, text: `source for ${key}`.repeat(20) }],
  });
  const payload = {
    candidates: [candidate("a"), candidate("b"), candidate("c")],
    domainThemes: ["theme"],
    languageEvidence: ["evidence"],
  };
  const whole = estimateBootstrapPayloadForTest(payload);
  const groups = splitBootstrapPayload(payload, Math.ceil(whole / 2));
  assert.ok(groups.length >= 2);
  assert.equal(
    groups.flatMap((g) => g.candidates.map((c) => c.entityKey)).join(","),
    "a,b,c",
    "no candidate may be dropped and the order must be preserved",
  );
  for (const group of groups) {
    assert.ok(group.domainThemes.length > 0, "themes are duplicated into every group");
  }
});

test("a payload that fits is returned as a single group", () => {
  const payload = { candidates: [], domainThemes: [], languageEvidence: [] };
  assert.equal(splitBootstrapPayload(payload, 1_000_000).length, 1);
});

test("no single evidence range can exceed the payload budget", async () => {
  // This is what makes splitting sufficient: a one-candidate group is always
  // divisible-enough because its text is bounded by the chunk that produced it,
  // and the chunk is bounded by the same payload budget.
  const payloadBudget = 2_000;
  const source = Array.from({ length: 400 }, (_, i) => `## Heading ${i}\n${"текст ".repeat(40)}`).join("\n");
  const chunks = chunkMarkdownSource(source, {
    maxEstimatedTokens: payloadBudget,
    overlapLines: 0,
  });
  for (const chunk of chunks) {
    assert.ok(
      estimateText(chunk.text) <= payloadBudget,
      `chunk ${chunk.id} needs ${estimateText(chunk.text)} tokens, budget is ${payloadBudget}`,
    );
  }
});
```

Import `chunkMarkdownSource` from `../src/markdown-chunks` and `estimateText` from
`../src/token-estimate` at the top of the file.

Export `estimateBootstrapPayload` from `src/phases/ingest-evidence.ts` as `estimateBootstrapPayloadForTest` alongside its internal use, so the test can compute the same number the implementation uses.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/ingest-evidence.test.ts`
Expected: FAIL — `splitBootstrapPayload is not exported`.

- [ ] **Step 3: Replace the bounder with the splitter**

In `src/phases/ingest-evidence.ts`, delete `boundBootstrapPayload` (lines 139-172) and add:

```ts
export { estimateBootstrapPayload as estimateBootstrapPayloadForTest };

/**
 * Splits candidates across groups so each group fits the budget. Themes and
 * language evidence are small and needed for language inference, so they are
 * duplicated into every group. Nothing is discarded and order is preserved.
 */
export function splitBootstrapPayload(
  value: BootstrapEvidence,
  budget: number,
): BootstrapEvidence[] {
  if (estimateBootstrapPayload(value) <= budget) return [value];

  const groups: BootstrapEvidence[] = [];
  let current: BootstrapEvidence = {
    candidates: [],
    domainThemes: [...value.domainThemes],
    languageEvidence: [...value.languageEvidence],
  };
  for (const candidate of value.candidates) {
    const attempt: BootstrapEvidence = { ...current, candidates: [...current.candidates, candidate] };
    if (current.candidates.length > 0 && estimateBootstrapPayload(attempt) > budget) {
      groups.push(current);
      current = {
        candidates: [candidate],
        domainThemes: [...value.domainThemes],
        languageEvidence: [...value.languageEvidence],
      };
      continue;
    }
    current = attempt;
  }
  groups.push(current);
  return groups;
}
```

- [ ] **Step 4: Return groups from the bundle builder**

In `prepareBootstrapEvidenceBundle` (around line 1885), replace the bound-and-throw block:

```ts
  const payloadBudget = Math.min(
    policy.inputBudgetTokens,
    policy.bootstrapPayloadBudgetTokens ?? policy.inputBudgetTokens,
  );
  if (!Number.isSafeInteger(payloadBudget) || payloadBudget <= 0) {
    throw new EvidenceCoverageError("Bootstrap payload budget must be a positive safe integer");
  }
  const groups = splitBootstrapPayload({ candidates, domainThemes, languageEvidence }, payloadBudget);
  for (const group of groups) {
    if (group.candidates.length === 1 && estimateBootstrapPayload(group) > payloadBudget) {
      throw new EvidenceCoverageError(
        `Chunk budget is misaligned with the bootstrap payload budget: one candidate needs `
        + `${estimateBootstrapPayload(group)} tokens but the payload budget is ${payloadBudget}. `
        + `This is a construction error, not a configuration one.`,
      );
    }
  }
  return {
    bootstrap: groups[0],
    bootstrapGroups: groups,
    evidence,
    domainId: provisionalDomainId,
    sourcePath,
    sourceBodyHash: hashSource(source),
  };
```

Add `bootstrapGroups: BootstrapEvidence[]` to `BootstrapEvidenceBundle`.

- [ ] **Step 5: Bind the chunk budget**

At `src/phases/ingest-evidence.ts:983`, replace the initial request budget with the bound one:

```ts
  const initialRequestBudget = Math.min(
    policy.inputBudgetTokens,
    policy.chunkBudgetTokens ?? policy.inputBudgetTokens,
  );
```

Add `chunkBudgetTokens?: number;` to `EvidencePolicy` next to `bootstrapPayloadBudgetTokens` (line 430).

In `src/phases/init.ts`, pass it where `bootstrapPayloadBudgetTokens` is already passed (line 260):

```ts
      bootstrapPayloadBudgetTokens,
      chunkBudgetTokens: bootstrapPayloadBudgetTokens,
```

- [ ] **Step 6: Merge K bootstrap entries**

In `src/phases/init.ts`, add above the bootstrap loop:

```ts
/**
 * Deterministic merge with no heuristic conflict resolution. Group 0 owns
 * identity: `domainId` is an input to the prompt, so the model does not invent it.
 */
export function mergeBootstrapEntries(entries: DomainEntry[]): DomainEntry {
  const [first, ...rest] = entries;
  let entityTypes = first.entity_types;
  for (const entry of rest) {
    entityTypes = mergeBootstrapEntityTypes(entityTypes, entry.entity_types ?? []);
  }
  return {
    id: first.id,
    name: first.name,
    wiki_folder: first.wiki_folder,
    entity_types: entityTypes,
    language_notes: entries.find((entry) => entry.language_notes?.trim())?.language_notes
      ?? first.language_notes,
  };
}
```

Run the existing bootstrap call once per group in `bootstrapBundle.bootstrapGroups`, collect the entries, merge them, and validate the merged entry with `bootstrapTaxonomyIssue(merged, fullBootstrapEvidence)` where `fullBootstrapEvidence` is the union of all groups' candidates. When the groups differ on `id` or `wiki_folder`, emit `{ kind: "system", message: "bootstrap group conflict on <field>, group 0 wins" }` and keep group 0's value.

- [ ] **Step 7: Delete the size-based hard failure**

In `src/phases/init.ts`, remove the `isConfigurationError` branch (lines 275-279) and the `bootstrapPayloadBudgetTokens <= 0` early return (lines 240-247). Replace the second one with the schema-drop retry, following the existing pattern in `src/phases/lint-chat.ts:272`: rebuild `systemContent` with an empty `schema_block`, re-estimate, and only if it still does not fit, fail with a message naming the model and its context window:

```ts
      message: `init: the Init prompt needs ${fixedRequestEstimate} tokens but model `
        + `${model} reports a context window of ${contextWindow}. Choose a model with a `
        + `larger context window.`,
```

- [ ] **Step 8: Invert the fail-loud test**

In `tests/init-bootstrap-fail-loud.test.ts`, every case asserting `domain was not created` because of size now asserts the opposite: the domain is created and the run emits more than one `init.bootstrap` request. Keep the cases that assert failure for non-size reasons (invalid entity types, missing required fields) exactly as they are.

- [ ] **Step 9: Run the suites**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: `pass`/`fail` match the baseline. Any new failure in `ingest-bounded` means the chunk budget binding changed a boundary a test pinned — rescale it per Task 3 Step 4.

- [ ] **Step 10: Commit**

```bash
git add src/phases/ingest-evidence.ts src/phases/init.ts tests/
git commit -m "fix: split oversized bootstrap payloads instead of failing on size"
```

---

### Task 9: Output ceiling and calibration feedback

**Files:**
- Modify: `src/phases/structured-output.ts:399-409`, `src/phases/structured-output.ts:596-612`
- Test: `tests/structured-output.test.ts`

**Interfaces:**
- Consumes: `outputCeiling` (Task 5); `ModelContextStore.observeUsage` (Task 4); `LlmCallOptions.outputRetryBudgetTokens` as set by Task 7.
- Produces: no new exports. `outputRetryOptions` keeps its signature.

- [ ] **Step 1: Write the failing test**

Append to `tests/structured-output.test.ts`:

```ts
test("the output limit grows when the ceiling is above the current budget", () => {
  const next = outputRetryOptions({ maxTokens: 4096, outputRetryBudgetTokens: 120_000 }, 4096);
  assert.ok((next.maxTokens ?? 0) > 4096, "a truncated generation must be retried with more room");
});

test("the output limit does not grow past the ceiling", () => {
  const next = outputRetryOptions({ maxTokens: 4096, outputRetryBudgetTokens: 5000 }, 4096);
  assert.ok((next.maxTokens ?? 0) <= 5000);
});
```

- [ ] **Step 2: Run it to verify the first case fails today**

Run: `node --import tsx --test tests/structured-output.test.ts`
Expected: the growth test passes only once Task 7 supplies a real ceiling; before that it FAILs because `outputRetryBudgetTokens` equals `maxTokens`. If Task 7 is already merged, this test passes immediately and documents the fix.

- [ ] **Step 3: Report usage for calibration**

In `emitBudget` (around line 596), after the existing `createPromptBudgetEvent` call, report the pair through a callback added to `LlmCallOptions`:

```ts
  opts.onUsageObserved?.({
    estimated: estimatePreparedMessages(params.messages as OpenAI.Chat.ChatCompletionMessageParam[]),
    actual: actualInputTokens,
  });
```

Add to `LlmCallOptions` in `src/types.ts`:

```ts
  /** Reports the estimate against the provider's own count so the estimator can self-correct. */
  onUsageObserved?: (sample: { estimated: number; actual?: number }) => void;
```

Wire it at the same place Task 7 resolves the policy: `onUsageObserved: ({ estimated, actual }) => { if (actual !== undefined) store.observeUsage(baseUrl, model, estimated, actual); }`, and emit the `calibration_sample` event from Task 6 there.

- [ ] **Step 4: Run the suite**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: `pass`/`fail` match the baseline plus the two new tests.

- [ ] **Step 5: Commit**

```bash
git add src/phases/structured-output.ts src/types.ts tests/structured-output.test.ts
git commit -m "fix: let a truncated generation retry with a larger output limit"
```

---

### Task 10: Settings, strings and migration

**Files:**
- Modify: `src/settings.ts:339-386`, `src/settings.ts:769-790`, `src/settings.ts:885-900`
- Modify: `src/i18n.ts` (the `inputBudgetTokens_desc` and `repairInputBudgetTokens_desc` entries in all three locales)
- Modify: `src/main.ts` (a new one-shot migration next to the existing ones around line 327)
- Test: `tests/settings-model-controls.test.ts`

**Interfaces:**
- Consumes: `LocalConfig.migrated_auto_budget` (Task 4); optional settings budgets (Task 7).
- Produces: no new exports.

- [ ] **Step 1: Write the failing migration test**

Append to `tests/settings-model-controls.test.ts`:

```ts
test("migration clears budgets that still hold the old defaults", () => {
  const settings = defaultSettings();
  settings.nativeAgent.inputBudgetTokens = 16_384;
  settings.nativeAgent.repairInputBudgetTokens = 65_536;
  settings.nativeAgent.operations.init.inputBudgetTokens = 16_384;
  migrateAutoBudget(settings);
  assert.equal(settings.nativeAgent.inputBudgetTokens, undefined);
  assert.equal(settings.nativeAgent.repairInputBudgetTokens, undefined);
  assert.equal(settings.nativeAgent.operations.init.inputBudgetTokens, undefined);
});

test("migration preserves a value the user chose", () => {
  const settings = defaultSettings();
  settings.nativeAgent.inputBudgetTokens = 24_000;
  migrateAutoBudget(settings);
  assert.equal(settings.nativeAgent.inputBudgetTokens, 24_000);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/settings-model-controls.test.ts`
Expected: FAIL — `migrateAutoBudget is not exported`.

- [ ] **Step 3: Implement the migration**

In `src/main.ts`, next to the existing migrations:

```ts
const LEGACY_BUDGET_DEFAULTS = {
  inputBudgetTokens: 16_384,
  repairInputBudgetTokens: 65_536,
} as const;

/**
 * A stored value exactly equal to the old default was written by the plugin, not
 * chosen by the user, so it is cleared to enable automatic budgeting. Any other
 * value is a deliberate choice and is preserved as an explicit override.
 */
export function migrateAutoBudget(settings: LlmWikiPluginSettings): void {
  const clear = (
    holder: { inputBudgetTokens?: number; repairInputBudgetTokens?: number },
  ): void => {
    if (holder.inputBudgetTokens === LEGACY_BUDGET_DEFAULTS.inputBudgetTokens) {
      delete holder.inputBudgetTokens;
    }
    if (holder.repairInputBudgetTokens === LEGACY_BUDGET_DEFAULTS.repairInputBudgetTokens) {
      delete holder.repairInputBudgetTokens;
    }
  };
  clear(settings.nativeAgent);
  clear(settings.claudeAgent);
  for (const key of ["ingest", "query", "lint", "init", "format"] as const) {
    clear(settings.nativeAgent.operations[key]);
    clear(settings.claudeAgent.operations[key]);
  }
}
```

Call it once, guarded by the local flag:

```ts
    const local = await this.localConfig.load();
    if (!local.migrated_auto_budget) {
      migrateAutoBudget(this.settings);
      await this.saveSettings();
      await this.localConfig.save({ migrated_auto_budget: true });
    }
```

- [ ] **Step 4: Move the budget fields to Advanced**

In `src/settings.ts`, gather the `inputBudgetTokens` control (line 354), the `repairInputBudgetTokens` control (line 781) and the per-operation `inputBudgetTokens` controls (line 889) under a single heading rendered after the rest of the backend block:

```ts
      new Setting(containerEl).setName(T.settings.advancedBudgets_name).setHeading();
```

Change `addBudgetControl` so an empty string is a valid value meaning automatic: an empty input deletes the setting instead of keeping the previous number, and the placeholder shows the resolved automatic value. `Compression profile` stays where it is — it selects semantics, not arithmetic, and the user is still the right owner of that choice.

- [ ] **Step 5: Update the strings in all three locales**

In `src/i18n.ts`, add `advancedBudgets_name` and rewrite the two descriptions in `en`, `ru` and `es`. English:

```ts
    advancedBudgets_name: "Advanced: manual budgets",
    inputBudgetTokens_desc: "Leave empty for automatic. The budget is derived from the model's context window. Set a value only to override it.",
    repairInputBudgetTokens_desc: "Leave empty for automatic. Only used when a valid request needs a larger repair prompt.",
```

Russian:

```ts
    advancedBudgets_name: "Дополнительно: ручные бюджеты",
    inputBudgetTokens_desc: "Пусто — автоматически. Бюджет выводится из контекстного окна модели. Задавайте значение только чтобы переопределить его.",
    repairInputBudgetTokens_desc: "Пусто — автоматически. Используется, только когда валидный запрос требует более крупный repair prompt.",
```

Spanish:

```ts
    advancedBudgets_name: "Avanzado: presupuestos manuales",
    inputBudgetTokens_desc: "Vacío significa automático. El presupuesto se deriva de la ventana de contexto del modelo. Defina un valor solo para anularlo.",
    repairInputBudgetTokens_desc: "Vacío significa automático. Solo se usa cuando una solicitud válida requiere un prompt de reparación mayor.",
```

- [ ] **Step 6: Run the suite and build**

Run: `npm run typecheck && npm run lint && npm test 2>&1 | tail -20 && npm run build`
Expected: no errors; `pass`/`fail` match the baseline plus the new tests; the bundle builds.

- [ ] **Step 7: Commit**

```bash
git add src/settings.ts src/i18n.ts src/main.ts tests/settings-model-controls.test.ts
git commit -m "feat: make prompt budgets automatic with an advanced manual override"
```

---

### Task 11: Update the user-facing docs

**Files:**
- Modify: `README.md`, `docs/README.ru.md`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: the settled behaviour from Tasks 7 and 10.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Find what the READMEs say about budgets**

Run:
```bash
grep -n "budget\|бюджет\|16384\|Input budget" README.md docs/README.ru.md
```
Expected: the current lines describing budget settings.

- [ ] **Step 2: Rewrite those sections**

State that input and output budgets are automatic: derived from the model's context window, discovered once per model and cached, self-correcting against the provider's reported token usage. Mention that manual override lives under Advanced and that leaving it empty means automatic. Keep both files equivalent — only the language differs.

- [ ] **Step 3: Add the changelog entry**

Follow the existing format in `CHANGELOG.md`. Cover: budgets are now automatic; the estimator counts tokens rather than serialized bytes; Init no longer fails with `domain was not created` because of source size; chunk boundaries moved, so an existing domain should be rebuilt with `Init --force` to benefit.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/README.ru.md CHANGELOG.md
git commit -m "docs: describe automatic prompt budgets"
```

---

### Task 12: Live verification against the intent

Automated tests do not satisfy the intent's "Done when". This task produces the evidence for result reconciliation.

**Files:**
- Modify: none.
- Test: the real vault at `/home/ikeniborn/Documents/Project/notes/vaults/Work`.

**Interfaces:**
- Consumes: everything above.
- Produces: recorded evidence for `/check-chain result`.

- [ ] **Step 1: Deploy the build to the vault**

Run:
```bash
npm run build && cp dist/main.js dist/manifest.json dist/styles.css \
  "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki/"
```
Expected: three files copied.

- [ ] **Step 2: Archive the current agent log**

Run:
```bash
cd "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki" \
  && mv agent.jsonl agent.jsonl.pre-budget-automation
```
Expected: the log is set aside so the verification run is unambiguous. Ask the user before running this — it touches their vault.

- [ ] **Step 3: Ask the user to run Init**

The user reloads the plugin in Obsidian and runs `init os-mac --force --sources ОС/Mac/`. This cannot be automated from here.

- [ ] **Step 4: Verify the run succeeded**

Run:
```bash
cd "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki" \
  && jq -r '.history[-1] | "\(.operation) \(.status)"' data.json
```
Expected: `init ok`.

- [ ] **Step 5: Verify the estimate is within 15% of the provider count**

Run:
```bash
cd "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki" \
  && jq -s '[.[] | select(.event.kind=="llm_request_fingerprint") | .event.estimatedInputTokens] as $e
            | [.[] | select(.event.kind=="llm_call_stats") | .event.inputTokens] as $a
            | [range(0; ($e|length))] | map({estimated: $e[.], actual: $a[.], ratio: ($e[.] / $a[.])})' agent.jsonl
```
Expected: every `ratio` between 0.85 and 1.15. Anything below 0.85 is the intent's halt condition — stop and recalibrate the coefficients in `src/token-estimate.ts`.

- [ ] **Step 6: Verify the budget source**

Run:
```bash
cd "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki" \
  && jq -c 'select(.event.kind=="budget_resolved" or .event.kind=="context_probe") | .event' agent.jsonl | head
```
Expected: a `context_probe` with `ok: true` and a `budget_resolved` with `inputBudget` above 16384 and a `source` other than `default`.

- [ ] **Step 7: Verify the settings UI**

Ask the user to confirm that the main settings section shows no `Input budget tokens` or `Repair input budget`, that both appear under Advanced, and that both are empty.

- [ ] **Step 8: Record the evidence**

Append the recorded numbers to `docs/superpowers/evals/prompt-budget-automation-baseline.md` under a new `## After` heading, then commit:

```bash
git add docs/superpowers/evals/prompt-budget-automation-baseline.md
git commit -m "test: record live verification of automatic prompt budgets"
```

---

## Verification Summary

| Intent Desired Outcome | Verified by |
|---|---|
| Init `os-mac` completes with `status: ok` | Task 12 Step 4 |
| Estimate within ~15% of the provider count | Task 2 Step 4, Task 12 Step 5 |
| No `domain was not created` because of input size | Task 8 Steps 7-8 |
| Budget fields out of the main settings section, empty means automatic | Task 10 Steps 4-5, Task 12 Step 7 |
| ≥16k real tokens on a 128k model, with the source recorded | Task 5 Step 1, Task 12 Step 6 |
| `finish_reason=length` retries with a larger limit | Task 9 Steps 1-2 |

| Intent Health Metric | Verified by |
|---|---|
| Evidence completeness | Task 8 Step 9 (existing coverage assertions) |
| Create/update decision accuracy | Task 3 Step 5, Task 8 Step 9 against the Task 1 baseline |
| Existing section preservation | Task 8 Step 9 |
| Zero unrecovered context-overflow errors | Task 12 Step 5 |
| LLM call count | Task 1 Step 3 baseline against Task 8 Step 9 |
| Persisted settings compatibility | Task 10 Step 1 |
| `claude-agent` path unchanged | Task 7 Step 3 (the claude branch keeps its shape) |

The "Done when" clause expecting a truncation marker is satisfied by a `split` instead; see
the spec's closing note on that substitution.
