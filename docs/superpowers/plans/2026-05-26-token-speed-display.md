---
review:
  plan_hash: 03f231ae97820461
  spec_hash: 8d268ca3f464e885
  last_run: "2026-05-26"
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings:
    - id: F-001
      phase: verifiability
      severity: WARNING
      section: "Task 7"
      section_hash: 9988ce05d039c714
      text: "`buildSpeedText()` is a pure function with non-trivial logic (median, division guard, aggregation) but Task 7 has no unit test for it. DoD relies on `tsc --noEmit` only."
      verdict: fixed
      verdict_at: "2026-05-26"
      fix: "Extracted `computeSpeedText` into `llm-utils.ts` (Task 2 Step 3c); tests added to Task 2 Step 1; `buildSpeedText()` delegates to it (Task 7 Step 6)."
    - id: F-002
      phase: consistency
      severity: WARNING
      section: "Task 7 Step 3"
      section_hash: 9988ce05d039c714
      text: "Plan uses early return before `stepCount++`; spec pseudo-code shows `else if` after `stepCount++`. Plan behavior is semantically correct (llm_call_stats is metadata, not a visible step) but deviates from literal spec."
      verdict: accepted
      verdict_at: "2026-05-26"
      fix: "Added explicit rationale note in Task 7 Step 3: early return is intentional to avoid counting stats events as visible pipeline steps."
---

# Token Speed Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the incorrect `outputTokens / totalDurationMs` speed metric with accurate per-LLM-call timing using a new `llm_call_stats` RunEvent, displaying aggregated `in: X · out: Y tok/s · latency: Zms` in the sidebar.

**Architecture:** A new `wrapStreamWithStats` utility in `llm-utils.ts` wraps each OpenAI streaming call, measuring true TTFT (time from before `create()` to first chunk) and `llmDurationMs` (first to last chunk). Each phase emits a `llm_call_stats` RunEvent after its stream completes; `view.ts` accumulates all stats per operation and builds the display string in `finish()`.

**Tech Stack:** TypeScript, Vitest (existing), OpenAI SDK (existing)

---

## File Map

| File | Change |
|------|--------|
| `src/types.ts` | Add `llm_call_stats` variant; remove `usdCost?` from `result` |
| `src/stream.ts` | Remove `usdCost` from `mapResult` |
| `src/phases/llm-utils.ts` | Add `inputTokens` to `extractStreamDeltas`; add `LlmStreamStats`, `wrapStreamWithStats`, `buildLlmCallStatsEvent` |
| `src/phases/parse-with-retry.ts` | `streamOnce` uses wrapper, returns stats; `parseWithRetry` emits stats event |
| `src/phases/query.ts` | Wrap streaming call, yield stats event |
| `src/phases/chat.ts` | Wrap streaming call, yield stats event |
| `src/phases/format.ts` | Wrap streaming call in `callOnce`, yield stats event |
| `src/view.ts` | Replace `lastTokPerSec` with `llmStats[]`, add `buildSpeedText()`, add `llm_call_stats` handler |
| `src/controller.ts` | Add `_llmCallIndex` class field, reset per dispatch, add `callIndex` to `logEvent` |
| `tests/llm-utils.test.ts` | Add tests for `extractStreamDeltas` inputTokens, `wrapStreamWithStats`, `buildLlmCallStatsEvent` |
| `tests/parse-with-retry.test.ts` | Create: test that `parseWithRetry` emits `llm_call_stats` event |
| `tests/llm-utils.test.ts` | Also add tests for `computeSpeedText` (median, aggregation, edge cases) |

---

## Task 1: Update types — add `llm_call_stats`, remove `usdCost`

**Files:**
- Modify: `src/types.ts:46`
- Modify: `src/stream.ts:97`

- [ ] **Step 1: Edit `src/types.ts`**

  Replace line 46 (the `result` variant):
  ```typescript
  // Before:
  | { kind: "result"; durationMs: number; usdCost?: number; text: string; outputTokens?: number }
  // After:
  | { kind: "result"; durationMs: number; text: string; outputTokens?: number }
  ```

  Add new variant after the `result` line (after line 46):
  ```typescript
  | {
      kind: "llm_call_stats";
      inputTokens: number;
      outputTokens: number;
      ttftMs: number;
      llmDurationMs: number;
      inTokPerSec: number;
      outTokPerSec: number;
    }
  ```

