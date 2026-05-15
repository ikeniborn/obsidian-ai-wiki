---
title: Structured Output Resilience Implementation Plan
date: 2026-05-15
spec: docs/superpowers/specs/2026-05-15-structured-output-resilience-design.md
review:
  plan_hash: 930c69874e0c1cd9
  spec_hash: ed099c0483dd2be6
  last_run: 2026-05-15
  phases:
    structure:     { status: passed }
    coverage:      { status: passed }
    dependencies:  { status: passed }
    verifiability: { status: passed }
    consistency:   { status: passed }
  findings: []
---

# Structured Output Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace 5 unsafe `parseStructured(...) as Type` call-sites with zod-validated `parseWithRetry()` orchestrator that retries on schema failure with feedback, emits telemetry events, and exposes a status bar counter.

**Architecture:** Add zod runtime schemas → wrap streaming/non-stream LLM call + `parseStructured` + `safeParse` in `parseWithRetry` orchestrator → on zod fail, retry with `formatZodFeedback`-built user message → emit `structural_error` RunEvent + `structuralErrorCounter.record()` → status bar subscribes. Strict policy: exhausted retries throw `StructuredValidationError`, call-site emits `error` event.

**Tech Stack:** TypeScript, zod (new dep), vitest, Obsidian Plugin API. esbuild bundles zod into `main.js` (CJS).

**Spec deviations (read first):**
- Spec says "JSON example in `prompts/lint.md`" / "`prompts/query.md`". Real call-sites use **inline** prompts: `lint.ts:311-327` (lint patch) and `query.ts:173-178` (seeds). Examples go inline, not in those .md files. `prompts/init.md` and `prompts/init-incremental.md` are real files used by `runInit` — examples go there.
- Spec lists `init.ts:126` (bootstrap, no sources) AND `init.ts:291` (bootstrap, with sources, file 0). Both are separate call-sites: `runInitBootstrap`-style block at lines 100-147 and `runInitWithSources` file-0 bootstrap at lines 262-307. Each replaced individually.

---

## File Structure

**Created:**
- `src/phases/zod-schemas.ts` — 3 zod schemas + `z.infer<>` type exports.
- `src/phases/parse-with-retry.ts` — `parseWithRetry()`, `formatZodFeedback()`, `StructuredValidationError`, `CallSite`, `ParseWithRetryArgs`.
- `src/structural-error-counter.ts` — singleton counter with subscribe API.
- `tests/phases/zod-schemas.test.ts`
- `tests/phases/parse-with-retry.test.ts`
- `tests/structural-error-counter.test.ts`
- `tests/fixtures/structured/` — 8 JSON fixtures.

**Modified:**
- `src/phases/schemas.ts` — re-export from zod-schemas (back-compat).
- `src/phases/init.ts` — 3 call-sites swap to `parseWithRetry`.
- `src/phases/lint.ts` — 1 call-site swap + inline prompt JSON example.
- `src/phases/query.ts` — 1 call-site swap + inline prompt JSON example.
- `src/types.ts` — `RunEvent` variant `structural_error`, `LlmCallOptions.structuredRetries`, `nativeAgent.structuredRetries` settings field, `DEFAULT_SETTINGS`.
- `src/agent-runner.ts` — `buildOptsFor` plumbs `structuredRetries` into `opts`.
- `src/main.ts` — `addStatusBarItem` + counter subscription + `register(unsub)`.
- `src/settings.ts` — number input for `structuredRetries`.
- `src/i18n.ts` — labels for the new setting.
- `prompts/init.md` — append `## Output JSON Example`.
- `prompts/init-incremental.md` — append `## Output JSON Example`.
- `package.json` — add `zod` dep.
- `tests/agent-runner.integration.test.ts` — new failing-JSON case.

---

## Task 1: Add zod dependency + zod schemas + schema tests

**Files:**
- Modify: `package.json`
- Create: `src/phases/zod-schemas.ts`
- Create: `tests/phases/zod-schemas.test.ts`
- Create: `tests/fixtures/structured/domain-entry-valid.json`
- Create: `tests/fixtures/structured/domain-entry-missing-id.json`
- Create: `tests/fixtures/structured/domain-entry-wrong-type.json`
- Create: `tests/fixtures/structured/delta-valid.json`
- Create: `tests/fixtures/structured/delta-empty-arrays.json`
- Create: `tests/fixtures/structured/delta-extra-fields.json`
- Create: `tests/fixtures/structured/seeds-valid.json`
- Create: `tests/fixtures/structured/seeds-non-string-elem.json`

- [ ] **Step 1: Install zod**

Run: `npm install zod@^3.23.0`

Expected: `zod` appears in `dependencies` in `package.json`. No peer-dep warnings.

- [ ] **Step 2: Verify build still succeeds**

Run: `npm run build`

Expected: `main.js` produced, no TS errors. (zod not yet imported anywhere.)

- [ ] **Step 3: Write fixtures**

Create `tests/fixtures/structured/domain-entry-valid.json`:
```json
{
  "reasoning": "Identified Process and ServiceContract entities.",
  "id": "telecom",
  "name": "Telecom Operations",
  "wiki_folder": "telecom",
  "entity_types": [
    {"type":"Process","description":"Business process","extraction_cues":["BPMN"],"min_mentions_for_page":1,"wiki_subfolder":"processes"}
  ],
  "language_notes": "Mix of Russian/English."
}
```

Create `tests/fixtures/structured/domain-entry-missing-id.json`:
```json
{
  "reasoning": "x",
  "name": "Telecom",
  "wiki_folder": "telecom",
  "entity_types": [],
  "language_notes": ""
}
```

Create `tests/fixtures/structured/domain-entry-wrong-type.json`:
```json
{
  "reasoning": "x",
  "id": "t",
  "name": "T",
  "wiki_folder": "t",
  "entity_types": "not-an-array",
  "language_notes": ""
}
```

Create `tests/fixtures/structured/delta-valid.json`:
```json
{
  "reasoning": "Added Contract entity.",
  "entity_types": [
    {"type":"Contract","description":"Service contract","extraction_cues":["SLA","contract"]}
  ],
  "language_notes": "Use English term Contract."
}
```

Create `tests/fixtures/structured/delta-empty-arrays.json`:
```json
{
  "reasoning": "No new types.",
  "entity_types": []
}
```

Create `tests/fixtures/structured/delta-extra-fields.json`:
```json
{
  "reasoning": "x",
  "entity_types": [],
  "language_notes": "",
  "future_field": {"foo": 1},
  "another_extra": [1,2,3]
}
```

Create `tests/fixtures/structured/seeds-valid.json`:
```json
{
  "reasoning": "Best matches by keyword overlap.",
  "seeds": ["PageA","PageB","PageC"]
}
```

Create `tests/fixtures/structured/seeds-non-string-elem.json`:
```json
{
  "reasoning": "x",
  "seeds": ["ok", 42, "ok2"]
}
```

- [ ] **Step 4: Write failing schema tests**

