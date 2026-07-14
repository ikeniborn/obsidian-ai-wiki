---
review:
  plan_hash: c0eff2a1a81917d7
  spec_hash: 78515e8557574167
  last_run: 2026-07-14
  phases:
    structure: { status: passed }
    coverage: { status: passed }
    dependencies: { status: passed }
    verifiability: { status: passed }
    consistency: { status: passed }
  findings: []
chain:
  intent: docs/superpowers/intents/2026-07-14-structured-output-pipeline-resilience-intent.md
  spec: docs/superpowers/specs/2026-07-14-structured-output-pipeline-resilience-design.md
---
# Structured Output Pipeline Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shared structured-output runner with `json-zod` and `framed-zod` profiles so compact structured objects use JSON/Zod fallback while large Markdown/text payloads use framed transport plus Zod validation.

**Architecture:** Add focused frame parsers for large text payloads, then add a shared runner that owns response-format fallback, empty-output detection, repair prompts, live diagnostics, and validation. Keep `parseWithRetry` as the JSON compatibility wrapper, route large payload call sites through framed adapters, and block operation-level destructive retry from replaying `WipeDomain`.

**Tech Stack:** TypeScript, Node built-in `node:test`, `tsx`, Zod, existing `jsonrepair`, OpenAI-compatible chat completions.

---

## File Structure

| File | Change |
|------|--------|
| `src/types.ts` | Extend `structural_error.errorType` with compatible diagnostic labels. |
| `src/phases/framed-output.ts` | New pure parsers for format, page frames, delete frames, merge content, and answer/citations frames. |
| `src/phases/structured-output.ts` | New shared runner, profile types, fallback modes, repair prompt helpers, stream/non-stream call execution. |
| `src/phases/parse-with-retry.ts` | Reduce to compatibility wrapper around `runStructuredWithRetry` with `json-zod`; keep exported `StructuredValidationError` and `CallSite`. |
| `src/phases/format.ts` | Use framed runner for initial format output; keep post-parse token/embed/link/frontmatter/preview flow. |
| `src/phases/ingest.ts` | Route `ingest.pages` and `ingest.merge` through framed profile; keep write/merge/index post-processing. |
| `src/phases/lint.ts` | Route `lint.fix` through framed profile; keep `lint.patch` on JSON profile. |
| `src/phases/lint-chat.ts` | Route page-fix output through framed profile. |
| `src/phases/query-answer.ts` | Route answer repair through framed answer profile. |
| `src/agent-runner.ts` | Prevent operation-level idle retry after destructive prelude events. |
| `src/domain-config.ts` | Stop creating per-domain `_config`; only migrate legacy files if present. |
| `tests/framed-output.test.ts` | New pure parser tests. |
| `tests/structured-output.test.ts` | New runner tests for JSON fallback, framed success/failure, live diagnostics. |
| `tests/init-force-retry.test.ts` | Regression test for one `WipeDomain` per `init --force` run. |
| `tests/no-runtime-domain-config.test.ts` | Static guard against runtime per-domain `_config` creation. |

---

## Task 1: Extend Diagnostics Types

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Update `structural_error.errorType` union**

In `src/types.ts`, replace the `errorType` line inside the `structural_error` event with:

```ts
      errorType:
        | "json_parse"
        | "schema_validate"
        | "empty_output"
        | "response_format_fallback"
        | "frame_parse"
        | "idle_abort";
```

- [ ] **Step 2: Verify type references compile**

```bash
npx tsc --noEmit
```

Expected: typecheck may still pass because no code emits the new labels yet. If unrelated compile errors appear, stop and inspect before continuing.

- [ ] **Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): expand structured output diagnostics"
```

---

## Task 2: Add Framed Output Parser Module

**Files:**
- Create: `src/phases/framed-output.ts`
- Test: `tests/framed-output.test.ts`

- [ ] **Step 1: Write parser tests**

Create `tests/framed-output.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  parseAnswerFrames,
  parseContentFrame,
  parseFormatFrames,
  parsePageFrames,
} from "../src/phases/framed-output";

test("parseFormatFrames parses report and formatted markdown", () => {
  const parsed = parseFormatFrames("<<<REPORT>>>\n- changed\n<<<FORMATTED>>>\n---\ntags: []\n---\n# Title\n<<<END>>>", false);
  assert.equal(parsed.truncated, false);
  assert.equal(parsed.raw.report, "- changed");
  assert.match(parsed.raw.formatted, /^---\n/);
});

test("parseContentFrame parses a single markdown body", () => {
  const parsed = parseContentFrame("<<<CONTENT>>>\n# Entity\n\nBody\n<<<END>>>");
  assert.equal(parsed.content, "# Entity\n\nBody");
});

test("parseAnswerFrames parses answer markdown and citations", () => {
  const parsed = parseAnswerFrames("<<<ANSWER>>>\nAnswer with [[wiki_a]].\n<<<CITATIONS>>>\n- wiki_a\n- wiki_b\n<<<END>>>");
  assert.equal(parsed.answer_markdown, "Answer with [[wiki_a]].");
  assert.deepEqual(parsed.citations, ["wiki_a", "wiki_b"]);
});