- [ ] **Step 2: Edit `src/stream.ts`**

  In `mapResult` (line ~97), remove the `usdCost` line:
  ```typescript
  // Remove this line:
  usdCost: typeof obj.total_cost_usd === "number" ? obj.total_cost_usd : undefined,
  ```

  After edit, `mapResult` return object should be:
  ```typescript
  return {
    kind: "result",
    durationMs: Number(obj.duration_ms ?? 0),
    text: typeof obj.result === "string" ? obj.result : "",
    outputTokens,
  };
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd "$LAUNCH_DIR" && npx tsc --noEmit 2>&1 | head -30
  ```
  Expected: no errors (or only pre-existing unrelated errors)

- [ ] **Step 4: Commit**

  ```bash
  cd "$LAUNCH_DIR" && git add src/types.ts src/stream.ts
  git commit -m "feat(types): add llm_call_stats RunEvent; remove usdCost from result"
  ```

---

## Task 2: Add `wrapStreamWithStats` and helpers to `llm-utils.ts`

**Files:**
- Modify: `src/phases/llm-utils.ts`
- Modify: `tests/llm-utils.test.ts`

- [ ] **Step 1: Write failing tests** — add to `tests/llm-utils.test.ts`

  ```typescript
  import {
    extractStreamDeltas, wrapStreamWithStats, buildLlmCallStatsEvent, computeSpeedText,
  } from "../src/phases/llm-utils";
  import type { LlmStreamStats } from "../src/phases/llm-utils";
  import type OpenAI from "openai";
  
  // Helper: create async iterable from array of partial chunks
  function makeStream(chunks: Partial<OpenAI.Chat.ChatCompletionChunk>[]): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
    return {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i >= chunks.length) return { done: true as const, value: undefined };
            return { done: false as const, value: chunks[i++] as OpenAI.Chat.ChatCompletionChunk };
          },
        };
      },
    };
  }
  
  describe("extractStreamDeltas — inputTokens", () => {
    it("extracts prompt_tokens as inputTokens from usage chunk", () => {
      const chunk = {
        choices: [{ delta: {} }],
        usage: { completion_tokens: 20, prompt_tokens: 100 },
      } as unknown as OpenAI.Chat.ChatCompletionChunk;
      const result = extractStreamDeltas(chunk);
      expect(result.inputTokens).toBe(100);
    });
  
    it("returns undefined inputTokens when usage absent", () => {
      const chunk = {
        choices: [{ delta: { content: "hi" } }],
      } as OpenAI.Chat.ChatCompletionChunk;
      const result = extractStreamDeltas(chunk);
      expect(result.inputTokens).toBeUndefined();
    });
  });
  
  describe("wrapStreamWithStats", () => {
    it("yields all chunks from wrapped stream", async () => {
      const chunks = [
        { choices: [{ delta: { content: "hello" } }] },
        { choices: [{ delta: { content: " world" } }] },
        { choices: [{ delta: {} }], usage: { completion_tokens: 5, prompt_tokens: 10 } },
      ];
      const { stream } = wrapStreamWithStats(makeStream(chunks), Date.now());
      const received: unknown[] = [];
      for await (const c of stream) received.push(c);
      expect(received).toHaveLength(3);
    });
  
    it("getStats() returns undefined when stream yields no chunks", async () => {
      const { stream, getStats } = wrapStreamWithStats(makeStream([]), Date.now());
      for await (const _ of stream) { /* drain */ }
      expect(getStats()).toBeUndefined();
    });
  
    it("getStats() returns stats after stream is drained", async () => {
      const chunks = [
        { choices: [{ delta: { content: "a" } }] },
        { choices: [{ delta: {} }], usage: { completion_tokens: 7, prompt_tokens: 15 } },
      ];
      const before = Date.now();
      const { stream, getStats } = wrapStreamWithStats(makeStream(chunks), before);
      for await (const _ of stream) { /* drain */ }
      const stats = getStats();
      expect(stats).toBeDefined();
      expect(stats!.outputTokens).toBe(7);
      expect(stats!.inputTokens).toBe(15);
      expect(stats!.ttftMs).toBeGreaterThanOrEqual(0);
      expect(stats!.llmDurationMs).toBeGreaterThanOrEqual(0);
    });
  });
  
  describe("computeSpeedText", () => {
    it("returns empty string for empty stats array", () => {
      expect(computeSpeedText([])).toBe("");
    });

    it("returns empty string when total llmDurationMs is 0", () => {
      const stats = [{ inputTokens: 100, outputTokens: 50, ttftMs: 100, llmDurationMs: 0 }];
      expect(computeSpeedText(stats)).toBe("");
    });

    it("formats single call correctly", () => {
      // 200 in / 2s = 100 in tok/s; 100 out / 2s = 50 out tok/s; median ttft = 300ms
      const stats = [{ inputTokens: 200, outputTokens: 100, ttftMs: 300, llmDurationMs: 2000 }];
      expect(computeSpeedText(stats)).toBe(" in: 100 · out: 50 tok/s · latency: 300ms");
    });

    it("aggregates multiple calls and uses median TTFT", () => {
      const stats = [
        { inputTokens: 100, outputTokens: 50, ttftMs: 500, llmDurationMs: 1000 },
        { inputTokens: 100, outputTokens: 50, ttftMs: 200, llmDurationMs: 1000 },
        { inputTokens: 100, outputTokens: 50, ttftMs: 300, llmDurationMs: 1000 },
      ];
      // sorted ttftMs: [200, 300, 500], median index = floor(3/2) = 1 → 300ms
      // total: 300 in / 3s = 100 tok/s; 150 out / 3s = 50 tok/s
      const result = computeSpeedText(stats);
      expect(result).toContain("latency: 300ms");
      expect(result).toContain("in: 100");
      expect(result).toContain("out: 50");
    });
  });

  describe("buildLlmCallStatsEvent", () => {
    it("computes tok/s from duration", () => {
      const s: LlmStreamStats = { inputTokens: 200, outputTokens: 100, ttftMs: 300, llmDurationMs: 2000 };
      const ev = buildLlmCallStatsEvent(s);
      expect(ev.kind).toBe("llm_call_stats");
      expect(ev.inTokPerSec).toBe(100);  // 200 / 2
      expect(ev.outTokPerSec).toBe(50);  // 100 / 2
    });
  
    it("returns 0 tok/s when llmDurationMs is 0", () => {
      const s: LlmStreamStats = { inputTokens: 100, outputTokens: 50, ttftMs: 100, llmDurationMs: 0 };
      const ev = buildLlmCallStatsEvent(s);
      expect(ev.inTokPerSec).toBe(0);
      expect(ev.outTokPerSec).toBe(0);
    });
  });
  ```

