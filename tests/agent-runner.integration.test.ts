import { describe, it, expect, vi, beforeEach } from "vitest";
import { AgentRunner } from "../src/agent-runner";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { RunEvent, LlmWikiPluginSettings, LlmClient } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";
import { structuralErrorCounter } from "../src/structural-error-counter";
import type OpenAI from "openai";

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
          return streamFromText(text) as never;
        }) as never,
      },
    },
  } as unknown as LlmClient;
}

function makeLlm(text: string): LlmClient {
  return makeLlmMulti([text]);
}

const baseSettings: LlmWikiPluginSettings = {
  ...DEFAULT_SETTINGS,
  backend: "native-agent",
};

beforeEach(() => structuralErrorCounter.reset());

async function collect(gen: AsyncGenerator<RunEvent>): Promise<RunEvent[]> {
  const out: RunEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("AgentRunner", () => {
  it("yields system init event on start", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const runner = new AgentRunner(makeLlm("[]"), baseSettings, vt, "TestVault", []);
    const events = await collect(
      runner.run({
        operation: "query",
        args: ["test question"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    );
    expect(events[0]).toMatchObject({ kind: "system" });
  });

  it("yields result event for query", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const runner = new AgentRunner(makeLlm("The answer."), baseSettings, vt, "TestVault", []);
    const events = await collect(
      runner.run({
        operation: "query",
        args: ["What is X?"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ kind: "system" });
    expect(events.some((e) => e.kind === "result" || e.kind === "error")).toBe(true);
  });

  it("маршрутизирует operation=format в runFormat", async () => {
    const formatted = "# OK";
    const json = JSON.stringify({ report: "r", formatted });
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("# Заметка ClickHouse 1.0") });
    const vt = new VaultTools(adapter, "/vault");
    const runner = new AgentRunner(makeLlm(json), baseSettings, vt, "TestVault", []);
    const events = await collect(
      runner.run({
        operation: "format",
        args: ["note.md"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 60_000,
      }),
    );
    expect(events.some((e) => e.kind === "format_preview")).toBe(true);
  });

  it("stops early on aborted signal", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const runner = new AgentRunner(makeLlm("answer"), baseSettings, vt, "TestVault", []);
    const ctrl = new AbortController();
    ctrl.abort();
    const events = await collect(
      runner.run({
        operation: "query",
        args: ["Q"],
        cwd: "/vault",
        signal: ctrl.signal,
        timeoutMs: 10_000,
      }),
    );
    expect(events.length).toBeGreaterThan(0);
    expect(events[0]).toMatchObject({ kind: "system" });
  });

  it("routes lint-chat to runLintFixChat and yields result", async () => {
    const vt = new VaultTools(mockAdapter(), "/vault");
    const runner = new AgentRunner(
      makeLlm(JSON.stringify({ summary: "fixed", pages: [] })),
      baseSettings,
      vt,
      "TestVault",
      [],
    );
    const events = await collect(
      runner.run({
        operation: "lint-chat",
        args: [],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 5000,
        domainId: undefined,
        context: "lint report",
        chatMessages: [{ role: "user", content: "fix it" }],
      }),
    );
    const result = events.find((e) => e.kind === "result");
    expect(result).toBeDefined();
  });

  it("emits structural_error + error events when init LLM returns invalid JSON for all retries", async () => {
    const settings: LlmWikiPluginSettings = {
      ...DEFAULT_SETTINGS,
      backend: "native-agent",
      nativeAgent: { ...DEFAULT_SETTINGS.nativeAgent, structuredRetries: 1 },
    };
    const llm = makeLlmMulti(["not json at all", "still not json"]);
    const vt = new VaultTools(mockAdapter(), "/vault");
    const runner = new AgentRunner(llm, settings, vt, "TestVault", []);
    const events = await collect(
      runner.run({
        operation: "init",
        args: ["new-domain"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 60_000,
      }),
    );
    const structErr = events.find(e => e.kind === "structural_error" && e.succeeded === false);
    const err = events.find(e => e.kind === "error");
    expect(structErr).toBeDefined();
    expect(err).toBeDefined();
    expect(structuralErrorCounter.get().failed).toBe(1);
  });

  it("passes global thinkingBudgetTokens to opts when native-agent and no per-op", async () => {
    const settings: LlmWikiPluginSettings = {
      ...DEFAULT_SETTINGS,
      backend: "native-agent",
      nativeAgent: {
        ...DEFAULT_SETTINGS.nativeAgent,
        thinkingBudgetTokens: 8000,
        perOperation: false,
      },
    };
    const vt = new VaultTools(mockAdapter(), "/vault");
    let capturedParams: unknown = null;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn(async (params: unknown) => {
            capturedParams = params;
            return streamFromText("[]") as never;
          }) as never,
        },
      },
    } as unknown as LlmClient;
    const runner = new AgentRunner(llm, settings, vt, "TestVault", []);
    await collect(runner.run({ operation: "init", args: ["new-domain"], cwd: "/vault", signal: new AbortController().signal, timeoutMs: 10_000 }));
    expect((capturedParams as Record<string, unknown>)?.thinking).toEqual({ type: "enabled", budget_tokens: 8000 });
  });

  it("passes per-op thinkingBudgetTokens to opts when native-agent and per-op override set", async () => {
    const settings: LlmWikiPluginSettings = {
      ...DEFAULT_SETTINGS,
      backend: "native-agent",
      nativeAgent: {
        ...DEFAULT_SETTINGS.nativeAgent,
        thinkingBudgetTokens: 8000,
        perOperation: true,
        operations: {
          ...DEFAULT_SETTINGS.nativeAgent.operations,
          init: { model: "llama3.2", maxTokens: 8192, temperature: 0.2, thinkingBudgetTokens: 16000 },
        },
      },
    };
    const vt = new VaultTools(mockAdapter(), "/vault");
    let capturedParams: unknown = null;
    const llm: LlmClient = {
      chat: {
        completions: {
          create: vi.fn(async (params: unknown) => {
            capturedParams = params;
            return streamFromText("[]") as never;
          }) as never,
        },
      },
    } as unknown as LlmClient;
    const runner = new AgentRunner(llm, settings, vt, "TestVault", []);
    await collect(runner.run({ operation: "init", args: ["new-domain"], cwd: "/vault", signal: new AbortController().signal, timeoutMs: 10_000 }));
    expect((capturedParams as Record<string, unknown>)?.thinking).toEqual({ type: "enabled", budget_tokens: 16000 });
  });

  it("system event содержит baseUrl для native-agent backend", async () => {
    const settingsWithUrl: LlmWikiPluginSettings = {
      ...baseSettings,
      backend: "native-agent",
      nativeAgent: {
        ...DEFAULT_SETTINGS.nativeAgent,
        baseUrl: "https://homelab.example.com/v1",
      },
    };
    const vt = new VaultTools(mockAdapter(), "/vault");
    const runner = new AgentRunner(makeLlm("[]"), settingsWithUrl, vt, "TestVault", []);
    const events = await collect(
      runner.run({
        operation: "query",
        args: ["test"],
        cwd: "/vault",
        signal: new AbortController().signal,
        timeoutMs: 10_000,
      }),
    );
    const systemEv = events[0] as { kind: string; message: string };
    expect(systemEv.kind).toBe("system");
    expect(systemEv.message).toContain("https://homelab.example.com/v1");
  });
});