test("parsePageFrames parses pages and deletes", () => {
  const raw = [
    "<<<REPORT>>>",
    "reasoning text",
    "<<<PAGE>>>",
    "path: !Wiki/demo/entities/wiki_demo_a.md",
    "annotation: A page",
    "<<<CONTENT>>>",
    "---",
    "type: Entity",
    "---",
    "# A",
    "<<<END_PAGE>>>",
    "<<<DELETE>>>",
    "path: !Wiki/demo/entities/wiki_demo_old.md",
    "redirect_to: !Wiki/demo/entities/wiki_demo_a.md",
    "<<<END_DELETE>>>",
    "<<<END>>>",
  ].join("\n");
  const parsed = parsePageFrames(raw);
  assert.equal(parsed.reasoning, "reasoning text");
  assert.equal(parsed.pages[0].path, "!Wiki/demo/entities/wiki_demo_a.md");
  assert.equal(parsed.pages[0].annotation, "A page");
  assert.match(parsed.pages[0].content, /^---\n/);
  assert.deepEqual(parsed.deletes, [{
    path: "!Wiki/demo/entities/wiki_demo_old.md",
    redirect_to: "!Wiki/demo/entities/wiki_demo_a.md",
  }]);
});

test("parsePageFrames throws when required markers are missing", () => {
  assert.throws(() => parsePageFrames("<<<PAGE>>>\npath: x\n"), /missing <<<END>>>/i);
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
node --import tsx --test tests/framed-output.test.ts
```

Expected: FAIL because `src/phases/framed-output.ts` does not exist.

- [ ] **Step 3: Implement parser module**

Create `src/phases/framed-output.ts`:

```ts
import type { FormatOutput } from "./zod-schemas";
import { parseSentinelOutput } from "./format-utils";

export interface FramedParseResult<T> {
  raw: T;
  truncated: boolean;
}

export interface PageFrame {
  path: string;
  content: string;
  annotation?: string;
}

export interface DeleteFrame {
  path: string;
  redirect_to?: string;
}

export interface PageFramesOutput {
  reasoning: string;
  pages: PageFrame[];
  deletes?: DeleteFrame[];
}

export interface ContentFrameOutput {
  reasoning?: string;
  content: string;
  annotation?: string;
}

export interface AnswerFrameOutput {
  reasoning?: string;
  answer_markdown: string;
  citations: string[];
}

function requireMarker(text: string, marker: string): number {
  const idx = text.indexOf(marker);
  if (idx < 0) throw new Error(`missing ${marker}`);
  return idx;
}

function between(text: string, start: string, end: string): string {
  const s = requireMarker(text, start) + start.length;
  const e = text.indexOf(end, s);
  if (e < 0) throw new Error(`missing ${end}`);
  return text.slice(s, e).trim();
}

function parseHeader(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}

export function parseFormatFrames(text: string, hasVisionDescriptions: boolean): FramedParseResult<FormatOutput> {
  const sentinel = parseSentinelOutput(text, hasVisionDescriptions);
  if (!sentinel) throw new Error("sentinel markers not found");
  return {
    raw: {
      report: sentinel.report,
      formatted: sentinel.formatted,
      ...(hasVisionDescriptions ? {
        vision_blocks_count: sentinel.visionCount ?? 0,
        embeds_preserved: sentinel.embeds ?? [],
      } : {}),
    } as FormatOutput,
    truncated: sentinel.truncated,
  };
}

export function parseContentFrame(text: string): ContentFrameOutput {
  const content = between(text, "<<<CONTENT>>>", "<<<END>>>");
  const reasoning = text.includes("<<<REASONING>>>")
    ? between(text, "<<<REASONING>>>", "<<<CONTENT>>>")
    : undefined;
  return { reasoning, content };
}

export function parseAnswerFrames(text: string): AnswerFrameOutput {
  const answer = between(text, "<<<ANSWER>>>", text.includes("<<<CITATIONS>>>") ? "<<<CITATIONS>>>" : "<<<END>>>");
  const citations = text.includes("<<<CITATIONS>>>")
    ? between(text, "<<<CITATIONS>>>", "<<<END>>>")
        .split(/\r?\n/)
        .map((line) => line.replace(/^-\s*/, "").trim())
        .filter(Boolean)
    : [];
  const reasoning = text.includes("<<<REASONING>>>")
    ? between(text, "<<<REASONING>>>", "<<<ANSWER>>>")
    : undefined;
  return { reasoning, answer_markdown: answer, citations };
}

export function parsePageFrames(text: string): PageFramesOutput {
  requireMarker(text, "<<<END>>>");
  const reasoning = text.includes("<<<REPORT>>>")
    ? between(text, "<<<REPORT>>>", text.includes("<<<PAGE>>>") ? "<<<PAGE>>>" : "<<<END>>>")
    : "";
  const pages: PageFrame[] = [];
  const pageRe = /<<<PAGE>>>\s*([\s\S]*?)<<<CONTENT>>>\s*([\s\S]*?)<<<END_PAGE>>>/g;
  let m: RegExpExecArray | null;
  while ((m = pageRe.exec(text)) !== null) {
    const header = parseHeader(m[1].trim());
    if (!header.path) throw new Error("page frame missing path");
    pages.push({
      path: header.path,
      annotation: header.annotation || undefined,
      content: m[2].trim(),
    });
  }
  const deletes: DeleteFrame[] = [];
  const delRe = /<<<DELETE>>>\s*([\s\S]*?)<<<END_DELETE>>>/g;
  while ((m = delRe.exec(text)) !== null) {
    const header = parseHeader(m[1].trim());
    if (!header.path) throw new Error("delete frame missing path");
    deletes.push({ path: header.path, redirect_to: header.redirect_to || undefined });
  }
  if (pages.length === 0 && deletes.length === 0) throw new Error("no page or delete frames found");
  return { reasoning, pages, deletes: deletes.length ? deletes : undefined };
}
```

- [ ] **Step 4: Run parser tests**

```bash
node --import tsx --test tests/framed-output.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/phases/framed-output.ts tests/framed-output.test.ts
git commit -m "feat(phases): add framed output parsers"
```

---

## Task 3: Add Shared Structured Runner

**Files:**
- Create: `src/phases/structured-output.ts`
- Modify: `src/phases/parse-with-retry.ts`
- Test: `tests/structured-output.test.ts`

- [ ] **Step 1: Write runner tests**

Create `tests/structured-output.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import type OpenAI from "openai";
import type { LlmClient, RunEvent } from "../src/types";
import { runStructuredWithRetry } from "../src/phases/structured-output";
import { parseAnswerFrames } from "../src/phases/framed-output";

const SmallSchema = z.object({ reasoning: z.string().optional(), value: z.string() });
const AnswerSchema = z.object({
  reasoning: z.string().optional(),
  answer_markdown: z.string().min(1),
  citations: z.array(z.string()),
});

function chunk(content: string): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta: { content }, finish_reason: null }],
  } as OpenAI.Chat.ChatCompletionChunk;
}