Create `tests/phases/zod-schemas.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DomainEntrySchema, EntityTypesDeltaSchema, SeedsSchema,
} from "../../src/phases/zod-schemas";

const fx = (name: string) =>
  JSON.parse(readFileSync(join(__dirname, "../fixtures/structured", name), "utf8"));

describe("DomainEntrySchema", () => {
  it("parses valid", () => {
    const r = DomainEntrySchema.safeParse(fx("domain-entry-valid.json"));
    expect(r.success).toBe(true);
  });
  it("fails when id missing", () => {
    const r = DomainEntrySchema.safeParse(fx("domain-entry-missing-id.json"));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path.join(".") === "id")).toBe(true);
  });
  it("fails when entity_types not array", () => {
    const r = DomainEntrySchema.safeParse(fx("domain-entry-wrong-type.json"));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path.join(".") === "entity_types")).toBe(true);
  });
  it("fails when wiki_folder is empty string", () => {
    const r = DomainEntrySchema.safeParse({ ...fx("domain-entry-valid.json"), wiki_folder: "" });
    expect(r.success).toBe(false);
  });
});

describe("EntityTypesDeltaSchema", () => {
  it("parses valid", () => {
    const r = EntityTypesDeltaSchema.safeParse(fx("delta-valid.json"));
    expect(r.success).toBe(true);
  });
  it("parses empty arrays", () => {
    const r = EntityTypesDeltaSchema.safeParse(fx("delta-empty-arrays.json"));
    expect(r.success).toBe(true);
  });
  it("ignores extra fields (forward-compat)", () => {
    const r = EntityTypesDeltaSchema.safeParse(fx("delta-extra-fields.json"));
    expect(r.success).toBe(true);
    if (r.success) {
      expect((r.data as Record<string, unknown>).future_field).toBeUndefined();
    }
  });
  it("fails when reasoning missing", () => {
    const r = EntityTypesDeltaSchema.safeParse({ entity_types: [] });
    expect(r.success).toBe(false);
  });
});

describe("SeedsSchema", () => {
  it("parses valid", () => {
    const r = SeedsSchema.safeParse(fx("seeds-valid.json"));
    expect(r.success).toBe(true);
  });
  it("fails when array contains non-string", () => {
    const r = SeedsSchema.safeParse(fx("seeds-non-string-elem.json"));
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.some(i => i.path[0] === "seeds")).toBe(true);
  });
  it("parses without optional reasoning", () => {
    const r = SeedsSchema.safeParse({ seeds: ["x"] });
    expect(r.success).toBe(true);
  });
});
```

- [ ] **Step 5: Run tests, verify they fail**

Run: `npx vitest run tests/phases/zod-schemas.test.ts`

Expected: FAIL — module `src/phases/zod-schemas` not found.

- [ ] **Step 6: Implement zod-schemas.ts**

Create `src/phases/zod-schemas.ts`:
```ts
import { z } from "zod";

const EntityTypeSchema = z.object({
  type: z.string().min(1),
  description: z.string(),
  extraction_cues: z.array(z.string()),
  min_mentions_for_page: z.number().optional(),
  wiki_subfolder: z.string().optional(),
});

export const DomainEntrySchema = z.object({
  reasoning: z.string(),
  id: z.string().min(1),
  name: z.string(),
  wiki_folder: z.string().min(1),
  entity_types: z.array(EntityTypeSchema),
  language_notes: z.string(),
});

export const EntityTypesDeltaSchema = z.object({
  reasoning: z.string(),
  entity_types: z.array(EntityTypeSchema).optional(),
  language_notes: z.string().optional(),
});

export const SeedsSchema = z.object({
  reasoning: z.string().optional(),
  seeds: z.array(z.string()),
});

export type DomainEntryResponse = z.infer<typeof DomainEntrySchema>;
export type EntityTypesDeltaResponse = z.infer<typeof EntityTypesDeltaSchema>;
export type SeedsResponse = z.infer<typeof SeedsSchema>;
```

- [ ] **Step 7: Run tests, verify they pass**

Run: `npx vitest run tests/phases/zod-schemas.test.ts`

Expected: PASS — all 11 tests green.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json src/phases/zod-schemas.ts tests/phases/zod-schemas.test.ts tests/fixtures/structured/
git commit -m "feat(schemas): add zod runtime validators for structured LLM output"
```

---

## Task 2: structural-error-counter singleton + tests

**Files:**
- Create: `src/structural-error-counter.ts`
- Create: `tests/structural-error-counter.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/structural-error-counter.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { structuralErrorCounter } from "../src/structural-error-counter";