- [ ] **Step 2: Run tests to confirm they fail**

  ```bash
  cd "$LAUNCH_DIR" && npx vitest run tests/llm-utils.test.ts 2>&1 | tail -20
  ```
  Expected: failures on `wrapStreamWithStats`, `buildLlmCallStatsEvent`, `computeSpeedText`, and `extractStreamDeltas inputTokens`

- [ ] **Step 3: Implement changes in `src/phases/llm-utils.ts`**

  3a. Add `RunEvent` to the import from `../types` (line 2):
  ```typescript
  import type { LlmCallOptions, LlmClient, RunEvent } from "../types";
  ```

  3b. Update `extractStreamDeltas` return type and body. Replace the existing function (lines 34-45):
  ```typescript
  export function extractStreamDeltas(chunk: OpenAI.Chat.ChatCompletionChunk): {
    reasoning: string; content: string; outputTokens?: number; inputTokens?: number;
  } {
    const delta = chunk.choices[0]?.delta;
    const rawReasoning = (delta as Record<string, unknown> | undefined)?.reasoning
      ?? (delta as Record<string, unknown> | undefined)?.reasoning_content;
    const usage = (chunk as unknown as { usage?: { completion_tokens?: number; prompt_tokens?: number } }).usage;
    const outputTokens = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : undefined;
    const inputTokens = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
    return {
      reasoning: typeof rawReasoning === "string" ? rawReasoning : "",
      content: typeof delta?.content === "string" ? delta.content : "",
      outputTokens,
      inputTokens,
    };
  }
  ```

  3c. Add new exports at the end of the file (after `injectSystemPrompt`):
  ```typescript
  export interface LlmStreamStats {
    inputTokens: number;
    outputTokens: number;
    ttftMs: number;
    llmDurationMs: number;
  }
  
  export function wrapStreamWithStats(
    stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
    requestStartMs: number,
  ): {
    stream: AsyncIterable<OpenAI.Chat.ChatCompletionChunk>;
    getStats(): LlmStreamStats | undefined;
  } {
    let ttftMs: number | undefined;
    let firstChunkMs: number | undefined;
    let llmDurationMs: number | undefined;
    let inputTokens = 0;
    let outputTokens = 0;
    let yielded = false;
  
    async function* wrapped(): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
      for await (const chunk of stream) {
        if (!yielded) {
          ttftMs = Date.now() - requestStartMs;
          firstChunkMs = Date.now();
          yielded = true;
        }
        const { outputTokens: tok, inputTokens: inTok } = extractStreamDeltas(chunk);
        if (tok !== undefined) outputTokens = tok;
        if (inTok !== undefined) inputTokens = inTok;
        yield chunk;
      }
      if (yielded && firstChunkMs !== undefined) {
        llmDurationMs = Date.now() - firstChunkMs;
      }
    }
  
    const wrappedStream = wrapped();
  
    return {
      stream: wrappedStream,
      getStats(): LlmStreamStats | undefined {
        if (!yielded || ttftMs === undefined || llmDurationMs === undefined) return undefined;
        return { inputTokens, outputTokens, ttftMs, llmDurationMs };
      },
    };
  }
  
  export function buildLlmCallStatsEvent(s: LlmStreamStats): RunEvent {
    const durS = s.llmDurationMs / 1000;
    return {
      kind: "llm_call_stats",
      ...s,
      inTokPerSec: durS > 0 ? Math.round(s.inputTokens / durS) : 0,
      outTokPerSec: durS > 0 ? Math.round(s.outputTokens / durS) : 0,
    };
  }

  export function computeSpeedText(stats: Array<{
    inputTokens: number; outputTokens: number;
    ttftMs: number; llmDurationMs: number;
  }>): string {
    if (!stats.length) return "";
    const totalIn = stats.reduce((s, x) => s + x.inputTokens, 0);
    const totalOut = stats.reduce((s, x) => s + x.outputTokens, 0);
    const totalDurS = stats.reduce((s, x) => s + x.llmDurationMs, 0) / 1000;
    const sorted = [...stats.map(x => x.ttftMs)].sort((a, b) => a - b);
    const medTtft = sorted[Math.floor(sorted.length / 2)];
    if (totalDurS <= 0) return "";
    const inS = Math.round(totalIn / totalDurS);
    const outS = Math.round(totalOut / totalDurS);
    return ` in: ${inS} · out: ${outS} tok/s · latency: ${medTtft}ms`;
  }
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  cd "$LAUNCH_DIR" && npx vitest run tests/llm-utils.test.ts 2>&1 | tail -20
  ```
  Expected: all tests pass