function usageChunk(): OpenAI.Chat.ChatCompletionChunk {
  return {
    id: "c",
    object: "chat.completion.chunk",
    created: 1,
    model: "m",
    choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  } as unknown as OpenAI.Chat.ChatCompletionChunk;
}

function llmFromAttempts(attempts: Array<string | Error>): LlmClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: async () => {
          const next = attempts[i++] ?? "";
          if (next instanceof Error) throw next;
          return (async function* () {
            if (next) yield chunk(next);
            yield usageChunk();
          })();
        },
      },
    },
  } as unknown as LlmClient;
}

test("json-zod succeeds on valid JSON without retry", async () => {
  const events: RunEvent[] = [];
  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(['{"value":"ok"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 1,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });
  assert.equal(result.value.value, "ok");
  assert.equal(events.some((ev) => ev.kind === "structural_error"), false);
});

test("json-zod degrades after empty output and validates no response_format retry", async () => {
  const events: RunEvent[] = [];
  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["", "", '{"value":"recovered"}']),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: { jsonMode: "json_schema" },
    profile: { kind: "json-zod", schema: SmallSchema },
    maxRetries: 2,
    callSite: "query.seeds",
    signal: new AbortController().signal,
    onEvent: (ev) => events.push(ev),
  });
  assert.equal(result.value.value, "recovered");
  assert.ok(events.some((ev) => ev.kind === "structural_error" && ev.errorType === "empty_output"));
  assert.ok(events.some((ev) => ev.kind === "structural_error" && ev.errorType === "response_format_fallback"));
});

test("framed-zod parses framed answer and validates zod schema", async () => {
  const result = await runStructuredWithRetry({
    llm: llmFromAttempts(["<<<ANSWER>>>\nAnswer\n<<<CITATIONS>>>\n- wiki_a\n<<<END>>>"]),
    model: "m",
    baseMessages: [{ role: "user", content: "x" }],
    opts: {},
    profile: {
      kind: "framed-zod",
      schema: AnswerSchema,
      parse: parseAnswerFrames,
      repairInstruction: "Return answer frames only.",
    },
    maxRetries: 1,
    callSite: "query.answer",
    signal: new AbortController().signal,
    onEvent: () => {},
  });
  assert.equal(result.value.answer_markdown, "Answer");
  assert.deepEqual(result.value.citations, ["wiki_a"]);
});

test("framed-zod emits frame_parse on invalid frames", async () => {
  const events: RunEvent[] = [];
  await assert.rejects(
    runStructuredWithRetry({
      llm: llmFromAttempts(["bad", "still bad"]),
      model: "m",
      baseMessages: [{ role: "user", content: "x" }],
      opts: {},
      profile: {
        kind: "framed-zod",
        schema: AnswerSchema,
        parse: parseAnswerFrames,
        repairInstruction: "Return answer frames only.",
      },
      maxRetries: 1,
      callSite: "query.answer",
      signal: new AbortController().signal,
      onEvent: (ev) => events.push(ev),
    }),
    /structural validation failed/i,
  );
  assert.ok(events.some((ev) => ev.kind === "structural_error" && ev.errorType === "frame_parse"));
});
```

- [ ] **Step 2: Run tests and confirm failure**

```bash
node --import tsx --test tests/structured-output.test.ts
```

Expected: FAIL because `structured-output.ts` does not exist.

- [ ] **Step 3: Implement `structured-output.ts`**

Create `src/phases/structured-output.ts` with these exported types and functions:

```ts
import type OpenAI from "openai";
import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { LlmCallOptions, LlmClient, RunEvent } from "../types";
import {
  buildChatParams,
  buildLlmCallStatsEvent,
  extractStreamDeltas,
  extractUsage,
  parseStructured,
  wrapStreamWithStats,
} from "./llm-utils";
import { render } from "./template";
import repairJson from "../../prompts/repair-json.md";
import { structuralErrorCounter } from "../structural-error-counter";

