# Validate .config Log Migration — Fix + Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix one failing test caused by stale spy state, then add unit tests for `writeDevLog` and `updateDevLogEval` that explicitly assert the new `!Wiki/.config/` paths.

**Architecture:** Two surgical changes. (1) One-liner `afterEach` in an existing test file. (2) New test file `tests/agent-runner-dev-log.test.ts` with 3 tests exercising the dev-log path through `AgentRunner.run()` with `devMode.enabled = true`.

**Tech Stack:** TypeScript, Vitest, `createMockAdapter` from `vitest.mock.ts`

---

### Task 1: Fix `controller-cache-invalidation.test.ts` — stale spy

**Files:**
- Modify: `tests/controller-cache-invalidation.test.ts`

**Root cause:** `vi.spyOn(graphCache, "invalidate")` does not reset the spy's call history between tests. By the time the "query does NOT invalidate" test runs (5th test), the spy already has 5 accumulated calls from prior tests. `expect(invalidateSpy).not.toHaveBeenCalled()` fails with count=6.

`vi.restoreAllMocks()` in `afterEach` restores the original function and clears call history.

- [ ] **Step 1: Add `afterEach` to the describe block**

Open `tests/controller-cache-invalidation.test.ts`. Locate:

```ts
describe("WikiController cache invalidation after mutating ops", () => {
  beforeEach(() => {
    graphCache.clear();
  });
```

Replace with:

```ts
describe("WikiController cache invalidation after mutating ops", () => {
  beforeEach(() => {
    graphCache.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
```

Also add `afterEach` to the imports if not already present — it is already imported alongside `beforeEach` (`import { describe, it, expect, vi, beforeEach } from "vitest"`). Change that line to:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
```

- [ ] **Step 2: Run only this test file to verify all tests pass**

```bash
npx vitest run tests/controller-cache-invalidation.test.ts
```

Expected output:
```
✓ tests/controller-cache-invalidation.test.ts (5)
Test Files  1 passed (1)
Tests       5 passed (5)
```

- [ ] **Step 3: Commit**

```bash
git add tests/controller-cache-invalidation.test.ts
git commit -m "fix(test): restore mocks between cache-invalidation tests"
```

---

### Task 2: New tests for `writeDevLog` and `updateDevLogEval`

**Files:**
- Create: `tests/agent-runner-dev-log.test.ts`

These tests exercise the private methods indirectly through `AgentRunner.run()`. They verify that with `devMode.enabled = true`, the dev log is written to `!Wiki/.config/_dev.jsonl` — and not written when disabled.

`createMockAdapter` from `vitest.mock.ts` is used for test 3 because it is stateful: `write()` actually stores data, and `read()` retrieves it. This allows `writeDevLog` to write and then `updateDevLogEval` to read the same file in the same run.

- [ ] **Step 1: Create the test file**

Create `tests/agent-runner-dev-log.test.ts` with the full content below:

```ts
import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../src/agent-runner";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { RunEvent, LlmWikiPluginSettings, LlmClient } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";
import type OpenAI from "openai";
import { createMockAdapter } from "../vitest.mock";

// ---------------------------------------------------------------------------
// Helpers (local copies — intentionally not shared with other test files)
// ---------------------------------------------------------------------------

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue("source content"),
    write: vi.fn().mockResolvedValue(undefined),
    append: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(false),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlmMulti(responses: string[]): LlmClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async (_params: unknown) => {
          const text = responses[Math.min(i++, responses.length - 1)];
          return {
            choices: [{ message: { content: text }, finish_reason: "stop" }],
            usage: { completion_tokens: 1 },
          } as unknown as OpenAI.Chat.ChatCompletion;
        }),
      },
    },
  } as unknown as LlmClient;
}