describe("structuralErrorCounter", () => {
  beforeEach(() => structuralErrorCounter.reset());

  it("starts zeroed", () => {
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 0 });
  });

  it("records ok for first-attempt success", () => {
    structuralErrorCounter.record(true, 0);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 1 });
  });

  it("records retried for success after retry", () => {
    structuralErrorCounter.record(true, 1);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 1, ok: 0 });
  });

  it("records failed for exhausted attempts", () => {
    structuralErrorCounter.record(false, 1);
    expect(structuralErrorCounter.get()).toEqual({ failed: 1, retried: 0, ok: 0 });
  });

  it("noop on succeeded=null", () => {
    structuralErrorCounter.record(null, 0);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 0 });
  });

  it("notifies subscribers on each record", () => {
    const calls: Array<{ failed: number; retried: number; ok: number }> = [];
    structuralErrorCounter.subscribe((s) => calls.push(s));
    structuralErrorCounter.record(true, 0);
    structuralErrorCounter.record(false, 1);
    expect(calls).toEqual([
      { failed: 0, retried: 0, ok: 1 },
      { failed: 1, retried: 0, ok: 1 },
    ]);
  });

  it("unsubscribe stops notifications", () => {
    let count = 0;
    const unsub = structuralErrorCounter.subscribe(() => count++);
    structuralErrorCounter.record(true, 0);
    unsub();
    structuralErrorCounter.record(true, 0);
    expect(count).toBe(1);
  });

  it("reset clears stats", () => {
    structuralErrorCounter.record(true, 0);
    structuralErrorCounter.record(false, 1);
    structuralErrorCounter.reset();
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 0 });
  });

  it("subscribers receive snapshot copies (no mutation leak)", () => {
    let snap: { failed: number; retried: number; ok: number } | null = null;
    structuralErrorCounter.subscribe((s) => { snap = s; });
    structuralErrorCounter.record(true, 0);
    const internal = structuralErrorCounter.get();
    expect(snap).not.toBe(internal);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run tests/structural-error-counter.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement counter**

Create `src/structural-error-counter.ts`:
```ts
export interface StructuralErrorStats {
  failed: number;
  retried: number;
  ok: number;
}

class Counter {
  private stats: StructuralErrorStats = { failed: 0, retried: 0, ok: 0 };
  private listeners = new Set<(s: StructuralErrorStats) => void>();

  record(succeeded: boolean | null, retryAttempt: number): void {
    if (succeeded === null) return;
    if (!succeeded) this.stats.failed++;
    else if (retryAttempt > 0) this.stats.retried++;
    else this.stats.ok++;
    const snap: StructuralErrorStats = { ...this.stats };
    for (const fn of this.listeners) fn(snap);
  }

  subscribe(fn: (s: StructuralErrorStats) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  get(): StructuralErrorStats {
    return { ...this.stats };
  }

  reset(): void {
    this.stats = { failed: 0, retried: 0, ok: 0 };
  }
}

export const structuralErrorCounter = new Counter();
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/structural-error-counter.test.ts`

Expected: PASS — 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/structural-error-counter.ts tests/structural-error-counter.test.ts
git commit -m "feat(telemetry): add structural-error-counter singleton with subscribe API"
```

---

## Task 3: types.ts — RunEvent variant, LlmCallOptions, settings field

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add structural_error variant to RunEvent**

In `src/types.ts`, append to the `RunEvent` union (after the `format_cancelled` line, before the closing `;`):
```ts
  | { kind: "structural_error";
      callSite: "init.bootstrap" | "init.delta" | "lint.patch" | "query.seeds";
      errorType: "json_parse" | "schema_validate";
      retryAttempt: number;
      succeeded: boolean | null;
      message: string;
    }
```

- [ ] **Step 2: Add `structuredRetries` to LlmCallOptions**

In `src/types.ts`, modify `LlmCallOptions` interface (append last field before closing brace):
```ts
export interface LlmCallOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number | null;
  systemPrompt?: string;
  numCtx?: number | null;
  jsonMode?: "json_object" | false;
  structuredRetries?: number;
}
```

- [ ] **Step 3: Add `structuredRetries` to nativeAgent settings**

In `src/types.ts`, modify the `nativeAgent` block of `LlmWikiPluginSettings` (append after `operations`):
```ts
  nativeAgent: {
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    topP: number | null;
    numCtx: number | null;
    perOperation: boolean;
    operations: OpMap<NativeOperationConfig>;
    structuredRetries: number;
  };
```

- [ ] **Step 4: Add default to DEFAULT_SETTINGS.nativeAgent**

In `src/types.ts`, in `DEFAULT_SETTINGS.nativeAgent` (after `operations: { ... }`):
```ts
    structuredRetries: 1,
```

So the block ends:
```ts
  nativeAgent: {
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "llama3.2",
    temperature: 0.2,
    topP: null,
    numCtx: null,
    perOperation: false,
    operations: { /* unchanged */ },
    structuredRetries: 1,
  },
```

- [ ] **Step 5: Verify type-check passes**

Run: `npx tsc --noEmit`

Expected: 0 errors. (Existing code does not yet read these fields.)

- [ ] **Step 6: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add structural_error RunEvent + structuredRetries setting"
```

---

## Task 4: parse-with-retry orchestrator + tests

**Files:**
- Create: `src/phases/parse-with-retry.ts`
- Create: `tests/phases/parse-with-retry.test.ts`

- [ ] **Step 1: Write failing tests (mock LlmClient)**

Create `tests/phases/parse-with-retry.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type OpenAI from "openai";
import { z } from "zod";
import {
  parseWithRetry, formatZodFeedback, StructuredValidationError,
} from "../../src/phases/parse-with-retry";
import type { LlmClient, RunEvent } from "../../src/types";
import { structuralErrorCounter } from "../../src/structural-error-counter";

const Schema = z.object({ id: z.string().min(1), value: z.number() });

function streamFromText(text: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [{ delta: { content: text }, index: 0, finish_reason: null }],
      } as unknown as OpenAI.Chat.ChatCompletionChunk;
      yield {
        choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
        usage: { completion_tokens: 5 },
      } as unknown as OpenAI.Chat.ChatCompletionChunk;
    },
  };
}

function makeLlm(responses: string[]): LlmClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async (_params: unknown) => {
          const text = responses[Math.min(i++, responses.length - 1)];
          return streamFromText(text) as never;
        }) as never,
      },
    },
  };
}

const baseArgs = {
  model: "test",
  baseMessages: [{ role: "user" as const, content: "x" }],
  opts: {},
  schema: Schema,
  callSite: "init.bootstrap" as const,
};

beforeEach(() => structuralErrorCounter.reset());

describe("parseWithRetry", () => {
  it("returns value on first-attempt success (maxRetries=0)", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm([JSON.stringify({ id: "a", value: 1 })]);
    const r = await parseWithRetry({
      ...baseArgs, llm, maxRetries: 0,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    expect(r.value).toEqual({ id: "a", value: 1 });
    expect(r.outputTokens).toBe(5);
    expect(events).toEqual([]);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 1 });
  });

  it("throws StructuredValidationError on invalid first attempt with maxRetries=0", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm(["not json"]);
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 0,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeInstanceOf(StructuredValidationError);
    const fail = events.find(e => e.kind === "structural_error" && e.succeeded === false);
    expect(fail).toBeDefined();
    expect(structuralErrorCounter.get().failed).toBe(1);
  });

  it("retries after fail then succeeds (maxRetries=1, fail+ok)", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm([
      "{}",
      JSON.stringify({ id: "x", value: 7 }),
    ]);
    const r = await parseWithRetry({
      ...baseArgs, llm, maxRetries: 1,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    });
    expect(r.value).toEqual({ id: "x", value: 7 });
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    const midFlight = events.find(e => e.kind === "structural_error" && e.succeeded === null);
    expect(midFlight).toBeDefined();
    const ok = events.find(e => e.kind === "structural_error" && e.succeeded === true);
    expect(ok).toBeDefined();
    expect(structuralErrorCounter.get().retried).toBe(1);
  });

  it("throws after retries exhausted (maxRetries=1, fail+fail)", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm(["{}", "still not valid"]);
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 1,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeInstanceOf(StructuredValidationError);
    expect((llm.chat.completions.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(2);
    expect(structuralErrorCounter.get().failed).toBe(1);
  });

  it("emits errorType=json_parse for non-JSON output", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm(["totally not json garbage"]);
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 0,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeTruthy();
    const ev = events.find(e => e.kind === "structural_error");
    if (ev?.kind === "structural_error") expect(ev.errorType).toBe("json_parse");
  });

  it("emits errorType=schema_validate for valid JSON failing schema", async () => {
    const events: RunEvent[] = [];
    const llm = makeLlm([JSON.stringify({ id: "", value: "wrong" })]);
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 0,
      signal: new AbortController().signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeTruthy();
    const ev = events.find(e => e.kind === "structural_error");
    if (ev?.kind === "structural_error") expect(ev.errorType).toBe("schema_validate");
  });

  it("retry message contains feedback string", async () => {
    const calls: unknown[] = [];
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn(async (params: unknown) => {
            calls.push(params);
            const responses = ["{}", JSON.stringify({ id: "ok", value: 1 })];
            return streamFromText(responses[calls.length - 1]) as never;
          }) as never,
        },
      },
    };
    await parseWithRetry({
      ...baseArgs, llm, maxRetries: 1,
      signal: new AbortController().signal,
      onEvent: () => {},
    });
    const second = calls[1] as { messages: Array<{ role: string; content: string }> };
    const lastUser = second.messages[second.messages.length - 1];
    expect(lastUser.role).toBe("user");
    expect(lastUser.content).toMatch(/failed validation/i);
  });

  it("propagates AbortError without emitting events or recording counter", async () => {
    const events: RunEvent[] = [];
    const ac = new AbortController();
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn(async () => {
            ac.abort();
            const err = new Error("aborted");
            err.name = "AbortError";
            throw err;
          }) as never,
        },
      },
    };
    await expect(parseWithRetry({
      ...baseArgs, llm, maxRetries: 1,
      signal: ac.signal,
      onEvent: (e) => events.push(e),
    })).rejects.toBeTruthy();
    expect(events).toEqual([]);
    expect(structuralErrorCounter.get()).toEqual({ failed: 0, retried: 0, ok: 0 });
  });
});

describe("formatZodFeedback", () => {
  it("includes path and message bullets", () => {
    const r = Schema.safeParse({ id: "", value: "x" });
    if (r.success) throw new Error("expected fail");
    const fb = formatZodFeedback(r.error, '{"id":"","value":"x"}');
    expect(fb).toMatch(/failed validation/i);
    expect(fb).toMatch(/id/);
    expect(fb).toMatch(/value/);
    expect(fb).toMatch(/Return ONLY/i);
  });

  it("formats json_parse errors as plain text", () => {
    const fb = formatZodFeedback(null, "raw garbage");
    expect(fb).toMatch(/JSON/i);
    expect(fb).toMatch(/Return ONLY/i);
  });
});
```

- [ ] **Step 2: Run tests, verify failure**

Run: `npx vitest run tests/phases/parse-with-retry.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement parse-with-retry.ts**

Create `src/phases/parse-with-retry.ts`:
```ts
import type OpenAI from "openai";
import type { z } from "zod";
import { ZodError } from "zod";
import type { LlmClient, LlmCallOptions, RunEvent } from "../types";
import {
  parseStructured, buildChatParams, extractStreamDeltas, extractUsage,
} from "./llm-utils";
import { structuralErrorCounter } from "../structural-error-counter";

export type CallSite =
  | "init.bootstrap" | "init.delta" | "lint.patch" | "query.seeds";

export class StructuredValidationError extends Error {
  constructor(
    public readonly callSite: CallSite,
    public readonly attempts: number,
    public readonly lastError: Error,
  ) {
    super(`[${callSite}] structural validation failed after ${attempts} attempt(s): ${lastError.message}`);
    this.name = "StructuredValidationError";
  }
}

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

export interface ParseWithRetryResult<T> {
  value: T;
  outputTokens: number;
  fullText: string;
}

export function formatZodFeedback(err: ZodError | null, raw: string): string {
  if (err === null) {
    return [
      "Previous response was not valid JSON.",
      `Raw output (truncated):`,
      raw.slice(0, 2000),
      "",
      "Return ONLY a single valid JSON object matching the schema. No markdown fences, no <think> tags, no commentary.",
    ].join("\n");
  }
  const bullets = err.issues.slice(0, 20).map((i) => {
    const path = i.path.length ? i.path.join(".") : "(root)";
    return `- ${path}: ${i.message}`;
  }).join("\n");
  return [
    "Previous response failed validation:",
    bullets,
    "",
    "Return ONLY a single valid JSON object matching the schema. No markdown fences, no <think> tags, no commentary.",
  ].join("\n");
}

async function streamOnce(
  llm: LlmClient,
  model: string,
  messages: OpenAI.Chat.ChatCompletionMessageParam[],
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ fullText: string; outputTokens: number }> {
  const params = buildChatParams(model, messages, opts, true);
  let fullText = "";
  let outputTokens = 0;
  try {
    const stream = await llm.chat.completions.create(
      { ...params, stream: true } as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal },
    );
    for await (const chunk of stream) {
      const { content, outputTokens: tok } = extractStreamDeltas(chunk);
      if (content) fullText += content;
      if (tok !== undefined) outputTokens += tok;
    }
    return { fullText, outputTokens };
  } catch (e) {
    if (signal.aborted || (e as Error).name === "AbortError") throw e;
    const params2 = buildChatParams(model, messages, opts);
    const resp = await llm.chat.completions.create(
      { ...params2, stream: false } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming,
      { signal },
    );
    const text = resp.choices[0]?.message?.content ?? "";
    const tok = extractUsage(resp);
    return { fullText: text, outputTokens: tok ?? 0 };
  }
}