export type StructuredCallSite =
  | "init.bootstrap"
  | "lint.patch" | "lint.fix" | "lint-chat.fix"
  | "query.seeds" | "query.answer"
  | "ingest.entities" | "ingest.pages" | "ingest.merge"
  | "format.output";

type ResponseFormatMode = "json_schema" | "json_object" | "none";

export type StructuredProfile<T> =
  | { kind: "json-zod"; schema: z.ZodSchema<T> }
  | { kind: "framed-zod"; schema: z.ZodSchema<T>; parse: (text: string) => unknown; repairInstruction: string };

export class StructuredValidationError extends Error {
  constructor(
    public readonly callSite: StructuredCallSite,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(`[${callSite}] structural validation failed after ${attempts} attempt(s): ${lastError.message}`);
    this.name = "StructuredValidationError";
  }
}

export interface RunStructuredArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  profile: StructuredProfile<T>;
  maxRetries: number;
  callSite: StructuredCallSite;
  signal: AbortSignal;
  onEvent: (ev: RunEvent) => void;
}

export interface RunStructuredResult<T> {
  value: T;
  outputTokens: number;
  fullText: string;
}

function fallbackMode(mode: ResponseFormatMode): ResponseFormatMode | null {
  if (mode === "json_schema") return "json_object";
  if (mode === "json_object") return "none";
  return null;
}

function optsForMode<T>(
  opts: LlmCallOptions,
  mode: ResponseFormatMode,
  callSite: StructuredCallSite,
  schema: z.ZodSchema<T>,
): LlmCallOptions {
  if (mode === "none") return { ...opts, jsonMode: false, jsonSchema: undefined };
  if (mode === "json_object") return { ...opts, jsonMode: "json_object", jsonSchema: undefined };
  return {
    ...opts,
    jsonMode: "json_schema",
    jsonSchema: {
      name: callSite.replace(/\./g, "_"),
      schema: zodToJsonSchema(schema, { $refStrategy: "none" }),
    },
  };
}

function repairPrompt(profile: StructuredProfile<unknown>, lastText: string, detail: string): string {
  if (profile.kind === "framed-zod") {
    return [
      "Previous response did not match the required frame format.",
      detail,
      profile.repairInstruction,
      "Return only the required frames. Do not add commentary outside frames.",
      "Previous response (truncated):",
      lastText.slice(0, 2000),
    ].join("\n");
  }
  return render(repairJson, {
    detail: [
      detail,
      "Return only JSON matching the requested schema. Do not wrap in Markdown.",
      "Previous response (truncated):",
      lastText.slice(0, 2000),
    ].join("\n"),
  });
}

async function streamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ fullText: string; outputTokens: number; events: RunEvent[] }> {
  const params = buildChatParams(model, messages, opts, true);
  let fullText = "";
  let outputTokens = 0;
  const events: RunEvent[] = [];
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
      if (tok !== undefined) outputTokens += tok;
    }
    const stats = getStats();
    if (stats) events.push(buildLlmCallStatsEvent(stats));
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") throw e;
    const params2 = buildChatParams(model, messages, opts);
    const resp = await llm.chat.completions.create(
      { ...params2, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    fullText = resp.choices[0]?.message?.content ?? "";
    outputTokens = extractUsage(resp) ?? 0;
  }
  return { fullText, outputTokens, events };
}

function parseAndValidate<T>(profile: StructuredProfile<T>, fullText: string): T {
  const raw = profile.kind === "json-zod" ? parseStructured(fullText) : profile.parse(fullText);
  const parsed = profile.schema.safeParse(raw);
  if (!parsed.success) throw parsed.error;
  return parsed.data;
}