- [ ] **Step 5: Run full test suite to check for regressions**

  ```bash
  cd "$LAUNCH_DIR" && npx vitest run 2>&1 | tail -20
  ```
  Expected: no new failures

- [ ] **Step 6: Commit**

  ```bash
  cd "$LAUNCH_DIR" && git add src/phases/llm-utils.ts tests/llm-utils.test.ts
  git commit -m "feat(llm-utils): add wrapStreamWithStats, buildLlmCallStatsEvent; extract inputTokens"
  ```

---

## Task 3: Update `parse-with-retry.ts` to emit `llm_call_stats`

**Files:**
- Modify: `src/phases/parse-with-retry.ts`
- Create: `tests/parse-with-retry.test.ts`

- [ ] **Step 1: Write failing test** — create `tests/parse-with-retry.test.ts`

  ```typescript
  import { describe, it, expect } from "vitest";
  import { z } from "zod";
  import { parseWithRetry } from "../src/phases/parse-with-retry";
  import type { LlmClient, RunEvent } from "../src/types";
  import type OpenAI from "openai";
  
  function makeStream(chunks: Partial<OpenAI.Chat.ChatCompletionChunk>[]): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
    return {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            if (i >= chunks.length) return { done: true as const, value: undefined };
            return { done: false as const, value: chunks[i++] as OpenAI.Chat.ChatCompletionChunk };
          },
        };
      },
    };
  }
  
  function makeLlm(chunks: Partial<OpenAI.Chat.ChatCompletionChunk>[]): LlmClient {
    return {
      chat: {
        completions: {
          create: async () => makeStream(chunks) as AsyncIterable<OpenAI.Chat.ChatCompletionChunk>,
        } as LlmClient["chat"]["completions"],
      },
    };
  }
  
  describe("parseWithRetry — llm_call_stats emission", () => {
    it("emits llm_call_stats event on successful parse", async () => {
      const chunks = [
        { choices: [{ delta: { content: '{"x":1}' } }] },
        { choices: [{ delta: {} }], usage: { completion_tokens: 10, prompt_tokens: 8 } },
      ];
      const events: RunEvent[] = [];
      const result = await parseWithRetry({
        llm: makeLlm(chunks),
        model: "m",
        baseMessages: [{ role: "user", content: "q" }],
        opts: {},
        schema: z.object({ x: z.number() }),
        maxRetries: 0,
        callSite: "query.seeds",
        signal: new AbortController().signal,
        onEvent: (ev) => events.push(ev),
      });
      expect(result.value).toEqual({ x: 1 });
      const statsEvents = events.filter(e => e.kind === "llm_call_stats");
      expect(statsEvents).toHaveLength(1);
      const s = statsEvents[0] as Extract<RunEvent, { kind: "llm_call_stats" }>;
      expect(s.outputTokens).toBe(10);
      expect(s.inputTokens).toBe(8);
    });
  
    it("does not emit llm_call_stats when stream yields 0 chunks (error fallback)", async () => {
      // Non-streaming fallback: no chunks, direct error → falls through to non-stream path
      // Simulate: stream throws immediately so fallback non-streaming path is used
      const errorLlm: LlmClient = {
        chat: {
          completions: {
            create: ((params: Record<string, unknown>) => {
              if (params.stream) throw new Error("stream error");
              return Promise.resolve({
                choices: [{ message: { content: '{"x":2}' }, finish_reason: "stop" }],
                usage: { completion_tokens: 5 },
              });
            }) as LlmClient["chat"]["completions"]["create"],
          },
        },
      };
      const events: RunEvent[] = [];
      await parseWithRetry({
        llm: errorLlm,
        model: "m",
        baseMessages: [{ role: "user", content: "q" }],
        opts: {},
        schema: z.object({ x: z.number() }),
        maxRetries: 0,
        callSite: "query.seeds",
        signal: new AbortController().signal,
        onEvent: (ev) => events.push(ev),
      });
      const statsEvents = events.filter(e => e.kind === "llm_call_stats");
      expect(statsEvents).toHaveLength(0);
    });
  });
  ```

