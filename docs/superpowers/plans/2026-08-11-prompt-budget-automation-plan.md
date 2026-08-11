---
review:
  plan_hash: 637b4c1ac090f6ef
  last_run: 2026-08-11
  revision: 2
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings:
    - id: F-001
      phase: dependencies
      severity: CRITICAL
      section: "Task 8: Runtime wiring"
      section_hash: ffa877745ff779e3
      fragment: "inputSource: ..., outputSource: ..., calibration: record.calibration"
      text: "Task 8 read inputSource and outputSource off the policy result, but the return type declared in Task 7 carried only model, policy and opts. The step could not compile."
      fix: "Task 7 returns a ResolvedModelCall carrying the resolved budget; Task 8 reads the sources from it and uses its presence as the backend guard."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-002
      phase: dependencies
      severity: CRITICAL
      section: "Task 7: Native call policy"
      section_hash: f1eb2d2de3f2b60d
      fragment: "contextWindowTokens: budget.contextWindow"
      text: "Tasks 7 and 8 set contextWindowTokens and onUsageObserved on LlmCallOptions, but both fields were only declared in Task 11. Neither task would typecheck when executed in order."
      fix: "Declare both fields in Task 3 Step 1, the first task that touches LlmCallOptions."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-003
      phase: verifiability
      severity: WARNING
      section: "Task 7: Native call policy"
      section_hash: f1eb2d2de3f2b60d
      fragment: "semanticCompression: ...,"
      text: "The claude-agent branch and the compression assembly were elided, so an implementer reading only this task could not reproduce them."
      fix: "Spell out both branches in full, with an explicit do-not-edit note on the claude one."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-004
      phase: verifiability
      severity: WARNING
      section: "Task 11: Per-request output ceiling and usage feedback"
      section_hash: fce091b78a2a4022
      fragment: "// drive one call through the stub client used by this suite"
      text: "A test step whose body is a comment is the no-placeholder rule's exact failure case: it describes what to do without showing how."
      fix: "Write the full runStructuredStreaming call, and name the existing stub helper rather than inventing a second one."
      verdict: fixed
      verdict_at: 2026-08-11
    - id: F-005
      phase: verifiability
      severity: INFO
      section: "Task 8: Runtime wiring"
      section_hash: ffa877745ff779e3
      fragment: "const resolved = resolveModelCallPolicy(s, op, record, policyOperation);"
      text: "The remainder of buildOptsFor is elided. Retained deliberately: the elision is labelled as unchanged existing code and naming the two new lines is clearer than reprinting the method."
      fix: null
      verdict: accepted
      verdict_at: 2026-08-11
chain:
  intent:
    path: docs/superpowers/intents/2026-08-11-prompt-budget-automation-intent.md
    hash: 56cb5d606560c990
  spec:
    path: docs/superpowers/specs/2026-08-11-prompt-budget-automation-design.md
    hash: 4116006016a989c1
---

# Prompt Budget Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the byte-based, user-tuned prompt budget with a computed one — a per-script token estimator calibrated against the provider's reported usage, a lazily probed model context window, and a pure budget resolver — so Init and Ingest stop failing with `domain was not created`.

**Architecture:** Three new pure-ish modules (`token-estimate`, `model-context`, `budget-resolver`) feed `LlmCallOptions` through `model-call-policy`, wired at runtime through `Controller` and `AgentRunner`. Nothing below `LlmCallOptions` changes. Two structural fixes remove the hard failure: the chunk budget is bound to the bootstrap payload budget net of per-group overhead, and an oversized bootstrap payload is split at evidence-unit granularity and merged instead of erroring.

**Tech Stack:** TypeScript 5.4, ESM, `node --import tsx --test` (node:test + node:assert/strict), esbuild bundle, Obsidian plugin API, OpenAI SDK v6, undici.

**Revision:** 2. Revision 1 was superseded after a review found eleven defects; the spec records them in its §9. Every one of them has a task or step here.

## Global Constraints

Copied verbatim from the spec and intent; every task's requirements include this section.

- Constants: `SAFETY` = `0.9`. `DEFAULT_OUTPUT_BASE` = `8192`. `OUTPUT_MAX_SHARE` = `0.5`. `operationMultiplier` = `format: 4`, everything else `1`. `BACKEND_DEFAULT` context = `8192` real tokens. Calibration window `N` = `8`. Calibration clamp = `[0.5, 3.0]`. Probe deadline = `2000` ms, shared across endpoints. `default` record TTL = 24 hours.
- Budget formulas, evaluated strictly in this order:
  ```
  outputBase    = override.output ?? DEFAULT_OUTPUT_BASE                                (1)
  outputBudget  = min(outputBase × operationMultiplier(op),
                      floor(contextWindow × OUTPUT_MAX_SHARE))                           (2)
  inputBudget   = min(override.input ?? floor((contextWindow − outputBudget) × SAFETY),
                      contextWindow)                                                     (3)
  payloadBudget = inputBudget − fixedPromptEstimate                                      (4)
  groupOverhead = estimate(domainThemes + languageEvidence + envelope)                   (5)
  chunkBudget   = min(mapperRequestBudget, payloadBudget − groupOverhead)                (6)
  outputCeiling = contextWindow − estimatedInput      — per request, after packing        (7)
  ```
  Worked examples: 131072/`init` → output 8192, input 110592. 131072/`format` → output 32768, input 88473. 8192/`init` → output 4096, input 3686.
- `outputCeiling` is NOT stored in the resolved budget. It is computed at the call site immediately before dispatch, from the actually packed prompt.
- `inputSource` and `outputSource` are tracked separately. A stored `maxTokens` must not make the input budget report `override`.
- The calibration factor is **applied** to every estimate, not merely recorded.
- Automatic budgeting is `native-agent` only. `claude-agent` keeps its stored defaults, settings layout, policy resolution and transport unchanged; it inherits only the honest estimate.
- No operation may end with `configuration error` / `domain was not created` because of input size. The only acceptable size-related failure is a provider rejection after the repack loop is exhausted.
- No silent truncation and no data loss: splitting descends to evidence units, and the oversized-single-unit case is removed structurally.
- Source coverage completeness (`assertCompleteSourceCoverage`) stays a hard invariant.
- Migration rewrites nothing without an explicit answer from the user.
- Existing domains are NOT re-indexed automatically. The user re-runs `Init --force` manually.
- All technical numbers go to `agent.jsonl`, never into sidebar progress text.
- `RunHistoryEntry.status` is `done | error | cancelled` (`src/types.ts:478`). There is no `ok`.
- Documentation, code comments and commit messages are in English.

---

## File Structure

**Created:**

| File | Responsibility |
|---|---|
| `src/token-estimate.ts` | Pure token estimation from message content. No I/O. |
| `src/model-context.ts` | What is known about a `(baseUrl, model)`: context window, its source, the calibration factor. Owns the probe and the persisted cache. |
| `src/budget-resolver.ts` | Pure arithmetic: a record plus overrides plus an operation becomes concrete budgets. |
| `src/auto-budget-notice.ts` | The one-shot upgrade choice modal. |
| `tests/token-estimate.test.ts` | Estimator accuracy against recorded fixtures. |
| `tests/model-context.test.ts` | Probe chain, model scoping, dedup, expiry, calibration clamping. |
| `tests/budget-resolver.test.ts` | Formula order, per-operation output, separate sources, ceiling regression. |
| `tests/fixtures/recorded-prompts.json` | Sanitized recorded prompts with the provider's own token counts. |
| `docs/superpowers/evals/prompt-budget-automation-baseline.md` | Pre-change health-metric baseline, per operation. |

**Modified:** `src/prompt-budget.ts`, `src/markdown-chunks.ts`, `src/local-config.ts`, `src/types.ts`, `src/model-call-policy.ts`, `src/controller.ts`, `src/agent-runner.ts`, `src/phases/structured-output.ts`, `src/phases/ingest-evidence.ts`, `src/phases/init.ts`, `src/settings.ts`, `src/i18n.ts`, `src/main.ts`, `README.md`, `docs/README.ru.md`, `CHANGELOG.md`.

---

### Task 1: Capture the health-metric baseline

The intent's health metrics say "no worse than before". A single total per fixture cannot show that Init got cheaper while Ingest got more expensive, so the baseline is per operation and `callSite`.

**Files:**
- Create: `docs/superpowers/evals/prompt-budget-automation-baseline.md`
- Test: `tests/bounded-operations-acceptance.test.ts` (temporarily instrumented, reverted in Step 5)

**Interfaces:**
- Consumes: nothing.
- Produces: `docs/superpowers/evals/prompt-budget-automation-baseline.md`, read by Tasks 3, 9 and 14.

- [ ] **Step 1: Confirm the tree is clean and on the feature branch**

Run:
```bash
git status --short && git rev-parse --abbrev-ref HEAD
```
Expected: no output from `git status --short`; branch `dev-prompt-budget-automation`.

- [ ] **Step 2: Record the full suite result**

Run:
```bash
npm test 2>&1 | tail -20
```
Expected: a node:test summary. Record the exact `tests`, `pass` and `fail` numbers.

- [ ] **Step 3: Record LLM calls per operation and call site**

`tests/bounded-operations-acceptance.test.ts:98` already pushes every request into `capturedRequests`. Add a temporary reporting line directly after that push:

```ts
  capturedRequests.push({ entryPoint, effectiveInputBudget, params: typed });
  if (process.env.BUDGET_BASELINE) console.error(`BASELINE_CALL\t${entryPoint}\t${effectiveInputBudget}`);
```

Run:
```bash
BUDGET_BASELINE=1 node --import tsx --test tests/bounded-operations-acceptance.test.ts 2>&1 \
  | grep '^BASELINE_CALL' | cut -f2 | sort | uniq -c | sort -rn
```
Expected: a count per `entryPoint`, for example `12 init.bootstrap-map`. Record every line.

- [ ] **Step 4: Record the bounded ingest suite**

Run:
```bash
node --import tsx --test tests/ingest-bounded.test.ts 2>&1 | tail -12
```
Expected: a node:test summary. Record `tests`, `pass`, `fail`.

- [ ] **Step 5: Revert the temporary instrumentation**