export async function parseWithRetry<T>(args: ParseWithRetryArgs<T>): Promise<ParseWithRetryResult<T>> {
  const { llm, model, baseMessages, opts, schema, maxRetries, callSite, signal, onEvent } = args;
  let messages: OpenAI.Chat.ChatCompletionMessageParam[] = baseMessages;
  let totalTokens = 0;
  let lastError: Error = new Error("no attempts");
  let lastText = "";

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal.aborted) {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    }
    let fullText = "";
    let outputTokens = 0;
    try {
      ({ fullText, outputTokens } = await streamOnce(llm, model, messages, opts, signal));
    } catch (e) {
      if (signal.aborted || (e as Error).name === "AbortError") throw e;
      throw e;
    }
    totalTokens += outputTokens;
    lastText = fullText;

    let raw: unknown;
    try {
      raw = parseStructured(fullText);
    } catch (e) {
      lastError = e as Error;
      const isLast = attempt === maxRetries;
      const ev: RunEvent = {
        kind: "structural_error",
        callSite,
        errorType: "json_parse",
        retryAttempt: attempt,
        succeeded: isLast ? false : null,
        message: lastError.message,
      };
      onEvent(ev);
      structuralErrorCounter.record(ev.succeeded, attempt);
      if (isLast) throw new StructuredValidationError(callSite, attempt + 1, lastError);
      const feedback = formatZodFeedback(null, fullText);
      messages = [
        ...messages,
        { role: "assistant", content: fullText },
        { role: "user", content: feedback },
      ];
      continue;
    }

    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      if (attempt > 0) {
        const ev: RunEvent = {
          kind: "structural_error",
          callSite,
          errorType: "schema_validate",
          retryAttempt: attempt,
          succeeded: true,
          message: "retry succeeded",
        };
        onEvent(ev);
      }
      structuralErrorCounter.record(true, attempt);
      return { value: parsed.data, outputTokens: totalTokens, fullText };
    }

    lastError = parsed.error;
    const isLast = attempt === maxRetries;
    const feedback = formatZodFeedback(parsed.error, fullText);
    const ev: RunEvent = {
      kind: "structural_error",
      callSite,
      errorType: "schema_validate",
      retryAttempt: attempt,
      succeeded: isLast ? false : null,
      message: feedback,
    };
    onEvent(ev);
    structuralErrorCounter.record(ev.succeeded, attempt);
    if (isLast) throw new StructuredValidationError(callSite, attempt + 1, lastError);
    messages = [
      ...messages,
      { role: "assistant", content: fullText },
      { role: "user", content: feedback },
    ];
  }

  // unreachable; satisfies TS
  throw new StructuredValidationError(callSite, maxRetries + 1, lastError);
}
```

- [ ] **Step 4: Run tests, verify pass**

Run: `npx vitest run tests/phases/parse-with-retry.test.ts`

Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add src/phases/parse-with-retry.ts tests/phases/parse-with-retry.test.ts
git commit -m "feat(phases): add parseWithRetry orchestrator with zod validation + feedback retry"
```