- [ ] **Step 2: Run to confirm it fails**

  ```bash
  cd "$LAUNCH_DIR" && npx vitest run tests/parse-with-retry.test.ts 2>&1 | tail -20
  ```
  Expected: fails (wrapStreamWithStats not used, stats not emitted)

- [ ] **Step 3: Update `src/phases/parse-with-retry.ts`**

  3a. Update the import from `./llm-utils` (line 6) to include new exports:
  ```typescript
  import {
    parseStructured, buildChatParams, extractStreamDeltas, extractUsage,
    wrapStreamWithStats, buildLlmCallStatsEvent,
  } from "./llm-utils";
  import type { LlmStreamStats } from "./llm-utils";
  ```

  3b. Replace the `streamOnce` function (lines 68-100) with:
  ```typescript
  async function streamOnce(
    llm: LlmClient,
    model: string,
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    opts: LlmCallOptions,
    signal: AbortSignal,
  ): Promise<{ fullText: string; outputTokens: number; stats: LlmStreamStats | undefined }> {
    const params = buildChatParams(model, messages, opts, true);
    let fullText = "";
    let outputTokens = 0;
    try {
      const requestStartMs = Date.now();
      const rawStream = await llm.chat.completions.create(
        { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      );
      const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
      for await (const chunk of stream) {
        const { content, outputTokens: tok } = extractStreamDeltas(chunk);
        if (content) fullText += content;
        if (tok !== undefined) outputTokens = tok;
      }
      return { fullText, outputTokens, stats: getStats() };
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") throw e;
      const params2 = buildChatParams(model, messages, opts);
      const resp = await llm.chat.completions.create(
        { ...params2, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
        { signal },
      );
      const text = resp.choices[0]?.message?.content ?? "";
      const tok = extractUsage(resp);
      return { fullText: text, outputTokens: tok ?? 0, stats: undefined };
    }
  }
  ```

  3c. In `parseWithRetry`, update the `streamOnce` call (line ~114) to destructure `stats` and emit the event:
  ```typescript
  // Replace:
  const { fullText, outputTokens } = await streamOnce(llm, model, messages, opts, signal);
  totalTokens += outputTokens;
  
  // With:
  const { fullText, outputTokens, stats } = await streamOnce(llm, model, messages, opts, signal);
  totalTokens += outputTokens;
  if (stats) onEvent(buildLlmCallStatsEvent(stats));
  ```

- [ ] **Step 4: Run tests to confirm they pass**

  ```bash
  cd "$LAUNCH_DIR" && npx vitest run tests/parse-with-retry.test.ts 2>&1 | tail -20
  ```
  Expected: both tests pass

- [ ] **Step 5: Run full suite**

  ```bash
  cd "$LAUNCH_DIR" && npx vitest run 2>&1 | tail -20
  ```
  Expected: no new failures

- [ ] **Step 6: Commit**

  ```bash
  cd "$LAUNCH_DIR" && git add src/phases/parse-with-retry.ts tests/parse-with-retry.test.ts
  git commit -m "feat(parse-with-retry): emit llm_call_stats event per streaming call"
  ```

---

## Task 4: Update `query.ts` streaming call

**Files:**
- Modify: `src/phases/query.ts:134-150`

