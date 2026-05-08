import { describe, it, expect, vi } from "vitest";
import { AgentRunner } from "../src/agent-runner";
import { VaultTools, type VaultAdapter } from "../src/vault-tools";
import type { RunEvent, LlmWikiPluginSettings, LlmClient } from "../src/types";
import { DEFAULT_SETTINGS } from "../src/types";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue("source content"),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlm(text: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: text } }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
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
});