function makeLlm(text: string): LlmClient {
  return makeLlmMulti([text]);
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const devOnSettings: LlmWikiPluginSettings = {
  ...DEFAULT_SETTINGS,
  backend: "native-agent",
  devMode: { enabled: true, evaluatorModel: "" },
};

const devOffSettings: LlmWikiPluginSettings = {
  ...DEFAULT_SETTINGS,
  backend: "native-agent",
  devMode: { enabled: false, evaluatorModel: "" },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AgentRunner dev log — path validation", () => {
  it("writeDevLog writes to !Wiki/.config/_dev.jsonl when devMode enabled", async () => {
    const adapter = mockAdapter();
    const vt = new VaultTools(adapter, "/vault");
    const runner = new AgentRunner(makeLlm("The answer."), devOnSettings, vt, "TestVault", []);

    await collect(
      runner.run({
        operation: "query",
        args: ["test?"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    );

    const writePaths = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    const appendPaths = (adapter.append as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect([...writePaths, ...appendPaths]).toContain("!Wiki/.config/_dev.jsonl");
  });

  it("writeDevLog does NOT write _dev.jsonl when devMode disabled", async () => {
    const adapter = mockAdapter();
    const vt = new VaultTools(adapter, "/vault");
    const runner = new AgentRunner(makeLlm("The answer."), devOffSettings, vt, "TestVault", []);

    await collect(
      runner.run({
        operation: "query",
        args: ["test?"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    );

    const writePaths = (adapter.write as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    const appendPaths = (adapter.append as ReturnType<typeof vi.fn>).mock.calls.map(
      (c: unknown[]) => c[0] as string,
    );
    expect([...writePaths, ...appendPaths]).not.toContain("!Wiki/.config/_dev.jsonl");
  });

  it("updateDevLogEval patches last line of !Wiki/.config/_dev.jsonl with eval score", async () => {
    // createMockAdapter is stateful: write() stores data, read() retrieves it.
    // This lets writeDevLog write the file and updateDevLogEval read it back in one run.
    const statefulAdapter = createMockAdapter();
    const vt = new VaultTools(statefulAdapter as VaultAdapter, "/vault");

    const settings: LlmWikiPluginSettings = {
      ...DEFAULT_SETTINGS,
      backend: "native-agent",
      devMode: { enabled: true, evaluatorModel: "sonnet" },
    };

    // LLM call 1: query result; LLM call 2: evaluator JSON
    const runner = new AgentRunner(
      makeLlmMulti(["The answer.", '{"score": 4, "reasoning": "looks good"}']),
      settings,
      vt,
      "TestVault",
      [],
    );

    await collect(
      runner.run({
        operation: "query",
        args: ["test?"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    );

    const written = statefulAdapter.files.get("!Wiki/.config/_dev.jsonl");
    expect(written).toBeDefined();
    const lastLine = written!.trimEnd().split("\n").at(-1)!;
    const parsed = JSON.parse(lastLine) as { eval: { score: number; reasoning: string } };
    expect(parsed.eval).toEqual({ score: 4, reasoning: "looks good" });
  });
});
```

- [ ] **Step 2: Run the new test file to verify all 3 tests pass**

```bash
npx vitest run tests/agent-runner-dev-log.test.ts
```

Expected output:
```
✓ tests/agent-runner-dev-log.test.ts (3)
Test Files  1 passed (1)
Tests       3 passed (3)
```

If tests 1 or 2 fail with "received array does not contain", check that the `query` operation actually produces a non-empty `finalResultText` — it requires the LLM mock to return a non-empty string ("The answer." satisfies this).

If test 3 fails with `parsed.eval` being `null`, the evaluator LLM call may not be firing: verify `devMode.evaluatorModel` is non-empty (`"sonnet"` is set) and the second LLM response is valid JSON matching `{"score": N, "reasoning": "..."}`.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
npm test
```

Expected: all 590 tests pass (588 previous passing + 3 new, minus the 1 previously failing = 590 pass, 0 fail).

- [ ] **Step 4: Commit**

```bash
git add tests/agent-runner-dev-log.test.ts
git commit -m "test(agent-runner): verify writeDevLog and updateDevLogEval write to !Wiki/.config/_dev.jsonl"
```