---

## Task 5: Re-export schemas.ts for back-compat

**Files:**
- Modify: `src/phases/schemas.ts`

- [ ] **Step 1: Replace schemas.ts with re-export**

Overwrite `src/phases/schemas.ts` with:
```ts
export {
  DomainEntrySchema,
  EntityTypesDeltaSchema,
  SeedsSchema,
  type DomainEntryResponse,
  type EntityTypesDeltaResponse,
  type SeedsResponse,
} from "./zod-schemas";
```

- [ ] **Step 2: Verify type-check still passes**

Run: `npx tsc --noEmit`

Expected: 0 errors. The `EntityType[]` shape from the old hand-written interface differs from the inferred zod shape (zod marks `min_mentions_for_page` and `wiki_subfolder` as `number | undefined` / `string | undefined` rather than optional in the structural sense). Existing call-sites cast via `as` so this should compile. If TS errors appear, defer fixes — Task 7-11 will replace those casts.

- [ ] **Step 3: Run all existing tests**

Run: `npm test`

Expected: PASS — no test changes from this re-export.

- [ ] **Step 4: Commit**

```bash
git add src/phases/schemas.ts
git commit -m "refactor(schemas): re-export from zod-schemas for back-compat"
```

---

## Task 6: agent-runner — plumb structuredRetries into opts

**Files:**
- Modify: `src/agent-runner.ts`

- [ ] **Step 1: Update buildOptsFor**

In `src/agent-runner.ts`, modify the `buildOptsFor` method body. Current `claude-agent` branch returns options without `structuredRetries`; native branch builds opts twice. Apply this minimal change:

Replace the entire `buildOptsFor` method body (lines 25-41) with:
```ts
  private buildOptsFor(op: RunRequest["operation"]): { model: string; opts: LlmCallOptions } {
    const key = (op === "query-save" ? "query" : op === "chat" ? "lint" : op) as OpKey;
    const s = this.settings;
    const structuredRetries = s.nativeAgent.structuredRetries ?? 1;

    if (s.backend === "claude-agent") {
      const c = s.claudeAgent.perOperation ? s.claudeAgent.operations[key] : undefined;
      const model = c ? c.model : s.claudeAgent.model;
      return { model, opts: { systemPrompt: s.systemPrompt, structuredRetries } };
    }

    const na = s.nativeAgent;
    const c = na.perOperation ? na.operations[key] : undefined;
    if (c) return { model: c.model, opts: { maxTokens: c.maxTokens, temperature: c.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
    return { model: na.model, opts: { maxTokens: s.maxTokens, temperature: na.temperature, topP: na.topP, numCtx: na.numCtx, systemPrompt: s.systemPrompt, jsonMode: "json_object", structuredRetries } };
  }
```

Note: same `structuredRetries` source for both backends per spec §"Применимость к backends" — Claude-agent gets identical default with option to override later via `claude-agent ? 0 : settings ?? 1`. Today: same default.

- [ ] **Step 2: Verify type-check passes**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 3: Run existing agent-runner tests**

Run: `npx vitest run tests/agent-runner.integration.test.ts`

Expected: existing tests still PASS (new field ignored by current call-sites).

- [ ] **Step 4: Commit**

```bash
git add src/agent-runner.ts
git commit -m "feat(agent-runner): plumb structuredRetries into LlmCallOptions"
```

---

## Task 7: init.ts bootstrap (no sources) — replace call-site

**Files:**
- Modify: `src/phases/init.ts:98-147` (the streaming + parse block in the no-sources bootstrap path)

- [ ] **Step 1: Add imports**

In `src/phases/init.ts`, add (next to existing imports):
```ts
import { parseWithRetry } from "./parse-with-retry";
import { DomainEntrySchema, EntityTypesDeltaSchema } from "./zod-schemas";
```

- [ ] **Step 2: Replace bootstrap call-site**

Locate `src/phases/init.ts` lines 98-147 (the block that starts with `const params = buildChatParams(...)` and ends with the `} catch (e) { yield { kind: "error", message: ...` after the parse). Replace those lines with:

```ts
  const collected: RunEvent[] = [];
  let parsed: { id: string; name: string; wiki_folder: string; entity_types: EntityType[]; language_notes: string };
  try {
    const r = await parseWithRetry({
      llm, model, baseMessages: messages, opts,
      schema: DomainEntrySchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "init.bootstrap",
      signal,
      onEvent: (e) => collected.push(e),
    });
    parsed = r.value;
    outputTokens += r.outputTokens;
    if (r.fullText) yield { kind: "assistant_text", delta: r.fullText };
  } catch (e) {
    for (const ev of collected) yield ev;
    if ((e as Error).name === "AbortError" || signal.aborted) return;
    yield { kind: "error", message: `Failed to parse domain entry: ${(e as Error).message}` };
    return;
  }
  for (const ev of collected) yield ev;

  if (signal.aborted) return;

  let entry: DomainEntry;
  try {
    entry = {
      id: parsed.id,
      name: parsed.name,
      wiki_folder: parsed.wiki_folder,
      entity_types: parsed.entity_types,
      language_notes: parsed.language_notes,
    } as DomainEntry;
    const vaultPrefix = `vaults/${vaultName}/`;
    if (entry.wiki_folder?.startsWith(vaultPrefix)) {
      entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
    }
    if (entry.wiki_folder?.startsWith("!Wiki/")) {
      entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
    }
    if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
  } catch (e) {
    yield { kind: "error", message: `Failed to build domain entry: ${(e as Error).message}` };
    return;
  }
```

Note: `parseStructured`, `extractStreamDeltas`, `extractUsage`, `buildChatParams` may still be imported but unused in this function. Leave imports until Tasks 8-9 also remove their use, then prune.

- [ ] **Step 3: Run init bootstrap tests**

Run: `npx vitest run tests/phases/init.test.ts tests/phases/init-thinking.test.ts`

Expected: existing tests likely fail (call-site now goes through `parseWithRetry`). Read the failure carefully:
- If failure is "expected event order" — update test to allow new `structural_error` events (none on happy path) or use `parseWithRetry` mock. Acceptable to extend mocks.
- If failure is "missing assistant_text" — note we now yield `r.fullText` once at the end instead of streaming chunks. Update tests to assert combined text instead of individual chunks if needed.

Apply minimal updates to make tests pass. Document any test logic change in commit message.

- [ ] **Step 4: Run all tests, then commit**

Run: `npm test`

Expected: PASS.

```bash
git add src/phases/init.ts tests/phases/init.test.ts tests/phases/init-thinking.test.ts
git commit -m "refactor(init): use parseWithRetry for no-sources bootstrap call-site"
```

---

## Task 8: init.ts withSources file-0 bootstrap — replace call-site

**Files:**
- Modify: `src/phases/init.ts:262-307` (file-0 bootstrap inside `runInitWithSources`)

- [ ] **Step 1: Replace call-site**