Run:
```bash
git checkout -- tests/bounded-operations-acceptance.test.ts && git status --short
```
Expected: no output.

- [ ] **Step 6: Write the baseline file**

Create `docs/superpowers/evals/prompt-budget-automation-baseline.md`, substituting the recorded values for `<...>`:

```markdown
# Baseline: prompt-budget-automation

Captured on 2026-08-11 at commit <git rev-parse --short HEAD>, before any change,
so the intent's health metrics are verifiable afterwards.

## Full suite

- tests: <N>
- pass: <N>
- fail: <N>

## LLM calls per entry point (bounded-operations-acceptance)

| entryPoint | calls |
|---|---|
| <name> | <N> |

## Bounded ingest suite

- tests: <N>, pass: <N>, fail: <N>

## Meaning

The intent allows extra calls caused by splitting an unreachable payload, recorded in
`agent.jsonl` as `evidence_split`. Any other increase against these numbers is a regression.
```

- [ ] **Step 7: Commit**

```bash
git add docs/superpowers/evals/prompt-budget-automation-baseline.md
git commit -m "test: record prompt budget health-metric baseline per entry point"
```

---

### Task 2: Token estimator

**Files:**
- Create: `src/token-estimate.ts`, `tests/token-estimate.test.ts`, `tests/fixtures/recorded-prompts.json`
- Test: `tests/token-estimate.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `MEDIA_TOKENS: number` (4096)
  - `estimateText(text: string, calibration?: number): number`
  - `estimateMessages(messages: readonly OpenAI.Chat.ChatCompletionMessageParam[], calibration?: number): number`

Counting rules: Cyrillic ÷2, CJK ×1, everything else ÷3.5; a flat 4 tokens per message for role and separators; `MEDIA_TOKENS` per `image_url` part with its URL uncounted; every other string-valued field counted as text. The result is multiplied by `calibration`, default `1`.

- [ ] **Step 1: Create the fixture from real recorded data**

Revision 1 asserted the ±15% band against a synthetic `"x".repeat(4181)` string, and its own formula produced +26.4% on it — the test failed its own assertion. Use recorded data instead.

Create `tests/fixtures/recorded-prompts.json`. The four entries come from `agent.jsonl` of the failing run; each records the message shapes and the provider's own `inputTokens`. Character counts are real, contents are placeholder text with the same script mix so nothing private is committed:

```json
{
  "note": "Derived from agent.jsonl messageCharLengths and llm_call_stats.inputTokens. Latin/Cyrillic ratios preserved; text is synthetic but the script mix and lengths are real.",
  "cases": [
    { "id": "llm-1", "system": { "latin": 4181, "cyrillic": 0 }, "user": { "latin": 2080, "cyrillic": 4853 }, "actualInputTokens": 3767 },
    { "id": "llm-2", "system": { "latin": 4181, "cyrillic": 0 }, "user": { "latin": 2652, "cyrillic": 6188 }, "actualInputTokens": 4381 },
    { "id": "llm-3", "system": { "latin": 4181, "cyrillic": 0 }, "user": { "latin": 650, "cyrillic": 1518 }, "actualInputTokens": 1809 },
    { "id": "bounded-1", "system": { "latin": 4181, "cyrillic": 0 }, "user": { "latin": 650, "cyrillic": 1518 }, "actualInputTokens": 1851 }
  ]
}
```

- [ ] **Step 2: Write the failing test**

Create `tests/token-estimate.test.ts`:

```ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { estimateMessages, estimateText } from "../src/token-estimate";

const fixture = JSON.parse(
  readFileSync(new URL("./fixtures/recorded-prompts.json", import.meta.url), "utf8"),
) as { cases: Array<{ id: string; system: { latin: number; cyrillic: number }; user: { latin: number; cyrillic: number }; actualInputTokens: number }> };

const build = (part: { latin: number; cyrillic: number }): string =>
  "a".repeat(part.latin) + "я".repeat(part.cyrillic);

test("Cyrillic costs more tokens per character than Latin", () => {
  assert.ok(estimateText("абвгдеёжзи") > estimateText("abcdefghij"));
});

test("the raw estimate never falls more than 15% below the provider count", () => {
  for (const item of fixture.cases) {
    const estimated = estimateMessages([
      { role: "system", content: build(item.system) },
      { role: "user", content: build(item.user) },
    ]);
    assert.ok(
      estimated >= item.actualInputTokens * 0.85,
      `${item.id}: underestimated ${estimated} against ${item.actualInputTokens}`,
    );
  }
});

test("one calibration factor brings every recorded case inside 15%", () => {
  const ratios = fixture.cases.map((item) => {
    const estimated = estimateMessages([
      { role: "system", content: build(item.system) },
      { role: "user", content: build(item.user) },
    ]);
    return item.actualInputTokens / estimated;
  });
  const calibration = ratios.reduce((sum, value) => sum + value, 0) / ratios.length;
  for (const [index, item] of fixture.cases.entries()) {
    const calibrated = estimateMessages([
      { role: "system", content: build(item.system) },
      { role: "user", content: build(item.user) },
    ], calibration);
    const error = Math.abs(calibrated / item.actualInputTokens - 1);
    assert.ok(error <= 0.15, `${item.id}: ${(error * 100).toFixed(1)}% off after calibration (ratio ${ratios[index].toFixed(3)})`);
  }
});