- [ ] **Step 1: Update imports in `src/phases/query.ts`**

  Find the existing llm-utils import (likely line ~4) and add `wrapStreamWithStats, buildLlmCallStatsEvent`:
  ```typescript
  import { buildChatParams, extractStreamDeltas, extractUsage, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
  ```

- [ ] **Step 2: Wrap the streaming call**

  In `query.ts` at lines ~134-150, there is:
  ```typescript
  const params = buildChatParams(model, messages, opts, true);
  let answer = "";
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { answer += content; yield { kind: "assistant_text", delta: content }; }
      if (tok !== undefined) outputTokens += tok;
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    answer = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (answer) yield { kind: "assistant_text", delta: answer };
  }
  
  if (signal.aborted) return;
  ```

  Replace with:
  ```typescript
  const params = buildChatParams(model, messages, opts, true);
  let answer = "";
  let streamStats: import("./llm-utils").LlmStreamStats | undefined;
  try {
    const requestStartMs = Date.now();
    const rawStream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { answer += content; yield { kind: "assistant_text", delta: content }; }
      if (tok !== undefined) outputTokens += tok;
    }
    streamStats = getStats();
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    answer = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (answer) yield { kind: "assistant_text", delta: answer };
  }
  
  if (signal.aborted) return;
  if (streamStats) yield buildLlmCallStatsEvent(streamStats);
  ```

- [ ] **Step 3: Verify TypeScript and tests**

  ```bash
  cd "$LAUNCH_DIR" && npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -10
  ```
  Expected: no new TS errors or test failures

- [ ] **Step 4: Commit**

  ```bash
  cd "$LAUNCH_DIR" && git add src/phases/query.ts
  git commit -m "feat(query): wrap streaming call with stats measurement"
  ```

---

## Task 5: Update `chat.ts` streaming call

**Files:**
- Modify: `src/phases/chat.ts:4,36-50`

- [ ] **Step 1: Update imports in `src/phases/chat.ts`** (line 4)

  ```typescript
  import { buildChatParams, extractStreamDeltas, extractUsage, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
  import type { LlmStreamStats } from "./llm-utils";
  ```

- [ ] **Step 2: Wrap the streaming call**

  In `chat.ts` at lines ~36-50, there is:
  ```typescript
  const params = buildChatParams(model, messages, opts, true);
  let fullText = "";
  let outputTokens = 0;
  
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
      if (tok !== undefined) outputTokens += tok;
    }
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (fullText) yield { kind: "assistant_text", delta: fullText };
  }
  
  if (signal.aborted) return;
  yield { kind: "result", durationMs: Date.now() - start, text: fullText, outputTokens: outputTokens || undefined };
  ```

  Replace with:
  ```typescript
  const params = buildChatParams(model, messages, opts, true);
  let fullText = "";
  let outputTokens = 0;
  let streamStats: LlmStreamStats | undefined;
  
  try {
    const requestStartMs = Date.now();
    const rawStream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
    for await (const chunk of stream) {
      const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
      if (content) { fullText += content; yield { kind: "assistant_text", delta: content }; }
      if (tok !== undefined) outputTokens += tok;
    }
    streamStats = getStats();
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const resp = await llm.chat.completions.create(
      { ...params, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    if (tok !== undefined) outputTokens += tok;
    if (fullText) yield { kind: "assistant_text", delta: fullText };
  }
  
  if (signal.aborted) return;
  if (streamStats) yield buildLlmCallStatsEvent(streamStats);
  yield { kind: "result", durationMs: Date.now() - start, text: fullText, outputTokens: outputTokens || undefined };
  ```

- [ ] **Step 3: Verify TypeScript and tests**

  ```bash
  cd "$LAUNCH_DIR" && npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -10
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd "$LAUNCH_DIR" && git add src/phases/chat.ts
  git commit -m "feat(chat): wrap streaming call with stats measurement"
  ```

---

## Task 6: Update `format.ts` streaming call in `callOnce`

**Files:**
- Modify: `src/phases/format.ts:4,122-150`

- [ ] **Step 1: Update imports in `src/phases/format.ts`** (line 4)

  ```typescript
  import { buildChatParams, extractStreamDeltas, extractUsage, parseStructured, wrapStreamWithStats, buildLlmCallStatsEvent } from "./llm-utils";
  import type { LlmStreamStats } from "./llm-utils";
  ```