Locate the block inside `runInitWithSources` for `i === 0 && !isResuming`, currently lines ~262-307 (the `let fullText = ""; try { stream … } catch { non-stream … }` block followed by `try { const parsed = parseStructured(fullText) as DomainEntryResponse; … }`).

Replace with:
```ts
      const collected: RunEvent[] = [];
      let parsed: { id: string; name: string; wiki_folder: string; entity_types: EntityType[]; language_notes: string };
      try {
        const r = await parseWithRetry({
          llm, model, baseMessages: messages, opts,
          schema: DomainEntrySchema,
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "init.bootstrap",
          signal,
          onEvent: (e) => collected.push(e),
        });
        parsed = r.value;
        outputTokens += r.outputTokens;
        if (r.fullText) yield { kind: "assistant_text", delta: r.fullText };
      } catch (e) {
        for (const ev of collected) yield ev;
        if ((e as Error).name === "AbortError" || signal.aborted) return;
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем bootstrap (${(e as Error).message})\n` };
        yield { kind: "file_done", file };
        continue;
      }
      for (const ev of collected) yield ev;

      if (signal.aborted) return;

      let entry: DomainEntry;
      try {
        entry = {
          id: parsed.id,
          name: parsed.name,
          wiki_folder: parsed.wiki_folder,
          entity_types: parsed.entity_types,
          language_notes: parsed.language_notes,
        } as DomainEntry;
        const vaultPrefix = `vaults/${vaultName}/`;
        if (entry.wiki_folder?.startsWith(vaultPrefix)) entry.wiki_folder = entry.wiki_folder.slice(vaultPrefix.length);
        if (entry.wiki_folder?.startsWith("!Wiki/")) entry.wiki_folder = entry.wiki_folder.slice("!Wiki/".length);
        if (!entry.id || !entry.wiki_folder) throw new Error("Missing required fields");
      } catch {
        yield { kind: "assistant_text", delta: `⚠ ${file}: bootstrap построение entry упало, пропускаем\n` };
        yield { kind: "file_done", file };
        continue;
      }
```

(Existing code below this block — `if (dryRun)`, `currentDomain = ...`, `yield tool_use/tool_result` — remains unchanged.)

- [ ] **Step 2: Run init tests**

Run: `npx vitest run tests/phases/init.test.ts tests/phases/init-thinking.test.ts`

Expected: PASS. Update mocks/assertions analogously to Task 7 if streaming-chunk expectations break.

- [ ] **Step 3: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts tests/phases/init-thinking.test.ts
git commit -m "refactor(init): use parseWithRetry for withSources file-0 bootstrap"
```

---

## Task 9: init.ts withSources file-1+ delta — replace call-site

**Files:**
- Modify: `src/phases/init.ts:352-386` (incremental delta block)

- [ ] **Step 1: Replace delta call-site**

Locate the `else { // Incremental: delta entity_types` branch inside `runInitWithSources`. Currently the block ~344-386 builds messages, streams, and parses delta. Replace the streaming + parse subsection (the `let fullText = ""; try {...} catch {...}` block plus the `let delta: ...; try { const parsed = parseStructured(...) ... } catch {...}` block) with:

```ts
      const collected: RunEvent[] = [];
      let parsed: { entity_types?: EntityType[]; language_notes?: string };
      try {
        const r = await parseWithRetry({
          llm, model, baseMessages: messages, opts,
          schema: EntityTypesDeltaSchema,
          maxRetries: opts.structuredRetries ?? 1,
          callSite: "init.delta",
          signal,
          onEvent: (e) => collected.push(e),
        });
        parsed = r.value;
        outputTokens += r.outputTokens;
      } catch (e) {
        for (const ev of collected) yield ev;
        if ((e as Error).name === "AbortError" || signal.aborted) return;
        yield { kind: "assistant_text", delta: `⚠ ${file}: LLM вернул невалидный JSON, пропускаем (${(e as Error).message})\n` };
        yield { kind: "file_done", file };
        continue;
      }
      for (const ev of collected) yield ev;

      if (signal.aborted) return;

      const delta = { entity_types: parsed.entity_types, language_notes: parsed.language_notes };
```

(Code below remains: `if (!currentDomain) { … continue; }`, `mergeEntityTypes`, etc.)

- [ ] **Step 2: Prune now-unused imports in init.ts**

If after Tasks 7-9 nothing in `init.ts` calls `parseStructured`, `extractStreamDeltas`, `extractUsage`, or uses `EntityTypesDeltaResponse`/`DomainEntryResponse` types from `./schemas`, remove those imports. `buildChatParams` is still used by helper functions — leave if still referenced. Run `npx tsc --noEmit` to verify and prune anything TS marks unused.

- [ ] **Step 3: Run all init tests**

Run: `npx vitest run tests/phases/init.test.ts tests/phases/init-thinking.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/phases/init.ts tests/phases/init.test.ts tests/phases/init-thinking.test.ts
git commit -m "refactor(init): use parseWithRetry for withSources delta call-site + prune unused imports"
```

---

## Task 10: lint.ts — replace patch call-site + inline JSON example

**Files:**
- Modify: `src/phases/lint.ts:300-369` (the `Promise<{ patch … }>` helper that calls LLM and parses)

- [ ] **Step 1: Add imports**

In `src/phases/lint.ts` add:
```ts
import { parseWithRetry } from "./parse-with-retry";
import { EntityTypesDeltaSchema } from "./zod-schemas";
```

- [ ] **Step 2: Replace LLM call + parse with parseWithRetry**

Locate the helper around line 300-369 (the function returning `Promise<{ patch: ...; outputTokens: number }>`). The current body builds messages, calls `llm.chat.completions.create` non-stream, and `parseStructured(fullText) as EntityTypesDeltaResponse`.

Replace the `const params = buildChatParams(...)` block through the second `try/catch` at end with:

```ts
  // JSON example appended to system prompt for stronger structural guidance.
  const systemContent = (messages[0].content as string) + `\n\n## Output JSON Example\n\n` + JSON.stringify({
    reasoning: "Сохранил Process, добавил Contract по новым страницам.",
    entity_types: [
      { type: "Process", description: "Бизнес-процесс", extraction_cues: ["BPMN","workflow"], wiki_subfolder: "processes" },
      { type: "Contract", description: "Договор/SLA", extraction_cues: ["SLA","договор"], wiki_subfolder: "contracts" },
    ],
    language_notes: "Использовать русский для бизнес-терминов.",
  }, null, 2);
  messages[0] = { role: "system", content: systemContent };

  const collected: RunEvent[] = [];
  try {
    const r = await parseWithRetry({
      llm, model, baseMessages: messages, opts,
      schema: EntityTypesDeltaSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "lint.patch",
      signal,
      onEvent: (e) => collected.push(e),
    });
    const parsed = r.value;
    const patch: { entity_types?: EntityType[]; language_notes?: string } = {};
    if (Array.isArray(parsed.entity_types)) patch.entity_types = parsed.entity_types as EntityType[];
    if (typeof parsed.language_notes === "string") patch.language_notes = parsed.language_notes;
    return { patch: Object.keys(patch).length > 0 ? patch : null, outputTokens: r.outputTokens };
  } catch {
    return { patch: null, outputTokens: 0 };
  }