test("image parts cost a flat allowance and ignore the URL length", () => {
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
  assert.equal(estimateMessages([{ role: "user", content: "abcdefgh" }], 2), base * 2);
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --import tsx --test tests/token-estimate.test.ts`
Expected: FAIL — `Cannot find module '../src/token-estimate'`.

- [ ] **Step 4: Write the implementation**

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
  return code >= 0x0400 && code <= 0x052f;
}

function isCjk(code: number): boolean {
  return (code >= 0x3040 && code <= 0x30ff)
    || (code >= 0x4e00 && code <= 0x9fff)
    || (code >= 0xac00 && code <= 0xd7af);
}

/**
 * Approximate token count for a plain string. Deliberately biased upward:
 * underestimating produces real provider context-length errors, while
 * overestimating only wastes budget. The runtime calibration factor corrects
 * the remaining bias per model.
 */
export function estimateText(text: string, calibration = 1): number {
  let cyrillic = 0;
  let cjk = 0;
  let other = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isCyrillic(code)) cyrillic++;
    else if (isCjk(code)) cjk++;
    else other++;
  }
  const raw = cyrillic / CHARS_PER_TOKEN_CYRILLIC + cjk + other / CHARS_PER_TOKEN_DEFAULT;
  return Math.ceil(raw * calibration);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Walks a message summing text and counting image parts, serializing nothing. */
function rawValueTokens(value: unknown): number {
  if (typeof value === "string") return estimateText(value);
  if (Array.isArray(value)) return value.reduce<number>((sum, item) => sum + rawValueTokens(item), 0);
  if (!isRecord(value)) return 0;
  if (value.type === "image_url") return MEDIA_TOKENS;
  let total = 0;
  for (const item of Object.values(value)) total += rawValueTokens(item);
  return total;
}

export function estimateMessages(
  messages: readonly OpenAI.Chat.ChatCompletionMessageParam[],
  calibration = 1,
): number {
  let total = 0;
  for (const message of messages) total += MESSAGE_OVERHEAD_TOKENS + rawValueTokens(message);
  return Math.ceil(total * calibration);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `node --import tsx --test tests/token-estimate.test.ts`
Expected: PASS, 6 tests.

If the raw-estimate test fails, lower `CHARS_PER_TOKEN_CYRILLIC` or `CHARS_PER_TOKEN_DEFAULT`; never relax the assertion — it is the intent's health metric and its halt condition.

- [ ] **Step 6: Typecheck, lint, commit**

Run: `npm run typecheck && npm run lint`
Expected: no errors.

```bash
git add src/token-estimate.ts tests/token-estimate.test.ts tests/fixtures/recorded-prompts.json
git commit -m "feat: add per-script token estimator with a calibration factor"
```

---

### Task 3: Route the existing estimators through the new one

This is where the ×3.6–4.1 overshoot disappears, and where the calibration factor reaches the estimates. Revision 1 stored the factor without ever applying it.

**Files:**
- Modify: `src/prompt-budget.ts:9`, `src/prompt-budget.ts:39-81`
- Modify: `src/markdown-chunks.ts:186`
- Modify: `src/types.ts` (`LlmCallOptions`)
- Test: `tests/prompt-budget.test.ts`, and any suite failing in Step 4

**Interfaces:**
- Consumes: `estimateText`, `estimateMessages`, `MEDIA_TOKENS` (Task 2).
- Produces:
  - `estimatePreparedMessages(messages, calibration?)` — the added parameter is optional, so the twelve existing call sites keep compiling.
  - `LlmCallOptions.tokenCalibration?: number`.

- [ ] **Step 1: Add the option**

In `src/types.ts`, inside `LlmCallOptions`. All three fields are declared here, in the first
task that touches this type, so Tasks 7, 8 and 11 compile when they start using them:

```ts
  /** Provider-derived correction applied to every token estimate for this call. */
  tokenCalibration?: number;
  /** The model's context window, when known. Absent on the claude-agent path. */
  contextWindowTokens?: number;
  /** Reports the estimate against the provider's own count so the estimator can self-correct. */
  onUsageObserved?: (sample: { estimated: number; actual?: number }) => void;
```

- [ ] **Step 2: Rewrite the estimator body**

In `src/prompt-budget.ts` delete `const MEDIA_TOKENS = 4_096;`, the `SanitizedValue` interface and `sanitizeMedia`, and replace `estimatePreparedMessages`:

```ts
import { MEDIA_TOKENS, estimateMessages } from "./token-estimate";

export { MEDIA_TOKENS };

export function estimatePreparedMessages(
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  calibration?: number,
): number {
  return estimateMessages(messages, calibration);
}
```

Keep `isRecord` — `classifyContextError` still uses it.

- [ ] **Step 3: Thread the factor at every budget-consuming call site**

Run:
```bash
grep -rn "estimatePreparedMessages(" src/ | grep -v "export function"
```
Expected: twelve call sites. At each one that has an `opts: LlmCallOptions` in scope, pass it:

```ts
estimatePreparedMessages(prepareChatMessages(messages, opts), opts.tokenCalibration)
```

Call sites with no `opts` in scope keep the single-argument form; they are diagnostic, not budget-deciding.

- [ ] **Step 4: Route the chunk estimator**

In `src/markdown-chunks.ts:186`:

```ts
import { estimateText } from "./token-estimate";

function estimateTokens(markdown: string): number {
  return estimateText(markdown);
}
```

The chunker is deliberately uncalibrated: chunk boundaries must be reproducible across runs, and a drifting factor would move them.

- [ ] **Step 5: Run the full suite and collect the damage**

Run: `npm test 2>&1 | tail -40`
Expected: FAIL. The failures are tests asserting absolute sizes at a given budget, because a budget of 20 000 now means 20 000 tokens rather than 20 000 bytes.

- [ ] **Step 6: Rescale each failing assertion**

For each failure apply exactly one of these, in order of preference:

1. The test asserts a **relationship** ("required packed, optional omitted", "coverage complete") — it should already pass. If it does not, that is a real regression: fix the code, not the test.
2. The test asserts an **absolute count** — rewrite it against the same estimator, for example `assert.ok(chunks.every((c) => estimateText(c.text) <= budget))`.
3. Only if neither applies, divide the test's budget constant by 3.5, round down, and add a comment naming this task.

- [ ] **Step 7: Verify against the baseline and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: `tests`, `pass` and `fail` equal to the numbers in `docs/superpowers/evals/prompt-budget-automation-baseline.md`.

```bash
git add src/prompt-budget.ts src/markdown-chunks.ts src/types.ts tests/
git commit -m "fix: measure prompt budgets in tokens instead of serialized bytes"
```

---

### Task 4: Model context store

**Files:**
- Create: `src/model-context.ts`, `tests/model-context.test.ts`
- Modify: `src/local-config.ts:4-16`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ModelContextRecord { contextWindow; source: "discovered" | "learned" | "default"; calibration; samples; expiresAt? }`
  - `BACKEND_DEFAULT_CONTEXT = 8_192`, `PROBE_DEADLINE_MS = 2_000`, `DEFAULT_TTL_MS = 86_400_000`
  - `class ModelContextStore` with `get`, `resolve(baseUrl, model, apiKey, now, signal?)`, `observeUsage`, `observeContextError`
  - `probeContextWindow(fetchFn, baseUrl, apiKey, model, deadlineMs, signal?): Promise<number | null>`

`now` is passed in rather than read from the clock so expiry is testable without waiting.

- [ ] **Step 1: Extend the local config shape**

In `src/local-config.ts`, after `lastDomain`:

```ts
  lastDomain?: string;
  migrated_auto_budget?: boolean;
  /** Keyed by `${baseUrl}::${model}`. */
  modelContext?: Record<string, {
    contextWindow: number;
    source: "discovered" | "learned" | "default";
    calibration: number;
    samples: number;
    expiresAt?: number;
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
  type ModelContextMap,
} from "../src/model-context";

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200 });

const storeWith = (
  initial: ModelContextMap,
  fetchFn: typeof fetch,
  onWrite?: (next: ModelContextMap) => void,
): ModelContextStore => new ModelContextStore({
  read: async () => initial,
  write: async (next) => { onWrite?.(next); },
  fetchFn,
});

test("the probe reads the context length of the requested model only", async () => {
  const fetchFn = (async () => json({ data: [
    { id: "other", context_length: 999_999 },
    { id: "m1", context_length: 131_072 },
  ] })) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), 131_072);
});

test("a context length under a different model is ignored", async () => {
  const calls: string[] = [];
  const fetchFn = (async (input: string | URL | Request) => {
    calls.push(String(input));
    if (String(input).endsWith("/models")) return json({ data: [{ id: "other", context_length: 999_999 }] });
    return json({});
  }) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), null);
  assert.ok(calls.some((url) => url.endsWith("/api/show")), "must fall through to /api/show");
});

test("the probe falls through to /api/show", async () => {
  const fetchFn = (async (input: string | URL | Request) =>
    String(input).endsWith("/models")
      ? json({ data: [{ id: "m1" }] })
      : json({ model_info: { "llama.context_length": 32_768 } })) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), 32_768);
});

test("implausible values are rejected", async () => {
  const fetchFn = (async () => json({ data: [{ id: "m1", context_length: 12 }] })) as typeof fetch;
  assert.equal(await probeContextWindow(fetchFn, "http://x/v1", "", "m1", 2000), null);
});

test("a caller abort cancels the probe and caches nothing", async () => {
  const controller = new AbortController();
  controller.abort();
  const writes: ModelContextMap[] = [];
  const store = storeWith({}, (async () => json({})) as typeof fetch, (next) => writes.push(next));
  await assert.rejects(() => store.resolve("http://x/v1", "m1", "", 0, controller.signal));
  assert.equal(writes.length, 0);
});

test("concurrent resolves share one probe", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({ data: [{ id: "m1", context_length: 65_536 }] }); }) as typeof fetch;
  const store = storeWith({}, fetchFn);
  const [a, b] = await Promise.all([
    store.resolve("http://x/v1", "m1", "", 0),
    store.resolve("http://x/v1", "m1", "", 0),
  ]);
  assert.equal(a.contextWindow, 65_536);
  assert.equal(b.contextWindow, 65_536);
  assert.equal(probes, 1, "the second caller must join the in-flight probe");
});

test("resolve falls back to the backend default and marks it expiring", async () => {
  const store = storeWith({}, (async () => { throw new Error("offline"); }) as typeof fetch);
  const record = await store.resolve("http://x/v1", "m1", "", 1_000);
  assert.equal(record.contextWindow, BACKEND_DEFAULT_CONTEXT);
  assert.equal(record.source, "default");
  assert.ok((record.expiresAt ?? 0) > 1_000);
});

test("an expired default is re-probed", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({ data: [{ id: "m1", context_length: 65_536 }] }); }) as typeof fetch;
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 8_192, source: "default", calibration: 1, samples: 0, expiresAt: 500 } },
    fetchFn,
  );
  const record = await store.resolve("http://x/v1", "m1", "", 1_000);
  assert.equal(probes, 1);
  assert.equal(record.source, "discovered");
});

test("a discovered record is never re-probed", async () => {
  let probes = 0;
  const fetchFn = (async () => { probes++; return json({}); }) as typeof fetch;
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0 } },
    fetchFn,
  );
  await store.resolve("http://x/v1", "m1", "", 9_999_999);
  assert.equal(probes, 0);
});

test("a context error shrinks the window and marks it learned", async () => {
  const store = storeWith(
    { "http://x/v1::m1": { contextWindow: 131_072, source: "discovered", calibration: 1, samples: 0 } },
    (async () => json({})) as typeof fetch,
  );
  await store.resolve("http://x/v1", "m1", "", 0);
  store.observeContextError("http://x/v1", "m1", 8_192);
  const record = store.get("http://x/v1", "m1")!;
  assert.equal(record.contextWindow, 8_192);
  assert.equal(record.source, "learned");
});

test("calibration is a moving average that discards anomalies", async () => {
  const store = storeWith({}, (async () => { throw new Error("offline"); }) as typeof fetch);
  await store.resolve("http://x/v1", "m1", "", 0);
  store.observeUsage("http://x/v1", "m1", 1_000, 2_000);
  assert.ok(store.get("http://x/v1", "m1")!.calibration > 1);
  store.observeUsage("http://x/v1", "m1", 1_000, 100_000);
  assert.ok(store.get("http://x/v1", "m1")!.calibration <= 3);
  assert.equal(store.get("http://x/v1", "m1")!.samples, 1, "the anomaly must not count as a sample");
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `node --import tsx --test tests/model-context.test.ts`
Expected: FAIL — `Cannot find module '../src/model-context'`.

- [ ] **Step 4: Write the implementation**

Create `src/model-context.ts`:

```ts
export const BACKEND_DEFAULT_CONTEXT = 8_192;
export const PROBE_DEADLINE_MS = 2_000;
export const DEFAULT_TTL_MS = 86_400_000;

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
  expiresAt?: number;
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

/** First plausible integer under any key whose name reports a context length. */
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

/**
 * Picks the entry whose `id` equals the model, then reads only that entry.
 * A context length belonging to a different model would be confidently wrong
 * and would produce real overflows.
 */
function contextLengthForModel(payload: unknown, model: string): number | null {
  if (payload === null || typeof payload !== "object") return null;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return findContextLength(payload);
  const entry = data.find((item) =>
    item !== null && typeof item === "object" && (item as { id?: unknown }).id === model);
  return entry === undefined ? null : findContextLength(entry);
}

async function getJson(
  fetchFn: typeof fetch,
  url: string,
  apiKey: string,
  deadline: number,
  now: () => number,
  signal: AbortSignal | undefined,
  body?: unknown,
): Promise<unknown | null> {
  const remaining = deadline - now();
  if (remaining <= 0) return null;
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal?.addEventListener("abort", onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), remaining);
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
    signal?.removeEventListener("abort", onAbort);
  }
}

/** Best-effort. Returns null when nothing reports a plausible window for this model. */
export async function probeContextWindow(
  fetchFn: typeof fetch,
  baseUrl: string,
  apiKey: string,
  model: string,
  deadlineMs: number = PROBE_DEADLINE_MS,
  signal?: AbortSignal,
): Promise<number | null> {
  const started = Date.now();
  const now = (): number => Date.now() - started;
  const deadline = deadlineMs;
  const root = baseUrl.replace(/\/+$/, "");

  const models = await getJson(fetchFn, `${root}/models`, apiKey, deadline, now, signal);
  const fromModels = models === null ? null : contextLengthForModel(models, model);
  if (fromModels !== null) return fromModels;

  const ollamaRoot = root.replace(/\/v1$/, "");
  const show = await getJson(fetchFn, `${ollamaRoot}/api/show`, apiKey, deadline, now, signal, { model });
  return show === null ? null : findContextLength(show);
}

export class ModelContextStore {
  private cache: ModelContextMap | null = null;
  private inFlight = new Map<string, Promise<ModelContextRecord>>();

  constructor(private deps: ModelContextStoreDeps) {}

  get(baseUrl: string, model: string): ModelContextRecord | undefined {
    return this.cache?.[cacheKey(baseUrl, model)];
  }