- [ ] **Step 2: Wrap the streaming call inside `callOnce`**

  Inside `callOnce`, there is:
  ```typescript
  async function* callOnce(p: Record<string, unknown>): AsyncGenerator<RunEvent, string> {
    let acc = "";
    lastFinishReason = null;
    try {
      const stream = await llm.chat.completions.create(
        { ...p, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      );
      for await (const chunk of stream) {
        const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
        if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) { acc += content; yield { kind: "assistant_text", delta: content }; }
        if (tok !== undefined) outputTokens += tok;
        const fr = chunk.choices[0]?.finish_reason;
        if (fr) lastFinishReason = fr;
      }
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") return acc;
      const resp = await llm.chat.completions.create(
        { ...p, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      );
      acc = resp.choices[0]?.message?.content ?? "";
      const tok = extractUsage(resp);
      if (tok !== undefined) outputTokens += tok;
      lastFinishReason = resp.choices[0]?.finish_reason ?? null;
    }
    return acc;
  }
  ```

  Replace with:
  ```typescript
  async function* callOnce(p: Record<string, unknown>): AsyncGenerator<RunEvent, string> {
    let acc = "";
    lastFinishReason = null;
    let callStats: LlmStreamStats | undefined;
    try {
      const requestStartMs = Date.now();
      const rawStream = await llm.chat.completions.create(
        { ...p, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal },
      );
      const { stream, getStats } = wrapStreamWithStats(rawStream, requestStartMs);
      for await (const chunk of stream) {
        const { reasoning, content, outputTokens: tok } = extractStreamDeltas(chunk);
        if (reasoning) yield { kind: "assistant_text", delta: reasoning, isReasoning: true };
        if (content) { acc += content; yield { kind: "assistant_text", delta: content }; }
        if (tok !== undefined) outputTokens += tok;
        const fr = chunk.choices[0]?.finish_reason;
        if (fr) lastFinishReason = fr;
      }
      callStats = getStats();
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") return acc;
      const resp = await llm.chat.completions.create(
        { ...p, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      );
      acc = resp.choices[0]?.message?.content ?? "";
      const tok = extractUsage(resp);
      if (tok !== undefined) outputTokens += tok;
      lastFinishReason = resp.choices[0]?.finish_reason ?? null;
    }
    if (callStats) yield buildLlmCallStatsEvent(callStats);
    return acc;
  }
  ```

  Note: `callOnce` is called twice (main call + retry). Each call emits its own `llm_call_stats` event — this is correct per the spec.

- [ ] **Step 3: Verify TypeScript and tests**

  ```bash
  cd "$LAUNCH_DIR" && npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -10
  ```

- [ ] **Step 4: Commit**

  ```bash
  cd "$LAUNCH_DIR" && git add src/phases/format.ts
  git commit -m "feat(format): wrap streaming call in callOnce with stats measurement"
  ```

---

## Task 7: Update `view.ts` — accumulator and `buildSpeedText`

**Files:**
- Modify: `src/view.ts:73-74, 493-494, 583, 675-680, 771`

- [ ] **Step 1: Replace `lastTokPerSec` field with `llmStats` array**

  At line 73:
  ```typescript
  // Remove:
  private lastTokPerSec: number | undefined;
  
  // Add:
  private llmStats: Array<{
    inputTokens: number; outputTokens: number;
    ttftMs: number; llmDurationMs: number;
  }> = [];
  ```

- [ ] **Step 2: Reset `llmStats` on operation start**

  Find the reset block (around line 493) where `this.lastTokPerSec = undefined;` and `this.resultSpeedEl?.setText("");` appear. Replace:
  ```typescript
  // Remove:
  this.lastTokPerSec = undefined;
  this.resultSpeedEl?.setText("");
  
  // Add:
  this.llmStats = [];
  this.resultSpeedEl?.setText("");
  ```

- [ ] **Step 3: Add `llm_call_stats` handler in `appendEvent`**

  In `appendEvent`, before the `stepCount++` line (~line 583), add an early-return handler:
  ```typescript
  // Add before: if (ev.kind !== "assistant_text") this.stepCount++;
  if (ev.kind === "llm_call_stats") { this.llmStats.push(ev); return; }
  ```

  **Note:** Early return (before `stepCount++`) is intentional — `llm_call_stats` is timing metadata, not a user-visible pipeline step. Incrementing `stepCount` for it would skew the step counter displayed in the sidebar. The spec's pseudo-code shows `else if` (after `stepCount++`) which would incorrectly count stats events as visible steps; this plan deviates deliberately.

- [ ] **Step 4: Remove old `lastTokPerSec` computation from `result` handler**

  In the `result` event handler (~lines 675-679):
  ```typescript
  // Remove:
  } else if (ev.kind === "result") {
    this.stopWaiting();
    if (ev.outputTokens !== undefined && ev.durationMs > 0) {
      this.lastTokPerSec = Math.round(ev.outputTokens / (ev.durationMs / 1000));
    }
  
  // Replace with:
  } else if (ev.kind === "result") {
    this.stopWaiting();
  ```