```

Note: this helper does not have access to `RunEvent` yield channel (returns plain Promise). Per spec strict policy, lint silently downgrades to `patch: null` — matches existing behavior. `collected` events are dropped here; they would surface only if helper signature changes. Acceptable — telemetry counter still fires inside `parseWithRetry`.

If the helper has access to a yield channel via caller (check by reading the caller in `lint.ts`), thread `collected` events out. Default: drop events but keep counter side-effect.

- [ ] **Step 3: Verify lint tests**

Run: `npx vitest run tests/phases/lint.test.ts tests/phases/lint-thinking.test.ts`

Expected: PASS. Update mocks if call-site now expects streaming (it shouldn't — `parseWithRetry` falls back to non-stream on stream error, and lint helper used non-stream originally; expect `parseWithRetry` to attempt stream first, then fallback).

If tests fail because `parseWithRetry` always tries `stream: true` first and the lint mock only handles non-stream: extend mock to provide a streaming response, or have helper pass `opts` with a flag. Cleanest fix: make mock async-iterable.

- [ ] **Step 4: Commit**

```bash
git add src/phases/lint.ts tests/phases/lint.test.ts tests/phases/lint-thinking.test.ts
git commit -m "refactor(lint): use parseWithRetry for patch call-site + add JSON example"
```

---

## Task 11: query.ts — replace seeds call-site + inline JSON example

**Files:**
- Modify: `src/phases/query.ts:164-198` (`llmSelectSeeds` helper)

- [ ] **Step 1: Add imports**

In `src/phases/query.ts` add:
```ts
import { parseWithRetry } from "./parse-with-retry";
import { SeedsSchema } from "./zod-schemas";
```

- [ ] **Step 2: Replace llmSelectSeeds body**

Replace `llmSelectSeeds` (lines 164-198) with:

```ts
async function llmSelectSeeds(
  question: string,
  indexContent: string,
  allPageIds: string[],
  llm: LlmClient,
  model: string,
  opts: LlmCallOptions,
  signal: AbortSignal,
): Promise<{ seeds: string[]; outputTokens: number }> {
  const example = JSON.stringify({
    reasoning: "PageA matches keyword X; PageB referenced by index.",
    seeds: ["PageA", "PageB"],
  }, null, 2);
  const prompt = [
    `Question: "${question}"`,
    `Available wiki pages: ${allPageIds.join(", ")}`,
    indexContent ? `\nIndex:\n${indexContent}` : "",
    `\nReturn JSON only matching this shape (most relevant page names — bare names, no path, no .md):`,
    `\n## Output JSON Example`,
    example,
  ].filter(Boolean).join("\n");

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "user", content: prompt },
  ];

  try {
    const r = await parseWithRetry({
      llm, model, baseMessages: messages, opts,
      schema: SeedsSchema,
      maxRetries: opts.structuredRetries ?? 1,
      callSite: "query.seeds",
      signal,
      onEvent: () => { /* helper has no yield channel; counter still fires */ },
    });
    return { seeds: r.value.seeds, outputTokens: r.outputTokens };
  } catch {
    return { seeds: [], outputTokens: 0 };
  }
}
```

- [ ] **Step 3: Prune unused imports in query.ts**

Remove `parseStructured`, `extractUsage`, `buildChatParams`, `SeedsResponse` if no longer used. Run `npx tsc --noEmit` to verify.

- [ ] **Step 4: Run query tests**

Run: `npx vitest run tests/phases/query.test.ts tests/phases/query-thinking.test.ts`

Expected: PASS. Update mocks for streaming if needed (same as Task 10).

- [ ] **Step 5: Commit**

```bash
git add src/phases/query.ts tests/phases/query.test.ts tests/phases/query-thinking.test.ts
git commit -m "refactor(query): use parseWithRetry for seeds call-site + add JSON example"
```

---

## Task 12: Add JSON examples to prompts/init.md and prompts/init-incremental.md

**Files:**
- Modify: `prompts/init.md`
- Modify: `prompts/init-incremental.md`

- [ ] **Step 1: Append example to prompts/init.md**

Append to end of `prompts/init.md`:

```markdown

## Output JSON Example

{
  "reasoning": "Проанализировал источники. Выявил сущности: Process, ServiceContract, Customer.",
  "id": "{{domain_id}}",
  "name": "Telecom Operations",
  "wiki_folder": "{{domain_id}}",
  "entity_types": [
    {
      "type": "Process",
      "description": "Бизнес-процесс или шаг workflow",
      "extraction_cues": ["BPMN", "workflow", "процесс"],
      "min_mentions_for_page": 1,
      "wiki_subfolder": "processes"
    }
  ],
  "language_notes": "Смесь русского/английского; сохраняй оригинальное написание product-имён."
}
```

- [ ] **Step 2: Append example to prompts/init-incremental.md**

Append to end of `prompts/init-incremental.md`:

```markdown

## Output JSON Example

{
  "reasoning": "Сохранил существующий Process, добавил новый Contract по найденным страницам SLA.",
  "entity_types": [
    {
      "type": "Process",
      "description": "Бизнес-процесс",
      "extraction_cues": ["BPMN", "процесс"]
    },
    {
      "type": "Contract",
      "description": "Договор оказания услуг / SLA",
      "extraction_cues": ["SLA", "договор", "соглашение"],
      "wiki_subfolder": "contracts"
    }
  ],
  "language_notes": "Договорные термины — на русском."
}
```

- [ ] **Step 3: Verify build still bundles prompts**

Run: `npm run build`

Expected: success. (Prompts are imported via `*.md` esbuild loader.)

- [ ] **Step 4: Commit**

```bash
git add prompts/init.md prompts/init-incremental.md
git commit -m "docs(prompts): add JSON output examples to init + init-incremental prompts"
```

---

## Task 13: Settings UI — number input for structuredRetries + i18n

**Files:**
- Modify: `src/i18n.ts`
- Modify: `src/settings.ts`

- [ ] **Step 1: Add i18n keys**

Find the existing `settings` section in `src/i18n.ts` (where keys like `baseUrl_name`, `model_name` live). Add:

```ts
  structuredRetries_name: "Structured output retries",
  structuredRetries_desc: "Retries on schema validation failure (0-3, default 1). Higher values improve success rate on weaker models at cost of latency/tokens.",
```

If `i18n.ts` has a Russian variant, add the same keys with Russian text:
```ts
  structuredRetries_name: "Повторы при ошибке схемы",
  structuredRetries_desc: "Сколько раз повторить вызов LLM при невалидной структуре ответа (0-3, по умолчанию 1). Выше — надёжнее на слабых моделях, дороже по токенам.",