export async function runStructuredWithRetry<T>(args: RunStructuredArgs<T>): Promise<RunStructuredResult<T>> {
  const { llm, model, baseMessages, profile, maxRetries, callSite, signal, onEvent } = args;
  let mode: ResponseFormatMode = profile.kind === "json-zod" && args.opts.jsonMode !== false ? "json_schema" : "none";
  let messages = baseMessages;
  let totalTokens = 0;
  let lastError: Error = new Error("no attempts");
  let lastText = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    if (attempt > 0) onEvent({ kind: "rule_fired", ruleId: "parseWithRetry", count: 1 });
    const callOpts = profile.kind === "json-zod" ? optsForMode(args.opts, mode, callSite, profile.schema) : { ...args.opts, jsonMode: false };
    const { fullText, outputTokens, events } = await streamOnce(llm, model, messages, callOpts, signal);
    for (const ev of events) onEvent(ev);
    totalTokens += outputTokens;
    lastText = fullText;

    if (!fullText.trim()) {
      lastError = new Error("Empty structured output");
      const next = profile.kind === "json-zod" ? fallbackMode(mode) : null;
      onEvent({ kind: "structural_error", callSite, errorType: "empty_output", retryAttempt: attempt, succeeded: null, message: lastError.message });
      structuralErrorCounter.record(null, attempt);
      if (next) {
        onEvent({ kind: "structural_error", callSite, errorType: "response_format_fallback", retryAttempt: attempt, succeeded: null, message: `${mode} -> ${next}` });
        mode = next;
      }
      if (attempt === maxRetries) throw new StructuredValidationError(callSite, attempt + 1, lastError);
      messages = [...baseMessages, { role: "user", content: repairPrompt(profile as StructuredProfile<unknown>, fullText, lastError.message) }];
      continue;
    }

    try {
      const value = parseAndValidate(profile, fullText);
      structuralErrorCounter.record(true, attempt);
      return { value, outputTokens: totalTokens, fullText };
    } catch (e) {
      lastError = e as Error;
      const isJsonParse = profile.kind === "json-zod" && /json|object|parse|No JSON/i.test(lastError.message);
      const errorType = profile.kind === "framed-zod" && /missing|frame|sentinel|marker/i.test(lastError.message)
        ? "frame_parse"
        : isJsonParse
          ? "json_parse"
          : "schema_validate";
      const isLast = attempt === maxRetries;
      onEvent({ kind: "structural_error", callSite, errorType, retryAttempt: attempt, succeeded: isLast ? false : null, message: lastError.message });
      structuralErrorCounter.record(isLast ? false : null, attempt);
      if (isLast) throw new StructuredValidationError(callSite, attempt + 1, lastError);
      messages = [
        ...baseMessages,
        { role: "assistant", content: fullText },
        { role: "user", content: repairPrompt(profile as StructuredProfile<unknown>, fullText, lastError.message) },
      ];
    }
  }
  throw new StructuredValidationError(callSite, maxRetries + 1, lastError);
}
```

- [ ] **Step 4: Replace `parse-with-retry.ts` with wrapper exports**

In `src/phases/parse-with-retry.ts`, keep the public API but delegate to `runStructuredWithRetry`:

```ts
import type OpenAI from "openai";
import type { z } from "zod";
import type { LlmClient, LlmCallOptions, RunEvent } from "../types";
import {
  runStructuredWithRetry,
  StructuredValidationError,
  type RunStructuredResult,
  type StructuredCallSite,
} from "./structured-output";

export type CallSite = StructuredCallSite;
export { StructuredValidationError };

export interface ParseWithRetryArgs<T> {
  llm: LlmClient;
  model: string;
  baseMessages: OpenAI.Chat.ChatCompletionMessageParam[];
  opts: LlmCallOptions;
  schema: z.ZodSchema<T>;
  maxRetries: number;
  callSite: CallSite;
  signal: AbortSignal;
  onEvent: (ev: RunEvent) => void;
}

export type ParseWithRetryResult<T> = RunStructuredResult<T>;

export async function parseWithRetry<T>(args: ParseWithRetryArgs<T>): Promise<ParseWithRetryResult<T>> {
  return runStructuredWithRetry({
    llm: args.llm,
    model: args.model,
    baseMessages: args.baseMessages,
    opts: args.opts,
    profile: { kind: "json-zod", schema: args.schema },
    maxRetries: args.maxRetries,
    callSite: args.callSite,
    signal: args.signal,
    onEvent: args.onEvent,
  });
}
```

- [ ] **Step 5: Run runner tests**

```bash
node --import tsx --test tests/structured-output.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run parser + runner tests together**

```bash
node --import tsx --test tests/framed-output.test.ts tests/structured-output.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/phases/structured-output.ts src/phases/parse-with-retry.ts tests/structured-output.test.ts
git commit -m "feat(phases): add shared structured output runner"
```

---

## Task 4: Route Format Through Framed-Zod

**Files:**
- Modify: `src/phases/format.ts`
- Test: `tests/structured-output.test.ts`

- [ ] **Step 1: Export a format parser profile helper**

In `src/phases/framed-output.ts`, add:

```ts
import { FormatBaseSchema, FormatWithVisionSchema } from "./zod-schemas";

export function formatProfile(hasVisionDescriptions: boolean) {
  return {
    kind: "framed-zod" as const,
    schema: hasVisionDescriptions ? FormatWithVisionSchema : FormatBaseSchema,
    parse: (text: string) => parseFormatFrames(text, hasVisionDescriptions).raw,
    repairInstruction: [
      "Return exactly these frames:",
      "<<<REPORT>>>",
      "<markdown list of changes>",
      "<<<FORMATTED>>>",
      "<full formatted markdown starting with frontmatter>",
      "<<<END>>>",
      "Each marker must be on its own line.",
    ].join("\n"),
  };
}
```

- [ ] **Step 2: Replace initial format call/retry block**

In `src/phases/format.ts`:

1. Import `runStructuredWithRetry` from `./structured-output`.
2. Import `formatProfile` from `./framed-output`.
3. Keep `callOnce` only if it is still needed for token-restore streaming; otherwise use `runStructuredWithRetry` for both initial and token restore calls.
4. Replace the block from `yield { kind: "tool_use", name: "Formatting"... }` through the second sentinel retry with:

```ts
  yield { kind: "tool_use", name: "Formatting", input: { file_path: filePath } };
  let fullText = "";
  let parsed: import("./zod-schemas").FormatOutput;
  try {
    const result = await runStructuredWithRetry({
      llm,
      model,
      baseMessages: messages,
      opts: { ...opts, jsonMode: false },
      profile: formatProfile(visionDescriptions.size > 0),
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "format.output",
      signal,
      onEvent: (ev) => { void 0; },
    });
    fullText = result.fullText;
    outputTokens += result.outputTokens;
    parsed = result.value;
    yield { kind: "tool_result", ok: true, preview: `${parsed.formatted.length} chars` };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") return;
    const msg = (e as Error).message;
    yield { kind: "tool_result", ok: false, preview: msg };
    yield { kind: "error", message: msg };
    yield { kind: "result", durationMs: Date.now() - start, text: "", outputTokens: outputTokens || undefined };
    return;
  }
```

