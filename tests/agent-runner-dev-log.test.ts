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

function streamFromText(text: string): AsyncIterable<OpenAI.Chat.ChatCompletionChunk> {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        choices: [{ delta: { content: text }, index: 0, finish_reason: null }],
      } as unknown as OpenAI.Chat.ChatCompletionChunk;
      yield {
        choices: [{ delta: {}, index: 0, finish_reason: "stop" }],
        usage: { completion_tokens: 1 },
      } as unknown as OpenAI.Chat.ChatCompletionChunk;
    },
  };
}

function makeLlmMulti(responses: string[]): LlmClient {
  let i = 0;
  return {
    chat: {
      completions: {
        create: vi.fn(async (_params: unknown) => {
          const text = responses[Math.min(i++, responses.length - 1)];
          const p = _params as Record<string, unknown>;
          // Evaluator uses stream: false — return non-streaming response
          if (p.stream === false) {
            return {
              choices: [{ message: { content: text }, finish_reason: "stop" }],
              usage: { completion_tokens: 1 },
            } as unknown as OpenAI.Chat.ChatCompletion;
          }
          // All other calls use stream: true — return async iterable
          return streamFromText(text) as never;
        }),
      },
    },
  } as unknown as LlmClient;
}

/** For query: call 1 = seeds JSON, call 2 = answer text */
function makeLlm(text: string): LlmClient {
  return makeLlmMulti(['{"seeds":["page1"]}', text]);
}

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const testDomain = {
  id: "test",
  name: "Test",
  wiki_folder: "wiki",
  entity_types: [],
  language_notes: "",
};

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
  it("writeDevLog writes to !Wiki/_config/_dev.jsonl when devMode enabled", async () => {
    const adapter = mockAdapter();
    const vt = new VaultTools(adapter, "/vault");
    const runner = new AgentRunner(makeLlm("The answer."), devOnSettings, vt, "TestVault", [testDomain]);

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
    expect([...writePaths, ...appendPaths]).toContain("!Wiki/_config/_dev.jsonl");
  });

  it("writeDevLog does NOT write _dev.jsonl when devMode disabled", async () => {
    const adapter = mockAdapter();
    const vt = new VaultTools(adapter, "/vault");
    const runner = new AgentRunner(makeLlm("The answer."), devOffSettings, vt, "TestVault", [testDomain]);

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
    expect([...writePaths, ...appendPaths]).not.toContain("!Wiki/_config/_dev.jsonl");
  });

  it("updateDevLogEval patches last line of !Wiki/_config/_dev.jsonl with eval score", async () => {
    // createMockAdapter is stateful: write() stores data, read() retrieves it.
    // This lets writeDevLog write the file and updateDevLogEval read it back in one run.
    const statefulAdapter = createMockAdapter();
    const vt = new VaultTools(statefulAdapter as VaultAdapter, "/vault");

    const settings: LlmWikiPluginSettings = {
      ...DEFAULT_SETTINGS,
      backend: "native-agent",
      devMode: { enabled: true, evaluatorModel: "sonnet" },
    };

    // LLM call 1: seeds; call 2: query answer; call 3: evaluator JSON
    const runner = new AgentRunner(
      makeLlmMulti(['{"seeds":["page1"]}', "The answer.", '{"score": 4, "reasoning": "looks good"}']),
      settings,
      vt,
      "TestVault",
      [testDomain],
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

    const written = statefulAdapter.files.get("!Wiki/_config/_dev.jsonl");
    expect(written).toBeDefined();
    const lastLine = written!.trimEnd().split("\n").at(-1)!;
    const parsed = JSON.parse(lastLine) as { eval: { score: number; reasoning: string } };
    expect(parsed.eval).toEqual({ score: 4, reasoning: "looks good" });
  });
});