```

- [ ] **Step 2: Add number Setting after the native-agent block**

In `src/settings.ts`, locate the `else { … // native-agent rendering` block (around line 278). After all native-agent settings (after `perOperation`/`operations` rendering ends, before block close), add:

```ts
      new Setting(containerEl)
        .setName(T.settings.structuredRetries_name)
        .setDesc(T.settings.structuredRetries_desc)
        .addText((t) =>
          t.setPlaceholder("1")
            .setValue(String(s.nativeAgent.structuredRetries))
            .onChange(async (v) => {
              const n = Number(v);
              if (!Number.isFinite(n) || n < 0 || n > 3) return;
              s.nativeAgent.structuredRetries = Math.floor(n);
              await this.plugin.saveSettings();
            }),
        );
```

- [ ] **Step 3: Verify TS compiles + build**

Run: `npx tsc --noEmit && npm run build`

Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/i18n.ts src/settings.ts
git commit -m "feat(settings): add structuredRetries number input"
```

---

## Task 14: main.ts — status bar + counter subscription

**Files:**
- Modify: `src/main.ts`

- [ ] **Step 1: Add import**

At top of `src/main.ts`:
```ts
import { structuralErrorCounter } from "./structural-error-counter";
```

- [ ] **Step 2: Add status bar in onload()**

In `src/main.ts` `onload()`, after the existing `this.addRibbonIcon(...)` call (~line 38), insert:

```ts
    if (!Platform.isMobile) {
      const statusBar = this.addStatusBarItem();
      statusBar.setText("schema: 0/0");
      statusBar.setAttribute("aria-label", "validation: 0 ok, 0 retried, 0 failed");
      const unsub = structuralErrorCounter.subscribe((s) => {
        const total = s.failed + s.retried + s.ok;
        statusBar.setText(`schema: ${s.failed}/${total}`);
        statusBar.setAttribute(
          "aria-label",
          `validation: ${s.ok} ok, ${s.retried} retried, ${s.failed} failed`,
        );
      });
      this.register(() => unsub());
    }
```

(Skipping on mobile because `addStatusBarItem` is no-op there per Obsidian docs and the operations using structured output rarely run on mobile.)

- [ ] **Step 3: Build + smoke check**

Run: `npm run build`

Expected: success. Manually verify `main.js` size reasonable (zod + status bar < 30 KB additional vs prior).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts
git commit -m "feat(telemetry): add structural error status bar item"
```

---

## Task 15: agent-runner integration test for structural failure

**Files:**
- Modify: `tests/agent-runner.integration.test.ts`

- [ ] **Step 1: Add failing-JSON test case**

In `tests/agent-runner.integration.test.ts`, add a new `describe`/`it` (or single `it` inside an existing group) that exercises structural failure end-to-end. Write it after the existing tests:

```ts
import { structuralErrorCounter } from "../src/structural-error-counter";

it("emits structural_error + error events when init LLM returns invalid JSON", async () => {
  structuralErrorCounter.reset();
  const llm = mockLlmClient([
    // Return clearly invalid JSON for both initial + 1 retry attempts.
    { stream: ["not json at all"] },
    { stream: ["still not json"] },
  ]);
  const settings = makeSettings({
    backend: "native-agent",
    nativeAgent: { structuredRetries: 1 },
  });
  const runner = new AgentRunner(llm, settings, mockVaultTools(), "vault", []);
  const events: RunEvent[] = [];
  for await (const ev of runner.run({
    operation: "init", args: ["new-domain"], cwd: "/v",
    signal: new AbortController().signal, timeoutMs: 60000,
  })) {
    events.push(ev);
  }
  const structErr = events.find(e => e.kind === "structural_error" && e.succeeded === false);
  const err = events.find(e => e.kind === "error");
  expect(structErr).toBeDefined();
  expect(err).toBeDefined();
  expect(structuralErrorCounter.get().failed).toBe(1);
});
```

Adjust `mockLlmClient`, `makeSettings`, `mockVaultTools` to match the helpers already used in this file (read the existing test for patterns; helper names may differ — adapt to what's there). If existing test does not have helpers for streaming responses, extend them following the same pattern as `tests/phases/parse-with-retry.test.ts:streamFromText`.

- [ ] **Step 2: Run integration test**

Run: `npx vitest run tests/agent-runner.integration.test.ts`

Expected: PASS — the new test plus existing tests.

- [ ] **Step 3: Final full suite**

Run: `npm test`

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add tests/agent-runner.integration.test.ts
git commit -m "test(agent-runner): cover structural failure end-to-end"
```

---

## Task 16: Final verification + version bump

**Files:**
- Modify: `package.json`
- Modify: `src/manifest.json`

- [ ] **Step 1: Run full test suite**

Run: `npm test`

Expected: all PASS.

- [ ] **Step 2: Run full build**

Run: `npm run build`

Expected: `main.js` produced; no warnings.

- [ ] **Step 3: Bump patch version**

Per project rules, bump patch version: read current `package.json` `version`, increment patch (e.g. `0.1.97` → `0.1.98`). Apply same value to `src/manifest.json`.

```bash
node -e "let p=require('./package.json'); let [a,b,c]=p.version.split('.').map(Number); p.version=`${a}.${b}.${c+1}`; require('fs').writeFileSync('package.json', JSON.stringify(p,null,'\t')+'\n'); let m=require('./src/manifest.json'); m.version=p.version; require('fs').writeFileSync('src/manifest.json', JSON.stringify(m,null,'\t')+'\n'); console.log(p.version);"
```

Then re-run `npm run build` so any embedded version is up to date.

- [ ] **Step 4: Manual smoke (optional, document only)**

If able to symlink build into vault per CLAUDE.md (`ln -s $(pwd)/dist ~/.config/obsidian/Plugins/obsidian-llm-wiki`):
1. Reload Obsidian.
2. Open settings → confirm "Structured output retries" input shows under nativeAgent.
3. Confirm status bar shows `schema: 0/0`.
4. Run init/lint/query against a domain — confirm operations still work.

If unable to run live: state explicitly in commit body that UI was not smoke-tested.

- [ ] **Step 5: Commit version bump**

```bash
git add package.json src/manifest.json main.js
git commit -m "chore(release): v$(node -p 'require(\"./package.json\").version') — structured output resilience"
```

---

## Self-review checklist (run mentally after writing code)

- [ ] All 5 spec call-sites replaced (init.ts ×3, lint.ts ×1, query.ts ×1)?
- [ ] `structuralErrorCounter.record()` fires exactly once per orchestrator call (success or terminal failure)?
- [ ] No stray `parseStructured(...) as Type` casts left in `init.ts`/`lint.ts`/`query.ts`?
- [ ] `prompts/init.md`, `prompts/init-incremental.md` updated; lint/query examples added inline (not in `prompts/lint.md`/`prompts/query.md` — those are different prompts)?
- [ ] `nativeAgent.structuredRetries` defaults to 1 via `?? 1` — no migration needed for existing settings?
- [ ] Status bar registered with `this.register(() => unsub())` — no listener leak on unload?
- [ ] All `RunEvent` `structural_error` variants carry `callSite`, `errorType`, `retryAttempt`, `succeeded`, `message`?
- [ ] `controller.logEvent` filter at `controller.ts:478` only excludes `assistant_text` — `structural_error` flows through to `agent.jsonl` automatically (no code change needed; verified by reading filter)?