Then adjust `onEvent` to yield events. Because generator callbacks cannot `yield`, collect `RunEvent[]` for this call and flush immediately after the runner returns or throws:

```ts
  const structuredEvents: RunEvent[] = [];
  // pass onEvent: (ev) => structuredEvents.push(ev)
  // after success/catch tool_result, for (const ev of structuredEvents) yield ev;
```

The implementation must preserve post-parse code from `const lastSlash = ...` onward.

- [ ] **Step 3: Run checks**

```bash
node --import tsx --test tests/framed-output.test.ts tests/structured-output.test.ts
npx tsc --noEmit
```

Expected: tests PASS, typecheck PASS.

- [ ] **Step 4: Commit**

```bash
git add src/phases/format.ts src/phases/framed-output.ts
git commit -m "feat(format): route large output through framed zod"
```

---

## Task 5: Route Ingest Large Outputs Through Framed-Zod

**Files:**
- Modify: `src/phases/ingest.ts`
- Modify: `src/phases/framed-output.ts`
- Test: `tests/framed-output.test.ts`

- [ ] **Step 1: Add framed profiles for pages and merge**

In `src/phases/framed-output.ts`, add:

```ts
import { MergedPageOutputSchema, WikiPagesOutputSchema } from "./zod-schemas";

export const wikiPagesFrameInstruction = [
  "Return framed wiki pages only.",
  "Use <<<REPORT>>> for reasoning.",
  "For each page use <<<PAGE>>> headers, <<<CONTENT>>> markdown body, and <<<END_PAGE>>>.",
  "For deletes use <<<DELETE>>> path lines and <<<END_DELETE>>>.",
  "Finish with <<<END>>>.",
].join("\n");

export const mergeContentFrameInstruction = [
  "Return exactly one merged page content frame:",
  "<<<CONTENT>>>",
  "<full markdown page>",
  "<<<END>>>",
].join("\n");

export function wikiPagesProfile() {
  return {
    kind: "framed-zod" as const,
    schema: WikiPagesOutputSchema,
    parse: parsePageFrames,
    repairInstruction: wikiPagesFrameInstruction,
  };
}

export function mergedPageProfile() {
  return {
    kind: "framed-zod" as const,
    schema: MergedPageOutputSchema,
    parse: parseContentFrame,
    repairInstruction: mergeContentFrameInstruction,
  };
}
```

- [ ] **Step 2: Update ingest prompts at call sites**

In `src/phases/ingest.ts`, for `ingest.pages`, append `wikiPagesFrameInstruction` to the system/user prompt that currently requests JSON. For `ingest.merge`, replace JSON output wording with `mergeContentFrameInstruction`.

Use imports:

```ts
import { mergedPageProfile, wikiPagesFrameInstruction, wikiPagesProfile } from "./framed-output";
import { runStructuredWithRetry } from "./structured-output";
```

- [ ] **Step 3: Replace `ingest.pages` parse call**

Replace the `parseWithRetry` call for `ingest.pages` with:

```ts
    parseResult = await runStructuredWithRetry({
      llm,
      model,
      baseMessages: messages,
      opts: { ...opts, jsonMode: false },
      profile: wikiPagesProfile(),
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "ingest.pages",
      signal,
      onEvent: (ev) => pwtEvents.push(ev),
    });
```

- [ ] **Step 4: Replace `ingest.merge` parse call**

Replace the `parseWithRetry` call for `ingest.merge` with:

```ts
            const merged = await runStructuredWithRetry({
              llm,
              model,
              baseMessages: mergeMsgs,
              opts: { ...opts, jsonMode: false },
              profile: mergedPageProfile(),
              maxRetries: opts.structuredRetries ?? 1,
              callSite: "ingest.merge",
              signal,
              onEvent: (ev) => { pwtEvents.push(ev); },
            });
```

If the merge scope lacks `pwtEvents`, create a local `mergeEvents: RunEvent[] = []`, pass it, and yield those events after the merge attempt.

- [ ] **Step 5: Run checks**

```bash
node --import tsx --test tests/framed-output.test.ts tests/structured-output.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/phases/ingest.ts src/phases/framed-output.ts
git commit -m "feat(ingest): use framed zod for markdown outputs"
```

---

## Task 6: Route Lint, Lint-Chat, And Query Answer Through Framed-Zod

**Files:**
- Modify: `src/phases/framed-output.ts`
- Modify: `src/phases/lint.ts`
- Modify: `src/phases/lint-chat.ts`
- Modify: `src/phases/query-answer.ts`
- Test: `tests/framed-output.test.ts`

- [ ] **Step 1: Add lint and answer profile helpers**

In `src/phases/framed-output.ts`, add:

```ts
import { LintChatSchema, LintOutputSchema } from "./zod-schemas";
import type { makeQueryAnswerSchema } from "./zod-schemas";

export function lintOutputProfile() {
  return {
    kind: "framed-zod" as const,
    schema: LintOutputSchema,
    parse: parsePageFrames,
    repairInstruction: wikiPagesFrameInstruction,
  };
}

export function lintChatProfile() {
  return {
    kind: "framed-zod" as const,
    schema: LintChatSchema,
    parse: (text: string) => ({ summary: parsePageFrames(text).reasoning, pages: parsePageFrames(text).pages }),
    repairInstruction: wikiPagesFrameInstruction,
  };
}

export function queryAnswerProfile(schema: ReturnType<typeof makeQueryAnswerSchema>) {
  return {
    kind: "framed-zod" as const,
    schema,
    parse: parseAnswerFrames,
    repairInstruction: [
      "Return exactly:",
      "<<<ANSWER>>>",
      "<markdown answer>",
      "<<<CITATIONS>>>",
      "- <known wiki stem>",
      "<<<END>>>",
    ].join("\n"),
  };
}
```

If importing `makeQueryAnswerSchema` as a value creates a cycle, change the parameter type to `z.ZodSchema<QueryAnswer>` and import `type { z } from "zod"`.

- [ ] **Step 2: Replace `lint.fix` call**

In `src/phases/lint.ts`, keep `lint.patch` on `parseWithRetry`. Replace only the per-article `lint.fix` call with `runStructuredWithRetry` and `lintOutputProfile()`.

- [ ] **Step 3: Replace `lint-chat.fix` call**

In `src/phases/lint-chat.ts`, replace the `parseWithRetry` call with `runStructuredWithRetry`, `opts: { ...opts, jsonMode: false }`, and `lintChatProfile()`.

- [ ] **Step 4: Replace `query.answer` fallback**

In `src/phases/query-answer.ts`, replace the `parseWithRetry` fallback with `runStructuredWithRetry` and `queryAnswerProfile(makeQueryAnswerSchema(knownStems))`. Keep the existing behavior that only the `FixingLinks` preview reports the high-level outcome, but do not drop structural diagnostics completely; collect and emit them if the surrounding generator can yield, otherwise count and add a concise diagnostic to the `tool_result` preview.

- [ ] **Step 5: Run checks**

```bash
node --import tsx --test tests/framed-output.test.ts tests/structured-output.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/phases/framed-output.ts src/phases/lint.ts src/phases/lint-chat.ts src/phases/query-answer.ts
git commit -m "feat(phases): use framed zod for large text repairs"
```

---

## Task 7: Block Destructive Operation-Level Retry

**Files:**
- Modify: `src/agent-runner.ts`
- Test: `tests/init-force-retry.test.ts`

- [ ] **Step 1: Write regression test**

Create `tests/init-force-retry.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { AgentRunner } from "../src/agent-runner";
import { DEFAULT_SETTINGS, type LlmWikiPluginSettings, type RunEvent } from "../src/types";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";

function adapter(): VaultAdapter {
  const files = new Map<string, string>();
  return {
    read: async (p) => files.get(p) ?? "",
    write: async (p, v) => { files.set(p, v); },
    append: async (p, v) => { files.set(p, (files.get(p) ?? "") + v); },
    exists: async (p) => files.has(p),
    mkdir: async () => {},
    remove: async (p) => { files.delete(p); },
    rename: async (a, b) => { files.set(b, files.get(a) ?? ""); files.delete(a); },
    list: async () => ({ files: [], folders: [] }),
  };
}

function settings(): LlmWikiPluginSettings {
  return { ...DEFAULT_SETTINGS, backend: "native-agent", llmIdleTimeoutSec: 1, llmIdleRetries: 1 };
}

test("operation-level idle retry does not replay WipeDomain after destructive prelude", async () => {
  const runner = new AgentRunner({ chat: { completions: { create: async () => { throw new Error("unused"); } } } } as any, settings(), new VaultTools(adapter(), "/vault"), "Vault", [{
    id: "demo",
    name: "Demo",
    wiki_folder: "demo",
    source_paths: ["src"],
    entity_types: [],
    analyzed_sources: {},
  }]);
  let calls = 0;
  (runner as unknown as { runOperation: (...args: any[]) => AsyncGenerator<RunEvent> }).runOperation = async function* () {
    calls++;
    yield { kind: "tool_use", name: "WipeDomain", input: { folder: "demo" } };
    await new Promise<void>((resolve) => setTimeout(resolve, 1200));
  };
  const events: RunEvent[] = [];
  await assert.rejects(async () => {
    for await (const ev of runner.run({
      operation: "init",
      args: ["demo", "--force"],
      cwd: "/vault",
      signal: new AbortController().signal,
      timeoutMs: 0,
    })) events.push(ev);
  }, /destructive/i);
  assert.equal(calls, 1);
  assert.equal(events.filter((ev) => ev.kind === "tool_use" && ev.name === "WipeDomain").length, 1);
});
```

- [ ] **Step 2: Run test and confirm failure**

```bash
node --import tsx --test tests/init-force-retry.test.ts
```

Expected: FAIL because current `AgentRunner` retries the whole operation.

- [ ] **Step 3: Implement destructive retry guard**

In `src/agent-runner.ts`, inside `run()`, add a per-run flag:

```ts
    let destructivePreludeSeen = false;
```

Inside the `for await` event loop, set it when a destructive event appears:

```ts
          if (ev.kind === "tool_use" && ev.name === "WipeDomain") destructivePreludeSeen = true;
```