  async resolve(
    baseUrl: string,
    model: string,
    apiKey: string,
    now: number,
    signal?: AbortSignal,
  ): Promise<ModelContextRecord> {
    signal?.throwIfAborted();
    if (this.cache === null) this.cache = await this.deps.read();
    const key = cacheKey(baseUrl, model);

    const cached = this.cache[key];
    if (cached && (cached.expiresAt === undefined || cached.expiresAt > now)) return cached;

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = (async (): Promise<ModelContextRecord> => {
      const probed = await probeContextWindow(
        this.deps.fetchFn, baseUrl, apiKey, model, PROBE_DEADLINE_MS, signal,
      );
      signal?.throwIfAborted();
      const record: ModelContextRecord = probed === null
        ? {
            contextWindow: BACKEND_DEFAULT_CONTEXT,
            source: "default",
            calibration: cached?.calibration ?? 1,
            samples: cached?.samples ?? 0,
            expiresAt: now + DEFAULT_TTL_MS,
          }
        : {
            contextWindow: probed,
            source: "discovered",
            calibration: cached?.calibration ?? 1,
            samples: cached?.samples ?? 0,
          };
      this.cache![key] = record;
      await this.deps.write(this.cache!);
      return record;
    })().finally(() => this.inFlight.delete(key));

    this.inFlight.set(key, task);
    return task;
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
    delete record.expiresAt;
    void this.persist();
  }

  private async persist(): Promise<void> {
    if (this.cache) await this.deps.write(this.cache);
  }
}
```

- [ ] **Step 5: Run the test, typecheck, full suite**

Run: `node --import tsx --test tests/model-context.test.ts && npm run typecheck && npm test 2>&1 | tail -6`
Expected: PASS, 11 tests; no type errors; suite matches the baseline.

- [ ] **Step 6: Commit**

```bash
git add src/model-context.ts src/local-config.ts tests/model-context.test.ts
git commit -m "feat: discover, cache and calibrate the model context window"
```

---

### Task 5: Budget resolver

**Files:**
- Create: `src/budget-resolver.ts`, `tests/budget-resolver.test.ts`

**Interfaces:**
- Consumes: `ModelContextRecord` (Task 4); `OpKey` from `src/types.ts`.
- Produces:
  - `ResolvedBudget { inputBudgetTokens; outputBudgetTokens; contextWindow; inputSource; outputSource; calibration }`
  - `resolveBudget(record, operation: OpKey, overrides: { input?: number; output?: number }): ResolvedBudget`
  - `outputCeiling(contextWindow: number, estimatedInput: number): number`
  - `SAFETY = 0.9`, `DEFAULT_OUTPUT_BASE = 8_192`, `OUTPUT_MAX_SHARE = 0.5`

`outputCeiling` is deliberately not part of `ResolvedBudget`: it depends on the packed prompt, which is unknown at resolve time.

- [ ] **Step 1: Write the failing test**

Create `tests/budget-resolver.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import type { ModelContextRecord } from "../src/model-context";
import { DEFAULT_OUTPUT_BASE, outputCeiling, resolveBudget } from "../src/budget-resolver";

const record = (over: Partial<ModelContextRecord> = {}): ModelContextRecord => ({
  contextWindow: 131_072,
  source: "discovered",
  calibration: 1,
  samples: 0,
  ...over,
});

test("init on a 128k model matches the worked example", () => {
  const budget = resolveBudget(record(), "init", {});
  assert.equal(budget.outputBudgetTokens, 8_192);
  assert.equal(budget.inputBudgetTokens, 110_592);
});

test("format keeps four times the base output allowance", () => {
  const budget = resolveBudget(record(), "format", {});
  assert.equal(budget.outputBudgetTokens, DEFAULT_OUTPUT_BASE * 4);
  assert.equal(budget.inputBudgetTokens, 88_473);
});

test("the fallback window still leaves a usable input budget", () => {
  const budget = resolveBudget(record({ contextWindow: 8_192, source: "default" }), "init", {});
  assert.equal(budget.outputBudgetTokens, 4_096);
  assert.equal(budget.inputBudgetTokens, 3_686);
  assert.equal(budget.inputSource, "default");
});

test("input and output sources move independently", () => {
  const budget = resolveBudget(record(), "init", { output: 2_048 });
  assert.equal(budget.outputSource, "override");
  assert.equal(budget.inputSource, "discovered", "an output override must not relabel the input");
});

test("an override larger than the context window is clamped", () => {
  const budget = resolveBudget(record({ contextWindow: 8_192 }), "init", { input: 999_999 });
  assert.ok(budget.inputBudgetTokens <= 8_192);
});