- [ ] **Step 5: Update `finish()` to use `buildSpeedText()`**

  At line ~771, replace:
  ```typescript
  // Remove:
  this.resultSpeedEl?.setText(this.lastTokPerSec !== undefined ? ` ${this.lastTokPerSec} tok/s` : "");
  
  // Add:
  this.resultSpeedEl?.setText(this.buildSpeedText());
  ```

- [ ] **Step 6: Add `buildSpeedText()` method and import `computeSpeedText`**

  Add import at the top of `src/view.ts`:
  ```typescript
  import { computeSpeedText } from "./phases/llm-utils";
  ```

  Add this private method to the `LlmWikiView` class (e.g., after `finish()`):
  ```typescript
  private buildSpeedText(): string {
    return computeSpeedText(this.llmStats);
  }
  ```

  The core aggregation/median logic lives in `computeSpeedText` (exported from `llm-utils.ts`, tested in Task 2). No logic duplication here.

- [ ] **Step 7: Verify TypeScript and tests**

  ```bash
  cd "$LAUNCH_DIR" && npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -10
  ```
  Expected: no errors or new test failures

- [ ] **Step 8: Commit**

  ```bash
  cd "$LAUNCH_DIR" && git add src/view.ts
  git commit -m "feat(view): replace lastTokPerSec with llmStats accumulator and buildSpeedText"
  ```

---

## Task 8: Update `controller.ts` — `callIndex` and `logEvent`

**Files:**
- Modify: `src/controller.ts:536-560, 615-640`

- [ ] **Step 1: Add `_llmCallIndex` class field**

  In the `WikiController` class, add a new private field (near the other private fields):
  ```typescript
  private _llmCallIndex = 0;
  ```

- [ ] **Step 2: Reset `_llmCallIndex` at start of `dispatch()`**

  In `dispatch()` (line ~615), after the `const startedAt = Date.now();` line, add:
  ```typescript
  this._llmCallIndex = 0;
  ```

- [ ] **Step 3: Update `logEvent` to add `callIndex` and remove `tokPerSec`**

  In `logEvent` (line ~536-558), replace the `extra` computation:
  ```typescript
  // Remove:
  const extra = ev.kind === "result" && ev.outputTokens !== undefined && ev.durationMs > 0
    ? { tokPerSec: Math.round(ev.outputTokens / (ev.durationMs / 1000)) }
    : {};
  
  // Add:
  const extra = ev.kind === "llm_call_stats"
    ? { callIndex: this._llmCallIndex++ }
    : {};
  ```

- [ ] **Step 4: Verify TypeScript and tests**

  ```bash
  cd "$LAUNCH_DIR" && npx tsc --noEmit 2>&1 | head -20 && npx vitest run 2>&1 | tail -10
  ```
  Expected: no errors or new failures

- [ ] **Step 5: Commit**

  ```bash
  cd "$LAUNCH_DIR" && git add src/controller.ts
  git commit -m "feat(controller): add callIndex to llm_call_stats log entries"
  ```

---

## Task 9: Final verification

- [ ] **Step 1: Run full test suite**

  ```bash
  cd "$LAUNCH_DIR" && npx vitest run 2>&1 | tail -30
  ```
  Expected: all tests pass

- [ ] **Step 2: Build the plugin**

  ```bash
  cd "$LAUNCH_DIR" && npm run build 2>&1 | tail -20
  ```
  Expected: clean build, no errors

- [ ] **Step 3: Manual verification checklist** (requires Obsidian with native backend)

  1. Run ingest on native backend → result block shows `in: X · out: Y tok/s · latency: Zms`
  2. Run query → same display format
  3. Switch to claude-cli backend → speed block is empty (no `llm_call_stats` emitted)
  4. Check `!Wiki/_config/agent.jsonl` → `llm_call_stats` lines with sequential `callIndex` values (0, 1, 2, ...)
  5. Verify no `usdCost` field appears anywhere in the log
  6. Verify no `tokPerSec` field in log entries

- [ ] **Step 4: Update lat.md documentation**

  ```bash
  _lat="${CLAUDE_CONFIG_DIR}/scripts/lat-runner.sh"
  cd "$LAUNCH_DIR"
  ```

  Update `lat.md/architecture.md` → `Run Events` section to mention `llm_call_stats`.
  Update `lat.md/llm-pipeline.md` → `Streaming` section to mention `wrapStreamWithStats`.

  Then run:
  ```bash
  "$_lat" check 2>&1 | tail -20
  ```
  Expected: all checks pass
