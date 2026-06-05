import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../src/agent-runner";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { RunEvent, LlmWikiPluginSettings, LlmClient } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";
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
    const formatted = "---\ntags: []\n---\n\n# OK\n\nContent here.";
    const sentinel = `<<<REPORT>>>\nr\n<<<FORMATTED>>>\n${formatted}\n<<<END>>>`;
    const adapter = mockAdapter({ read: vi.fn().mockResolvedValue("# Заметка ClickHouse 1.0") });
    const vt = new VaultTools(adapter, "/vault");
    const runner = new AgentRunner(makeLlm(sentinel), baseSettings, vt, "TestVault", []);
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