test("the output ceiling exceeds the output budget so a retry can grow", () => {
  const budget = resolveBudget(record(), "init", {});
  assert.ok(
    outputCeiling(131_072, 20_000) > budget.outputBudgetTokens,
    "regression: the ceiling must not equal the budget it is meant to raise",
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --import tsx --test tests/budget-resolver.test.ts`
Expected: FAIL — `Cannot find module '../src/budget-resolver'`.

- [ ] **Step 3: Write the implementation**

Create `src/budget-resolver.ts`:

```ts
import type { ModelContextRecord } from "./model-context";
import type { OpKey } from "./types";

export const SAFETY = 0.9;
export const DEFAULT_OUTPUT_BASE = 8_192;
/** A reply may never claim more than this share of the window. */
export const OUTPUT_MAX_SHARE = 0.5;

const OUTPUT_MULTIPLIER: Partial<Record<OpKey, number>> = { format: 4 };

export interface ResolvedBudget {
  inputBudgetTokens: number;
  outputBudgetTokens: number;
  contextWindow: number;
  inputSource: "override" | "discovered" | "learned" | "default";
  outputSource: "override" | "default";
  calibration: number;
}

function positive(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/**
 * Evaluated in a fixed order so no value depends on one defined after it:
 * output base, output budget, input budget. The per-request output ceiling is
 * computed separately by `outputCeiling`, because it needs the packed prompt.
 */
export function resolveBudget(
  record: ModelContextRecord,
  operation: OpKey,
  overrides: { input?: number; output?: number },
): ResolvedBudget {
  const outputOverride = positive(overrides.output);
  const inputOverride = positive(overrides.input);

  const outputBase = outputOverride ?? DEFAULT_OUTPUT_BASE;
  const outputBudgetTokens = Math.max(1, Math.min(
    outputBase * (OUTPUT_MULTIPLIER[operation] ?? 1),
    Math.floor(record.contextWindow * OUTPUT_MAX_SHARE),
  ));
  const derivedInput = Math.floor((record.contextWindow - outputBudgetTokens) * SAFETY);
  const inputBudgetTokens = Math.max(1, Math.min(
    inputOverride ?? derivedInput,
    record.contextWindow,
  ));

  return {
    inputBudgetTokens,
    outputBudgetTokens,
    contextWindow: record.contextWindow,
    inputSource: inputOverride === undefined ? record.source : "override",
    outputSource: outputOverride === undefined ? "default" : "override",
    calibration: record.calibration,
  };
}

/** Computed per request, after packing, so a truncated reply has room to grow. */
export function outputCeiling(contextWindow: number, estimatedInput: number): number {
  return Math.max(1, contextWindow - Math.max(0, estimatedInput));
}
```

- [ ] **Step 4: Run, typecheck, commit**

Run: `node --import tsx --test tests/budget-resolver.test.ts && npm run typecheck && npm run lint`
Expected: PASS, 6 tests; no errors.

```bash
git add src/budget-resolver.ts tests/budget-resolver.test.ts
git commit -m "feat: derive per-operation input and output budgets from the context window"
```

---

### Task 6: Diagnostic events

The four new events must exist before the wiring tasks emit them.

**Files:**
- Modify: `src/types.ts:325-338`
- Modify: `src/prompt-budget.ts` (`PromptBudgetMetadata`, `createPromptBudgetEvent`)
- Test: `tests/prompt-budget.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RunEvent` members `budget_resolved`, `context_probe`, `calibration_sample`, `evidence_split`; four optional fields on `prompt_budget`.

- [ ] **Step 1: Extend `prompt_budget`**

In `src/types.ts`, after `retryReason?: string;` inside the `prompt_budget` member:

```ts
      contextWindow?: number;
      inputSource?: "override" | "discovered" | "learned" | "default";
      outputSource?: "override" | "default";
      calibration?: number;
```

`prompt_budget` already carries both `estimatedInputTokens` and `actualInputTokens` on the same record. That pairing is what verification reads — never two event streams matched by array position.

- [ ] **Step 2: Add the four new members**

Directly after the `prompt_budget` member of the `RunEvent` union:

```ts
  | {
      kind: "budget_resolved";
      operation: OpKey;
      model: string;
      contextWindow: number;
      inputSource: "override" | "discovered" | "learned" | "default";
      outputSource: "override" | "default";
      calibration: number;
      samples: number;
      inputBudget: number;
      outputBudget: number;
    }
  | {
      kind: "context_probe";
      baseUrl: string;
      model: string;
      endpoint: string;
      ok: boolean;
      ms: number;
      matchedById: boolean;
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
  | {
      kind: "evidence_split";
      callSite: StructuredCallSite;
      groups: number;
      candidates: number;
      subdivided: number;
      payloadBudget: number;
    }
```

- [ ] **Step 3: Extend the event builder**

In `src/prompt-budget.ts`, add the four fields to `PromptBudgetMetadata` and copy them in `createPromptBudgetEvent` beside the existing optional copies:

```ts
  if (metadata.contextWindow !== undefined) event.contextWindow = metadata.contextWindow;
  if (metadata.inputSource !== undefined) event.inputSource = metadata.inputSource;
  if (metadata.outputSource !== undefined) event.outputSource = metadata.outputSource;
  if (metadata.calibration !== undefined) event.calibration = metadata.calibration;
```

- [ ] **Step 4: Write the test**

Append to `tests/prompt-budget.test.ts`:

```ts
test("budget metadata carries the window, both sources and the calibration", () => {
  const event = createPromptBudgetEvent({
    requestId: "r1",
    callSite: "init.bootstrap",
    configuredInputBudget: 100,
    effectiveInputBudget: 100,
    estimatedInputTokens: 50,
    actualInputTokens: 48,
    contextUnits: 1,
    contextWindow: 131_072,
    inputSource: "discovered",
    outputSource: "default",
    calibration: 1.1,
  });
  assert.equal(event.contextWindow, 131_072);
  assert.equal(event.inputSource, "discovered");
  assert.equal(event.outputSource, "default");
  assert.equal(event.calibration, 1.1);
  assert.equal(event.estimatedInputTokens, 50);
  assert.equal(event.actualInputTokens, 48);
});
```

- [ ] **Step 5: Run, typecheck, commit**

Run: `node --import tsx --test tests/prompt-budget.test.ts && npm run typecheck`
Expected: PASS; no type errors.

```bash
git add src/types.ts src/prompt-budget.ts tests/prompt-budget.test.ts
git commit -m "feat: add budget resolution diagnostics to the run event stream"
```

---

### Task 7: Native call policy

**Files:**
- Modify: `src/model-call-policy.ts:11-12`, `:123-159`, `:174-242`
- Modify: `src/types.ts` (native settings budgets become optional)
- Test: `tests/model-call-policy.test.ts`

**Interfaces:**
- Consumes: `ModelContextRecord` (Task 4); `resolveBudget` (Task 5).
- Produces: `resolveModelCallPolicy(settings, operation, record, parent?)` — the same return shape, with a `ModelContextRecord` added as the third positional parameter. The parameter is ignored on the `claude-agent` path.

- [ ] **Step 1: Make only the native budgets optional**

In `src/types.ts` change `inputBudgetTokens: number` to `inputBudgetTokens?: number` and `maxTokens: number` to `maxTokens?: number` in the **native** settings interface and its per-operation shape. Delete the native budget literals from `DEFAULT_SETTINGS` (lines 848-849, 856-860): `inputBudgetTokens`, `repairInputBudgetTokens`, `maxTokens`.

Leave the `claudeAgent` interface and its defaults at lines 832-841 exactly as they are. The intent's hard constraint says that backend does not change.

- [ ] **Step 2: Stop inventing native budgets during normalization**

In `src/model-call-policy.ts` delete `DEFAULT_INPUT_BUDGET` and `DEFAULT_REPAIR_INPUT_BUDGET`, add:

```ts
function optionalPositiveInt(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  const floored = Math.floor(value);
  return floored >= 1 ? floored : undefined;
}
```

In `normalizePersistedModelControls`, replace the native lines with `optionalPositiveInt` and **leave the two claude lines using `positiveInt` with 16384**:

```ts
  settings.nativeAgent.inputBudgetTokens = optionalPositiveInt(settings.nativeAgent.inputBudgetTokens);
  settings.nativeAgent.repairInputBudgetTokens = optionalPositiveInt(settings.nativeAgent.repairInputBudgetTokens);
  settings.claudeAgent.inputBudgetTokens = positiveInt(settings.claudeAgent.inputBudgetTokens, 16_384);
```

Apply the same asymmetry in the per-operation loop.

- [ ] **Step 3: Resolve the native budget through the record**

Change the signature and rewrite only the native branch:

```ts
export interface ResolvedModelCall {
  model: string;
  policy: ModelCallPolicy;
  opts: LlmCallOptions;
  /** Undefined on the claude-agent path, which does not consult the record. */
  budget?: ResolvedBudget;
}

export function resolveModelCallPolicy(
  settings: LlmWikiPluginSettings,
  operation: WikiOperation,
  record: ModelContextRecord,
  parent?: OpKey,
): ResolvedModelCall {
  const key = policyKey(operation, parent);
  const compressionOp = compressionOperation(key);

  if (settings.backend === "claude-agent") {
    // Byte-for-byte the body this function has today, returned without a `budget`
    // field. `record` is not read on this path. Do not edit this branch.
    const global = settings.claudeAgent;
    const local = global.perOperation ? global.operations[key] : undefined;
    const compression = key === "format"
      ? undefined
      : compressionProfile(local?.compressionProfile)
        ?? compressionProfile(global.compressionProfile)
        ?? "balanced";
    const policy: ModelCallPolicy = {
      inputBudgetTokens: positiveInt(local?.inputBudgetTokens ?? global.inputBudgetTokens, 16_384),
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
  const compression = key === "format"
    ? undefined
    : compressionProfile(local?.compressionProfile)
      ?? compressionProfile(global.compressionProfile)
      ?? "balanced";
  const budget = resolveBudget(record, key, {
    input: local?.inputBudgetTokens ?? global.inputBudgetTokens,
    output: local?.maxTokens ?? global.maxTokens,
  });
  const repairInputBudgetTokens = key === "init" || key === "ingest"
    ? optionalPositiveInt(global.repairInputBudgetTokens) ?? budget.inputBudgetTokens
    : undefined;
  const policy: ModelCallPolicy = {
    inputBudgetTokens: budget.inputBudgetTokens,
    ...(repairInputBudgetTokens === undefined ? {} : { repairInputBudgetTokens }),
    outputBudgetTokens: budget.outputBudgetTokens,
    ...(compression ? { compression } : {}),
  };
  return {
    model: local?.model ?? global.model,
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
    },
  };
}
```

Two things this return shape settles for later tasks: `budget` carries `inputSource` and
`outputSource` so Task 8 does not recompute them, and `outputRetryBudgetTokens` is
deliberately absent because Task 11 sets it per request from `outputCeiling`.

- [ ] **Step 4: Add the policy tests**

Append to `tests/model-call-policy.test.ts`:

```ts
const rec = (over = {}) => ({ contextWindow: 131_072, source: "discovered" as const, calibration: 1, samples: 0, ...over });

test("an absent native budget yields a context-derived budget, not 16384", () => {
  const settings = defaultSettings();
  const { policy } = resolveModelCallPolicy(settings, "init", rec());
  assert.equal(policy.inputBudgetTokens, 110_592);
});

test("a stored native budget still acts as an explicit override", () => {
  const settings = defaultSettings();
  settings.nativeAgent.inputBudgetTokens = 24_000;
  const { policy } = resolveModelCallPolicy(settings, "init", rec());
  assert.equal(policy.inputBudgetTokens, 24_000);
});

test("the calibration factor reaches the call options", () => {
  const settings = defaultSettings();
  const { opts } = resolveModelCallPolicy(settings, "init", rec({ calibration: 1.25 }));
  assert.equal(opts.tokenCalibration, 1.25);
});

test("the claude-agent path is unaffected by the record", () => {
  const settings = defaultSettings();
  settings.backend = "claude-agent";
  const a = resolveModelCallPolicy(settings, "init", rec());
  const b = resolveModelCallPolicy(settings, "init", rec({ contextWindow: 8_192 }));
  assert.deepEqual(a.policy, b.policy);
  assert.equal(a.policy.inputBudgetTokens, 16_384);
});
```

- [ ] **Step 5: Run and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: baseline plus the four new tests. Compilation errors at `resolveModelCallPolicy` call sites are expected and are fixed in Task 8.

```bash
git add src/model-call-policy.ts src/types.ts tests/model-call-policy.test.ts
git commit -m "feat: resolve native call budgets from the model context"
```

---

### Task 8: Runtime wiring

Revision 1 referenced a store that does not exist and assumed a synchronous path that is not one. This task exists because it is the only change touching both the controller and the runner, and a reviewer should be able to judge it on its own.

**Files:**
- Modify: `src/controller.ts:124`, `src/controller.ts:766`
- Modify: `src/agent-runner.ts:9-27` (constructor), `:52-70` (`buildOptsFor`), `:233`, `:238`
- Test: `tests/controller-run-status.test.ts` or a new `tests/runtime-budget-wiring.test.ts`

**Interfaces:**
- Consumes: `ModelContextStore` (Task 4); `resolveModelCallPolicy(settings, operation, record, parent?)` (Task 7).
- Produces: `AgentRunner` accepts a `ModelContextStore`; `AgentRunner.buildOptsFor` returns `Promise<{ model, opts }>`.

- [ ] **Step 1: Build the store in the controller**

In `src/controller.ts`, beside the existing `localConfigStore` (line 124), construct the store once:

```ts
  private modelContextStore = new ModelContextStore({
    read: async () => (await this.localConfigStore.load()).modelContext ?? {},
    write: async (next) => { await this.localConfigStore.save({ modelContext: next }); },
    fetchFn: selectNativeFetch({
      proxy: this.plugin.settings.proxy,
      connectionTimeoutMs: (this.plugin.settings.llmConnectionTimeoutSec ?? 15) * 1000,
    }),
  });
```

Match the actual `selectNativeFetch` parameter shape at `src/native-openai-transport.ts:162`; if it differs, adapt the call rather than the transport.

- [ ] **Step 2: Pass it to the runner**

At `src/controller.ts:766`, add the store as a constructor argument, and add the matching parameter to `AgentRunner`:

```ts
    private modelContextStore: ModelContextStore,
```

- [ ] **Step 3: Make `buildOptsFor` async**

In `src/agent-runner.ts`:

```ts
  private async buildOptsFor(
    op: RunRequest["operation"],
    policyOperation?: RunRequest["policyOperation"],
    signal?: AbortSignal,
  ): Promise<{ model: string; opts: LlmCallOptions }> {
    const s = this.settings;
    const record = s.backend === "claude-agent"
      ? CLAUDE_PLACEHOLDER_RECORD
      : await this.modelContextStore.resolve(
          s.nativeAgent.baseUrl,
          s.nativeAgent.model,
          this.apiKey,
          Date.now(),
          signal,
        );
    const resolved = resolveModelCallPolicy(s, op, record, policyOperation);
    // Everything below this line is the body `buildOptsFor` has today, unchanged:
    // the structuredRetries / mergeDeleteWarnThreshold reads, the claude-agent
    // early return, and the native option assembly. Only the two lines above are new.
    const structuredRetries = s.nativeAgent.structuredRetries ?? 1;
    const mergeDeleteWarnThreshold = s.nativeAgent.mergeDeleteWarnThreshold;
    ...
  }
```

`CLAUDE_PLACEHOLDER_RECORD` is a frozen constant that the claude branch never reads; it exists only to satisfy the signature:

```ts
const CLAUDE_PLACEHOLDER_RECORD = Object.freeze({
  contextWindow: 0, source: "default" as const, calibration: 1, samples: 0,
});
```

Await it at both call sites (`:233`, `:238`).

- [ ] **Step 4: Emit `budget_resolved`**

Immediately after resolving. `resolved.budget` is present only on the native path, so the
guard doubles as the backend check:

```ts
    if (resolved.budget) {
      onEvent({
        kind: "budget_resolved",
        operation: policyKey(op, policyOperation),
        model: resolved.model,
        contextWindow: resolved.budget.contextWindow,
        inputSource: resolved.budget.inputSource,
        outputSource: resolved.budget.outputSource,
        calibration: resolved.budget.calibration,
        samples: record.samples,
        inputBudget: resolved.budget.inputBudgetTokens,
        outputBudget: resolved.budget.outputBudgetTokens,
      });
    }
```

- [ ] **Step 5: Close both feedback hooks**

Set `opts.onUsageObserved` (added in Task 11) so a reported usage reaches the store, and classify errors so a context error reaches it too. Without the second hook the `learned` source can never appear:

```ts
      onUsageObserved: ({ estimated, actual }) => {
        if (actual === undefined) return;
        this.modelContextStore.observeUsage(baseUrl, model, estimated, actual);
        onEvent({ kind: "calibration_sample", model, estimated, actual,
          ratio: actual / estimated, applied: true, clamped: false });
      },
```

and, where a run's error is already classified, call
`this.modelContextStore.observeContextError(baseUrl, model, classifyContextError(error)?.maxContextTokens)`.

- [ ] **Step 6: Write the wiring test**

Create `tests/runtime-budget-wiring.test.ts` asserting three things with a stub store: `buildOptsFor` awaits `resolve` before producing options; a context error routes to `observeContextError`; and with `backend: "claude-agent"` the store is never called.

- [ ] **Step 7: Run and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: compilation clean, suite at the baseline plus the new tests.

```bash
git add src/controller.ts src/agent-runner.ts tests/runtime-budget-wiring.test.ts
git commit -m "feat: wire the model context store through controller and runner"
```

---

### Task 9: Evidence-unit split and the bound chunk budget

The task that removes the hard failure. Both halves must land together: the chunk budget makes the split sufficient, and the split makes the bounder unnecessary.

Revision 1 claimed a single candidate always fits because its text is bounded by its chunk. That is false: `reduceUntilBounded` (`src/phases/ingest-evidence.ts:480-513`) and `dedupeVerifiedEvidencePackets` (`:369-374`) concatenate `facts` and `exactSource` across every chunk mentioning the entity.

**Files:**
- Modify: `src/phases/ingest-evidence.ts:139-172`, `:430`, `:983`, `:1862-1899`
- Test: `tests/ingest-evidence.test.ts`

**Interfaces:**
- Consumes: `estimateText` (Task 2).
- Produces:
  - `splitBootstrapPayload(value: BootstrapEvidence, budget: number): BootstrapEvidence[]`
  - `estimateBootstrapPayloadForTest` (re-export of the internal estimator)
  - `EvidencePolicy.chunkBudgetTokens?: number`
  - `BootstrapEvidenceBundle.bootstrapGroups: BootstrapEvidence[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/ingest-evidence.test.ts`:

```ts
const candidate = (key: string, units: number) => ({
  entityKey: key,
  packetIds: [`${key}-p`],
  facts: Array.from({ length: units }, (_, i) => `fact ${i} about ${key} `.repeat(20)),
  exactSource: Array.from({ length: units }, (_, i) => ({
    startLine: i * 10 + 1, endLine: i * 10 + 5, text: `source ${i} for ${key} `.repeat(20),
  })),
});

test("a payload that fits is returned as a single group", () => {
  const payload = { candidates: [], domainThemes: [], languageEvidence: [] };
  assert.equal(splitBootstrapPayload(payload, 1_000_000).length, 1);
});

test("an oversized payload splits across candidates without dropping any", () => {
  const payload = {
    candidates: [candidate("a", 1), candidate("b", 1), candidate("c", 1)],
    domainThemes: ["theme"], languageEvidence: ["evidence"],
  };
  const groups = splitBootstrapPayload(payload, Math.ceil(estimateBootstrapPayloadForTest(payload) / 2));
  assert.ok(groups.length >= 2);
  assert.equal(
    groups.flatMap((g) => g.candidates.map((c) => c.entityKey)).join(","),
    "a,b,c",
    "no candidate may be dropped and the order must be preserved",
  );
});

test("a candidate aggregating many chunks is subdivided rather than left oversized", () => {
  // One entity mentioned in 12 chunks: exactly the shape reduceUntilBounded produces.
  const wide = candidate("wide", 12);
  const payload = { candidates: [wide], domainThemes: ["t"], languageEvidence: ["e"] };
  const budget = Math.ceil(estimateBootstrapPayloadForTest(payload) / 4);
  const groups = splitBootstrapPayload(payload, budget);

  assert.ok(groups.length >= 2, "a single oversized candidate must be subdivided");
  for (const group of groups) {
    assert.ok(
      estimateBootstrapPayloadForTest(group) <= budget,
      `group of ${group.candidates.length} needs ${estimateBootstrapPayloadForTest(group)} > ${budget}`,
    );
  }
  const facts = groups.flatMap((g) => g.candidates.flatMap((c) => c.facts));
  assert.equal(new Set(facts).size, wide.facts.length, "every fact must survive exactly once");
  const ranges = groups.flatMap((g) => g.candidates.flatMap((c) => c.exactSource.map((r) => r.text)));
  assert.equal(new Set(ranges).size, wide.exactSource.length, "every range must survive exactly once");
  assert.ok(groups.every((g) => g.candidates.every((c) => c.entityKey === "wide")));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `node --import tsx --test tests/ingest-evidence.test.ts`
Expected: FAIL — `splitBootstrapPayload is not exported`.

- [ ] **Step 3: Replace the bounder with a two-level splitter**

In `src/phases/ingest-evidence.ts`, delete `boundBootstrapPayload` (lines 139-172) and add:

```ts
export { estimateBootstrapPayload as estimateBootstrapPayloadForTest };

type BootstrapCandidate = BootstrapEvidence["candidates"][number];

function emptyGroup(value: BootstrapEvidence): BootstrapEvidence {
  return {
    candidates: [],
    domainThemes: [...value.domainThemes],
    languageEvidence: [...value.languageEvidence],
  };
}

/**
 * Splits a candidate into sub-candidates sharing its entityKey and carrying
 * disjoint evidence. A candidate aggregates facts and ranges across every chunk
 * that mentions the entity, so bounding the chunk does not bound the candidate.
 */
function subdivide(candidate: BootstrapCandidate, parts: number): BootstrapCandidate[] {
  const total = Math.max(candidate.facts.length, candidate.exactSource.length, 1);
  const size = Math.max(1, Math.ceil(total / Math.max(1, parts)));
  const result: BootstrapCandidate[] = [];
  for (let offset = 0; offset < total; offset += size) {
    result.push({
      entityKey: candidate.entityKey,
      packetIds: [...candidate.packetIds],
      facts: candidate.facts.slice(offset, offset + size),
      exactSource: candidate.exactSource.slice(offset, offset + size).map((range) => ({ ...range })),
    });
  }
  return result.filter((part) => part.facts.length > 0 || part.exactSource.length > 0);
}

/**
 * Greedy over candidates; a candidate that does not fit an empty group is
 * subdivided first. Themes and language evidence are duplicated into every
 * group, which is the overhead the chunk budget already subtracts.
 */
export function splitBootstrapPayload(
  value: BootstrapEvidence,
  budget: number,
): BootstrapEvidence[] {
  if (estimateBootstrapPayload(value) <= budget) return [value];

  const queue: BootstrapCandidate[] = [];
  for (const candidate of value.candidates) {
    const probe: BootstrapEvidence = { ...emptyGroup(value), candidates: [candidate] };
    const size = estimateBootstrapPayload(probe);
    if (size <= budget) {
      queue.push(candidate);
      continue;
    }
    queue.push(...subdivide(candidate, Math.ceil(size / budget)));
  }

  const groups: BootstrapEvidence[] = [];
  let current = emptyGroup(value);
  for (const candidate of queue) {
    const attempt: BootstrapEvidence = { ...current, candidates: [...current.candidates, candidate] };
    if (current.candidates.length > 0 && estimateBootstrapPayload(attempt) > budget) {
      groups.push(current);
      current = { ...emptyGroup(value), candidates: [candidate] };
      continue;
    }
    current = attempt;
  }
  groups.push(current);
  return groups;
}
```

`subdivide` may need a second pass when one part is still too large; the loop in Step 4 asserts the postcondition rather than trusting the arithmetic.

- [ ] **Step 4: Return the groups and assert the postcondition**

Replace the bound-and-throw block in `prepareBootstrapEvidenceBundle` (around line 1885):

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
    const size = estimateBootstrapPayload(group);
    if (size > payloadBudget) {
      throw new EvidenceCoverageError(
        `Chunk budget is misaligned with the bootstrap payload budget: a minimal evidence group `
        + `needs ${size} tokens but the payload budget is ${payloadBudget}. This is a construction `
        + `error in the budget wiring, not a user configuration problem.`,
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

- [ ] **Step 5: Bind the chunk budget net of group overhead**

Add to `EvidencePolicy` beside `bootstrapPayloadBudgetTokens` (line 430):

```ts
  chunkBudgetTokens?: number;
```

At line 983 replace the initial request budget:

```ts
  const initialRequestBudget = Math.min(
    policy.inputBudgetTokens,
    policy.chunkBudgetTokens ?? policy.inputBudgetTokens,
  );
```

- [ ] **Step 6: Run the suites and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: the three new tests pass; the rest matches the baseline. A new `ingest-bounded` failure means the binding moved a boundary a test pinned — rescale per Task 3 Step 6.

```bash
git add src/phases/ingest-evidence.ts tests/ingest-evidence.test.ts
git commit -m "fix: split bootstrap evidence at unit granularity instead of failing on size"
```

---

### Task 10: Init merges K bootstrap groups and stops failing on size

**Files:**
- Modify: `src/phases/init.ts:237-296`, `:297-400`
- Test: `tests/init-bootstrap-fail-loud.test.ts`

**Interfaces:**
- Consumes: `splitBootstrapPayload`, `bootstrapGroups`, `chunkBudgetTokens` (Task 9); `estimateMessages` (Task 2).
- Produces: `mergeBootstrapEntries(entries: DomainEntry[]): DomainEntry`, exported for tests.

- [ ] **Step 1: Compute the group overhead and pass both budgets**

Replace lines 237-247:

```ts
  const emptyGroupEstimate = estimatePreparedMessages([{
    role: "user",
    content: JSON.stringify({ candidates: [], domainThemes, languageEvidence }),
  }], opts.tokenCalibration);
  const bootstrapPayloadBudgetTokens = inputBudgetTokens - fixedRequestEstimate + emptyPayloadEstimate;
  const chunkBudgetTokens = Math.max(1, bootstrapPayloadBudgetTokens - emptyGroupEstimate);
```

and pass both into `prepareBootstrapEvidenceBundle`:

```ts
      bootstrapPayloadBudgetTokens,
      chunkBudgetTokens,
```

`domainThemes` and `languageEvidence` are not known before evidence preparation, so estimate the overhead from the previous run's shape when available and otherwise from an empty envelope plus a fixed reserve of 512 tokens. Record the value used in the `evidence_split` event.

- [ ] **Step 2: Merge K entries**

Add above the bootstrap loop:

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

Run the existing bootstrap call once per entry in `bootstrapBundle.bootstrapGroups`, collect the `DomainEntry` values, merge them, and validate with `bootstrapTaxonomyIssue(merged, fullEvidence)` where `fullEvidence` is the union of all groups. On an `id` or `wiki_folder` divergence emit
`{ kind: "system", message: "bootstrap group conflict on <field>; group 0 wins" }` and keep group 0.

Emit `evidence_split` once, with `groups`, `candidates`, `subdivided` and `payloadBudget`.

- [ ] **Step 3: Remove the size-based hard failure**

Delete the `isConfigurationError` branch (lines 275-279). Replace the `bootstrapPayloadBudgetTokens <= 0` early return with the schema-drop retry, following `src/phases/lint-chat.ts:272`: rebuild `systemContent` with an empty `schema_block` and re-estimate. Only if it still does not fit:

```ts
      message: `init: the Init prompt needs ${fixedRequestEstimate} tokens but model `
        + `${model} reports a context window of ${contextWindow}. Choose a model with a `
        + `larger context window.`,
```

No "configuration error", because there is nothing for the user to configure.

- [ ] **Step 4: Invert the fail-loud tests**

In `tests/init-bootstrap-fail-loud.test.ts`, every case asserting `domain was not created` for a size reason now asserts the domain is created and more than one `init.bootstrap` request was issued. Keep the non-size failure cases — invalid entity types, missing required fields — exactly as they are.

Add one case: two groups returning different `id` values produce the group 0 value plus the conflict message.

- [ ] **Step 5: Run and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: suite at the baseline; the inverted cases pass.

```bash
git add src/phases/init.ts tests/init-bootstrap-fail-loud.test.ts
git commit -m "fix: merge split bootstrap groups instead of failing on source size"
```

---

### Task 11: Per-request output ceiling and usage feedback

**Files:**
- Modify: `src/phases/structured-output.ts:399-409`, `:520-535`, `:596-612`
- Modify: `src/types.ts` (`LlmCallOptions.onUsageObserved`)
- Test: `tests/structured-output.test.ts`

**Interfaces:**
- Consumes: `outputCeiling` (Task 5); `estimatePreparedMessages(messages, calibration?)` (Task 3).
- Produces: nothing new on the type level — `onUsageObserved` and `contextWindowTokens` were declared in Task 3 Step 1. This task is the first to read them. `outputRetryOptions` keeps its signature.

- [ ] **Step 1: Write the failing tests**

Append to `tests/structured-output.test.ts`:

```ts
test("the output limit grows when the ceiling is above the current budget", () => {
  const next = outputRetryOptions({ maxTokens: 4_096, outputRetryBudgetTokens: 120_000 }, 4_096);
  assert.ok((next.maxTokens ?? 0) > 4_096, "a truncated generation must be retried with more room");
});

test("the output limit does not grow past the ceiling", () => {
  const next = outputRetryOptions({ maxTokens: 4_096, outputRetryBudgetTokens: 5_000 }, 4_096);
  assert.ok((next.maxTokens ?? 0) <= 5_000);
});

test("usage is reported once per call with both numbers", async () => {
  const samples: Array<{ estimated: number; actual?: number }> = [];
  const llm = stubLlmClient({
    content: JSON.stringify({ ok: true }),
    usage: { prompt_tokens: 123, completion_tokens: 4 },
  });
  const sink: StructuredSink<{ ok: boolean }> = {};
  for await (const _ of runStructuredStreaming({
    llm,
    model: "m1",
    baseMessages: [{ role: "user", content: "hello" }],
    opts: {
      maxTokens: 4_096,
      contextWindowTokens: 131_072,
      onUsageObserved: (sample) => samples.push(sample),
    },
    profile: { kind: "json-zod", schema: z.object({ ok: z.boolean() }) },
    maxRetries: 0,
    callSite: "init.bootstrap",
    lifecycle: createLlmLifecycle("bootstrap_domain"),
    signal: new AbortController().signal,
    onEvent: () => {},
    transport: "non-stream",
  }, sink)) { /* drain */ }

  assert.equal(samples.length, 1);
  assert.ok(samples[0].estimated > 0);
  assert.equal(samples[0].actual, 123);
});
```

`stubLlmClient` is this suite's existing helper; if it is named differently, use whatever
`tests/structured-output.test.ts` already uses to fake a completion — do not add a second
stub.

- [ ] **Step 2: Set the ceiling per request**

Immediately before dispatch, where `params` is built, compute the ceiling from the packed prompt and put it into the options used for retries:

```ts
  const estimatedInput = estimatePreparedMessages(
    params.messages as OpenAI.Chat.ChatCompletionMessageParam[],
    opts.tokenCalibration,
  );
  const perRequestOpts: LlmCallOptions = opts.contextWindowTokens === undefined
    ? opts
    : { ...opts, outputRetryBudgetTokens: outputCeiling(opts.contextWindowTokens, estimatedInput) };
```

`contextWindowTokens` was declared in Task 3 Step 1 and is set by Task 7's native branch from
`budget.contextWindow`. When it is absent — the `claude-agent` path — behaviour is exactly as
today, because `perRequestOpts` falls through to `opts` unchanged.

- [ ] **Step 3: Report usage**

In `emitBudget`, after the existing `createPromptBudgetEvent` call:

```ts
  opts.onUsageObserved?.({ estimated: estimatedInput, actual: actualInputTokens });
```

Pass `contextWindow`, `inputSource`, `outputSource` and `calibration` into the same `createPromptBudgetEvent` call so one record carries both the estimate and the actual.

- [ ] **Step 4: Run and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: baseline plus three new tests.

```bash
git add src/phases/structured-output.ts src/types.ts tests/structured-output.test.ts
git commit -m "fix: let a truncated generation retry with a per-request output ceiling"
```

---

### Task 12: Settings rendering and strings

**Files:**
- Modify: `src/settings.ts:296-320` (`addBudgetControl`), `:339-386`, `:769-790`, `:885-900`
- Modify: `src/i18n.ts` (en, ru, es)
- Test: `tests/settings-model-controls.test.ts`

**Interfaces:**
- Consumes: optional native budgets (Task 7).
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Append to `tests/settings-model-controls.test.ts`:

```ts
test("an automatic budget still renders a control", () => {
  const rendered = renderNativeBudgetControls({ inputBudgetTokens: undefined });
  assert.equal(rendered.length, 1, "an undefined value must not hide the field");
  assert.equal(rendered[0].value, "");
  assert.ok(rendered[0].placeholder.length > 0, "the placeholder shows the resolved value");
});

test("clearing the field deletes the setting rather than keeping the old number", () => {
  const holder: { inputBudgetTokens?: number } = { inputBudgetTokens: 24_000 };
  applyBudgetInput(holder, "inputBudgetTokens", "");
  assert.equal("inputBudgetTokens" in holder, false);
});
```

Extract `renderNativeBudgetControls` and `applyBudgetInput` as small exported helpers so the UI logic is testable without Obsidian.

- [ ] **Step 2: Remove the guard that hides automatic fields**

`src/settings.ts:355` returns early when the value is `undefined`, so an automatic budget would render nothing at all. Change `addPolicyControls` to take `number | undefined` and always render, and change the update callbacks to `(next: number | undefined) => void`:

```ts
        inputBudgetTokens: () => {
          if (!updates.inputBudgetTokens) return;
          addBudgetControl(
            new Setting(containerEl)
              .setName(T.settings.inputBudgetTokens_name)
              .setDesc(T.settings.inputBudgetTokens_desc),
            values.inputBudgetTokens,
            updates.inputBudgetTokens,
            String(resolvedAutomaticValue),
          );
        },
```

`addBudgetControl` gains a placeholder parameter and treats an empty string as `undefined`.

- [ ] **Step 3: Move the native budget fields under Advanced**

Render the native `inputBudgetTokens`, `repairInputBudgetTokens`, `maxTokens` and their per-operation counterparts after a heading:

```ts
      new Setting(containerEl).setName(T.settings.advancedBudgets_name).setHeading();
```

`Compression profile` stays where it is: it selects semantics, not arithmetic. The `claude-agent` block is not reordered.

- [ ] **Step 4: Update the strings in all three locales**

In `src/i18n.ts`, add `advancedBudgets_name` and rewrite the descriptions.

English:
```ts
    advancedBudgets_name: "Advanced: manual budgets",
    inputBudgetTokens_desc: "Leave empty for automatic. The budget is derived from the model's context window. Set a value only to override it.",
    outputBudgetTokens_desc: "Leave empty for automatic. Derived per operation from the model's context window.",
    repairInputBudgetTokens_desc: "Leave empty for automatic. Only used when a valid request needs a larger repair prompt.",
```

Russian:
```ts
    advancedBudgets_name: "Дополнительно: ручные бюджеты",
    inputBudgetTokens_desc: "Пусто — автоматически. Бюджет выводится из контекстного окна модели. Задавайте значение только чтобы переопределить его.",
    outputBudgetTokens_desc: "Пусто — автоматически. Выводится по операциям из контекстного окна модели.",
    repairInputBudgetTokens_desc: "Пусто — автоматически. Используется, только когда валидный запрос требует более крупный repair prompt.",
```

Spanish:
```ts
    advancedBudgets_name: "Avanzado: presupuestos manuales",
    inputBudgetTokens_desc: "Vacío significa automático. El presupuesto se deriva de la ventana de contexto del modelo. Defina un valor solo para anularlo.",
    outputBudgetTokens_desc: "Vacío significa automático. Se deriva por operación de la ventana de contexto del modelo.",
    repairInputBudgetTokens_desc: "Vacío significa automático. Solo se usa cuando una solicitud válida requiere un prompt de reparación mayor.",
```

- [ ] **Step 5: Run, build, commit**

Run: `npm run typecheck && npm run lint && npm test 2>&1 | tail -20 && npm run build`
Expected: no errors; the bundle builds.

```bash
git add src/settings.ts src/i18n.ts tests/settings-model-controls.test.ts
git commit -m "feat: render native budgets as advanced fields that default to automatic"
```

---

### Task 13: The one-shot upgrade choice, README and changelog

**Files:**
- Create: `src/auto-budget-notice.ts`
- Modify: `src/main.ts`, `README.md`, `docs/README.ru.md`, `CHANGELOG.md`
- Test: `tests/settings-model-controls.test.ts`

**Interfaces:**
- Consumes: `LocalConfig.migrated_auto_budget` (Task 4).
- Produces: `clearNativeBudgets(settings: LlmWikiPluginSettings): void`, `hasStoredNativeBudget(settings): boolean`.

- [ ] **Step 1: Write the failing test**

Append to `tests/settings-model-controls.test.ts`:

```ts
test("a stored native budget is detected, a claude one is not", () => {
  const settings = defaultSettings();
  assert.equal(hasStoredNativeBudget(settings), false);
  settings.nativeAgent.inputBudgetTokens = 16_384;
  assert.equal(hasStoredNativeBudget(settings), true);
});

test("accepting clears only the native budgets", () => {
  const settings = defaultSettings();
  settings.nativeAgent.inputBudgetTokens = 24_000;
  settings.nativeAgent.operations.init.maxTokens = 8_192;
  const claudeBefore = { ...settings.claudeAgent };
  clearNativeBudgets(settings);
  assert.equal(settings.nativeAgent.inputBudgetTokens, undefined);
  assert.equal(settings.nativeAgent.operations.init.maxTokens, undefined);
  assert.deepEqual(settings.claudeAgent, claudeBefore, "claude-agent must be untouched");
});
```

- [ ] **Step 2: Implement the helpers and the modal**

Create `src/auto-budget-notice.ts` with `hasStoredNativeBudget`, `clearNativeBudgets` (pure, exported, tested) and an Obsidian `Modal` subclass offering two buttons. The modal is a thin shell; all logic lives in the two pure functions.

- [ ] **Step 3: Ask once on load**

In `src/main.ts`, beside the existing migrations:

```ts
    const local = await this.localConfig.load();
    if (!local.migrated_auto_budget) {
      if (hasStoredNativeBudget(this.settings)) {
        await new AutoBudgetNoticeModal(this.app, async (switchToAutomatic) => {
          if (switchToAutomatic) {
            clearNativeBudgets(this.settings);
            await this.saveSettings();
          }
          await this.localConfig.save({ migrated_auto_budget: true });
        }).openAndWait();
      } else {
        await this.localConfig.save({ migrated_auto_budget: true });
      }
    }
```

Nothing is written before the user answers. A fresh installation has no stored values, so it never sees the modal.

- [ ] **Step 4: Update both READMEs**

Run:
```bash
grep -n "budget\|бюджет\|16384\|Input budget" README.md docs/README.ru.md
```

Rewrite those sections: input and output budgets are automatic, derived from the model's context window, discovered once per model and cached, self-correcting against the provider's reported usage; manual override lives under Advanced and empty means automatic; this applies to the native backend, while the Claude Agent CLI backend is unchanged. Keep both files equivalent — only the language differs.

- [ ] **Step 5: Add the changelog entry**

Follow the existing format. Cover: automatic budgets for the native backend; the estimator counts tokens rather than serialized bytes; Init no longer fails with `domain was not created` because of source size; chunk boundaries moved, so an existing domain should be rebuilt with `Init --force`; the upgrade asks once before changing saved budgets.

- [ ] **Step 6: Run and commit**

Run: `npm run typecheck && npm test 2>&1 | tail -20`
Expected: baseline plus the new tests.

```bash
git add src/auto-budget-notice.ts src/main.ts README.md docs/README.ru.md CHANGELOG.md tests/settings-model-controls.test.ts
git commit -m "feat: ask once before switching stored budgets to automatic"
```

---

### Task 14: Live verification against the intent

Automated tests do not satisfy the intent's "Done when". Four checks, none of which substitutes for another.

**Files:**
- Modify: `docs/superpowers/evals/prompt-budget-automation-baseline.md`

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

Ask the user before running this — it touches their vault.

```bash
cd "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki" \
  && mv agent.jsonl agent.jsonl.pre-budget-automation
```

- [ ] **Step 3: Ask the user to run Init**

The user reloads the plugin, answers the upgrade notice with "switch to automatic", and runs `init os-mac --force --sources ОС/Mac/`. This cannot be automated from here.

- [ ] **Step 4: Check 1 — the run succeeded**

Run:
```bash
cd "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki" \
  && jq -r '.history[-1] | "\(.operation) \(.status)"' data.json
```
Expected: `init done`. Not `ok` — `RunHistoryEntry.status` has no such value.

- [ ] **Step 5: Check 2 — the estimate tracks the provider**

Read both numbers off the same record, never two streams by position:

```bash
cd "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki" \
  && jq -c 'select(.event.kind=="prompt_budget" and .event.actualInputTokens != null)
            | {id: .event.requestId, est: .event.estimatedInputTokens,
               act: .event.actualInputTokens,
               ratio: (.event.estimatedInputTokens / .event.actualInputTokens)}' agent.jsonl
```
Expected: every `ratio` between 0.85 and 1.15. Below 0.85 is the intent's halt condition: stop and recalibrate `src/token-estimate.ts`.

- [ ] **Step 6: Check 3 — the budget source and size**

```bash
cd "/home/ikeniborn/Documents/Project/notes/vaults/Work/.obsidian/plugins/ai-wiki" \
  && jq -c 'select(.event.kind=="budget_resolved" or .event.kind=="context_probe") | .event' agent.jsonl | head
```
Expected: a `context_probe` with `ok: true` and `matchedById: true`, and a `budget_resolved` with `inputSource` other than `default` and `inputBudget` above 16384.

- [ ] **Step 7: Check 4 — split and overflow recovery, separately**

Split: temporarily set the Advanced input budget override low enough to force groups, re-run Init, and confirm `evidence_split` with `groups > 1` plus a created domain. Then clear the override.

Overflow recovery: set the override above the model's real window, re-run, and confirm the run still completes and `agent.jsonl` shows a `prompt_budget` with `retryReason: "provider_context_error"` and no error surfaced. This proves recovery; check 2 measures the estimator and proves nothing about it.

- [ ] **Step 8: Confirm the settings UI**

Ask the user to confirm that the main settings section shows no native `Input budget tokens`, `Output budget tokens` or `Repair input budget`; that all three appear under Advanced; that all three are empty; and that each shows the resolved automatic value as a placeholder.

- [ ] **Step 9: Record the evidence and commit**

Append the recorded numbers under a new `## After` heading in the baseline file.

```bash
git add docs/superpowers/evals/prompt-budget-automation-baseline.md
git commit -m "test: record live verification of automatic prompt budgets"
```

---

## Verification Summary

| Intent Desired Outcome | Verified by |
|---|---|
| Init `os-mac` completes with `status: done` | Task 14 Step 4 |
| Estimate within ~15% of the provider count | Task 2 Step 5, Task 14 Step 5 |
| No `domain was not created` because of input size | Task 9 Step 1, Task 10 Steps 3-4 |
| Native budget fields out of the main section, empty means automatic | Task 12 Steps 1-3, Task 14 Step 8 |
| The upgrade asks once and rewrites nothing without an answer | Task 13 Steps 1-3 |
| ≥16k real tokens when discovery reports a window, with the source recorded | Task 5 Step 1, Task 14 Step 6 |
| `finish_reason=length` retries with a larger limit | Task 11 Steps 1-2 |

| Intent Health Metric | Verified by |
|---|---|
| Evidence completeness | Task 9 Step 6 (existing coverage assertions) |
| Create/update decision accuracy | Task 3 Step 7, Task 9 Step 6 against the Task 1 baseline |
| Existing section preservation | Task 9 Step 6 |
| Zero unrecovered context-overflow errors | Task 14 Step 7, second half |
| LLM call count per entry point | Task 1 Step 3 baseline against Task 9 Step 6 |
| Persisted settings compatibility | Task 13 Steps 1-3 |
| `claude-agent` path unchanged | Task 7 Steps 1-2 and its fourth test, Task 8 Step 6, Task 13 Step 1 |

| Spec §9 defect | Fixed by |
|---|---|
| 1 migration guessed intent | Task 13 |
| 2 fallback could not deliver ≥16k | Task 5, and the intent's conditional outcome |
| 3 output automation contradictory | Task 5, Task 7 |
| 4 calibration loop open | Task 3 Steps 1-3, Task 8 Step 5 |
| 5 runtime wiring unplanned | Task 8 |
| 6 "one candidate always fits" false | Task 9 Steps 1, 3 |
| 7 static output ceiling | Task 11 Step 2 |
| 8 empty settings fields vanish | Task 12 Step 2 |
| 9 claude-agent modified | Task 7 Step 1 |
| 10 probe could adopt another model's window | Task 4 Steps 2, 4 |
| 11 verification unsound | Task 1 Step 3, Task 14 Steps 4-7 |