Before each retry `continue`, check:

```ts
            if (destructivePreludeSeen) {
              throw new DOMException(
                `LLM idle timeout (${Math.round(idleTimeoutMs / 1000)}s) after destructive prelude; refusing to replay operation`,
                "AbortError",
              );
            }
```

Apply the same guard in both silent-return and catch retry branches.

- [ ] **Step 4: Run regression test**

```bash
node --import tsx --test tests/init-force-retry.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent-runner.ts tests/init-force-retry.test.ts
git commit -m "fix(agent-runner): block retry after destructive prelude"
```

---

## Task 8: Stop Runtime Per-Domain `_config` Creation

**Files:**
- Modify: `src/domain-config.ts`
- Modify: `src/wiki-path.ts`
- Test: `tests/no-runtime-domain-config.test.ts`

- [ ] **Step 1: Write static guard test**

Create `tests/no-runtime-domain-config.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();

test("normal runtime does not create per-domain _config folders", () => {
  const domainConfig = readFileSync(join(root, "src/domain-config.ts"), "utf8");
  assert.doesNotMatch(domainConfig, /mkdir\(\s*domainConfigDir/);
  assert.doesNotMatch(domainConfig, /legacyDomainConfigDir\([^)]*\).*mkdir/s);
});

test("GLOBAL agent log constants are not used by controller active logging", () => {
  const controller = readFileSync(join(root, "src/controller.ts"), "utf8");
  assert.match(controller, /pluginDir\(\).*agent\.jsonl/s);
  assert.doesNotMatch(controller, /GLOBAL_AGENT_LOG_PATH/);
});
```

- [ ] **Step 2: Run test and confirm failure**

```bash
node --import tsx --test tests/no-runtime-domain-config.test.ts
```

Expected: FAIL because `domain-config.ts` still calls `mkdir(domainConfigDir(...))`.

- [ ] **Step 3: Modify `domain-config.ts`**

Replace `ensureDomainConfig` with migration-only reads/writes:

```ts
import type { VaultTools } from "./vault-tools";
import { domainIndexPath, domainLogPath, legacyDomainIndexPath, legacyDomainLogPath } from "./wiki-path";

export async function ensureDomainConfig(vaultTools: VaultTools, domainFolder: string): Promise<void> {
  await migrateLegacy(vaultTools, legacyDomainIndexPath(domainFolder), domainIndexPath(domainFolder));
  await migrateLegacy(vaultTools, legacyDomainLogPath(domainFolder), domainLogPath(domainFolder));
}

async function migrateLegacy(vaultTools: VaultTools, oldPath: string, newPath: string): Promise<void> {
  if (!(await vaultTools.exists(oldPath))) return;
  if (!(await vaultTools.exists(newPath))) {
    const content = await vaultTools.read(oldPath);
    await vaultTools.write(newPath, content);
  }
  await vaultTools.remove(oldPath);
}
```

- [ ] **Step 4: Keep legacy path exports but mark runtime alias as legacy**

In `src/wiki-path.ts`, remove runtime aliases if unused after compile:

```ts
export const domainConfigDir = legacyDomainConfigDir;
export const domainEmbeddingsPath = legacyDomainEmbeddingsPath;
```

If `npx tsc --noEmit` shows no consumers, delete these two alias exports. If migration scripts still need them, keep them and rely on the static guard test to prevent runtime creation.

- [ ] **Step 5: Run checks**

```bash
node --import tsx --test tests/no-runtime-domain-config.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/domain-config.ts src/wiki-path.ts tests/no-runtime-domain-config.test.ts
git commit -m "fix(storage): stop runtime per-domain _config creation"
```

---

## Task 9: Final Verification And Documentation

**Files:**
- Modify: `docs/TODO.md`
- Update iWiki page if implementation changes user-visible behavior.

- [ ] **Step 1: Run focused tests**

```bash
node --import tsx --test tests/framed-output.test.ts tests/structured-output.test.ts tests/init-force-retry.test.ts tests/no-runtime-domain-config.test.ts
```

Expected: all tests PASS.

- [ ] **Step 2: Run existing Node tests**

```bash
node --import tsx --test tests/*.test.ts
```

Expected: all tests PASS.

- [ ] **Step 3: Run lint and build**

```bash
npm run lint
npm run build
```

Expected: both commands PASS.

- [ ] **Step 4: Update repository docs or wiki if needed**

If behavior changed in user-visible docs, update the project wiki through iWiki tools. Minimum wiki target if changed: structured-output fallback behavior and active `agent.jsonl` location. Run:

```bash
# MCP action, not shell: wiki_update_page or wiki_write_page, then wiki_lint
```

Expected: `wiki_lint` reports no broken or stale pages. Existing long-lead advisory notes may remain.

- [ ] **Step 5: Run result chain check**

Run `$check-chain result docs/superpowers/plans/2026-07-14-structured-output-pipeline-resilience.md`.

Expected: result verdict `OK`; `docs/TODO.md` row becomes `done`.

- [ ] **Step 6: Commit final docs/report changes**

```bash
git add docs/TODO.md docs/superpowers/reports/ docs/superpowers/plans/2026-07-14-structured-output-pipeline-resilience.md
git commit -m "docs(result): record structured output resilience verification"
```

Only include files that actually changed.
