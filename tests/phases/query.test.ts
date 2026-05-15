import { describe, it, expect, vi } from "vitest";
import { runQuery } from "../../src/phases/query";
import { VaultTools, type VaultAdapter } from "../../src/vault-tools";
import type { LlmClient } from "../../src/types";
import type { DomainEntry } from "../../src/domain";

function mockAdapter(overrides: Partial<VaultAdapter> = {}): VaultAdapter {
  return {
    read: vi.fn().mockResolvedValue(""),
    write: vi.fn().mockResolvedValue(undefined),
    list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
    exists: vi.fn().mockResolvedValue(true),
    mkdir: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeLlm(answer: string): LlmClient {
  return {
    chat: {
      completions: {
        create: vi.fn().mockResolvedValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: answer } }] };
          },
        }),
      },
    },
  } as unknown as LlmClient;
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const VAULT_ROOT = "/vaults/Work";

const domain: DomainEntry = {
  id: "work",
  name: "Work",
  wiki_folder: "work",
  source_paths: [],
};

describe("runQuery", () => {
  it("yields error when question is empty", async () => {
    const vt = new VaultTools(mockAdapter(), VAULT_ROOT);
    const events = await collect(
      runQuery([], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT, new AbortController().signal),
    );
    expect(events.some((e: any) => e.kind === "error")).toBe(true);
  });

  it("yields result with LLM answer", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Page.md"], folders: [] }),
      read: vi.fn().mockResolvedValue("# Page\n\nSome fact."),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(
        ["What is the answer?"],
        false,
        vt,
        makeLlm("The answer is 42."),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    const result = events.find((e: any) => e.kind === "result") as any;
    expect(result).toBeDefined();
    expect(result.text).toContain("42");
  });

  it("saves answer page when save=true", async () => {
    const adapter = mockAdapter({
      exists: vi.fn().mockResolvedValue(true),
      list: vi.fn().mockResolvedValue({ files: [], folders: [] }),
      read: vi.fn().mockResolvedValue(""),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    await collect(
      runQuery(
        ["What is X?"],
        true,
        vt,
        makeLlm("X is Y."),
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
      ),
    );
    expect(adapter.write).toHaveBeenCalled();
    const [savedPath] = (adapter.write as any).mock.calls[0];
    expect(savedPath).toMatch(/\.md$/);
  });

  it("emits graph_stats event with correct shape", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({ files: ["!Wiki/work/Alpha.md", "!Wiki/work/Beta.md"], folders: [] }),
      read: vi.fn().mockImplementation(async (p: string) => {
        if (p.endsWith("Alpha.md")) return "alpha content";
        if (p.endsWith("Beta.md")) return "beta [[Alpha]]";
        return "";
      }),
      exists: vi.fn().mockResolvedValue(true),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const events = await collect(
      runQuery(["alpha"], false, vt, makeLlm("answer"), "model", [domain], VAULT_ROOT,
        new AbortController().signal, 1, {}, 5, 0.05),
    );
    const stats = events.find((e: any) => e.kind === "graph_stats") as any;
    expect(stats).toBeDefined();
    expect(stats.seeds).toContain("Alpha");
    expect(stats.total).toBe(2);
    expect(stats.expanded).toBeGreaterThanOrEqual(stats.seeds.length);
    expect(typeof stats.fromCache).toBe("boolean");
  });

  it("excludes pages not reached by BFS when keyword seed found (graphDepth=0)", async () => {
    const adapter = mockAdapter({
      list: vi.fn().mockResolvedValue({
        files: ["!Wiki/work/Neural-network.md", "!Wiki/work/Unrelated.md"],
        folders: [],
      }),
      read: vi.fn().mockImplementation((path: string) => {
        if (path.endsWith("Neural-network.md"))
          return Promise.resolve("# Neural network\nA learning system.");
        if (path.endsWith("Unrelated.md"))
          return Promise.resolve("# Unrelated\nSomething else entirely.");
        return Promise.resolve("");
      }),
    });
    const vt = new VaultTools(adapter, VAULT_ROOT);
    const llm = makeLlm("answer");
    await collect(
      runQuery(
        ["neural network question"],
        false,
        vt,
        llm,
        "model",
        [domain],
        VAULT_ROOT,
        new AbortController().signal,
        0, // graphDepth=0: seeds only, no BFS expansion
      ),
    );
    // Find the streaming LLM call (main query call)
    const createMock = llm.chat.completions.create as ReturnType<typeof vi.fn>;
    const streamCall = createMock.mock.calls.find((c: any) => c[0]?.stream === true);
    const userContent = streamCall?.[0]?.messages?.find((m: any) => m.role === "user")?.content ?? "";
    // "neural" keyword matches "Neural-network" page; "Unrelated" excluded at depth=0
    expect(userContent).toContain("Neural-network");
    expect(userContent).not.toContain("Unrelated");
  });
});
